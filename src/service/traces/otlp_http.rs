// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{http, web, HttpResponse};
use bytes::BytesMut;
use opentelemetry_proto::tonic::collector::trace::v1::{
    ExportTracePartialSuccess, ExportTraceServiceRequest,
};
use prost::Message;

use super::flusher;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::traces::{
        flusher::{ExportRequest, WriteBufferFlusher},
        validator::{validate_json_trace_request, validate_trace_request},
    },
};

pub async fn traces_proto(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: &str,
    flusher: web::Data<WriteBufferFlusher>,
) -> Result<HttpResponse, Error> {
    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");

    // ((org_id, thread_id, stream_name, entry, trigger, distinct_value, trace_index,
    // partical_success))
    let (records, trigger, distinct_value, trace_index, partial_success) =
        match validate_trace_request(org_id, request, Some(in_stream_name)).await {
            Ok(data) => data,
            Err(e) => {
                return Ok(
                    HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                        http::StatusCode::SERVICE_UNAVAILABLE.into(),
                        e.to_string(),
                    )),
                );
            }
        };

    let entry: flusher::ExportRequestInnerEntry = (
        org_id.to_string(),
        thread_id,
        in_stream_name.to_string(),
        records,
        trigger,
        distinct_value,
        trace_index,
        partial_success,
        true,
    );

    hanlde_resp(flusher, ExportRequest::TraceEntry(entry), true).await
}

pub async fn traces_json(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: &str,
    flusher: web::Data<WriteBufferFlusher>,
) -> Result<HttpResponse, Error> {
    let (records, trigger, distinct_value, trace_index, partial_success) =
        match validate_json_trace_request(org_id, body, Some(in_stream_name)).await {
            Ok(data) => data,
            Err(e) => {
                return Ok(
                    HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                        http::StatusCode::SERVICE_UNAVAILABLE.into(),
                        e.to_string(),
                    )),
                );
            }
        };

    let entry: flusher::ExportRequestInnerEntry = (
        org_id.to_string(),
        thread_id,
        in_stream_name.to_string(),
        records,
        trigger,
        distinct_value,
        trace_index,
        partial_success,
        false,
    );

    hanlde_resp(flusher, ExportRequest::TraceEntry(entry), false).await
}

async fn hanlde_resp(
    flusher: web::Data<WriteBufferFlusher>,
    request: ExportRequest,
    is_protobuf: bool,
) -> Result<HttpResponse, Error> {
    match flusher.write(request).await {
        Ok(resp) => match resp {
            flusher::BufferedWriteResult::Success(r) => match r.partial_success {
                None => {
                    if is_protobuf {
                        let res = opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceResponse::default();
                        let mut out = BytesMut::with_capacity(res.encoded_len());
                        res.encode(&mut out).expect("Out of memory");
                        Ok(HttpResponse::Ok()
                            .status(http::StatusCode::OK)
                            .content_type("application/x-protobuf")
                            .body(out))
                    } else {
                        Ok(HttpResponse::Ok().json(r))
                    }
                }
                Some(ref success) => {
                    if is_protobuf {
                        let res = opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceResponse {
                            partial_success: Some(ExportTracePartialSuccess {
                                rejected_spans: success.rejected_spans,
                                error_message: success.error_message.clone(),
                            })
                        };
                        let mut out = BytesMut::with_capacity(res.encoded_len());
                        res.encode(&mut out).expect("Out of memory");
                        Ok(HttpResponse::Ok()
                            .status(http::StatusCode::OK)
                            .content_type("application/x-protobuf")
                            .body(out))
                    } else {
                        Ok(HttpResponse::PartialContent().json(r))
                    }
                }
            },
            flusher::BufferedWriteResult::Error(e) => {
                log::info!("flusher::BufferedWriteResult::Error e: {e}");
                Ok(
                    HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                        http::StatusCode::SERVICE_UNAVAILABLE.into(),
                        e.to_string(),
                    )),
                )
            }
        },
        Err(e) => {
            log::error!("flusher write error {e}");
            Ok(
                HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE.into(),
                    e.to_string(),
                )),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::service::ingestion::grpc::get_val_for_attr;

    #[test]
    fn test_get_val_for_attr() {
        let in_val = 10.00;
        let input = json!({ "key": in_val });
        let resp = get_val_for_attr(input);
        assert_eq!(resp.as_str().unwrap(), in_val.to_string());
    }
}
