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

use config::CONFIG;
use opentelemetry_proto::tonic::collector::trace::v1::{
    trace_service_server::TraceService, ExportTraceServiceRequest, ExportTraceServiceResponse,
};
use tonic::{codegen::*, Response, Status};

use crate::service::traces::{
    flusher,
    flusher::{ExportRequest, WriteBufferFlusher},
};

pub struct TraceServer {
    pub flusher: Arc<WriteBufferFlusher>,
}

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

        // let in_req = request.into_inner();
        let org_id = metadata.get(&CONFIG.grpc.org_header_key);
        if org_id.is_none() {
            println!("{:?}", org_id);
            return Err(Status::invalid_argument(msg));
        }

        let thread_id = metadata.get("thread_id");
        let mut in_thread_id: usize = 0;
        if let Some(thread_id) = thread_id {
            in_thread_id = thread_id.to_str().unwrap().parse::<usize>().unwrap();
        };

        let stream_name = metadata.get(&CONFIG.grpc.stream_header_key);
        let mut in_stream_name: Option<String> = None;
        if let Some(stream_name) = stream_name {
            in_stream_name = Some(stream_name.to_str().unwrap().to_string());
        };

        let request = ExportRequest::GrpcExportTraceServiceRequest((
            org_id.unwrap().to_str().unwrap().to_string(),
            in_thread_id,
            request,
            in_stream_name,
        ));

        match self.flusher.write(request).await {
            Ok(resp) => match resp {
                flusher::BufferedWriteResult::Success(_) => {
                    Ok(Response::new(ExportTraceServiceResponse {
                        partial_success: None,
                    }))
                }
                flusher::BufferedWriteResult::Error(e) => {
                    log::error!("flusher::BufferedWriteResult::Error {e}");
                    Err(Status::internal(e.to_string()))
                }
            },
            Err(e) => {
                log::error!("flusher write error {}", e);
                Err(Status::internal(e.to_string()))
            }
        }
    }
}
