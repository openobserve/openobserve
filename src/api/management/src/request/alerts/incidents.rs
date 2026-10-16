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
                    // A live run blocks a new one (RR-9, RR-10); read from the run summary.
                    let in_flight =
                        match infra::table::alert_incidents::get(&org_id, &incident_id).await {
                            Ok(Some(row)) => row
                                .rca_state
                                .as_deref()
                                .and_then(|s| {
                                    s.parse::<config::meta::alerts::rca_runs::RunState>().ok()
                                })
                                .is_some_and(|state| {
                                    config::meta::alerts::rca_runs::is_live_blocking(
                                        state,
                                        row.rca_updated_at
                                            .or(row.rca_started_at)
                                            .unwrap_or_default(),
                                        config::utils::time::now_micros(),
                                        o2_enterprise::enterprise::common::config::get_config()
                                            .incidents
                                            .rca_timeout_secs,
                                    )
                                }),
                            _ => false,
                        };
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

/// Response for a started RCA analysis (202)
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaStartedResponse {
    pub message: String,
    /// The started run
    pub run_id: String,
}

/// Response for cancelling an in-flight RCA analysis
#[derive(Debug, Serialize, ToSchema)]
pub struct CancelRcaResponse {
    /// The cancelled run
    pub run_id: String,
    /// Always true: a cancel that ended nothing answers 400
    pub cancelled: bool,
}

/// Default page size of the incident's run list.
pub const RCA_RUNS_DEFAULT_LIMIT: u64 = 25;
/// Largest page size of the incident's run list.
pub const RCA_RUNS_MAX_LIMIT: u64 = 100;

/// Query parameters for listing an incident's analysis runs
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct ListRcaRunsQuery {
    /// Page size (default 25, max 100)
    #[serde(default)]
    pub limit: Option<u64>,
    /// Return runs older than this run id (the last run of the previous page)
    #[serde(default)]
    pub before: Option<String>,
}

/// Query parameters for reading an analysis run's investigation thread
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct RcaThreadQuery {
    /// The `state_version` of the caller's copy; an equal version returns `not_modified`
    #[serde(default)]
    pub known_version: Option<String>,
}

/// Query parameters for RCA trigger
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TriggerRcaQuery {
    /// Accepted for compatibility; every run starts in the background and answers 202.
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
    description = "Starts a root cause analysis run for an incident and returns 202 with the run id as soon as its investigation turn is spawned. Follow the run through the run list and its thread.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        TriggerRcaQuery,
    ),
    responses(
        (status = 202, description = "Analysis started", content_type = "application/json", body = RcaStartedResponse),
        (status = 400, description = "RCA not enabled, or an analysis is already in progress", content_type = "application/json", body = ()),
        (status = 402, description = "AI credits exhausted", content_type = "application/json", body = ()),
        (status = 412, description = "Paid usage requires organization consent", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 429, description = "Too many analyses running; body {error_code: \"turn_limit\", message}", content_type = "application/json", body = Object),
        (status = 500, description = "SRE agent credentials could not be read", content_type = "application/json", body = Object),
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
    use config::meta::alerts::rca_runs::{RunMode, RunTrigger};
    #[cfg(feature = "cloud")]
    use o2_enterprise::enterprise::alerts::rca_service;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    use openobserve_core::alerts::rca_runs;

    let o2_cfg = get_o2_config();

    // Check if RCA is enabled
    if !o2_cfg.incidents.enabled || !o2_cfg.incidents.rca_enabled {
        return MetaHttpResponse::bad_request("RCA is not enabled");
    }

    if !o2_cfg.ai.has_agent_target() {
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::json!({"error": "RCA agent URL is not configured"}).to_string(),
            ))
            .unwrap();
    }

    // Validate the incident before consuming quota or starting a run. Existence check
    // only: the builder below re-derives the context, so read the one row rather than hydrating
    // every alert on the incident.
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found("Incident not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    // A first analysis is `manual`; once a run has completed, any further one is a
    // `reanalyze` (RR-7). The Cloud usage feature follows the same predicate.
    let has_completed_run =
        match infra::table::rca_runs::newest_completed_for_incident(&org_id, &incident_id).await {
            Ok(run) => run.is_some(),
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
    let trigger = if has_completed_run {
        RunTrigger::Reanalyze
    } else {
        RunTrigger::Manual
    };

    // Cloud: refuse a request that cannot be paid for, without metering it. Usage is
    // metered only right before the agent is called, so a refused start or an earlier
    // failure never costs a credit (precheck → start → authorize, as `chat_stream` does).
    #[cfg(feature = "cloud")]
    let (usage_feature, usage_context) = {
        let feature = if has_completed_run {
            openobserve_core::trial_quota::TrialQuotaFeature::IncidentReAnalysis
        } else {
            openobserve_core::trial_quota::TrialQuotaFeature::NewIncident
        };
        if let Err(error) =
            openobserve_core::trial_quota::precheck_ai_usage(&org_id, feature, &user_email.user_id)
                .await
        {
            return crate::request::ai::chat::ai_authorization_error_response(error);
        }
        let usage_context = openobserve_core::trial_quota::AiUsageContext {
            user_email: user_email.user_id.clone(),
            incident_id: Some(incident_id.clone()),
            ..Default::default()
        };
        (feature, usage_context)
    };

    // Start the run. The start transaction is the in-flight guard (RR-5, RR-9) and
    // appends the Begin event; user-started runs skip the cooldown (RR-8).
    let run_id = match rca_runs::start_run(rca_runs::StartRun {
        org_id: org_id.clone(),
        subject: rca_runs::RunSubject::Incident(incident_id.clone()),
        trigger,
        mode: if query.build_on_previous {
            RunMode::BuildOnPrevious
        } else {
            RunMode::Fresh
        },
        started_by: user_email.user_id.clone(),
        guidance: None,
        skip_cooldown: true,
        oncall_subjects: None,
    })
    .await
    {
        Ok(rca_runs::StartOutcome::Started { run_id }) => run_id,
        Ok(rca_runs::StartOutcome::InFlight) | Ok(rca_runs::StartOutcome::CoolingDown) => {
            return MetaHttpResponse::bad_request("Analysis already in progress");
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(format!("Failed to start analysis: {e}"));
        }
    };

    // The run is started, so the rest runs in its own task: a client that disconnects
    // drops only this wait, and the task still ends the run (RR-13). The task returns once
    // the investigation turn is spawned; the turn's finalizer ends the run (TH12, TH13).
    let task = tokio::spawn(async move {
        // Meter usage only now, after the start: a refused start never costs a credit.
        #[cfg(feature = "cloud")]
        let usage_permit = match openobserve_core::trial_quota::authorize_ai_usage(
            &org_id,
            usage_feature,
            &usage_context,
        )
        .await
        {
            Ok(permit) => Some(permit),
            Err(error) => {
                match rca_runs::fail_run(
                    &org_id,
                    &run_id,
                    trigger,
                    rca_runs::ERROR_USAGE_DENIED,
                    rca_runs::USAGE_DENIED_REASON,
                    Some(error.to_string()),
                )
                .await
                {
                    // A run that ended delivers no verdict, so it frees the page it held.
                    Ok(true) => {
                        rca_service::skip_analysis_for_incident(&org_id, &incident_id).await
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::error!("[INCIDENTS::RCA] Failed to end run {run_id} as failed: {e}")
                    }
                }
                return crate::request::ai::chat::ai_authorization_error_response(error);
            }
        };
        #[cfg(not(feature = "cloud"))]
        let usage_permit = None;

        // Every error has already ended the run with the turn's code and freed its page.
        match openobserve_core::alerts::incidents::trigger_rca_for_incident(
            org_id,
            incident_id,
            run_id.clone(),
            trigger,
            user_email.user_id,
            query.build_on_previous,
            usage_permit,
        )
        .await
        {
            Ok(()) => rca_started_response(run_id),
            Err(e) => rca_turn_error_response(&e),
        }
    });
    match task.await {
        Ok(response) => response,
        Err(e) => MetaHttpResponse::internal_error(format!("The analysis task failed: {e}")),
    }
}

/// `202 {message, run_id}`: the run is started and its turn spawned (TH13).
#[cfg(feature = "enterprise")]
fn rca_started_response(run_id: String) -> Response {
    json_status_response(
        axum::http::StatusCode::ACCEPTED,
        serde_json::to_value(RcaStartedResponse {
            message: "Analysis started".to_string(),
            run_id,
        })
        .unwrap_or_default(),
    )
}

/// The answer for a run whose turn could not start; the run is already failed with the code.
/// The body carries fixed messages only: the details (agent URL, upstream errors) go to the
/// log.
#[cfg(feature = "enterprise")]
fn rca_turn_error_response(error: &openobserve_core::alerts::rca_turn::RcaTurnError) -> Response {
    use axum::http::StatusCode;
    use openobserve_core::alerts::{incidents::TURN_LIMIT_REASON, rca_turn::RcaTurnError};

    let (status, message) = match error {
        RcaTurnError::TurnLimit => (StatusCode::TOO_MANY_REQUESTS, TURN_LIMIT_REASON),
        RcaTurnError::AgentUnavailable(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "The AI SRE agent is not reachable",
        ),
        RcaTurnError::Credentials(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to get SRE agent credentials",
        ),
        RcaTurnError::Busy => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "The analysis session is busy",
        ),
        RcaTurnError::Other(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to start the analysis",
        ),
    };
    log::warn!(
        "[INCIDENTS::RCA] analysis turn did not start ({}): {error:?}",
        error.error_code()
    );
    json_status_response(
        status,
        serde_json::json!({ "error_code": error.error_code(), "message": message }),
    )
}

#[cfg(feature = "enterprise")]
fn json_status_response(status: axum::http::StatusCode, body: serde_json::Value) -> Response {
    axum::response::Response::builder()
        .status(status)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap()
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
    description = "Cancels the running root cause analysis: the run ends `cancelled`, its investigation turn is stopped, and the in-flight guard is released so a new analysis can be started immediately.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
    ),
    responses(
        (status = 200, description = "Analysis cancelled", content_type = "application/json", body = CancelRcaResponse),
        (status = 400, description = "Analysis is not running", content_type = "application/json", body = ()),
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
    // The live-run check lives inside cancel_rca_run, in the same compare-and-set that ends
    // the run, so a run started meanwhile is never cancelled in its place (RR-19, TH41).
    match openobserve_core::alerts::rca_turn::cancel_rca_run(
        &org_id,
        &incident_id,
        &user_email.user_id,
    )
    .await
    {
        // Nothing running — report it rather than writing a spurious terminal event.
        Ok(None) => MetaHttpResponse::bad_request("Analysis is not running"),
        Ok(Some(run_id)) => MetaHttpResponse::json(CancelRcaResponse {
            run_id,
            cancelled: true,
        }),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to cancel analysis: {e}")),
    }
}

#[cfg(feature = "enterprise")]
/// ListIncidentRcaRuns
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRcaRuns",
    summary = "List the analysis runs of an incident",
    description = "Returns the incident's analysis runs, newest first, without report text. Page with `before` set to the last run id of the previous page.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ListRcaRunsQuery,
    ),
    responses(
        (status = 200, description = "Analysis runs", content_type = "application/json", body = config::meta::alerts::rca_runs::ListRcaRunsResponse),
        (status = 404, description = "Incident not found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List past incident RCA runs", "category": "alerts"}))
    )
)]
pub async fn list_incident_rca_runs(
    Path((org_id, incident_id)): Path<(String, String)>,
    Query(query): Query<ListRcaRunsQuery>,
) -> Response {
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found("Incident not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }
    let limit = query
        .limit
        .unwrap_or(RCA_RUNS_DEFAULT_LIMIT)
        .clamp(1, RCA_RUNS_MAX_LIMIT);
    match infra::table::rca_runs::list_for_incident(
        &org_id,
        &incident_id,
        limit,
        query.before.as_deref(),
    )
    .await
    {
        Ok((runs, has_more)) => {
            MetaHttpResponse::json(config::meta::alerts::rca_runs::ListRcaRunsResponse {
                runs: runs.iter().map(infra::table::rca_runs::to_item).collect(),
                has_more,
            })
        }
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaRun
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaRun",
    summary = "Get one analysis run of an incident",
    description = "Returns one analysis run of the incident, including its report and error.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
    ),
    responses(
        (status = 200, description = "Analysis run", content_type = "application/json", body = config::meta::alerts::rca_runs::RcaRun),
        (status = 404, description = "Run not found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
    )
)]
pub async fn get_incident_rca_run(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
) -> Response {
    match infra::table::rca_runs::get(&org_id, &run_id).await {
        Ok(Some(run)) if run.incident_id.as_deref() == Some(incident_id.as_str()) => {
            MetaHttpResponse::json(infra::table::rca_runs::to_run(run))
        }
        Ok(_) => MetaHttpResponse::not_found("Run not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaThread
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/thread",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaThread",
    summary = "Get the investigation thread of an analysis run",
    description = "Returns the steps, notes and tool calls of one analysis run of the incident. Pass the last `state_version` as `known_version` to get `not_modified` when nothing changed. Tool input and output show only when the org setting `ai_rca_thread_tool_output` is on.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
        RcaThreadQuery,
    ),
    responses(
        (status = 200, description = "Investigation thread, or `{not_modified: true, state_version}`", content_type = "application/json", body = openobserve_core::ai_chat::rca_thread::RcaThread),
        (status = 404, description = "Run not found", content_type = "application/json", body = ()),
        (status = 410, description = "The run's transcript expired (`error_code: transcript_expired`)", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
        (status = 503, description = "The transcript could not be read in full (`error_code: history_unavailable`)", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
    )
)]
pub async fn get_incident_rca_thread(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Query(query): Query<RcaThreadQuery>,
) -> Response {
    use axum::{http::StatusCode, response::IntoResponse};
    use config::meta::alerts::rca_runs::RunState;
    use openobserve_core::{
        ai_chat::rca_thread::{self, RcaThread, Transcript},
        alerts::rca_turn::RcaTurnError,
    };

    let error_body = |status: StatusCode, message: &str, error_code: &str| {
        (
            status,
            Json(serde_json::json!({
                "code": status.as_u16(),
                "message": message,
                "error_code": error_code,
            })),
        )
            .into_response()
    };

    let run = match infra::table::rca_runs::get(&org_id, &run_id).await {
        Ok(Some(run)) if run.incident_id.as_deref() == Some(incident_id.as_str()) => run,
        Ok(_) => return MetaHttpResponse::not_found("Run not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let state = run.state.parse::<RunState>().ok();
    let active = state.is_some_and(|state| state.is_live());
    let terminal = state.is_some_and(|state| state.is_terminal());

    let no_transcript = || {
        let version = rca_thread::state_version(-1, 0, run.updated_at, false);
        MetaHttpResponse::json(RcaThread::without_transcript(
            &run_id,
            version,
            active,
            Transcript::None,
        ))
    };
    let Some(session_id) = run.session_id.as_deref() else {
        // A run from before the thread existed has no transcript (TH30).
        return no_transcript();
    };
    let session = match infra::table::ai_chat_sessions::get(&org_id, session_id).await {
        Ok(Some(session)) => session,
        Ok(None) => {
            // A run whose turn never started has its session id but never had a session.
            let start_failure = run
                .error
                .as_ref()
                .and_then(|error| error.get("code"))
                .and_then(serde_json::Value::as_str)
                .is_some_and(RcaTurnError::is_start_code);
            if start_failure {
                return no_transcript();
            }
            return error_body(
                StatusCode::GONE,
                "This analysis transcript has expired",
                "transcript_expired",
            );
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let show_tool_io =
        match db::organization::get_org_setting_ai_rca_thread_tool_output(&org_id).await {
            Ok(show) => show,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

    let version = rca_thread::state_version(
        session.last_committed_seq,
        session.updated_at,
        run.updated_at,
        show_tool_io,
    );
    if query.known_version.as_deref() == Some(version.as_str()) {
        return MetaHttpResponse::json(serde_json::json!({
            "not_modified": true,
            "state_version": version,
        }));
    }

    let events = match openobserve_core::ai_chat::read_committed_events(&session, -1).await {
        Ok(events) => events,
        Err(e) => return read_error_response(&run_id, session_id, terminal, &e),
    };
    let turns = match infra::table::ai_chat_turns::list_for_session(&org_id, session_id).await {
        Ok(turns) => turns,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let mut thread = rca_thread::project_rca_thread(&events, &turns, active, show_tool_io);
    thread.run_id = run_id;
    thread.state_version = version;
    MetaHttpResponse::json(thread)
}

/// The answer for a thread whose committed events could not be read. A partial thread is
/// never presented as whole. An ended run's history never grows again, so a missing or
/// bad event there is final (410 `transcript_incomplete`), not worth a retry; anything
/// else, or a live run, is 503 `history_unavailable`.
#[cfg(feature = "enterprise")]
fn read_error_response(
    run_id: &str,
    session_id: &str,
    terminal: bool,
    error: &openobserve_core::ai_chat::ReadError,
) -> Response {
    use axum::{http::StatusCode, response::IntoResponse};
    use openobserve_core::ai_chat::ReadError;

    let (status, message, error_code) = match error {
        ReadError::Gap { .. } | ReadError::Divergence { .. } | ReadError::Corrupt(_)
            if terminal =>
        {
            log::warn!(
                "[INCIDENTS::RCA] thread of run {run_id} (session {session_id}) is incomplete: {error}"
            );
            (
                StatusCode::GONE,
                "Part of this analysis transcript could not be read",
                "transcript_incomplete",
            )
        }
        // Logged and counted by the reader.
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            "This analysis transcript could not be read in full; please retry",
            "history_unavailable",
        ),
    };
    (
        status,
        Json(serde_json::json!({
            "code": status.as_u16(),
            "message": message,
            "error_code": error_code,
        })),
    )
        .into_response()
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
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentRcaRuns",
    summary = "List the analysis runs of an incident",
    description = "Returns the incident's analysis runs, newest first. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ListRcaRunsQuery,
    ),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List past incident RCA runs", "category": "alerts"}))
    )
)]
pub async fn list_incident_rca_runs(
    _path: Path<(String, String)>,
    _query: Query<ListRcaRunsQuery>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaRun",
    summary = "Get one analysis run of an incident",
    description = "Returns one analysis run of the incident. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
    ),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
    )
)]
pub async fn get_incident_rca_run(_path: Path<(String, String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/thread",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaThread",
    summary = "Get the investigation thread of an analysis run",
    description = "Returns the investigation thread of one analysis run. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
        RcaThreadQuery,
    ),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
    )
)]
pub async fn get_incident_rca_thread(
    _path: Path<(String, String, String)>,
    _query: Query<RcaThreadQuery>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
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
            rca: None,
            rca_off_reason: None,
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

    /// TH13: the trigger answer names the started run.
    #[test]
    fn test_rca_started_response_carries_the_run_id() {
        let json = serde_json::to_value(RcaStartedResponse {
            message: "Analysis started".to_string(),
            run_id: "2abc".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"message": "Analysis started", "run_id": "2abc"})
        );
    }

    /// TH41: the cancel answer names the run it ended.
    #[test]
    fn test_cancel_rca_response_shape() {
        let json = serde_json::to_value(CancelRcaResponse {
            run_id: "2abc".to_string(),
            cancelled: true,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"run_id": "2abc", "cancelled": true})
        );
    }

    /// RR-30: the run list pages with `limit` and `before`, and its items carry no report.
    #[test]
    fn test_list_rca_runs_query_and_response_shape() {
        use config::meta::alerts::rca_runs::{
            ListRcaRunsResponse, RcaRunItem, RunMode, RunState, RunSubjectType, RunTrigger,
        };

        let empty: ListRcaRunsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!((empty.limit, empty.before), (None, None));
        let page: ListRcaRunsQuery =
            serde_json::from_str(r#"{"limit": 10, "before": "2abc"}"#).unwrap();
        assert_eq!(
            (page.limit, page.before.as_deref()),
            (Some(10), Some("2abc"))
        );
        const { assert!(RCA_RUNS_DEFAULT_LIMIT <= RCA_RUNS_MAX_LIMIT) };

        let json = serde_json::to_value(ListRcaRunsResponse {
            runs: vec![RcaRunItem {
                run_id: "2abc".to_string(),
                subject_type: RunSubjectType::Incident,
                trigger: RunTrigger::Reanalyze,
                mode: RunMode::BuildOnPrevious,
                started_by: "a.rao@acme.io".to_string(),
                state: RunState::Cancelled,
                started_at: 1,
                ended_at: Some(2),
                outcome: None,
                confidence: None,
                cancelled_by: Some("a.rao@acme.io".to_string()),
                error_reason: None,
            }],
            has_more: true,
        })
        .unwrap();
        assert_eq!(json["has_more"], true);
        let run = &json["runs"][0];
        assert_eq!(run["run_id"], "2abc");
        assert_eq!(run["subject_type"], "incident");
        assert_eq!(run["trigger"], "reanalyze");
        assert_eq!(run["mode"], "build_on_previous");
        assert_eq!(run["state"], "cancelled");
        assert_eq!(run["cancelled_by"], "a.rao@acme.io");
        assert!(run.get("report").is_none());
    }

    /// RR-28: an incident that was never analyzed serializes `rca: null`.
    #[test]
    fn test_never_analyzed_incident_serializes_rca_null() {
        let incident = config::meta::alerts::incidents::Incident {
            id: "inc".to_string(),
            org_id: "default".to_string(),
            status: config::meta::alerts::incidents::IncidentStatus::Open,
            severity: config::meta::alerts::incidents::IncidentSeverity::P2,
            topology_context: None,
            first_alert_at: 1,
            last_alert_at: 1,
            resolved_at: None,
            alert_count: 1,
            title: None,
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 1,
            updated_at: 1,
            group_values: serde_json::json!({}),
            key_type: config::meta::alerts::incidents::KeyType::default(),
            muted_by_downtime_id: None,
            rca: None,
            rca_off_reason: Some("l0_off".to_string()),
        };
        let json = serde_json::to_value(&incident).unwrap();
        assert!(json.as_object().unwrap().contains_key("rca"));
        assert!(json["rca"].is_null());
        assert_eq!(json["rca_off_reason"], "l0_off");
    }

    #[cfg(feature = "enterprise")]
    async fn status_and_body(resp: Response) -> (axum::http::StatusCode, serde_json::Value) {
        let status = resp.status();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    /// TH13: a started analysis answers 202 with the run it started.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_started_analysis_is_a_202_naming_the_run() {
        let (status, body) = status_and_body(rca_started_response("2abc".to_string())).await;
        assert_eq!(status, axum::http::StatusCode::ACCEPTED);
        assert_eq!(
            body,
            serde_json::json!({"message": "Analysis started", "run_id": "2abc"})
        );
    }

    /// TH10, TH13, D3: a turn that could not start answers with its code and a fixed
    /// message; the error's details (internal hosts, upstream text) never reach the body.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_turn_that_could_not_start_answers_with_its_code() {
        use axum::http::StatusCode;
        use openobserve_core::alerts::rca_turn::RcaTurnError;

        let details = "error sending request for url (http://o2-ai.svc:8080/o2_agent/health)";
        for (error, status, code, message) in [
            (
                RcaTurnError::TurnLimit,
                StatusCode::TOO_MANY_REQUESTS,
                "turn_limit",
                "Too many analyses running",
            ),
            (
                RcaTurnError::AgentUnavailable(details.to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
                "agent_unavailable",
                "The AI SRE agent is not reachable",
            ),
            (
                RcaTurnError::Credentials(details.to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "credentials",
                "Failed to get SRE agent credentials",
            ),
            (
                RcaTurnError::Busy,
                StatusCode::INTERNAL_SERVER_ERROR,
                "busy",
                "The analysis session is busy",
            ),
            (
                RcaTurnError::Other(details.to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "agent_error",
                "Failed to start the analysis",
            ),
        ] {
            let (got, body) = status_and_body(rca_turn_error_response(&error)).await;
            assert_eq!(got, status, "{error:?}");
            assert_eq!(
                body,
                serde_json::json!({"error_code": code, "message": message}),
                "{error:?}"
            );
            let text = body.to_string();
            for leak in ["o2-ai", "svc", "http://", "health"] {
                assert!(!text.contains(leak), "{error:?}: {text}");
            }
        }
    }

    /// The global SQLite meta store with the run and chat tables. Refuses any other store,
    /// so a developer `.env` can never point the test at a real database.
    #[cfg(feature = "enterprise")]
    async fn thread_tables() -> &'static sea_orm::DatabaseConnection {
        use infra::table::entity::{ai_chat_sessions, rca_runs};
        use sea_orm::{ConnectionTrait, Schema};

        let cfg = config::get_config();
        assert!(
            cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite",
            "the thread route test needs the default SQLite meta store, found {:?}",
            cfg.common.meta_store
        );
        std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let schema = Schema::new(backend);
        for mut table in [
            schema.create_table_from_entity(rca_runs::Entity),
            schema.create_table_from_entity(ai_chat_sessions::Entity),
        ] {
            conn.execute(backend.build(table.if_not_exists()))
                .await
                .unwrap();
        }
        conn
    }

    #[cfg(feature = "enterprise")]
    fn thread_run(
        org_id: &str,
        run_id: &str,
        incident_id: &str,
        session_id: Option<&str>,
    ) -> infra::table::entity::rca_runs::Model {
        infra::table::entity::rca_runs::Model {
            run_id: run_id.to_string(),
            org_id: org_id.to_string(),
            subject_type: "incident".to_string(),
            subject_id: incident_id.to_string(),
            incident_id: Some(incident_id.to_string()),
            trigger: "manual".to_string(),
            mode: "fresh".to_string(),
            started_by: "a.rao@acme.io".to_string(),
            guidance: None,
            state: "completed".to_string(),
            started_at: 1_000,
            updated_at: 2_000,
            ended_at: Some(2_000),
            cancelled_by: None,
            outcome: None,
            confidence: None,
            report: Some("report".to_string()),
            result: None,
            error: None,
            session_id: session_id.map(str::to_string),
            stats: None,
            stage: None,
            stage_index: None,
            context_used: None,
            continuations: 0,
            oncall_subjects: None,
        }
    }

    /// TH30, TH31: the thread route answers 404 for a run of another incident, `transcript:
    /// none` for a run without a session, 410 for an expired session, and `not_modified`
    /// when the caller's version is current.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_thread_route_answers_by_run_and_session() {
        use axum::http::StatusCode;
        use infra::table::entity::{ai_chat_sessions, rca_runs};
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let conn = thread_tables().await;
        let org = format!(
            "thread_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let (legacy, live, expired) = ("run_legacy", "run_live", "run_expired");
        let (never_started, failed_later) = ("run_never_started", "run_failed_later");
        let failed = |run_id: &str, session: &str, code: &str| {
            let mut run = thread_run(&org, run_id, "inc_1", Some(session));
            run.state = "failed".to_string();
            run.report = None;
            run.error = Some(serde_json::json!({"code": code, "reason": "r"}));
            run
        };
        for run in [
            thread_run(&org, legacy, "inc_1", None),
            thread_run(&org, live, "inc_1", Some("ses_live")),
            thread_run(&org, expired, "inc_1", Some("ses_gone")),
            failed(never_started, "ses_never", "turn_limit"),
            failed(failed_later, "ses_lost", "agent_error"),
        ] {
            rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
                .exec(conn)
                .await
                .unwrap();
        }
        // The org shows no tool input/output (TH34); cached, as the route reads it.
        let settings_key = format!("/organization/setting/{org}");
        common::infra::config::ORGANIZATION_SETTING
            .write()
            .await
            .insert(settings_key.clone(), Default::default());
        let session = ai_chat_sessions::Model {
            org_id: org.clone(),
            session_id: "ses_live".to_string(),
            user_id: "sys".to_string(),
            user_email: "sys@acme.io".to_string(),
            opencode_session_id: None,
            agent_type: "sre-rca".to_string(),
            title: "Analyze incident inc_1".to_string(),
            title_source: "prompt".to_string(),
            status: "active".to_string(),
            created_at: 1_000,
            updated_at: 1_500,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: 41,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
        };
        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(session).reset_all())
            .exec(conn)
            .await
            .unwrap();

        let read = |incident: &str, run: &str, known: Option<&str>| {
            get_incident_rca_thread(
                Path((org.clone(), incident.to_string(), run.to_string())),
                Query(RcaThreadQuery {
                    known_version: known.map(str::to_string),
                }),
            )
        };

        let (status, _) = status_and_body(read("inc_2", legacy, None).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "another incident's run");
        let (status, _) = status_and_body(read("inc_1", "run_unknown", None).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, body) = status_and_body(read("inc_1", legacy, None).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["transcript"], "none");
        assert_eq!(body["run_id"], legacy);
        assert_eq!(body["steps"], serde_json::json!([]));
        assert_eq!(body["state_version"], "-1.0.2000");
        assert_eq!(body["active"], false);

        let (status, body) = status_and_body(read("inc_1", expired, None).await).await;
        assert_eq!(status, StatusCode::GONE);
        assert_eq!(body["error_code"], "transcript_expired");

        // A run whose turn never started has a session id but never had a session.
        for code in ["turn_limit", "credentials", "agent_unavailable", "busy"] {
            let run_id = format!("run_start_{code}");
            let run = failed(&run_id, &format!("ses_{code}"), code);
            rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
                .exec(conn)
                .await
                .unwrap();
            let (status, body) = status_and_body(read("inc_1", &run_id, None).await).await;
            assert_eq!(status, StatusCode::OK, "{code}");
            assert_eq!(body["transcript"], "none", "{code}");
        }
        let (status, body) = status_and_body(read("inc_1", never_started, None).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["transcript"], "none");
        assert_eq!(body["steps"], serde_json::json!([]));
        let (status, body) = status_and_body(read("inc_1", failed_later, None).await).await;
        assert_eq!(
            status,
            StatusCode::GONE,
            "a run that had a turn lost its transcript"
        );
        assert_eq!(body["error_code"], "transcript_expired");

        let (status, body) = status_and_body(read("inc_1", live, Some("41.1500.2000")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            serde_json::json!({"not_modified": true, "state_version": "41.1500.2000"})
        );

        // TH31: with the setting on, the version names it, so the copy above is stale.
        common::infra::config::ORGANIZATION_SETTING
            .write()
            .await
            .insert(
                settings_key,
                common::meta::organization::OrganizationSetting {
                    ai_rca_thread_tool_output: true,
                    ..Default::default()
                },
            );
        let (status, body) =
            status_and_body(read("inc_1", live, Some("41.1500.2000.io")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            serde_json::json!({"not_modified": true, "state_version": "41.1500.2000.io"})
        );
    }

    /// TH30, D5: an ended run whose committed history has a gap, a divergence or a corrupt
    /// event answers 410 `transcript_incomplete`; any other read error, or a live run,
    /// answers 503 `history_unavailable`.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_failed_thread_read_maps_by_run_state_and_error() {
        use axum::http::StatusCode;
        use openobserve_core::ai_chat::ReadError;

        let gap = || ReadError::Gap {
            expected: 5,
            found: Some(7),
        };
        let incomplete = (StatusCode::GONE, "transcript_incomplete");
        let unavailable = (StatusCode::SERVICE_UNAVAILABLE, "history_unavailable");
        for (terminal, error, (status, code)) in [
            (true, gap(), incomplete),
            (
                true,
                ReadError::Divergence {
                    seq: 3,
                    a: "h1".to_string(),
                    b: "h2".to_string(),
                },
                incomplete,
            ),
            (true, ReadError::Corrupt("bad hash".to_string()), incomplete),
            (true, ReadError::Search("timeout".to_string()), unavailable),
            (true, ReadError::NoTimeRange, unavailable),
            (false, gap(), unavailable),
            (
                false,
                ReadError::Corrupt("bad hash".to_string()),
                unavailable,
            ),
        ] {
            let label = format!("terminal={terminal} {error:?}");
            let (got, body) =
                status_and_body(read_error_response("run_1", "ses_1", terminal, &error)).await;
            assert_eq!(got, status, "{label}");
            assert_eq!(body["error_code"], code, "{label}");
            assert_eq!(body["code"], status.as_u16(), "{label}");
            let message = body["message"].as_str().unwrap();
            assert!(!message.is_empty(), "{label}");
            assert!(
                !message.contains("hash") && !message.contains("seq"),
                "{label}: {message}"
            );
        }
    }
}
