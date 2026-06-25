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

pub async fn get_artifact_url(
    Path((_org_id, _id, _job_id)): Path<(String, String, String)>,
) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({"message": "artifact storage not yet implemented"})),
    )
        .into_response()
}

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
                                item.uptime_7d_pct = s.uptime_7d_pct;
                                item.status_24h = s.status_24h.clone();
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
