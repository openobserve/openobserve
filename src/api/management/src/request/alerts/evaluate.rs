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

use axum::{Json, extract::Path, response::Response};
use config::meta::alerts::{
    QueryType,
    alert::{Alert as MetaAlert, AlertTypeFilter},
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_core::alerts::{
    alert,
    dry_run::{self, DryRunError, Schedule},
};
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::alerts::requests::CreateAlertRequestBody,
};

// Name checks are skipped for an unsaved alert; prepare_alert still requires one.
const UNSAVED_NAME: &str = "dry_run";

/// An unsaved alert and the check times to evaluate it at.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct EvaluateAlertRequest {
    /// The body `POST /api/v2/{org_id}/alerts` takes.
    #[schema(inline)]
    pub alert: CreateAlertRequestBody,
    /// End of each check window in microseconds; at most 1,440 run.
    #[serde(default)]
    pub times: Option<Vec<i64>>,
    /// Range form: checks at the alert's own schedule inside `[start, end]` (microseconds).
    #[serde(default)]
    pub start: Option<i64>,
    #[serde(default)]
    pub end: Option<i64>,
    /// Range form: microseconds between checks; defaults to the alert's frequency.
    #[serde(default)]
    pub step: Option<i64>,
}

/// EvaluateAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/evaluate",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EvaluateAlert",
    summary = "Dry-run an unsaved alert",
    description = "Evaluates an unsaved alert at past check times the way the scheduler would: the comparison windows, the function, grouping, Must last, Keep firing for and Notify at most every all apply. It writes no state and sends no notification. Its searches run server-side as the caller. Defaults to every check of the last 24 hours.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder the alert would be created in; the caller needs create access to it"),
    ),
    request_body(content = inline(EvaluateAlertRequest), content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = dry_run::EvaluateResponse),
        (status = 400, description = "Invalid alert or schedule", content_type = "application/json", body = ()),
        (status = 403, description = "The caller cannot search a stream the alert reads", content_type = "application/json", body = ()),
        (status = 404, description = "The stream does not exist", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"}))
    )
)]
pub async fn evaluate_alert(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(request): Json<EvaluateAlertRequest>,
) -> Response {
    let schedule = match schedule_of(&request) {
        Ok(schedule) => schedule,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let alert = match unsaved_alert(request.alert) {
        Ok(alert) => alert,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let prepared = match alert::validate_save(&org_id, None, &alert, true, false).await {
        Ok(prepared) => prepared,
        Err(e) => return e.into(),
    };
    #[cfg(feature = "enterprise")]
    if let Some(denied) = search_denied(&org_id, &user_email.user_id, &prepared).await {
        return denied;
    }
    let checked = dry_run::as_scheduled(&prepared);
    let now = config::utils::time::now_micros();
    let (times, truncated) = match dry_run::check_times(&checked, &schedule, now) {
        Ok(times) => times,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let deadline = tokio::time::Instant::now() + dry_run::DEADLINE;
    let response = dry_run::evaluate(
        &checked,
        prepared.is_real_time,
        times,
        truncated,
        &dry_run::SearchRunner,
        deadline,
    )
    .await;
    MetaHttpResponse::json(response)
}

fn schedule_of(request: &EvaluateAlertRequest) -> Result<Schedule, DryRunError> {
    let ranged = request.start.is_some() || request.end.is_some() || request.step.is_some();
    match (&request.times, ranged) {
        (Some(_), true) => Err(DryRunError::InvalidSchedule(
            "Send either times or start/end/step, not both".to_string(),
        )),
        (Some(times), false) => Ok(Schedule::Times(times.clone())),
        (None, _) => Ok(Schedule::Range {
            start: request.start,
            end: request.end,
            step: request.step,
        }),
    }
}

/// The create payload as an alert with nothing that would be checked for existence or sent.
fn unsaved_alert(body: CreateAlertRequestBody) -> Result<MetaAlert, DryRunError> {
    if matches!(
        body.alert_type,
        Some(AlertTypeFilter::AnomalyDetection | AlertTypeFilter::Composite)
    ) {
        return Err(DryRunError::Unsupported);
    }
    let mut alert: MetaAlert = body.into();
    if alert.query_condition.query_type == QueryType::Slo {
        return Err(DryRunError::Unsupported);
    }
    alert.id = None;
    alert.destinations.clear();
    alert.template = None;
    alert.workflows.clear();
    if alert.name.trim().is_empty() {
        alert.name = UNSAVED_NAME.to_string();
    }
    Ok(alert)
}

/// The stream check saving this alert runs: every source its query can read, PromQL by the engine's
/// own selector names, so a selector with no concrete name is refused for a non-admin.
#[cfg(feature = "enterprise")]
async fn search_denied(org_id: &str, user_id: &str, alert: &MetaAlert) -> Option<Response> {
    use openobserve_core::background_access::{alert_sources, guard_write};

    guard_write(org_id, user_id, &alert_sources(org_id, alert))
        .await
        .err()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(body: serde_json::Value) -> EvaluateAlertRequest {
        let mut value = serde_json::json!({
            "alert": {
                "name": "",
                "stream_type": "logs",
                "stream_name": "app",
                "query_condition": {"type": "custom"},
                "trigger_condition": {"period": 10, "operator": ">=", "threshold": 1, "frequency": 10, "silence": 0},
                "destinations": ["slack"]
            }
        });
        value
            .as_object_mut()
            .unwrap()
            .extend(body.as_object().unwrap().clone());
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn schedule_and_alert_type_rules() {
        let mixed = request(serde_json::json!({"times": [1], "end": 2}));
        assert!(schedule_of(&mixed).is_err());
        let times = request(serde_json::json!({"times": [3, 1]}));
        assert_eq!(schedule_of(&times), Ok(Schedule::Times(vec![3, 1])));
        let range = request(serde_json::json!({"step": 60_000_000}));
        assert!(matches!(
            schedule_of(&range),
            Ok(Schedule::Range {
                step: Some(60_000_000),
                ..
            })
        ));

        let alert = unsaved_alert(request(serde_json::json!({})).alert).unwrap();
        assert_eq!(
            (alert.name.as_str(), alert.destinations.len()),
            (UNSAVED_NAME, 0)
        );
        let mut composite = request(serde_json::json!({})).alert;
        composite.alert_type = Some(AlertTypeFilter::Composite);
        assert_eq!(
            unsaved_alert(composite).unwrap_err(),
            DryRunError::Unsupported
        );
    }

    #[cfg(feature = "enterprise")]
    mod stream_access {
        use axum::{body::to_bytes, http::StatusCode};
        use config::meta::stream::StreamType;
        use openobserve_core::authz::{TypedStream, fake_checker};

        use super::*;

        fn promql_alert(query: &str) -> MetaAlert {
            let mut alert = unsaved_alert(request(serde_json::json!({})).alert).unwrap();
            alert.stream_type = StreamType::Metrics;
            alert.stream_name = "up".to_string();
            alert.query_condition.query_type = QueryType::PromQL;
            alert.query_condition.promql = Some(query.to_string());
            alert
        }

        #[tokio::test]
        async fn dry_run_needs_read_on_every_metric_the_promql_can_read() {
            let user = "evaluate-promql@dry.run";
            fake_checker().grant_read(
                user,
                &TypedStream {
                    org_id: "dry_run_org".to_string(),
                    stream_type: StreamType::Metrics,
                    name: "up".to_string(),
                },
            );
            let cases = [
                ("up", None),
                (
                    "topk(scalar(secret_metric), up)",
                    Some("metrics/secret_metric"),
                ),
                (
                    "holt_winters(secret_metric[5m], 0.5, 0.5)",
                    Some("metrics/secret_metric"),
                ),
                (
                    r#"up + {__name__=~"secret.*"}"#,
                    Some("metric name is required"),
                ),
            ];
            for (query, denied) in cases {
                let resp = search_denied("dry_run_org", user, &promql_alert(query)).await;
                let Some(text) = denied else {
                    assert!(resp.is_none(), "{query} should run");
                    continue;
                };
                let resp = resp.unwrap_or_else(|| panic!("{query} should be refused"));
                assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{query}");
                let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
                let body = String::from_utf8_lossy(&body);
                assert!(body.contains(text), "{query}: {body}");
            }
        }
    }
}
