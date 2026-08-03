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

//! Admin-facing CRUD for external alert source integrations. Unlike
//! `external_events`, these routes are authenticated and registered in
//! `service_routes()` — auth is enforced by the router's auth middleware,
//! not inside these handlers.

use axum::{Json, extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Allowed values for `source_type` on create.
const ALLOWED_SOURCE_TYPES: &[&str] = &["auto", "grafana", "alertmanager", "generic"];

#[derive(Debug, Deserialize)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub struct CreateIntegrationPayload {
    pub name: String,
    pub source_type: Option<String>,
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub struct SetEnabledPayload {
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub struct IntegrationResponse {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub source_type: String,
    pub token: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub url: String,
}

#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
impl IntegrationResponse {
    fn from_record(
        org_id: &str,
        record: infra::table::incident_integrations::IncidentIntegrationRecord,
    ) -> Self {
        let url = format!("/api/v2/{org_id}/incidents/events/{}", record.token);
        Self {
            id: record.id,
            org_id: record.org_id,
            name: record.name,
            source_type: record.source_type,
            token: record.token,
            enabled: record.enabled,
            config: record.config,
            created_by: record.created_by,
            created_at: record.created_at,
            updated_at: record.updated_at,
            url,
        }
    }
}

#[derive(Debug, Serialize)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub struct ListIntegrationsResponse {
    pub integrations: Vec<IntegrationResponse>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub struct SenderResponse {
    pub integration_id: String,
    pub detected_source: String,
    pub display_name: String,
    pub first_received_at: i64,
    pub last_received_at: i64,
    pub accepted_count: i64,
    pub rejected_count: i64,
    pub resolved_seen: bool,
    pub resolve_wiring_hint: bool,
}

#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
impl From<infra::table::incident_integrations::SenderRecord> for SenderResponse {
    fn from(r: infra::table::incident_integrations::SenderRecord) -> Self {
        let resolve_wiring_hint = r.accepted_count > 0 && !r.resolved_seen;
        let display_name = openobserve_core::alerts::external_alerts::resolve_display_name(
            &r.detected_source,
            r.sender_label.as_deref(),
        );
        Self {
            integration_id: r.integration_id,
            detected_source: r.detected_source,
            display_name,
            first_received_at: r.first_received_at,
            last_received_at: r.last_received_at,
            accepted_count: r.accepted_count,
            rejected_count: r.rejected_count,
            resolved_seen: r.resolved_seen,
            resolve_wiring_hint,
        }
    }
}

/// Validates a create-integration payload: non-empty name (<=100 chars) and
/// an allowed `source_type` (defaulting to "auto" when absent).
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub(crate) fn validate_create(payload: &CreateIntegrationPayload) -> Result<(), String> {
    if payload.name.trim().is_empty() {
        return Err("name cannot be empty".to_string());
    }
    if payload.name.len() > 100 {
        return Err("name cannot exceed 100 characters".to_string());
    }
    if let Some(st) = payload.source_type.as_deref()
        && !ALLOWED_SOURCE_TYPES.contains(&st)
    {
        return Err(format!(
            "source_type must be one of: {}",
            ALLOWED_SOURCE_TYPES.join(", ")
        ));
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
fn gate_enabled() -> Option<Response> {
    use o2_enterprise::enterprise::common::config::get_config as o2_config;
    if !o2_config().incidents.enabled {
        return Some(MetaHttpResponse::forbidden(
            "External alert sources not enabled",
        ));
    }
    None
}

#[cfg(feature = "enterprise")]
pub async fn list_integrations(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }

    if let Err(e) =
        infra::table::incident_integrations::ensure_default_for_org(&org_id, &user_email.user_id)
            .await
    {
        return MetaHttpResponse::internal_error(e);
    }

    match infra::table::incident_integrations::list_by_org(&org_id).await {
        Ok(records) => MetaHttpResponse::json(ListIntegrationsResponse {
            integrations: records
                .into_iter()
                .map(|r| IntegrationResponse::from_record(&org_id, r))
                .collect(),
        }),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
pub async fn create_integration(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(payload): Json<CreateIntegrationPayload>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }
    if let Err(e) = validate_create(&payload) {
        return MetaHttpResponse::bad_request(e);
    }

    let now = chrono::Utc::now().timestamp_micros();
    let record = infra::table::incident_integrations::IncidentIntegrationRecord {
        id: config::ider::uuid(),
        org_id: org_id.clone(),
        name: payload.name,
        source_type: payload.source_type.unwrap_or_else(|| "auto".to_string()),
        token: infra::table::incident_integrations::generate_token(),
        enabled: true,
        config: payload.config.unwrap_or_else(|| serde_json::json!({})),
        created_by: user_email.user_id,
        created_at: now,
        updated_at: now,
    };

    match infra::table::incident_integrations::add(&record).await {
        Ok(()) => MetaHttpResponse::json(IntegrationResponse::from_record(&org_id, record)),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(feature = "enterprise")]
pub async fn set_integration_enabled(
    Path((org_id, integration_id)): Path<(String, String)>,
    Json(payload): Json<SetEnabledPayload>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }

    match infra::table::incident_integrations::set_enabled(
        &org_id,
        &integration_id,
        payload.enabled,
    )
    .await
    {
        Ok(()) => MetaHttpResponse::ok("updated"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
pub async fn rotate_integration_token(
    Path((org_id, integration_id)): Path<(String, String)>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }

    match infra::table::incident_integrations::rotate_token(&org_id, &integration_id).await {
        Ok(token) => MetaHttpResponse::json(serde_json::json!({"token": token})),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
pub async fn delete_integration(
    Path((org_id, integration_id)): Path<(String, String)>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }

    let integration = match infra::table::incident_integrations::list_by_org(&org_id).await {
        Ok(records) => records.into_iter().find(|r| r.id == integration_id),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let Some(integration) = integration else {
        return MetaHttpResponse::not_found("Integration not found");
    };
    if integration.name == infra::table::incident_integrations::DEFAULT_INTEGRATION_NAME {
        return MetaHttpResponse::bad_request(
            "The default alert source cannot be deleted — disable it instead",
        );
    }

    match infra::table::incident_integrations::delete(&org_id, &integration_id).await {
        Ok(true) => MetaHttpResponse::ok("deleted"),
        Ok(false) => MetaHttpResponse::not_found("Integration not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
pub async fn list_integration_senders(
    Path((org_id, integration_id)): Path<(String, String)>,
) -> Response {
    if let Some(resp) = gate_enabled() {
        return resp;
    }

    // Verify the integration belongs to this org before returning sender data.
    let belongs = match infra::table::incident_integrations::list_by_org(&org_id).await {
        Ok(records) => records.iter().any(|r| r.id == integration_id),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    if !belongs {
        return MetaHttpResponse::not_found("Integration not found");
    }

    match infra::table::incident_integrations::list_senders(&integration_id).await {
        Ok(senders) => {
            let senders: Vec<SenderResponse> =
                senders.into_iter().map(SenderResponse::from).collect();
            MetaHttpResponse::json(serde_json::json!({"senders": senders}))
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn list_integrations(_path: Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn create_integration(
    _path: Path<String>,
    _body: Json<CreateIntegrationPayload>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn set_integration_enabled(
    _path: Path<(String, String)>,
    _body: Json<SetEnabledPayload>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn rotate_integration_token(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn list_integration_senders(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
pub async fn delete_integration(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(name: &str, source_type: Option<&str>) -> CreateIntegrationPayload {
        CreateIntegrationPayload {
            name: name.to_string(),
            source_type: source_type.map(String::from),
            config: None,
        }
    }

    #[test]
    fn test_validate_create_rejects_empty_name() {
        assert_eq!(
            validate_create(&payload("", None)),
            Err("name cannot be empty".to_string())
        );
        assert_eq!(
            validate_create(&payload("   ", None)),
            Err("name cannot be empty".to_string())
        );
    }

    #[test]
    fn test_validate_create_rejects_long_name() {
        let long_name = "a".repeat(101);
        assert!(validate_create(&payload(&long_name, None)).is_err());
        let ok_name = "a".repeat(100);
        assert!(validate_create(&payload(&ok_name, None)).is_ok());
    }

    #[test]
    fn test_validate_create_rejects_bad_source_type() {
        assert!(validate_create(&payload("n", Some("bogus"))).is_err());
    }

    #[test]
    fn test_validate_create_accepts_allowed_source_types() {
        for st in ALLOWED_SOURCE_TYPES {
            assert!(validate_create(&payload("n", Some(st))).is_ok());
        }
    }

    #[test]
    fn test_validate_create_defaults_source_type_none_ok() {
        assert!(validate_create(&payload("n", None)).is_ok());
    }

    #[test]
    fn test_create_payload_deserializes() {
        let json = r#"{"name":"grafana-prod","source_type":"grafana","config":{"destinations":["slack"]}}"#;
        let p: CreateIntegrationPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.name, "grafana-prod");
        assert_eq!(p.source_type.as_deref(), Some("grafana"));
        assert_eq!(p.config.unwrap()["destinations"][0], "slack");
    }

    #[test]
    fn test_create_payload_optional_fields_absent() {
        let json = r#"{"name":"minimal"}"#;
        let p: CreateIntegrationPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.name, "minimal");
        assert!(p.source_type.is_none());
        assert!(p.config.is_none());
    }

    #[test]
    fn test_set_enabled_payload_round_trip() {
        let json = r#"{"enabled":false}"#;
        let p: SetEnabledPayload = serde_json::from_str(json).unwrap();
        assert!(!p.enabled);
    }

    #[test]
    fn test_sender_response_resolve_wiring_hint_true_when_accepted_but_unresolved() {
        let r = infra::table::incident_integrations::SenderRecord {
            integration_id: "i1".into(),
            detected_source: "grafana".into(),
            first_received_at: 1,
            last_received_at: 2,
            accepted_count: 5,
            rejected_count: 0,
            resolved_seen: false,
            sender_label: None,
        };
        let resp: SenderResponse = r.into();
        assert!(resp.resolve_wiring_hint);
    }

    #[test]
    fn test_sender_response_resolve_wiring_hint_false_when_resolved_seen() {
        let r = infra::table::incident_integrations::SenderRecord {
            integration_id: "i1".into(),
            detected_source: "grafana".into(),
            first_received_at: 1,
            last_received_at: 2,
            accepted_count: 5,
            rejected_count: 0,
            resolved_seen: true,
            sender_label: None,
        };
        let resp: SenderResponse = r.into();
        assert!(!resp.resolve_wiring_hint);
    }

    #[test]
    fn test_sender_response_resolve_wiring_hint_false_when_no_accepted() {
        let r = infra::table::incident_integrations::SenderRecord {
            integration_id: "i1".into(),
            detected_source: "grafana".into(),
            first_received_at: 1,
            last_received_at: 2,
            accepted_count: 0,
            rejected_count: 3,
            resolved_seen: false,
            sender_label: None,
        };
        let resp: SenderResponse = r.into();
        assert!(!resp.resolve_wiring_hint);
    }

    #[test]
    fn test_sender_response_display_name_uses_label_when_present() {
        let record = infra::table::incident_integrations::SenderRecord {
            integration_id: "int-1".to_string(),
            detected_source: "generic".to_string(),
            sender_label: Some("solarwinds".to_string()),
            first_received_at: 1,
            last_received_at: 2,
            accepted_count: 3,
            rejected_count: 0,
            resolved_seen: false,
        };
        let response = SenderResponse::from(record);
        assert_eq!(response.display_name, "solarwinds");
        assert_eq!(response.detected_source, "generic");
    }

    #[test]
    fn test_sender_response_display_name_falls_back_to_detected_source() {
        let record = infra::table::incident_integrations::SenderRecord {
            integration_id: "int-1".to_string(),
            detected_source: "grafana".to_string(),
            sender_label: None,
            first_received_at: 1,
            last_received_at: 2,
            accepted_count: 3,
            rejected_count: 0,
            resolved_seen: false,
        };
        let response = SenderResponse::from(record);
        assert_eq!(response.display_name, "grafana");
    }
}
