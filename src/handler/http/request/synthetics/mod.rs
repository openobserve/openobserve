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

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

// ── Results API ───────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/{id}/results",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsResults",
    summary = "List check results for a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("location" = Option<String>, Query, description = "Filter by location"),
        ("page" = Option<u64>, Query, description = "Page number"),
        ("page_size" = Option<u64>, Query, description = "Page size"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_results(
    Path((org_id, id)): Path<(String, String)>,
    Query(params): Query<config::meta::synthetics::ListResultsParams>,
) -> Response {
    match crate::service::synthetics::list_results(&org_id, &id, &params).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(e) => {
            tracing::error!("[synthetics] list_results: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/{id}/results/{job_id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsResult",
    summary = "Get a single check result",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("job_id" = i64, Path, description = "Job ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_result(Path((org_id, id, job_id)): Path<(String, String, String)>) -> Response {
    let job_id: i64 = match job_id.parse() {
        Ok(v) => v,
        Err(_) => return MetaHttpResponse::bad_request("invalid job_id"),
    };
    match crate::service::synthetics::get_result(&org_id, &id, job_id).await {
        Ok(Some(r)) => MetaHttpResponse::json(r),
        Ok(None) => MetaHttpResponse::not_found("result not found"),
        Err(e) => {
            tracing::error!("[synthetics] get_result: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/{id}/results/{job_id}/artifact",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsArtifactUrl",
    summary = "Get presigned URL for check artifact (screenshot/trace)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("job_id" = i64, Path, description = "Job ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 501, description = "Not implemented"),
    ),
)]
pub async fn get_artifact_url(
    Path((_org_id, _id, _job_id)): Path<(String, String, String)>,
) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({"message": "artifact storage not yet implemented"})),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/{id}/summary",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsSummary",
    summary = "Get uptime summary and status history for a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_summary(
    Path((org_id, id)): Path<(String, String)>,
    Query(params): Query<config::meta::synthetics::SummaryParams>,
) -> Response {
    match crate::service::synthetics::get_summary(&org_id, &id, params.start_time, params.end_time)
        .await
    {
        Ok(summary) => MetaHttpResponse::json(summary),
        Err(e) => {
            tracing::error!("[synthetics] get_summary: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

// ── Monitors ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsMonitors",
    summary = "List synthetic monitors",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_id" = Option<String>, Query, description = "Filter by folder ID (KSUID)"),
        ("type" = Option<String>, Query, description = "Filter by monitor type (http|browser|tcp|tls|ssh)"),
        ("enabled" = Option<bool>, Query, description = "Filter by enabled status"),
        ("location" = Option<String>, Query, description = "Filter by location"),
        ("tag" = Option<String>, Query, description = "Filter by tag"),
        ("page" = Option<u64>, Query, description = "Page number (0-indexed)"),
        ("page_size" = Option<u64>, Query, description = "Results per page"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::synthetics::MonitorListResponse),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_monitors(
    Path(org_id): Path<String>,
    Query(params): Query<config::meta::synthetics::ListMonitorsParams>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::list_monitors(&org_id, &params).await
        {
            Ok(mut resp) => {
                if !resp.monitors.is_empty() {
                    let ids: Vec<&str> = resp.monitors.iter().map(|m| m.id.as_str()).collect();
                    if let Ok(summaries) =
                        crate::service::synthetics::batch_monitor_summary(&org_id, &ids).await
                    {
                        for item in &mut resp.monitors {
                            if let Some(s) = summaries.get(&item.id) {
                                item.status = s.status.clone();
                                item.last_check_at = s.last_check_at;
                                item.last_response_ms = s.last_response_ms;
                            }
                        }
                    }
                }
                MetaHttpResponse::json(resp)
            }
            Err(e) => {
                tracing::error!("[synthetics] list_monitors: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, params);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/monitors",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsMonitor",
    summary = "Create a synthetic monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::synthetics::Monitor, description = "Monitor definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created", content_type = "application/json", body = config::meta::synthetics::Monitor),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn create_monitor(
    Path(org_id): Path<String>,
    Json(body): Json<config::meta::synthetics::Monitor>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::create_monitor(&org_id, body).await {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                tracing::error!("[synthetics] create_monitor: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsMonitor",
    summary = "Get a synthetic monitor by ID",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::synthetics::Monitor),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_monitor(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::get_monitor(&org_id, &id).await {
            Ok(Some(monitor)) => MetaHttpResponse::json(monitor),
            Ok(None) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] get_monitor: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/monitors/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSyntheticsMonitor",
    summary = "Update a synthetic monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    request_body(content = config::meta::synthetics::Monitor, description = "Updated monitor definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = config::meta::synthetics::Monitor),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",     content_type = "application/json", body = Object),
    ),
)]
pub async fn update_monitor(
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<config::meta::synthetics::Monitor>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::update_monitor(&org_id, &id, body)
            .await
        {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] update_monitor: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics/monitors/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSyntheticsMonitor",
    summary = "Delete a synthetic monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    responses(
        (status = 200, description = "Deleted"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_monitor(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::delete_monitor(&org_id, &id).await {
            Ok(true) => MetaHttpResponse::ok("monitor deleted"),
            Ok(false) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] delete_monitor: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/monitors/{id}/enable",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SetSyntheticsMonitorEnabled",
    summary = "Enable or pause a synthetic monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    request_body(content = Object, description = r#"{"enabled": true}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Missing enabled field"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn set_monitor_enabled(
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let enabled = match body.get("enabled").and_then(|v| v.as_bool()) {
            Some(v) => v,
            None => return MetaHttpResponse::bad_request("missing boolean field 'enabled'"),
        };
        match o2_enterprise::enterprise::synthetics::service::set_monitor_enabled(
            &org_id, &id, enabled,
        )
        .await
        {
            Ok(true) => MetaHttpResponse::ok(if enabled {
                "monitor enabled"
            } else {
                "monitor paused"
            }),
            Ok(false) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] set_monitor_enabled: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/monitors/{id}/run",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "RunSyntheticsMonitorNow",
    summary = "Trigger an immediate run of a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    responses(
        (status = 202, description = "Accepted — scheduler will fire within 5 seconds"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn run_monitor_now(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::run_monitor_now(&org_id, &id).await {
            Ok(()) => (StatusCode::ACCEPTED, "").into_response(),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] run_monitor_now: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Job API (probe-facing, bypass RBAC, authenticated via o2syn_ token) ──────

#[utoipa::path(
    post,
    path = "/synthetics/jobs/resolve",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobResolve",
    summary = "Resolve a job — probe fetches monitor config (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"job_id": 42}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn job_resolve(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::ResolveRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::resolve(req).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] job_resolve: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/jobs/lease",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobLease",
    summary = "Lease a batch of jobs for a probe pool (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"pool": "aws-browser-chromium", "limit": 10}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn job_lease(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::LeaseRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::lease(req).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                tracing::error!("[synthetics] job_lease: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/jobs/ack",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobAck",
    summary = "Acknowledge a completed check — probe submits result (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"job_id": 42, "status": "up", "response_time_ms": 1200, "error": null}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn job_ack(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::AckRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };

        let status = req.status.clone();
        let response_time_ms = req.response_time_ms;
        let error = req.error.clone();
        let checked_at = config::utils::time::now_micros();

        match o2_enterprise::enterprise::synthetics::job_api::ack(req).await {
            Ok(resp) => {
                // Emit trigger usage record for synthetics telemetry.
                crate::service::self_reporting::publish_triggers_usage(
                    config::meta::self_reporting::usage::TriggerData {
                        _timestamp: checked_at,
                        org: resp.org_id.clone(),
                        module: config::meta::self_reporting::usage::TriggerDataType::Synthetics,
                        key: resp.monitor_id.clone(),
                        start_time: checked_at,
                        end_time: checked_at,
                        ..Default::default()
                    },
                );

                // Ingest result into synthetics_results stream so list_results /
                // get_summary have data to query.
                {
                    use crate::common::meta::ingestion::{
                        IngestUser, IngestionRequest, IngestionValueType, SystemJobType,
                    };
                    let record = serde_json::json!({
                        "_timestamp": checked_at,
                        "job_id": resp.job_id,
                        "monitor_id": resp.monitor_id,
                        "location": resp.location,
                        "pool": resp.pool,
                        "status": status,
                        "response_time_ms": response_time_ms,
                        "error": error.as_deref().unwrap_or(""),
                        "browser_engine": resp.browser_engine.as_deref().unwrap_or(""),
                        "device": resp.device.as_deref().unwrap_or(""),
                        "trigger_type": resp.trigger_type,
                    });
                    let org_id_ingest = resp.org_id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = crate::service::logs::ingest::ingest(
                            0,
                            &org_id_ingest,
                            "synthetics_results",
                            IngestionRequest::JsonValues(IngestionValueType::Bulk, vec![record]),
                            IngestUser::SystemJob(SystemJobType::Synthetics),
                            None,
                            false,
                        )
                        .await
                        {
                            tracing::warn!("[synthetics] result ingest failed: {e}");
                        }
                    });
                }

                if !resp.destinations.is_empty() {
                    let org_id = resp.org_id.clone();
                    let monitor_name = resp.monitor_name.clone();
                    let monitor_id = resp.monitor_id.clone();
                    let monitor_type = resp.monitor_type.clone();
                    let target = resp.target.clone();
                    let destinations = resp.destinations.clone();
                    let location = resp.location.clone();
                    tokio::spawn(async move {
                        crate::service::synthetics::notify_check_result(
                            &org_id,
                            &monitor_name,
                            &monitor_id,
                            &monitor_type,
                            &target,
                            &destinations,
                            &location,
                            &status,
                            response_time_ms,
                            error.as_deref(),
                            checked_at,
                        )
                        .await;
                    });
                }
                MetaHttpResponse::json(resp)
            }
            Err(e) => {
                tracing::error!("[synthetics] job_ack: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Locations ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/monitors/locations",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsLocations",
    summary = "List available probe locations",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_locations(Path(_org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let locations = o2_enterprise::enterprise::synthetics::service::list_locations();
        MetaHttpResponse::json(locations)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}
