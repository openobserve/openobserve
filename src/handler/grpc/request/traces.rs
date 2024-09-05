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

use opentelemetry_proto::tonic::collector::trace::v1::{
    trace_service_server::TraceService, ExportTraceServiceRequest, ExportTraceServiceResponse,
};
use tonic::{Response, Status};

use crate::service::traces::{handle_trace_request, RequestType};

#[derive(Default)]
pub struct TraceServer;

#[tonic::async_trait]
impl TraceService for TraceServer {
    async fn export(
        &self,
        request: tonic::Request<ExportTraceServiceRequest>,
    ) -> Result<tonic::Response<ExportTraceServiceResponse>, tonic::Status> {
        let cfg = config::get_config();
        let metadata = request.metadata().clone();
        let msg = format!(
            "Please specify organization id with header key '{}' ",
            &cfg.grpc.org_header_key
        );
        if !metadata.contains_key(&cfg.grpc.org_header_key) {
            return Err(Status::invalid_argument(msg));
        }

        let in_req = request.into_inner();
        let org_id = metadata.get(&cfg.grpc.org_header_key);
        if org_id.is_none() {
            return Err(Status::invalid_argument(msg));
        }

        let stream_name = metadata.get(&cfg.grpc.stream_header_key);
        let mut in_stream_name: Option<&str> = None;
        if let Some(stream_name) = stream_name {
            in_stream_name = Some(stream_name.to_str().unwrap());
        };

        let resp = handle_trace_request(
            org_id.unwrap().to_str().unwrap(),
            in_req,
            RequestType::Grpc,
            in_stream_name,
        )
        .await;
        if resp.is_ok() {
            return Ok(Response::new(ExportTraceServiceResponse {
                partial_success: None,
            }));
        } else {
            let err = resp.err().unwrap().to_string();
            log::error!("handle_trace_request err {}", err);
            Err(Status::internal(err))
        }
    }
}
