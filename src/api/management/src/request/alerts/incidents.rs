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

/// Response for RCA analysis
#[derive(Debug, Serialize, ToSchema)]
pub struct RcaResponse {
    pub rca_content: String,
    /// The run that produced the report
    pub run_id: String,
}

/// Response for cancelling an in-flight RCA analysis
#[derive(Debug, Serialize, ToSchema)]
pub struct CancelRcaResponse {
    pub message: String,
    /// Whether an in-process task handle was found and aborted on this node. False when the
    /// analysis is running on another node — the run is still ended `cancelled`.
    pub aborted_local_task: bool,
    /// The cancelled run
    pub run_id: String,
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

/// Query parameters for RCA trigger
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TriggerRcaQuery {
    /// Use streaming response (default: false)
    #[serde(default)]
    pub stream: bool,
    /// Run the analysis in the background and answer 202 with the run id (default: false)
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
    description = "Triggers root cause analysis for an incident. Use stream=true query parameter for streaming response, otherwise returns complete result as JSON.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident ID"),
        TriggerRcaQuery,
    ),
    responses(
        (status = 200, description = "RCA analysis completed or SSE stream", content_type = "application/json", body = RcaResponse),
        (status = 202, description = "Analysis started in the background (reanalysis=true); body {message, run_id}", content_type = "application/json", body = Object),
        (status = 400, description = "RCA not enabled, or an analysis is already in progress", content_type = "application/json", body = ()),
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
    use config::meta::alerts::rca_runs::{RunMode, RunTrigger};
    use o2_enterprise::enterprise::{
        alerts::rca_service, common::config::get_config as get_o2_config,
    };
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
    // drops only this wait, and the task still ends the run (RR-13).
    let task = tokio::spawn(async move {
        // Every error below must end the run, so it never stays `running`; a run that
        // ended delivers no verdict, so it frees the page it held (RR-13).
        let fail = |code: &'static str, reason: &'static str, details: Option<String>| {
            let org_id = org_id.clone();
            let incident_id = incident_id.clone();
            let run_id = run_id.clone();
            async move {
                match rca_runs::fail_run(&org_id, &run_id, trigger, code, reason, details).await {
                    Ok(true) => {
                        rca_service::skip_analysis_for_incident(&org_id, &incident_id).await
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::error!("[INCIDENTS::RCA] Failed to end run {run_id} as failed: {e}")
                    }
                }
            }
        };

        // Each run is a fresh analysis unless the caller explicitly opts into continuity;
        // "Build on previous" reads the newest completed run's report (RR-27).
        let previous_analysis = if query.build_on_previous {
            rca_runs::newest_completed_report(&org_id, &incident_id)
                .await
                .ok()
                .flatten()
        } else {
            None
        };
        // The single builder both this endpoint and the autonomous path call, so the two can
        // no longer disagree about severity or past_causes (C1).
        let context =
            rca_service::build_incident_context(&org_id, &incident_id, previous_analysis).await;

        // Create RCA agent client with SA credentials
        let (email, token) =
            match openobserve_core::organization::get_sre_agent_credentials(&org_id).await {
                Ok(creds) => creds,
                Err(e) => {
                    fail(
                        rca_runs::ERROR_CREDENTIALS,
                        rca_runs::CREDENTIALS_REASON,
                        Some(format!("{e:#}")),
                    )
                    .await;
                    return MetaHttpResponse::internal_error(format!(
                        "Failed to get SRE agent credentials: {e}"
                    ));
                }
            };
        let auth_header = openobserve_core::auth::build_basic_auth_header(&email, &token);
        let client = match o2_enterprise::enterprise::ai::client::get_agent_client() {
            Some(c) => c,
            None => {
                fail(
                    rca_runs::ERROR_AGENT_NOT_CONFIGURED,
                    rca_runs::AGENT_NOT_CONFIGURED_REASON,
                    None,
                )
                .await;
                return MetaHttpResponse::internal_error("RCA agent client not initialized");
            }
        };

        // Check agent health
        if let Err(e) = client.health(&auth_header).await {
            fail(
                rca_runs::ERROR_AGENT_UNAVAILABLE,
                rca_runs::AGENT_UNAVAILABLE_REASON,
                Some(format!("{e:#}")),
            )
            .await;
            return axum::response::Response::builder()
                .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"error": format!("RCA agent not available: {e}")})
                        .to_string(),
                ))
                .unwrap();
        }

        // User-initiated reanalysis: fire-and-forget — spawn the agent in the background and
        // return 202 with the run id immediately.
        if query.reanalysis {
            let org_id_bg = org_id.clone();
            let incident_id_bg = incident_id.clone();
            let run_id_bg = run_id.clone();
            let user_email_bg = user_email.user_id.clone();
            let build_on_previous = query.build_on_previous;
            let handle = tokio::spawn(async move {
                if let Err(e) = openobserve_core::alerts::incidents::trigger_rca_for_incident(
                    org_id_bg.clone(),
                    incident_id_bg.clone(),
                    run_id_bg.clone(),
                    trigger,
                    user_email_bg,
                    build_on_previous,
                    // The spawned run meters its own usage right before it calls the agent.
                    None,
                )
                .await
                {
                    log::warn!(
                        "[INCIDENTS::RCA] Background reanalysis failed for {incident_id_bg}: {e}"
                    );
                    if let Err(fail_err) = rca_runs::fail_run(
                        &org_id_bg,
                        &run_id_bg,
                        trigger,
                        rca_runs::ERROR_SERVICE_CALL_FAILED,
                        rca_runs::SERVICE_CALL_FAILED_REASON,
                        Some(format!("{e:#}")),
                    )
                    .await
                    {
                        log::error!(
                            "[INCIDENTS::RCA] Failed to end run {run_id_bg} as failed: {fail_err}"
                        );
                    }
                }
                rca_runs::unregister_rca_task(&run_id_bg);
            });
            rca_runs::register_rca_task(&run_id, handle.abort_handle());

            return axum::response::Response::builder()
                .status(axum::http::StatusCode::ACCEPTED)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"message": "Analysis started", "run_id": run_id})
                        .to_string(),
                ))
                .unwrap();
        }

        // Meter usage only now, right before the agent is called: a run refused or failed
        // before this point never costs a credit.
        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
            &org_id,
            usage_feature,
            &usage_context,
        )
        .await
        {
            fail(
                rca_runs::ERROR_USAGE_DENIED,
                rca_runs::USAGE_DENIED_REASON,
                Some(error.to_string()),
            )
            .await;
            return crate::request::ai::chat::ai_authorization_error_response(error);
        }

        // Choose streaming or non-streaming based on query parameter
        if query.stream {
            // The run ends once the stream is fully drained (RR-46).
            let (org_id_end, incident_id_end, run_id_end) =
                (org_id.clone(), incident_id.clone(), run_id.clone());
            let stream = match rca_service::analyze_incident_stream(
                (*client).clone(),
                context,
                auth_header.clone(),
                move |end| {
                    rca_runs::finish_incident_stream(
                        org_id_end,
                        incident_id_end,
                        run_id_end,
                        trigger,
                        end,
                    )
                },
            )
            .await
            {
                Ok(s) => s,
                Err(e) => {
                    fail(
                        rca_runs::ERROR_STREAM_START_FAILED,
                        rca_runs::STREAM_START_FAILED_REASON,
                        Some(format!("{e:#}")),
                    )
                    .await;
                    return MetaHttpResponse::internal_error(format!(
                        "Failed to start RCA stream: {e}"
                    ));
                }
            };

            axum::response::Response::builder()
                .status(axum::http::StatusCode::OK)
                .header(axum::http::header::CONTENT_TYPE, "text/event-stream")
                .body(axum::body::Body::from_stream(stream))
                .unwrap()
        } else {
            // Perform RCA analysis (non-streaming)
            let rca_content =
                match rca_service::analyze_incident((*client).clone(), context, &auth_header).await
                {
                    Ok(content) => content,
                    Err(e) => {
                        fail(
                            rca_runs::ERROR_SERVICE_CALL_FAILED,
                            rca_runs::SERVICE_CALL_FAILED_REASON,
                            Some(format!("{e:#}")),
                        )
                        .await;
                        return MetaHttpResponse::internal_error(format!(
                            "Failed to perform RCA: {e}"
                        ));
                    }
                };

            // A result that could not be saved has already ended the run `save_failed` and
            // freed its page (RR-13); never answer 200 for it.
            if let Err(e) =
                rca_runs::complete_incident_run(&org_id, &incident_id, &run_id, &rca_content).await
            {
                return MetaHttpResponse::internal_error(format!(
                    "Failed to save the analysis result: {e}"
                ));
            }

            MetaHttpResponse::json(RcaResponse {
                rca_content,
                run_id,
            })
        }
    });
    match task.await {
        Ok(response) => response,
        Err(e) => MetaHttpResponse::internal_error(format!("The analysis task failed: {e}")),
    }
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
    // The live-run check lives inside cancel_rca_for_incident, in the same compare-and-set
    // that ends the run, so a run started meanwhile is never cancelled in its place (RR-19).
    match openobserve_core::alerts::incidents::cancel_rca_for_incident(
        &org_id,
        &incident_id,
        &user_email.user_id,
    )
    .await
    {
        // Nothing running — report it rather than writing a spurious terminal event.
        Ok(None) => MetaHttpResponse::bad_request("No analysis is currently in progress"),
        Ok(Some(outcome)) => MetaHttpResponse::json(CancelRcaResponse {
            message: "Analysis cancelled".to_string(),
            aborted_local_task: outcome.aborted_local_task,
            run_id: outcome.run_id,
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

    /// RR-31: the inline trigger answer names the run that produced the report.
    #[test]
    fn test_rca_response_carries_the_run_id() {
        let json = serde_json::to_value(RcaResponse {
            rca_content: "## Root cause".to_string(),
            run_id: "2abc".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"rca_content": "## Root cause", "run_id": "2abc"})
        );
    }

    /// RR-20, RR-31: the cancel answer names the run and says whether this node aborted it.
    #[test]
    fn test_cancel_rca_response_shape() {
        let json = serde_json::to_value(CancelRcaResponse {
            message: "Analysis cancelled".to_string(),
            aborted_local_task: false,
            run_id: "2abc".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "message": "Analysis cancelled",
                "aborted_local_task": false,
                "run_id": "2abc"
            })
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
}
