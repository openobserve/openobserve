// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Token-authenticated inbound webhook endpoint for external alert sources
//! (Grafana, Alertmanager, generic webhooks). Deliberately registered in
//! `basic_routes()` (not the authenticated `service_routes` scope) — token
//! validation happens only inside this handler, never in
//! `src/api/common/src/auth/validator.rs`. See GHSA-wffq-g8qf-ccmv: widening
//! the shared token classifier there caused an auth bypass in the past; this
//! new `o2iat_` token type must not repeat that mistake.

use axum::{Json, extract::Path, http::HeaderMap, response::Response};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Maximum number of individual alerts accepted in a single webhook request.
pub const MAX_ALERTS_PER_REQUEST: usize = 200;

/// Maximum request body size accepted for these routes (bytes).
pub const MAX_BODY_BYTES: usize = 1_048_576;

/// Extracts the integration token from either the `Authorization: Bearer` header
/// or a path-embedded token, preferring the header when both are present.
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub(crate) fn extract_token(auth_header: Option<&str>, path_token: Option<&str>) -> Option<String> {
    if let Some(h) = auth_header
        && let Some(t) = h.strip_prefix("Bearer ")
        && t.starts_with(infra::table::incident_integrations::INCIDENT_INTEGRATION_TOKEN_PREFIX)
    {
        return Some(t.to_string());
    }
    path_token
        .filter(|t| {
            t.starts_with(infra::table::incident_integrations::INCIDENT_INTEGRATION_TOKEN_PREFIX)
        })
        .map(|t| t.to_string())
}

#[cfg(feature = "enterprise")]
pub async fn ingest_events(
    Path(org_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok());
    handle_events(org_id, extract_token(auth, None), headers, body).await
}

#[cfg(feature = "enterprise")]
pub async fn ingest_events_url_token(
    Path((org_id, token)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    handle_events(org_id, extract_token(None, Some(&token)), headers, body).await
}

#[cfg(feature = "enterprise")]
async fn handle_events(
    org_id: String,
    token: Option<String>,
    headers: HeaderMap,
    body: serde_json::Value,
) -> Response {
    use o2_enterprise::enterprise::common::config::get_config as o2_config;
    if !o2_config().incidents.enabled {
        return MetaHttpResponse::forbidden("External alert sources not enabled");
    }
    let Some(token) = token else {
        return MetaHttpResponse::not_found("not found"); // never confirm token semantics
    };
    let integration = match infra::table::incident_integrations::find_by_token(&token).await {
        Ok(Some(i)) if i.org_id == org_id => i,
        Ok(_) => return MetaHttpResponse::not_found("not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let now = chrono::Utc::now().timestamp_micros();
    let ua = headers.get("user-agent").and_then(|v| v.to_str().ok());
    let detected = if integration.source_type == "auto" {
        openobserve_core::alerts::external_alerts::detect_source(ua, &body)
    } else {
        // explicit source_type pins the parser
        match integration.source_type.as_str() {
            "grafana" => openobserve_core::alerts::external_alerts::DetectedSource::Grafana,
            "alertmanager" => {
                openobserve_core::alerts::external_alerts::DetectedSource::Alertmanager
            }
            _ => openobserve_core::alerts::external_alerts::DetectedSource::Generic,
        }
    };

    let events = match openobserve_core::alerts::external_alerts::normalize(detected, &body, now) {
        Ok(evs) => evs,
        Err(reason) => {
            let _ = infra::table::incident_integrations::touch_sender(
                infra::table::incident_integrations::TouchSenderParams {
                    integration_id: &integration.id,
                    detected_source: detected.as_str(),
                    sender_label: None,
                    now,
                    accepted: 0,
                    rejected: 1,
                    saw_resolved: false,
                },
            )
            .await;
            return MetaHttpResponse::bad_request(reason);
        }
    };
    if events.len() > MAX_ALERTS_PER_REQUEST {
        return MetaHttpResponse::bad_request(format!(
            "too many alerts in one request: {} > {MAX_ALERTS_PER_REQUEST}",
            events.len()
        )); // 400; sources should configure max_alerts/grouping
    }

    let base_destinations: Vec<String> = integration.config["destinations"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let (mut accepted, mut rejected, mut saw_resolved) = (0u32, 0u32, false);
    let mut errors: Vec<serde_json::Value> = Vec::new();
    for (i, ev) in events.iter().enumerate() {
        if ev.status == config::meta::alerts::incidents::ExternalAlertStatus::Resolved {
            saw_resolved = true;
        }
        match infra::table::external_alerts::upsert_event(
            &org_id,
            &integration.id,
            detected.as_str(),
            ev,
        )
        .await
        {
            Ok((record, outcome)) => {
                accepted += 1;
                use infra::table::external_alerts::UpsertOutcome::*;
                if matches!(outcome, Inserted | Refreshed | Reopened)
                    && let Err(e) = openobserve_core::alerts::incidents::correlate_external_event(
                        &org_id,
                        &record,
                        base_destinations.clone(),
                    )
                    .await
                {
                    log::warn!(
                        "[external_alerts] correlation failed for {}: {e}",
                        record.id
                    );
                } else if matches!(outcome, ResolvedApplied)
                    && let Err(e) =
                        openobserve_core::alerts::incidents::try_auto_resolve_incident_for_external_alert(
                            &org_id, &record.id,
                        )
                        .await
                {
                    log::warn!(
                        "[external_alerts] auto-resolve check failed for {}: {e}",
                        record.id
                    );
                }
            }
            Err(e) => {
                rejected += 1;
                errors.push(serde_json::json!({"index": i, "reason": e.to_string()}));
            }
        }
    }
    let sender_label = openobserve_core::alerts::external_alerts::derive_sender_label(&events);
    let _ = infra::table::incident_integrations::touch_sender(
        infra::table::incident_integrations::TouchSenderParams {
            integration_id: &integration.id,
            detected_source: detected.as_str(),
            sender_label: sender_label.as_deref(),
            now,
            accepted,
            rejected,
            saw_resolved,
        },
    )
    .await;

    Response::builder()
        .status(axum::http::StatusCode::ACCEPTED)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::json!({"accepted": accepted, "rejected": rejected, "errors": errors})
                .to_string()
                .into(),
        )
        .unwrap()
}

#[cfg(not(feature = "enterprise"))]
pub async fn ingest_events(
    _path: Path<String>,
    _headers: HeaderMap,
    _body: Json<serde_json::Value>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn ingest_events_url_token(
    _path: Path<(String, String)>,
    _headers: HeaderMap,
    _body: Json<serde_json::Value>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_token_prefers_bearer_then_path() {
        assert_eq!(
            extract_token(Some("Bearer o2iat_abc"), None),
            Some("o2iat_abc".to_string())
        );
        assert_eq!(
            extract_token(None, Some("o2iat_path")),
            Some("o2iat_path".to_string())
        );
        assert_eq!(
            extract_token(Some("Bearer o2iat_abc"), Some("o2iat_path")),
            Some("o2iat_abc".to_string())
        );
        assert_eq!(extract_token(Some("Basic xyz"), None), None); // wrong scheme
        assert_eq!(extract_token(Some("Bearer nope_prefix"), None), None); // wrong prefix
        assert_eq!(extract_token(None, None), None);
    }
}
