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
                    let in_flight = incident
                        .rca
                        .as_ref()
                        .is_some_and(|rca| rca.state.is_live() && !rca.stale);
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

/// Response for a resumed RCA run (202)
#[cfg(feature = "enterprise")]
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaResumedResponse {
    pub message: String,
    /// The new run
    pub run_id: String,
    /// The failed or cancelled run it continues
    pub resumed_from: String,
    /// Finished steps of the earlier run that the new run keeps
    pub reused_steps: u32,
    /// The step the new run redoes first
    pub from_step: openobserve_core::alerts::rca_resume::ResumeStep,
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
    /// Include the previous report; default false keeps the new investigation fresh.
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
    description = "Starts a root cause analysis run for an incident and returns 202 with the run id as soon as the run exists; its investigation turn is launched in the background. A launch that fails (too many analyses running, agent unreachable) ends the run as `failed` with its error code. Follow the run through the run list and its thread. An optional JSON body `{guidance}` (1 to 2000 characters) is given to the agent with the first prompt; other fields are refused.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        TriggerRcaQuery,
    ),
    request_body(content = TriggerRcaBody, description = "Optional guidance for the new run", content_type = "application/json"),
    responses(
        (status = 202, description = "Analysis started", content_type = "application/json", body = RcaStartedResponse),
        (status = 400, description = "RCA not enabled, an analysis is already in progress, an invalid body (`error_code: invalid_body`, also for unknown fields) or invalid guidance (`error_code: invalid_guidance`)", content_type = "application/json", body = ()),
        (status = 402, description = "AI credits exhausted", content_type = "application/json", body = ()),
        (status = 412, description = "Paid usage requires organization consent", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "RCA agent or billing state unavailable", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn trigger_incident_rca(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<TriggerRcaQuery>,
    body: axum::body::Bytes,
) -> Response {
    use config::meta::alerts::rca_runs::{RunMode, RunTrigger};
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    use openobserve_core::alerts::rca_runs;

    // The body is optional; when present it is `{guidance}`.
    let guidance = if body.iter().all(u8::is_ascii_whitespace) {
        None
    } else {
        let body: TriggerRcaBody = match serde_json::from_slice(&body) {
            Ok(body) => body,
            Err(e) => {
                return rca_error_response(
                    axum::http::StatusCode::BAD_REQUEST,
                    &format!("Invalid request body: {e}"),
                    Some("invalid_body"),
                    None,
                );
            }
        };
        match body.guidance {
            None => None,
            Some(text) => match openobserve_core::alerts::rca_steering::validate_guidance(&text) {
                Ok(text) => Some(text),
                Err(e) => return steer_error_response(&e, "Failed to start the analysis"),
            },
        }
    };

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

    // Validate existence before quota; the context builder hydrates the incident later.
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found("Incident not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    // Completed history determines both trigger type and Cloud usage feature.
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

    // Precheck → start CAS → authorize avoids charging a rejected duplicate start.
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

    // User starts skip cooldown; the transaction owns the in-flight guard and Begin event.
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
        guidance: guidance.clone(),
        skip_cooldown: true,
        oncall_subjects: None,
        context_used: None,
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

    let started = rca_started_response(run_id.clone());
    launch_started_run(
        org_id,
        incident_id,
        run_id,
        #[cfg(feature = "cloud")]
        (usage_feature, usage_context),
        openobserve_core::alerts::incidents::RcaLaunch {
            trigger,
            user_email: user_email.user_id,
            build_on_previous: query.build_on_previous,
            usage_permit: None,
            guidance,
            resume: None,
        },
        started,
    )
    .await
}

#[cfg(feature = "cloud")]
async fn authorize_started_rca(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    trigger: config::meta::alerts::rca_runs::RunTrigger,
    feature: openobserve_core::trial_quota::TrialQuotaFeature,
    context: &openobserve_core::trial_quota::AiUsageContext,
) -> Result<openobserve_core::trial_quota::AiUsagePermit, Response> {
    use openobserve_core::alerts::rca_runs;
    match openobserve_core::trial_quota::authorize_ai_usage(org_id, feature, context).await {
        Ok(permit) => Ok(permit),
        Err(error) => {
            match rca_runs::fail_run(
                org_id,
                run_id,
                trigger,
                rca_runs::ERROR_USAGE_DENIED,
                rca_runs::USAGE_DENIED_REASON,
                Some(error.to_string()),
            )
            .await
            {
                Ok(true) => {
                    // The guidance committed with the run is never read by a turn.
                    openobserve_core::alerts::rca_steering::close_unread(
                        org_id,
                        run_id,
                        config::meta::alerts::rca_runs::RunState::Failed,
                    )
                    .await;
                    o2_enterprise::enterprise::alerts::rca_service::skip_analysis_for_incident(
                        org_id,
                        incident_id,
                    )
                    .await
                }
                Ok(false) => {}
                Err(error) => {
                    log::error!("[INCIDENTS::RCA] cannot end unauthorized run {run_id}: {error}")
                }
            }
            Err(crate::request::ai::chat::ai_authorization_error_response(
                error,
            ))
        }
    }
}

/// `202 {message, run_id}`: the run is started; its turn launches in the background.
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

/// Launches a started run's first turn in a detached task, so the run is ended even if the
/// request disconnects, and answers `started` once the launch is under way: at once, or on Cloud
/// once usage is authorized. The answer does not wait for the turn: every launch error ends the
/// run as failed with its code (`trigger_rca_for_incident`).
#[cfg(feature = "enterprise")]
async fn launch_started_run(
    org_id: String,
    incident_id: String,
    run_id: String,
    #[cfg(feature = "cloud")] usage: (
        openobserve_core::trial_quota::TrialQuotaFeature,
        openobserve_core::trial_quota::AiUsageContext,
    ),
    launch: openobserve_core::alerts::incidents::RcaLaunch,
    started: Response,
) -> Response {
    let (launching, launched) = tokio::sync::oneshot::channel::<Option<Response>>();
    tokio::spawn(async move {
        // Meter usage only now, after the start: a refused start never costs a credit.
        #[cfg(feature = "cloud")]
        let launch = {
            let (feature, context) = usage;
            match authorize_started_rca(
                &org_id,
                &incident_id,
                &run_id,
                launch.trigger,
                feature,
                &context,
            )
            .await
            {
                Ok(permit) => openobserve_core::alerts::incidents::RcaLaunch {
                    usage_permit: Some(permit),
                    ..launch
                },
                Err(refused) => {
                    let _ = launching.send(Some(refused));
                    return;
                }
            }
        };
        let _ = launching.send(None);
        // The error is logged and stored on the run there.
        let _ = openobserve_core::alerts::incidents::trigger_rca_for_incident(
            org_id,
            incident_id,
            run_id,
            launch,
        )
        .await;
    });
    match launched.await {
        Ok(None) => started,
        Ok(Some(refused)) => refused,
        Err(e) => MetaHttpResponse::internal_error(format!("The analysis task failed: {e}")),
    }
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
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn cancel_incident_rca(
    Path((org_id, incident_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Cancel's atomic guard prevents cancelling a replacement run.
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
    description = "Returns the incident's analysis runs, newest first, without report text. Page with `before` set to the last run id of the previous page. Reports from before analysis runs existed follow on the last page with `report_format: v1`.",
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
        ("x-o2-mcp" = json!({"enabled": true, "description": "List past incident RCA runs", "category": "alerts"}))
    )
)]
pub async fn list_incident_rca_runs(
    Path((org_id, incident_id)): Path<(String, String)>,
    Query(query): Query<ListRcaRunsQuery>,
) -> Response {
    let incident = match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(incident)) => incident,
        Ok(None) => return MetaHttpResponse::not_found("Incident not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let limit = query
        .limit
        .unwrap_or(RCA_RUNS_DEFAULT_LIMIT)
        .clamp(1, RCA_RUNS_MAX_LIMIT);
    let before = query.before.as_deref();
    let v1_cursor = before.filter(|id| config::meta::alerts::rca_runs::is_v1_run_id(id));
    let (mut runs, mut has_more) = if v1_cursor.is_some() {
        (Vec::new(), false)
    } else {
        match infra::table::rca_runs::list_for_incident(&org_id, &incident_id, limit, before).await
        {
            Ok((runs, has_more)) => (
                runs.iter()
                    .map(infra::table::rca_runs::to_item)
                    .collect::<Vec<_>>(),
                has_more,
            ),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    };
    if !has_more {
        let v1 = match openobserve_core::alerts::rca_runs::v1_reports_of(&org_id, &incident).await {
            Ok(v1) => v1,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        // A v1 cursor continues among the v1 reports, which are already newest first.
        let mut rest = v1
            .iter()
            .skip_while(|report| v1_cursor.is_some_and(|id| report.run_id != id))
            .skip(usize::from(v1_cursor.is_some()));
        let room = usize::try_from(limit)
            .unwrap_or(usize::MAX)
            .saturating_sub(runs.len());
        runs.extend(rest.by_ref().take(room).map(|report| report.item()));
        has_more = rest.next().is_some();
    }
    MetaHttpResponse::json(config::meta::alerts::rca_runs::ListRcaRunsResponse { runs, has_more })
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
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_run(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
) -> Response {
    if config::meta::alerts::rca_runs::is_v1_run_id(&run_id) {
        return match openobserve_core::alerts::rca_runs::v1_run(&org_id, &incident_id, &run_id)
            .await
        {
            Ok(Some(run)) => MetaHttpResponse::json(run),
            Ok(None) => MetaHttpResponse::not_found("Run not found"),
            Err(e) => MetaHttpResponse::internal_error(e),
        };
    }
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
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_thread(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Query(query): Query<RcaThreadQuery>,
) -> Response {
    use openobserve_core::alerts::rca_live::{RunParts, RunSession, StoreReader};

    let run = match infra::table::rca_runs::get(&org_id, &run_id).await {
        Ok(Some(run)) if run.incident_id.as_deref() == Some(incident_id.as_str()) => run,
        Ok(_) => return MetaHttpResponse::not_found("Run not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let session = match RunSession::load(&org_id, &run).await {
        Ok(session) => session,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let show_tool_io = match &session {
        RunSession::Present(_) => {
            match db::organization::read_org_setting(&org_id, |s| s.ai_rca_thread_tool_output).await
            {
                Ok(show) => show,
                Err(e) => return MetaHttpResponse::internal_error(e),
            }
        }
        _ => false,
    };
    let parts = RunParts::new(&org_id, &run, &session, &StoreReader);
    if let Some(version) = parts.thread_version(show_tool_io)
        && query.known_version.as_deref() == Some(version.as_str())
    {
        return MetaHttpResponse::json(serde_json::json!({
            "not_modified": true,
            "state_version": version,
        }));
    }
    match parts.thread(show_tool_io).await {
        Ok(thread) => MetaHttpResponse::json(thread),
        Err(e) => part_error_response(&e),
    }
}

/// Optional body of `POST …/rca`: guidance for the new run. Unknown fields are refused.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TriggerRcaBody {
    /// What the responder wants this analysis to look at; 1 to 2000 characters.
    #[serde(default)]
    pub guidance: Option<String>,
}

/// Derive author from authentication and reject unknown body fields.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SteerRequestBody {
    /// The message; ignored for `hypothesis_action`, where the server writes the text.
    #[serde(default)]
    pub text: String,
    /// `message` or `hypothesis_action`.
    pub kind: String,
    /// For `hypothesis_action`: `disprove`, `reopen` or `test_first`.
    #[serde(default)]
    pub action: Option<String>,
    /// For `hypothesis_action`: the hypothesis id in the run's ledger.
    #[serde(default)]
    pub hypothesis_id: Option<String>,
}

/// `{code, message, error_code[, retry_after_secs]}`, the RCA routes' error body.
#[cfg(feature = "enterprise")]
fn rca_error_response(
    status: axum::http::StatusCode,
    message: &str,
    error_code: Option<&str>,
    retry_after_secs: Option<u64>,
) -> Response {
    let mut body = serde_json::json!({
        "code": status.as_u16(),
        "message": message,
    });
    if let Some(error_code) = error_code {
        body["error_code"] = error_code.into();
    }
    if let Some(secs) = retry_after_secs {
        body["retry_after_secs"] = secs.into();
    }
    let mut response = json_status_response(status, body);
    if let Some(secs) = retry_after_secs {
        response
            .headers_mut()
            .insert(axum::http::header::RETRY_AFTER, secs.into());
    }
    response
}

#[cfg(feature = "enterprise")]
/// Expose the fixed message and log the internal cause.
fn steer_error_response(
    error: &openobserve_core::alerts::rca_steering::SteerError,
    server_message: &str,
) -> Response {
    let status = axum::http::StatusCode::from_u16(error.status())
        .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    if status.is_server_error() {
        log::error!("[INCIDENTS::RCA] {server_message}: {error}");
        return rca_error_response(status, server_message, None, None);
    }
    rca_error_response(
        status,
        &error.to_string(),
        error.code(),
        error.retry_after_secs(),
    )
}

#[cfg(feature = "enterprise")]
/// SteerIncidentRcaRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/steer",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "SteerIncidentRcaRun",
    summary = "Send a message to a live analysis run",
    description = "Saves a responder message for the incident's live analysis run and hands it to the agent, which reads it after its current step. A `hypothesis_action` asks the agent to disprove, reopen or test one hypothesis first; the server writes its text. The author is the authenticated user. A 201 can carry a `rejected` record: it was saved but not sent.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
    ),
    request_body(content = SteerRequestBody, description = "The message", content_type = "application/json"),
    responses(
        (status = 201, description = "Message saved; `{steer, run_state}`", content_type = "application/json", body = openobserve_core::alerts::rca_steering::SteerOutcome),
        (status = 400, description = "Invalid body (`error_code`: `invalid_body`, `invalid_text`, `invalid_kind`, `invalid_action`, `unknown_hypothesis`)", content_type = "application/json", body = Object),
        (status = 403, description = "The user cannot run an analysis on this incident", content_type = "application/json", body = Object),
        (status = 404, description = "Unknown incident or run", content_type = "application/json", body = Object),
        (status = 409, description = "`error_code`: `run_not_steerable`, `run_closing` or `duplicate_action`", content_type = "application/json", body = Object),
        (status = 429, description = "`error_code: rate_limited` with `retry_after_secs`", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn steer_incident_rca_run(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
    body: axum::body::Bytes,
) -> Response {
    use axum::http::StatusCode;
    use openobserve_core::alerts::rca_steering;

    // Use 400 for malformed bodies, including forged author fields.
    let body: SteerRequestBody = match serde_json::from_slice(&body) {
        Ok(body) => body,
        Err(e) => {
            return rca_error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid request body: {e}"),
                Some("invalid_body"),
                None,
            );
        }
    };

    // OpenFGA middleware and RCA feature flags both gate writes.
    if !crate::request::ai::chat::can_run_incident_rca(&org_id, &user_email.user_id, &incident_id)
        .await
    {
        return match infra::table::alert_incidents::get(&org_id, &incident_id).await {
            Ok(None) => MetaHttpResponse::not_found("Incident not found"),
            Err(e) => MetaHttpResponse::internal_error(e),
            Ok(Some(_)) => rca_error_response(
                StatusCode::FORBIDDEN,
                "You cannot run an analysis on this incident",
                None,
                None,
            ),
        };
    }

    match rca_steering::steer(
        &org_id,
        &incident_id,
        &run_id,
        &user_email.user_id,
        rca_steering::SteerRequest {
            text: body.text,
            kind: body.kind,
            action: body.action,
            hypothesis_id: body.hypothesis_id,
        },
    )
    .await
    {
        Ok(outcome) => json_status_response(
            StatusCode::CREATED,
            serde_json::to_value(outcome).unwrap_or_default(),
        ),
        Err(e) => steer_error_response(&e, "Failed to steer the analysis"),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaSteering
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/steering",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaSteering",
    summary = "Get the responder messages and the open question of an analysis run",
    description = "Returns the run's responder messages with their delivery state (queued, delivered, read, applied, declined, not read, rejected), the question the agent is waiting on, if any, and whether the caller can send a message now.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
    ),
    responses(
        (status = 200, description = "Steering state", content_type = "application/json", body = openobserve_core::alerts::rca_steering::SteeringView),
        (status = 404, description = "Run not found", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_steering(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    use openobserve_core::alerts::rca_steering;

    let can_steer =
        crate::request::ai::chat::can_run_incident_rca(&org_id, &user_email.user_id, &incident_id)
            .await;
    match rca_steering::steering_view(&org_id, &incident_id, &run_id, can_steer).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => steer_error_response(&e, "Failed to read the steering messages"),
    }
}

/// Unknown runs and runs owned by another incident both return 404.
#[cfg(feature = "enterprise")]
async fn incident_run(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
) -> Result<infra::table::rca_runs::Model, Response> {
    match infra::table::rca_runs::get(org_id, run_id).await {
        Ok(Some(run)) if run.incident_id.as_deref() == Some(incident_id) => Ok(run),
        Ok(_) => Err(rca_error_response(
            axum::http::StatusCode::NOT_FOUND,
            "Run not found",
            None,
            None,
        )),
        Err(e) => Err(MetaHttpResponse::internal_error(e)),
    }
}

#[cfg(feature = "enterprise")]
/// ResumeIncidentRcaRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/resume",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ResumeIncidentRcaRun",
    summary = "Resume a failed or cancelled analysis run",
    description = "Starts a new analysis run that keeps the finished steps of the incident's latest run, when that run failed or was cancelled, and redoes the step it stopped in. Returns 202 with the new run id as soon as the run exists; its investigation turn is launched in the background, and a launch that fails ends the run as `failed` with its error code. The body is empty.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID of the failed or cancelled run"),
    ),
    responses(
        (status = 202, description = "Resumed run started", content_type = "application/json", body = RcaResumedResponse),
        (status = 400, description = "RCA not enabled", content_type = "application/json", body = ()),
        (status = 402, description = "AI credits exhausted", content_type = "application/json", body = ()),
        (status = 404, description = "Unknown incident or run", content_type = "application/json", body = Object),
        (status = 409, description = "`error_code`: `not_resumable`, `nothing_to_resume` or `run_in_flight`", content_type = "application/json", body = Object),
        (status = 410, description = "`error_code: transcript_expired`: the earlier run's transcript is gone", content_type = "application/json", body = Object),
        (status = 412, description = "Paid usage requires organization consent", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "RCA agent or billing state unavailable, or the earlier run's transcript could not be read in full (`error_code: history_unavailable`)", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn resume_incident_rca_run(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let response = resume_run(org_id.clone(), incident_id, run_id, user_email).await;
    let status = response.status();
    let result = if status == axum::http::StatusCode::ACCEPTED {
        Some("started")
    } else if status.is_client_error() {
        Some("refused")
    } else {
        None
    };
    if let Some(result) = result {
        config::metrics::RCA_RESUME_TOTAL
            .with_label_values(&[org_id.as_str(), result])
            .inc();
    }
    response
}

/// Precheck → prepare → start → authorize → launch; the caller owns metrics.
#[cfg(feature = "enterprise")]
async fn resume_run(
    org_id: String,
    incident_id: String,
    run_id: String,
    user_email: UserEmail,
) -> Response {
    use axum::http::StatusCode;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    use openobserve_core::alerts::rca_resume;

    let o2_cfg = get_o2_config();
    if !o2_cfg.incidents.enabled || !o2_cfg.incidents.rca_enabled {
        return MetaHttpResponse::bad_request("RCA is not enabled");
    }
    if !o2_cfg.ai.has_agent_target() {
        return rca_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "RCA agent URL is not configured",
            Some("agent_not_configured"),
            None,
        );
    }

    #[cfg(feature = "cloud")]
    if let Err(error) = openobserve_core::trial_quota::precheck_ai_usage(
        &org_id,
        openobserve_core::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
        &user_email.user_id,
    )
    .await
    {
        return crate::request::ai::chat::ai_authorization_error_response(error);
    }

    let seed = match rca_resume::prepare_resume(&org_id, &incident_id, &run_id).await {
        Ok(seed) => seed,
        Err(error) => return resume_error_response(&run_id, &error),
    };
    start_resumed_run(org_id, incident_id, user_email, seed).await
}

/// The answer for a run that cannot be resumed.
#[cfg(feature = "enterprise")]
fn resume_error_response(
    run_id: &str,
    error: &openobserve_core::alerts::rca_resume::ResumeError,
) -> Response {
    use axum::http::StatusCode;
    use openobserve_core::alerts::rca_resume::ResumeError;

    match error {
        ResumeError::NotFound => {
            rca_error_response(StatusCode::NOT_FOUND, "Run not found", None, None)
        }
        ResumeError::NotResumable(message) => {
            rca_error_response(StatusCode::CONFLICT, message, Some("not_resumable"), None)
        }
        ResumeError::NothingToResume => rca_error_response(
            StatusCode::CONFLICT,
            "The run finished no step, so there is nothing to resume",
            Some("nothing_to_resume"),
            None,
        ),
        ResumeError::TranscriptExpired => rca_error_response(
            StatusCode::GONE,
            "The run's transcript is no longer available, so it cannot be resumed",
            Some("transcript_expired"),
            None,
        ),
        ResumeError::Unavailable(e) => {
            log::warn!("[INCIDENTS::RCA] Cannot read the transcript of run {run_id}: {e}");
            rca_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "This analysis transcript could not be read in full; please retry",
                Some("history_unavailable"),
                None,
            )
        }
        ResumeError::Internal(e) => {
            log::error!("[INCIDENTS::RCA] Failed to prepare resuming run {run_id}: {e}");
            rca_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resume the analysis",
                None,
                None,
            )
        }
    }
}

/// The rest of [resume_run] once the seed is ready: start → authorize → launch.
#[cfg(feature = "enterprise")]
async fn start_resumed_run(
    org_id: String,
    incident_id: String,
    user_email: UserEmail,
    seed: openobserve_core::alerts::rca_resume::ResumeSeed,
) -> Response {
    use axum::http::StatusCode;
    use config::meta::alerts::rca_runs::RunTrigger;
    use openobserve_core::alerts::rca_runs;

    #[cfg(feature = "cloud")]
    let (usage_feature, usage_context) = (
        openobserve_core::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
        openobserve_core::trial_quota::AiUsageContext {
            user_email: user_email.user_id.clone(),
            incident_id: Some(incident_id.clone()),
            ..Default::default()
        },
    );

    // The start transaction refuses a live run or any start since the check, and appends Begin.
    let new_run_id = match rca_runs::start_run_if_latest(
        rca_runs::StartRun {
            org_id: org_id.clone(),
            subject: rca_runs::RunSubject::Incident(incident_id.clone()),
            trigger: RunTrigger::Resume,
            mode: seed.mode,
            started_by: user_email.user_id.clone(),
            guidance: None,
            skip_cooldown: true,
            oncall_subjects: None,
            context_used: Some(serde_json::json!({ "resumed_from": seed.resumed_from() })),
        },
        &seed.latest_run_id,
    )
    .await
    {
        Ok(rca_runs::StartOutcome::Started { run_id }) => run_id,
        Ok(rca_runs::StartOutcome::InFlight) | Ok(rca_runs::StartOutcome::CoolingDown) => {
            return rca_error_response(
                StatusCode::CONFLICT,
                "Analysis already in progress",
                Some("run_in_flight"),
                None,
            );
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(format!("Failed to start analysis: {e}"));
        }
    };

    let started = json_status_response(
        StatusCode::ACCEPTED,
        serde_json::to_value(RcaResumedResponse {
            message: "Analysis resumed".to_string(),
            run_id: new_run_id.clone(),
            resumed_from: seed.source_run_id.clone(),
            reused_steps: seed.reused_steps,
            from_step: seed.from_step.clone(),
        })
        .unwrap_or_default(),
    );
    launch_started_run(
        org_id,
        incident_id,
        new_run_id,
        #[cfg(feature = "cloud")]
        (usage_feature, usage_context),
        openobserve_core::alerts::incidents::RcaLaunch {
            trigger: RunTrigger::Resume,
            user_email: user_email.user_id,
            build_on_previous: false,
            usage_permit: None,
            guidance: None,
            resume: Some(seed),
        },
        started,
    )
    .await
}

/// The answer of a part route that could not build its part.
#[cfg(feature = "enterprise")]
fn part_error_response(error: &openobserve_core::alerts::rca_live::PartError) -> Response {
    match error.status {
        axum::http::StatusCode::NOT_FOUND => MetaHttpResponse::not_found(&error.message),
        axum::http::StatusCode::INTERNAL_SERVER_ERROR => {
            MetaHttpResponse::internal_error(&error.message)
        }
        status => rca_error_response(status, &error.message, error.error_code, None),
    }
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaSummary
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/summary",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaSummary",
    summary = "Get the verdict, hypotheses and evidence of an analysis run",
    description = "Returns the summary of one analysis run of the incident: the verdict card, the causal timeline, the hypotheses, the verified evidence and the blind spots. A live run returns what the agent recorded so far. Pass the last `state_version` as `known_version` to get `not_modified` when nothing changed.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
        RcaThreadQuery,
    ),
    responses(
        (status = 200, description = "Run summary, or `{run_id, state_version, not_modified: true}`", content_type = "application/json", body = config::meta::oncall::rca_run::RcaRunSummary),
        (status = 404, description = "Run not found", content_type = "application/json", body = ()),
        (status = 410, description = "The run's transcript expired (`error_code: transcript_expired`)", content_type = "application/json", body = ()),
        (status = 500, description = "Internal error", content_type = "application/json", body = ()),
        (status = 503, description = "The transcript could not be read in full (`error_code: history_unavailable`)", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_summary(
    Path((org_id, incident_id, run_id)): Path<(String, String, String)>,
    Query(query): Query<RcaThreadQuery>,
) -> Response {
    use openobserve_core::alerts::rca_live::{
        RunParts, RunSession, StoreReader, summary_reads_session,
    };

    let run = match infra::table::rca_runs::get(&org_id, &run_id).await {
        Ok(Some(run)) if run.incident_id.as_deref() == Some(incident_id.as_str()) => run,
        Ok(_) => return MetaHttpResponse::not_found("Run not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let session = if summary_reads_session(&run) {
        match RunSession::load(&org_id, &run).await {
            Ok(session) => session,
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    } else {
        RunSession::None
    };
    let parts = RunParts::new(&org_id, &run, &session, &StoreReader);
    if let Some(version) = parts.summary_version()
        && query.known_version.as_deref() == Some(version.as_str())
    {
        return MetaHttpResponse::json(serde_json::json!({
            "run_id": run_id,
            "state_version": version,
            "not_modified": true,
        }));
    }
    match parts.summary(None).await {
        Ok(summary) => MetaHttpResponse::json(summary),
        Err(e) => part_error_response(&e),
    }
}

/// Query of `GET …/rca/live_stream`.
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct RcaLiveStreamQuery {
    /// The run whose thread, summary and steering to send; without it, only the incident's state.
    #[serde(default)]
    pub run_id: Option<String>,
}

#[cfg(feature = "enterprise")]
/// GetIncidentRcaLiveStream
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/live_stream",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaLiveStream",
    summary = "Stream the changes of the incident's analysis",
    description = "Server-sent events. `rca` carries the incident's analysis state; with `run_id`, `thread`, `summary` and `steering` carry the bodies of the run's GET routes. Each event is a full snapshot and goes out when its part changes. `error` reports a part that could not be read, as `{part, status, error_code, message}`. `end` closes the stream once the run (or, without `run_id`, the latest run) ended. A stream also closes after 300 s; reconnect to get every part again.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        RcaLiveStreamQuery,
    ),
    responses(
        (status = 200, description = "Event stream", content_type = "text/event-stream", body = String),
        (status = 404, description = "Incident or run not found", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_live_stream(
    Path((org_id, incident_id)): Path<(String, String)>,
    Query(query): Query<RcaLiveStreamQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    use openobserve_core::alerts::rca_live::{
        LIVE_PROBE_INTERVAL, LiveSpec, LiveStream, OpenStream, StoreReader,
    };

    // Everything the stream can refuse is a JSON answer before the first byte.
    match infra::table::alert_incidents::get(&org_id, &incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found("Incident not found"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }
    let (show_tool_io, can_steer) = match query.run_id.as_deref() {
        Some(run_id) => {
            if let Err(response) = incident_run(&org_id, &incident_id, run_id).await {
                return response;
            }
            let show_tool_io =
                match db::organization::read_org_setting(&org_id, |s| s.ai_rca_thread_tool_output)
                    .await
                {
                    Ok(show) => show,
                    Err(e) => return MetaHttpResponse::internal_error(e),
                };
            let can_steer = crate::request::ai::chat::can_run_incident_rca(
                &org_id,
                &user_email.user_id,
                &incident_id,
            )
            .await;
            (show_tool_io, can_steer)
        }
        None => (false, false),
    };

    let open = OpenStream::open(&org_id);
    let spec = LiveSpec {
        org_id,
        incident_id,
        run_id: query.run_id,
        show_tool_io,
        can_steer,
    };
    let events = async_stream::stream! {
        let _open = open;
        let mut live = LiveStream::new(spec, StoreReader, config::utils::time::now_micros());
        let mut probe = tokio::time::interval(LIVE_PROBE_INTERVAL);
        probe.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        while !live.is_done() {
            probe.tick().await;
            let now = config::utils::time::now_micros();
            // The head goes out before the tail reads the transcript.
            for frame in live.head(now).await {
                yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::from(frame.to_sse()));
            }
            for frame in live.tail(now).await {
                yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::from(frame.to_sse()));
            }
        }
    };

    axum::http::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            mime::TEXT_EVENT_STREAM.as_ref(),
        )
        .header(axum::http::header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(axum::body::Body::from_stream(events))
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()))
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
        ("x-o2-mcp" = json!({"enabled": false}))
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
        ("x-o2-mcp" = json!({"enabled": false}))
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
        ("x-o2-mcp" = json!({"enabled": true, "description": "List past incident RCA runs", "category": "alerts"}))
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
        ("x-o2-mcp" = json!({"enabled": false})),
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
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_thread(
    _path: Path<(String, String, String)>,
    _query: Query<RcaThreadQuery>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/summary",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaSummary",
    summary = "Get the verdict, hypotheses and evidence of an analysis run",
    description = "Returns the summary of one analysis run. This endpoint is only available with enterprise features enabled.",
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
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_summary(
    _path: Path<(String, String, String)>,
    _query: Query<RcaThreadQuery>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/steer",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "SteerIncidentRcaRun",
    summary = "Send a message to a live analysis run",
    description = "Sends a responder message to a live analysis run. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID"),
    ),
    request_body(content = SteerRequestBody, description = "The message", content_type = "application/json"),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn steer_incident_rca_run(
    _path: Path<(String, String, String)>,
    _headers: Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Steering an analysis is only available in enterprise")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/steering",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaSteering",
    summary = "Get the responder messages and the open question of an analysis run",
    description = "Returns the steering state of one analysis run. This endpoint is only available with enterprise features enabled.",
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
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_steering(
    _path: Path<(String, String, String)>,
    _headers: Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Steering an analysis is only available in enterprise")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/live_stream",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentRcaLiveStream",
    summary = "Stream the changes of the incident's analysis",
    description = "Server-sent events of the incident's analysis. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        RcaLiveStreamQuery,
    ),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn get_incident_rca_live_stream(
    _path: Path<(String, String)>,
    _query: Query<RcaLiveStreamQuery>,
    _headers: Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/rca/runs/{run_id}/resume",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ResumeIncidentRcaRun",
    summary = "Resume a failed or cancelled analysis run",
    description = "Starts a new analysis run that keeps the finished steps of a failed or cancelled run. This endpoint is only available with enterprise features enabled.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        ("run_id" = String, Path, description = "Run ID of the failed or cancelled run"),
    ),
    responses(
        (status = 403, description = "Not supported without enterprise features", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false})),
    )
)]
pub async fn resume_incident_rca_run(
    _path: Path<(String, String, String)>,
    _headers: Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Resuming an analysis is only available in enterprise")
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
            alert_groups: None,
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

    #[test]
    fn test_steer_and_trigger_bodies_refuse_unknown_fields() {
        let body: SteerRequestBody = serde_json::from_str(
            r#"{"kind":"hypothesis_action","action":"disprove","hypothesis_id":"h3"}"#,
        )
        .unwrap();
        assert_eq!(body.text, "");
        assert_eq!(body.action.as_deref(), Some("disprove"));
        assert!(
            serde_json::from_str::<SteerRequestBody>(
                r#"{"text":"hi","kind":"message","author_email":"x@y.z"}"#
            )
            .is_err()
        );
        let trigger: TriggerRcaBody = serde_json::from_str(r#"{"guidance":"look at db"}"#).unwrap();
        assert_eq!(trigger.guidance.as_deref(), Some("look at db"));
        let empty: TriggerRcaBody = serde_json::from_str("{}").unwrap();
        assert_eq!(empty.guidance, None);
        for body in [
            r#"{"guidance":"look at db","mode":"fresh"}"#,
            r#"{"guidence":"look at db"}"#,
        ] {
            assert!(
                serde_json::from_str::<TriggerRcaBody>(body).is_err(),
                "{body}"
            );
        }
    }

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

    #[test]
    fn test_list_rca_runs_query_and_response_shape() {
        use config::meta::alerts::rca_runs::{
            ListRcaRunsResponse, RcaRunItem, ReportFormat, RunMode, RunState, RunSubjectType,
            RunTrigger,
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
                report_format: ReportFormat::V2,
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
                has_record: true,
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
        assert_eq!(run["has_record"], true);
        assert!(run.get("report").is_none());
    }

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
            alert_groups: None,
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

    /// The trigger answers 202 once the run exists; a launch that fails afterwards (no agent at
    /// the configured URL) still ends that run as failed with its code.
    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_a_trigger_answers_202_and_a_failed_launch_still_ends_the_run() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("trigger202");
        steering_incident(conn, &org, "inc_1", None).await;
        let (status, body) = status_and_body(
            trigger_incident_rca(
                Path((org.clone(), sid(&org, "inc_1"))),
                Headers(UserEmail {
                    user_id: STEER_ROOT.to_string(),
                }),
                Query(TriggerRcaQuery {
                    build_on_previous: false,
                }),
                axum::body::Bytes::new(),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        let runs = settled_runs(conn, &org, "inc_1").await;
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert_eq!(body["run_id"], runs[0].run_id.as_str());
        assert_eq!(runs[0].state, "failed");
        let error = infra::table::rca_runs::decode::<serde_json::Value>(runs[0].error.as_deref())
            .expect("the failed launch is on the run");
        assert!(
            error["code"].as_str().is_some_and(|code| !code.is_empty()),
            "{error}"
        );
    }

    /// The global SQLite meta store with the run and chat tables.
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
            input_deadline_at: None,
            pending_question_id: None,
            questions_asked: 0,
            deadline_closed_at: None,
        }
    }

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
            run.error = Some(serde_json::json!({"code": code, "reason": "r"}).to_string());
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
        // The org shows no tool input/output; cached, as the route reads it.
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
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
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

        // With the setting on, the version names it, so the copy above is stale.
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

    #[cfg(feature = "enterprise")]
    fn stored_record() -> serde_json::Value {
        use config::meta::oncall::{
            confidence::{ToolCallRecord, signal_class, stream_type},
            rca_run::{
                EndedBy, LedgerCall, LedgerTool, RunEndInput, evidence_target, parse_submit,
                record_run_end, summarize_result,
            },
        };
        use serde_json::json;

        const SQL: &str = "SELECT count(*) FROM app_logs WHERE level = 'error'";
        let e1 = json!({"id": "e1", "tool": "SearchSQL", "query": SQL, "polarity": "supports", "strength": "decisive", "observation": "errors began at 10:02"});
        let e9 = json!({"id": "e9", "tool": "SearchSQL", "query": "SELECT 2", "polarity": "supports", "strength": "supporting", "observation": "never ran"});
        let calls = [
            LedgerCall {
                seq: 3,
                at_us: 1_000,
                tool: LedgerTool::Hypothesis,
                input: json!({"id": "h1", "statement": "The pool ran dry", "status": "testing", "reason": "r1", "evidence": [e1.clone()]}),
            },
            LedgerCall {
                seq: 7,
                at_us: 2_000,
                tool: LedgerTool::Hypothesis,
                input: json!({"id": "h1", "statement": "The pool ran dry", "status": "root_cause", "reason": "r2", "evidence": [e1, e9], "trigger_steer_id": "stg_1"}),
            },
            LedgerCall {
                seq: 9,
                at_us: 3_000,
                tool: LedgerTool::BlindSpot,
                input: json!({"id": "b1", "axis": "other", "title": "Feature-flag history", "why": "w", "fix": "connect_toolset"}),
            },
        ];
        let input =
            json!({"org_id": "default", "type": "logs", "request_body": {"query": {"sql": SQL}}});
        let (result_summary, result_count) = summarize_result(
            "SearchSQL",
            &json!({"took": 3, "hits": [{}, {}], "total": 2}),
        );
        let tool_log = [ToolCallRecord {
            call_id: "call_1".to_string(),
            tool: "SearchSQL".to_string(),
            key_arg: SQL.to_string(),
            stream_type: stream_type("SearchSQL", &input),
            success: true,
            result_count,
            started_at_us: 900,
            duration_ms: 41,
            error_type: None,
            signal: signal_class("SearchSQL", &input),
            target: evidence_target("SearchSQL", &input),
            observed: None,
            result_summary,
        }];
        let submit = parse_submit(&json!({
            "markdown": "report",
            "verdict": {
                "probable_cause": "The pool ran dry",
                "claimed_confidence": "high",
                "claimed_outcome": "root_cause_identified",
                "page_recommendation": {"action": "page", "reason": "r"},
                "report_ref": "report",
            },
            "timeline": [{"at": 500, "text": "Errors began", "status": "confirmed", "evidence_ids": ["e1"]}],
        }))
        .unwrap();
        let end = record_run_end(&RunEndInput {
            submit: Some(&submit),
            calls: &calls,
            tool_log: &tool_log,
            stages_run: &[],
            ended_by: EndedBy::Agent,
            completed: true,
            steer_authors: &std::collections::BTreeMap::from([(
                "stg_1".to_string(),
                "a.rao@acme.io".to_string(),
            )]),
            ended_at_us: 0,
        });
        serde_json::to_value(end.record).unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_summary_route_answers_by_run_record_and_session() {
        use axum::http::StatusCode;
        use infra::table::entity::{ai_chat_sessions, rca_runs};
        use sea_orm::{ActiveModelTrait, EntityTrait};
        use serde_json::json;

        let conn = thread_tables().await;
        let org = format!(
            "summary_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let live = |run_id: &str, session: Option<&str>| {
            let mut run = thread_run(&org, run_id, "inc_1", session);
            run.state = "running".to_string();
            run.ended_at = None;
            run.report = None;
            run
        };
        let mut recorded = thread_run(&org, "run_recorded", "inc_1", Some("ses_gone"));
        recorded.result = Some(stored_record().to_string());
        let mut unreadable = thread_run(&org, "run_unreadable", "inc_1", None);
        unreadable.result = Some(json!({"schema_version": "one", "ledger": 5}).to_string());
        let mut never_started = live("run_live_never", Some("ses_never"));
        never_started.error = Some(json!({"code": "turn_limit", "reason": "r"}).to_string());
        for run in [
            recorded,
            unreadable,
            thread_run(&org, "run_sum_legacy", "inc_1", None),
            live("run_live_bare", None),
            live("run_live_gone", Some("ses_gone")),
            live("run_sum_live", Some("ses_live")),
            never_started,
        ] {
            rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
                .exec(conn)
                .await
                .unwrap();
        }
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
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        };
        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(session).reset_all())
            .exec(conn)
            .await
            .unwrap();

        let read = |incident: &str, run: &str, known: Option<&str>| {
            get_incident_rca_summary(
                Path((org.clone(), incident.to_string(), run.to_string())),
                Query(RcaThreadQuery {
                    known_version: known.map(str::to_string),
                }),
            )
        };

        let (status, _) = status_and_body(read("inc_2", "run_recorded", None).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "another incident's run");
        let (status, _) = status_and_body(read("inc_1", "run_unknown", None).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "an unknown run");

        let (status, body) = status_and_body(read("inc_1", "run_recorded", None).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["run_id"], "run_recorded");
        assert_eq!(body["state"], "completed");
        assert_eq!(body["state_version"], "-1.0.2000");
        assert_eq!(body["not_modified"], false);
        assert_eq!(body["legacy"], false);
        let card = &body["card"];
        assert_eq!(card["outcome"], "root_cause_identified");
        assert_eq!(card["outcome_reason"], "root_cause_graded");
        assert_eq!(card["headline"], "The pool ran dry");
        assert_eq!(card["band"], "medium");
        assert_eq!(
            card["confidence"],
            json!({
                "claimed": "high",
                "evidence": "medium",
                "evidence_reason": "1 decisive source (logs)",
                "next_level": "High needs a second decisive source and a ruled-out alternative",
                "caps": [],
            })
        );
        assert!(card["leading"].is_null() && card["verdict_so_far"].is_null());
        assert_eq!(
            body["timeline"],
            json!([{"at": 500, "text": "Errors began", "status": "confirmed", "evidence_numbers": [1]}])
        );
        let h1 = &body["hypotheses"][0];
        assert_eq!(h1["id"], "h1");
        assert_eq!(h1["status"], "root_cause");
        assert_eq!(h1["reason"], "r2");
        assert_eq!(h1["evidence_numbers"], json!([1]));
        assert_eq!(h1["unverified_ids"], json!(["e9"]));
        assert_eq!(h1["first_seen_seq"], 3);
        assert!(h1.get("label").is_none(), "F10: no server label");
        assert_eq!(
            h1["history"],
            json!([
                {"at": 1_000, "status": "testing"},
                {"at": 2_000, "status": "root_cause", "steered_by": "a.rao@acme.io"},
            ])
        );
        let e = &body["evidence"][0];
        assert_eq!(e["number"], 1);
        assert_eq!(e["ids"], json!(["e1"]));
        assert_eq!(e["target"], "logs");
        assert_eq!(e["decisive"], true);
        assert_eq!(e["link"]["signal"], "logs");
        assert_eq!(e["link"]["streams"], json!(["app_logs"]));
        assert_eq!(
            e["link"]["sql"],
            "SELECT count(*) FROM app_logs WHERE level = 'error'"
        );
        assert_eq!(e["result_summary"], "2 rows · took 3 ms");
        assert_eq!(
            e["citations"],
            json!([{"hypothesis_id": "h1", "evidence_id": "e1", "polarity": "supports", "strength": "decisive", "observation": "errors began at 10:02"}])
        );
        assert_eq!(body["unverified"][0]["evidence_id"], "e9");
        assert_eq!(body["unverified"][0]["reason"], "not_run");
        assert_eq!(
            body["blind_spots"],
            json!([{"id": "b1", "axis": "other", "title": "Feature-flag history", "why": "w", "fix": "connect_toolset"}])
        );

        // No result, or one that does not read, is a legacy run.
        for run_id in ["run_sum_legacy", "run_unreadable"] {
            let (status, body) = status_and_body(read("inc_1", run_id, None).await).await;
            assert_eq!(status, StatusCode::OK, "{run_id}");
            assert_eq!(body["legacy"], true, "{run_id}");
            assert_eq!(body["state"], "completed", "{run_id}");
            assert!(body["card"]["outcome"].is_null(), "{run_id}");
            assert!(body["card"]["band"].is_null(), "{run_id}");
            assert_eq!(body["hypotheses"], json!([]), "{run_id}");
        }

        let (status, body) =
            status_and_body(read("inc_1", "run_recorded", Some("-1.0.2000")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"run_id": "run_recorded", "state_version": "-1.0.2000", "not_modified": true})
        );

        // A live run with no session yet: an empty live summary, no grade or outcome.
        let (status, body) = status_and_body(read("inc_1", "run_live_bare", None).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["state"], "running");
        assert_eq!(body["legacy"], false);
        assert_eq!(body["state_version"], "-1.0.2000");
        assert!(body["card"]["band"].is_null() && body["card"]["outcome"].is_null());
        assert_eq!(body["hypotheses"], json!([]));
        assert_eq!(body["timeline"], json!([]));

        let (status, body) = status_and_body(read("inc_1", "run_live_gone", None).await).await;
        assert_eq!(status, StatusCode::GONE);
        assert_eq!(body["error_code"], "transcript_expired");
        let (status, body) = status_and_body(read("inc_1", "run_live_never", None).await).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "a turn that never started had no transcript"
        );
        assert_eq!(body["legacy"], false);
        assert_eq!(body["hypotheses"], json!([]));

        // A live run's version is the thread's, without the tool output setting.
        let (status, body) =
            status_and_body(read("inc_1", "run_sum_live", Some("41.1500.2000")).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"run_id": "run_sum_live", "state_version": "41.1500.2000", "not_modified": true})
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_an_ended_run_without_its_record_reads_its_session() {
        use axum::http::StatusCode;
        use infra::table::entity::{ai_chat_sessions, rca_runs};
        use sea_orm::{ActiveModelTrait, EntityTrait};
        use serde_json::json;

        let conn = thread_tables().await;
        let org = format!(
            "partial_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let ended = |run_id: &str, state: &str, session: Option<&str>| {
            let mut run = thread_run(&org, run_id, "inc_1", session);
            run.state = state.to_string();
            run.report = None;
            run
        };
        for run in [
            ended("run_part_cancelled", "cancelled", Some("ses_partial")),
            ended("run_part_failed", "failed", Some("ses_partial")),
            ended("run_part_completed", "completed", Some("ses_partial")),
            ended("run_part_gone", "cancelled", Some("ses_missing")),
            ended("run_part_bare", "cancelled", None),
        ] {
            rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
                .exec(conn)
                .await
                .unwrap();
        }
        let session = ai_chat_sessions::Model {
            org_id: org.clone(),
            session_id: "ses_partial".to_string(),
            user_id: "sys".to_string(),
            user_email: "sys@acme.io".to_string(),
            opencode_session_id: None,
            agent_type: "sre-rca".to_string(),
            title: "Analyze incident inc_1".to_string(),
            title_source: "prompt".to_string(),
            status: "active".to_string(),
            created_at: 1_000,
            updated_at: 1_700,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: 7,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        };
        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(session).reset_all())
            .exec(conn)
            .await
            .unwrap();
        let read = |run: &str, known: Option<&str>| {
            get_incident_rca_summary(
                Path((org.clone(), "inc_1".to_string(), run.to_string())),
                Query(RcaThreadQuery {
                    known_version: known.map(str::to_string),
                }),
            )
        };

        // The session path: the version is the live formula over the session.
        for run_id in ["run_part_cancelled", "run_part_failed"] {
            let (status, body) = status_and_body(read(run_id, Some("7.1700.2000")).await).await;
            assert_eq!(status, StatusCode::OK, "{run_id}");
            assert_eq!(
                body,
                json!({"run_id": run_id, "state_version": "7.1700.2000", "not_modified": true}),
                "{run_id}"
            );
        }

        for run_id in ["run_part_completed", "run_part_gone", "run_part_bare"] {
            let (status, body) = status_and_body(read(run_id, None).await).await;
            assert_eq!(status, StatusCode::OK, "{run_id}");
            assert_eq!(body["legacy"], true, "{run_id}");
            assert_eq!(body["state_version"], "-1.0.2000", "{run_id}");
        }
    }

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
            // A lost tail of an ended run is served as a truncated thread; a running one waits.
            (
                false,
                ReadError::Gap {
                    expected: 5,
                    found: None,
                },
                unavailable,
            ),
            (
                false,
                ReadError::Corrupt("bad hash".to_string()),
                unavailable,
            ),
        ] {
            let label = format!("terminal={terminal} {error:?}");
            let error = openobserve_core::alerts::rca_live::PartError::read(
                "run_1", "ses_1", terminal, &error,
            );
            let (got, body) = status_and_body(part_error_response(&error)).await;
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

    #[cfg(feature = "enterprise")]
    const STEER_ROOT: &str = "root@steering.incidents.test";
    /// Fails it while the incident exists: `check_permissions` finds no user record.
    #[cfg(feature = "enterprise")]
    const STEER_READER: &str = "reader@steering.incidents.test";

    #[cfg(feature = "enterprise")]
    async fn steering_tables() -> &'static sea_orm::DatabaseConnection {
        use infra::table::entity::{
            ai_chat_sessions, ai_chat_turns, alert_incident_alerts, alert_incidents,
            incident_events, rca_runs, rca_steering,
        };
        use sea_orm::{ConnectionTrait, Schema};

        static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        TABLES
            .get_or_init(|| async {
                unsafe {
                    std::env::set_var("O2_INCIDENTS_ENABLED", "true");
                    std::env::set_var("O2_INCIDENTS_RCA_ENABLED", "true");
                    std::env::set_var("O2_AGENT_URL", "http://127.0.0.1:1");
                }
                o2_enterprise::enterprise::common::config::refresh_config().unwrap();
                let cfg = config::get_config();
                assert!(
                    cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite",
                    "the steering route tests need the default SQLite meta store, found {:?}",
                    cfg.common.meta_store
                );
                std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
                let conn = infra::db::get_orm_client_rw().await;
                let backend = conn.get_database_backend();
                let schema = Schema::new(backend);
                for mut table in [
                    schema.create_table_from_entity(alert_incidents::Entity),
                    schema.create_table_from_entity(alert_incident_alerts::Entity),
                    schema.create_table_from_entity(incident_events::Entity),
                    schema.create_table_from_entity(rca_runs::Entity),
                    schema.create_table_from_entity(rca_steering::Entity),
                    schema.create_table_from_entity(ai_chat_sessions::Entity),
                    schema.create_table_from_entity(ai_chat_turns::Entity),
                ] {
                    conn.execute(backend.build(table.if_not_exists()))
                        .await
                        .unwrap();
                }
                // A start's triage hold lives on `scheduled_jobs`.
                infra::scheduler::init().await.unwrap();
                common::infra::config::ORG_USERS.insert(
                    format!("{}/{STEER_ROOT}", config::DEFAULT_ORG),
                    infra::table::org_users::OrgUserRecord::new(
                        config::DEFAULT_ORG,
                        STEER_ROOT,
                        config::meta::user::UserRole::Root,
                        "token",
                        None,
                    ),
                );
            })
            .await;
        infra::db::get_orm_client_rw().await
    }

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn cloud_manual_and_resume_refusal_after_start_releases_the_page_without_usage() {
        use config::meta::{
            alerts::rca_runs::{RunMode, RunTrigger},
            oncall::{AnalysisStatus, ResponderRole, SubjectRef, SubjectType},
            triggers::{Trigger, TriggerModule, TriggerStatus},
        };
        use infra::table::entity::{oncall_responses, trial_quota_usage};
        use o2_enterprise::enterprise::oncall::escalation::EscalationTriggerData;
        use openobserve_core::{alerts::rca_runs, trial_quota};
        use sea_orm::{ConnectionTrait, Schema};
        let db = steering_tables().await;
        db.execute_unprepared(
            "CREATE TABLE IF NOT EXISTS customer_billings (
                id TEXT PRIMARY KEY, email TEXT NOT NULL, org_id TEXT NOT NULL,
                customer_id TEXT, subscription_id TEXT, subscription_type SMALLINT NOT NULL,
                session_id TEXT, metering_offset BIGINT NOT NULL, provider TEXT NOT NULL,
                end_date BIGINT, expiry_notified_stage SMALLINT
            )",
        )
        .await
        .unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for mut table in [
            schema.create_table_from_entity(oncall_responses::Entity),
            schema.create_table_from_entity(trial_quota_usage::Entity),
        ] {
            db.execute(backend.build(table.if_not_exists()))
                .await
                .unwrap();
        }
        for trigger in [RunTrigger::Manual, RunTrigger::Resume] {
            let org = steering_org("cloud-refusal");
            let incident = sid(&org, "incident");
            steering_incident(db, &org, "incident", None).await;
            let feature = if trigger == RunTrigger::Manual {
                trial_quota::TrialQuotaFeature::NewIncident
            } else {
                trial_quota::TrialQuotaFeature::IncidentReAnalysis
            };
            trial_quota::set_limit(&org, 100).await.unwrap();
            trial_quota::precheck_ai_usage(&org, feature, STEER_ROOT)
                .await
                .unwrap();
            let started = rca_runs::start_run(rca_runs::StartRun {
                org_id: org.clone(),
                subject: rca_runs::RunSubject::Incident(incident.clone()),
                trigger,
                mode: RunMode::Fresh,
                started_by: STEER_ROOT.to_string(),
                guidance: Some("Check the deploy".to_string()),
                skip_cooldown: true,
                oncall_subjects: None,
                context_used: None,
            })
            .await
            .unwrap();
            let rca_runs::StartOutcome::Started { run_id } = started else {
                panic!("{started:?}")
            };
            let subject = SubjectRef::new(SubjectType::Incident, &incident, 1);
            let record = infra::table::oncall_responses::open(
                &org,
                &subject,
                None,
                2,
                None,
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap();
            let mut hold = EscalationTriggerData::none();
            hold.analysis.status = AnalysisStatus::Pending;
            infra::scheduler::push(Trigger {
                org: org.clone(),
                module: TriggerModule::OncallEscalation,
                module_key: record.id.clone(),
                next_run_at: config::utils::time::now_micros() + 3_600_000_000,
                status: TriggerStatus::Waiting,
                data: hold.write(),
                ..Default::default()
            })
            .await
            .unwrap();
            trial_quota::set_limit(&org, 0).await.unwrap();
            let response = authorize_started_rca(
                &org,
                &incident,
                &run_id,
                trigger,
                feature,
                &trial_quota::AiUsageContext {
                    user_email: STEER_ROOT.to_string(),
                    incident_id: Some(incident.clone()),
                    ..Default::default()
                },
            )
            .await
            .err()
            .expect("billing refuses after the successful precheck");
            assert_eq!(response.status(), axum::http::StatusCode::PAYMENT_REQUIRED);
            let run = infra::table::rca_runs::get_rw(&org, &run_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(run.state, "failed");
            assert_eq!(run.error.as_ref().unwrap()["code"], "usage_denied");
            assert!(run.ended_at.is_some());
            assert_eq!(trial_quota::get_used(&org), 0);
            let guidance = infra::table::rca_steering::list_for_run(&org, &run_id)
                .await
                .unwrap();
            assert_eq!(guidance.len(), 1);
            assert_eq!(
                (guidance[0].status, guidance[0].status_reason),
                (
                    config::meta::alerts::rca_steering::SteerStatus::NotRead,
                    Some(config::meta::alerts::rca_steering::SteerStatusReason::RunFailed)
                )
            );
            let scheduled =
                infra::scheduler::get(&org, TriggerModule::OncallEscalation, &record.id)
                    .await
                    .unwrap();
            assert_eq!(
                EscalationTriggerData::read(&scheduled.data).analysis.status,
                AnalysisStatus::Skipped
            );
        }
    }

    /// A fresh org name for one test.
    #[cfg(feature = "enterprise")]
    fn steering_org(prefix: &str) -> String {
        format!(
            "{prefix}_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        )
    }

    /// Incident and run ids are primary keys across orgs: each test's names are scoped to its org.
    #[cfg(feature = "enterprise")]
    fn sid(org_id: &str, name: &str) -> String {
        format!("{name}.{org_id}")
    }

    /// An open incident whose latest run is `rca_run_id`.
    #[cfg(feature = "enterprise")]
    async fn steering_incident(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        incident_id: &str,
        rca_run_id: Option<&str>,
    ) {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let now = config::utils::time::now_micros();
        let row = alert_incidents::Model {
            id: sid(org_id, incident_id),
            org_id: org_id.to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({}),
            key_type: "alert_id".to_string(),
            topology_context: None,
            first_alert_at: now,
            last_alert_at: now,
            resolved_at: None,
            alert_count: 1,
            title: Some("checkout errors".to_string()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: now,
            updated_at: now,
            muted_by_downtime_id: None,
            rca_run_id: rca_run_id.map(|run_id| sid(org_id, run_id)),
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
        };
        alert_incidents::Entity::insert(alert_incidents::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    /// A run of `incident_id` in `state`, with no session (so no transcript and no ledger).
    #[cfg(feature = "enterprise")]
    async fn steering_run(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        run_id: &str,
        incident_id: &str,
        state: &str,
    ) {
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let mut run = thread_run(
            org_id,
            &sid(org_id, run_id),
            &sid(org_id, incident_id),
            None,
        );
        run.state = state.to_string();
        if matches!(state, "running" | "waiting_input") {
            run.ended_at = None;
            run.report = None;
        }
        rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    async fn steer_as(
        org_id: &str,
        incident_id: &str,
        run_id: &str,
        user: &str,
        body: &str,
    ) -> Response {
        steer_incident_rca_run(
            Path((
                org_id.to_string(),
                sid(org_id, incident_id),
                sid(org_id, run_id),
            )),
            Headers(UserEmail {
                user_id: user.to_string(),
            }),
            axum::body::Bytes::from(body.to_string()),
        )
        .await
    }

    #[cfg(feature = "enterprise")]
    async fn steering_as(
        org_id: &str,
        incident_id: &str,
        run_id: &str,
        user: &str,
    ) -> (axum::http::StatusCode, serde_json::Value) {
        status_and_body(
            get_incident_rca_steering(
                Path((
                    org_id.to_string(),
                    sid(org_id, incident_id),
                    sid(org_id, run_id),
                )),
                Headers(UserEmail {
                    user_id: user.to_string(),
                }),
            )
            .await,
        )
        .await
    }

    #[cfg(feature = "enterprise")]
    async fn steer_rows(
        org_id: &str,
        run_id: &str,
    ) -> Vec<config::meta::alerts::rca_steering::SteerRecord> {
        infra::table::rca_steering::list_for_run(org_id, &sid(org_id, run_id))
            .await
            .unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_steer_to_a_live_run_answers_201_with_the_row_and_run_state() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("steer201");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;

        let (status, body) = status_and_body(
            steer_as(
                &org,
                "inc_1",
                "run_live",
                STEER_ROOT,
                r#"{"text":"  We raised the orders pool to 150 on Oct 8  ","kind":"message"}"#,
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        let mut keys: Vec<&str> = body
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["run_state", "steer"]);
        assert_eq!(body["run_state"], "running");
        let steer = &body["steer"];
        let steer_id = steer["steer_id"].as_str().unwrap();
        assert!(
            regex::Regex::new(r"^stg_[0-9A-Za-z]{27}$")
                .unwrap()
                .is_match(steer_id),
            "{steer_id}"
        );
        assert_eq!(steer["org_id"], org.as_str());
        assert_eq!(steer["run_id"], sid(&org, "run_live"));
        assert_eq!(steer["incident_id"], sid(&org, "inc_1"));
        assert_eq!(steer["author_email"], STEER_ROOT);
        assert_eq!(steer["kind"], "message");
        assert!(steer["action"].is_null() && steer["hypothesis_id"].is_null());
        assert_eq!(steer["text"], "We raised the orders pool to 150 on Oct 8");
        assert_eq!(steer["status"], "rejected");
        assert_eq!(steer["status_reason"], "agent_unreachable");
        assert!(steer["created_at"].as_i64().unwrap() > 0);
        assert!(steer["delivered_at"].is_null());

        let rows = steer_rows(&org, "run_live").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].steer_id, steer_id);
        assert_eq!(
            serde_json::to_value(&rows[0]).unwrap(),
            *steer,
            "the answer is the stored row"
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_an_invalid_steer_body_is_400_with_its_code() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("steer400");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;

        let too_long = serde_json::json!({"text": "é".repeat(2001), "kind": "message"}).to_string();
        for (body, code) in [
            (
                r#"{"text":"hi","kind":"message","author_email":"x@acme.io"}"#,
                "invalid_body",
            ),
            (
                r#"{"text":"hi","kind":"message","priority":1}"#,
                "invalid_body",
            ),
            ("not json", "invalid_body"),
            (r#"{"text":"   ","kind":"message"}"#, "invalid_text"),
            (r#"{"kind":"message"}"#, "invalid_text"),
            (too_long.as_str(), "invalid_text"),
            (r#"{"text":"hi","kind":"answer"}"#, "invalid_kind"),
            (r#"{"text":"hi","kind":"guidance"}"#, "invalid_kind"),
            (r#"{"text":"hi","kind":"shout"}"#, "invalid_kind"),
            (
                r#"{"text":"hi","kind":"message","action":"disprove"}"#,
                "invalid_action",
            ),
            (
                r#"{"text":"hi","kind":"message","hypothesis_id":"h1"}"#,
                "invalid_action",
            ),
            (
                r#"{"kind":"hypothesis_action","hypothesis_id":"h1"}"#,
                "invalid_action",
            ),
            (
                r#"{"kind":"hypothesis_action","action":"explode","hypothesis_id":"h1"}"#,
                "invalid_action",
            ),
            (
                r#"{"kind":"hypothesis_action","action":"disprove"}"#,
                "invalid_action",
            ),
            (
                r#"{"kind":"hypothesis_action","action":"disprove","hypothesis_id":"h9"}"#,
                "unknown_hypothesis",
            ),
        ] {
            let label: String = body.chars().take(80).collect();
            let (status, answer) =
                status_and_body(steer_as(&org, "inc_1", "run_live", STEER_ROOT, body).await).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{label}: {answer}");
            assert_eq!(answer["code"], 400, "{label}");
            assert_eq!(answer["error_code"], code, "{label}: {answer}");
            assert!(answer.get("retry_after_secs").is_none(), "{label}");
        }
        assert!(steer_rows(&org, "run_live").await.is_empty());

        // Counts scalar values, not bytes: 2,000 two-byte characters are 4,000 bytes.
        let longest = serde_json::json!({"text": "é".repeat(2000), "kind": "message"}).to_string();
        let (status, answer) =
            status_and_body(steer_as(&org, "inc_1", "run_live", STEER_ROOT, &longest).await).await;
        assert_eq!(status, StatusCode::CREATED, "{answer}");
        assert_eq!(
            answer["steer"]["text"].as_str().unwrap().chars().count(),
            2000
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_steering_needs_the_rca_permission_and_a_known_run() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("steer403");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_incident(conn, &org, "inc_2", None).await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;
        let message = r#"{"text":"Check the orders pool","kind":"message"}"#;

        let (status, body) =
            status_and_body(steer_as(&org, "inc_1", "run_live", STEER_READER, message).await).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
        assert!(steer_rows(&org, "run_live").await.is_empty());

        for user in [STEER_ROOT, STEER_READER] {
            let (status, body) =
                status_and_body(steer_as(&org, "inc_unknown", "run_live", user, message).await)
                    .await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{user}: {body}");
        }
        for (incident, run) in [("inc_1", "run_unknown"), ("inc_2", "run_live")] {
            let (status, body) =
                status_and_body(steer_as(&org, incident, run, STEER_ROOT, message).await).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{incident}/{run}: {body}");
        }
        assert!(steer_rows(&org, "run_live").await.is_empty());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_run_that_takes_no_messages_is_409_and_gets_no_row() {
        use axum::http::StatusCode;
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let conn = steering_tables().await;
        let org = steering_org("steer409");
        steering_incident(conn, &org, "inc_done", Some("run_done")).await;
        steering_run(conn, &org, "run_done", "inc_done", "completed").await;
        steering_incident(conn, &org, "inc_newer", Some("run_newer")).await;
        steering_run(conn, &org, "run_older", "inc_newer", "running").await;
        steering_run(conn, &org, "run_newer", "inc_newer", "running").await;
        steering_incident(conn, &org, "inc_closing", Some("run_closing")).await;
        let mut closing = thread_run(
            &org,
            &sid(&org, "run_closing"),
            &sid(&org, "inc_closing"),
            None,
        );
        closing.state = "running".to_string();
        closing.ended_at = None;
        closing.report = None;
        closing.deadline_closed_at = Some(config::utils::time::now_micros());
        rca_runs::Entity::insert(rca_runs::ActiveModel::from(closing).reset_all())
            .exec(conn)
            .await
            .unwrap();

        let message = r#"{"text":"Check the orders pool","kind":"message"}"#;
        for (incident, run, code) in [
            ("inc_done", "run_done", "run_not_steerable"),
            ("inc_newer", "run_older", "run_not_steerable"),
            ("inc_closing", "run_closing", "run_closing"),
        ] {
            let (status, body) =
                status_and_body(steer_as(&org, incident, run, STEER_ROOT, message).await).await;
            assert_eq!(status, StatusCode::CONFLICT, "{run}: {body}");
            assert_eq!(body["code"], 409, "{run}");
            assert_eq!(body["error_code"], code, "{run}");
            assert!(steer_rows(&org, run).await.is_empty(), "{run}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_second_message_within_5_seconds_is_429_with_retry_after() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("steer429");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;
        let message = r#"{"text":"Check the orders pool","kind":"message"}"#;

        let first = steer_as(&org, "inc_1", "run_live", STEER_ROOT, message).await;
        assert_eq!(first.status(), StatusCode::CREATED);
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let second = steer_as(&org, "inc_1", "run_live", STEER_ROOT, message).await;
        let header = second
            .headers()
            .get(axum::http::header::RETRY_AFTER)
            .map(|value| value.to_str().unwrap().to_string());
        let (status, body) = status_and_body(second).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
        assert_eq!(body["code"], 429);
        assert_eq!(body["error_code"], "rate_limited");
        let retry_after = body["retry_after_secs"].as_u64().unwrap();
        assert!((4..=5).contains(&retry_after), "{retry_after}");
        assert_eq!(header, Some(retry_after.to_string()));
        assert_eq!(steer_rows(&org, "run_live").await.len(), 1);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_steering_view_lists_rows_and_who_can_steer() {
        use axum::http::StatusCode;
        use config::meta::alerts::rca_steering::{
            SteerKind, SteerRecord, SteerStatus, SteerStatusReason,
        };
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let conn = steering_tables().await;
        let org = steering_org("steering");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_run(conn, &org, "run_done", "inc_1", "completed").await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;
        steering_incident(conn, &org, "inc_wait", Some("run_wait")).await;
        steering_run(conn, &org, "run_wait", "inc_wait", "waiting_input").await;
        steering_incident(conn, &org, "inc_closing", Some("run_closing")).await;
        let mut closing = thread_run(
            &org,
            &sid(&org, "run_closing"),
            &sid(&org, "inc_closing"),
            None,
        );
        closing.state = "running".to_string();
        closing.ended_at = None;
        closing.report = None;
        closing.deadline_closed_at = Some(config::utils::time::now_micros());
        rca_runs::Entity::insert(rca_runs::ActiveModel::from(closing).reset_all())
            .exec(conn)
            .await
            .unwrap();

        let row = |steer_id: &str, created_at: i64, status: SteerStatus| SteerRecord {
            org_id: org.clone(),
            steer_id: steer_id.to_string(),
            run_id: sid(&org, "run_live"),
            incident_id: sid(&org, "inc_1"),
            author_email: "a.rao@acme.io".to_string(),
            kind: SteerKind::Message,
            action: None,
            hypothesis_id: None,
            question_id: None,
            text: format!("message {steer_id}"),
            status,
            status_reason: None,
            created_at,
            delivered_at: None,
            read_at: None,
            acted_at: None,
            agent_note: None,
            opencode_message_id: None,
        };
        let mut applied = row("stg_applied", 2_000, SteerStatus::Applied);
        applied.delivered_at = Some(2_100);
        applied.read_at = Some(2_200);
        applied.acted_at = Some(2_300);
        applied.agent_note = Some("checked the pool first".to_string());
        let mut rejected = row("stg_rejected", 1_000, SteerStatus::Rejected);
        rejected.status_reason = Some(SteerStatusReason::AgentUnreachable);
        for record in [&applied, &rejected] {
            infra::table::rca_steering::insert(record).await.unwrap();
        }
        let stored = steer_rows(&org, "run_live").await;

        let (status, root_view) = steering_as(&org, "inc_1", "run_live", STEER_ROOT).await;
        assert_eq!(status, StatusCode::OK, "{root_view}");
        assert_eq!(
            root_view,
            serde_json::json!({
                "items": [
                    serde_json::to_value(&rejected).unwrap(),
                    serde_json::to_value(&applied).unwrap(),
                ],
                "open_question": null,
                "can_steer": true,
            })
        );

        // The reader sees the thread's messages but no steer box.
        let (status, reader_view) = steering_as(&org, "inc_1", "run_live", STEER_READER).await;
        assert_eq!(status, StatusCode::OK, "{reader_view}");
        assert_eq!(reader_view["items"], root_view["items"]);
        assert_eq!(reader_view["can_steer"], false);

        for (incident, run, can_steer) in [
            ("inc_1", "run_done", false),
            ("inc_wait", "run_wait", true),
            ("inc_closing", "run_closing", false),
        ] {
            let (status, view) = steering_as(&org, incident, run, STEER_ROOT).await;
            assert_eq!(status, StatusCode::OK, "{run}: {view}");
            assert_eq!(view["can_steer"], can_steer, "{run}");
            assert_eq!(view["items"], serde_json::json!([]), "{run}");
            assert!(view["open_question"].is_null(), "{run}");
        }

        for (incident, run) in [
            ("inc_1", "run_unknown"),
            ("inc_wait", "run_live"),
            ("inc_unknown", "run_live"),
        ] {
            let (status, _) = steering_as(&org, incident, run, STEER_ROOT).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{incident}/{run}");
        }
        assert_eq!(
            steer_rows(&org, "run_live").await,
            stored,
            "the view writes nothing"
        );
    }

    #[cfg(feature = "enterprise")]
    fn live_stream_as(
        org_id: &str,
        incident_id: &str,
        run_id: Option<&str>,
        user: &str,
    ) -> impl Future<Output = Response> {
        get_incident_rca_live_stream(
            Path((org_id.to_string(), sid(org_id, incident_id))),
            Query(RcaLiveStreamQuery {
                run_id: run_id.map(|run_id| sid(org_id, run_id)),
            }),
            Headers(UserEmail {
                user_id: user.to_string(),
            }),
        )
    }

    /// The events of a live stream up to `last`, as `(name, data)`.
    #[cfg(feature = "enterprise")]
    async fn live_events(response: Response, last: &str) -> Vec<(String, serde_json::Value)> {
        use futures::StreamExt;

        let mut body = response.into_body().into_data_stream();
        let mut text = String::new();
        let mut events = Vec::new();
        while let Some(chunk) = body.next().await {
            text.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
            while let Some(end) = text.find("\n\n") {
                let frame: String = text.drain(..end + 2).collect();
                let mut lines = frame.lines();
                let name = lines.next().unwrap().strip_prefix("event: ").unwrap();
                let data = lines.next().unwrap().strip_prefix("data: ").unwrap();
                events.push((name.to_string(), serde_json::from_str(data).unwrap()));
                if name == last {
                    return events;
                }
            }
        }
        panic!("the stream closed before {last}: {events:?}");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_live_stream_refuses_with_json_before_the_first_byte() {
        use axum::http::StatusCode;

        let conn = steering_tables().await;
        let org = steering_org("live");
        steering_incident(conn, &org, "inc_1", Some("run_1")).await;
        steering_incident(conn, &org, "inc_2", None).await;
        steering_run(conn, &org, "run_1", "inc_1", "running").await;

        for (incident, run, message) in [
            ("inc_unknown", None, "Incident not found"),
            ("inc_2", Some("run_1"), "Run not found"),
            ("inc_1", Some("run_unknown"), "Run not found"),
        ] {
            let response = live_stream_as(&org, incident, run, STEER_ROOT).await;
            assert_eq!(
                response.headers()[axum::http::header::CONTENT_TYPE],
                "application/json",
                "{incident}/{run:?}"
            );
            let (status, body) = status_and_body(response).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{incident}/{run:?}");
            assert_eq!(body["message"], message, "{incident}/{run:?}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_a_live_stream_without_a_run_sends_rca_then_end() {
        let conn = steering_tables().await;
        let org = steering_org("live");
        steering_incident(conn, &org, "inc_1", None).await;

        let response = live_stream_as(&org, "inc_1", None, STEER_ROOT).await;
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response.headers()[axum::http::header::CONTENT_TYPE],
            "text/event-stream"
        );
        assert_eq!(response.headers()["X-Accel-Buffering"], "no");
        let events = live_events(response, "end").await;
        assert_eq!(
            events,
            [
                ("rca".to_string(), serde_json::Value::Null),
                ("end".to_string(), serde_json::json!({"state": null})),
            ]
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_live_steering_names_who_can_steer_and_the_stream_is_counted() {
        let conn = steering_tables().await;
        let org = steering_org("live");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        steering_run(conn, &org, "run_live", "inc_1", "running").await;
        // The org shows no tool input/output; cached, as the route reads it.
        common::infra::config::ORGANIZATION_SETTING
            .write()
            .await
            .insert(format!("/organization/setting/{org}"), Default::default());
        let open = || {
            config::metrics::RCA_LIVE_STREAMS
                .with_label_values(&[org.as_str()])
                .get()
        };

        for (user, can_steer) in [(STEER_ROOT, true), (STEER_READER, false)] {
            let response = live_stream_as(&org, "inc_1", Some("run_live"), user).await;
            assert_eq!(open(), 1, "{user}");
            let events = live_events(response, "steering").await;
            let names: Vec<&str> = events.iter().map(|(name, _)| name.as_str()).collect();
            assert_eq!(names, ["rca", "thread", "summary", "steering"], "{user}");
            assert_eq!(events[3].1["can_steer"], can_steer, "{user}");
            assert_eq!(events[1].1["run_id"], sid(&org, "run_live"), "{user}");
        }
        assert_eq!(open(), 0, "a dropped stream is no longer counted");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_each_live_part_is_its_get_body() {
        use config::meta::alerts::rca_steering::{SteerKind, SteerRecord, SteerStatus};
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let conn = steering_tables().await;
        let org = steering_org("parity");
        steering_incident(conn, &org, "inc_1", Some("run_done")).await;
        let mut run = thread_run(&org, &sid(&org, "run_done"), &sid(&org, "inc_1"), None);
        run.result = Some(stored_record().to_string());
        rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
            .exec(conn)
            .await
            .unwrap();
        let steer = SteerRecord {
            org_id: org.clone(),
            steer_id: "stg_parity".to_string(),
            run_id: sid(&org, "run_done"),
            incident_id: sid(&org, "inc_1"),
            author_email: "a.rao@acme.io".to_string(),
            kind: SteerKind::Message,
            action: None,
            hypothesis_id: None,
            question_id: None,
            text: "check the pool".to_string(),
            status: SteerStatus::Applied,
            status_reason: None,
            created_at: 1_500,
            delivered_at: Some(1_600),
            read_at: Some(1_700),
            acted_at: Some(1_800),
            agent_note: Some("checked".to_string()),
            opencode_message_id: None,
        };
        infra::table::rca_steering::insert(&steer).await.unwrap();
        common::infra::config::ORGANIZATION_SETTING
            .write()
            .await
            .insert(format!("/organization/setting/{org}"), Default::default());

        let response = live_stream_as(&org, "inc_1", Some("run_done"), STEER_ROOT).await;
        let events: std::collections::HashMap<String, serde_json::Value> =
            live_events(response, "end").await.into_iter().collect();
        let path = || Path((org.clone(), sid(&org, "inc_1"), sid(&org, "run_done")));
        let no_version = || {
            Query(RcaThreadQuery {
                known_version: None,
            })
        };
        let (_, thread) =
            status_and_body(get_incident_rca_thread(path(), no_version()).await).await;
        let (_, summary) =
            status_and_body(get_incident_rca_summary(path(), no_version()).await).await;
        let (_, steering) = steering_as(&org, "inc_1", "run_done", STEER_ROOT).await;
        assert_eq!(events["thread"], thread);
        assert_eq!(events["summary"], summary);
        assert_eq!(events["steering"], steering);
        assert_eq!(summary["card"]["headline"], "The pool ran dry");
        assert_eq!(steering["items"][0]["steer_id"], "stg_parity");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_guidance_on_a_reanalysis_reaches_the_run_and_its_row() {
        use axum::http::StatusCode;
        use config::meta::alerts::rca_steering::SteerKind;
        use infra::table::entity::rca_runs;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        let conn = steering_tables().await;
        let org = steering_org("guidance");
        steering_incident(conn, &org, "inc_1", None).await;
        steering_incident(conn, &org, "inc_2", None).await;
        let trigger = |incident: &'static str, body: String| {
            trigger_incident_rca(
                Path((org.clone(), sid(&org, incident))),
                Headers(UserEmail {
                    user_id: STEER_ROOT.to_string(),
                }),
                Query(TriggerRcaQuery {
                    build_on_previous: false,
                }),
                axum::body::Bytes::from(body),
            )
        };
        let runs_of = async |incident: &str| {
            rca_runs::Entity::find()
                .filter(rca_runs::Column::OrgId.eq(org.as_str()))
                .filter(rca_runs::Column::IncidentId.eq(sid(&org, incident)))
                .all(conn)
                .await
                .unwrap()
        };

        for (body, code) in [
            (r#"{"guidance":"   "}"#.to_string(), "invalid_guidance"),
            (r#"{"guidance":""}"#.to_string(), "invalid_guidance"),
            (
                serde_json::json!({"guidance": "é".repeat(2001)}).to_string(),
                "invalid_guidance",
            ),
            ("guidance please".to_string(), "invalid_body"),
            (
                r#"{"guidance":"look at db","priority":1}"#.to_string(),
                "invalid_body",
            ),
        ] {
            let label: String = body.chars().take(40).collect();
            let (status, answer) = status_and_body(trigger("inc_1", body).await).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{label}: {answer}");
            assert_eq!(answer["error_code"], code, "{label}");
        }
        assert!(
            runs_of("inc_1").await.is_empty(),
            "a refused body starts no run"
        );

        let response = trigger(
            "inc_1",
            serde_json::json!({"guidance": "  Check the orders pool first  "}).to_string(),
        )
        .await;
        let status = response.status();
        assert!(
            status != StatusCode::BAD_REQUEST && status != StatusCode::NOT_FOUND,
            "{status}"
        );
        let runs = runs_of("inc_1").await;
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.guidance.as_deref(), Some("Check the orders pool first"));
        assert_eq!(run.started_by, STEER_ROOT);
        let rows = infra::table::rca_steering::list_for_run(&org, &run.run_id)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(rows[0].kind, SteerKind::Guidance);
        assert_eq!(rows[0].text, "Check the orders pool first");
        assert_eq!(rows[0].author_email, STEER_ROOT);
        assert_eq!(rows[0].incident_id, sid(&org, "inc_1"));

        let response = trigger("inc_2", String::new()).await;
        assert_ne!(response.status(), StatusCode::BAD_REQUEST);
        let runs = runs_of("inc_2").await;
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].guidance, None);
        assert!(
            infra::table::rca_steering::list_for_run(&org, &runs[0].run_id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    fn run_path(org_id: &str, incident_id: &str, run_id: &str) -> Path<(String, String, String)> {
        Path((
            org_id.to_string(),
            sid(org_id, incident_id),
            sid(org_id, run_id),
        ))
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    async fn resume_source(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        run_id: &str,
        incident_id: &str,
        state: &str,
        session: Option<&str>,
        error_code: Option<&str>,
    ) {
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let session = session.map(|name| sid(org_id, name));
        let mut run = thread_run(
            org_id,
            &sid(org_id, run_id),
            &sid(org_id, incident_id),
            session.as_deref(),
        );
        run.state = state.to_string();
        run.report = None;
        if matches!(state, "running" | "waiting_input") {
            run.ended_at = None;
        }
        run.error =
            error_code.map(|code| serde_json::json!({"code": code, "reason": "r"}).to_string());
        rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    fn resume_session_row(
        org_id: &str,
        name: &str,
        status: &str,
        last_committed_seq: i64,
    ) -> infra::table::ai_chat_sessions::Model {
        infra::table::ai_chat_sessions::Model {
            org_id: org_id.to_string(),
            session_id: sid(org_id, name),
            user_id: "sys".to_string(),
            user_email: "sys@acme.io".to_string(),
            opencode_session_id: Some(format!("ses_{name}")),
            agent_type: "sre-rca".to_string(),
            title: "Analyze incident".to_string(),
            title_source: "prompt".to_string(),
            status: status.to_string(),
            created_at: 1_000,
            updated_at: 1_500,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        }
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    async fn insert_session(
        conn: &sea_orm::DatabaseConnection,
        row: infra::table::ai_chat_sessions::Model,
    ) {
        use infra::table::entity::ai_chat_sessions;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    async fn resume_as(
        org_id: &str,
        incident_id: &str,
        run_id: &str,
    ) -> (axum::http::StatusCode, serde_json::Value) {
        status_and_body(
            resume_incident_rca_run(
                run_path(org_id, incident_id, run_id),
                Headers(UserEmail {
                    user_id: STEER_ROOT.to_string(),
                }),
            )
            .await,
        )
        .await
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    fn resume_count(org_id: &str, result: &str) -> u64 {
        config::metrics::RCA_RESUME_TOTAL
            .with_label_values(&[org_id, result])
            .get()
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    async fn incident_runs(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        incident_id: &str,
    ) -> Vec<infra::table::entity::rca_runs::Model> {
        use infra::table::entity::rca_runs;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        rca_runs::Entity::find()
            .filter(rca_runs::Column::OrgId.eq(org_id))
            .filter(rca_runs::Column::IncidentId.eq(sid(org_id, incident_id)))
            .all(conn)
            .await
            .unwrap()
    }

    /// The incident's runs once none is live: the launch goes on after the 202.
    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    async fn settled_runs(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        incident_id: &str,
    ) -> Vec<infra::table::entity::rca_runs::Model> {
        for _ in 0..200 {
            let runs = incident_runs(conn, org_id, incident_id).await;
            if runs
                .iter()
                .all(|run| !matches!(run.state.as_str(), "running" | "waiting_input"))
            {
                return runs;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("a run of {incident_id} is still live after 10 s");
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_a_run_that_cannot_be_resumed_answers_by_reason() {
        use axum::http::StatusCode;
        use infra::table::ai_chat_sessions::{NO_SEQ, STATUS_ACTIVE, STATUS_DELETED};

        let conn = steering_tables().await;
        let org = steering_org("resume_refused");
        // (incident, its latest run, run state, session, error code)
        type Source<'a> = (&'a str, &'a str, &'a str, Option<&'a str>, Option<&'a str>);
        let sources: [Source; 9] = [
            ("inc_done", "run_done", "completed", Some("ses_full"), None),
            ("inc_live", "run_live", "running", Some("ses_full"), None),
            (
                "inc_deleted",
                "run_deleted",
                "failed",
                Some("ses_full"),
                Some("transcript_deleted"),
            ),
            (
                "inc_never",
                "run_never",
                "failed",
                Some("ses_full"),
                Some("turn_limit"),
            ),
            ("inc_bare", "run_bare", "failed", None, Some("timeout")),
            (
                "inc_gone",
                "run_gone",
                "cancelled",
                Some("ses_missing"),
                None,
            ),
            (
                "inc_purged",
                "run_purged",
                "failed",
                Some("ses_deleted"),
                Some("timeout"),
            ),
            (
                "inc_empty",
                "run_empty",
                "failed",
                Some("ses_empty"),
                Some("timeout"),
            ),
            (
                "inc_unread",
                "run_unread",
                "cancelled",
                Some("ses_unread"),
                None,
            ),
        ];
        for (incident, run, state, session, code) in sources {
            steering_incident(conn, &org, incident, Some(run)).await;
            resume_source(conn, &org, run, incident, state, session, code).await;
        }
        // An older failed run of an incident whose latest run completed.
        steering_incident(conn, &org, "inc_newer", Some("run_newer")).await;
        resume_source(
            conn,
            &org,
            "run_old",
            "inc_newer",
            "failed",
            Some("ses_full"),
            Some("timeout"),
        )
        .await;
        resume_source(
            conn,
            &org,
            "run_newer",
            "inc_newer",
            "completed",
            Some("ses_full"),
            None,
        )
        .await;
        for row in [
            resume_session_row(&org, "ses_full", STATUS_ACTIVE, 9),
            resume_session_row(&org, "ses_deleted", STATUS_DELETED, 9),
            resume_session_row(&org, "ses_empty", STATUS_ACTIVE, NO_SEQ),
            resume_session_row(&org, "ses_unread", STATUS_ACTIVE, 9),
        ] {
            insert_session(conn, row).await;
        }
        let runs_before = {
            let mut count = 0;
            for incident in [
                "inc_done",
                "inc_live",
                "inc_deleted",
                "inc_never",
                "inc_bare",
                "inc_gone",
                "inc_purged",
                "inc_empty",
                "inc_unread",
                "inc_newer",
            ] {
                count += incident_runs(conn, &org, incident).await.len();
            }
            count
        };

        let mut refused = 0;
        for (incident, run, status, code) in [
            ("inc_done", "run_unknown", StatusCode::NOT_FOUND, None),
            ("inc_live", "run_done", StatusCode::NOT_FOUND, None),
            ("inc_unknown", "run_done", StatusCode::NOT_FOUND, None),
            (
                "inc_done",
                "run_done",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_live",
                "run_live",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_newer",
                "run_old",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_deleted",
                "run_deleted",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_never",
                "run_never",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_bare",
                "run_bare",
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                "inc_gone",
                "run_gone",
                StatusCode::GONE,
                Some("transcript_expired"),
            ),
            (
                "inc_purged",
                "run_purged",
                StatusCode::GONE,
                Some("transcript_expired"),
            ),
            (
                "inc_empty",
                "run_empty",
                StatusCode::CONFLICT,
                Some("nothing_to_resume"),
            ),
        ] {
            let (got, body) = resume_as(&org, incident, run).await;
            assert_eq!(got, status, "{incident}/{run}: {body}");
            assert_eq!(body["code"], status.as_u16(), "{incident}/{run}: {body}");
            assert_eq!(
                body.get("error_code").and_then(|c| c.as_str()),
                code,
                "{incident}/{run}: {body}"
            );
            refused += 1;
            assert_eq!(resume_count(&org, "refused"), refused, "{incident}/{run}");
        }

        let (got, body) = resume_as(&org, "inc_unread", "run_unread").await;
        assert_eq!(got, StatusCode::SERVICE_UNAVAILABLE, "{body}");
        assert_eq!(body["error_code"], "history_unavailable");
        assert_eq!(
            resume_count(&org, "refused"),
            refused,
            "a 503 is not a refusal"
        );
        assert_eq!(resume_count(&org, "started"), 0);

        let mut runs_after = 0;
        for incident in [
            "inc_done",
            "inc_live",
            "inc_deleted",
            "inc_never",
            "inc_bare",
            "inc_gone",
            "inc_purged",
            "inc_empty",
            "inc_unread",
            "inc_newer",
        ] {
            runs_after += incident_runs(conn, &org, incident).await.len();
        }
        assert_eq!(runs_after, runs_before, "a refused resume starts no run");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_each_resume_refusal_maps_to_its_status_and_code() {
        use axum::http::StatusCode;
        use openobserve_core::alerts::rca_resume::ResumeError;

        let details = "reading the chat-events stream failed: search 10.0.0.7:5080 timed out";
        let reason = "Only a failed or cancelled analysis can be resumed";
        for (error, status, code) in [
            (ResumeError::NotFound, StatusCode::NOT_FOUND, None),
            (
                ResumeError::NotResumable(reason.to_string()),
                StatusCode::CONFLICT,
                Some("not_resumable"),
            ),
            (
                ResumeError::NothingToResume,
                StatusCode::CONFLICT,
                Some("nothing_to_resume"),
            ),
            (
                ResumeError::TranscriptExpired,
                StatusCode::GONE,
                Some("transcript_expired"),
            ),
            (
                ResumeError::Unavailable(details.to_string()),
                StatusCode::SERVICE_UNAVAILABLE,
                Some("history_unavailable"),
            ),
            (
                ResumeError::Internal(details.to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
                None,
            ),
        ] {
            let (got, body) = status_and_body(resume_error_response("run_1", &error)).await;
            assert_eq!(got, status, "{error:?}");
            assert_eq!(body["code"], status.as_u16(), "{error:?}");
            assert_eq!(
                body.get("error_code").and_then(|c| c.as_str()),
                code,
                "{error:?}: {body}"
            );
            let message = body["message"].as_str().unwrap();
            assert!(!message.is_empty(), "{error:?}");
            assert!(
                !message.contains("10.0.0.7") && !message.contains("search"),
                "{error:?}: {message}"
            );
            if matches!(error, ResumeError::NotResumable(_)) {
                assert_eq!(message, reason);
            }
        }
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    fn resume_seed(
        org_id: &str,
        source_run_id: &str,
    ) -> openobserve_core::alerts::rca_resume::ResumeSeed {
        use openobserve_core::alerts::rca_resume::{ResumeSeed, ResumeStep};

        ResumeSeed {
            source_run_id: sid(org_id, source_run_id),
            source_session: resume_session_row(
                org_id,
                "ses_src",
                infra::table::ai_chat_sessions::STATUS_ACTIVE,
                infra::table::ai_chat_sessions::NO_SEQ,
            ),
            prefix: Vec::new(),
            cut_seq: 17,
            reused_steps: 3,
            from_step: ResumeStep {
                index: 4,
                stage: "verify".to_string(),
                title: "Check the orders pool".to_string(),
            },
            mode: config::meta::alerts::rca_runs::RunMode::BuildOnPrevious,
            latest_run_id: sid(org_id, source_run_id),
        }
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_a_resume_starts_a_run_that_names_its_source() {
        use axum::http::StatusCode;
        use serde_json::json;

        let conn = steering_tables().await;
        let org = steering_org("resume202");
        steering_incident(conn, &org, "inc_1", Some("run_src")).await;
        resume_source(
            conn,
            &org,
            "run_src",
            "inc_1",
            "failed",
            Some("ses_src"),
            Some("timeout"),
        )
        .await;
        insert_session(
            conn,
            resume_session_row(
                &org,
                "ses_src",
                infra::table::ai_chat_sessions::STATUS_ACTIVE,
                infra::table::ai_chat_sessions::NO_SEQ,
            ),
        )
        .await;

        let (status, body) = status_and_body(
            start_resumed_run(
                org.clone(),
                sid(&org, "inc_1"),
                UserEmail {
                    user_id: STEER_ROOT.to_string(),
                },
                resume_seed(&org, "run_src"),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        let runs = settled_runs(conn, &org, "inc_1").await;
        assert_eq!(runs.len(), 2, "{runs:?}");
        let new_run = runs
            .iter()
            .find(|run| run.run_id != sid(&org, "run_src"))
            .unwrap();
        let mut keys: Vec<&str> = body
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "from_step",
                "message",
                "resumed_from",
                "reused_steps",
                "run_id"
            ]
        );
        assert!(!body["message"].as_str().unwrap().is_empty());
        assert_eq!(body["run_id"], new_run.run_id.as_str());
        assert_eq!(body["resumed_from"], sid(&org, "run_src"));
        assert_eq!(body["reused_steps"], 3);
        let from_step = json!({"index": 4, "stage": "verify", "title": "Check the orders pool"});
        assert_eq!(body["from_step"], from_step);

        assert_eq!(new_run.trigger, "resume");
        assert_eq!(new_run.mode, "build_on_previous");
        assert_eq!(new_run.started_by, STEER_ROOT);
        assert_eq!(new_run.guidance, None);
        assert_eq!(
            infra::table::rca_runs::decode::<serde_json::Value>(new_run.context_used.as_deref())
                .map(|used| used["resumed_from"].clone()),
            Some(json!({"run_id": sid(&org, "run_src"), "steps": 3, "from_step": from_step})),
            "{:?}",
            new_run.context_used
        );
        assert_eq!(new_run.state, "failed");
        assert_eq!(
            infra::table::rca_runs::error_of(new_run).map(|error| error.code),
            Some("resume_failed".to_string())
        );
        let source = runs
            .iter()
            .find(|run| run.run_id == sid(&org, "run_src"))
            .unwrap();
        assert_eq!(source.state, "failed", "the source is not touched");

        let (status, body) = resume_as(&org, "inc_1", "run_src").await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["error_code"], "nothing_to_resume", "{body}");
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_a_resume_while_a_run_is_live_is_409_and_starts_nothing() {
        use axum::http::StatusCode;
        use infra::table::entity::alert_incidents;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};

        let conn = steering_tables().await;
        let org = steering_org("resume_inflight");
        steering_incident(conn, &org, "inc_1", Some("run_live")).await;
        resume_source(
            conn,
            &org,
            "run_src",
            "inc_1",
            "failed",
            Some("ses_src"),
            Some("timeout"),
        )
        .await;
        resume_source(conn, &org, "run_live", "inc_1", "running", None, None).await;
        alert_incidents::Entity::update_many()
            .col_expr(alert_incidents::Column::RcaState, Expr::value("running"))
            .col_expr(
                alert_incidents::Column::RcaUpdatedAt,
                Expr::value(config::utils::time::now_micros()),
            )
            .filter(alert_incidents::Column::Id.eq(sid(&org, "inc_1")))
            .exec(conn)
            .await
            .unwrap();

        let (status, body) = status_and_body(
            start_resumed_run(
                org.clone(),
                sid(&org, "inc_1"),
                UserEmail {
                    user_id: STEER_ROOT.to_string(),
                },
                resume_seed(&org, "run_src"),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["code"], 409);
        assert_eq!(body["error_code"], "run_in_flight");
        assert_eq!(incident_runs(conn, &org, "inc_1").await.len(), 2);
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_a_resume_that_fails_at_launch_keeps_its_lineage_and_its_source() {
        use axum::http::StatusCode;
        use sea_orm::ConnectionTrait;
        use serde_json::json;

        let conn = steering_tables().await;
        let org = steering_org("resume_lineage");
        steering_incident(conn, &org, "inc_1", Some("run_src")).await;
        resume_source(
            conn,
            &org,
            "run_src",
            "inc_1",
            "failed",
            Some("ses_src"),
            Some("timeout"),
        )
        .await;
        insert_session(
            conn,
            resume_session_row(
                &org,
                "ses_src",
                infra::table::ai_chat_sessions::STATUS_ACTIVE,
                9,
            ),
        )
        .await;
        let trigger = format!("freeze_lineage_{org}");
        conn.execute_unprepared(&format!(
            "CREATE TRIGGER {trigger} BEFORE UPDATE ON rca_runs \
             WHEN NEW.org_id = '{org}' AND NEW.context_used IS NOT OLD.context_used \
             BEGIN SELECT RAISE(ABORT, 'lineage update refused by the test'); END"
        ))
        .await
        .unwrap();
        let response = start_resumed_run(
            org.clone(),
            sid(&org, "inc_1"),
            UserEmail {
                user_id: STEER_ROOT.to_string(),
            },
            resume_seed(&org, "run_src"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let runs = settled_runs(conn, &org, "inc_1").await;
        conn.execute_unprepared(&format!("DROP TRIGGER {trigger}"))
            .await
            .unwrap();
        assert_eq!(runs.len(), 2, "{runs:?}");
        let new_run = runs
            .iter()
            .find(|run| run.run_id != sid(&org, "run_src"))
            .unwrap();
        assert_eq!(new_run.trigger, "resume");
        assert_eq!(new_run.state, "failed");
        assert_eq!(
            infra::table::rca_runs::error_of(new_run).map(|error| error.code),
            Some("resume_failed".to_string())
        );
        assert!(new_run.session_id.is_none());
        assert_eq!(
            infra::table::rca_runs::decode::<serde_json::Value>(new_run.context_used.as_deref())
                .map(|used| used["resumed_from"].clone()),
            Some(json!({
                "run_id": sid(&org, "run_src"),
                "steps": 3,
                "from_step": {"index": 4, "stage": "verify", "title": "Check the orders pool"},
            })),
            "{:?}",
            new_run.context_used
        );

        let (status, body) = resume_as(&org, "inc_1", "run_src").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
        assert_eq!(body["error_code"], "history_unavailable", "{body}");
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[tokio::test]
    async fn test_only_a_failed_resume_of_the_source_leaves_it_resumable() {
        use axum::http::StatusCode;
        use infra::table::entity::rca_runs;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let conn = steering_tables().await;
        let org = steering_org("resume_child");
        for (incident, trigger, resumed_from, code) in [
            ("inc_own", "resume", "run_src", "nothing_to_resume"),
            ("inc_other", "resume", "run_elsewhere", "not_resumable"),
            ("inc_manual", "manual", "", "not_resumable"),
        ] {
            let source = format!("run_src_{incident}");
            let child = format!("run_child_{incident}");
            let session = format!("ses_{incident}");
            steering_incident(conn, &org, incident, Some(&child)).await;
            resume_source(
                conn,
                &org,
                &source,
                incident,
                "failed",
                Some(&session),
                Some("timeout"),
            )
            .await;
            insert_session(
                conn,
                resume_session_row(
                    &org,
                    &session,
                    infra::table::ai_chat_sessions::STATUS_ACTIVE,
                    infra::table::ai_chat_sessions::NO_SEQ,
                ),
            )
            .await;
            let mut run = thread_run(&org, &sid(&org, &child), &sid(&org, incident), None);
            run.trigger = trigger.to_string();
            run.state = "failed".to_string();
            run.report = None;
            run.error =
                Some(serde_json::json!({"code": "agent_unavailable", "reason": "r"}).to_string());
            if !resumed_from.is_empty() {
                let named = if resumed_from == "run_src" {
                    sid(&org, &source)
                } else {
                    sid(&org, resumed_from)
                };
                run.context_used = Some(serde_json::json!({
                    "resumed_from": {"run_id": named, "steps": 1, "from_step": {"index": 2, "stage": "", "title": "t"}},
                }).to_string());
            }
            rca_runs::Entity::insert(rca_runs::ActiveModel::from(run).reset_all())
                .exec(conn)
                .await
                .unwrap();

            let (status, body) = resume_as(&org, incident, &source).await;
            assert_eq!(status, StatusCode::CONFLICT, "{incident}: {body}");
            assert_eq!(body["error_code"], code, "{incident}: {body}");
        }
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_the_oss_resume_route_is_403() {
        let response = resume_incident_rca_run(
            Path((
                "default".to_string(),
                "inc_1".to_string(),
                "run_1".to_string(),
            )),
            Headers(UserEmail {
                user_id: "a.rao@acme.io".to_string(),
            }),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_the_oss_steering_routes_are_403() {
        let path = || {
            Path((
                "default".to_string(),
                "inc_1".to_string(),
                "run_1".to_string(),
            ))
        };
        let user = || {
            Headers(UserEmail {
                user_id: "a.rao@acme.io".to_string(),
            })
        };
        for response in [
            steer_incident_rca_run(path(), user()).await,
            get_incident_rca_steering(path(), user()).await,
        ] {
            assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                body["message"],
                "Steering an analysis is only available in enterprise"
            );
        }
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_the_oss_live_stream_is_403() {
        let response = get_incident_rca_live_stream(
            Path(("default".to_string(), "inc_1".to_string())),
            Query(RcaLiveStreamQuery { run_id: None }),
            Headers(UserEmail {
                user_id: "a.rao@acme.io".to_string(),
            }),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
    }
}
