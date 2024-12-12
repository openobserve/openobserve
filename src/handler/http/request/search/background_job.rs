// Copyright 2024 OpenObserve Inc.
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

use actix_web::{delete, get, post, web, HttpRequest, HttpResponse};
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            meta::{self, http::HttpResponse as MetaHttpResponse},
            utils::http::{
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
            },
        },
        handler::http::request::search::{
            job::cancel_query_inner, utils::check_stream_premissions,
        },
        service::db::background_job::{
            cancel_job_by_job_id, cancel_partition_job, get_result_path, get_status_by_job_id,
            get_status_by_org_id, get_trace_id, set_job_deleted,
        },
    },
    actix_web::http::StatusCode,
    config::{
        get_config,
        meta::{search::SubmitQueryResponse, sql::resolve_stream_names, stream::StreamType},
        utils::json,
    },
    std::collections::HashMap,
    tracing::Span,
};

// 1. submit
#[cfg(feature = "enterprise")]
#[post("/{org_id}/search_job/submit")]
pub async fn submit_job(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let cfg = get_config();

    let org_id = org_id.into_inner();
    let mut range_error = String::new();
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

    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    // handle encoding for query and aggs
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };
    if let Err(e) = req.decode() {
        return Ok(MetaHttpResponse::bad_request(e));
    }

    // set search event type
    if req.search_type.is_none() {
        req.search_type = match get_search_type_from_request(&query) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };
    };
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
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            );
        }
    };

    // get stream settings
    for stream_name in stream_names {
        if let Some(settings) =
            infra::schema::get_settings(&org_id, &stream_name, stream_type).await
        {
            let max_query_range = settings.max_query_range;
            if max_query_range > 0
                && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
            {
                req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
                range_error = format!(
                    "Query duration is modified due to query range restriction of {} hours",
                    max_query_range
                );
            }
        }

        // Check permissions on stream
        if let Some(res) =
            check_stream_premissions(&stream_name, &org_id, &user_id, &stream_type).await
        {
            return Ok(res);
        }
    }

    // submit query to db
    let res = infra::table::background_jobs::submit(
        &trace_id,
        &org_id,
        &user_id,
        &stream_type.to_string(),
        &json::to_string(&req).unwrap(),
        req.query.start_time,
        req.query.end_time,
    )
    .await;

    match res {
        Ok(res) => {
            let ret = SubmitQueryResponse {
                job_id: res,
                range_error,
            };
            Ok(HttpResponse::Ok().json(ret))
        }
        Err(err) => {
            log::error!("[trace_id {trace_id}] sumbit query error: {}", err);
            Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    err.to_string(),
                )),
            )
        }
    }
}

// 2. status_all
#[cfg(feature = "enterprise")]
#[get("/{org_id}/search_job/status_all")]
pub async fn get_status_all(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let res = get_status_by_org_id(&org_id).await;
    match res {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// 3. status
#[cfg(feature = "enterprise")]
#[get("/{org_id}/search_job/status/{job_id}")]
pub async fn get_status(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let job_id = path.1.clone();
    let res = get_status_by_job_id(&job_id).await;
    match res {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// 4. cancel
#[cfg(feature = "enterprise")]
#[delete("/{org_id}/search_job/cancel/{job_id}")]
pub async fn cancel_job(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let org_id = path.0.clone();
    let job_id = path.1.clone();
    cancel_job_inner(&org_id, &job_id).await
}

// 5. get
#[cfg(feature = "enterprise")]
#[get("/{org_id}/search_job/result/{job_id}")]
pub async fn get_job_result(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let job_id = path.1.clone();
    // TODO: based on the path to get result
    let res = get_result_path(&job_id).await;
    match res {
        Ok(res) => Ok(HttpResponse::Ok().json(res.path)),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// 6. delete
#[cfg(feature = "enterprise")]
#[delete("/{org_id}/search_job/delete/{job_id}")]
pub async fn delete_job(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let org_id = path.0.clone();
    let job_id = path.1.clone();

    // 1. cancel the query
    match cancel_job_inner(&org_id, &job_id).await {
        Ok(res) if res.status() != StatusCode::OK => return Ok(res),
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        _ => {}
    };

    // 2. make the job_id in background_job table delete
    match set_job_deleted(job_id.as_str()).await {
        Ok(res) if res => Ok(HttpResponse::Ok().json(format!("job_id: {} delete success", job_id))),
        Ok(_) => Ok(HttpResponse::NotFound().json(format!("job_id: {} not found", job_id))),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

// 7. retry
#[cfg(feature = "enterprise")]
#[post("/{org_id}/search_job/retry/{job_id}")]
pub async fn retry_job(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    // 1. check the status of the job, only cancel, finish can be retry

    // 2. move the status from job table -> job result table

    // 3. generate the new trace_id

    // 4. make the job as running

    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
async fn cancel_job_inner(org_id: &str, job_id: &str) -> Result<HttpResponse, Error> {
    // 1. use job_id to query the trace_id
    let trace_id = get_trace_id(job_id).await;
    if trace_id.is_err() || trace_id.as_ref().unwrap().is_none() {
        return Ok(HttpResponse::NotFound().json(format!("job_id: {} not found", job_id)));
    }

    // 2. use job_id to make background_job cancel
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
    cancel_query_inner(org_id, &[&trace_id.unwrap().unwrap()]).await
}

#[cfg(not(feature = "enterprise"))]
#[post("/{org_id}/search_job/submit")]
pub async fn submit_job(
    _org_id: web::Path<String>,
    _in_req: HttpRequest,
    _body: web::Bytes,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/search_job/status_all")]
pub async fn get_status_all(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/search_job/status/{job_id}")]
pub async fn get_status(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[delete("/{org_id}/search_job/cancel/{job_id}")]
pub async fn cancel_job(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/search_job/result/{job_id}")]
pub async fn get_job_result(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[delete("/{org_id}/search_job/delete/{job_id}")]
pub async fn delete_job(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(not(feature = "enterprise"))]
#[post("/{org_id}/search_job/retry/{job_id}")]
pub async fn retry_job(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}
