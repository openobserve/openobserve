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
use config::{ider, CONFIG};
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use prost::Message;
use tonic::Request;

use super::flusher;
use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, traces::ExportTraceServiceResponse},
    service::traces::flusher::{ExportRequest, WriteBufferFlusher},
};

pub async fn traces_proto(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
    flusher: web::Data<WriteBufferFlusher>,
) -> Result<HttpResponse, Error> {
    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");
    let request = tonic::Request::new(request);

    let (mut metadata, extensions, message) = request.into_parts();
    let session_id = ider::uuid();
    metadata.insert("session_id", session_id.parse().unwrap());
    metadata.insert("thread_id", tonic::metadata::MetadataValue::from(thread_id));
    metadata.insert(
        CONFIG.grpc.org_header_key.as_str(),
        org_id.to_string().parse().unwrap(),
    );
    if let Some(stream_name) = in_stream_name {
        metadata.insert(
            CONFIG.grpc.stream_header_key.as_str(),
            stream_name.to_string().parse().unwrap(),
        );
    };

    let request = ExportRequest::GrpcExportTraceServiceRequest(Request::from_parts(
        metadata, extensions, message,
    ));

    hanlde_resp(flusher, request).await
}

pub async fn traces_json(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
    flusher: web::Data<WriteBufferFlusher>,
) -> Result<HttpResponse, Error> {
    let in_stream_name = in_stream_name.map(|name| name.to_string());

    let request = ExportRequest::HttpJsonExportTraceServiceRequest((
        org_id.to_string(),
        thread_id,
        body,
        in_stream_name,
    ));

    hanlde_resp(flusher, request).await
}

async fn hanlde_resp(
    flusher: web::Data<WriteBufferFlusher>,
    request: ExportRequest,
) -> Result<HttpResponse, Error> {
    match flusher.write(request).await {
        Ok(resp) => match resp {
            flusher::BufferedWriteResult::Success(_) => {
                log::info!("flusher::BufferedWriteResult::Success");
                Ok(HttpResponse::Ok().json(ExportTraceServiceResponse::default()))
            }
            flusher::BufferedWriteResult::Error(e) => {
                log::info!("flusher::BufferedWriteResult::Success");
                Ok(
                    HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                        http::StatusCode::SERVICE_UNAVAILABLE.into(),
                        e.to_string(),
                    )),
                )
            }
        },
        Err(e) => {
            log::error!("flusher write error {}", e);
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
