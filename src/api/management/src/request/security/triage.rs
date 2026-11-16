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

//! Security case queue work: search across every page, bulk triage and merging.

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::alerts::incidents::{CaseVerdict, Incident, IncidentEvent, IncidentSeverity};
use infra::table::{alert_incidents::CaseSearch, entity::alert_incidents};
use o2_enterprise::enterprise::security::{audit, cases, tuning::MAX_TRIAGE_SUPPRESSION_MINUTES};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::guard_siem_case;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Most cases one search reads before text matching; older ones need a narrower filter.
const SEARCH_SCAN_CAP: u64 = 5000;
/// Most ids "select all matching" returns, and most cases one bulk action touches.
pub const MAX_BULK_CASES: usize = 1000;
pub const MAX_MERGE_SOURCES: usize = 100;
const MAX_PAGE_SIZE: usize = 500;
const UNASSIGNED: &str = "none";
/// Why a bulk close left a case open.
const HIGH_PRIORITY: &str = "high_priority";

#[derive(Debug, Default, Deserialize, IntoParams, ToSchema)]
#[serde(default)]
pub struct CaseSearchQuery {
    /// Comma-separated: `open`, `acknowledged`, `resolved`.
    pub status: Option<String>,
    /// Comma-separated: `P1`..`P4`.
    pub priority: Option<String>,
    /// Comma-separated detection ids; cases any of them fired into.
    pub alert_id: Option<String>,
    /// Matches the case's host, user or address.
    pub entity: Option<String>,
    /// An assignee's email, or `none` for unassigned cases.
    pub assignee: Option<String>,
    /// Matches title, id, assignee and entities.
    pub q: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    /// Also return every matching id, up to the bulk cap.
    pub select_all: Option<bool>,
}

/// One entity a case is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct CaseEntity {
    /// `host`, `user` or `ip`.
    pub kind: String,
    pub value: String,
}

/// A case as the queue lists it: the incident plus the entities it is about.
#[derive(Debug, Serialize, ToSchema)]
pub struct CaseSearchItem {
    #[serde(flatten)]
    pub incident: Incident,
    /// The case's key entity; `None` for a rolled-up case.
    pub entity: Option<String>,
    /// `host`, `user` or `ip`.
    pub entity_kind: Option<String>,
    /// Every entity the case holds, its key first.
    pub entities: Vec<CaseEntity>,
    /// Distinct detections that fired into the case.
    pub detections: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CaseSearchResponse {
    pub incidents: Vec<CaseSearchItem>,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    /// More cases matched than the search reads or `ids` holds.
    pub capped: bool,
    /// Detections with cases under every filter but `alert_id`, most cases first.
    pub detection_facets: Vec<DetectionFacet>,
}

/// One detection the case filter can pick, with how many matching cases it fired into.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DetectionFacet {
    pub alert_id: String,
    pub alert_name: String,
    /// The detection's rule title; its name when the detection is gone.
    pub title: String,
    pub count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BulkAction {
    Close,
    Assign,
    Priority,
    Status,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkRequest {
    pub ids: Vec<String>,
    pub action: BulkAction,
    #[serde(default)]
    pub verdict: Option<CaseVerdict>,
    #[serde(default)]
    pub reason: Option<String>,
    /// Empty unassigns.
    #[serde(default)]
    pub assigned_to: Option<String>,
    #[serde(default)]
    pub severity: Option<IncidentSeverity>,
    /// `open` or `acknowledged`; closing goes through `close`.
    #[serde(default)]
    pub status: Option<String>,
    /// Closing skips P1 and P2 cases unless this is set.
    #[serde(default)]
    pub include_high: bool,
    /// Benign close only: also suppress similar firings for this many minutes.
    #[serde(default)]
    pub suppress_minutes: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BulkFailure {
    pub id: String,
    pub error: String,
}

/// A P1 or P2 case a close left open because the request did not include high priorities.
#[derive(Debug, Serialize, ToSchema)]
pub struct BulkSkip {
    pub id: String,
    pub priority: String,
    pub entity: Option<String>,
    /// `high_priority`.
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BulkOutcome {
    Updated,
    Failed,
    Skipped,
}

/// One case's outcome, in request order.
#[derive(Debug, Serialize, ToSchema)]
pub struct BulkResult {
    pub id: String,
    pub outcome: BulkOutcome,
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct BulkResponse {
    pub updated: Vec<String>,
    pub failed: Vec<BulkFailure>,
    pub skipped: Vec<BulkSkip>,
    pub results: Vec<BulkResult>,
}

impl BulkResponse {
    fn record(&mut self, id: String, priority: Option<String>, outcome: Result<(), String>) {
        let (kind, error) = match outcome {
            Ok(()) => {
                self.updated.push(id.clone());
                (BulkOutcome::Updated, None)
            }
            Err(error) => {
                self.failed.push(BulkFailure {
                    id: id.clone(),
                    error: error.clone(),
                });
                (BulkOutcome::Failed, Some(error))
            }
        };
        self.results.push(BulkResult {
            id,
            outcome: kind,
            priority,
            error,
        });
    }

    fn skip(&mut self, id: String, priority: String, entity: Option<String>) {
        self.results.push(BulkResult {
            id: id.clone(),
            outcome: BulkOutcome::Skipped,
            priority: Some(priority.clone()),
            error: None,
        });
        self.skipped.push(BulkSkip {
            id,
            priority,
            entity,
            reason: HIGH_PRIORITY.to_string(),
        });
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeRequest {
    pub target_id: String,
    pub source_ids: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// One bulk change, checked once before it runs on every case.
enum Change {
    Close(CaseVerdict, String),
    Assign(Option<String>),
    Priority(IncidentSeverity),
    Status(String),
}

/// SearchSecurityCases
#[utoipa::path(
    get,
    path = "/{org_id}/security/cases/search",
    context_path = "/api",
    tag = "Security",
    operation_id = "SearchSecurityCases",
    summary = "Search security cases across every page",
    description = "Filters the org's security cases by status, priority, detection, entity, assignee and free text, most recent activity first. With `select_all` it also returns every matching id, up to 1000, for a bulk action.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), CaseSearchQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = CaseSearchResponse),
        (status = 403, description = "Needs the Security read grant", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn search_cases(
    Path(org_id): Path<String>,
    Query(query): Query<CaseSearchQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(resp) = guard_siem_case(&org_id, &user_email.user_id, "GET", true).await {
        return resp;
    }
    let search = CaseSearch {
        statuses: list_param(query.status.as_deref()),
        severities: list_param(query.priority.as_deref())
            .into_iter()
            .map(|p| p.to_ascii_uppercase())
            .collect(),
        alert_ids: list_param(query.alert_id.as_deref()),
        assignee: non_empty(query.assignee.as_deref())
            .map(|a| (!a.eq_ignore_ascii_case(UNASSIGNED)).then_some(a)),
    };
    let rows = match infra::table::alert_incidents::search_security_cases(
        &org_id,
        &search,
        SEARCH_SCAN_CAP,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let scan_capped = rows.len() as u64 >= SEARCH_SCAN_CAP;
    // Without a detection filter the facets count the same rows the page does.
    let matched_all: Vec<alert_incidents::Model> = if search.alert_ids.is_empty() {
        rows.clone()
    } else {
        Vec::new()
    };
    let text = non_empty(query.q.as_deref()).map(|q| q.to_lowercase());
    let entity = non_empty(query.entity.as_deref()).map(|q| q.to_lowercase());
    // Text also matches the detections that fired into a case, read only when text is asked for.
    let mut detection_names = match &text {
        Some(_) => {
            let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
            match infra::table::alert_incidents::get_alert_counts(&ids).await {
                Ok(counts) => counts,
                Err(e) => return MetaHttpResponse::internal_error(e),
            }
        }
        None => Default::default(),
    };
    let matched: Vec<alert_incidents::Model> = rows
        .into_iter()
        .filter(|row| {
            let names: Vec<String> = detection_names
                .remove(&row.id)
                .map(|c| c.groups.into_iter().map(|g| g.alert_name).collect())
                .unwrap_or_default();
            case_matches(row, text.as_deref(), entity.as_deref(), &names)
        })
        .collect();
    let facet_rows = if search.alert_ids.is_empty() {
        None
    } else {
        let unfiltered = CaseSearch {
            alert_ids: Vec::new(),
            ..search.clone()
        };
        match infra::table::alert_incidents::search_security_cases(
            &org_id,
            &unfiltered,
            SEARCH_SCAN_CAP,
        )
        .await
        {
            Ok(rows) => Some(rows),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    };
    let detection_facets = match detection_facets(
        &org_id,
        facet_rows.as_deref().unwrap_or(&matched_all),
        text.as_deref(),
        entity.as_deref(),
    )
    .await
    {
        Ok(facets) => facets,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let total = matched.len();
    let ids = query.select_all.unwrap_or_default().then(|| {
        matched
            .iter()
            .take(MAX_BULK_CASES)
            .map(|c| c.id.clone())
            .collect::<Vec<_>>()
    });
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_PAGE_SIZE);
    let page: Vec<alert_incidents::Model> = matched
        .into_iter()
        .skip(query.offset.unwrap_or_default())
        .take(limit)
        .collect();
    match openobserve_core::alerts::incidents::incidents_with_counts(page).await {
        Ok(incidents) => MetaHttpResponse::json(CaseSearchResponse {
            incidents: incidents.into_iter().map(search_item).collect(),
            total,
            capped: scan_capped || (ids.is_some() && total > MAX_BULK_CASES),
            ids,
            detection_facets,
        }),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// BulkUpdateSecurityCases
#[utoipa::path(
    post,
    path = "/{org_id}/security/cases/bulk",
    context_path = "/api",
    tag = "Security",
    operation_id = "BulkUpdateSecurityCases",
    summary = "Close, assign, re-prioritise or change the status of many security cases",
    description = "Applies one change to up to 1000 security cases and reports each case's outcome. Closing needs a verdict and a reason, and leaves P1 and P2 cases open (in `skipped`) unless `include_high` is set. A benign close with `suppress_minutes` also suppresses similar firings for up to 7 days. Needs the Security triage grant.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = BulkRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Per-case outcome", content_type = "application/json", body = BulkResponse),
        (status = 400, description = "Invalid change", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security triage grant", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn bulk_update(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard_siem_case(&org_id, &user_id, "PUT", true).await {
        return resp;
    }
    let ids = dedup_ids(&req.ids);
    if ids.is_empty() || ids.len() > MAX_BULK_CASES {
        return MetaHttpResponse::bad_request(format!("Send between 1 and {MAX_BULK_CASES} cases"));
    }
    let change = match change_of(&req) {
        Ok(change) => change,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    if let Change::Assign(Some(user)) = &change
        && !matches!(db::user::get(Some(&org_id), user).await, Ok(Some(_)))
    {
        return MetaHttpResponse::bad_request("The assignee is not a member of this org");
    }
    let suppress = match suppression_of(&req) {
        Ok(suppress) => suppress,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    audit::mark();
    let mut out = BulkResponse::default();
    for id in ids {
        let case = match infra::table::alert_incidents::get(&org_id, &id).await {
            Ok(Some(case)) => case,
            Ok(None) => {
                out.record(id, None, Err("Case not found".to_string()));
                continue;
            }
            Err(e) => {
                out.record(id, None, Err(e.to_string()));
                continue;
            }
        };
        let priority = Some(case.severity.clone());
        if held_back(&change, &case, req.include_high) {
            let entity = cases::case_entities(&case.group_values)
                .into_iter()
                .next()
                .map(|(_, value)| value);
            out.skip(id, case.severity, entity);
            continue;
        }
        let was_open = case.status != "resolved";
        let outcome = apply_change(&org_id, case, &change, &user_id).await;
        let outcome = match (&outcome, &change, suppress) {
            (Ok(()), Change::Close(_, reason), Some(minutes)) if was_open => {
                suppress_similar(&org_id, &id, minutes, reason, &user_id).await
            }
            _ => outcome,
        };
        out.record(id, priority, outcome);
    }
    MetaHttpResponse::json(out)
}

/// MergeSecurityCases
#[utoipa::path(
    post,
    path = "/{org_id}/security/cases/merge",
    context_path = "/api",
    tag = "Security",
    operation_id = "MergeSecurityCases",
    summary = "Merge security cases into one",
    description = "Moves every firing of the source cases into the open target case, raises the target to the most urgent priority among them, and closes the sources as duplicates. Needs the Security triage grant.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = MergeRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The merged case", content_type = "application/json", body = Incident),
        (status = 400, description = "Invalid cases", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security triage grant", content_type = "application/json", body = ()),
        (status = 404, description = "Case not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn merge_cases(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<MergeRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if let Err(resp) = guard_siem_case(&org_id, &user_id, "PUT", true).await {
        return resp;
    }
    let target_id = req.target_id.trim().to_string();
    let sources: Vec<String> = dedup_ids(&req.source_ids)
        .into_iter()
        .filter(|id| *id != target_id)
        .collect();
    if target_id.is_empty() || sources.is_empty() || sources.len() > MAX_MERGE_SOURCES {
        return MetaHttpResponse::bad_request(format!(
            "Name a target and between 1 and {MAX_MERGE_SOURCES} other cases"
        ));
    }
    let reason = req.reason.as_deref().map(str::trim).unwrap_or_default();
    if reason.chars().count() > cases::MAX_VERDICT_REASON_CHARS {
        return MetaHttpResponse::bad_request(format!(
            "The reason must be {} characters or fewer",
            cases::MAX_VERDICT_REASON_CHARS
        ));
    }
    let (mut severity, muted) = match security_case(&org_id, &target_id).await {
        Ok(case) if case.status == "resolved" => {
            return MetaHttpResponse::bad_request("Reopen the target case before merging into it");
        }
        Ok(case) => (
            case.severity.parse::<IncidentSeverity>().ok(),
            case.muted_by_downtime_id.is_some(),
        ),
        Err(resp) => return resp,
    };
    let before = severity;
    let mut cases_in = Vec::with_capacity(sources.len());
    for id in &sources {
        match security_case(&org_id, id).await {
            Ok(case) => {
                severity = cases::most_severe(severity, case.severity.parse().ok());
                cases_in.push(case);
            }
            Err(resp) => return resp,
        }
    }
    let target_severity = severity.map(|s| s.to_string());
    audit::mark();
    // Firings, closes and the severity raise commit together; the timeline and acks follow.
    let closed = match infra::table::alert_incidents::merge_cases(
        &org_id,
        &target_id,
        &sources,
        target_severity.as_deref(),
    )
    .await
    {
        Ok(closed) => closed,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let why = if reason.is_empty() {
        format!("Merged into {target_id}")
    } else {
        format!("Merged into {target_id}: {reason}")
    };
    for id in &closed {
        if let Err(e) = openobserve_core::incidents::append_event(
            &org_id,
            id,
            IncidentEvent::resolved(Some(user_id.clone())),
        )
        .await
        {
            log::error!("[SECURITY] could not record the close of merged case {org_id}/{id}: {e}");
        }
        if let Err(e) = close_case(&org_id, id, CaseVerdict::Duplicate, &why, &user_id).await {
            log::error!("[SECURITY] could not finish closing merged case {org_id}/{id}: {e}");
        }
    }
    if let (Some(from), Some(to)) = (before, severity) {
        openobserve_core::alerts::incidents::announce_severity_change(
            &org_id, &target_id, from, to, &user_id, muted,
        )
        .await;
    }
    openobserve_core::alerts::incidents::retitle_merged_case(&org_id, &target_id).await;
    let merged: Vec<String> = cases_in.iter().map(|c| c.id.clone()).collect();
    if let Err(e) = openobserve_core::incidents::append_event(
        &org_id,
        &target_id,
        IncidentEvent::comment(
            &user_id,
            format!("Merged cases {} into this case", merged.join(", ")),
        ),
    )
    .await
    {
        log::error!("[SECURITY] could not record the merge on {org_id}/{target_id}: {e}");
    }
    match openobserve_core::alerts::incidents::get_incident_with_alerts(
        &org_id, &target_id, &user_id,
    )
    .await
    {
        Ok(Some(case)) => MetaHttpResponse::json(case.incident),
        Ok(None) => MetaHttpResponse::not_found("Incident not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// Closes a security case with a verdict on its timeline, ending any acknowledgement.
pub async fn close_case(
    org_id: &str,
    id: &str,
    verdict: CaseVerdict,
    reason: &str,
    user_id: &str,
) -> Result<(), String> {
    use openobserve_core::alerts::{ack, incidents};

    incidents::authorize_status(org_id, id, "resolved", user_id)
        .await
        .map_err(|e| format!("{e:?}"))?;
    incidents::update_status(org_id, id, "resolved", user_id)
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = openobserve_core::incidents::append_event(
        org_id,
        id,
        IncidentEvent::verdict(user_id, verdict, reason.to_string()),
    )
    .await
    {
        log::error!("[SECURITY] could not record the verdict of {org_id}/{id}: {e}");
    }
    let problem = ack::Problem::Incident {
        org_id: org_id.to_string(),
        incident_id: id.to_string(),
    };
    ack::resolve(
        &problem,
        user_id,
        config::meta::alerts::ack::AckSource::Incident,
        None,
    )
    .await
    .map(|_| ())
    .map_err(|e| format!("{e:?}"))
}

/// The org's security case `id`, or the response refusing it.
async fn security_case(org_id: &str, id: &str) -> Result<alert_incidents::Model, Response> {
    match infra::table::alert_incidents::get(org_id, id).await {
        Ok(Some(case)) if case.security_case || super::incident_touches_siem(org_id, id).await => {
            Ok(case)
        }
        Ok(Some(_)) => Err(MetaHttpResponse::bad_request(format!(
            "{id} is not a Security case"
        ))),
        Ok(None) => Err(MetaHttpResponse::not_found(format!("Case {id} not found"))),
        Err(e) => Err(MetaHttpResponse::internal_error(e)),
    }
}

async fn apply_change(
    org_id: &str,
    case: alert_incidents::Model,
    change: &Change,
    user_id: &str,
) -> Result<(), String> {
    use openobserve_core::alerts::incidents;

    let id = case.id.as_str();
    if !case.security_case && !super::incident_touches_siem(org_id, id).await {
        return Err("Not a Security case".to_string());
    }
    match change {
        Change::Close(..) if case.status == "resolved" => Ok(()),
        Change::Close(verdict, reason) => close_case(org_id, id, *verdict, reason, user_id).await,
        Change::Assign(user) => incidents::update_assignee(org_id, id, user.as_deref(), user_id)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        Change::Priority(severity) => {
            incidents::update_severity(org_id, id, &severity.to_string(), user_id)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        Change::Status(status) => {
            incidents::authorize_status(org_id, id, status, user_id)
                .await
                .map_err(|e| format!("{e:?}"))?;
            incidents::update_status(org_id, id, status, user_id)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }
}

/// Suppresses firings like the closed case's; the case is closed either way.
async fn suppress_similar(
    org_id: &str,
    id: &str,
    minutes: u32,
    reason: &str,
    user_id: &str,
) -> Result<(), String> {
    let req = super::tuning::NewSuppression {
        alert_id: None,
        entity_kind: None,
        entity_value: None,
        case_id: Some(id.to_string()),
        duration_minutes: minutes,
        reason: reason.to_string(),
        close_case: false,
    };
    super::tuning::store_suppressions(org_id, &req, user_id)
        .await
        .map(|_| ())
        .map_err(|_| "Closed, but similar firings could not be suppressed".to_string())
}

/// Whether a close leaves this case open: P1 and P2 close only when the request says so.
fn held_back(change: &Change, case: &alert_incidents::Model, include_high: bool) -> bool {
    matches!(change, Change::Close(..))
        && !include_high
        && case.status != "resolved"
        && matches!(case.severity.as_str(), "P1" | "P2")
}

/// The suppression a benign bulk close asks for, or why it is refused.
fn suppression_of(req: &BulkRequest) -> Result<Option<u32>, String> {
    let Some(minutes) = req.suppress_minutes else {
        return Ok(None);
    };
    if req.action != BulkAction::Close || req.verdict != Some(CaseVerdict::Benign) {
        return Err("Only a benign close can suppress similar firings".to_string());
    }
    if !(1..=MAX_TRIAGE_SUPPRESSION_MINUTES).contains(&minutes) {
        return Err(format!(
            "Suppress for 1 to {MAX_TRIAGE_SUPPRESSION_MINUTES} minutes"
        ));
    }
    Ok(Some(minutes))
}

/// Each detection's matching cases among `rows`, titled from the detection, most cases first.
async fn detection_facets(
    org_id: &str,
    rows: &[alert_incidents::Model],
    text: Option<&str>,
    entity: Option<&str>,
) -> Result<Vec<DetectionFacet>, infra::errors::Error> {
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let mut counts = infra::table::alert_incidents::get_alert_counts(&ids).await?;
    let groups: Vec<(
        &alert_incidents::Model,
        Vec<config::meta::alerts::incidents::IncidentAlertGroup>,
    )> = rows
        .iter()
        .map(|row| {
            let groups = counts.remove(&row.id).map(|c| c.groups).unwrap_or_default();
            (row, groups)
        })
        .collect();
    let mut facets = count_facets(&groups, text, entity);
    for facet in &mut facets {
        if let Some((_, alert)) =
            db::alerts::alert::get_alert_from_cache(org_id, &facet.alert_id).await
            && let Some(title) = alert
                .context_attributes
                .as_ref()
                .and_then(|a| a.get("sigma_title"))
                .filter(|t| !t.trim().is_empty())
        {
            facet.title = title.clone();
        }
    }
    Ok(facets)
}

/// The detection counts over cases that pass the text and entity filters.
fn count_facets(
    rows: &[(
        &alert_incidents::Model,
        Vec<config::meta::alerts::incidents::IncidentAlertGroup>,
    )],
    text: Option<&str>,
    entity: Option<&str>,
) -> Vec<DetectionFacet> {
    let mut facets: Vec<DetectionFacet> = Vec::new();
    for (row, groups) in rows {
        let names: Vec<String> = groups.iter().map(|g| g.alert_name.clone()).collect();
        if !case_matches(row, text, entity, &names) {
            continue;
        }
        for group in groups {
            match facets.iter_mut().find(|f| f.alert_id == group.alert_id) {
                Some(facet) => facet.count += 1,
                None => facets.push(DetectionFacet {
                    alert_id: group.alert_id.clone(),
                    alert_name: group.alert_name.clone(),
                    title: group.alert_name.clone(),
                    count: 1,
                }),
            }
        }
    }
    facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.title.cmp(&b.title)));
    facets
}

/// A listed case with its entities and detection count.
fn search_item(incident: Incident) -> CaseSearchItem {
    let entities: Vec<CaseEntity> = cases::case_entities(&incident.group_values)
        .into_iter()
        .map(|(kind, value)| CaseEntity {
            kind: kind.to_string(),
            value,
        })
        .collect();
    let keyed = cases::match_key(&incident.group_values);
    let key = [cases::HOST_KEY, cases::USER_KEY, cases::IP_KEY]
        .into_iter()
        .find_map(|key| Some((cases::kind_of_key(key)?, keyed.get(key)?.clone())));
    let detections = incident.alert_groups.as_ref().map_or(0, Vec::len);
    CaseSearchItem {
        entity: key.as_ref().map(|(_, value)| value.clone()),
        entity_kind: key.map(|(kind, _)| kind.to_string()),
        entities,
        detections,
        incident,
    }
}

/// The change a bulk request asks for, or why it is refused.
fn change_of(req: &BulkRequest) -> Result<Change, String> {
    match req.action {
        BulkAction::Close => {
            match cases::closing_verdict(true, true, req.verdict, req.reason.as_deref())? {
                Some((verdict, reason)) => Ok(Change::Close(verdict, reason)),
                None => Err("Closing a Security case needs a verdict and a reason".to_string()),
            }
        }
        BulkAction::Assign => Ok(Change::Assign(non_empty(req.assigned_to.as_deref()))),
        BulkAction::Priority => req
            .severity
            .map(Change::Priority)
            .ok_or_else(|| "Name the priority".to_string()),
        BulkAction::Status => match req.status.as_deref().map(str::trim) {
            Some(s @ ("open" | "acknowledged")) => Ok(Change::Status(s.to_string())),
            _ => Err("Status is open or acknowledged; close cases with a verdict".to_string()),
        },
    }
}

/// Whether a case's title, id, assignee, entities or detections hold `text`, and its entities
/// hold `entity`.
fn case_matches(
    case: &alert_incidents::Model,
    text: Option<&str>,
    entity: Option<&str>,
    detections: &[String],
) -> bool {
    let entities: Vec<String> = cases::case_entities(&case.group_values)
        .into_iter()
        .map(|(_, value)| value.to_lowercase())
        .collect();
    let holds = |needle: &str| entities.iter().any(|e| e.contains(needle));
    let text_ok = text.is_none_or(|t| {
        case.title
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains(t)
            || case.id.to_lowercase().contains(t)
            || case
                .assigned_to
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains(t)
            || holds(t)
            || detections
                .iter()
                .any(|name| name.replace('_', " ").to_lowercase().contains(t))
    });
    text_ok && entity.is_none_or(holds)
}

fn list_param(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect()
}

fn non_empty(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn dedup_ids(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids.iter().map(|i| i.trim()).filter(|i| !i.is_empty()) {
        if !out.iter().any(|seen| seen == id) {
            out.push(id.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case(
        title: &str,
        dims: serde_json::Value,
        assignee: Option<&str>,
    ) -> alert_incidents::Model {
        alert_incidents::Model {
            id: "2abc".to_string(),
            org_id: "acme".to_string(),
            status: "open".to_string(),
            severity: "P3".to_string(),
            group_values: dims,
            key_type: "Primary".to_string(),
            topology_context: None,
            first_alert_at: 1,
            last_alert_at: 1,
            resolved_at: None,
            alert_count: 1,
            title: Some(title.to_string()),
            assigned_to: assignee.map(str::to_string),
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 1,
            updated_at: 1,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
            security_case: true,
            historical: false,
            last_detection_at: None,
        }
    }

    #[test]
    fn test_detection_facets_count_cases_that_pass_the_other_filters() {
        use config::meta::alerts::incidents::IncidentAlertGroup;
        let group = |id: &str| IncidentAlertGroup {
            alert_id: id.to_string(),
            alert_name: format!("{id}_rule"),
            count: 3,
        };
        let spray = case(
            "Password spray on 10.0.0.9",
            serde_json::json!({"security_ip": "10.0.0.9"}),
            None,
        );
        let travel = case(
            "Impossible travel",
            serde_json::json!({"security_user": "ana@acme"}),
            None,
        );
        let rows = vec![
            (&spray, vec![group("spray"), group("sqli")]),
            (&travel, vec![group("travel")]),
        ];
        let all = count_facets(&rows, None, None);
        assert_eq!(all.len(), 3);
        assert!(all.iter().all(|f| f.count == 1 && f.title == f.alert_name));
        let on_ip = count_facets(&rows, None, Some("10.0.0.9"));
        let ids: Vec<&str> = on_ip.iter().map(|f| f.alert_id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["spray", "sqli"],
            "a detection without matching cases is not offered"
        );
        let twice = vec![
            (&spray, vec![group("sqli")]),
            (&travel, vec![group("sqli")]),
        ];
        assert_eq!(count_facets(&twice, None, None)[0].count, 2);
    }

    #[test]
    fn test_text_and_entity_match_the_case_not_its_detection_id() {
        let c = case(
            "Kerberoasting on svc-sql",
            serde_json::json!({"security_user": "svc-sql@corp", "security_detection": "31xyz"}),
            Some("ana@acme.io"),
        );
        assert!(case_matches(&c, Some("kerberoast"), None, &[]));
        assert!(case_matches(&c, Some("ana@"), None, &[]));
        assert!(case_matches(&c, None, Some("svc-sql"), &[]));
        assert!(!case_matches(&c, None, Some("31xyz"), &[]));
        assert!(!case_matches(&c, Some("kerberoast"), Some("dave"), &[]));
        assert!(case_matches(&c, None, None, &[]));
        let spray = [
            "Entra_ID_Password_Spray_Followed_By_A_Successful_Sign-In__entra_signin".to_string(),
        ];
        assert!(!case_matches(&c, Some("password spray"), None, &[]));
        assert!(case_matches(&c, Some("password spray"), None, &spray));
    }

    #[test]
    fn test_bulk_changes_are_checked_before_they_run() {
        let req = |action, verdict, reason: Option<&str>| BulkRequest {
            ids: vec!["a".to_string()],
            action,
            verdict,
            reason: reason.map(str::to_string),
            assigned_to: Some(" ".to_string()),
            severity: None,
            status: Some("resolved".to_string()),
            include_high: false,
            suppress_minutes: None,
        };
        assert!(change_of(&req(BulkAction::Close, None, Some("noise"))).is_err());
        assert!(matches!(
            change_of(&req(BulkAction::Close, Some(CaseVerdict::Benign), Some(" noise "))),
            Ok(Change::Close(CaseVerdict::Benign, r)) if r == "noise"
        ));
        assert!(matches!(
            change_of(&req(BulkAction::Assign, None, None)),
            Ok(Change::Assign(None))
        ));
        assert!(change_of(&req(BulkAction::Priority, None, None)).is_err());
        assert!(change_of(&req(BulkAction::Status, None, None)).is_err());
    }

    #[test]
    fn test_a_close_leaves_p1_and_p2_open_unless_they_are_included() {
        let close = Change::Close(CaseVerdict::Benign, "office NAT".to_string());
        let with = |severity: &str, status: &str| alert_incidents::Model {
            severity: severity.to_string(),
            status: status.to_string(),
            ..case("Spray", serde_json::json!({}), None)
        };
        assert!(held_back(&close, &with("P1", "open"), false));
        assert!(held_back(&close, &with("P2", "acknowledged"), false));
        assert!(!held_back(&close, &with("P3", "open"), false));
        assert!(!held_back(&close, &with("P1", "open"), true));
        assert!(!held_back(&close, &with("P1", "resolved"), false));
        assert!(!held_back(
            &Change::Assign(None),
            &with("P1", "open"),
            false
        ));
        let mut out = BulkResponse::default();
        out.skip(
            "p1".to_string(),
            "P1".to_string(),
            Some("185.220.101.47".to_string()),
        );
        out.record("p3".to_string(), Some("P3".to_string()), Ok(()));
        out.record("gone".to_string(), None, Err("Case not found".to_string()));
        let body = serde_json::to_value(&out).unwrap();
        assert_eq!(body["skipped"][0]["reason"], "high_priority");
        assert_eq!(body["skipped"][0]["entity"], "185.220.101.47");
        assert_eq!(body["updated"], serde_json::json!(["p3"]));
        assert_eq!(body["failed"][0]["id"], "gone");
        let outcomes: Vec<&str> = body["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["outcome"].as_str().unwrap())
            .collect();
        assert_eq!(outcomes, ["skipped", "updated", "failed"]);
    }

    #[test]
    fn test_only_a_benign_close_suppresses_and_for_a_week_at_most() {
        let req = |action, verdict, minutes| BulkRequest {
            ids: vec!["a".to_string()],
            action,
            verdict,
            reason: Some("noise".to_string()),
            assigned_to: None,
            severity: None,
            status: None,
            include_high: false,
            suppress_minutes: minutes,
        };
        assert_eq!(
            suppression_of(&req(BulkAction::Close, Some(CaseVerdict::Benign), None)),
            Ok(None)
        );
        assert_eq!(
            suppression_of(&req(
                BulkAction::Close,
                Some(CaseVerdict::Benign),
                Some(240)
            )),
            Ok(Some(240))
        );
        assert!(
            suppression_of(&req(
                BulkAction::Close,
                Some(CaseVerdict::Benign),
                Some(MAX_TRIAGE_SUPPRESSION_MINUTES + 1)
            ))
            .is_err()
        );
        assert!(
            suppression_of(&req(
                BulkAction::Close,
                Some(CaseVerdict::TruePositive),
                Some(60)
            ))
            .is_err()
        );
        assert!(suppression_of(&req(BulkAction::Assign, None, Some(60))).is_err());
    }

    fn listed(model: &alert_incidents::Model) -> Incident {
        serde_json::from_value(serde_json::json!({
            "id": model.id,
            "org_id": model.org_id,
            "status": "open",
            "severity": "P2",
            "first_alert_at": 1,
            "last_alert_at": 1,
            "alert_count": 1,
            "created_at": 1,
            "updated_at": 1,
            "group_values": model.group_values,
        }))
        .unwrap()
    }

    #[test]
    fn test_a_listed_case_names_its_entity_and_its_rolled_up_ones() {
        let model = case(
            "Kerberos on 10.20.13.155",
            serde_json::json!({"security_ip": "10.20.13.155", "security_detection": "sigma:k"}),
            None,
        );
        let item = search_item(listed(&model));
        assert_eq!(item.entity.as_deref(), Some("10.20.13.155"));
        assert_eq!(item.entity_kind.as_deref(), Some("ip"));
        assert_eq!(item.entities.len(), 1);
        let body = serde_json::to_value(&item).unwrap();
        assert_eq!(
            body["id"], "2abc",
            "the incident's own fields stay at the top level"
        );
        assert_eq!(body["entity"], "10.20.13.155");

        let mut rolled = serde_json::json!({});
        cases::list_entity(
            &mut rolled,
            &cases::entity_from("host", "WIN-ENG-004").unwrap(),
        );
        let model = case("Beaconing", rolled, None);
        assert!(case_matches(&model, None, Some("win-eng"), &[]));
        let item = search_item(listed(&model));
        assert_eq!(item.entity, None);
        assert_eq!(
            item.entities,
            [CaseEntity {
                kind: "host".to_string(),
                value: "win-eng-004".to_string()
            }]
        );
    }

    #[test]
    fn test_ids_and_lists_are_trimmed_and_deduplicated() {
        let ids = [
            "a".to_string(),
            " a ".to_string(),
            String::new(),
            "b".to_string(),
        ];
        assert_eq!(dedup_ids(&ids), ["a", "b"]);
        assert_eq!(
            list_param(Some("open, acknowledged,,")),
            ["open", "acknowledged"]
        );
        assert!(list_param(None).is_empty());
    }
}
