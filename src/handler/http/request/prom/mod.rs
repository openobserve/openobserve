// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{get, http, post, web, HttpRequest, HttpResponse};
use promql_parser::parser;
use std::io::Error;

use crate::{
    common::time::{parse_milliseconds, parse_str_to_timestamp_micros},
    infra::errors,
    meta::{self, http::HttpResponse as MetaHttpResponse},
    service::{metrics, promql},
};

/** prometheus remote-write endpoint for metrics */
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusRemoteWrite",
        security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "prometheus WriteRequest", content_type = "application/x-protobuf"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/prometheus/api/v1/write")]
pub async fn remote_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    if content_type == "application/x-protobuf" {
        Ok(
            match metrics::prom::remote_write(&org_id, **thread_id, body).await {
                Ok(_) => HttpResponse::Ok().into(),
                Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            },
        )
    } else {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Bad Request".to_string(),
        )))
    }
}

/** prometheus instant queries */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#instant-queries
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusQuery",
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/query")]
pub async fn query_get(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestQuery>,
) -> Result<HttpResponse, Error> {
    query(&org_id.into_inner(), req.into_inner()).await
}

#[post("/{org_id}/prometheus/api/v1/query")]
pub async fn query_post(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestQuery>,
    web::Form(form): web::Form<meta::prom::RequestQuery>,
) -> Result<HttpResponse, Error> {
    let req = if form.query.is_some() {
        form
    } else {
        req.into_inner()
    };
    query(&org_id.into_inner(), req).await
}

async fn query(org_id: &str, req: meta::prom::RequestQuery) -> Result<HttpResponse, Error> {
    let start = match req.time {
        None => chrono::Utc::now().timestamp_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {}", e);
                return Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                    status: promql::Status::Error,
                    data: None,
                    error_type: Some("bad_data".to_string()),
                    error: Some(e.to_string()),
                }));
            }
        },
    };
    let end = start;

    let req = promql::MetricsQueryRequest {
        query: req.query.unwrap_or_default(),
        start,
        end,
        step: 300_000_000, // 5m
    };

    match promql::search::search(org_id, &req).await {
        Ok(data) => Ok(HttpResponse::Ok().json(promql::QueryResponse {
            status: promql::Status::Success,
            data: Some(promql::QueryResult {
                result_type: data.get_type().to_string(),
                result: data,
            }),
            error_type: None,
            error: None,
        })),
        Err(err) => {
            let err = match err {
                errors::Error::ErrorCode(code) => code.get_error_detail(),
                _ => err.to_string(),
            };
            Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                status: promql::Status::Error,
                data: None,
                error_type: Some("bad_data".to_string()),
                error: Some(err),
            }))
        }
    }
}

/** prometheus range queries */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#range-queries
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusRangeQuery",
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/query_range")]
pub async fn query_range_get(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestRangeQuery>,
) -> Result<HttpResponse, Error> {
    query_range(&org_id.into_inner(), req.into_inner()).await
}

#[post("/{org_id}/prometheus/api/v1/query_range")]
pub async fn query_range_post(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestRangeQuery>,
    web::Form(form): web::Form<meta::prom::RequestRangeQuery>,
) -> Result<HttpResponse, Error> {
    let req = if form.query.is_some() {
        form
    } else {
        req.into_inner()
    };
    query_range(&org_id.into_inner(), req).await
}

async fn query_range(
    org_id: &str,
    req: meta::prom::RequestRangeQuery,
) -> Result<HttpResponse, Error> {
    let start = match req.start {
        None => chrono::Utc::now().timestamp_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {}", e);
                return Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                    status: promql::Status::Error,
                    data: None,
                    error_type: Some("bad_data".to_string()),
                    error: Some(e.to_string()),
                }));
            }
        },
    };
    let end = match req.end {
        None => chrono::Utc::now().timestamp_micros(),
        Some(v) => match parse_str_to_timestamp_micros(&v) {
            Ok(v) => v,
            Err(e) => {
                log::error!("parse time error: {}", e);
                return Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                    status: promql::Status::Error,
                    data: None,
                    error_type: Some("bad_data".to_string()),
                    error: Some(e.to_string()),
                }));
            }
        },
    };
    let mut step = match req.step {
        None => 0,
        Some(v) => match parse_milliseconds(&v) {
            Ok(v) => (v * 1_000) as i64,
            Err(e) => {
                log::error!("parse time error: {}", e);
                return Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                    status: promql::Status::Error,
                    data: None,
                    error_type: Some("bad_data".to_string()),
                    error: Some(e.to_string()),
                }));
            }
        },
    };
    if step == 0 {
        // Grafana: Time range / max data points = step
        step = (end - start) / promql::MAX_DATA_POINTS;
    }
    if step < promql::micros(promql::MINIMAL_INTERVAL) {
        step = promql::micros(promql::MINIMAL_INTERVAL);
    }

    let req = promql::MetricsQueryRequest {
        query: req.query.unwrap_or_default(),
        start,
        end,
        step,
    };
    match promql::search::search(org_id, &req).await {
        Ok(data) => Ok(HttpResponse::Ok().json(promql::QueryResponse {
            status: promql::Status::Success,
            data: Some(promql::QueryResult {
                result_type: data.get_type().to_string(),
                result: data,
            }),
            error_type: None,
            error: None,
        })),
        Err(err) => {
            let err = match err {
                errors::Error::ErrorCode(code) => code.get_error_detail(),
                _ => err.to_string(),
            };
            Ok(HttpResponse::BadRequest().json(promql::QueryResponse {
                status: promql::Status::Error,
                data: None,
                error_type: Some("bad_data".to_string()),
                error: Some(err),
            }))
        }
    }
}

/** prometheus query metric metadata */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-metric-metadata
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusMetadata",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("limit" = String, Query, description = "Maximum number of metrics to return"),
        ("metric" = Option<String>, Query, description = "A metric name to filter metadata for. All metric metadata is retrieved if left empty"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/metadata")]
pub async fn metadata(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestMetadata>,
) -> Result<HttpResponse, Error> {
    Ok(
        match metrics::prom::get_metadata(&org_id, req.into_inner()).await {
            Ok(resp) => HttpResponse::Ok().json(promql::ApiFuncResponse::ok(resp)),
            Err(err) => {
                log::error!("get_metadata failed: {err}");
                HttpResponse::InternalServerError()
                    .json(promql::ApiFuncResponse::<()>::err_internal(err.to_string()))
            }
        },
    )
}

/** prometheus finding series by label matchers */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#finding-series-by-label-matchers
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusSeries",
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/series")]
pub async fn series_get(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestSeries>,
) -> Result<HttpResponse, Error> {
    series(&org_id, req.into_inner()).await
}

#[post("/{org_id}/prometheus/api/v1/series")]
pub async fn series_post(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestSeries>,
    web::Form(form): web::Form<meta::prom::RequestSeries>,
) -> Result<HttpResponse, Error> {
    let req = if form.matcher.is_some() || form.start.is_some() || form.end.is_some() {
        form
    } else {
        req.into_inner()
    };
    series(&org_id, req).await
}

async fn series(org_id: &str, req: meta::prom::RequestSeries) -> Result<HttpResponse, Error> {
    let meta::prom::RequestSeries {
        matcher,
        start,
        end,
    } = req;
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(promql::ApiFuncResponse::<()>::err_bad_data(e))
            )
        }
    };
    Ok(
        match metrics::prom::get_series(org_id, selector, start, end).await {
            Ok(resp) => HttpResponse::Ok().json(promql::ApiFuncResponse::ok(resp)),
            Err(err) => {
                log::error!("get_series failed: {err}");
                HttpResponse::InternalServerError()
                    .json(promql::ApiFuncResponse::<()>::err_internal(err.to_string()))
            }
        },
    )
}

/** prometheus getting label names */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#getting-label-names
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusLabels",
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
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
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/labels")]
pub async fn labels_get(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestLabels>,
) -> Result<HttpResponse, Error> {
    labels(&org_id, req.into_inner()).await
}

#[post("/{org_id}/prometheus/api/v1/labels")]
pub async fn labels_post(
    org_id: web::Path<String>,
    req: web::Query<meta::prom::RequestLabels>,
    web::Form(form): web::Form<meta::prom::RequestLabels>,
) -> Result<HttpResponse, Error> {
    let req = if form.matcher.is_some() || form.start.is_some() || form.end.is_some() {
        form
    } else {
        req.into_inner()
    };
    labels(&org_id, req).await
}

async fn labels(org_id: &str, req: meta::prom::RequestLabels) -> Result<HttpResponse, Error> {
    let meta::prom::RequestLabels {
        matcher,
        start,
        end,
    } = req;
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(promql::ApiFuncResponse::<()>::err_bad_data(e))
            )
        }
    };
    Ok(
        match metrics::prom::get_labels(org_id, selector, start, end).await {
            Ok(resp) => HttpResponse::Ok().json(promql::ApiFuncResponse::ok(resp)),
            Err(err) => {
                log::error!("get_labels failed: {err}");
                HttpResponse::InternalServerError()
                    .json(promql::ApiFuncResponse::<()>::err_internal(err.to_string()))
            }
        },
    )
}

/** prometheus query label values */
// refer: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-label-values
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "PrometheusLabelValues",
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse, example = json!({
            "status" : "success",
            "data" : [
               "node",
               "prometheus"
            ]
        })),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/prometheus/api/v1/label/{label_name}/values")]
pub async fn label_values(
    path: web::Path<(String, String)>,
    req: web::Query<meta::prom::RequestLabelValues>,
) -> Result<HttpResponse, Error> {
    let (org_id, label_name) = path.into_inner();
    let meta::prom::RequestLabelValues {
        matcher,
        start,
        end,
    } = req.into_inner();
    let (selector, start, end) = match validate_metadata_params(matcher, start, end) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(promql::ApiFuncResponse::<()>::err_bad_data(e))
            )
        }
    };
    Ok(
        match metrics::prom::get_label_values(&org_id, label_name, selector, start, end).await {
            Ok(resp) => HttpResponse::Ok().json(promql::ApiFuncResponse::ok(resp)),
            Err(err) => {
                log::error!("get_label_values failed: {err}");
                HttpResponse::InternalServerError()
                    .json(promql::ApiFuncResponse::<()>::err_internal(err.to_string()))
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
                        .find_matchers(meta::prom::NAME_LABEL)
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
    let start = if start.is_none() || start.as_ref().unwrap().is_empty() {
        0
    } else {
        parse_str_to_timestamp_micros(&start.unwrap()).map_err(|e| e.to_string())?
    };
    let end = if end.is_none() || end.as_ref().unwrap().is_empty() {
        chrono::Utc::now().timestamp_micros()
    } else {
        parse_str_to_timestamp_micros(&end.unwrap()).map_err(|e| e.to_string())?
    };
    Ok((selector, start, end))
}
