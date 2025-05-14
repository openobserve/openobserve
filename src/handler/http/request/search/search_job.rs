// Copyright 2025 OpenObserve Inc.
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

use std::io::Error;

use actix_web::{HttpRequest, HttpResponse, delete, get, post, web};
#[cfg(feature = "enterprise")]
use {
    crate::handler::http::request::search::{
        query_manager::cancel_query_inner, utils::check_stream_permissions,
    },
    crate::service::search_jobs::{get_result, merge_response},
    crate::{
        common::{
            meta::{self, http::HttpResponse as MetaHttpResponse},
            utils::http::{
                get_or_create_trace_id, get_search_event_context_from_request,
                get_stream_type_from_request, get_use_cache_from_request,
            },
        },
        service::db::search_job::{search_job_partitions::*, search_jobs::*},
    },
    actix_web::http::StatusCode,
    config::{
        get_config,
        meta::{
            search::{Request, Response, SearchEventType},
            sql::resolve_stream_names,
            stream::StreamType,
        },
        utils::json,
    },
    hashbrown::HashMap,
    infra::table::entity::search_jobs::Model as JobModel,
    tracing::Span,
};

use crate::service::organization::is_org_in_free_trial_period;

// 1. submit
/// SearchSQL
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "SearchSQL",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = SearchRequest, description = "Search query", content_type = "application/json", example = json!({
        "query": {
            "sql": "select * from k8s ",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "limit": 100,
            "offset": 0,
        }
    })),
    responses(
        (status = 200, description = "Search Job submitted successfully", body = MetaHttpResponse),
        (status = 400, description = "Bad Request", body = MetaHttpResponse),
        (status = 500, description = "Internal Server Error", body = MetaHttpResponse),
    )
)]
#[post("/{org_id}/search_jobs")]
pub async fn submit_job(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let cfg = get_config();

        let org_id = org_id.into_inner();
        let http_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
            tracing::info_span!("/api/{org_id}/_search", org_id = org_id.clone())
        } else {
            Span::none()
        };

        let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        #[cfg(feature = "cloud")]
        {
            match is_org_in_free_trial_period(&org_id).await {
                Ok(false) => {
                    return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                        StatusCode::FORBIDDEN.into(),
                        format!("org {org_id} has expired its trial period"),
                    )));
                }
                Err(e) => {
                    return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                        StatusCode::FORBIDDEN.into(),
                        e.to_string(),
                    )));
                }
                _ => {}
            }
        }

        let query = match web::Query::<HashMap<String, String>>::from_query(in_req.query_string()) {
            Ok(q) => q,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };
        let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

        let use_cache = cfg.common.result_cache_enabled && get_use_cache_from_request(&query);
        // handle encoding for query and aggs
        let mut req: config::meta::search::Request = match json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };
        if let Err(e) = req.decode() {
            return Ok(MetaHttpResponse::bad_request(e));
        }
        req.use_cache = Some(use_cache);

        // update timeout
        if req.timeout == 0 {
            req.timeout = cfg.limit.search_job_timeout;
        }

        // set search event type
        req.search_type = Some(SearchEventType::SearchJob);
        if req.search_event_context.is_none() {
            req.search_event_context = req
                .search_type
                .as_ref()
                .and_then(|event_type| get_search_event_context_from_request(event_type, &query));
        }

        // get stream name
        let stream_names = match resolve_stream_names(&req.query.sql) {
            Ok(v) => v.clone(),
            Err(e) => {
                return Ok(HttpResponse::InternalServerError().json(
                    meta::http::HttpResponse::error(
                        StatusCode::INTERNAL_SERVER_ERROR.into(),
                        e.to_string(),
                    ),
                ));
            }
        };

        // Check permissions on stream
        for stream_name in stream_names.iter() {
            if let Some(res) =
                check_stream_permissions(stream_name, &org_id, &user_id, &stream_type).await
            {
                return Ok(res);
            }
        }

        // add stream_names for rbac
        let stream_names = json::to_string(&stream_names).unwrap();

        // submit query to db
        let res = submit(
            &trace_id,
            &org_id,
            &user_id,
            stream_type.as_str(),
            &stream_names,
            &json::to_string(&req).unwrap(),
            req.query.start_time,
            req.query.end_time,
        )
        .await;

        match res {
            Ok(job_id) => Ok(MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Search Job submitted successfully."
            ))),
            Err(err) => {
                log::error!("[trace_id {trace_id}] sumbit query error: {}", err);
                Ok(MetaHttpResponse::internal_error(err.to_string()))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(in_req);
        drop(body);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 2. status_all
/// ListSearchJobs
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "ListSearchJobs",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = 200, description = "List of search jobs", body = Vec<JobModel>, example = json!([{
            "id": "abc123",
            "trace_id": "xyz789",
            "org_id": "default",
            "user_id": "user1",
            "stream_type": "logs",
            "stream_names": "[\"stream1\"]",
            "payload": "...",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "created_at": 1675182660872049i64,
            "updated_at": 1675182660872049i64,
            "status": 1,
            "cluster": "cluster1",
            "result_path": "/path/to/result"
        }])),
        (status = 400, description = "Bad Request", body = MetaHttpResponse)
    )
)]
#[get("/{org_id}/search_jobs")]
pub async fn list_status(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let res = list_status_by_org_id(&org_id).await;
        let res = match res {
            Ok(res) => res,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        Ok(HttpResponse::Ok().json(res))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 3. status
/// GetSearchJobStatus
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "GetSearchJobStatus",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job status", body = JobModel, example = json!({
            "id": "abc123",
            "trace_id": "xyz789",
            "org_id": "default",
            "user_id": "user1",
            "stream_type": "logs",
            "stream_names": "[\"stream1\"]",
            "payload": "...",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "created_at": 1675182660872049i64,
            "updated_at": 1675182660872049i64,
            "status": 1,
            "cluster": "cluster1",
            "result_path": "/path/to/result"
        })),
        (status = 400, description = "Bad Request", body = MetaHttpResponse)
    )
)]
#[get("/{org_id}/search_jobs/{job_id}/status")]
pub async fn get_status(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let org_id = path.0.clone();
        let job_id = path.1.clone();
        let res = get(&job_id, &org_id).await;
        let model = match res {
            Ok(res) => res,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return Ok(res);
        }
        Ok(HttpResponse::Ok().json(model))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        drop(in_req);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 4. cancel
/// CancelSearchJob
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "CancelSearchJob",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job cancelled successfully", body = MetaHttpResponse, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Running Search Job cancelled successfully."
        })),
        (status = 400, description = "Bad Request", body = MetaHttpResponse)
    )
)]
#[post("/{org_id}/search_jobs/{job_id}/cancel")]
pub async fn cancel_job(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let org_id = path.0.clone();
        let job_id = path.1.clone();
        match cancel_job_inner(&org_id, &job_id, &user_id).await {
            Ok(res) if res.status() != StatusCode::OK => Ok(res),
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
            Ok(_) => Ok(MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Running Search Job cancelled successfully."
            ))),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        drop(in_req);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 5. get
/// GetSearchJobResult
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "GetSearchJobResult",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID"),
        ("from" = Option<i64>, Query, description = "Pagination start offset"),
        ("size" = Option<i64>, Query, description = "Number of results to return")
    ),
    responses(
        (status = 200, description = "Search job results", body = Response, example = json!({
            "took": 155,
            "hits": [],
            "total": 27179431,
            "from": 0,
            "size": 100
        })),
        (status = 400, description = "Bad Request", body = MetaHttpResponse),
        (status = 404, description = "Not Found", body = MetaHttpResponse)
    )
)]
#[get("/{org_id}/search_jobs/{job_id}/result")]
pub async fn get_job_result(
    path: web::Path<(String, String)>,
    req: web::Query<config::meta::search::PaginationQuery>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let from = req.from.unwrap_or(0);
        let size = req.size.unwrap_or(100);

        let org_id = path.0.clone();
        let job_id = path.1.clone();
        let res = get(&job_id, &org_id).await;
        let model = match res {
            Ok(res) => res,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return Ok(res);
        }

        if model.error_message.is_some() {
            Ok(MetaHttpResponse::ok(format!(
                "job_id: {job_id} error: {}",
                model.error_message.unwrap()
            )))
        } else if model.status == 1 && model.partition_num != Some(1) {
            let response = get_partition_result(&model, from, size).await;
            Ok(response)
        } else if model.result_path.is_none() || model.cluster.is_none() {
            Ok(MetaHttpResponse::not_found(format!(
                "[Job_Id: {job_id}] don't have result_path or cluster"
            )))
        } else {
            let path = model.result_path.clone().unwrap();
            let cluster = model.cluster.clone().unwrap();
            let response = get_result(&path, &cluster, from, size).await;
            if let Err(e) = response {
                return Ok(MetaHttpResponse::internal_error(e));
            }
            Ok(HttpResponse::Ok().json(response.unwrap()))
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        let _ = req;
        drop(in_req);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 6. delete
/// DeleteSearchJob
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "DeleteSearchJob",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job deleted successfully", body = MetaHttpResponse, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Running Search Job deleted successfully."
        })),
        (status = 400, description = "Bad Request", body = MetaHttpResponse),
        (status = 404, description = "Not Found", body = MetaHttpResponse)
    )
)]
#[delete("/{org_id}/search_jobs/{job_id}")]
pub async fn delete_job(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let org_id = path.0.clone();
        let job_id = path.1.clone();

        // 1. cancel the query
        match cancel_job_inner(&org_id, &job_id, &user_id).await {
            Ok(res)
                if res.status() != StatusCode::OK && res.status() != StatusCode::BAD_REQUEST =>
            {
                return Ok(res);
            }
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
            _ => {}
        };

        // 2. make the job_id in search_job table delete
        match set_job_deleted(job_id.as_str()).await {
            Ok(true) => Ok(MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Running Search Job deleted successfully."
            ))),
            Ok(false) => Ok(MetaHttpResponse::not_found(format!(
                "[Job_Id: {job_id}] Search Job not found"
            ))),
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        drop(in_req);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

// 7. retry
/// RetrySearchJob
///
/// #{"ratelimit_module":"Search Jobs", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "RetrySearchJob",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job retry initiated successfully", body = MetaHttpResponse, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Search Job retry successfully."
        })),
        (status = 400, description = "Bad Request", body = MetaHttpResponse),
        (status = 403, description = "Forbidden - Job cannot be retried", body = MetaHttpResponse)
    )
)]
#[post("/{org_id}/search_jobs/{job_id}/retry")]
pub async fn retry_job(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let user_id = in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let org_id = path.0.clone();
        let job_id = path.1.clone();

        // 1. check the status of the job, only cancel, finish can be retry
        let status = get(&job_id, &org_id).await;
        let model = match status {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return Ok(res);
        }

        if model.status != 2 && model.status != 3 {
            return Ok(MetaHttpResponse::forbidden(format!(
                "[Job_Id: {job_id}] Only canceled, finished search job can be retry"
            )));
        }

        // 2. make the job_id as pending in search_job table
        let res = retry_search_job(&job_id).await;
        match res {
            Ok(_) => Ok(MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Search Job retry successfully."
            ))),
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(in_req);
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}
#[cfg(feature = "enterprise")]
async fn cancel_job_inner(
    org_id: &str,
    job_id: &str,
    user_id: &str,
) -> Result<HttpResponse, Error> {
    // 1. use job_id to query the trace_id
    let job = get(job_id, org_id).await;
    if job.is_err() {
        return Ok(MetaHttpResponse::not_found(format!(
            "[Job_Id: {job_id}] Search Job not found"
        )));
    }
    let job = job.unwrap();

    // check permissions
    if let Some(res) = check_permissions(&job, org_id, user_id).await {
        return Ok(res);
    }

    // 2. use job_id to make search_job cancel
    let status = cancel_job_by_job_id(job_id).await;
    if let Err(e) = status {
        return Ok(MetaHttpResponse::bad_request(e));
    }

    // 3. use job_id to make background_partition_job cancel
    let status = status.unwrap();
    if status == 1 {
        if let Err(e) = cancel_partition_job(job_id).await {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    }

    // 4. use cancel query function to cancel the query
    cancel_query_inner(org_id, &[&job.trace_id]).await
}

#[cfg(feature = "enterprise")]
async fn get_partition_result(job: &JobModel, from: i64, size: i64) -> HttpResponse {
    let req: Result<Request, serde_json::Error> = json::from_str(&job.payload);
    if let Err(e) = req {
        return MetaHttpResponse::internal_error(e);
    }
    let req = req.unwrap();
    let limit = if req.query.size > 0 {
        req.query.size
    } else {
        config::get_config().limit.query_default_limit
    };
    let offset = req.query.from;
    let partition_jobs = get_partition_jobs(&job.id).await;
    if let Err(e) = partition_jobs {
        return MetaHttpResponse::internal_error(e);
    }
    let partition_jobs = partition_jobs.unwrap();
    let response = merge_response(partition_jobs, limit, offset).await;
    if let Err(e) = response {
        return MetaHttpResponse::internal_error(e);
    }
    let response = response.unwrap();
    apply_pagination(response, from, size)
}
#[cfg(feature = "enterprise")]
fn apply_pagination(response: Response, from: i64, size: i64) -> HttpResponse {
    let mut res = response;
    res.pagination(from, size);
    HttpResponse::Ok().json(res)
}

// check permissions
#[cfg(feature = "enterprise")]
async fn check_permissions(job: &JobModel, org_id: &str, user_id: &str) -> Option<HttpResponse> {
    let stream_type = StreamType::from(job.stream_type.as_str());
    let stream_names: Vec<String> = json::from_str(&job.stream_names).unwrap();
    for stream_name in stream_names.iter() {
        if let Some(res) =
            check_stream_permissions(stream_name, org_id, user_id, &stream_type).await
        {
            return Some(res);
        }
    }
    None
}
