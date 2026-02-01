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
use config::meta::search::Request;
#[cfg(feature = "enterprise")]
use {
    crate::handler::http::request::search::{
        query_manager::cancel_query_inner, utils::check_stream_permissions,
    },
    crate::service::search_jobs::{get_result, merge_response},
    crate::{
        common::{
            meta::http::HttpResponse as MetaHttpResponse,
            utils::http::{
                get_or_create_trace_id, get_search_event_context_from_request,
                get_stream_type_from_request, get_use_cache_from_request,
            },
        },
        service::db::search_job::{search_job_partitions::*, search_jobs::*},
    },
    axum::http::HeaderMap,
    config::{
        get_config,
        meta::{
            search::{Response as SearchResponse, SearchEventType},
            sql::resolve_stream_names,
            stream::StreamType,
        },
        utils::json,
    },
    hashbrown::HashMap,
    infra::table::entity::search_jobs::Model as JobModel,
    tracing::Span,
};

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::error_utils::map_error_to_http_response;
#[cfg(feature = "cloud")]
use crate::service::organization::is_org_in_free_trial_period;
use crate::{common::utils::auth::UserEmail, handler::http::extractors::Headers};

// 1. submit
/// SearchSQL

#[utoipa::path(
    post,
    path = "/{org_id}/search_jobs",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "SubmitSearchJob",
    summary = "Submit search job",
    description = "Submits a new asynchronous search job for execution. Search jobs are useful for long-running queries that \
                   might exceed normal timeout limits or for scheduling queries to run in the background. The job is \
                   queued for execution and returns a job ID that can be used to monitor progress and retrieve results later.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(config::meta::search::Request), description = "Search query", content_type = "application/json", example = json!({
        "query": {
            "sql": "select * from k8s ",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "limit": 100,
            "offset": 0,
        }
    })),
    responses(
        (status = 200, description = "Search Job submitted successfully", body = Object),
        (status = 400, description = "Bad Request", body = Object),
        (status = 500, description = "Internal Server Error", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Submit async search job", "category": "search"}))
    )
)]
pub async fn submit_job(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Query(query): Query<HashMap<String, String>>,
    Headers(_user_email): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] headers: HeaderMap,
    Json(req): Json<Request>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let cfg = get_config();

        let http_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
            tracing::info_span!("/api/{org_id}/_search", org_id = org_id.clone())
        } else {
            Span::none()
        };

        let trace_id = get_or_create_trace_id(&headers, &http_span);
        let user_id = _user_email.user_id;

        #[cfg(feature = "cloud")]
        {
            match is_org_in_free_trial_period(&org_id).await {
                Ok(false) => {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(MetaHttpResponse::error(
                            StatusCode::FORBIDDEN,
                            format!("org {org_id} has expired its trial period"),
                        )),
                    )
                        .into_response();
                }
                Err(e) => {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(MetaHttpResponse::error(
                            StatusCode::FORBIDDEN,
                            e.to_string(),
                        )),
                    )
                        .into_response();
                }
                _ => {}
            }
        }

        let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

        let mut req = req;
        if let Err(e) = req.decode() {
            return MetaHttpResponse::bad_request(e);
        }

        if let Ok(sql) =
            config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql)
        {
            req.query.sql = sql;
        };

        req.use_cache = get_use_cache_from_request(&query);

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
                return map_error_to_http_response(&e.into(), Some(trace_id));
            }
        };

        // Check permissions on stream
        for stream_name in stream_names.iter() {
            if let Some(res) =
                check_stream_permissions(stream_name, &org_id, &user_id, &stream_type).await
            {
                return res;
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
            Ok(job_id) => MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Search Job submitted successfully."
            )),
            Err(err) => {
                log::error!("[trace_id {trace_id}] sumbit query error: {err}");
                MetaHttpResponse::internal_error(err.to_string())
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(req);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 2. status_all
/// ListSearchJobs

#[utoipa::path(
    get,
    path = "/{org_id}/search_jobs",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "ListSearchJobs",
    summary = "List search jobs",
    description = "Retrieves a list of all search jobs for the organization, including their current status, execution details, \
                   and metadata. This includes both active and completed jobs, allowing you to monitor the progress of \
                   running searches and access historical job information for analysis and debugging purposes.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = 200, description = "List of search jobs", body = inline(Vec<Object>), example = json!([{
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
        (status = 400, description = "Bad Request", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all search jobs", "category": "search"}))
    )
)]
pub async fn list_status(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let res = list_status_by_org_id(&org_id).await;
        let res = match res {
            Ok(res) => res,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };

        Json(res).into_response()
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 3. status
/// GetSearchJobStatus

#[utoipa::path(
    get,
    path = "/{org_id}/search_jobs/{job_id}",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "GetSearchJobStatus",
    summary = "Get search job status",
    description = "Retrieves the current status and metadata for a specific search job. This includes execution state, timing information, error messages if any, and other job details. Use this to monitor job progress and determine when results are ready for retrieval or if the job encountered any issues during execution.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job status", body = Object, example = json!({
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
        (status = 400, description = "Bad Request", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get search job status", "category": "search"}))
    )
)]
pub async fn get_status(
    Path((org_id, job_id)): Path<(String, String)>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;
        let res = get(&job_id, &org_id).await;
        let model = match res {
            Ok(res) => res,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if model.status == 4 {
            return MetaHttpResponse::not_found(format!("[Job_Id: {job_id}] Search Job not found"));
        }

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return res;
        }
        Json(model).into_response()
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(job_id);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 4. cancel
/// CancelSearchJob

#[utoipa::path(
    post,
    path = "/{org_id}/search_jobs/{job_id}/cancel",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "CancelSearchJob",
    summary = "Cancel search job",
    description = "Cancels a running or pending search job, stopping its execution and freeing up resources. This is useful for stopping long-running queries that are no longer needed or consuming too many resources. Once cancelled, the job cannot be resumed and no results will be available.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job cancelled successfully", body = Object, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Running Search Job cancelled successfully."
        })),
        (status = 400, description = "Bad Request", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Cancel a running search job", "category": "search"}))
    )
)]
pub async fn cancel_job(
    Path(path): Path<(String, String)>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;
        let (org_id, job_id) = path;
        let res = cancel_job_inner(&org_id, &job_id, &user_id).await;
        if res.status() != StatusCode::OK {
            res
        } else {
            MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Running Search Job cancelled successfully."
            ))
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 5. get
/// GetSearchJobResult

#[utoipa::path(
    get,
    path = "/{org_id}/search_jobs/{job_id}/result",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "GetSearchJobResult",
    summary = "Get search job results",
    description = "Retrieves the results from a completed search job with optional pagination. The job must have finished \
                   successfully before results can be accessed. Results include the matching records, total count, execution \
                   timing, and metadata. Use pagination parameters to retrieve large result sets in manageable chunks.",
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
        (status = 200, description = "Search job results", body = Object, example = json!({
            "took": 155,
            "hits": [],
            "total": 27179431,
            "from": 0,
            "size": 100
        })),
        (status = 400, description = "Bad Request", body = Object),
        (status = 404, description = "Not Found", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get search job results", "category": "search"}))
    )
)]
pub async fn get_job_result(
    Path(path): Path<(String, String)>,
    Query(req): Query<config::meta::search::PaginationQuery>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;

        let from = req.from.unwrap_or(0);
        let size = req.size.unwrap_or(100);

        let org_id = path.0.clone();
        let job_id = path.1.clone();
        let res = get(&job_id, &org_id).await;
        let model = match res {
            Ok(res) => res,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return res;
        }

        if let Some(msg) = model.error_message {
            MetaHttpResponse::internal_error(format!("job_id: {job_id} error: {msg}",))
        } else if model.status == 1 && model.partition_num != Some(1) {
            get_partition_result(&model, from, size).await
        } else if model.result_path.is_none() || model.cluster.is_none() {
            MetaHttpResponse::not_found(format!(
                "[Job_Id: {job_id}] don't have result_path or cluster"
            ))
        } else {
            let path = model.result_path.unwrap();
            let cluster = model.cluster.unwrap();
            let response = get_result(&path, &cluster, from, size).await;
            if let Err(e) = response {
                return MetaHttpResponse::internal_error(e);
            }
            Json(response.unwrap()).into_response()
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        let _ = req;
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 6. delete
/// DeleteSearchJob

#[utoipa::path(
    delete,
    path = "/{org_id}/search_jobs/{job_id}",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "DeleteSearchJob",
    summary = "Delete search job",
    description = "Permanently deletes a search job and its associated results from the system. This action first cancels the job if it's still running, then removes all job data including metadata and stored results. Use this to clean up completed jobs and free up storage space. This operation cannot be undone.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job deleted successfully", body = Object, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Running Search Job deleted successfully."
        })),
        (status = 400, description = "Bad Request", body = Object),
        (status = 404, description = "Not Found", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a search job", "category": "search"}))
    )
)]
pub async fn delete_job(
    Path(path): Path<(String, String)>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;
        let (org_id, job_id) = path;

        // 1. cancel the query
        let res = cancel_job_inner(&org_id, &job_id, &user_id).await;
        if res.status() != StatusCode::OK && res.status() != StatusCode::BAD_REQUEST {
            return res;
        }

        // 2. make the job_id in search_job table delete
        match set_job_deleted(job_id.as_str()).await {
            Ok(true) => MetaHttpResponse::ok(format!(
                "[Job_Id: {job_id}] Running Search Job deleted successfully."
            )),
            Ok(false) => {
                MetaHttpResponse::not_found(format!("[Job_Id: {job_id}] Search Job not found"))
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

// 7. retry
/// RetrySearchJob

#[utoipa::path(
    post,
    path = "/{org_id}/search_jobs/{job_id}/retry",
    context_path = "/api",
    tag = "Search Jobs",
    operation_id = "RetrySearchJob",
    summary = "Retry search job",
    description = "Retries a previously failed or cancelled search job by resubmitting it for execution. This is useful for handling transient failures or resource constraints that may have caused the original job to fail. Only cancelled or finished (failed) jobs can be retried. The job will be re-queued with the same original parameters and query.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Search job ID")
    ),
    responses(
        (status = 200, description = "Search job retry initiated successfully", body = Object, example = json!({
            "code": 200,
            "message": "[Job_Id: abc123] Search Job retry successfully."
        })),
        (status = 400, description = "Bad Request", body = Object),
        (status = 403, description = "Forbidden - Job cannot be retried", body = Object)
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search Jobs", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Retry a failed search job", "category": "search"}))
    )
)]
pub async fn retry_job(
    Path(path): Path<(String, String)>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = _user_email.user_id;

        let (org_id, job_id) = path;

        // 1. check the status of the job, only cancel, finish can be retry
        let status = get(&job_id, &org_id).await;
        let model = match status {
            Ok(v) => v,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };

        // check permissions
        if let Some(res) = check_permissions(&model, &org_id, &user_id).await {
            return res;
        }

        if model.status != 2 && model.status != 3 {
            return MetaHttpResponse::forbidden(format!(
                "[Job_Id: {job_id}] Only canceled, finished search job can be retry"
            ));
        }

        // 2. make the job_id as pending in search_job table
        let res = retry_search_job(&job_id).await;
        match res {
            Ok(_) => {
                MetaHttpResponse::ok(format!("[Job_Id: {job_id}] Search Job retry successfully."))
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

#[cfg(feature = "enterprise")]
async fn cancel_job_inner(org_id: &str, job_id: &str, user_id: &str) -> Response {
    // 1. use job_id to query the trace_id
    let job = get(job_id, org_id).await;
    if job.is_err() {
        return MetaHttpResponse::not_found(format!("[Job_Id: {job_id}] Search Job not found"));
    }
    let job = job.unwrap();

    // check permissions
    if let Some(res) = check_permissions(&job, org_id, user_id).await {
        return res;
    }

    // 2. use job_id to make search_job cancel
    let status = cancel_job_by_job_id(job_id).await;
    if let Err(e) = status {
        return MetaHttpResponse::bad_request(e);
    }

    // 3. use job_id to make background_partition_job cancel
    let status = status.unwrap();
    if status == 1
        && let Err(e) = cancel_partition_job(job_id).await
    {
        return MetaHttpResponse::bad_request(e);
    }

    // 4. use cancel query function to cancel the query
    cancel_query_inner(org_id, &[&job.trace_id]).await
}

#[cfg(feature = "enterprise")]
async fn get_partition_result(job: &JobModel, from: i64, size: i64) -> Response {
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
fn apply_pagination(response: SearchResponse, from: i64, size: i64) -> Response {
    let mut res = response;
    res.pagination(from, size);
    Json(res).into_response()
}

// check permissions
#[cfg(feature = "enterprise")]
async fn check_permissions(job: &JobModel, org_id: &str, user_id: &str) -> Option<Response> {
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
