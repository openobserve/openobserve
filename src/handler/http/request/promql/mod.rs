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

use actix_web::{HttpRequest, HttpResponse, get, http, post, web};
use config::{
    meta::search::{CardinalityLevel, StreamResponses, generate_aggregation_search_interval},
    utils::time::{now_micros, parse_milliseconds, parse_str_to_timestamp_micros},
};
use futures::StreamExt;
use infra::errors;
use promql_parser::parser;
#[cfg(feature = "enterprise")]
use {config::meta::stream::StreamType, o2_openfga::meta::mapping::OFGA_MODELS};

use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::{auth::UserEmail, http::get_or_create_trace_id},
    },
    handler::http::{
        extractors::Headers, request::search::error_utils::map_error_to_http_response,
    },
    service::{metrics, promql},
};

/// prometheus remote-write endpoint for metrics
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusRemoteWrite",
    summary = "Ingest Prometheus metrics",
    description = "Receives Prometheus metrics data via remote write protocol. Accepts protobuf-encoded WriteRequest payloads containing time series data and stores them for querying. Compatible with standard Prometheus remote write configuration.",
        security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "prometheus WriteRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/prometheus/api/v1/write")]
pub async fn remote_write(
    org_id: web::Path<String>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    if content_type == "application/x-protobuf" {
        Ok(match metrics::prom::remote_write(&org_id, body).await {
            Ok(_) => HttpResponse::Ok().into(),
            Err(e) => HttpResponse::BadRequest()
                .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e)),
        })
    } else {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "Bad Request",
        )))
    }
}

/// prometheus instant queries

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#instant-queries
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusQuery",
    summary = "Execute Prometheus instant query",
    description = "Executes a Prometheus instant query at a single point in time. Returns current values for metrics matching the query expression. Compatible with Prometheus instant query API for seamless integration with existing monitoring tools.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("query" = String, Query, description = "Prometheus expression query string"),
        ("time" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: Evaluation timestamp. Optional"),
        ("timeout" = Option<String>, Query, description = "Evaluation timeout"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status" : "success",
            "data" : {
               "resultType" : "vector",
               "result" : [
                  {
                     "metric" : {
                        "__name__" : "up",
                        "job" : "prometheus",
                        "instance" : "localhost:9090"
                     },
                     "value": [ 1435781451.781, "1" ]
                  },
                  {
                     "metric" : {
                        "__name__" : "up",
                        "job" : "node",
                        "instance" : "localhost:9100"
                     },
                     "value" : [ 1435781451.781, "0" ]
                  }
               ]
            }
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/query")]
pub async fn query_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    query(
        &org_id.into_inner(),
        req.into_inner(),
        &user_email.user_id,
        in_req,
    )
    .await
}

#[post("/{org_id}/prometheus/api/v1/query")]
pub async fn query_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestQuery>,
    web::Form(form): web::Form<config::meta::promql::RequestQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let req = if form.query.is_some() {
        form
    } else {
        req.into_inner()
    };
    query(&org_id.into_inner(), req, &user_email.user_id, in_req).await
}

async fn query(
    org_id: &str,
    req: config::meta::promql::RequestQuery,
    user_email: &str,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let cfg = config::get_config();
    let http_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
        tracing::info_span!(
            "/api/{org_id}/prometheus/api/v1/query",
            org_id = org_id.to_string()
        )
    } else {
        tracing::Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = crate::service::search::check_search_allowed(org_id, None) {
            return Ok(
                HttpResponse::TooManyRequests().json(MetaHttpResponse::error(
                    http::StatusCode::TOO_MANY_REQUESTS,
                    e.to_string(),
                )),
            );
        }
        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::db::org_users::get_cached_user_org,
        };

        let ast = parser::parse(&req.query.clone().unwrap()).unwrap();
        let mut visitor = promql::name_visitor::MetricNameVisitor::default();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();

        if !is_root_user(user_email) {
            let stream_type_str = StreamType::Metrics.as_str();
            for name in visitor.name {
                let user: config::meta::user::User =
                    get_cached_user_org(org_id, user_email).unwrap();
                if !crate::handler::http::auth::validator::check_permissions(
                    user_email,
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!(
                            "{}:{}",
                            OFGA_MODELS
                                .get(stream_type_str)
                                .map_or(stream_type_str, |model| model.key),
                            name
                        ),
                        org_id: org_id.to_string(),
                        bypass_check: false,
                        parent_id: "".to_string(),
                    },
                    user.role,
                    user.is_external,
                )
                .await
                {
                    return Ok(MetaHttpResponse::forbidden("Unauthorized Access"));
                }
            }
        }
    }

    let start = match req.time {
        None => now_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {e}");
                return Ok(HttpResponse::BadRequest().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_bad_data(e.to_string(), None),
                ));
            }
        },
    };
    let end = start;
    let timeout = search_timeout(req.timeout);

    let req = promql::MetricsQueryRequest {
        query: req.query.unwrap_or_default(),
        start,
        end,
        step: 300_000_000, // 5m
        query_exemplars: false,
        use_cache: None,
    };

    search(&trace_id, org_id, req, user_email, timeout).await
}

/// prometheus range queries

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#range-queries
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusRangeQuery",
    summary = "Execute Prometheus range query",
    description = "Executes a Prometheus range query over a specified time period. Returns time series data with multiple data points for metrics matching the query expression. Compatible with Prometheus range query API for time series analysis and visualization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("query" = String, Query, description = "Prometheus expression query string"),
        ("start" = String, Query, description = "<rfc3339 | unix_timestamp>: Start timestamp, inclusive"),
        ("end" = String, Query, description = "<rfc3339 | unix_timestamp>: End timestamp, inclusive"),
        ("step" = Option<String>, Query, description = "Query resolution step width in duration format or float number of seconds"),
        ("timeout" = Option<String>, Query, description = "Evaluation timeout"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status" : "success",
            "data" : {
               "resultType" : "matrix",
               "result" : [
                  {
                     "metric" : {
                        "__name__" : "up",
                        "job" : "prometheus",
                        "instance" : "localhost:9090"
                     },
                     "values" : [
                        [ 1435781430.781, "1" ],
                        [ 1435781445.781, "1" ],
                        [ 1435781460.781, "1" ]
                     ]
                  },
                  {
                     "metric" : {
                        "__name__" : "up",
                        "job" : "node",
                        "instance" : "localhost:9091"
                     },
                     "values" : [
                        [ 1435781430.781, "0" ],
                        [ 1435781445.781, "0" ],
                        [ 1435781460.781, "1" ]
                     ]
                  }
               ]
            }
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/query_range")]
pub async fn query_range_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestRangeQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    query_range(
        &org_id.into_inner(),
        req.into_inner(),
        &user_email.user_id,
        in_req,
        false,
    )
    .await
}

#[post("/{org_id}/prometheus/api/v1/query_range")]
pub async fn query_range_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestRangeQuery>,
    web::Form(form): web::Form<config::meta::promql::RequestRangeQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let req = if form.query.is_some() {
        form
    } else {
        req.into_inner()
    };
    query_range(
        &org_id.into_inner(),
        req,
        &user_email.user_id,
        in_req,
        false,
    )
    .await
}

/// prometheus query exemplars

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-exemplars
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusQueryExemplars",
    summary = "Query Prometheus exemplars",
    description = "Queries exemplars for metrics within a specified time range. Exemplars are references to trace data that are associated with specific metric data points, enabling correlation between metrics and traces for observability workflows.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("query" = String, Query, description = "Prometheus expression query string"),
        ("start" = String, Query, description = "<rfc3339 | unix_timestamp>: Start timestamp, inclusive"),
        ("end" = String, Query, description = "<rfc3339 | unix_timestamp>: End timestamp, inclusive"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status": "success",
            "data": [
                {
                    "seriesLabels": {
                        "__name__": "test_exemplar_metric_total",
                        "instance": "localhost:8090",
                        "job": "prometheus",
                        "service": "bar"
                    },
                    "exemplars": [
                        {
                            "labels": {
                                "trace_id": "EpTxMJ40fUus7aGY"
                            },
                            "value": "6",
                            "timestamp": 1600096945.479
                        }
                    ]
                },
                {
                    "seriesLabels": {
                        "__name__": "test_exemplar_metric_total",
                        "instance": "localhost:8090",
                        "job": "prometheus",
                        "service": "foo"
                    },
                    "exemplars": [
                        {
                            "labels": {
                                "trace_id": "Olp9XHlq763ccsfa"
                            },
                            "value": "19",
                            "timestamp": 1600096955.479
                        },
                        {
                            "labels": {
                                "trace_id": "hCtjygkIHwAN9vs4"
                            },
                            "value": "20",
                            "timestamp": 1600096965.489
                        }
                    ]
                }
            ]
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/query_exemplars")]
pub async fn query_exemplars_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestRangeQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    query_range(
        &org_id.into_inner(),
        req.into_inner(),
        &user_email.user_id,
        in_req,
        true,
    )
    .await
}

#[post("/{org_id}/prometheus/api/v1/query_exemplars")]
pub async fn query_exemplars_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestRangeQuery>,
    web::Form(form): web::Form<config::meta::promql::RequestRangeQuery>,
    Headers(user_email): Headers<UserEmail>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let req = if form.query.is_some() {
        form
    } else {
        req.into_inner()
    };
    query_range(&org_id.into_inner(), req, &user_email.user_id, in_req, true).await
}

async fn query_range(
    org_id: &str,
    req: config::meta::promql::RequestRangeQuery,
    user_email: &str,
    in_req: HttpRequest,
    query_exemplars: bool,
) -> Result<HttpResponse, Error> {
    let cfg = config::get_config();
    let http_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
        tracing::info_span!(
            "/api/{org_id}/prometheus/api/v1/query_range",
            org_id = org_id.to_string()
        )
    } else {
        tracing::Span::none()
    };
    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    #[cfg(feature = "enterprise")]
    {
        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::db::org_users::get_cached_user_org,
        };

        if let Err(e) = crate::service::search::check_search_allowed(org_id, None) {
            return Ok(
                HttpResponse::TooManyRequests().json(MetaHttpResponse::error(
                    http::StatusCode::TOO_MANY_REQUESTS,
                    e.to_string(),
                )),
            );
        }

        let ast = match parser::parse(&req.query.clone().unwrap_or_default()) {
            Ok(v) => v,
            Err(e) => {
                log::error!("[trace_id: {trace_id}] parse promql error: {e}");
                return Ok(HttpResponse::BadRequest().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_bad_data(
                        e.to_string(),
                        Some(trace_id),
                    ),
                ));
            }
        };
        let mut visitor = promql::name_visitor::MetricNameVisitor::default();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();

        if !is_root_user(user_email) {
            let stream_type_str = StreamType::Metrics.as_str();
            for name in visitor.name {
                let user: config::meta::user::User =
                    get_cached_user_org(org_id, user_email).unwrap();
                if user.is_external
                    && !crate::handler::http::auth::validator::check_permissions(
                        user_email,
                        AuthExtractor {
                            auth: "".to_string(),
                            method: "GET".to_string(),
                            o2_type: format!(
                                "{}:{}",
                                OFGA_MODELS
                                    .get(stream_type_str)
                                    .map_or(stream_type_str, |model| model.key),
                                name
                            ),
                            org_id: org_id.to_string(),
                            bypass_check: false,
                            parent_id: "".to_string(),
                        },
                        user.role,
                        user.is_external,
                    )
                    .await
                {
                    return Ok(MetaHttpResponse::forbidden("Unauthorized Access"));
                }
            }
        }
    }

    let start = match req.start {
        None => now_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {e}");
                return Ok(HttpResponse::BadRequest().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_bad_data(
                        e.to_string(),
                        Some(trace_id),
                    ),
                ));
            }
        },
    };
    let end = match req.end {
        None => now_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {e}");
                return Ok(HttpResponse::BadRequest().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_bad_data(
                        e.to_string(),
                        Some(trace_id),
                    ),
                ));
            }
        },
    };
    let mut step = match req.step {
        None => 0,
        Some(v) => match parse_milliseconds(&v) {
            Ok(v) => (v * 1_000) as i64,
            Err(e) => {
                log::error!("parse time error: {e}");
                return Ok(HttpResponse::BadRequest().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_bad_data(
                        e.to_string(),
                        Some(trace_id),
                    ),
                ));
            }
        },
    };
    if step == 0 {
        step = promql::round_step((end - start) / promql::MAX_DATA_POINTS);
    }
    if step < promql::micros(promql::MINIMAL_INTERVAL) {
        step = promql::micros(promql::MINIMAL_INTERVAL);
    }

    let timeout = search_timeout(req.timeout);

    let search_req = promql::MetricsQueryRequest {
        query: req.query.unwrap_or_default(),
        start,
        end,
        step,
        query_exemplars,
        use_cache: req.use_cache,
    };
    if let Some(use_streaming) = req.use_streaming
        && use_streaming
        && !query_exemplars
    {
        search_streaming(&trace_id, org_id, search_req, user_email, timeout).await
    } else {
        search(&trace_id, org_id, search_req, user_email, timeout).await
    }
}

/// prometheus query metric metadata

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-metric-metadata
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusMetadata",
    summary = "Get metric metadata",
    description = "Retrieves metadata information about metrics including their type, help text, and units. Provides essential information for understanding metric semantics and proper usage in queries and visualizations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("limit" = String, Query, description = "Maximum number of metrics to return"),
        ("metric" = Option<String>, Query, description = "A metric name to filter metadata for. All metric metadata is retrieved if left empty"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status": "success",
            "data": {
              "cortex_ring_tokens": [
                {
                  "type": "gauge",
                  "help": "Number of tokens in the ring",
                  "unit": ""
                }
              ],
              "http_requests_total": [
                {
                  "type": "counter",
                  "help": "Number of HTTP requests",
                  "unit": ""
                },
                {
                  "type": "counter",
                  "help": "Amount of HTTP requests",
                  "unit": ""
                }
              ]
            }
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/metadata")]
pub async fn metadata(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestMetadata>,
) -> Result<HttpResponse, Error> {
    Ok(
        match metrics::prom::get_metadata(&org_id, req.into_inner()).await {
            Ok(resp) => {
                HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(resp, None))
            }
            Err(err) => {
                log::error!("get_metadata failed: {err}");
                HttpResponse::InternalServerError().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_internal(
                        err.to_string(),
                        None,
                    ),
                )
            }
        },
    )
}

/// prometheus finding series by label matchers

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#finding-series-by-label-matchers
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusSeries",
    summary = "Find metric series",
    description = "Finds time series that match given label matchers. Returns the unique combinations of metric names and labels that exist in the specified time range. Useful for discovering available metrics and their label combinations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("match[]" = String, Query, description = "<series_selector>: Series selector argument that selects the series to return"),
        ("start" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: Start timestamp"),
        ("end" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: End timestamp"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status" : "success",
            "data" : [
               {
                  "__name__" : "up",
                  "job" : "prometheus",
                  "instance" : "localhost:9090"
               },
               {
                  "__name__" : "up",
                  "job" : "node",
                  "instance" : "localhost:9091"
               },
               {
                  "__name__" : "process_start_time_seconds",
                  "job" : "prometheus",
                  "instance" : "localhost:9090"
               }
            ]
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/series")]
pub async fn series_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestSeries>,
    Headers(user_email): Headers<UserEmail>,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    series(&org_id, req.into_inner(), &user_email.user_id, _in_req).await
}

#[post("/{org_id}/prometheus/api/v1/series")]
pub async fn series_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestSeries>,
    Headers(user_email): Headers<UserEmail>,
    _in_req: HttpRequest,
    web::Form(form): web::Form<config::meta::promql::RequestSeries>,
) -> Result<HttpResponse, Error> {
    let req = if form.matcher.is_some() || form.start.is_some() || form.end.is_some() {
        form
    } else {
        req.into_inner()
    };
    series(&org_id, req, &user_email.user_id, _in_req).await
}

async fn series(
    org_id: &str,
    req: config::meta::promql::RequestSeries,
    _user_email: &str,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let config::meta::promql::RequestSeries {
        matcher,
        start,
        end,
    } = req;
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(
                config::meta::promql::ApiFuncResponse::<()>::err_bad_data(e, None),
            ));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = crate::service::search::check_search_allowed(org_id, None) {
            return Ok(
                HttpResponse::TooManyRequests().json(MetaHttpResponse::error(
                    http::StatusCode::TOO_MANY_REQUESTS,
                    e.to_string(),
                )),
            );
        }
    }

    #[cfg(feature = "enterprise")]
    {
        use crate::{
            common::utils::auth::{AuthExtractor, is_root_user},
            service::db::org_users::get_cached_user_org,
        };

        let metric_name = match selector
            .as_ref()
            .and_then(metrics::prom::try_into_metric_name)
        {
            Some(name) => name,
            None => "".to_string(),
        };

        if !is_root_user(_user_email) {
            let user: config::meta::user::User = get_cached_user_org(org_id, _user_email).unwrap();
            let stream_type_str = StreamType::Metrics.as_str();
            if user.is_external
                && !crate::handler::http::auth::validator::check_permissions(
                    _user_email,
                    AuthExtractor {
                        auth: "".to_string(),
                        method: "GET".to_string(),
                        o2_type: format!(
                            "{}:{}",
                            OFGA_MODELS
                                .get(stream_type_str)
                                .map_or(stream_type_str, |model| model.key),
                            metric_name
                        ),
                        org_id: org_id.to_string(),
                        bypass_check: false,
                        parent_id: "".to_string(),
                    },
                    user.role,
                    user.is_external,
                )
                .await
            {
                return Ok(MetaHttpResponse::forbidden("Unauthorized Access"));
            }
        }
    }

    Ok(
        match metrics::prom::get_series(org_id, selector, start, end).await {
            Ok(resp) => {
                HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(resp, None))
            }
            Err(err) => {
                log::error!("get_series failed: {err}");
                HttpResponse::InternalServerError().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_internal(
                        err.to_string(),
                        None,
                    ),
                )
            }
        },
    )
}

/// prometheus getting label names

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#getting-label-names
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusLabels",
    summary = "Get metric label names",
    description = "Returns a list of label names available in the metric data within the specified time range. Optionally filter by series selector to get labels for specific metrics. Useful for building dynamic queries and understanding data structure.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("match[]" = String, Query, description = "Series selector argument that selects the series from which to read the label names"),
        ("start" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: Start timestamp"),
        ("end" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: End timestamp"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status": "success",
            "data": [
                "__name__",
                "call",
                "code",
                "config",
                "dialer_name",
                "endpoint",
                "event",
                "goversion",
                "handler",
                "instance",
                "interval",
                "job",
                "le",
                "listener_name",
                "name",
                "quantile",
                "reason",
                "role",
                "scrape_job",
                "slice",
                "version"
            ]
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/labels")]
pub async fn labels_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestLabels>,
) -> Result<HttpResponse, Error> {
    labels(&org_id, req.into_inner()).await
}

#[post("/{org_id}/prometheus/api/v1/labels")]
pub async fn labels_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestLabels>,
    web::Form(form): web::Form<config::meta::promql::RequestLabels>,
) -> Result<HttpResponse, Error> {
    let req = if form.matcher.is_some() || form.start.is_some() || form.end.is_some() {
        form
    } else {
        req.into_inner()
    };
    labels(&org_id, req).await
}

async fn labels(
    org_id: &str,
    req: config::meta::promql::RequestLabels,
) -> Result<HttpResponse, Error> {
    let config::meta::promql::RequestLabels {
        matcher,
        start,
        end,
    } = req;
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(
                config::meta::promql::ApiFuncResponse::<()>::err_bad_data(e, None),
            ));
        }
    };
    Ok(
        match metrics::prom::get_labels(org_id, selector, start, end).await {
            Ok(resp) => {
                HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(resp, None))
            }
            Err(err) => {
                log::error!("get_labels failed: {err}");
                HttpResponse::InternalServerError().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_internal(
                        err.to_string(),
                        None,
                    ),
                )
            }
        },
    )
}

/// prometheus query label values

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-label-values
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusLabelValues",
    summary = "Get label values",
    description = "Returns all possible values for a specific label name within the specified time range. Optionally filter by series selector to get values for specific metrics. Essential for building filters and understanding label cardinality.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("label_name" = String, Path, description = "Label name"),
        ("match[]" = String, Query, description = "Series selector argument that selects the series from which to read the label values"),
        ("start" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: Start timestamp"),
        ("end" = Option<String>, Query, description = "<rfc3339 | unix_timestamp>: End timestamp"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status" : "success",
            "data" : [
               "node",
               "prometheus"
            ]
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/label/{label_name}/values")]
pub async fn label_values(
    path: web::Path<(String, String)>,
    req: web::Query<config::meta::promql::RequestLabelValues>,
) -> Result<HttpResponse, Error> {
    let (org_id, label_name) = path.into_inner();
    let config::meta::promql::RequestLabelValues {
        matcher,
        start,
        end,
    } = req.into_inner();
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(
                config::meta::promql::ApiFuncResponse::<()>::err_bad_data(e, None),
            ));
        }
    };
    Ok(
        match metrics::prom::get_label_values(&org_id, label_name, selector, start, end).await {
            Ok(resp) => {
                HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(resp, None))
            }
            Err(err) => {
                log::error!("get_label_values failed: {err}");
                HttpResponse::InternalServerError().json(
                    config::meta::promql::ApiFuncResponse::<()>::err_internal(
                        err.to_string(),
                        None,
                    ),
                )
            }
        },
    )
}

fn validate_metadata_params(
    matcher: Option<String>,
    start: Option<String>,
    end: Option<String>,
) -> Result<(Option<parser::VectorSelector>, i64, i64), String> {
    let selector = match matcher {
        None => None,
        Some(matcher) => match parser::parse(&matcher) {
            Err(err) => {
                let err = format!("parse promql error: {err}");
                log::error!("{err}");
                return Err(err);
            }
            Ok(parser::Expr::VectorSelector(sel)) => {
                let err = if sel.name.is_none()
                    && sel
                        .matchers
                        .find_matchers(config::meta::promql::NAME_LABEL)
                        .is_empty()
                {
                    Some("match[] argument must start with a metric name, e.g. `match[]=up`")
                } else if sel.offset.is_some() {
                    Some("match[]: unexpected offset modifier")
                } else if sel.at.is_some() {
                    Some("match[]: unexpected @ modifier")
                } else {
                    None
                };
                if let Some(err) = err {
                    log::error!("{err}");
                    return Err(err.to_owned());
                }
                Some(sel)
            }
            Ok(_expr) => {
                let err = "vector selector expected";
                log::error!("{err}");
                return Err(err.to_owned());
            }
        },
    };
    let start = if let Some(start) = start
        && !start.is_empty()
    {
        parse_str_to_timestamp_micros(&start).map_err(|e| e.to_string())?
    } else {
        0
    };
    let end = if let Some(end) = end
        && !end.is_empty()
    {
        parse_str_to_timestamp_micros(&end).map_err(|e| e.to_string())?
    } else {
        now_micros()
    };
    Ok((selector, start, end))
}

/// prometheus formatting query expressions

// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#formatting-query-expressions
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusFormatQuery",
    summary = "Format Prometheus query",
    description = "Formats and prettifies a Prometheus query expression. Returns the query in a standardized, readable format which helps with query validation, debugging, and ensuring consistent query formatting across applications.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("query" = String, Query, description = "Prometheus expression query string."),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "status" : "success",
            "data" : "foo / bar"
        })),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    )
)]
#[get("/{org_id}/prometheus/api/v1/format_query")]
pub async fn format_query_get(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestFormatQuery>,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    format_query(&org_id, &req.query, _in_req)
}

#[post("/{org_id}/prometheus/api/v1/format_query")]
pub async fn format_query_post(
    org_id: web::Path<String>,
    req: web::Query<config::meta::promql::RequestFormatQuery>,
    web::Form(form): web::Form<config::meta::promql::RequestFormatQuery>,
    _in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let query = if !form.query.is_empty() {
        &form.query
    } else {
        &req.query
    };
    format_query(&org_id, query, _in_req)
}

fn format_query(_org_id: &str, query: &str, _in_req: HttpRequest) -> Result<HttpResponse, Error> {
    let expr = match promql_parser::parser::parse(query) {
        Ok(expr) => expr,
        Err(err) => {
            return Ok(HttpResponse::BadRequest().json(
                config::meta::promql::ApiFuncResponse::<()>::err_bad_data(err, None),
            ));
        }
    };
    Ok(
        HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(
            expr.prettify(),
            None,
        )),
    )
}

fn search_timeout(timeout: Option<String>) -> i64 {
    match timeout {
        None => 0,
        Some(v) => match parse_milliseconds(&v) {
            Ok(v) => (v / 1000) as i64, // seconds
            Err(e) => {
                log::error!("parse timeout error: {e}");
                0
            }
        },
    }
}

async fn search(
    trace_id: &str,
    org_id: &str,
    req: promql::MetricsQueryRequest,
    user_email: &str,
    timeout: i64,
) -> Result<HttpResponse, Error> {
    match promql::search::search(trace_id, org_id, &req, user_email, timeout).await {
        Ok(data) if !req.query_exemplars => Ok(HttpResponse::Ok().json(
            config::meta::promql::ApiFuncResponse::ok(
                config::meta::promql::QueryResult {
                    result_type: data.get_type().to_string(),
                    result: data,
                },
                Some(trace_id.to_string()),
            ),
        )),
        Ok(data) => Ok(
            HttpResponse::Ok().json(config::meta::promql::ApiFuncResponse::ok(
                data,
                Some(trace_id.to_string()),
            )),
        ),
        Err(err) => {
            let err = match err {
                errors::Error::ErrorCode(code) => code.get_error_detail(),
                _ => err.to_string(),
            };
            Ok(HttpResponse::BadRequest().json(
                config::meta::promql::ApiFuncResponse::<()>::err_bad_data(
                    err,
                    Some(trace_id.to_string()),
                ),
            ))
        }
    }
}

async fn search_streaming(
    trace_id: &str,
    org_id: &str,
    req: promql::MetricsQueryRequest,
    user_email: &str,
    timeout: i64,
) -> Result<HttpResponse, Error> {
    let partitions = generate_search_partition(&req.query, req.start, req.end, req.step);
    log::info!(
        "[HTTP2_STREAM PromQL trace_id {trace_id}] Generated {} partitions for streaming search",
        partitions.len()
    );
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<StreamResponses, infra::errors::Error>>(
        partitions.len(),
    );
    // Spawn the search task in a separate task
    let req_trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let user_email = user_email.to_string();
    actix_web::rt::spawn(async move {
        let total_partitions = partitions.len();
        for (i, (start, end)) in partitions.into_iter().enumerate() {
            let mut req = req.clone();
            req.start = start;
            req.end = end;
            match promql::search::search(&req_trace_id, &org_id, &req, &user_email, timeout).await {
                Ok(data) => {
                    let res = StreamResponses::PromqlResponse {
                        data: config::meta::promql::QueryResult {
                            result_type: data.get_type().to_string(),
                            result: data,
                        },
                    };
                    if tx.send(Ok(res)).await.is_err() {
                        log::warn!(
                            "[HTTP2_STREAM PromQL trace_id {req_trace_id}] Sender is closed, stop sending data to client",
                        );
                        break;
                    }
                }
                Err(err) => {
                    log::error!(
                        "[HTTP2_STREAM PromQL trace_id {req_trace_id}] Error in search: {err}"
                    );
                    let err_res = match err {
                        infra::errors::Error::ErrorCode(ref code) => {
                            let message = code.get_message();
                            let error_detail = code.get_error_detail();
                            let http_response = map_error_to_http_response(&err, None);
                            StreamResponses::Error {
                                code: http_response.status().into(),
                                message,
                                error_detail: Some(error_detail),
                            }
                        }
                        _ => StreamResponses::Error {
                            code: 500,
                            message: err.to_string(),
                            error_detail: None,
                        },
                    };
                    if tx.send(Ok(err_res)).await.is_err() {
                        log::warn!(
                            "[HTTP2_STREAM PromQL trace_id {req_trace_id}] Sender is closed, stop sending error to client",
                        );
                        break;
                    }
                }
            }

            // Send progress
            let percent = ((i + 1) * 100) / total_partitions;
            if tx
                .send(Ok(StreamResponses::Progress { percent }))
                .await
                .is_err()
            {
                log::warn!(
                    "[HTTP2_STREAM PromQL trace_id {req_trace_id}] Sender is closed, stop sending progress event to client",
                );
                break;
            }
        }
        // Send Done
        if tx.send(Ok(StreamResponses::Done)).await.is_err() {
            log::warn!(
                "[HTTP2_STREAM PromQL trace_id {req_trace_id}] Sender is closed, stop sending done event to client",
            );
        }
    });

    // Return streaming response
    let trace_id = trace_id.to_string();
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).flat_map(move |result| {
        let chunks_iter = match result {
            Ok(v) => v.to_chunks(),
            Err(err) => {
                log::error!(
                    "[HTTP2_STREAM PromQL trace_id {trace_id}] Error in search stream: {err}"
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

        // Convert the iterator to a stream only once
        futures::stream::iter(chunks_iter)
    });

    Ok(HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(stream))
}

/// Generate search partitions based on the query's lookback window and step
/// The mini partition should be at least twice the size of the lookback window to avoid redundant
/// computations on the same data.
fn generate_search_partition(query: &str, start: i64, end: i64, step: i64) -> Vec<(i64, i64)> {
    if start >= end {
        return vec![(start, end)];
    }
    let mut lookback_window = get_max_lookback_window(query);
    if lookback_window == 0 {
        lookback_window = promql::micros(promql::DEFAULT_LOOKBACK);
    }
    let mini_step = std::cmp::max(lookback_window * 2, step);
    let interval = generate_aggregation_search_interval(start, end, CardinalityLevel::Low);
    let partition_step = interval.get_interval_microseconds();
    if partition_step <= mini_step ||end - start <= mini_step {
        return vec![(start, end)];
    }

    let mut groups = Vec::new();
    let mut group_start = start;
    while group_start < end {
        let group_end = std::cmp::min(group_start + partition_step, end);
        groups.push((group_start, group_end));
        // because of each partition will return data point with start and end timestamp,
        // so the next partition should start from next data point after current end
        group_start = group_end + step;
    }
    groups
}

fn get_max_lookback_window(query: &str) -> i64 {
    let ast = match promql_parser::parser::parse(query) {
        Ok(ast) => ast,
        Err(_) => {
            return 0;
        }
    };
    let mut visitor = MaxLookbackWindowVisitor::default();
    if let Err(err) = promql_parser::util::walk_expr(&mut visitor, &ast) {
        log::error!("visit promql expr error: {err}");
        return 0;
    }
    visitor.get_range_micros()
}

use promql_parser::parser::Expr;

struct MaxLookbackWindowVisitor {
    range: std::time::Duration,
}

impl MaxLookbackWindowVisitor {
    fn new() -> Self {
        MaxLookbackWindowVisitor {
            range: std::time::Duration::from_micros(0),
        }
    }

    fn get_range_micros(&self) -> i64 {
        promql::micros(self.range)
    }
}

impl Default for MaxLookbackWindowVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl promql_parser::util::ExprVisitor for MaxLookbackWindowVisitor {
    type Error = &'static str;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        match expr {
            Expr::VectorSelector(_) => {
                return Ok(false);
            }
            Expr::MatrixSelector(ms) => {
                if ms.range > self.range {
                    self.range = ms.range;
                }
                return Ok(false);
            }
            Expr::NumberLiteral(_) | Expr::StringLiteral(_) => return Ok(false),
            _ => (),
        }
        Ok(true)
    }
}
