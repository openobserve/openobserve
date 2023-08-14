use async_trait::async_trait;
use opentelemetry_proto::tonic::collector::logs::v1::{
    logs_service_server::LogsService, ExportLogsServiceRequest, ExportLogsServiceResponse,
};
use tonic::Response;
use tonic::Status;

use crate::common::infra::config::CONFIG;

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

        let resp = crate::service::logs::json_no_fn::handle_logs_request(
            org_id.unwrap().to_str().unwrap(),
            0,
            in_req,
        )
        .await;
        if resp.is_ok() {
            return Ok(Response::new(ExportLogsServiceResponse {}));
        } else {
            Err(Status::internal(resp.err().unwrap().to_string()))
        }
    }
}
