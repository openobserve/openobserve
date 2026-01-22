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
    body::Bytes,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        function::{RESULT_ARRAY, VRLResultResolver},
        search::{self, PARTIAL_ERROR_RESPONSE_MESSAGE, StreamResponses},
        self_reporting::usage::{RequestStats, UsageType},
        sql::resolve_stream_names,
        stream::StreamType,
    },
    metrics,
    utils::{base64, json},
};
use futures::stream::StreamExt;
use hashbrown::HashMap;
use infra::errors;
use tokio::sync::mpsc;
use tracing::{Instrument, Span};
#[cfg(feature = "cloud")]
use {
    crate::service::organization::is_org_in_free_trial_period,
    axum::http::StatusCode as AxumStatusCode,
};

#[cfg(feature = "enterprise")]
use crate::service::search::sql::visitor::cipher_key::get_cipher_key_names;
#[cfg(feature = "enterprise")]
use crate::{common::meta::search::AuditContext, service::self_reporting::audit};
use crate::{
    common::{
        meta::{self, http::HttpResponse as MetaHttpResponse},
        utils::{
            auth::UserEmail,
            functions,
            http::{
                get_clear_cache_from_request, get_dashboard_info_from_request,
                get_enable_align_histogram_from_request, get_fallback_order_by_col_from_request,
                get_or_create_trace_id, get_search_event_context_from_request,
                get_search_type_from_request, get_stream_type_from_request,
                get_use_cache_from_request,
            },
            stream::get_settings_max_query_range,
        },
    },
    handler::http::request::search::{Headers, error_utils::map_error_to_http_response},
    service::{
        search::{self as SearchService, streaming::process_search_stream_request_multi},
        self_reporting::report_request_usage_stats,
        setup_tracing_with_trace_id,
    },
};

/// SearchStreamData
#[utoipa::path(
    post,
    path = "/{org_id}/_search_multi",
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchSQLMultiStream",
    summary = "Search across multiple streams",
    description = "Executes SQL queries that can span across multiple data streams within the organization. This enables cross-stream analytics, joins, and aggregations to analyze data relationships and patterns across different log streams, metrics, or traces. The query engine automatically handles data from different streams and returns unified results.",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("validate" = bool, Query, description = "Validate query fields against stream schema and User-Defined Schema (UDS). When enabled, returns error if queried fields are not in schema or not allowed by UDS"),
    ),
    request_body(
        content = inline(search::MultiStreamRequest),
        description = "Search query",
        content_type = "application/json",
        example = json!({
        "query": {
            "sql": "select * from k8s ",
            "start_time": 1675182660872049i64,
            "end_time": 1675185660872049i64,
            "from": 0,
            "size": 10
        }
    })
    ),
    responses(
        (
            status = 200,
            description = "Success",
            content_type = "application/json",
            body = Object,
            example = json!({
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
        }),
        ),
        (
            status = 400,
            description = "Failure",
            content_type = "application/json",
            body = (),
        ),
        (
            status = 500,
            description = "Failure",
            content_type = "application/json",
            body = (),
        )
    )
)]
pub async fn search_multi(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    Json(multi_req): Json<search::MultiStreamRequest>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let started_at = Utc::now().timestamp_micros();
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_multi", org_id = org_id.clone())
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return (
                    AxumStatusCode::FORBIDDEN,
                    Json(MetaHttpResponse::error(
                        StatusCode::FORBIDDEN,
                        format!("org {org_id} has expired its trial period"),
                    )),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    AxumStatusCode::FORBIDDEN,
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
    let validate_query = super::utils::get_bool_from_request(&query, "validate");

    let dashboard_info = get_dashboard_info_from_request(&query);

    let search_type = match get_search_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return MetaHttpResponse::bad_request(e);
        }
    };
    let search_event_context = search_type
        .as_ref()
        .and_then(|event_type| get_search_event_context_from_request(event_type, &query));

    let mut query_fn = multi_req
        .query_fn
        .as_ref()
        .and_then(|v| base64::decode_url(v).ok());

    if let Some(vrl_function) = &query_fn
        && !vrl_function.trim().ends_with('.')
    {
        query_fn = Some(format!("{vrl_function} \n ."));
    }

    let mut range_error = String::new();

    let user_id = &user_email.user_id;
    let mut queries = multi_req.to_query_req();
    let mut multi_res = search::Response::new(multi_req.from, multi_req.size);

    let per_query_resp = multi_req.per_query_response;

    // Before making any rpc requests, first check the sql expressions can be decoded correctly
    for req in queries.iter_mut() {
        if let Err(e) = req.decode() {
            return MetaHttpResponse::bad_request(e);
        }
    }
    let queries_len = queries.len();
    let mut vrl_stream_name = "".to_string();
    let mut sqls = vec![];

    for mut req in queries {
        sqls.push(req.query.sql.clone());
        let stream_name = match resolve_stream_names(&req.query.sql) {
            Ok(v) => v[0].clone(),
            Err(e) => {
                return map_error_to_http_response(&(e.into()), Some(trace_id));
            }
        };
        vrl_stream_name = stream_name.clone();

        // get stream settings
        if let Some(settings) =
            infra::schema::get_settings(&org_id, &stream_name, stream_type).await
        {
            let max_query_range =
                get_settings_max_query_range(settings.max_query_range, &org_id, Some(user_id))
                    .await;
            if max_query_range > 0
                && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
            {
                req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
                range_error = format!(
                    "{} Query duration for stream {} is modified due to query range restriction of {} hours",
                    range_error, &stream_name, max_query_range
                );

                if multi_res.new_start_time.is_none() {
                    multi_res.new_start_time = Some(req.query.start_time);
                    multi_res.new_end_time = Some(req.query.end_time);
                }
            }
        }

        // Validate query fields if requested
        if validate_query
            && let Err(e) = super::utils::validate_query_fields(
                &org_id,
                &stream_name,
                stream_type,
                &req.query.sql,
            )
            .await
        {
            return map_error_to_http_response(&e, Some(trace_id));
        }

        // Check permissions on stream
        #[cfg(feature = "enterprise")]
        {
            use o2_openfga::meta::mapping::OFGA_MODELS;

            use crate::{
                common::utils::auth::{AuthExtractor, is_root_user},
                service::users::get_user,
            };

            if !is_root_user(user_id) {
                let user: config::meta::user::User =
                    get_user(Some(&org_id), user_id).await.unwrap();
                let stream_type_str = stream_type.as_str();

                if !crate::handler::http::auth::validator::check_permissions(
                    user_id,
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!(
                            "{}:{}",
                            OFGA_MODELS
                                .get(stream_type_str)
                                .map_or(stream_type_str, |model| model.key),
                            stream_name
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
                    return MetaHttpResponse::forbidden("Unauthorized Access");
                }
            }

            let keys_used = match get_cipher_key_names(&req.query.sql) {
                Ok(v) => v,
                Err(e) => {
                    return map_error_to_http_response(&e, Some(trace_id));
                }
            };
            if !keys_used.is_empty() {
                log::info!("keys used : {keys_used:?}");
            }
            // Check permissions on stream ends
            // Check permissions on keys
            for key in keys_used {
                if !is_root_user(user_id) {
                    let user: config::meta::user::User =
                        get_user(Some(&org_id), user_id).await.unwrap();

                    if !crate::handler::http::auth::validator::check_permissions(
                        user_id,
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
                        return MetaHttpResponse::forbidden("Unauthorized Access to key");
                    }
                    // Check permissions on key ends
                }
            }
        }

        if !per_query_resp {
            req.query.query_fn = query_fn.clone();
        }
        for fn_name in functions::get_all_transform_keys(&org_id).await {
            if req.query.sql.contains(&format!("{fn_name}(")) {
                req.query.uses_zo_fn = true;
                break;
            }
        }

        // add search type to request
        req.search_type = search_type;
        if let Ok(sql) =
            config::utils::query_select_utils::replace_o2_custom_patterns(&req.query.sql)
        {
            req.query.sql = sql;
        }

        let trace_id = trace_id.clone();
        // do search
        let search_res = SearchService::cache::search(
            &trace_id,
            &org_id,
            stream_type,
            Some(user_id.to_string()),
            &req,
            range_error.clone(),
            false,
            dashboard_info.clone(),
            // `is_multi_stream_search` is false here because search happens for every sql query in
            // the given array of queries
            false,
        )
        .instrument(http_span.clone())
        .await;

        match search_res {
            Ok(mut res) => {
                let time = start.elapsed().as_secs_f64();
                metrics::HTTP_RESPONSE_TIME
                    .with_label_values(&[
                        "/api/org/_search_multi",
                        "200",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/_search_multi",
                        "200",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .inc();
                res.set_trace_id(trace_id);
                res.set_took(start.elapsed().as_millis() as usize);

                let req_stats = RequestStats {
                    records: res.hits.len() as i64,
                    response_time: time,
                    size: res.scan_size as f64,
                    request_body: Some(req.query.sql),
                    user_email: Some(user_id.to_string()),
                    min_ts: Some(req.query.start_time),
                    max_ts: Some(req.query.end_time),
                    cached_ratio: Some(res.cached_ratio),
                    search_type,
                    search_event_context: search_event_context.clone(),
                    trace_id: Some(res.trace_id.clone()),
                    took_wait_in_queue: Some(res.took_detail.wait_in_queue),
                    work_group: res.work_group,
                    peak_memory_usage: res.peak_memory_usage,
                    ..Default::default()
                };
                let num_fn = req.query.query_fn.is_some() as u16;

                report_request_usage_stats(
                    req_stats,
                    &org_id,
                    &stream_name,
                    StreamType::Logs,
                    UsageType::Search,
                    num_fn,
                    started_at,
                )
                .await;

                multi_res.took += res.took;

                if res.total > multi_res.total {
                    multi_res.total = res.total;
                }
                multi_res.from = res.from;
                multi_res.size += res.size;
                multi_res.scan_files += res.scan_files;
                multi_res.scan_size += res.scan_size;
                multi_res.scan_records += res.scan_records;
                multi_res.columns.extend(res.columns);
                multi_res.response_type = res.response_type;
                multi_res.trace_id = res.trace_id;
                multi_res.cached_ratio = res.cached_ratio;

                if per_query_resp {
                    multi_res.hits.push(serde_json::Value::Array(res.hits));
                } else {
                    multi_res.hits.extend(res.hits);
                }

                if res.is_partial {
                    multi_res.is_partial = true;
                    multi_res.function_error = if res.function_error.is_empty() {
                        vec![PARTIAL_ERROR_RESPONSE_MESSAGE.to_string()]
                    } else {
                        vec![
                            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
                            res.function_error.join(", "),
                        ]
                    };
                }
                if multi_res.histogram_interval.is_none() && res.histogram_interval.is_some() {
                    multi_res.histogram_interval = res.histogram_interval;
                }
            }
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::HTTP_RESPONSE_TIME
                    .with_label_values(&[
                        "/api/org/_search_multi",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/_search_multi",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .inc();

                log::error!("search error: {err:?}");
                multi_res.function_error =
                    vec![multi_res.function_error.join(", "), err.to_string()];
                if let errors::Error::ErrorCode(code) = err
                    && let errors::ErrorCodes::SearchCancelQuery(_) = code
                {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(meta::http::HttpResponse::error_code_with_trace_id(
                            &code,
                            Some(trace_id),
                        )),
                    )
                        .into_response();
                }
            }
        }
    }

    let mut report_function_usage = false;
    multi_res.hits = if let Some(input_fn) = query_fn.as_ref()
        && per_query_resp
    {
        // compile vrl function & apply the same before returning the response
        let input_fn = input_fn.trim().to_string();

        let apply_over_hits = RESULT_ARRAY.is_match(&input_fn);
        let mut runtime = crate::common::utils::functions::init_vrl_runtime();
        let program = match crate::service::ingestion::compile_vrl_function(&input_fn, &org_id) {
            Ok(program) => {
                let registry = program
                    .config
                    .get_custom::<vector_enrichment::TableRegistry>()
                    .unwrap();
                registry.finish_load();
                Some(program)
            }
            Err(err) => {
                log::error!("[trace_id {trace_id}] search->vrl: compile err: {err:?}");
                multi_res.function_error =
                    vec![multi_res.function_error.join(", "), err.to_string()];
                None
            }
        };
        match program {
            Some(program) => {
                report_function_usage = true;
                if apply_over_hits {
                    let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                        &mut runtime,
                        &VRLResultResolver {
                            program: program.program.clone(),
                            fields: program.fields.clone(),
                        },
                        json::Value::Array(multi_res.hits),
                        &org_id,
                        &[vrl_stream_name.clone()],
                    );
                    ret_val
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|v| {
                            if per_query_resp {
                                let flattened_array = v
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .map(|item| {
                                        if !item.is_null() && item.is_object() {
                                            config::utils::flatten::flatten(item.clone()).unwrap()
                                        } else {
                                            item.clone()
                                        }
                                    })
                                    .collect::<Vec<_>>();
                                Some(serde_json::Value::Array(flattened_array))
                            } else if !v.is_null() && v.is_object() {
                                config::utils::flatten::flatten(v.clone()).ok()
                            } else {
                                None
                            }
                        })
                        .collect()
                } else {
                    multi_res
                        .hits
                        .into_iter()
                        .filter_map(|hit| {
                            let (ret_val, _) = crate::service::ingestion::apply_vrl_fn(
                                &mut runtime,
                                &VRLResultResolver {
                                    program: program.program.clone(),
                                    fields: program.fields.clone(),
                                },
                                hit,
                                &org_id,
                                &[vrl_stream_name.clone()],
                            );
                            if !ret_val.is_null() && ret_val.is_object() {
                                config::utils::flatten::flatten(ret_val.clone()).ok()
                            } else {
                                None
                            }
                        })
                        .collect()
                }
            }
            None => multi_res.hits,
        }
    } else {
        multi_res.hits
    };

    if !range_error.is_empty() {
        multi_res.is_partial = true;
        multi_res.function_error = if multi_res.function_error.is_empty() {
            vec![range_error]
        } else {
            multi_res.function_error.push(range_error);
            multi_res.function_error
        };
    }

    let column_timestamp = TIMESTAMP_COL_NAME.to_string();
    multi_res.cached_ratio /= queries_len;
    multi_res.hits.sort_by(|a, b| {
        if a.get(&column_timestamp).is_none() || b.get(&column_timestamp).is_none() {
            return std::cmp::Ordering::Equal;
        }
        let a_ts = a.get(&column_timestamp).unwrap().as_i64().unwrap();
        let b_ts = b.get(&column_timestamp).unwrap().as_i64().unwrap();
        b_ts.cmp(&a_ts)
    });

    let time = start.elapsed().as_secs_f64();
    if report_function_usage {
        let req_stats = RequestStats {
            // For functions, records = records * num_function, in this case num_function = 1
            records: multi_res.total as i64,
            response_time: time,
            size: multi_res.scan_size as f64,
            request_body: Some(json::to_string(&sqls).unwrap()),
            user_email: None,
            min_ts: None,
            max_ts: None,
            cached_ratio: None,
            trace_id: None,
            search_type: multi_req.search_type,
            search_event_context: multi_req.search_event_context.clone(),
            ..Default::default()
        };
        report_request_usage_stats(
            req_stats,
            &org_id,
            &vrl_stream_name,
            stream_type,
            UsageType::Functions,
            0, // The request stats already contains function event
            started_at,
        )
        .await;
    }
    Json(multi_res).into_response()
}

/// SearchMultiStreamPartition
#[utoipa::path(
    post,
    path = "/{org_id}/_search_partition_multi",
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchPartitionMulti",
    summary = "Search partition data across multiple streams",
    description = "Executes search queries across partitioned data in multiple log streams",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("enable_align_histogram" = bool, Query, description = "Enable align histogram"),
    ),
    request_body(
        content = inline(search::MultiSearchPartitionRequest),
        description = "Search query",
        content_type = "application/json",
        example = json!({
        "sql": "select * from k8s ",
        "start_time": 1675182660872049i64,
        "end_time": 1675185660872049i64
    })
    ),
    responses(
        (
            status = 200,
            description = "Success",
            content_type = "application/json",
            body = Object,
            example = json!({
            "took": 155,
            "file_num": 10,
            "original_size": 10240,
            "compressed_size": 1024,
            "partitions": [
                [1674213225158000i64, 1674213225158000i64],
                [1674213225158000i64, 1674213225158000i64],
            ]
        }),
        ),
        (
            status = 400,
            description = "Failure",
            content_type = "application/json",
            body = (),
        ),
        (
            status = 500,
            description = "Failure",
            content_type = "application/json",
            body = (),
        )
    )
)]
pub async fn _search_partition_multi(
    Path(org_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<search::MultiSearchPartitionRequest>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!(
            "/api/{org_id}/_search_partition_multi",
            org_id = org_id.clone()
        )
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);

    let user_id = &user_email.user_id;
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let enable_align_histogram = get_enable_align_histogram_from_request(&query);

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return (
                    AxumStatusCode::FORBIDDEN,
                    Json(MetaHttpResponse::error(
                        StatusCode::FORBIDDEN,
                        format!("org {org_id} has expired its trial period"),
                    )),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    AxumStatusCode::FORBIDDEN,
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

    let search_fut = SearchService::search_partition_multi(
        &trace_id,
        &org_id,
        user_id,
        stream_type,
        &req,
        enable_align_histogram,
    );
    let search_res = if !cfg.common.tracing_enabled && cfg.common.tracing_search_enabled {
        search_fut.instrument(http_span).await
    } else {
        search_fut.await
    };
    // do search
    match search_res {
        Ok(res) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
                    "200",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
                    "200",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            Json(res).into_response()
        }
        Err(err) => {
            let time = start.elapsed().as_secs_f64();
            metrics::HTTP_RESPONSE_TIME
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .observe(time);
            metrics::HTTP_INCOMING_REQUESTS
                .with_label_values(&[
                    "/api/org/_search_partition_multi",
                    "500",
                    &org_id,
                    stream_type.as_str(),
                    "",
                    "",
                ])
                .inc();
            log::error!("search error: {err:?}");
            map_error_to_http_response(&err, Some(trace_id))
        }
    }
}

/// SearchAround
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_names}/_around_multi",
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchAroundMulti",
    summary = "Search around specific record across multiple streams",
    description = "Searches for log entries around a specific record across multiple data streams",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_names" = String, Path, description = "base64 encoded comma separated stream names"),
        ("key" = i64, Query, description = "around key"),
        ("size" = i64, Query, description = "around size"),
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
    )
)]
pub async fn around_multi(
    Path(path): Path<(String, String)>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let (org_id, stream_names) = path;
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!(
            "/api/{org_id}/{stream_names}/_around_multi",
            org_id = org_id.clone(),
            stream_names = stream_names.clone()
        )
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);
    let user_id = Some(user_email.user_id.clone());

    let stream_names = match base64::decode_url(&stream_names) {
        Ok(decoded) => decoded,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to decode stream names: {}", e));
        }
    };
    let stream_names = stream_names.split(',').collect::<Vec<&str>>();

    let mut around_sqls = stream_names
        .iter()
        .map(|name| format!("SELECT * FROM \"{name}\" "))
        .collect::<Vec<String>>();
    if let Some(v) = query.get("sql") {
        let sqls = v.split(',').collect::<Vec<&str>>();
        for (i, sql) in sqls.into_iter().enumerate() {
            if let Ok(sql) = base64::decode_url(sql) {
                around_sqls[i] = sql;
            }
        }
    }

    let around_size = query
        .get("size")
        .map_or(10, |v| v.parse::<i64>().unwrap_or(10));

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let mut multi_resp = search::Response {
        size: around_size,
        ..Default::default()
    };
    for (i, stream_name) in stream_names.iter().enumerate() {
        let trace_id = format!("{trace_id}-{i}");
        let search_res = super::around::around(
            &trace_id,
            http_span.clone(),
            &org_id,
            stream_name,
            stream_type,
            Query(query.clone()),
            Some(around_sqls[i].clone()),
            None,
            user_id.clone(),
        )
        .await;
        let resp = match search_res {
            Ok(res) => res,
            Err(err) => {
                let time = start.elapsed().as_secs_f64();
                metrics::HTTP_RESPONSE_TIME
                    .with_label_values(&[
                        "/api/org/_around_multi",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .observe(time);
                metrics::HTTP_INCOMING_REQUESTS
                    .with_label_values(&[
                        "/api/org/_around_multi",
                        "500",
                        &org_id,
                        stream_type.as_str(),
                        "",
                        "",
                    ])
                    .inc();
                log::error!("multi search around error: {err:?}");
                return map_error_to_http_response(&err, Some(trace_id));
            }
        };

        multi_resp.hits.extend(resp.hits);
        multi_resp.total += resp.total;
        multi_resp.scan_size += resp.scan_size;
        multi_resp.took += resp.took;
        multi_resp.cached_ratio += resp.cached_ratio;
    }

    multi_resp.hits.sort_by(|a, b| {
        let a_ts = a.get("_timestamp").unwrap().as_i64().unwrap();
        let b_ts = b.get("_timestamp").unwrap().as_i64().unwrap();
        b_ts.cmp(&a_ts)
    });
    Json(multi_resp).into_response()
}

/// Parse simple multi-stream request format and convert to MultiStreamRequest
fn parse_simple_multi_stream_request(
    body: &[u8],
) -> Result<search::MultiStreamRequest, infra::errors::Error> {
    #[derive(serde::Deserialize)]
    struct SimpleMultiStreamWrapper {
        query: SimpleMultiStreamQuery,
    }
    #[derive(serde::Deserialize)]
    struct SimpleMultiStreamQuery {
        sql: Vec<String>,
        start_time: i64,
        end_time: i64,
        #[serde(default)]
        from: i64,
        #[serde(default = "default_size")]
        size: i64,
        #[serde(default)]
        track_total_hits: bool,
        #[serde(default)]
        query_fn: Option<String>,
        #[serde(default)]
        quick_mode: bool,
    }

    let simple_req: SimpleMultiStreamWrapper =
        json::from_slice(body).map_err(infra::errors::Error::SerdeJsonError)?;

    // Convert to MultiStreamRequest format
    let sql_queries = simple_req
        .query
        .sql
        .into_iter()
        .map(|sql| search::SqlQuery {
            sql,
            start_time: Some(simple_req.query.start_time),
            end_time: Some(simple_req.query.end_time),
            query_fn: simple_req.query.query_fn.clone(),
            is_old_format: false,
        })
        .collect();

    Ok(search::MultiStreamRequest {
        sql: sql_queries,
        encoding: search::RequestEncoding::Empty,
        timeout: 0,
        from: simple_req.query.from,
        size: simple_req.query.size,
        start_time: simple_req.query.start_time,
        end_time: simple_req.query.end_time,
        sort_by: None,
        quick_mode: simple_req.query.quick_mode,
        query_type: "".to_string(),
        track_total_hits: simple_req.query.track_total_hits,
        uses_zo_fn: simple_req.query.query_fn.is_some(),
        query_fn: simple_req.query.query_fn,
        skip_wal: false,
        regions: vec![],
        clusters: vec![],
        search_type: None,
        search_event_context: None,
        index_type: "".to_string(),
        per_query_response: false,
    })
}

const fn default_size() -> i64 {
    10
}

/// SearchStreamMulti HTTP2 streaming endpoint
#[utoipa::path(
    post,
    path = "/{org_id}/_search_multi_stream",
    context_path = "/api",
    tag = "Search",
    operation_id = "SearchStreamMultiHttp2",
    summary = "Stream search results across multiple queries",
    description = "Executes multiple SQL queries and streams the results back in real-time using HTTP/2 server-sent events. This enables streaming of results from multiple independent queries simultaneously, ideal for multi-stream dashboards and complex analytics where you want to receive data as it becomes available from different data sources.",
    security(
        ("Authorization"= [])
    ),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(
        content = inline(search::MultiStreamRequest),
        description = "Multi-stream search query",
        content_type = "application/json",
        example = json!({
            "sql": ["select * from \"alert_test\"", "select * from \"addstream\""],
            "start_time": 1759297137133000i64,
            "end_time": 1759297197133000i64,
            "from": 0,
            "size": 50,
            "quick_mode": true,
            "streaming_output": false,
            "streaming_id": null
        })
    ),
    responses(
        (status = 200, description = "Success", content_type = "text/event-stream"),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn search_multi_stream(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let cfg = get_config();
    // Create a tracing span
    let http_span = if cfg.common.tracing_search_enabled {
        tracing::info_span!("/api/{org_id}/_search_multi_stream")
    } else {
        Span::none()
    };
    let trace_id = get_or_create_trace_id(&headers, &http_span);

    // Log the request
    log::debug!(
        "[HTTP2_STREAM_MULTI trace_id {trace_id}] Received HTTP/2 multi-stream request for org_id: {org_id}"
    );

    #[cfg(feature = "cloud")]
    {
        match is_org_in_free_trial_period(&org_id).await {
            Ok(false) => {
                return (
                    AxumStatusCode::FORBIDDEN,
                    Json(MetaHttpResponse::error(
                        StatusCode::FORBIDDEN,
                        format!("org {org_id} has expired its trial period"),
                    )),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    AxumStatusCode::FORBIDDEN,
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

    let user_id = user_email.user_id;
    #[cfg(feature = "enterprise")]
    let body_bytes = String::from_utf8_lossy(&body).to_string();

    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();

    let dashboard_info = get_dashboard_info_from_request(&query);

    let search_type = match get_search_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            #[cfg(feature = "enterprise")]
            {
                let query_string = query
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&");
                report_to_audit(
                    user_id,
                    org_id.clone(),
                    trace_id,
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_search_multi_stream", org_id),
                    query_string,
                    body_bytes,
                )
                .await;
            }
            return http_response;
        }
    };
    let search_event_context = search_type
        .as_ref()
        .and_then(|event_type| get_search_event_context_from_request(event_type, &query));

    let fallback_order_by_col = get_fallback_order_by_col_from_request(&query);

    // Parse the multi-stream request - handle both formats
    let multi_req: search::MultiStreamRequest = match json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            // Try parsing as a simple multi-query format and convert it
            match parse_simple_multi_stream_request(&body) {
                Ok(converted_req) => converted_req,
                Err(e) => {
                    #[cfg(feature = "enterprise")]
                    let error_message = e.to_string();

                    let http_response = map_error_to_http_response(&e, Some(trace_id.clone()));

                    #[cfg(feature = "enterprise")]
                    {
                        report_to_audit(
                            user_id,
                            org_id.clone(),
                            trace_id,
                            http_response.status().into(),
                            Some(error_message),
                            "POST".to_string(),
                            format!("/api/{}/_search_multi_stream", org_id),
                            query
                                .iter()
                                .map(|(k, v)| format!("{}={}", k, v))
                                .collect::<Vec<_>>()
                                .join("&"),
                            body_bytes,
                        )
                        .await;
                    }
                    return http_response;
                }
            }
        }
    };

    // Check permissions for all streams upfront before processing queries
    // Extract stream names from SQL queries and check permissions
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::users::get_user,
        };

        if !is_root_user(&user_id) {
            let user: config::meta::user::User = get_user(Some(&org_id), &user_id).await.unwrap();
            let stream_type_str = stream_type.as_str();
            let user_role = user.role.clone();
            let user_is_external = user.is_external;

            // Extract all stream names from SQL queries
            let mut stream_names = hashbrown::HashSet::new();
            for sql_query in &multi_req.sql {
                match resolve_stream_names(&sql_query.sql) {
                    Ok(streams) => {
                        for stream in streams {
                            stream_names.insert(stream);
                        }
                    }
                    Err(e) => {
                        #[cfg(feature = "enterprise")]
                        let error_message = format!("Failed to parse SQL: {e}");

                        let http_response =
                            map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

                        #[cfg(feature = "enterprise")]
                        {
                            report_to_audit(
                                user_id.clone(),
                                org_id.clone(),
                                trace_id.clone(),
                                http_response.status().into(),
                                Some(error_message),
                                "POST".to_string(),
                                format!("/api/{}/_search_multi_stream", org_id),
                                query
                                    .iter()
                                    .map(|(k, v)| format!("{}={}", k, v))
                                    .collect::<Vec<_>>()
                                    .join("&"),
                                body_bytes.clone(),
                            )
                            .await;
                        }
                        return http_response;
                    }
                }
            }

            // Check permissions for each unique stream
            for stream_name in stream_names {
                if !crate::handler::http::auth::validator::check_permissions(
                    &user_id,
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!(
                            "{}:{}",
                            OFGA_MODELS
                                .get(stream_type_str)
                                .map_or(stream_type_str, |model| model.key),
                            stream_name
                        ),
                        org_id: org_id.clone(),
                        bypass_check: false,
                        parent_id: "".to_string(),
                    },
                    user_role.clone(),
                    user_is_external,
                )
                .await
                {
                    #[cfg(feature = "enterprise")]
                    {
                        report_to_audit(
                            user_id.clone(),
                            org_id.clone(),
                            trace_id.clone(),
                            403,
                            Some(format!("Unauthorized Access to stream: {stream_name}")),
                            "POST".to_string(),
                            format!("/api/{}/_search_multi_stream", org_id),
                            query
                                .iter()
                                .map(|(k, v)| format!("{}={}", k, v))
                                .collect::<Vec<_>>()
                                .join("&"),
                            body_bytes.clone(),
                        )
                        .await;
                    }
                    return MetaHttpResponse::forbidden("Unauthorized Access");
                }
            }
        }
    }

    let mut queries = multi_req.to_query_req();

    // Set each of the sql queries with use_cache from query params
    let clear_cache = get_clear_cache_from_request(&query);
    #[allow(unused_assignments)]
    let mut use_cache = get_use_cache_from_request(&query) && !clear_cache;
    // Disable cache temporarily for `multi_stream_search`
    // TODO: fix cache
    use_cache = false;

    // Before making any requests, first check the sql expressions can be decoded correctly
    for req in queries.iter_mut() {
        // Update `use_cache` & `clear_cache` from query params
        req.use_cache = use_cache;
        req.clear_cache = clear_cache;

        if let Err(e) = req.decode() {
            #[cfg(feature = "enterprise")]
            let error_message = e.to_string();

            let http_response = map_error_to_http_response(&(e.into()), Some(trace_id.clone()));

            #[cfg(feature = "enterprise")]
            {
                report_to_audit(
                    user_id.clone(),
                    org_id.clone(),
                    trace_id.clone(),
                    http_response.status().into(),
                    Some(error_message),
                    "POST".to_string(),
                    format!("/api/{}/_search_multi_stream", org_id),
                    query
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&"),
                    body_bytes.clone(),
                )
                .await;
            }
            return http_response;
        }
    }

    // Create a channel for streaming results
    let (tx, rx) = mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(100);

    #[cfg(feature = "enterprise")]
    let audit_ctx = Some(AuditContext {
        method: "POST".to_string(),
        path: format!("/api/{}/_search_multi_stream", org_id),
        query_params: query
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&"),
        body: body_bytes,
    });
    #[cfg(not(feature = "enterprise"))]
    let audit_ctx = None;

    let search_span = setup_tracing_with_trace_id(
        &trace_id,
        tracing::info_span!("service::search::search_multi_stream_h2"),
    )
    .await;

    // Spawn the multi-stream search task
    tokio::spawn(process_search_stream_request_multi(
        org_id.clone(),
        user_id,
        trace_id.clone(),
        queries,
        stream_type,
        search_span.clone(),
        tx,
        fallback_order_by_col,
        audit_ctx,
        dashboard_info,
        search_type,
        search_event_context,
    ));

    // Return streaming response
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!(
                    "[HTTP2_STREAM_MULTI trace_id {trace_id}] Error in multi-stream search: {err}"
                );
                let err_res = match err {
                    infra::errors::Error::ErrorCode(ref code) => {
                        // if err code is cancelled return cancelled response
                        match code {
                            infra::errors::ErrorCodes::SearchCancelQuery(_) => {
                                StreamResponses::Cancelled
                            }
                            _ => {
                                let message = code.get_message();
                                let error_detail = code.get_error_detail();
                                let http_response = map_error_to_http_response(&err, None);

                                StreamResponses::Error {
                                    code: http_response.status().into(),
                                    message,
                                    error_detail: Some(error_detail),
                                }
                            }
                        }
                    }
                    _ => StreamResponses::Error {
                        code: 500,
                        message: err.to_string(),
                        error_detail: None,
                    },
                };
                err_res.to_chunks()
            }
        };

        // Convert the iterator to a stream
        futures::stream::iter(chunks_iter)
    });

    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
pub async fn report_to_audit(
    user_id: String,
    org_id: String,
    trace_id: String,
    code: u16,
    error_message: Option<String>,
    http_method: String,
    http_path: String,
    http_query_params: String,
    req_body: String,
) {
    use o2_enterprise::enterprise::common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    };

    let is_audit_enabled = get_o2_config().common.audit_enabled;
    if is_audit_enabled {
        audit(AuditMessage {
            user_email: user_id,
            org_id,
            _timestamp: chrono::Utc::now().timestamp(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method,
                http_path,
                http_query_params,
                http_body: req_body,
                http_response_code: code,
                error_msg: error_message,
                trace_id: Some(trace_id.to_string()),
            },
        })
        .await;
    }
}

#[cfg(test)]
mod tests {

    use chrono::Utc;
    use config::meta::search::{MultiSearchPartitionRequest, MultiStreamRequest};

    #[test]
    fn test_multi_stream_request_structure() {
        let request = MultiStreamRequest {
            sql: vec![config::meta::search::SqlQuery {
                sql: "SELECT * FROM logs".to_string(),
                start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                end_time: Some(Utc::now().timestamp_micros()),
                query_fn: None,
                is_old_format: false,
            }],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        assert!(!request.sql.is_empty());
        assert_eq!(request.size, 10);
        assert_eq!(request.from, 0);
    }

    #[test]
    fn test_multi_search_partition_request_structure() {
        let request = MultiSearchPartitionRequest {
            sql: vec!["SELECT * FROM logs".to_string()],
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            encoding: config::meta::search::RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            query_fn: None,
            streaming_output: false,
            histogram_interval: 0,
        };

        assert!(!request.sql.is_empty());
        assert_eq!(request.sql[0], "SELECT * FROM logs");
    }

    #[test]
    fn test_search_multi_invalid_time_range() {
        let request = MultiStreamRequest {
            sql: vec![config::meta::search::SqlQuery {
                sql: "SELECT * FROM logs".to_string(),
                start_time: Some(Utc::now().timestamp_micros()),
                end_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                query_fn: None,
                is_old_format: false,
            }],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros(),
            end_time: Utc::now().timestamp_micros() - 3_600_000_000,
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        // Test that invalid time range is detected
        assert!(request.start_time > request.end_time);
    }

    #[test]
    fn test_search_multi_empty_queries() {
        let request = MultiStreamRequest {
            sql: vec![],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        assert!(request.sql.is_empty());
    }

    #[test]
    fn test_search_multi_with_vrl_function() {
        let request = MultiStreamRequest {
            sql: vec![config::meta::search::SqlQuery {
                sql: "SELECT * FROM logs".to_string(),
                start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                end_time: Some(Utc::now().timestamp_micros()),
                query_fn: Some("base64_encoded_vrl_function".to_string()),
                is_old_format: false,
            }],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: Some("base64_encoded_vrl_function".to_string()),
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        assert!(request.query_fn.is_some());
        assert!(request.sql[0].query_fn.is_some());
    }

    #[test]
    fn test_search_multi_per_query_response() {
        let request = MultiStreamRequest {
            sql: vec![config::meta::search::SqlQuery {
                sql: "SELECT * FROM logs".to_string(),
                start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                end_time: Some(Utc::now().timestamp_micros()),
                query_fn: None,
                is_old_format: false,
            }],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: true,
        };

        assert!(request.per_query_response);
    }

    #[test]
    fn test_search_multi_with_multiple_queries() {
        let request = MultiStreamRequest {
            sql: vec![
                config::meta::search::SqlQuery {
                    sql: "SELECT * FROM logs".to_string(),
                    start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                    end_time: Some(Utc::now().timestamp_micros()),
                    query_fn: None,
                    is_old_format: false,
                },
                config::meta::search::SqlQuery {
                    sql: "SELECT * FROM metrics".to_string(),
                    start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                    end_time: Some(Utc::now().timestamp_micros()),
                    query_fn: None,
                    is_old_format: false,
                },
            ],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        assert_eq!(request.sql.len(), 2);
        assert_eq!(request.sql[0].sql, "SELECT * FROM logs");
        assert_eq!(request.sql[1].sql, "SELECT * FROM metrics");
    }

    #[test]
    fn test_search_multi_large_size() {
        let request = MultiStreamRequest {
            sql: vec![config::meta::search::SqlQuery {
                sql: "SELECT * FROM logs".to_string(),
                start_time: Some(Utc::now().timestamp_micros() - 3_600_000_000),
                end_time: Some(Utc::now().timestamp_micros()),
                query_fn: None,
                is_old_format: false,
            }],
            encoding: config::meta::search::RequestEncoding::Empty,
            timeout: 0,
            from: 0,
            size: 10000,
            start_time: Utc::now().timestamp_micros() - 3_600_000_000,
            end_time: Utc::now().timestamp_micros(),
            sort_by: None,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            regions: vec![],
            clusters: vec![],
            search_type: None,
            search_event_context: None,
            index_type: "".to_string(),
            per_query_response: false,
        };

        assert_eq!(request.size, 10000);
    }

    #[test]
    fn test_base64_decode_url() {
        let encoded = "dGVzdF9zdHJlYW0="; // "test_stream" in base64
        let decoded = config::utils::base64::decode_url(encoded);
        assert!(decoded.is_ok());
        assert_eq!(decoded.unwrap(), "test_stream");
    }

    #[test]
    fn test_invalid_base64_decode_url() {
        let invalid = "invalid_base64!@#";
        let decoded = config::utils::base64::decode_url(invalid);
        assert!(decoded.is_err());
    }
}
