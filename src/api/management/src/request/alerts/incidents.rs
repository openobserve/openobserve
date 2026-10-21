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

//! HTTP handlers for alert incident management

#[cfg(feature = "enterprise")]
use axum::response::IntoResponse;
use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::ai::error::{AiErrorCode, AiErrorEnvelope};

// The refusals keep their pre-envelope text in `error`, which older clients match on.
#[cfg(feature = "enterprise")]
const RCA_NOT_ENABLED: &str = "RCA is not enabled";
#[cfg(feature = "enterprise")]
const ANALYSIS_IN_PROGRESS: &str = "Analysis already in progress";
#[cfg(feature = "enterprise")]
const OFF_FOR_PRIORITY: &str = "AI SRE is turned off for this incident's priority";
/// The longest `reason` a "Was this the cause?" answer keeps.
const RCA_FEEDBACK_REASON_MAX: usize = 2000;

/// Query parameters for listing incidents
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct ListIncidentsQuery {
    /// Filter by status (open, acknowledged, resolved)
    #[serde(default)]
    pub status: Option<String>,
    /// Maximum number of results
    #[serde(default = "default_limit")]
    pub limit: u64,
    /// Offset for pagination
    #[serde(default)]
    pub offset: u64,
}

fn default_limit() -> u64 {
    50
}

/// Severity values for incident updates
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum IncidentSeverity {
    P1,
    P2,
    P3,
    P4,
}

impl IncidentSeverity {
    pub fn as_str(&self) -> &str {
        match self {
            IncidentSeverity::P1 => "P1",
            IncidentSeverity::P2 => "P2",
            IncidentSeverity::P3 => "P3",
            IncidentSeverity::P4 => "P4",
        }
    }
}

/// Status values for incident updates
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum IncidentStatus {
    Open,
    Acknowledged,
    Resolved,
}

impl IncidentStatus {
    pub fn as_str(&self) -> &str {
        match self {
            IncidentStatus::Open => "open",
            IncidentStatus::Acknowledged => "acknowledged",
            IncidentStatus::Resolved => "resolved",
        }
    }
}

/// Update payload enum for incident field updates
/// Ensures only one field can be updated per request
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum UpdatePayload {
    /// Update incident title
    Title { title: String },
    /// Update incident severity
    Severity { severity: IncidentSeverity },
    /// Update incident status
    Status { status: IncidentStatus },
}

/// Response for list incidents
#[derive(Debug, Serialize, ToSchema)]
pub struct ListIncidentsResponse {
    pub incidents: Vec<config::meta::alerts::incidents::Incident>,
    pub total: u64,
}

#[cfg(feature = "enterprise")]
/// ListIncidents
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidents",
    summary = "List alert incidents",
    description = "Retrieves a list of correlated alert incidents with optional status filtering and pagination.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListIncidentsQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ListIncidentsResponse),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all incidents", "category": "alerts"}))
    )
)]
pub async fn list_incidents(
    Path(org_id): Path<String>,
    Query(query): Query<ListIncidentsQuery>,
) -> Response {
    match openobserve_core::alerts::incidents::list_incidents(
        &org_id,
        query.status.as_deref(),
        query.limit,
        query.offset,
    )
    .await
    {
        Ok((incidents, total)) => {
            MetaHttpResponse::json(ListIncidentsResponse { incidents, total })
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncident
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncident",
    summary = "Get incident details",
    description = "Retrieves detailed information about a specific incident including all correlated alerts.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::IncidentWithAlerts),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get an incident's details", "category": "alerts", "pinned": true}))
    )
)]
pub async fn get_incident(Path((org_id, incident_id)): Path<(String, String)>) -> Response {
    match openobserve_core::alerts::incidents::get_incident_with_alerts(&org_id, &incident_id).await
    {
        Ok(Some(incident)) => MetaHttpResponse::json(incident),
        Ok(None) => MetaHttpResponse::not_found("Incident not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/update",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "UpdateIncident",
    summary = "Update incident fields",
    description = "Updates incident title, severity, or status. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = UpdatePayload, description = "Field to update", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::Incident),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update an incident's title or severity. Status changes (resolve, acknowledge, reopen) are NOT supported via this tool — they must be performed by a human in the UI.", "category": "alerts"}))
    )
)]
pub async fn update_incident(
    path: Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<UpdatePayload>,
) -> Response {
    let (org_id, incident_id) = path.0;
    let user_id = user_email.user_id;

    match body {
        UpdatePayload::Title { title } => {
            if title.trim().is_empty() {
                return MetaHttpResponse::bad_request("Title cannot be empty");
            }
            if title.len() > 255 {
                return MetaHttpResponse::bad_request("Title cannot exceed 255 characters");
            }

            match openobserve_core::alerts::incidents::update_title(
                &org_id,
                &incident_id,
                &title,
                &user_id,
            )
            .await
            {
                Ok(incident) => MetaHttpResponse::json(incident),
                Err(e) => {
                    if e.to_string().contains("not found") {
                        MetaHttpResponse::not_found("Incident not found")
                    } else {
                        MetaHttpResponse::internal_error(e)
                    }
                }
            }
        }
        UpdatePayload::Severity { severity } => {
            match openobserve_core::alerts::incidents::update_severity(
                &org_id,
                &incident_id,
                severity.as_str(),
                &user_id,
            )
            .await
            {
                Ok(incident) => {
                    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
                    let cooldown = get_o2_config().incidents.reanalysis_cooldown_minutes;
                    let events = infra::table::incident_events::get(&org_id, &incident_id)
                        .await
                        .unwrap_or_default();
                    let in_flight = openobserve_core::alerts::incidents::is_analysis_in_flight(
                        &events,
                        cooldown * 2,
                    );
                    MetaHttpResponse::json(UpdateSeverityResponse {
                        incident,
                        analysis_in_flight: in_flight,
                    })
                }
                Err(e) => {
                    if e.to_string().contains("not found") {
                        MetaHttpResponse::not_found("Incident not found")
                    } else {
                        MetaHttpResponse::internal_error(e)
                    }
                }
            }
        }
        UpdatePayload::Status { status } => {
            match openobserve_core::alerts::incidents::update_status(
                &org_id,
                &incident_id,
                status.as_str(),
                &user_id,
            )
            .await
            {
                Ok(incident) => MetaHttpResponse::json(incident),
                Err(e) => {
                    if e.to_string().contains("not found") {
                        MetaHttpResponse::not_found("Incident not found")
                    } else {
                        MetaHttpResponse::internal_error(e)
                    }
                }
            }
        }
    }
}

#[cfg(feature = "enterprise")]
/// GetExternalAlertPayload
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/external-alerts/{external_alert_id}/payload",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetExternalAlertPayload",
    summary = "Get the raw payload of an external alert",
    description = "Retrieves the original, unmodified webhook payload received for an external alert event. Used to inspect exactly what a source system (Grafana, Alertmanager, etc.) sent.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("external_alert_id" = String, Path, description = "External alert ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get the raw payload of an external alert", "category": "alerts"}))
    )
)]
pub async fn get_external_alert_payload(
    Path((org_id, external_alert_id)): Path<(String, String)>,
) -> Response {
    match infra::table::external_alerts::get_by_id(&org_id, &external_alert_id).await {
        Ok(Some(record)) => MetaHttpResponse::json(serde_json::json!({
            "id": record.id,
            "detected_source": record.detected_source,
            "source_url": record.source_url,
            "first_seen_at": record.first_seen_at,
            "last_seen_at": record.last_seen_at,
            "last_payload": record.last_payload,
        })),
        Ok(None) => MetaHttpResponse::not_found("External alert not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentStats
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/stats",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentStats",
    summary = "Get incident statistics",
    description = "Retrieves statistics about incidents including counts by status and severity.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::IncidentStats),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get incident statistics", "category": "alerts"}))
    )
)]
pub async fn get_incident_stats(Path(org_id): Path<String>) -> Response {
    // Get counts - simple implementation
    let open_count = match infra::table::alert_incidents::count_open(&org_id).await {
        Ok(c) => c as i64,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let stats = config::meta::alerts::incidents::IncidentStats {
        total_incidents: 0, // Would need additional query
        open_incidents: open_count,
        acknowledged_incidents: 0,
        resolved_incidents: 0,
        by_severity: std::collections::HashMap::new(),
        by_service: std::collections::HashMap::new(),
        mttr_minutes: None,
        alerts_per_incident_avg: 0.0,
    };

    MetaHttpResponse::json(stats)
}

/// Response for severity update — wraps Incident and signals whether analysis is running
#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateSeverityResponse {
    #[serde(flatten)]
    pub incident: config::meta::alerts::incidents::Incident,
    pub analysis_in_flight: bool,
}

/// Response for RCA analysis
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaResponse {
    pub rca_content: String,
}

/// Response for cancelling an in-flight RCA analysis
#[derive(Debug, Serialize, ToSchema)]
pub struct CancelRcaResponse {
    pub message: String,
    /// Whether an in-process task handle was found and aborted on this node. False when the
    /// analysis is running on another node — the cancellation event is still recorded.
    pub aborted_local_task: bool,
}

/// Response listing an incident's current and superseded RCA reports
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RcaHistoryResponse {
    /// The active report, if one has been generated
    pub current: Option<String>,
    /// Superseded reports and runs that did not complete, newest first
    pub previous: Vec<RcaHistoryItem>,
    /// `current`'s `report_id`, `trigger`, `ended_reason` and `created_at`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_report: Option<RcaCurrentReport>,
}

impl RcaHistoryResponse {
    /// `outcomes` holds the caller's answers by `report_id`, as stored.
    pub fn new(
        topology: config::meta::alerts::incidents::IncidentTopology,
        outcomes: &std::collections::HashMap<String, String>,
    ) -> Self {
        let mine = |report_id: Option<&str>| {
            report_id
                .and_then(|id| outcomes.get(id))
                .and_then(|outcome| RcaOutcome::from_stored(outcome))
        };
        Self {
            current: topology.suggested_root_cause,
            previous: topology
                .previous_analyses
                .into_iter()
                .map(|report| RcaHistoryItem {
                    my_outcome: mine(report.report_id.as_deref()),
                    report,
                })
                .collect(),
            current_report: topology.current_report.map(|report| RcaCurrentReport {
                my_outcome: mine(Some(&report.report_id)),
                report,
            }),
        }
    }
}

/// A retained report with the caller's own answer to it.
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaHistoryItem {
    #[serde(flatten)]
    pub report: config::meta::alerts::incidents::ArchivedRcaReport,
    /// The caller's "Was this the cause?" answer; null when they gave none
    pub my_outcome: Option<RcaOutcome>,
}

/// The current report's history facts with the caller's own answer to it.
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaCurrentReport {
    #[serde(flatten)]
    pub report: config::meta::alerts::incidents::RcaReportMeta,
    /// The caller's "Was this the cause?" answer; null when they gave none
    pub my_outcome: Option<RcaOutcome>,
}

/// "Was this the cause?" for one RCA report
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RcaOutcome {
    Yes,
    Partly,
    No,
}

impl RcaOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yes => "yes",
            Self::Partly => "partly",
            Self::No => "no",
        }
    }

    pub fn from_stored(value: &str) -> Option<Self> {
        [Self::Yes, Self::Partly, Self::No]
            .into_iter()
            .find(|outcome| outcome.as_str() == value)
    }
}

/// Body of `POST …/rca/feedback`; one answer per report and user, the latest one kept
#[derive(Debug, Deserialize, ToSchema)]
pub struct RcaFeedbackRequest {
    /// `report_id` from `GET …/rca/history` or the stream's `complete` frame
    pub report_id: String,
    pub outcome: RcaOutcome,
    /// Optional free text, at most 2000 characters
    #[serde(default)]
    pub reason: Option<String>,
}

impl RcaFeedbackRequest {
    /// The refusal for a body the route cannot store; `None` when it can.
    pub fn problem(&self) -> Option<&'static str> {
        if self.report_id.trim().is_empty() {
            return Some("report_id is required");
        }
        match &self.reason {
            Some(reason) if reason.chars().count() > RCA_FEEDBACK_REASON_MAX => {
                Some("reason must be 2000 characters or fewer")
            }
            _ => None,
        }
    }
}

/// The stored answer
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaFeedbackResponse {
    pub report_id: String,
    pub outcome: RcaOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Microseconds since epoch of the latest answer
    pub updated_at: i64,
}

/// Query parameters for RCA trigger
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TriggerRcaQuery {
    /// Use streaming response (default: false)
    #[serde(default)]
    pub stream: bool,
    /// Treat this as a user-initiated reanalysis — bypasses cooldown (default: false)
    #[serde(default)]
    pub reanalysis: bool,
    /// Feed the previous report to the agent so it builds on it instead of starting
    /// from scratch (default: false — each run is a fresh, independent analysis).
    #[serde(default)]
    pub build_on_previous: bool,
}

#[cfg(feature = "enterprise")]
/// TriggerIncidentRca
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "TriggerIncidentRca",
    summary = "Trigger RCA analysis for an incident",
    description = "Triggers root cause analysis for an incident. The run is detached from the request: closing the connection neither stops nor loses it, and `DELETE` on this path stops it from any session. With stream=true the response is an SSE stream carrying the chat lifecycle frames (turn_started, step, tool_call, tool_result, retrying, error{code}, findings) with the report text as `chunk` frames, ending in exactly one terminal: `complete{saved, report_id?, ended_reason}` or `cancelled{saved:false, ended_reason:\"cancelled\"}`; this holds for reanalysis=true too. `ended_reason` is `completed`, `failed`, `cancelled` or `interrupted`; only a completed run with text becomes the current report (`saved:true`), other text is kept in the history. Without stream it returns the complete result as JSON, and reanalysis=true without stream starts the run in the background and answers 202. Refusals use the error envelope: 400 `rca_disabled` (`reason` `rca_off` or `priority_off`), 400 `analysis_in_progress`, 503 `agent_unavailable`; `error` keeps the previous text.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        TriggerRcaQuery,
    ),
    responses(
        (status = 200, description = "RCA analysis completed or SSE stream", content_type = "application/json", body = RcaResponse),
        (status = 202, description = "Background reanalysis started (reanalysis=true without stream)", content_type = "application/json", body = ()),
        (status = 400, description = "rca_disabled or analysis_in_progress", content_type = "application/json", body = ()),
        (status = 402, description = "AI credits exhausted", content_type = "application/json", body = ()),
        (status = 412, description = "Paid usage requires organization consent", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 503, description = "RCA agent or billing state unavailable", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Manually trigger incident RCA", "category": "alerts"}))
    )
)]
pub async fn trigger_incident_rca(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<TriggerRcaQuery>,
) -> Response {
    use o2_enterprise::enterprise::{
        alerts::rca_service, common::config::get_config as get_o2_config,
    };

    let o2_cfg = get_o2_config();

    // Check if RCA is enabled
    if !o2_cfg.incidents.enabled || !o2_cfg.incidents.rca_enabled {
        return rca_disabled(RCA_NOT_ENABLED, "rca_off");
    }
    // Refused before the quota is charged or the lifecycle starts.
    let Some(policy) = openobserve_core::ai_policy::rca_policy(&org_id).await else {
        return crate::request::ai::settings::off_for_org();
    };

    if !o2_cfg.ai.has_agent_target() {
        return agent_unavailable("RCA agent URL is not configured");
    }

    let Some(_start) =
        openobserve_core::alerts::rca_tasks::reserve_rca_start(&org_id, &incident_id)
    else {
        return rca_error(AiErrorCode::AnalysisInProgress, ANALYSIS_IN_PROGRESS);
    };
    // In-flight guard. Keep the events to distinguish a first analysis from
    // a rerun when a caller omits the explicit reanalysis flag.
    let cooldown = o2_cfg.incidents.reanalysis_cooldown_minutes;
    let events = infra::table::incident_events::get(&org_id, &incident_id)
        .await
        .unwrap_or_default();
    if openobserve_core::alerts::incidents::is_analysis_in_flight(&events, cooldown * 2) {
        return rca_error(AiErrorCode::AnalysisInProgress, ANALYSIS_IN_PROGRESS);
    }
    let trigger =
        config::meta::alerts::incidents::RcaTrigger::for_user_run(query.build_on_previous, &events);

    // Validate the incident before consuming quota or starting the lifecycle. Existence check
    // only: the builder below re-derives the context, so read the one row rather than hydrating
    // every alert on the incident.
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return rca_error(AiErrorCode::NotFound, "Incident not found"),
        Err(e) => {
            log::error!("[INCIDENTS::RCA] incident {incident_id} unreadable: {e}");
            return rca_error(AiErrorCode::Internal, "The incident could not be read");
        }
    }

    // A reanalysis runs through the shared trigger, which skips it when the team's L0 is off;
    // refuse it before authorization so the skipped run is never charged.
    if query.reanalysis
        && !openobserve_core::alerts::incidents::rca_will_run(&org_id, &incident_id).await
    {
        return rca_disabled(OFF_FOR_PRIORITY, "priority_off");
    }

    #[cfg(feature = "cloud")]
    let usage_permit = {
        let is_reanalysis = query.reanalysis
            || events.iter().any(|event| {
                matches!(
                    event.event_type,
                    config::meta::alerts::incidents::IncidentEventType::AIAnalysisComplete
                )
            });
        let feature = if is_reanalysis {
            openobserve_core::trial_quota::TrialQuotaFeature::IncidentReAnalysis
        } else {
            openobserve_core::trial_quota::TrialQuotaFeature::NewIncident
        };
        let usage_context = openobserve_core::trial_quota::AiUsageContext {
            user_email: user_email.user_id.clone(),
            incident_id: Some(incident_id.clone()),
            ..Default::default()
        };
        match openobserve_core::trial_quota::authorize_ai_usage(&org_id, feature, &usage_context)
            .await
        {
            Ok(permit) => Some(permit),
            Err(error) => {
                return crate::request::ai::chat::ai_authorization_error_response(error);
            }
        }
    };
    #[cfg(not(feature = "cloud"))]
    let usage_permit = None;

    // Authorization succeeded. Every error below, and a dropped request, ends the lifecycle.
    let begun = openobserve_core::alerts::rca_tasks::BegunRun::begin(&org_id, &incident_id).await;

    // Build RCA context. Each run is a fresh analysis unless the caller explicitly opts
    // into continuity — chaining every run compounds the report (and the agent's context)
    // and carries any early mistake forward with no way to shake it off.
    let previous_analysis = if query.build_on_previous {
        infra::table::alert_incidents::get_topology(&org_id, &incident_id)
            .await
            .ok()
            .flatten()
            .and_then(|t| t.suggested_root_cause)
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    // The single builder both this endpoint and the autonomous path call, so the two can no
    // longer disagree about severity or past_causes (C1).
    let context =
        rca_service::build_incident_context(&org_id, &incident_id, previous_analysis).await;

    // Create RCA agent client with SA credentials
    let (email, token) =
        match openobserve_core::organization::get_sre_agent_credentials(&org_id).await {
            Ok(creds) => creds,
            Err(e) => {
                begun.fail(
                    config::meta::alerts::incidents::IncidentEvent::ai_analysis_failed(
                        "Credentials failed",
                        config::meta::alerts::incidents::AnalysisTriggerType::Manual,
                        Some(format!("{:#}", e)),
                    ),
                );
                log::error!("[INCIDENTS::RCA] SRE agent credentials for {org_id}: {e}");
                return rca_error(AiErrorCode::Internal, "Failed to get SRE agent credentials");
            }
        };
    let auth_header = openobserve_core::auth::build_basic_auth_header(&email, &token);
    let client = match o2_enterprise::enterprise::ai::client::get_agent_client() {
        Some(c) => c,
        None => {
            begun.fail(
                config::meta::alerts::incidents::IncidentEvent::ai_analysis_failed(
                    "Agent not configured",
                    config::meta::alerts::incidents::AnalysisTriggerType::Manual,
                    None,
                ),
            );
            return agent_unavailable("RCA agent client not initialized");
        }
    };

    // Check agent health
    if let Err(e) = client.health(&auth_header).await {
        begun.fail(
            config::meta::alerts::incidents::IncidentEvent::ai_analysis_failed(
                "Agent unavailable",
                config::meta::alerts::incidents::AnalysisTriggerType::Manual,
                Some(format!("{:#}", e)),
            ),
        );

        log::warn!("[INCIDENTS::RCA] agent health check failed for {incident_id}: {e}");
        return agent_unavailable("RCA agent not available");
    }

    let run = openobserve_core::alerts::rca_tasks::IncidentRun {
        org_id,
        incident_id,
        trigger,
    };
    // Without stream, a reanalysis keeps the 202 background contract.
    if query.reanalysis && !query.stream {
        return spawn_background_reanalysis(begun, run, user_email.user_id, usage_permit);
    }
    if query.stream {
        return stream_rca(begun, &client, &context, &auth_header, &policy, run).await;
    }
    run_rca(begun, (*client).clone(), context, auth_header, policy, run).await
}

#[cfg(feature = "enterprise")]
/// CancelIncidentRca
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "CancelIncidentRca",
    summary = "Cancel the in-flight RCA analysis for an incident",
    description = "Aborts a running root cause analysis and records a terminal cancellation event, releasing the in-flight guard so a new analysis can be started immediately.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Analysis cancelled", content_type = "application/json", body = CancelRcaResponse),
        (status = 400, description = "No analysis in progress", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Cancel a running incident RCA", "category": "alerts"}))
    )
)]
pub async fn cancel_incident_rca(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    let cooldown = get_o2_config().incidents.reanalysis_cooldown_minutes;

    // The in-flight check lives inside cancel_rca_for_incident, after the abort handle is
    // atomically removed — checking here first would leave a window in which a new
    // analysis could start and be cancelled in place of the one the user targeted.
    match openobserve_core::alerts::incidents::cancel_rca_for_incident(
        &org_id,
        &incident_id,
        Some(user_email.user_id.clone()),
        cooldown * 2,
    )
    .await
    {
        // Nothing running — report it rather than writing a spurious terminal event.
        Ok(None) => rca_error(
            AiErrorCode::InvalidRequest,
            "No analysis is currently in progress",
        ),
        Ok(Some(aborted)) => MetaHttpResponse::json(CancelRcaResponse {
            message: "Analysis cancelled".to_string(),
            aborted_local_task: aborted,
        }),
        Err(e) => {
            log::error!("[INCIDENTS::RCA] cancel for {incident_id}: {e}");
            rca_error(AiErrorCode::Internal, "Failed to cancel analysis")
        }
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaHistory
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/history",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaHistory",
    summary = "List RCA reports for an incident",
    description = "Returns the current root cause analysis report plus any superseded reports and runs that did not complete, newest first. `current_report` and each `previous` item carry `report_id`, `trigger` (`auto`, `manual`, `severity_change` when a user reran after a severity change that followed the last completed report, or `build_on_previous`), `ended_reason` (`completed`, `failed`, `cancelled`, `interrupted`), `created_at` and the caller's own `my_outcome` (`yes`, `partly`, `no` or null). Only a completed run becomes `current`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "RCA report history", content_type = "application/json", body = RcaHistoryResponse),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List past incident RCA reports", "category": "alerts"}))
    )
)]
pub async fn get_incident_rca_history(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let topology = match infra::table::alert_incidents::get_topology(&org_id, &incident_id).await {
        Ok(Some(t)) => t,
        Ok(None) => return MetaHttpResponse::json(RcaHistoryResponse::default()),
        Err(e) => {
            log::error!("[INCIDENTS::RCA] history of {incident_id} unreadable: {e}");
            return rca_error(
                AiErrorCode::Internal,
                "The report history could not be read",
            );
        }
    };
    let outcomes =
        infra::table::rca_feedback::outcomes_of(&org_id, &incident_id, &user_email.user_id)
            .await
            .unwrap_or_else(|e| {
                // The reports stay readable; only the caller's answers are missing.
                log::warn!("[INCIDENTS::RCA] answers on {incident_id} unreadable: {e}");
                Default::default()
            });

    MetaHttpResponse::json(RcaHistoryResponse::new(topology, &outcomes))
}

#[cfg(feature = "enterprise")]
/// PostIncidentRcaFeedback
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PostIncidentRcaFeedback",
    summary = "Answer \"Was this the cause?\" for an RCA report",
    description = "Records the caller's outcome (yes, partly or no) and an optional reason for one RCA report of this incident. One answer per report and user: posting again replaces it, so the call is idempotent. Anyone who can read the incident may answer. A body that is not valid JSON of this shape answers 400 `invalid_request`. Answers are deleted when their report leaves the history and with the organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = RcaFeedbackRequest, description = "The answer", content_type = "application/json"),
    responses(
        (status = 200, description = "Answer stored", content_type = "application/json", body = RcaFeedbackResponse),
        (status = 400, description = "Invalid body", content_type = "application/json", body = ()),
        (status = 404, description = "No such report on this incident", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_incident_rca_feedback(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<RcaFeedbackRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let body = match feedback_body(body) {
        Ok(body) => body,
        Err(refusal) => return refusal,
    };
    let topology = match infra::table::alert_incidents::get_topology(&org_id, &incident_id).await {
        Ok(topology) => topology.unwrap_or_default(),
        Err(e) => {
            log::error!("[INCIDENTS::RCA] history of {incident_id} unreadable: {e}");
            return rca_error(
                AiErrorCode::Internal,
                "The report history could not be read",
            );
        }
    };
    if !has_report(&topology, &body.report_id) {
        return rca_error(AiErrorCode::NotFound, "No such report on this incident");
    }
    let answer = infra::table::rca_feedback::Answer {
        org_id: &org_id,
        incident_id: &incident_id,
        report_id: &body.report_id,
        user_email: &user_email.user_id,
        outcome: body.outcome.as_str(),
        reason: body.reason.as_deref().filter(|r| !r.trim().is_empty()),
    };
    match infra::table::rca_feedback::upsert(answer, config::utils::time::now_micros()).await {
        Ok(stored) => MetaHttpResponse::json(RcaFeedbackResponse {
            report_id: stored.report_id,
            outcome: body.outcome,
            reason: stored.reason,
            updated_at: stored.updated_at,
        }),
        Err(e) => {
            log::error!("[INCIDENTS::RCA] feedback on {incident_id} not stored: {e}");
            rca_error(
                AiErrorCode::PersistenceFailed,
                "The answer could not be saved",
            )
        }
    }
}

/// Get incident events timeline
#[cfg(feature = "enterprise")]
pub async fn get_incident_events(Path((org_id, incident_id)): Path<(String, String)>) -> Response {
    let events = match infra::table::incident_events::get(&org_id, &incident_id).await {
        Ok(events) => events,
        Err(e) => return MetaHttpResponse::internal_error(format!("Failed to get events: {e}")),
    };

    // Self-heal timelines emptied by the pre-fix read/write cycle (releases up to v0.91.x).
    // Repairing lazily on read avoids a migration that would rewrite every incident row;
    // an empty timeline is cheap to inspect and, for healthy incidents, is a normal state
    // that reconstruct_if_empty leaves alone once there is nothing to rebuild.
    if events.is_empty() {
        match infra::table::incident_events::reconstruct_if_empty(&org_id, &incident_id).await {
            Ok(Some(_)) => match infra::table::incident_events::get(&org_id, &incident_id).await {
                Ok(rebuilt) => {
                    return MetaHttpResponse::json(serde_json::json!({
                        "events": rebuilt,
                        // Flags that the timeline was rebuilt from incident/alert rows and is
                        // missing anything that lived only in the lost blob (comments,
                        // acknowledgements, RCA activity).
                        "partial_reconstruction": true,
                    }));
                }
                Err(e) => {
                    return MetaHttpResponse::internal_error(format!("Failed to get events: {e}"));
                }
            },
            Ok(None) => {}
            // Repair is best-effort: a failure here must not fail the read.
            Err(e) => {
                log::warn!("[INCIDENTS] timeline reconstruction failed for {incident_id}: {e}");
            }
        }
    }

    MetaHttpResponse::json(serde_json::json!({ "events": events }))
}

/// Get incident events timeline (OSS)
#[cfg(not(feature = "enterprise"))]
pub async fn get_incident_events(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

/// Post a comment on an incident
#[cfg(feature = "enterprise")]
pub async fn post_incident_comment(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CommentRequest>,
) -> Response {
    use config::meta::alerts::incidents::IncidentEvent;

    if body.comment.trim().is_empty() {
        return MetaHttpResponse::bad_request("Comment cannot be blank");
    }
    if body.comment.len() > 10_000 {
        return MetaHttpResponse::bad_request("Comment must be 10,000 characters or fewer");
    }

    let event = IncidentEvent::comment(user_email.user_id, body.comment);

    match openobserve_core::incidents::append_event(&org_id, &incident_id, event).await {
        Ok(()) => MetaHttpResponse::ok("Comment added"),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to add comment: {e}")),
    }
}

/// Post a comment (OSS)
#[cfg(not(feature = "enterprise"))]
pub async fn post_incident_comment(
    _path: Path<(String, String)>,
    _headers: Headers<UserEmail>,
    _body: Json<CommentRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommentRequest {
    pub comment: String,
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "TriggerIncidentRca",
    summary = "Trigger RCA analysis for an incident",
    description = "Triggers root cause analysis for an incident. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "SSE stream", content_type = "text/event-stream"),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Manually trigger incident RCA", "category": "alerts"}))
    )
)]
pub async fn trigger_incident_rca(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidents",
    summary = "List alert incidents",
    description = "Retrieves a list of correlated alert incidents. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListIncidentsQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ListIncidentsResponse),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all incidents", "category": "alerts"}))
    )
)]
pub async fn list_incidents(_path: Path<String>, _query: Query<ListIncidentsQuery>) -> Response {
    // Only supported with enterprise features enabled
    MetaHttpResponse::json(ListIncidentsResponse {
        incidents: vec![],
        total: 0,
    })
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncident",
    summary = "Get incident details",
    description = "Retrieves detailed information about a specific incident. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::IncidentWithAlerts),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get an incident's details", "category": "alerts"}))
    )
)]
pub async fn get_incident(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/external-alerts/{external_alert_id}/payload",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetExternalAlertPayload",
    summary = "Get the raw payload of an external alert",
    description = "Retrieves the original webhook payload for an external alert event. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("external_alert_id" = String, Path, description = "External alert ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ()),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get the raw payload of an external alert", "category": "alerts"}))
    )
)]
pub async fn get_external_alert_payload(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/stats",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentStats",
    summary = "Get incident statistics",
    description = "Retrieves statistics about incidents. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::IncidentStats),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get incident statistics", "category": "alerts"}))
    )
)]
pub async fn get_incident_stats(_path: Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/update",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "UpdateIncident",
    summary = "Update incident fields",
    description = "Updates incident title, severity, or status. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = UpdatePayload, description = "Field to update", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::alerts::incidents::Incident),
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update an incident's title, severity, or status", "category": "alerts"}))
    )
)]
pub async fn update_incident(
    _path: Path<(String, String)>,
    _body: Json<UpdatePayload>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "CancelIncidentRca",
    summary = "Cancel the in-flight RCA analysis for an incident",
    description = "Aborts a running root cause analysis. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 403, description = "Enterprise feature", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Cancel a running incident RCA", "category": "alerts"}))
    )
)]
pub async fn cancel_incident_rca(
    _path: Path<(String, String)>,
    _user_email: Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/history",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaHistory",
    summary = "List RCA reports for an incident",
    description = "Returns the current root cause analysis report plus any superseded reports. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "RCA report history (always empty without enterprise features)", content_type = "application/json", body = RcaHistoryResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List past incident RCA reports", "category": "alerts"}))
    )
)]
pub async fn get_incident_rca_history(_path: Path<(String, String)>) -> Response {
    MetaHttpResponse::json(RcaHistoryResponse::default())
}

#[cfg(not(feature = "enterprise"))]
/// PostIncidentRcaFeedback
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/feedback",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PostIncidentRcaFeedback",
    summary = "Answer \"Was this the cause?\" for an RCA report",
    description = "Requires enterprise features.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    request_body(content = RcaFeedbackRequest, description = "The answer", content_type = "application/json"),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_incident_rca_feedback(
    _path: Path<(String, String)>,
    _headers: Headers<UserEmail>,
    _body: Result<Json<RcaFeedbackRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

/// A body the feedback route can store, or its refusal as the error envelope.
#[cfg(feature = "enterprise")]
fn feedback_body(
    body: Result<Json<RcaFeedbackRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<RcaFeedbackRequest, Response> {
    let Ok(Json(body)) = body else {
        return Err(rca_error(
            AiErrorCode::InvalidRequest,
            "The answer is not valid",
        ));
    };
    match body.problem() {
        Some(problem) => Err(rca_error(AiErrorCode::InvalidRequest, problem)),
        None => Ok(body),
    }
}

/// Whether `report_id` names the current or a retained report of this incident.
#[cfg(feature = "enterprise")]
fn has_report(
    topology: &config::meta::alerts::incidents::IncidentTopology,
    report_id: &str,
) -> bool {
    topology
        .current_report
        .as_ref()
        .is_some_and(|r| r.report_id == report_id)
        || topology
            .previous_analyses
            .iter()
            .any(|r| r.report_id.as_deref() == Some(report_id))
}

/// An RCA route's error as the error envelope; `message` is fixed text, never upstream.
#[cfg(feature = "enterprise")]
fn rca_error(code: AiErrorCode, message: &str) -> Response {
    AiErrorEnvelope::new(code, message).into_response()
}

/// Off for this deployment (`rca_off`) or for this incident's priority (`priority_off`).
#[cfg(feature = "enterprise")]
fn rca_disabled(message: &str, reason: &str) -> Response {
    AiErrorEnvelope::new(AiErrorCode::RcaDisabled, message)
        .with("reason", reason)
        .into_response()
}

#[cfg(feature = "enterprise")]
fn agent_unavailable(message: &str) -> Response {
    rca_error(AiErrorCode::AgentUnavailable, message)
}

/// Runs a reanalysis as the incident's registered task and answers 202 at once.
#[cfg(feature = "enterprise")]
fn spawn_background_reanalysis(
    begun: openobserve_core::alerts::rca_tasks::BegunRun,
    run: openobserve_core::alerts::rca_tasks::IncidentRun,
    user_email: String,
    usage_permit: Option<openobserve_core::AiUsagePermit>,
) -> Response {
    use openobserve_core::alerts::rca_tasks;

    let (org_id, incident_id) = (run.org_id.clone(), run.incident_id.clone());
    rca_tasks::spawn_rca_task(&org_id, &incident_id, move |slot| async move {
        // Registered until the run ends; the shared trigger settles through this task's claim.
        let _slot = slot;
        let Err(e) = openobserve_core::alerts::incidents::trigger_rca_for_incident(
            run.org_id.clone(),
            run.incident_id.clone(),
            true,
            true,
            user_email,
            run.trigger,
            usage_permit,
        )
        .await
        else {
            return;
        };
        log::warn!(
            "[INCIDENTS::RCA] Background reanalysis failed for {}: {e}",
            run.incident_id
        );
        if rca_tasks::settle_current_rca_task() {
            let failed = config::meta::alerts::incidents::IncidentEvent::ai_analysis_failed(
                "Manual reanalysis background task failed",
                config::meta::alerts::incidents::AnalysisTriggerType::Manual,
                Some(format!("{:#}", e)),
            );
            let _ =
                openobserve_core::incidents::append_event(&run.org_id, &run.incident_id, failed)
                    .await;
        }
    });
    begun.hand_off();

    axum::response::Response::builder()
        .status(axum::http::StatusCode::ACCEPTED)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"message": "Analysis started"}).to_string(),
        ))
        .unwrap()
}

/// Streams a run that outlives the request: a closed tab neither stops nor loses it.
#[cfg(feature = "enterprise")]
async fn stream_rca(
    begun: openobserve_core::alerts::rca_tasks::BegunRun,
    client: &o2_enterprise::enterprise::ai::client::AiAgentClient,
    context: &config::meta::oncall::RcaContext,
    auth_header: &str,
    policy: &o2_enterprise::enterprise::ai::client::TurnPolicy,
    run: openobserve_core::alerts::rca_tasks::IncidentRun,
) -> Response {
    use o2_enterprise::enterprise::alerts::rca_service;

    let upstream =
        match rca_service::open_incident_stream(client, context, auth_header, policy).await {
            Ok(upstream) => upstream,
            Err(e) => {
                begun.fail(
                    config::meta::alerts::incidents::IncidentEvent::ai_analysis_failed(
                        "Stream start failed",
                        config::meta::alerts::incidents::AnalysisTriggerType::Manual,
                        Some(format!("{:#}", e)),
                    ),
                );
                log::error!("[INCIDENTS::RCA] stream start for {}: {e}", run.incident_id);
                return agent_unavailable("Failed to start RCA stream");
            }
        };
    let (org_id, incident_id) = (run.org_id.clone(), run.incident_id.clone());
    let frames =
        openobserve_core::alerts::rca_tasks::spawn_rca_stream(&org_id, &incident_id, upstream, run);
    begun.hand_off();

    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "text/event-stream")
        .body(axum::body::Body::from_stream(frames))
        .unwrap()
}

/// Runs a non-streamed analysis as the incident's registered task and waits for it.
#[cfg(feature = "enterprise")]
async fn run_rca(
    begun: openobserve_core::alerts::rca_tasks::BegunRun,
    client: o2_enterprise::enterprise::ai::client::AiAgentClient,
    context: config::meta::oncall::RcaContext,
    auth_header: String,
    policy: o2_enterprise::enterprise::ai::client::TurnPolicy,
    run: openobserve_core::alerts::rca_tasks::IncidentRun,
) -> Response {
    use config::meta::alerts::incidents::{AnalysisTriggerType, IncidentEvent};

    let (org_id, incident_id) = (run.org_id.clone(), run.incident_id.clone());
    let task = openobserve_core::alerts::rca_tasks::spawn_rca_task(
        &org_id,
        &incident_id,
        move |slot| async move {
            let report = o2_enterprise::enterprise::alerts::rca_service::query_incident_report(
                &client,
                &context,
                &auth_header,
                &policy,
            )
            .await;
            // Claimed before saving, so a cancel during the save finds the run settling.
            if !slot.settle() {
                return None;
            }
            let result = save_completed_report(&run, report).await;
            let event = match &result {
                Ok(_) => IncidentEvent::ai_analysis_complete(),
                Err(e) => IncidentEvent::ai_analysis_failed(
                    "Service call failed",
                    AnalysisTriggerType::Manual,
                    Some(format!("{:#}", e)),
                ),
            };
            let _ = openobserve_core::incidents::append_event(&run.org_id, &run.incident_id, event)
                .await;
            Some(result)
        },
    );
    begun.hand_off();
    match task.await {
        Ok(Some(Ok(rca_content))) => MetaHttpResponse::json(RcaResponse { rca_content }),
        Ok(Some(Err(e))) => {
            log::error!("[INCIDENTS::RCA] analysis for {incident_id}: {e}");
            rca_error(AiErrorCode::Internal, "Failed to perform RCA")
        }
        Ok(None) => rca_error(AiErrorCode::TurnExpired, "The analysis was cancelled"),
        Err(e) if e.is_cancelled() => {
            rca_error(AiErrorCode::TurnExpired, "The analysis was cancelled")
        }
        Err(e) => {
            log::error!("[INCIDENTS::RCA] analysis task for {incident_id} panicked: {e}");
            // A panic ends the task before its own terminal write, the last thing it does.
            let failed = IncidentEvent::ai_analysis_failed(
                "Service call failed",
                AnalysisTriggerType::Manual,
                None,
            );
            let _ = openobserve_core::incidents::append_event(&org_id, &incident_id, failed).await;
            rca_error(AiErrorCode::Internal, "Failed to perform RCA")
        }
    }
}

/// Saves the agent's answer as the current report; an empty answer is a failed run.
#[cfg(feature = "enterprise")]
async fn save_completed_report(
    run: &openobserve_core::alerts::rca_tasks::IncidentRun,
    report: anyhow::Result<String>,
) -> anyhow::Result<String> {
    let report = report?;
    let saved = o2_enterprise::enterprise::alerts::rca_service::save_rca_run(
        &run.org_id,
        &run.incident_id,
        &report,
        run.trigger,
        config::meta::alerts::incidents::RcaEndedReason::Completed,
    )
    .await?;
    match saved {
        Some(_) => Ok(report),
        None => anyhow::bail!("the agent finished without writing a report"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_limit() {
        assert_eq!(default_limit(), 50);
    }

    #[test]
    fn test_list_incidents_query_defaults() {
        let query = ListIncidentsQuery {
            status: None,
            limit: default_limit(),
            offset: 0,
        };
        assert_eq!(query.limit, 50);
        assert_eq!(query.offset, 0);
        assert!(query.status.is_none());
    }

    #[test]
    fn test_list_incidents_query_with_status() {
        let query = ListIncidentsQuery {
            status: Some("open".to_string()),
            limit: 100,
            offset: 25,
        };
        assert_eq!(query.status.unwrap(), "open");
        assert_eq!(query.limit, 100);
        assert_eq!(query.offset, 25);
    }

    #[test]
    fn test_list_incidents_response_structure() {
        let response = ListIncidentsResponse {
            incidents: vec![],
            total: 0,
        };
        assert_eq!(response.incidents.len(), 0);
        assert_eq!(response.total, 0);
    }

    #[test]
    fn test_list_incidents_response_with_data() {
        let incident = config::meta::alerts::incidents::Incident {
            id: "test-id".to_string(),
            org_id: "default".to_string(),
            status: config::meta::alerts::incidents::IncidentStatus::Open,
            severity: config::meta::alerts::incidents::IncidentSeverity::P1,
            topology_context: None,
            first_alert_at: 1000,
            last_alert_at: 2000,
            resolved_at: None,
            alert_count: 5,
            title: Some("Test Incident".to_string()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 1000,
            updated_at: 2000,
            group_values: serde_json::Value::Object(Default::default()),
            key_type: config::meta::alerts::incidents::KeyType::default(),
            muted_by_downtime_id: None,
        };

        let response = ListIncidentsResponse {
            incidents: vec![incident],
            total: 1,
        };
        assert_eq!(response.incidents.len(), 1);
        assert_eq!(response.total, 1);
        assert_eq!(response.incidents[0].id, "test-id");
        assert_eq!(response.incidents[0].alert_count, 5);
    }

    #[test]
    fn test_update_severity_enum() {
        assert_eq!(IncidentSeverity::P1.as_str(), "P1");
        assert_eq!(IncidentSeverity::P2.as_str(), "P2");
        assert_eq!(IncidentSeverity::P3.as_str(), "P3");
        assert_eq!(IncidentSeverity::P4.as_str(), "P4");
    }

    #[test]
    fn test_update_status_enum() {
        assert_eq!(IncidentStatus::Open.as_str(), "open");
        assert_eq!(IncidentStatus::Acknowledged.as_str(), "acknowledged");
        assert_eq!(IncidentStatus::Resolved.as_str(), "resolved");
    }

    #[test]
    fn test_update_payload_title_serialization() {
        let payload = UpdatePayload::Title {
            title: "New Incident Title".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("New Incident Title"));
        assert!(json.contains("title"));
    }

    #[test]
    fn test_update_payload_severity_serialization() {
        let payload = UpdatePayload::Severity {
            severity: IncidentSeverity::P1,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("P1"));
        assert!(json.contains("severity"));
    }

    #[test]
    fn test_update_payload_status_serialization() {
        let payload = UpdatePayload::Status {
            status: IncidentStatus::Acknowledged,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("acknowledged"));
        assert!(json.contains("status"));
    }

    #[test]
    fn test_update_payload_title_deserialization() {
        let json = r#"{"title":"Critical Production Issue"}"#;
        let payload: UpdatePayload = serde_json::from_str(json).unwrap();
        match payload {
            UpdatePayload::Title { title } => {
                assert_eq!(title, "Critical Production Issue");
            }
            _ => panic!("Expected Title variant"),
        }
    }

    #[test]
    fn test_update_payload_severity_deserialization() {
        let json = r#"{"severity":"P2"}"#;
        let payload: UpdatePayload = serde_json::from_str(json).unwrap();
        match payload {
            UpdatePayload::Severity { severity } => {
                assert_eq!(severity, IncidentSeverity::P2);
            }
            _ => panic!("Expected Severity variant"),
        }
    }

    #[test]
    fn test_update_payload_status_deserialization() {
        let json = r#"{"status":"resolved"}"#;
        let payload: UpdatePayload = serde_json::from_str(json).unwrap();
        match payload {
            UpdatePayload::Status { status } => {
                assert_eq!(status, IncidentStatus::Resolved);
            }
            _ => panic!("Expected Status variant"),
        }
    }

    #[test]
    fn test_update_status_serde_roundtrip() {
        for status in [
            IncidentStatus::Open,
            IncidentStatus::Acknowledged,
            IncidentStatus::Resolved,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let deserialized: IncidentStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, deserialized);
        }
    }

    #[test]
    fn test_update_severity_serde_roundtrip() {
        for severity in [
            IncidentSeverity::P1,
            IncidentSeverity::P2,
            IncidentSeverity::P3,
            IncidentSeverity::P4,
        ] {
            let json = serde_json::to_string(&severity).unwrap();
            let deserialized: IncidentSeverity = serde_json::from_str(&json).unwrap();
            assert_eq!(severity, deserialized);
        }
    }

    #[test]
    fn test_update_severity_equality() {
        assert_eq!(IncidentSeverity::P1, IncidentSeverity::P1);
        assert_ne!(IncidentSeverity::P1, IncidentSeverity::P2);
        assert_ne!(IncidentSeverity::P3, IncidentSeverity::P4);
    }

    #[test]
    fn test_update_status_equality() {
        assert_eq!(IncidentStatus::Open, IncidentStatus::Open);
        assert_ne!(IncidentStatus::Open, IncidentStatus::Acknowledged);
        assert_ne!(IncidentStatus::Acknowledged, IncidentStatus::Resolved);
    }

    #[cfg(feature = "enterprise")]
    async fn body_of(response: Response) -> (u16, serde_json::Value) {
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn rca_refusals_carry_their_code_and_keep_the_legacy_error_text() {
        for (response, status, code, error, reason) in [
            (
                rca_disabled(RCA_NOT_ENABLED, "rca_off"),
                400,
                "rca_disabled",
                "RCA is not enabled",
                Some("rca_off"),
            ),
            (
                rca_disabled(OFF_FOR_PRIORITY, "priority_off"),
                400,
                "rca_disabled",
                "AI SRE is turned off for this incident's priority",
                Some("priority_off"),
            ),
            (
                rca_error(AiErrorCode::AnalysisInProgress, ANALYSIS_IN_PROGRESS),
                400,
                "analysis_in_progress",
                "Analysis already in progress",
                None,
            ),
            (
                agent_unavailable("RCA agent URL is not configured"),
                503,
                "agent_unavailable",
                "RCA agent URL is not configured",
                None,
            ),
        ] {
            let (got, body) = body_of(response).await;
            assert_eq!(got, status, "{body}");
            assert_eq!(body["code"], code);
            assert_eq!(body["error"], error);
            assert_eq!(body["message"], error);
            assert_eq!(body.get("reason").and_then(|r| r.as_str()), reason);
            assert!(!body.to_string().contains("http"), "{body}");
        }
    }

    #[test]
    fn rca_history_items_carry_trigger_and_ended_reason() {
        use config::meta::alerts::incidents::{
            IncidentTopology, RcaEndedReason, RcaReportMeta, RcaTrigger,
        };
        let mut topology = IncidentTopology::default();
        topology.record_rca_report(
            "first",
            Some(RcaReportMeta {
                report_id: "r1".into(),
                trigger: Some(RcaTrigger::Manual),
                ended_reason: Some(RcaEndedReason::Completed),
                created_at: 1,
            }),
            25,
        );
        topology.record_rca_report(
            "second",
            Some(RcaReportMeta {
                report_id: "r2".into(),
                trigger: Some(RcaTrigger::BuildOnPrevious),
                ended_reason: Some(RcaEndedReason::Interrupted),
                created_at: 2,
            }),
            25,
        );
        let outcomes = [("r1".to_string(), "partly".to_string())].into();
        let json = serde_json::to_value(RcaHistoryResponse::new(topology, &outcomes)).unwrap();
        assert_eq!(json["current"], "second");
        assert_eq!(
            json["current_report"]["my_outcome"],
            serde_json::Value::Null
        );
        assert_eq!(json["previous"][0]["my_outcome"], "partly");
        assert_eq!(json["previous"][0]["content"], "first");
        assert_eq!(json["current_report"]["report_id"], "r2");
        assert_eq!(json["current_report"]["trigger"], "build_on_previous");
        assert_eq!(json["current_report"]["ended_reason"], "interrupted");
        assert_eq!(json["previous"][0]["report_id"], "r1");
        assert_eq!(json["previous"][0]["trigger"], "manual");
        assert_eq!(json["previous"][0]["ended_reason"], "completed");
        let empty = serde_json::to_value(RcaHistoryResponse::default()).unwrap();
        assert_eq!(empty, serde_json::json!({"current": null, "previous": []}));
    }

    #[test]
    fn rca_feedback_body_is_typed_and_bounded() {
        let body: RcaFeedbackRequest =
            serde_json::from_value(serde_json::json!({"report_id": "r1", "outcome": "partly"}))
                .unwrap();
        assert_eq!(body.outcome, RcaOutcome::Partly);
        assert!(body.problem().is_none());
        for outcome in ["yes", "partly", "no"] {
            let parsed: RcaOutcome = serde_json::from_value(serde_json::json!(outcome)).unwrap();
            assert_eq!(parsed.as_str(), outcome);
        }
        assert!(
            serde_json::from_value::<RcaFeedbackRequest>(
                serde_json::json!({"report_id": "r1", "outcome": "maybe"})
            )
            .is_err()
        );
        let blank = RcaFeedbackRequest {
            report_id: " ".into(),
            outcome: RcaOutcome::Yes,
            reason: None,
        };
        assert_eq!(blank.problem(), Some("report_id is required"));
        let long = RcaFeedbackRequest {
            report_id: "r1".into(),
            outcome: RcaOutcome::No,
            reason: Some("x".repeat(RCA_FEEDBACK_REASON_MAX + 1)),
        };
        assert!(long.problem().is_some());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_bad_feedback_body_answers_with_the_error_envelope() {
        use axum::extract::FromRequest;
        let request = |content_type: &str, body: &str| {
            axum::http::Request::builder()
                .method("POST")
                .header("content-type", content_type)
                .body(axum::body::Body::from(body.to_string()))
                .unwrap()
        };
        let good = r#"{"report_id": "r1", "outcome": "no", "reason": "pool"}"#;
        for (content_type, body) in [
            (
                "application/json",
                r#"{"report_id": "r1", "outcome": "maybe"}"#,
            ),
            ("application/json", r#"{"outcome": "yes"}"#),
            ("application/json", "not json"),
            ("text/plain", good),
            (
                "application/json",
                r#"{"report_id": " ", "outcome": "yes"}"#,
            ),
        ] {
            let parsed =
                Json::<RcaFeedbackRequest>::from_request(request(content_type, body), &()).await;
            let refusal = feedback_body(parsed).unwrap_err();
            let (status, json) = body_of(refusal).await;
            assert_eq!(status, 400, "{body}");
            assert_eq!(json["code"], "invalid_request", "{body}");
        }
        let parsed =
            Json::<RcaFeedbackRequest>::from_request(request("application/json", good), &()).await;
        assert_eq!(feedback_body(parsed).unwrap().outcome, RcaOutcome::No);
    }

    #[test]
    fn a_stored_outcome_reads_back_as_the_wire_value() {
        for outcome in [RcaOutcome::Yes, RcaOutcome::Partly, RcaOutcome::No] {
            assert_eq!(RcaOutcome::from_stored(outcome.as_str()), Some(outcome));
        }
        assert_eq!(RcaOutcome::from_stored("maybe"), None);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn feedback_is_accepted_only_for_a_report_of_this_incident() {
        use config::meta::alerts::incidents::{IncidentTopology, RcaReportMeta};
        let meta = |id: &str| RcaReportMeta {
            report_id: id.into(),
            trigger: None,
            ended_reason: None,
            created_at: 0,
        };
        let mut topology = IncidentTopology::default();
        topology.record_rca_report("a", Some(meta("r1")), 25);
        topology.record_rca_report("b", Some(meta("r2")), 25);
        assert!(has_report(&topology, "r1"));
        assert!(has_report(&topology, "r2"));
        assert!(!has_report(&topology, "r3"));
        assert!(!has_report(&IncidentTopology::default(), "r1"));
    }
}
