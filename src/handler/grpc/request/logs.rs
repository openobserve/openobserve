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

use std::pin::Pin;

use config::{meta::otlp::OtlpRequestType, metrics};
use futures::Stream;
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsServiceRequest, ExportLogsServiceResponse, logs_service_server::LogsService,
};
use proto::otel_arrow::{
    BatchArrowRecords, BatchStatus, arrow_logs_service_server::ArrowLogsService,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Response, Status, codegen::tokio_stream};

use crate::service::otap::decoder::Consumer;

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
        let stream_name = metadata.get(&cfg.grpc.stream_header_key);
        let mut in_stream_name: Option<&str> = None;
        if let Some(stream_name) = stream_name {
            in_stream_name = Some(stream_name.to_str().unwrap());
        };

        let user_id = metadata.get("user_id");
        let mut user_email: &str = "";
        if let Some(user_id) = user_id {
            user_email = user_id.to_str().unwrap();
        };

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

#[derive(Default)]
pub struct ArrowLogsServer;

#[tonic::async_trait]
impl ArrowLogsService for ArrowLogsServer {
    type ArrowLogsStream =
        Pin<Box<dyn Stream<Item = Result<BatchStatus, Status>> + Send + 'static>>;
    async fn arrow_logs(
        &self,
        request: tonic::Request<tonic::Streaming<BatchArrowRecords>>,
    ) -> Result<Response<Self::ArrowLogsStream>, Status> {
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

        let org_id = metadata
            .get(&cfg.grpc.org_header_key)
            .map(|v| v.to_str().unwrap().to_string())
            .ok_or_else(|| Status::invalid_argument(msg))?;

        let in_stream_name = metadata
            .get(&cfg.grpc.stream_header_key)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let user_email = metadata
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let mut input_stream = request.into_inner();

        let (tx, rx) = tokio::sync::mpsc::channel(100);

        tokio::spawn(async move {
            let mut consumer = Consumer::default();
            while let Ok(Some(mut batch)) = input_stream.message().await {
                let status_result = match consumer.consume_logs_batches(&mut batch) {
                    Ok(otlp_logs) => {
                        match crate::service::logs::otlp::handle_request(
                            0,
                            &org_id,
                            otlp_logs,
                            in_stream_name.as_deref(),
                            &user_email,
                            OtlpRequestType::ArrowStream,
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

                                Status::ok("Processed successfully")
                            }
                            Err(e) => Status::internal(e.to_string()),
                        }
                    }
                    Err(e) => Status::internal(e.to_string()),
                };

                let tx_result = tx
                    .send(Ok(BatchStatus {
                        batch_id: batch.batch_id,
                        status_code: status_result.code() as i32,
                        status_message: status_result.message().to_string(),
                    }))
                    .await;

                if tx_result.is_err() {
                    break;
                }
            }
        });

        let output_stream = ReceiverStream::new(rx);
        Ok(Response::new(
            Box::pin(output_stream) as Self::ArrowLogsStream
        ))
    }
}
