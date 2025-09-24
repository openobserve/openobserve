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

use actix_web::{HttpRequest, HttpResponse, get, post, web};
use arrow_schema::Schema;
use chrono::Utc;
use config::{
    DISTINCT_FIELDS, META_ORG_ID, TIMESTAMP_COL_NAME, get_config,
    meta::{
        search::{
            ResultSchemaResponse, SearchEventType, SearchHistoryHitResponse, default_use_cache,
        },
        self_reporting::usage::{RequestStats, USAGE_STREAM, UsageType},
        sql::resolve_stream_names,
        stream::StreamType,
    },
    utils::{base64, json, time::now_micros},
};
use error_utils::map_error_to_http_response;
use hashbrown::HashMap;
use tracing::{Instrument, Span};
#[cfg(feature = "enterprise")]
use utils::check_stream_permissions;
#[cfg(feature = "cloud")]
use {crate::service::organization::is_org_in_free_trial_period, actix_web::http::StatusCode};

#[cfg(feature = "enterprise")]
use crate::service::search::sql::visitor::cipher_key::get_cipher_key_names;
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{
            functions,
            http::{
                get_dashboard_info_from_request, get_enable_align_histogram_from_request,
                get_is_multi_stream_search_from_request, get_is_ui_histogram_from_request,
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
                get_use_cache_from_request, get_work_group,
            },
            stream::get_settings_max_query_range,
        },
    },
    service::{
        db::enrichment_table,
        metadata::distinct_values::DISTINCT_STREAM_PREFIX,
        search::{
            self as SearchService, datafusion::plan::projections::get_result_schema,
            sql::visitor::pickup_where::pickup_where,
        },
        self_reporting::{http_report_metrics, report_request_usage_stats},
    },
};

pub(crate) mod around;
pub(crate) mod error_utils;
pub mod multi_streams;
pub mod query_manager;
pub mod saved_view;
pub mod search_inspector;
pub mod search_job;
pub mod search_stream;
pub(crate) mod utils;

async fn can_use_distinct_stream(
    org: &str,
    stream_name: &str,
    stream_type: StreamType,
    fields: &[String],
    query: &config::meta::search::Query,
    start_time: i64,
) -> bool {
    if !matches!(stream_type, StreamType::Logs | StreamType::Traces) {
        return false;
    }

    let stream_settings = infra::schema::get_settings(org, stream_name, stream_type)
        .await
        .unwrap_or_default();

    if !stream_settings.enable_distinct_fields {
        return false;
    }

    // all fields which are requested must be in the distinct stream
    let all_fields_distinct = fields.iter().all(|f| {
        if DISTINCT_FIELDS.contains(f) {
            return true;
        }
        if f == "count" {
            // count is reserved field from oo side, so if user has count field
            // in original stream, it won't actually be in the distinct stream, so
            // we need to fallback to normal search
            return false;
        }
        stream_settings
            .distinct_value_fields
            .iter()
            .any(|entry| entry.name == *f && entry.added_ts <= start_time)
    });

    // all the fields used in the query sent must be in the distinct stream
    #[allow(deprecated)]
    let query_fields: Vec<String> = match crate::service::search::sql::Sql::new(
        &(query.clone().into()),
        org,
        stream_type,
        None,
    )
    .await
    {
        // if sql is invalid, we let it follow the original search and fail
        Err(_) => return false,
        Ok(sql) => {
            // check if sql contains any filters from which field cannot be inferred.
            // where clause can contain match_all and a valid field which is in distinct stream
            // but since there is match_all, we cannot infer the field from the where clause
            // so we need to return false
            if sql.has_match_all {
                return false;
            }
            sql.columns.values().flatten().cloned().collect()
        }
    };

    let all_query_fields_distinct = query_fields.iter().all(|f| {
        if DISTINCT_FIELDS.contains(f) {
            return true;
        }
        if f == "count" {
            // count is reserved field from oo side, so if user has count field
            // in original stream, it won't actually be in the distinct stream, so
            // we need to fallback to normal search
            return false;
        }
        stream_settings
            .distinct_value_fields
            .iter()
            .any(|entry| entry.name == *f && entry.added_ts <= start_time)
    });

    all_fields_distinct && all_query_fields_distinct
}

/// SearchStreamData

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchSQL",
    summary = "Search data with SQL",
    description = "Executes SQL queries against log streams with support for complex search patterns, time range filtering, aggregations, and histogram generation. Supports advanced features like multi-stream searches, caching, and UI optimizations for dashboard visualizations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("is_ui_histogram" = bool, Query, description = "Whether to return histogram data for UI"),
        ("is_multi_stream_search" = bool, Query, description = "Indicate is search is for multi stream"),
    ),
    request_body(content = Object, description = "Search query", content_type = "application/json", example = json!({
        "query": {
            "sql": "select * from k8s ",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "from": 0,
            "size": 10
        }
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "hits": [
                {
                    "_p": "F",
                    "_timestamp": 1674213225158000i64,
                    "kubernetes": {
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/openobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
                        "container_name": "openobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "openobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "openobserve-ingester-0"
                    },
                    "log": "[2023-01-20T11:13:45Z INFO  actix_web::middleware::logger] 10.2.80.192 \"POST /api/demo/_bulk HTTP/1.1\" 200 68",
                    "stream": "stderr"
                }
            ],
            "total": 27179431,
            "from": 0,
            "size": 1,
            "scan_size": 28943
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[post("/{org_id}/_search")]
pub async fn search(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let org_id = org_id.into_inner();
    let mut range_error = String::new();

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    format!("org {org_id} has expired its trial period"),
                )));
            }
            Err(e) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    e.to_string(),
                )));
            }
            _ => {}
        }
    }

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
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let is_ui_histogram = get_is_ui_histogram_from_request(&query);
    let is_multi_stream_search = get_is_multi_stream_search_from_request(&query);

    let dashboard_info = get_dashboard_info_from_request(&query);

    // handle encoding for query and aggs
    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };
    if let Err(e) = req.decode() {
        return Ok(MetaHttpResponse::bad_request(e));
    }
    if let Ok(sql) = config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql) {
        req.query.sql = sql;
    };
    req.use_cache = get_use_cache_from_request(&query);

    // get stream name
    let stream_names = match resolve_stream_names(&req.query.sql) {
        Ok(v) => v.clone(),
        Err(e) => {
            return Ok(map_error_to_http_response(&(e.into()), Some(trace_id)));
        }
    };

    // Handle histogram data for UI
    let mut converted_histogram_query: Option<String> = None;
    if is_ui_histogram {
        // Convert the original query to a histogram query
        match crate::service::search::sql::histogram::convert_to_histogram_query(
            &req.query.sql,
            &stream_names,
            is_multi_stream_search,
        ) {
            Ok(histogram_query) => {
                req.query.sql = histogram_query;
                converted_histogram_query = Some(req.query.sql.clone());
            }
            Err(e) => {
                return Ok(map_error_to_http_response(&(e), Some(trace_id)));
            }
        }
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

    // get stream settings
    for stream_name in stream_names {
        if let Some(settings) =
            infra::schema::get_settings(&org_id, &stream_name, stream_type).await
        {
            let max_query_range =
                get_settings_max_query_range(settings.max_query_range, &org_id, Some(&user_id))
                    .await;
            if max_query_range > 0
                && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
            {
                req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
                range_error = format!(
                    "Query duration is modified due to query range restriction of {max_query_range} hours"
                );
            }
        }

        // Check permissions on stream
        #[cfg(feature = "enterprise")]
        if let Some(res) =
            check_stream_permissions(&stream_name, &org_id, &user_id, &stream_type).await
        {
            return Ok(res);
        }
    }

    #[cfg(feature = "enterprise")]
    {
        use actix_http::StatusCode;

        use crate::common::meta;
        let keys_used = match get_cipher_key_names(&req.query.sql) {
            Ok(v) => v,
            Err(e) => {
                return Ok(HttpResponse::BadRequest()
                    .json(meta::http::HttpResponse::error(StatusCode::BAD_REQUEST, e)));
            }
        };
        if !keys_used.is_empty() {
            log::info!("keys used : {keys_used:?}");
        }
        for key in keys_used {
            // Check permissions on keys
            {
                use o2_openfga::meta::mapping::OFGA_MODELS;

                use crate::{
                    common::utils::auth::{AuthExtractor, is_root_user},
                    service::users::get_user,
                };

                if !is_root_user(&user_id) {
                    let user: config::meta::user::User =
                        get_user(Some(&org_id), &user_id).await.unwrap();

                    if !crate::handler::http::auth::validator::check_permissions(
                        &user_id,
                        AuthExtractor {
                            auth: "".to_string(),
                            method: "GET".to_string(),
                            o2_type: format!(
                                "{}:{}",
                                OFGA_MODELS
                                    .get("cipher_keys")
                                    .map_or("cipher_keys", |model| model.key),
                                key
                            ),
                            org_id: org_id.clone(),
                            bypass_check: false,
                            parent_id: "".to_string(),
                        },
                        user.role,
                        user.is_external,
                    )
                    .await
                    {
                        return Ok(MetaHttpResponse::forbidden("Unauthorized Access to key"));
                    }
                    // Check permissions on key ends
                }
            }
        }
    }

    // run search with cache
    let res = SearchService::cache::search(
        &trace_id,
        &org_id,
        stream_type,
        Some(user_id),
        &req,
        range_error,
        false,
        dashboard_info,
        is_multi_stream_search,
    )
    .instrument(http_span)
    .await;
    match res {
        Ok(mut res) => {
            res.set_took(start.elapsed().as_millis() as usize);
            res.converted_histogram_query = converted_histogram_query;
            Ok(HttpResponse::Ok().json(res))
        }
        Err(err) => {
            let search_type = req
                .search_type
                .map(|t| t.to_string())
                .unwrap_or("".to_string());
            http_report_metrics(
                start,
                &org_id,
                stream_type,
                "500",
                "_search",
                &search_type,
                "",
            );
            log::error!("[trace_id {trace_id}] search error: {err}");
            Ok(error_utils::map_error_to_http_response(
                &err,
                Some(trace_id),
            ))
        }
    }
}

/// SearchAround

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchAround",
    summary = "Search around specific log entry",
    description = "Searches for log entries around a specific key (timestamp or record identifier) within a stream. Returns logs before and after the specified key, useful for investigating context around specific events or errors.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "stream_name name"),
        ("key" = i64, Query, description = "around key"),
        ("size" = i64, Query, description = "around size"),
        ("regions" = Option<String>, Query, description = "regions, split by comma"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "hits": [
                {
                    "_p": "F",
                    "_timestamp": 1674213225158000i64,
                    "kubernetes": {
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/openobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
                        "container_name": "openobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "openobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "openobserve-ingester-0"
                    },
                    "log": "[2023-01-20T11:13:45Z INFO  actix_web::middleware::logger] 10.2.80.192 \"POST /api/demo/_bulk HTTP/1.1\" 200 68",
                    "stream": "stderr"
                }
            ],
            "total": 10,
            "from": 0,
            "size": 10,
            "scan_size": 28943
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[get("/{org_id}/{stream_name}/_around")]
pub async fn around_v1(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    let (org_id, stream_name) = path.into_inner();
    let http_span = if get_config().common.tracing_search_enabled {
        tracing::info_span!(
            "/api/{org_id}/{stream_name}/_around",
            org_id = org_id.clone(),
            stream_name = stream_name.clone()
        )
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    let user_id = in_req
        .headers()
        .get("user_id")
        .map(|v| v.to_str().unwrap_or("").to_string());

    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let ret = around::around(
        &trace_id,
        http_span,
        &org_id,
        &stream_name,
        stream_type,
        query,
        None,
        None,
        user_id,
    )
    .await;
    match ret {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => {
            http_report_metrics(start, &org_id, stream_type, "500", "_around", "", "");
            log::error!("search around error: {err:?}");
            Ok(error_utils::map_error_to_http_response(
                &err,
                Some(trace_id),
            ))
        }
    }
}

/// SearchAroundV2

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchAroundV2",
    summary = "Search around specific log record",
    description = "Advanced version of around search that accepts a full log record in the request body instead of just a key. Searches for log entries around the specified record, providing better context matching based on the complete record data.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "stream_name name"),
        ("size" = i64, Query, description = "around size"),
        ("regions" = Option<String>, Query, description = "regions, split by comma"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
    ),
    request_body(content = String, description = "around record data", content_type = "application/json", example = json!({
        "_timestamp": 1675182660872049i64,
        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
        "container_name": "openobserve",
        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
        "host": "ip.us-east-2.compute.internal",
        "namespace_name": "openobserve",
        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
        "pod_name": "openobserve-ingester-0"
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "hits": [
                {
                    "_p": "F",
                    "_timestamp": 1674213225158000i64,
                    "kubernetes": {
                        "container_hash": "dkr.ecr.us-west-2.amazonaws.com/openobserve@sha256:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589",
                        "container_image": "dkr.ecr.us-west-2.amazonaws.com/openobserve:v0.0.3",
                        "container_name": "openobserve",
                        "docker_id": "eb0983bdb9ff9360d227e6a0b268fe3b24a0868c2c2d725a1516c11e88bf5789",
                        "host": "ip.us-east-2.compute.internal",
                        "namespace_name": "openobserve",
                        "pod_id": "35a0421f-9203-4d73-9663-9ff0ce26d409",
                        "pod_name": "openobserve-ingester-0"
                    },
                    "log": "[2023-01-20T11:13:45Z INFO  actix_web::middleware::logger] 10.2.80.192 \"POST /api/demo/_bulk HTTP/1.1\" 200 68",
                    "stream": "stderr"
                }
            ],
            "total": 10,
            "from": 0,
            "size": 10,
            "scan_size": 28943
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[post("/{org_id}/{stream_name}/_around")]
pub async fn around_v2(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    let (org_id, stream_name) = path.into_inner();
    let http_span = if get_config().common.tracing_search_enabled {
        tracing::info_span!(
            "/api/{org_id}/{stream_name}/_around",
            org_id = org_id.clone(),
            stream_name = stream_name.clone()
        )
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    let user_id = in_req
        .headers()
        .get("user_id")
        .map(|v| v.to_str().unwrap_or("").to_string());

    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let ret = around::around(
        &trace_id,
        http_span,
        &org_id,
        &stream_name,
        stream_type,
        query,
        None,
        Some(body),
        user_id,
    )
    .await;
    match ret {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => {
            http_report_metrics(start, &org_id, stream_type, "500", "_around", "", "");
            log::error!("search around error: {err:?}");
            Ok(error_utils::map_error_to_http_response(
                &err,
                Some(trace_id),
            ))
        }
    }
}

/// SearchTopNValues

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchValues",
    summary = "Get distinct field values",
    description = "Retrieves the top N distinct values for specified fields within a stream and time range. Supports filtering, keyword search, and frequency counting. Essential for building dynamic filters, dropdowns, and understanding data cardinality in dashboards and analytics.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "stream_name name"),
        ("fields" = String, Query, description = "fields, split by comma"),
        ("filter" = Option<String>, Query, description = "filter, eg: a=b"),
        ("keyword" = Option<String>, Query, description = "keyword, eg: abc"),
        ("size" = i64, Query, description = "size"), // topN
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
        ("regions" = Option<String>, Query, description = "regions, split by comma"),
        ("timeout" = Option<i64>, Query, description = "timeout, seconds"),
        ("no_count" = Option<bool>, Query, description = "no need count, true of false"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "values": [
                {
                    "field": "field1",
                    "values": ["value1", "value2"]
                }
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[get("/{org_id}/{stream_name}/_values")]
pub async fn values(
    path: web::Path<(String, String)>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let http_span = if config::get_config().common.tracing_search_enabled {
        tracing::info_span!(
            "/api/{org_id}/{stream_name}/_values",
            org_id = org_id.clone(),
            stream_name = stream_name.clone()
        )
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);

    // originally there was v1 which would to a full stream search
    // and v2 which would do search on a distinct values stream iff
    // the queried fields configured accordingly.
    // Now we simply check if the fields in query are in the distinct stream or not,
    // and change the search stream to the distinct stream, so we don't need any separate
    // v2 fucntion.
    values_v1(
        &org_id,
        stream_type,
        &stream_name,
        &query,
        &user_id,
        trace_id,
        http_span,
    )
    .await
}

pub type FieldName = String;

/// Builds a search request per field
///
/// This function builds a search request per field based on the given request and parameters.
/// Search request can basically be of two types:
///     1. Search on distinct values stream
///     2. Search on original data stream
/// If the field is a distinct field, we will search of the distinct values stream.
/// Otherwise, we will search on the original data stream.
///
/// The `use_result_cache` parameter is used to determine the projection of the SQL query.
/// This flag will toggle the resultant requests between streaming aggregations and result cache.
/// By default, this function will produce an SQL which utilizes `Streaming Aggregations` to send
/// the results to the client. The SQL will be a simple aggregation query in case streaming
/// aggregations are used. If `use_result_cache` is set to true, the SQL projection will include a
/// histogram which will allow the use of result cache.
///
/// Another parameter is `no_count` which is used to determine if the count is needed or not.
/// `no_count` is used when only distinct values (sorted in alphabetical order) are needed but not
/// the frequency of the values. For example, Dashboards, where we show the values listed in
/// alphabetical order.
///
/// Since values request can contain multiple fields, we return a vector of requests.
/// Each request is a tuple of `Request`, `StreamType`, and `FieldName`.
/// The `Request` contains the SQL query, from, size, start_time, end_time, etc.
/// The `StreamType` is the type of the stream to search on.
/// The `FieldName` is the name of the field to search on.
#[tracing::instrument(name = "handler:search:build_search_request_per_field", skip_all)]
pub async fn build_search_request_per_field(
    req: &config::meta::search::ValuesRequest,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    keyword: &str,
) -> Result<Vec<(config::meta::search::Request, StreamType, FieldName)>, Error> {
    let query_fn = req
        .vrl_fn
        .as_ref()
        .and_then(|v| base64::decode_url(v.as_ref()).ok())
        .map(|vrl| {
            if !vrl.trim().ends_with('.') {
                format!("{vrl} \n .")
            } else {
                vrl
            }
        });

    let regions = req.regions.clone();
    let clusters = req.clusters.clone();

    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap_or(Schema::empty());
    let fields = req
        .fields
        .iter()
        .filter(|field| schema.field_with_name(field).is_ok())
        .cloned()
        .collect::<Vec<_>>();

    let no_count = req.no_count;

    let start_time = if stream_type.eq(&StreamType::EnrichmentTables) {
        enrichment_table::get_start_time(org_id, stream_name).await
    } else {
        req.start_time.unwrap_or(0)
    };

    if start_time == 0 {
        return Err(Error::other("start_time is empty"));
    }

    let end_time = if stream_type.eq(&StreamType::EnrichmentTables) {
        now_micros()
    } else {
        req.end_time.unwrap_or(0)
    };

    if end_time == 0 {
        return Err(Error::other("end_time is empty"));
    }

    let (start_time, end_time) = if start_time == end_time {
        (start_time - 1, end_time + 1)
    } else {
        (start_time, end_time)
    };

    let decoded_sql = base64::decode_url(&req.sql).unwrap_or_default();

    let mut query = config::meta::search::Query {
        sql: decoded_sql.clone(), // Will be populated per field in the loop below
        from: 0,
        size: req.size.unwrap_or(10),
        start_time,
        end_time,
        query_fn: query_fn.clone(),
        ..Default::default()
    };

    let (sql_where, can_use_distinct_stream) = match req.filter.as_ref() {
        None => {
            if !decoded_sql.is_empty() {
                query.uses_zo_fn = functions::get_all_transform_keys(org_id)
                    .await
                    .iter()
                    .any(|fn_name| decoded_sql.contains(&format!("{fn_name}(")));

                // pick up where clause from sql
                let sql_where_from_query = match pickup_where(&decoded_sql) {
                    Ok(Some(v)) => format!("WHERE {v}"),
                    Ok(None) => "".to_string(),
                    Err(e) => {
                        return Err(Error::other(e));
                    }
                };
                let can_use_distinct_stream = can_use_distinct_stream(
                    org_id,
                    stream_name,
                    stream_type,
                    &fields,
                    &query,
                    start_time,
                )
                .await;
                (sql_where_from_query, can_use_distinct_stream)
            } else {
                ("".to_string(), false)
            }
        }
        Some(v) => {
            if v.is_empty() {
                ("".to_string(), false)
            } else {
                let columns = v.splitn(2, '=').collect::<Vec<_>>();
                if columns.len() < 2 {
                    return Err(Error::other("Invalid filter format"));
                }
                let vals = columns[1].split(',').collect::<Vec<_>>().join("','");
                let sql_where = format!("WHERE {} IN ('{vals}')", columns[0]);

                // Define the default_sql here
                let default_sql = format!("SELECT {TIMESTAMP_COL_NAME} FROM \"{stream_name}\"");

                query.sql = format!("{default_sql} {sql_where}");

                let can_use_distinct_stream = can_use_distinct_stream(
                    org_id,
                    stream_name,
                    stream_type,
                    &fields,
                    &query,
                    start_time,
                )
                .await;

                (sql_where, can_use_distinct_stream)
            }
        }
    };

    let timeout = req.timeout.unwrap_or(0);

    let req = config::meta::search::Request {
        query,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions,
        clusters,
        timeout,
        search_type: Some(SearchEventType::Values),
        search_event_context: None,
        use_cache: req.use_cache,
        local_mode: None,
    };

    let distinct_prefix = if can_use_distinct_stream {
        format!("{}_{}_", DISTINCT_STREAM_PREFIX, stream_type.as_str())
    } else {
        "".to_string()
    };

    let count_fn = if can_use_distinct_stream {
        "SUM(count)".to_string()
    } else {
        "COUNT(*)".to_string()
    };

    let actual_stream_type = if can_use_distinct_stream {
        StreamType::Metadata
    } else {
        stream_type
    };

    let size = req.query.size;
    let mut requests = Vec::new();
    for field in fields {
        let sql_where = if !sql_where.is_empty() && !keyword.is_empty() {
            format!("{sql_where} AND str_match_ignore_case({field}, '{keyword}')")
        } else if !keyword.is_empty() {
            format!("WHERE str_match_ignore_case({field}, '{keyword}')")
        } else {
            sql_where.clone()
        };
        let sql = if no_count {
            format!(
                "SELECT \"{field}\" AS zo_sql_key FROM \"{distinct_prefix}{stream_name}\" {sql_where} GROUP BY zo_sql_key order by zo_sql_key asc limit {size}"
            )
        } else {
            format!(
                "SELECT \"{field}\" AS zo_sql_key, {count_fn} AS zo_sql_num FROM \"{distinct_prefix}{stream_name}\" {sql_where} GROUP BY zo_sql_key order by zo_sql_num desc limit {size}"
            )
        };

        let mut req = req.clone();
        req.query.sql = sql;
        requests.push((req, actual_stream_type, field));
    }

    Ok(requests)
}

// If all fields requested in the query AND fields from the
// sql query in the query are stored in distinct stream,
// this will search on the distinct stream, otherwise
// just search on the original data
async fn values_v1(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    query: &web::Query<HashMap<String, String>>,
    user_id: &str,
    trace_id: String,
    http_span: Span,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    let mut uses_fn = false;
    let fields = match query.get("fields") {
        Some(v) => v.split(',').map(|s| s.to_string()).collect::<Vec<_>>(),
        None => return Ok(MetaHttpResponse::bad_request("fields is empty")),
    };
    let query_fn = query
        .get("query_fn")
        .and_then(|v| base64::decode_url(v.as_ref()).ok())
        .map(|vrl_function| {
            if !vrl_function.trim().ends_with('.') {
                format!("{vrl_function} \n .")
            } else {
                vrl_function
            }
        });

    let default_sql = format!("SELECT {TIMESTAMP_COL_NAME} FROM \"{stream_name}\"");
    let mut query_sql = match query.get("filter") {
        None => default_sql,
        Some(v) => {
            if v.is_empty() {
                default_sql
            } else {
                let columns = v.splitn(2, '=').collect::<Vec<_>>();
                if columns.len() < 2 {
                    return Ok(MetaHttpResponse::bad_request("Invalid filter format"));
                }
                let vals = columns[1].split(',').collect::<Vec<_>>().join("','");
                format!("{default_sql} WHERE {} IN ('{vals}')", columns[0])
            }
        }
    };
    if let Ok(sql) = config::utils::query_select_utils::replace_o2_custom_patterns(&query_sql) {
        query_sql = sql;
    }

    let keyword = match query.get("keyword") {
        None => "".to_string(),
        Some(v) => v.trim().to_string(),
    };
    let no_count = match query.get("no_count") {
        None => false,
        Some(v) => {
            let v = v.to_lowercase();
            v == "true" || v == "1"
        }
    };

    if let Some(v) = query.get("sql")
        && let Ok(sql) = base64::decode_url(v)
    {
        uses_fn = functions::get_all_transform_keys(org_id)
            .await
            .iter()
            .any(|fn_name| sql.contains(&format!("{fn_name}(")));
        query_sql = sql;
    };

    // pick up where clause from sql
    let where_str = match pickup_where(&query_sql) {
        Ok(v) => v.unwrap_or_default(),
        Err(e) => {
            return Err(Error::other(e));
        }
    };

    // EnrichmentTable need query without time range
    let start_time = if stream_type.eq(&StreamType::EnrichmentTables) {
        enrichment_table::get_start_time(org_id, stream_name).await
    } else {
        query
            .get("start_time")
            .map_or(0, |v| v.parse::<i64>().unwrap_or(0))
    };

    if start_time == 0 {
        return Ok(MetaHttpResponse::bad_request("start_time is empty"));
    }
    let end_time = if stream_type.eq(&StreamType::EnrichmentTables) {
        now_micros()
    } else {
        query
            .get("end_time")
            .map_or(0, |v| v.parse::<i64>().unwrap_or(0))
    };
    if end_time == 0 {
        return Ok(MetaHttpResponse::bad_request("end_time is empty"));
    }
    let (start_time, end_time) = if start_time == end_time {
        (start_time - 1, end_time + 1)
    } else {
        (start_time, end_time)
    };

    let regions = query.get("regions").map_or(vec![], |regions| {
        regions
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    });
    let clusters = query.get("clusters").map_or(vec![], |clusters| {
        clusters
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    });

    let timeout = query
        .get("timeout")
        .map_or(0, |v| v.parse::<i64>().unwrap_or(0));

    // search
    let req_query = config::meta::search::Query {
        sql: query_sql,
        from: 0,
        size: query
            .get("size")
            .map_or(10, |v| v.parse::<i64>().unwrap_or(10)),
        start_time,
        end_time,
        uses_zo_fn: uses_fn,
        query_fn: query_fn.clone(),
        ..Default::default()
    };
    // check if we can use the distinct stream for this query
    let use_distinct_stream = can_use_distinct_stream(
        org_id,
        stream_name,
        stream_type,
        &fields,
        &req_query,
        start_time,
    )
    .await;

    let mut req = config::meta::search::Request {
        query: req_query,
        encoding: config::meta::search::RequestEncoding::Empty,
        regions,
        clusters,
        timeout,
        search_type: Some(SearchEventType::Values),
        search_event_context: None,
        use_cache: default_use_cache(),
        local_mode: None,
    };

    req.use_cache = get_use_cache_from_request(query);

    // Get the size from query parameter for limiting results
    let size = req.query.size;

    // skip fields which aren't part of the schema
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap_or(Schema::empty());

    let mut query_results = Vec::with_capacity(fields.len());
    let sql_where = if where_str.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {where_str}")
    };
    for field in &fields {
        let http_span = http_span.clone();
        // skip values for field which aren't part of the schema
        if schema.field_with_name(field).is_err() {
            continue;
        }
        let sql_where = if !sql_where.is_empty() && !keyword.is_empty() {
            format!("{sql_where} AND str_match_ignore_case({field}, '{keyword}')")
        } else if !keyword.is_empty() {
            format!("WHERE str_match_ignore_case({field}, '{keyword}')")
        } else {
            sql_where.clone()
        };

        let distinct_prefix;
        let count_fn;
        let actual_stream_type;

        if use_distinct_stream {
            distinct_prefix = format!("{}_{}_", DISTINCT_STREAM_PREFIX, stream_type.as_str());
            // if we are using distinct stream, we have already partially aggregated
            // the counts, so we need to sum over that field
            count_fn = "SUM(count)";
            // distinct_values_* stream is metadata
            actual_stream_type = StreamType::Metadata;
        } else {
            distinct_prefix = "".to_owned();
            // for non-distinct fields, we need the actual count
            count_fn = "COUNT(*)";
            actual_stream_type = stream_type;
        }

        let sql = if no_count {
            format!(
                "SELECT \"{field}\" AS zo_sql_key FROM \"{distinct_prefix}{stream_name}\" {sql_where} GROUP BY zo_sql_key ORDER BY zo_sql_key ASC limit {size}"
            )
        } else {
            format!(
                "SELECT \"{field}\" AS zo_sql_key, {count_fn} AS zo_sql_num FROM \"{distinct_prefix}{stream_name}\" {sql_where} GROUP BY zo_sql_key ORDER BY zo_sql_num DESC limit {size}"
            )
        };
        let mut req = req.clone();
        req.query.sql = sql;
        if let Ok(sql) =
            config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql)
        {
            req.query.sql = sql;
        }

        let search_res = SearchService::cache::search(
            &trace_id,
            org_id,
            actual_stream_type,
            Some(user_id.to_string()),
            &req,
            "".to_string(),
            false,
            None,
            // `is_multi_stream_search` false for values
            false,
        )
        .instrument(http_span)
        .await;
        let resp_search = match search_res {
            Ok(res) => res,
            Err(err) => {
                http_report_metrics(start, org_id, stream_type, "500", "_values/v1", "", "");
                log::error!("search values error: {err:?}");
                return Ok(error_utils::map_error_to_http_response(
                    &err,
                    Some(trace_id),
                ));
            }
        };
        query_results.push((field.to_string(), resp_search));
    }

    let mut resp = config::meta::search::Response::default();
    let mut hit_values: Vec<json::Value> = Vec::new();
    let mut work_group_set = Vec::with_capacity(query_results.len());

    for (key, ret) in query_results {
        let mut top_hits: Vec<(String, i64)> = Vec::with_capacity(size as usize);
        for row in ret.hits {
            let key = row
                .get("zo_sql_key")
                .map(json::get_string_value)
                .unwrap_or("".to_string());
            let num = row
                .get("zo_sql_num")
                .map(|v| v.as_i64().unwrap_or(0))
                .unwrap_or(0);
            top_hits.push((key, num));
        }

        let top_hits = top_hits
            .into_iter()
            .map(|(k, v)| {
                let mut item = json::Map::new();
                item.insert("zo_sql_key".to_string(), json::Value::String(k));
                item.insert("zo_sql_num".to_string(), json::Value::Number(v.into()));
                json::Value::Object(item)
            })
            .collect::<Vec<_>>();

        let mut field_value: json::Map<String, json::Value> = json::Map::new();
        field_value.insert("field".to_string(), json::Value::String(key));
        field_value.insert("values".to_string(), json::Value::Array(top_hits));
        hit_values.push(json::Value::Object(field_value));

        resp.scan_size = std::cmp::max(resp.scan_size, ret.scan_size);
        resp.scan_records = std::cmp::max(resp.scan_records, ret.scan_records);
        resp.cached_ratio = std::cmp::max(resp.cached_ratio, ret.cached_ratio);
        resp.result_cache_ratio = std::cmp::max(resp.result_cache_ratio, ret.result_cache_ratio);
        work_group_set.push(ret.work_group);
    }
    resp.total = fields.len();
    resp.hits = hit_values;
    resp.size = size;
    resp.took = start.elapsed().as_millis() as usize;

    let time = start.elapsed().as_secs_f64();
    http_report_metrics(start, org_id, stream_type, "200", "_values/v1", "", "");

    let req_stats = RequestStats {
        records: resp.hits.len() as i64,
        response_time: time,
        size: resp.scan_size as f64,
        scan_files: if resp.scan_files > 0 {
            Some(resp.scan_files as i64)
        } else {
            None
        },
        request_body: Some(req.query.sql),
        user_email: Some(user_id.to_string()),
        min_ts: Some(start_time),
        max_ts: Some(end_time),
        cached_ratio: Some(resp.cached_ratio),
        search_type: Some(SearchEventType::Values),
        trace_id: Some(trace_id),
        took_wait_in_queue: Some(resp.took_detail.wait_in_queue),
        work_group: get_work_group(work_group_set),
        ..Default::default()
    };
    let num_fn = req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        stream_type,
        UsageType::SearchTopNValues,
        num_fn,
        started_at,
    )
    .await;

    Ok(HttpResponse::Ok().json(resp))
}

/// SearchStreamPartition

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchPartition",
    summary = "Search partition data",
    description = "Executes search queries on partitioned log data with specified parameters",
    security(
        ("Authorization"= [])
    ),
    params(
        ("enable_align_histogram" = bool, Query, description = "Enable align histogram"),
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::search::SearchPartitionRequest, description = "Search query", content_type = "application/json", example = json!({
        "sql": "select * from k8s ",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "took": 155,
            "file_num": 10,
            "original_size": 10240,
            "compressed_size": 1024,
            "partitions": [
                [1674213225158000i64, 1674213225158000i64],
                [1674213225158000i64, 1674213225158000i64],
            ]
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[post("/{org_id}/_search_partition")]
pub async fn search_partition(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_partition", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);

    let org_id = org_id.into_inner();
    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let enable_align_histogram = get_enable_align_histogram_from_request(&query);

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    format!("org {org_id} has expired its trial period"),
                )));
            }
            Err(e) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    e.to_string(),
                )));
            }
            _ => {}
        }
    }

    let mut req: config::meta::search::SearchPartitionRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };
    if let Ok(sql) = config::utils::query_select_utils::replace_o2_custom_patterns(&req.sql) {
        req.sql = sql;
    }

    if let Err(e) = req.decode() {
        return Ok(MetaHttpResponse::bad_request(e));
    }

    let search_res = SearchService::search_partition(
        &trace_id,
        &org_id,
        Some(&user_id),
        stream_type,
        &req,
        false,
        true,
        enable_align_histogram,
    )
    .instrument(http_span)
    .await;

    // do search
    match search_res {
        Ok(res) => {
            http_report_metrics(
                start,
                &org_id,
                stream_type,
                "200",
                "_search_partition",
                "",
                "",
            );
            Ok(HttpResponse::Ok().json(res))
        }
        Err(err) => {
            http_report_metrics(
                start,
                &org_id,
                stream_type,
                "500",
                "_search_partition",
                "",
                "",
            );
            log::error!("search error: {err:?}");
            Ok(error_utils::map_error_to_http_response(
                &err,
                Some(trace_id),
            ))
        }
    }
}

/// Search History

#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchHistory",
    summary = "Search query history",
    description = "Retrieves historical search queries and their execution details",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(
        content = config::meta::search::SearchHistoryRequest,
        description = "Search history request parameters",
        content_type = "application/json",
        example = json!({
            "stream_name": "default",
            "stream_type": "logs",
            "min_ts": 1632960000,
            "max_ts": 1633046400,
            "trace_id": "7f7898fd19424c47ba830a6fa9b25e1f",
            "size": 100
        })
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json ! ({
            "took": 40,
            "took_detail": {
                "total": 40,
                "idx_took": 0,
                "wait_in_queue": 0
            },
            "hits": [
                {
                "cached_ratio": 0,
                "end_time": 15,
                "org_id": "default",
                "scan_records": 1,
                "scan_size": 7.0,
                "sql": "SELECT COUNT(*) from \"default\"",
                "start_time": 0,
                "stream_name": "default",
                "stream_type": "logs",
                "took": 0.056222333,
                "trace_id": "7f7898fd19424c47ba830a6fa9b25e1f",
                "function": ".",
                },
            ],
            "total": 3,
            "from": 0,
            "size": 20,
            "cached_ratio": 0,
            "scan_size": 0,
            "idx_scan_size": 0,
            "scan_records": 3,
            "trace_id": "2lsPBWjwZxUJ5ugvZ4jApESZEpk",
            "is_partial": false,
            "result_cache_ratio": 0
        })),
        (status = 400, description = "Bad Request - Invalid parameters or body", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[post("/{org_id}/_search_history")]
pub async fn search_history(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();
    let org_id = org_id.into_inner();
    let cfg = get_config();
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_history", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    let user_id = in_req
        .headers()
        .get("user_id")
        .map(|v| v.to_str().unwrap_or("").to_string());

    let mut req: config::meta::search::SearchHistoryRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };
    // restrict history only to path org_id
    req.org_id = Some(org_id.clone());
    // restrict history only to requested user_id
    req.user_email = user_id.clone();

    // Search
    let stream_name = USAGE_STREAM;
    let search_query_req = match req.to_query_req(stream_name) {
        Ok(r) => r,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    let history_org_id = META_ORG_ID;
    let stream_type = StreamType::Logs;
    let search_res = SearchService::search(
        &trace_id,
        history_org_id,
        stream_type,
        user_id.clone(),
        &search_query_req,
    )
    .instrument(http_span)
    .await;

    let mut search_res = match search_res {
        Ok(res) => res,
        Err(err) => {
            http_report_metrics(
                start,
                &org_id,
                stream_type,
                "500",
                "_search_history",
                "",
                "",
            );
            log::error!("[trace_id {trace_id}] Search history error : {err:?}");
            return Ok(error_utils::map_error_to_http_response(
                &err,
                Some(trace_id),
            ));
        }
    };

    search_res.hits = search_res
        .hits
        .into_iter()
        .filter_map(|hit| match SearchHistoryHitResponse::try_from(hit) {
            Ok(response) => match serde_json::to_value(response) {
                Ok(json_value) => Some(json_value),
                Err(e) => {
                    log::error!("[trace_id {trace_id}] Serialization error: {e:?}");
                    None
                }
            },
            Err(e) => {
                log::error!("[trace_id {trace_id}] Deserialization error: {e:?}");
                None
            }
        })
        .collect::<Vec<_>>();

    search_res.trace_id = trace_id.clone();

    // report http metrics
    http_report_metrics(
        start,
        &org_id,
        stream_type,
        "200",
        "_search_history",
        "",
        "",
    );

    // prepare usage metrics
    let time_taken = start.elapsed().as_secs_f64();
    let took_wait_in_queue = Some(search_res.took_detail.wait_in_queue);
    let req_stats = RequestStats {
        records: search_res.hits.len() as i64,
        response_time: time_taken,
        size: search_res.scan_size as f64,
        request_body: Some(search_query_req.query.sql),
        user_email: user_id,
        min_ts: Some(req.start_time),
        max_ts: Some(req.end_time),
        cached_ratio: Some(search_res.cached_ratio),
        search_type: Some(SearchEventType::Other),
        trace_id: Some(trace_id),
        took_wait_in_queue,
        work_group: search_res.work_group.clone(),
        ..Default::default()
    };
    let num_fn = search_query_req.query.query_fn.is_some() as u16;
    report_request_usage_stats(
        req_stats,
        history_org_id,
        stream_name,
        StreamType::Logs,
        UsageType::SearchHistory,
        num_fn,
        started_at,
    )
    .await;

    Ok(HttpResponse::Ok().json(search_res))
}

/// GetResultSchema
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "ResultSchema",
    summary = "Get search result schema",
    description = "Returns the schema definition for search results based on query parameters",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = config::meta::search::Request, description = "Search query", content_type = "application/json", example = json!({
        "query": {
            "sql": "select k8s_namespace_name as ns, histogram(_timestamp) from k8s group by k8s_namespace_name, histogram(_timestamp)",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "from": 0,
            "size": 10
        }
    })),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "projections": ["ns","histogram(k8s._timestamp)"],
            "group_by": ["histogram(k8s._timestamp)"],
            "timeseries_field": "histogram(k8s._timestamp)",
        })),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/result_schema")]
pub async fn result_schema(
    org_id: web::Path<String>,
    in_req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    format!("org {org_id} has expired its trial period"),
                )));
            }
            Err(e) => {
                return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                    StatusCode::FORBIDDEN,
                    e.to_string(),
                )));
            }
            _ => {}
        }
    }

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let query = web::Query::<HashMap<String, String>>::from_query(in_req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let use_cache = get_use_cache_from_request(&query);
    let is_streaming = {
        match query.get("is_streaming") {
            None => false,
            Some(v) => v.to_lowercase().as_str().parse::<bool>().unwrap_or(false),
        }
    };

    let mut req: config::meta::search::Request = match json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
    };

    if let Ok(sql) = config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql) {
        req.query.sql = sql;
    };

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
            return Ok(map_error_to_http_response(&(e.into()), None));
        }
    };

    // get stream settings
    for stream_name in stream_names {
        if let Some(settings) =
            infra::schema::get_settings(&org_id, &stream_name, stream_type).await
        {
            let max_query_range =
                get_settings_max_query_range(settings.max_query_range, &org_id, Some(&user_id))
                    .await;
            if max_query_range > 0
                && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
            {
                req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
            }
        }

        // Check permissions on stream
        #[cfg(feature = "enterprise")]
        if let Some(res) =
            check_stream_permissions(&stream_name, &org_id, &user_id, &stream_type).await
        {
            return Ok(res);
        }
    }

    #[cfg(feature = "enterprise")]
    {
        use actix_http::StatusCode;

        let keys_used = match get_cipher_key_names(&req.query.sql) {
            Ok(v) => v,
            Err(e) => {
                return Ok(HttpResponse::BadRequest()
                    .json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)));
            }
        };
        for key in keys_used {
            // Check permissions on keys
            {
                use o2_openfga::meta::mapping::OFGA_MODELS;

                use crate::{
                    common::utils::auth::{AuthExtractor, is_root_user},
                    service::users::get_user,
                };

                if !is_root_user(&user_id) {
                    let user: config::meta::user::User =
                        get_user(Some(&org_id), &user_id).await.unwrap();

                    if !crate::handler::http::auth::validator::check_permissions(
                        &user_id,
                        AuthExtractor {
                            auth: "".to_string(),
                            method: "GET".to_string(),
                            o2_type: format!(
                                "{}:{}",
                                OFGA_MODELS
                                    .get("cipher_keys")
                                    .map_or("cipher_keys", |model| model.key),
                                key
                            ),
                            org_id: org_id.clone(),
                            bypass_check: false,
                            parent_id: "".to_string(),
                        },
                        user.role,
                        user.is_external,
                    )
                    .await
                    {
                        return Ok(MetaHttpResponse::forbidden("Unauthorized Access to key"));
                    }
                    // Check permissions on key ends
                }
            }
        }
    }

    let query: proto::cluster_rpc::SearchQuery = req.query.clone().into();
    let sql =
        match crate::service::search::sql::Sql::new(&query, &org_id, stream_type, req.search_type)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("Error parsing sql: {e}");
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::BAD_REQUEST,
                    e,
                )));
            }
        };

    let res_schema = match get_result_schema(sql, is_streaming, use_cache).await {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::BAD_REQUEST,
                e,
            )));
        }
    };

    Ok(HttpResponse::Ok().json(ResultSchemaResponse {
        projections: res_schema.projections,
        group_by: res_schema.group_by.into_iter().collect(),
        timeseries_field: res_schema.timeseries,
    }))
}
