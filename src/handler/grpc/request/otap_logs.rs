use std::pin::Pin;

use otel_arrow_rust::proto::opentelemetry::arrow::v1::{arrow_logs_service_server::ArrowLogsService, BatchArrowRecords, BatchStatus};
use tonic::{Request, Response, Status};
use tokio_stream::{Stream, wrappers::ReceiverStream};
use tonic::codegen::tokio_stream;

#[derive(Default)]
pub struct ArrowLogsServer;


#[tonic::async_trait]
impl ArrowLogsService for ArrowLogsServer {
    type ArrowLogsStream =
        Pin<Box<dyn Stream<Item = Result<BatchStatus, Status>> + Send + 'static>>;
    async fn arrow_logs(
        &self,
        request: Request<tonic::Streaming<BatchArrowRecords>>,
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

        let mut input_stream = request.into_inner();

        let (tx, rx) = tokio::sync::mpsc::channel(100);

        tokio::spawn(async move {
            // let mut consumer = Consumer::default();
            while let Ok(Some(mut batch)) = input_stream.message().await {

                // let status_result = match consumer.consume_logs_batches(&mut batch) {
                //     Ok(otlp_logs) => {
                //         let _ = receiver
                //             .process_export_request::<ExportLogsServiceRequest>(
                //                 Request::new(otlp_logs),
                //                 "logs",
                //             )
                //             .await
                //             .context(error::TonicStatusSnafu)
                //             .unwrap();

                //         (StatusCode::Ok, "Successfully processed".to_string())
                //     }
                //     Err(e) => (StatusCode::InvalidArgument, truncate_error(e.to_string())),
                // };

                let tx_result = tx
                    .send(Ok(BatchStatus {
                        batch_id: batch.batch_id,
                        status_code: 0,
                        status_message: String::from("Success"),
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