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

//! Editing a detection in place from its Sigma rule, and previewing a rule over history.

use axum::{
    Json,
    extract::{Path, rejection::JsonRejection},
    response::Response,
};
use config::{meta::stream::StreamType, utils::json::Value};
use futures::{StreamExt, stream};
use o2_enterprise::enterprise::security::{
    audit,
    authoring::{
        self, DetectionEdit, DetectionTiming, PREVIEW_ROWS_PER_WINDOW, PREVIEW_SAMPLE_ROWS,
        PreviewFiring, PreviewWindow,
    },
    detection::LAST_SEEN_COLUMN,
    sigma::{self, catalog, types::SigmaRule},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

use super::{
    guard_stream_reads, marks_siem, security_allowed,
    sigma::{schema_fields, search_rows, stream_source},
};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Pasted rules are hand-written YAML; anything larger is not a rule.
const MAX_RULE_YAML: usize = 256 * 1024;

/// Window searches a preview runs at once.
const PREVIEW_CONCURRENCY: usize = 8;

/// Run interval a preview assumes when the draft names none, the create dialog's default.
const DEFAULT_FREQUENCY_MINUTES: i64 = 15;

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDetectionRequest {
    /// The rule or correlation file, as the author edited it.
    pub rule_yaml: String,
    pub stream: String,
    /// The classifier's source type id; defaults to the one the detection was saved with.
    #[serde(default)]
    pub source_type: Option<String>,
    /// Minutes of data each run reads.
    pub period: i64,
    /// Minutes between runs.
    pub frequency: i64,
    /// Minutes to stay quiet after firing.
    pub silence: i64,
    /// Replaces the notification destinations when set.
    #[serde(default)]
    pub destinations: Option<Vec<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdatedDetection {
    pub id: String,
    pub name: String,
    pub stream: String,
    pub sql: String,
    pub period: i64,
    pub frequency: i64,
    pub silence: i64,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct DetectionPreviewRequest {
    /// A pasted rule or correlation file; takes precedence over `rule_id`.
    #[serde(default)]
    pub rule_yaml: Option<String>,
    /// A catalog rule's key.
    #[serde(default)]
    pub rule_id: Option<String>,
    #[serde(default)]
    pub source_type: Option<String>,
    pub stream: String,
    /// History to evaluate: 60, 1440 or 10080 minutes.
    pub range_minutes: i64,
    /// The draft's look-back in minutes; a correlation's is at least its timespan.
    #[serde(default)]
    pub period: Option<i64>,
    /// The draft's run interval in minutes, which sets how far apart windows start.
    #[serde(default)]
    pub frequency: Option<i64>,
    /// The saved detection being previewed, so its own exceptions apply; a draft has none.
    #[serde(default)]
    pub alert_id: Option<String>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct DetectionPreviewResponse {
    /// The range the windows actually covered, in microseconds; may start later than requested.
    pub range_start: i64,
    pub range_end: i64,
    pub requested_minutes: i64,
    pub correlation: bool,
    /// Width of each window, the correlation's timespan; the whole range for a single-event rule.
    pub window_minutes: i64,
    /// How far apart windows start; 0 for a single-event rule.
    pub stride_minutes: i64,
    pub windows_evaluated: usize,
    /// Windows whose search failed; their matches are missing from the counts.
    pub windows_failed: usize,
    /// Firings the scheduler would have raised; for a single-event rule, the matching events.
    pub firings: usize,
    /// Windows that fired, newest first.
    pub windows: Vec<PreviewWindow>,
    /// The newest firings with their window.
    pub sample: Vec<PreviewFiring>,
    /// The SQL each window ran.
    pub sql: String,
    /// Why the rule cannot run on the stream, when it cannot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// UpdateSecurityDetection
#[utoipa::path(
    put,
    path = "/{org_id}/security/detections/{alert_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "UpdateSecurityDetection",
    summary = "Edit a detection's Sigma rule, stream and schedule in place",
    description = "Recompiles the edited Sigma rule on the stream and saves its SQL, stream, schedule and Sigma attributes together, so the stored rule and the query it runs never diverge. The detection keeps its name, history and cases.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "The detection's alert id"),
    ),
    request_body(content = UpdateDetectionRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The saved detection", content_type = "application/json", body = UpdatedDetection),
        (status = 400, description = "The rule does not parse or cannot run on the stream", content_type = "application/json"),
        (status = 403, description = "Needs the Security write grant and the alert's update permission", content_type = "application/json"),
        (status = 404, description = "Detection not found", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn update_detection(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<UpdateDetectionRequest>, JsonRejection>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "POST").await {
        return MetaHttpResponse::forbidden(
            "Editing detections needs the Security write permission",
        );
    }
    let Json(req) = match body {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e.body_text()),
    };
    if req.rule_yaml.len() > MAX_RULE_YAML {
        return MetaHttpResponse::bad_request("rule_yaml is too large");
    }
    let stream = req.stream.trim().to_string();
    if stream.is_empty() {
        return MetaHttpResponse::bad_request("A detection needs a stream");
    }
    let Ok(id) = alert_id.parse::<Ksuid>() else {
        return MetaHttpResponse::not_found(format!("No detection {alert_id}"));
    };
    let conn = infra::db::get_orm_client_ro().await;
    let (folder, mut alert) =
        match openobserve_core::alerts::alert::get_by_id(conn, &org_id, id).await {
            Ok((folder, alert)) if marks_siem(alert.context_attributes.as_ref()) => (folder, alert),
            _ => return MetaHttpResponse::not_found(format!("No detection {alert_id}")),
        };
    if let Err(resp) = guard_alert_update(&org_id, &user_id, &alert_id, &folder.folder_id).await {
        return resp;
    }
    if let Err(resp) = guard_stream_reads(&org_id, &user_id, [stream.as_str()]).await {
        return resp;
    }
    let rule = match sigma::parse_any(&req.rule_yaml) {
        Ok(rule) => rule,
        Err(e) => return MetaHttpResponse::bad_request(format!("The rule does not parse: {e}")),
    };
    let source_type = req
        .source_type
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            alert
                .context_attributes
                .as_ref()
                .and_then(|a| a.get("source_type").cloned())
        })
        .unwrap_or_default();
    let source = stream_source(&org_id, &stream, Some(&source_type)).await;
    let (fields, field_types) = match infra::schema::get(&org_id, &stream, StreamType::Logs).await {
        Ok(schema) => schema_fields(&schema),
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "Failed to read the stream schema: {e}"
            ));
        }
    };
    let result = sigma::compile_rule(
        &rule,
        source.as_ref(),
        &stream,
        &fields,
        field_types.as_ref(),
    );
    let sql = match (&result.correlation, &result.sql) {
        (Some(c), _) if c.runnable => c.sql.clone(),
        (Some(c), _) => return MetaHttpResponse::bad_request(c.reason.clone()),
        (None, Some(sql)) => sql.clone(),
        (None, None) => {
            return MetaHttpResponse::bad_request(
                sigma::not_runnable_reason(&result.compiled)
                    .unwrap_or_else(|| "The rule cannot run on this stream".to_string()),
            );
        }
    };
    let timing = match DetectionTiming::new(
        req.period,
        req.frequency,
        req.silence,
        rule.correlation.as_ref().map(|c| c.timespan_minutes),
    ) {
        Ok(timing) => timing,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let catalog_rule = sigma::catalog_rule(&rule);
    authoring::apply_edit(
        &mut alert,
        DetectionEdit {
            rule: &catalog_rule,
            yaml: &req.rule_yaml,
            stream: &stream,
            source_type: source
                .as_ref()
                .map(|s| s.id.as_str())
                .unwrap_or(&source_type),
            sql: sql.clone(),
            correlation: result.correlation.as_ref(),
            timing,
        },
    );
    if let Some(destinations) = req.destinations {
        alert.destinations = destinations;
    }
    alert.last_edited_by = Some(user_id.clone());
    if let Err(resp) = super::validate_detection(&org_id, None, &alert).await {
        return resp;
    }
    audit::mark();
    let conn = infra::db::get_orm_client_rw().await;
    match openobserve_core::alerts::alert::update(conn, &org_id, None, alert).await {
        Ok(saved) => MetaHttpResponse::json(UpdatedDetection {
            id: alert_id,
            name: saved.name,
            stream: saved.stream_name,
            sql,
            period: timing.period_minutes,
            frequency: timing.frequency_minutes,
            silence: timing.silence_minutes,
        }),
        Err(e) => MetaHttpResponse::bad_request(e.to_string()),
    }
}

/// PreviewSecurityDetection
#[utoipa::path(
    post,
    path = "/{org_id}/security/detections/preview",
    context_path = "/api",
    tag = "Security",
    operation_id = "PreviewSecurityDetection",
    summary = "Run a draft detection over history the way the scheduler would",
    description = "Compiles the rule for the stream and evaluates it over the last hour, day or week: a correlation in the scheduler's own sliding windows with its de-duplication, a single-event rule over the whole range. Reports the firings per window and the exact range evaluated. Read-only",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = DetectionPreviewRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DetectionPreviewResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 404, description = "Rule not found", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn preview_detection(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<DetectionPreviewRequest>, JsonRejection>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "GET").await {
        return MetaHttpResponse::forbidden("Previewing detections needs the Security permission");
    }
    let Json(req) = match body {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e.body_text()),
    };
    if req
        .rule_yaml
        .as_ref()
        .is_some_and(|y| y.len() > MAX_RULE_YAML)
    {
        return MetaHttpResponse::bad_request("rule_yaml is too large");
    }
    let range_us = match authoring::preview_range_us(req.range_minutes) {
        Ok(us) => us,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let stream = req.stream.trim().to_string();
    if stream.is_empty() {
        return MetaHttpResponse::bad_request("A preview needs a stream");
    }
    if let Err(resp) = guard_stream_reads(&org_id, &user_id, [stream.as_str()]).await {
        return resp;
    }
    let rule: SigmaRule = match (&req.rule_yaml, &req.rule_id) {
        (Some(yaml), _) => match sigma::parse_any(yaml) {
            Ok(rule) => rule,
            Err(e) => {
                return MetaHttpResponse::bad_request(format!("The rule does not parse: {e}"));
            }
        },
        (None, Some(id)) => match catalog::detection_catalog().iter().find(|r| r.key() == id) {
            Some(rule) => rule.clone(),
            None => return MetaHttpResponse::not_found(format!("No catalog rule {id}")),
        },
        (None, None) => return MetaHttpResponse::bad_request("Name a rule_id or send rule_yaml"),
    };
    let source = stream_source(&org_id, &stream, req.source_type.as_deref()).await;
    let (fields, field_types) = match infra::schema::get(&org_id, &stream, StreamType::Logs).await {
        Ok(schema) => schema_fields(&schema),
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "Failed to read the stream schema: {e}"
            ));
        }
    };
    let result = sigma::compile_rule(
        &rule,
        source.as_ref(),
        &stream,
        &fields,
        field_types.as_ref(),
    );
    let end = config::utils::time::now_micros();
    let start = end - range_us;
    let settings = db::organization::read_org_setting(&org_id, |s| s.security_tuning.shared())
        .await
        .unwrap_or_default();
    let tuned = authoring::PreviewTuning::new(
        &settings,
        req.alert_id.as_deref(),
        &rule.logsource,
        source.as_ref().map(|s| s.id.as_str()),
        result
            .correlation
            .as_ref()
            .map(|c| c.group_columns.clone())
            .unwrap_or_default(),
        end,
    );
    let mut out = DetectionPreviewResponse {
        requested_minutes: req.range_minutes,
        correlation: result.correlation.is_some(),
        range_start: start,
        range_end: end,
        ..Default::default()
    };

    if let Some(correlation) = &result.correlation {
        if !correlation.runnable {
            out.error = Some(correlation.reason.clone());
            return MetaHttpResponse::json(out);
        }
        let timespan = correlation.timespan_minutes as i64;
        let period = req.period.unwrap_or(timespan).max(timespan);
        let frequency = req
            .frequency
            .filter(|f| *f > 0)
            .unwrap_or(DEFAULT_FREQUENCY_MINUTES)
            .min(period);
        let windows = authoring::preview_windows(Some(correlation), period, frequency, start, end);
        out.window_minutes = timespan;
        out.stride_minutes = match windows.as_slice() {
            [a, b, ..] => (b.0 - a.0) / 60_000_000,
            _ => 0,
        };
        out.windows_evaluated = windows.len();
        out.range_start = windows.first().map(|w| w.0).unwrap_or(start);
        out.sql = correlation.sql.clone();
        let tuned_sql = tuned.sql(&correlation.sql, &stream, &fields);
        let searches = windows.into_iter().map(|(from, to)| {
            let (org_id, user_id, stream, sql) = (&org_id, &user_id, &stream, &tuned_sql);
            async move {
                let rows = search_rows(
                    org_id,
                    user_id,
                    stream,
                    sql.clone(),
                    from,
                    to,
                    PREVIEW_ROWS_PER_WINDOW as i64,
                )
                .await;
                ((from, to), rows)
            }
        });
        let ran: Vec<_> = stream::iter(searches)
            .buffered(PREVIEW_CONCURRENCY)
            .collect()
            .await;
        out.windows_failed = ran.iter().filter(|(_, rows)| rows.is_none()).count();
        let results = ran
            .into_iter()
            .map(|(window, rows)| {
                let mut rows = objects(rows.unwrap_or_default());
                rows.retain(|row| !tuned.drops(row));
                (window, rows)
            })
            .collect();
        // An ungrouped threshold is one group, so only its newest event tells two firings apart.
        let group_by = if correlation.group_columns.is_empty() {
            vec![LAST_SEEN_COLUMN.to_string()]
        } else {
            correlation.group_columns.clone()
        };
        let outcome = authoring::simulate(results, &group_by);
        out.firings = outcome.firings;
        out.windows = outcome.windows;
        out.sample = outcome.sample;
        return MetaHttpResponse::json(out);
    }

    let Some(sql) = result.sql.clone() else {
        out.error = Some(
            sigma::not_runnable_reason(&result.compiled)
                .unwrap_or_else(|| "The rule cannot run on this stream".to_string()),
        );
        return MetaHttpResponse::json(out);
    };
    out.window_minutes = req.range_minutes;
    out.windows_evaluated = 1;
    out.sql = sql.clone();
    // The stored SQL is shown; the search runs it as the scheduler would, with exceptions applied.
    let sql = tuned.sql(&sql, &stream, &fields);
    let count_sql = tuned.sql(
        &format!(
            "SELECT COUNT(*) AS zo_n FROM \"{}\" WHERE {}",
            stream.replace('"', "\"\""),
            result.compiled.where_clause
        ),
        &stream,
        &fields,
    );
    let (rows, count) = futures::join!(
        search_rows(
            &org_id,
            &user_id,
            &stream,
            sql,
            start,
            end,
            PREVIEW_SAMPLE_ROWS as i64
        ),
        search_rows(&org_id, &user_id, &stream, count_sql, start, end, 1),
    );
    let Some(rows) = rows else {
        out.windows_failed = 1;
        return MetaHttpResponse::json(out);
    };
    let mut rows = objects(rows);
    let fetched = rows.len();
    rows.retain(|row| !tuned.drops(row));
    let suppressed = fetched - rows.len();
    // Suppressions match an entity, not SQL, so only the fetched rows can be taken off the count.
    out.firings = count
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|r| r.get("zo_n"))
        .and_then(Value::as_u64)
        .map(|n| (n as usize).saturating_sub(suppressed).max(rows.len()))
        .unwrap_or(rows.len());
    if out.firings > 0 {
        out.windows.push(PreviewWindow {
            start,
            end,
            firings: out.firings,
        });
    }
    out.sample = rows
        .into_iter()
        .map(|row| PreviewFiring {
            window_start: start,
            window_end: end,
            row,
        })
        .collect();
    MetaHttpResponse::json(out)
}

fn objects(rows: Vec<Value>) -> Vec<config::utils::json::Map<String, Value>> {
    rows.into_iter()
        .filter_map(|r| match r {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .collect()
}

/// Refuses a caller who may not update the alert in its folder, as the alert's own route does.
async fn guard_alert_update(
    org_id: &str,
    user_id: &str,
    alert_id: &str,
    folder_id: &str,
) -> Result<(), Response> {
    let allowed = openobserve_core::auth::check_permissions(
        alert_id,
        org_id,
        user_id,
        "alerts",
        "PUT",
        Some(folder_id),
        false,
        true,
        false,
    )
    .await;
    if allowed {
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden("Unauthorized Access"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTHOR: &str = "author@acme.io";

    fn headers() -> Headers<UserEmail> {
        super::super::tests::grant(AUTHOR, &["GET", "POST"]);
        Headers(UserEmail {
            user_id: AUTHOR.to_string(),
        })
    }

    #[tokio::test]
    async fn test_preview_refuses_a_range_it_does_not_offer() {
        let response = preview_detection(
            Path("org".to_string()),
            headers(),
            Ok(Json(DetectionPreviewRequest {
                rule_id: Some("x".to_string()),
                stream: "s".to_string(),
                range_minutes: 5,
                ..Default::default()
            })),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_editing_needs_the_security_write_grant() {
        super::super::tests::grant("viewer@acme.io", &["GET"]);
        let response = update_detection(
            Path(("org".to_string(), "x".to_string())),
            Headers(UserEmail {
                user_id: "viewer@acme.io".to_string(),
            }),
            Ok(Json(UpdateDetectionRequest {
                rule_yaml: "title: x".to_string(),
                stream: "s".to_string(),
                source_type: None,
                period: 15,
                frequency: 15,
                silence: 0,
                destinations: None,
            })),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn test_update_refuses_an_unknown_detection() {
        let response = update_detection(
            Path(("org".to_string(), "not-a-ksuid".to_string())),
            headers(),
            Ok(Json(UpdateDetectionRequest {
                rule_yaml: "title: x".to_string(),
                stream: "s".to_string(),
                source_type: None,
                period: 15,
                frequency: 15,
                silence: 0,
                destinations: None,
            })),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }
}
