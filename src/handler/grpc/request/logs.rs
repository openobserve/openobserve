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

use config::{meta::otlp::OtlpRequestType, metrics};
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsServiceRequest, ExportLogsServiceResponse, logs_service_server::LogsService,
};
use tonic::{Response, Status};

#[derive(Default)]
pub struct LogsServer;

#[tonic::async_trait]
impl LogsService for LogsServer {
    async fn export(
        &self,
        request: tonic::Request<ExportLogsServiceRequest>,
    ) -> Result<tonic::Response<ExportLogsServiceResponse>, tonic::Status> {
        let start = std::time::Instant::now();
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
        let in_stream_name = metadata
            .get(&cfg.grpc.stream_header_key)
            .and_then(|name| name.to_str().ok());

        let user_email = metadata
            .get("user_id")
            .and_then(|id| id.to_str().ok())
            .unwrap_or_else(|| {
                log::warn!(
                    "[gRPC Logs] user_id metadata is invalid or missing, using empty string"
                );
                ""
            });

        match crate::service::logs::otlp::handle_request(
            0,
            org_id.unwrap().to_str().unwrap(),
            in_req,
            in_stream_name,
            user_email,
            OtlpRequestType::Grpc,
        )
        .await
        {
            Ok(_) => {
                // metrics
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/otlp/v1/logs", "200", "", "", "", ""])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/otlp/v1/logs", "200", "", "", "", ""])
                    .inc();

                Ok(Response::new(ExportLogsServiceResponse {
                    partial_success: None,
                }))
            }
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }
}
