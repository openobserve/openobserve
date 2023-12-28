// Copyright 2023 Zinc Labs Inc.
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

use async_trait::async_trait;
use config::CONFIG;
use opentelemetry_proto::tonic::collector::logs::v1::{
    logs_service_server::LogsService, ExportLogsServiceRequest, ExportLogsServiceResponse,
};
use tonic::{Response, Status};

#[derive(Default)]
pub struct LogsServer;

#[async_trait]
impl LogsService for LogsServer {
    async fn export(
        &self,
        request: tonic::Request<ExportLogsServiceRequest>,
    ) -> Result<tonic::Response<ExportLogsServiceResponse>, tonic::Status> {
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

        match crate::service::logs::otlp_grpc::handle_grpc_request(
            org_id.unwrap().to_str().unwrap(),
            0,
            in_req,
            true,
            in_stream_name,
        )
        .await
        {
            Ok(_) => Ok(Response::new(ExportLogsServiceResponse {
                partial_success: None,
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }
}
