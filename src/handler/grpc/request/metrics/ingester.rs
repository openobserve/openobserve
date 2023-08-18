use async_trait::async_trait;
use opentelemetry_proto::tonic::collector::metrics::v1::{
    metrics_service_server::MetricsService, ExportMetricsServiceRequest,
    ExportMetricsServiceResponse,
};
use tonic::{Response, Status};

use crate::common::infra::config::CONFIG;

#[derive(Default)]
pub struct Ingester;

#[async_trait]
impl MetricsService for Ingester {
    async fn export(
        &self,
        request: tonic::Request<ExportMetricsServiceRequest>,
    ) -> Result<tonic::Response<ExportMetricsServiceResponse>, tonic::Status> {
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

        let resp = crate::service::metrics::otlp::handle_grpc_request(
            org_id.unwrap().to_str().unwrap(),
            0,
            in_req,
        )
        .await;
        if resp.is_ok() {
            return Ok(Response::new(ExportMetricsServiceResponse {}));
        } else {
            Err(Status::internal(resp.err().unwrap().to_string()))
        }
    }
}
