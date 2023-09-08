// Copyright 2023 Zinc Labs Inc.
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

use crate::{
    common::{
        infra::{cluster, config::CONFIG, metrics},
        meta::{
            self,
            alert::{Alert, Trigger},
            http::HttpResponse as MetaHttpResponse,
            prom::{self, MetricType, HASH_LABEL, NAME_LABEL, VALUE_LABEL},
            stream::{PartitioningDetails, StreamParams},
            usage::UsageType,
            StreamType,
        },
        utils::{flatten, json},
    },
    handler::http::request::CONTENT_TYPE_JSON,
    service::{
        db,
        ingestion::{
            chk_schema_by_record,
            grpc::{get_exemplar_val, get_metric_val, get_val},
            write_file,
        },
        schema::{set_schema_metadata, stream_schema_exists},
        stream::unwrap_partition_time_level,
        usage::report_request_usage_stats,
    },
};
use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use bytes::BytesMut;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::metrics::v1::metric::Data;
use opentelemetry_proto::tonic::{
    collector::metrics::v1::{ExportMetricsServiceRequest, ExportMetricsServiceResponse},
    metrics::v1::*,
};
use prost::Message;

use super::otlp_grpc::handle_grpc_request;

pub async fn metrics_proto_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
) -> Result<HttpResponse, std::io::Error> {
    let request = ExportMetricsServiceRequest::decode(body).expect("Invalid protobuf");
    match handle_grpc_request(org_id, thread_id, request, false).await {
        Ok(res) => Ok(res),
        Err(e) => {
            log::error!("error while handling request: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            )
        }
    }
}

pub async fn metrics_json_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
) -> Result<HttpResponse, std::io::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "Quota exceeded for this organization".to_string(),
        )));
    }

    let start = std::time::Instant::now();

    let reader: Vec<json::Value> = json::from_slice(&body)?;
    println!("metrics reader: {:?}", reader);

    let res = ExportMetricsServiceResponse {
        partial_success: None,
    };
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type(CONTENT_TYPE_JSON)
        .body(out));
}
