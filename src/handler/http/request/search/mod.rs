use actix_web::http::{self, StatusCode};
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use ahash::AHashMap as HashMap;
use chrono::Duration;
use std::io::Error;
use std::sync::Mutex;

use crate::common::http::get_stream_type_from_request;
use crate::infra::config::{CONFIG, LOCKER};
use crate::meta;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::StreamType;
use crate::service::search as SearchService;

#[utoipa::path(
        context_path = "/api",
        responses(
            (status = 200, description = "search api", body = Response , example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]}))
        )
    )]
#[post("/{org_id}/_search")]
pub async fn search(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(e.to_string()),
            )))
        }
    };
    let req: meta::search::Request = serde_json::from_slice(&body)?;

    // get a local search queue lock
    let locker = LOCKER
        .entry("search/local_queue".to_string())
        .or_insert(Mutex::new(true));
    let _locker = locker.lock();

    // do search
    match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => {
            log::error!("search error: {:?}", err);
            Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            )
        }
    }
}

#[utoipa::path(
        context_path = "/api",
        responses(
            (status = 200, description = "search around api", body = Response , example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]}))
        )
    )]
#[get("/{org_id}/{stream_name}/_around")]
pub async fn around(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v.unwrap_or(StreamType::Logs),
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some(e.to_string()),
            )))
        }
    };

    let around_key = match query.get("key") {
        Some(v) => v.parse::<i64>().unwrap_or(0),
        None => 0,
    };
    let around_size = match query.get("size") {
        Some(v) => v.parse::<usize>().unwrap_or(0),
        None => 0,
    };

    // get a local search queue lock
    let locker = LOCKER
        .entry("search/local_queue".to_string())
        .or_insert(Mutex::new(true));
    let _locker = locker.lock();

    // search forward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: format!(
                "SELECT * FROM {} ORDER BY {} DESC",
                stream_name, CONFIG.common.time_stamp_col
            ),
            from: 0,
            size: around_size / 2,
            start_time: around_key - Duration::seconds(300).num_microseconds().unwrap(),
            end_time: around_key,
            sql_mode: "context".to_string(),
            track_total_hits: false,
        },
        aggs: ahash::AHashMap::new(),
    };
    let resp_forward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            log::error!("search error: {:?}", err);
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            );
        }
    };

    // search backward
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: format!(
                "SELECT * FROM {} ORDER BY {} ASC",
                stream_name, CONFIG.common.time_stamp_col
            ),
            from: 0,
            size: around_size / 2,
            start_time: around_key,
            end_time: around_key + Duration::seconds(300).num_microseconds().unwrap(),
            sql_mode: "context".to_string(),
            track_total_hits: false,
        },
        aggs: ahash::AHashMap::new(),
    };
    let resp_backward = match SearchService::search(&org_id, stream_type, &req).await {
        Ok(res) => res,
        Err(err) => {
            log::error!("search error: {:?}", err);
            return Ok(
                HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR.into(),
                    Some(err.to_string()),
                )),
            );
        }
    };

    // merge
    let mut resp = meta::search::Response::default();
    let hits_num = resp_backward.hits.len();
    for i in 0..hits_num {
        resp.hits
            .push(resp_backward.hits[hits_num - 1 - i].to_owned());
    }
    let hits_num = resp_forward.hits.len();
    for i in 0..hits_num {
        resp.hits.push(resp_forward.hits[i].to_owned());
    }
    resp.total = resp.hits.len();
    resp.took = resp_forward.took + resp_backward.took;
    resp.scan_size = resp_forward.scan_size + resp_backward.scan_size;

    Ok(HttpResponse::Ok().json(resp))
}
