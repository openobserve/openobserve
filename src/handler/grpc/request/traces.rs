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

use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use opentelemetry_proto::tonic::collector::trace::v1::{
    trace_service_server::TraceService, ExportTraceServiceResponse,
};
use tonic::Status;
use tonic::{codegen::*, Response};

use crate::common::infra::config::CONFIG;
use crate::service::traces::handle_trace_request;

#[derive(Default)]
pub struct TraceServer {}
#[async_trait]
impl TraceService for TraceServer {
    async fn export(
        &self,
        request: tonic::Request<ExportTraceServiceRequest>,
    ) -> Result<tonic::Response<ExportTraceServiceResponse>, tonic::Status> {
        let metadata = request.metadata().clone();
        let msg = format!(
            "Please specify organization id with header key '{}' ",
            &CONFIG.grpc.org_header_key
        );
        if !metadata.contains_key(&CONFIG.grpc.org_header_key) {
            return Err(Status::invalid_argument(msg));
        }

        let in_req = request.into_inner();
        let org_id = metadata.get(&CONFIG.grpc.org_header_key);
        if org_id.is_none() {
            return Err(Status::invalid_argument(msg));
        }

        let stream_name = metadata.get(&CONFIG.grpc.stream_header_key);
        let mut in_stream_name: Option<&str> = None;
        if let Some(stream_name) = stream_name {
            in_stream_name = Some(stream_name.to_str().unwrap());
        };

        let resp = handle_trace_request(
            org_id.unwrap().to_str().unwrap(),
            0,
            in_req,
            true,
            in_stream_name,
        )
        .await;
        if resp.is_ok() {
            return Ok(Response::new(ExportTraceServiceResponse {
                partial_success: None,
            }));
        } else {
            Err(Status::internal(resp.err().unwrap().to_string()))
        }
    }
}
