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
use std::io::Error;

use crate::{meta, service::metrics};

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
#[post("/{org_id}/prometheus/v1/write")]
pub async fn remote_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    if content_type.eq("application/x-protobuf") {
        metrics::prometheus_write_proto(&org_id, thread_id, body).await
    } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Bad Request".to_string(),
            )),
        )
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
#[get("/{org_id}/prometheus/v1/query")]
pub async fn query(
    org_id: web::Path<String>,
    query: web::Query<meta::prom::RequestQuery>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let query = query.into_inner();
    println!("org_id: {}", org_id);
    println!("query.query: {}", query.query);
    println!("query.time: {:?}", query.time);
    println!("query.timeout: {:?}", query.timeout);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
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
#[get("/{org_id}/prometheus/v1/query_range")]
pub async fn query_range(
    org_id: web::Path<String>,
    range_query: web::Query<meta::prom::RequestRangeQuery>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let range_query = range_query.into_inner();
    println!("org_id: {}", org_id);
    println!("query.query: {}", range_query.query);
    println!("query.start: {:?}", range_query.start);
    println!("query.end: {:?}", range_query.end);
    println!("query.step: {:?}", range_query.step);
    println!("query.timeout: {:?}", range_query.timeout);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
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
#[get("/{org_id}/prometheus/v1/metadata")]
pub async fn metadata(
    org_id: web::Path<String>,
    metadata: web::Query<meta::prom::RequestMetadata>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let metadata = metadata.into_inner();
    println!("org_id: {}", org_id);
    println!("query.limit: {}", metadata.limit);
    println!("query.metric: {:?}", metadata.metric);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
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
        ("match" = Vec<String>, Query, description = "<series_selector>: Repeated series selector argument that selects the series to return. At least one match[] argument must be provided"),
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
#[get("/{org_id}/prometheus/v1/series")]
pub async fn series(
    org_id: web::Path<String>,
    series: web::Query<meta::prom::RequestSeries>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let series = series.into_inner();
    println!("org_id: {}", org_id);
    println!("query.match[]: {:?}", series.matches);
    println!("query.start: {:?}", series.start);
    println!("query.end: {:?}", series.end);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
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
        ("match" = Option<Vec<String>>, Query, description = "Repeated series selector argument that selects the series from which to read the label names. Optional"),
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
#[get("/{org_id}/prometheus/v1/labels")]
pub async fn labels(
    org_id: web::Path<String>,
    labels: web::Query<meta::prom::RequestLabels>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let labels = labels.into_inner();
    println!("org_id: {}", org_id);
    println!("query.match[]: {:?}", labels.matches);
    println!("query.start: {:?}", labels.start);
    println!("query.end: {:?}", labels.end);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
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
        ("match" = Option<Vec<String>>, Query, description = "Repeated series selector argument that selects the series from which to read the label names. Optional"),
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
#[get("/{org_id}/prometheus/v1/label/{label_name}/values")]
pub async fn values(
    path: web::Path<(String, String)>,
    values: web::Query<meta::prom::RequestValues>,
) -> Result<HttpResponse, Error> {
    let (org_id, label_name) = path.into_inner();
    let values = values.into_inner();
    println!("org_id: {}", org_id);
    println!("label_name: {}", label_name);
    println!("query.match[]: {:?}", values.matches);
    println!("query.start: {:?}", values.start);
    println!("query.end: {:?}", values.end);
    Ok(HttpResponse::NotImplemented().body("Not Implemented"))
}
