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

//! Security case triage: lifecycle settings, each detection's open case, and promotion.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::alerts::incidents::IncidentSeverity;
use o2_enterprise::enterprise::security::{
    audit,
    cases::{AttachedFiring, CaseSettings, most_severe, sigma_severity},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::{IntoParams, ToSchema};

use super::{guard_siem_case, security_allowed};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const MAX_LOOKUP_IDS: usize = 500;
const MAX_PROMOTED_FIRINGS: usize = 100;
const MAX_CASE_TITLE_CHARS: usize = 255;
const MAX_EVENT_FIELDS: usize = 500;

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct CaseLookupQuery {
    /// Comma-separated detection ids.
    pub alert_ids: String,
}

/// The open case a detection currently fires into.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct CaseRef {
    pub id: String,
    pub title: Option<String>,
    pub status: String,
    pub severity: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CaseLookupResponse {
    /// Open case by detection id; detections with no open case are absent.
    pub cases: HashMap<String, CaseRef>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PromoteFiring {
    pub alert_id: String,
    /// When the detection fired, in microseconds.
    pub fired_at: i64,
}

/// One event to open a case from, as the Events page shows it.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PromoteEvent {
    pub stream: String,
    /// The event's `_timestamp`, in microseconds.
    pub timestamp: i64,
    /// The event's fields; its host, user or source address becomes the case's entity.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PromoteRequest {
    #[serde(default)]
    pub firings: Vec<PromoteFiring>,
    /// Open the case from this event instead of from firings.
    #[serde(default)]
    pub event: Option<PromoteEvent>,
    /// Attach to this open case instead of opening a new one.
    #[serde(default)]
    pub case_id: Option<String>,
    /// Title of a new case; defaults to the first detection's title.
    #[serde(default)]
    pub title: Option<String>,
}

/// GetCaseSettings
#[utoipa::path(
    get,
    path = "/{org_id}/security/cases/settings",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetCaseSettings",
    summary = "Security case lifecycle settings",
    description = "When security cases close on their own and how long firings on the same host or user keep joining one case",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CaseSettings),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_case_settings(Path(org_id): Path<String>) -> Response {
    match db::organization::read_org_setting(&org_id, |s| s.security_cases).await {
        Ok(settings) => MetaHttpResponse::json(settings),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// UpdateCaseSettings
#[utoipa::path(
    put,
    path = "/{org_id}/security/cases/settings",
    context_path = "/api",
    tag = "Security",
    operation_id = "UpdateCaseSettings",
    summary = "Update security case lifecycle settings",
    description = "Sets the days without a firing after which a case closes on its own (0 never closes one) and the entity grouping window in minutes (0 opens one case per detection). Needs the Security admin grant.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CaseSettings, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CaseSettings),
        (status = 400, description = "Out of range", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security admin grant", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn update_case_settings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(settings): Json<CaseSettings>,
) -> Response {
    if let Err(msg) = settings.validate() {
        return MetaHttpResponse::bad_request(msg);
    }
    if !security_allowed(&org_id, &user_email.user_id, "DELETE").await {
        return MetaHttpResponse::forbidden("Case settings need the Security admin permission");
    }
    audit::mark();
    match db::organization::update_org_setting(&org_id, move |data| {
        data.security_cases = settings;
        true
    })
    .await
    {
        Ok(_) => MetaHttpResponse::json(settings),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// LookupSecurityCases
#[utoipa::path(
    get,
    path = "/{org_id}/security/cases/by_alert",
    context_path = "/api",
    tag = "Security",
    operation_id = "LookupSecurityCases",
    summary = "The open case of each detection",
    description = "For each SIEM detection id, the open case it currently fires into",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), CaseLookupQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CaseLookupResponse),
        (status = 400, description = "Too many ids", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn lookup_cases(
    Path(org_id): Path<String>,
    Query(query): Query<CaseLookupQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(resp) = guard_siem_case(&org_id, &user_email.user_id, "GET", true).await {
        return resp;
    }
    let requested = parse_ids(&query.alert_ids);
    if requested.len() > MAX_LOOKUP_IDS {
        return MetaHttpResponse::bad_request(format!("At most {MAX_LOOKUP_IDS} alert ids"));
    }
    let mut cases = HashMap::new();
    for alert_id in requested {
        if !super::is_siem_alert(&org_id, &alert_id).await {
            continue;
        }
        match infra::table::alert_incidents::find_open_incident_containing_alert(&org_id, &alert_id)
            .await
        {
            Ok(Some(case)) => {
                cases.insert(
                    alert_id,
                    CaseRef {
                        id: case.id,
                        title: case.title,
                        status: case.status,
                        severity: case.severity,
                    },
                );
            }
            Ok(None) => {}
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    }
    MetaHttpResponse::json(CaseLookupResponse { cases })
}

/// PromoteToSecurityCase
#[utoipa::path(
    post,
    path = "/{org_id}/security/cases",
    context_path = "/api",
    tag = "Security",
    operation_id = "PromoteToSecurityCase",
    summary = "Open a case from detection firings or an event, or add them to an open case",
    description = "Every firing must come from a SIEM detection. With `case_id` the firings join that open security case, raising its priority when one is more severe; without it a new case opens at the most severe firing's Sigma level. With `event` instead of firings, the case opens on the host, user or address the event names and spans the event's time. The case's timeline records who did it.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = PromoteRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The case", content_type = "application/json", body = config::meta::alerts::incidents::Incident),
        (status = 400, description = "Invalid firings or case", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security triage grant", content_type = "application/json", body = ()),
        (status = 404, description = "Case not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn promote_to_case(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<PromoteRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard_siem_case(&org_id, &user_id, "PUT", true).await {
        return resp;
    }
    let title = req.title.as_deref().map(str::trim).unwrap_or_default();
    if title.chars().count() > MAX_CASE_TITLE_CHARS {
        return MetaHttpResponse::bad_request(format!(
            "Title cannot exceed {MAX_CASE_TITLE_CHARS} characters"
        ));
    }
    if let Some(event) = req.event {
        return promote_event(&org_id, &user_id, req.case_id.as_deref(), title, event).await;
    }
    if req.firings.is_empty() || req.firings.len() > MAX_PROMOTED_FIRINGS {
        return MetaHttpResponse::bad_request(format!(
            "Send between 1 and {MAX_PROMOTED_FIRINGS} firings"
        ));
    }

    let client = infra::db::get_orm_client_ro().await;
    let mut firings = Vec::with_capacity(req.firings.len());
    let mut severity: Option<IncidentSeverity> = None;
    let mut first_title = None;
    for firing in &req.firings {
        let detection = match firing.alert_id.parse::<Ksuid>() {
            Ok(id) if super::is_siem_alert(&org_id, &firing.alert_id).await => {
                db::alerts::alert::get_by_id(client, &org_id, id).await
            }
            _ => Ok(None),
        };
        let alert = match detection {
            Ok(Some((_, alert))) => alert,
            Ok(None) => {
                return MetaHttpResponse::bad_request(format!(
                    "{} is not a Security detection",
                    firing.alert_id
                ));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        let attrs = alert.context_attributes.as_ref();
        let level = attrs
            .and_then(|a| a.get("sigma_level"))
            .and_then(|l| sigma_severity(l));
        severity = most_severe(severity, level);
        first_title.get_or_insert_with(|| {
            attrs
                .and_then(|a| a.get("sigma_title"))
                .filter(|t| !t.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| alert.name.clone())
        });
        firings.push(AttachedFiring {
            alert_id: firing.alert_id.clone(),
            alert_name: alert.name,
            fired_at: firing.fired_at,
        });
    }

    if let Some(case_id) = req.case_id.as_deref()
        && let Err(resp) = open_security_case(&org_id, case_id).await
    {
        return resp;
    }

    let title = match (title.is_empty(), first_title) {
        (false, _) => title.to_string(),
        (true, Some(rule)) if req.firings.len() > 1 => {
            format!("{rule} (+{} more)", req.firings.len() - 1)
        }
        (true, rule) => rule.unwrap_or_default(),
    };
    audit::mark();
    match openobserve_core::alerts::incidents::attach_firings_to_case(
        &org_id,
        req.case_id.as_deref(),
        &title,
        severity.unwrap_or_default(),
        &firings,
        &user_id,
    )
    .await
    {
        Ok(case) => MetaHttpResponse::json(case),
        Err(e) if e.to_string().contains("not found") => {
            MetaHttpResponse::not_found("Incident not found")
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// Opens a case from one event, or adds the event to an open case.
async fn promote_event(
    org_id: &str,
    user_id: &str,
    case_id: Option<&str>,
    title: &str,
    event: PromoteEvent,
) -> Response {
    let stream = event.stream.trim();
    if stream.is_empty() || event.timestamp <= 0 {
        return MetaHttpResponse::bad_request("An event needs its stream and timestamp");
    }
    if event.fields.len() > MAX_EVENT_FIELDS {
        return MetaHttpResponse::bad_request(format!(
            "An event can carry at most {MAX_EVENT_FIELDS} fields"
        ));
    }
    if let Err(resp) = super::guard_stream_reads(org_id, user_id, [stream]).await {
        return resp;
    }
    if let Some(case_id) = case_id
        && let Err(resp) = open_security_case(org_id, case_id).await
    {
        return resp;
    }
    let event = openobserve_core::alerts::incidents::CaseEvent {
        stream: stream.to_string(),
        at: event.timestamp,
        fields: event.fields,
    };
    audit::mark();
    match openobserve_core::alerts::incidents::attach_event_to_case(
        org_id,
        case_id,
        (!title.is_empty()).then_some(title),
        &event,
        user_id,
    )
    .await
    {
        Ok(case) => MetaHttpResponse::json(case),
        Err(e) if e.to_string().contains("not found") => {
            MetaHttpResponse::not_found("Incident not found")
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// `Ok` when `case_id` is an unresolved security case of the org.
async fn open_security_case(org_id: &str, case_id: &str) -> Result<(), Response> {
    match infra::table::alert_incidents::get(org_id, case_id).await {
        Ok(Some(case)) if case.status == "resolved" => {
            return Err(MetaHttpResponse::bad_request(
                "Reopen the case before adding to it",
            ));
        }
        Ok(Some(_)) => {}
        Ok(None) => return Err(MetaHttpResponse::not_found("Incident not found")),
        Err(e) => return Err(MetaHttpResponse::internal_error(e)),
    }
    if !super::incident_touches_siem(org_id, case_id).await {
        return Err(MetaHttpResponse::bad_request("Not a Security case"));
    }
    Ok(())
}

/// Distinct, non-empty ids from a comma-separated list, in order.
fn parse_ids(raw: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for id in raw.split(',').map(str::trim).filter(|id| !id.is_empty()) {
        if !ids.iter().any(|seen| seen == id) {
            ids.push(id.to_string());
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ids_drops_blanks_and_repeats() {
        assert_eq!(parse_ids(" a,b,,a , c"), ["a", "b", "c"]);
        assert!(parse_ids("").is_empty());
    }

    #[tokio::test]
    async fn test_out_of_range_case_settings_are_refused() {
        let response = update_case_settings(
            Path("org".to_string()),
            Headers(UserEmail {
                user_id: "a@acme.io".to_string(),
            }),
            Json(CaseSettings {
                auto_close_days: 400,
                group_window_minutes: 60,
            }),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }
}
