// Copyright 2026 OpenObserve Inc.
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

use config::meta::otlp::OtlpRequestType;
use ingestion_common::IngestUser;
use opentelemetry_proto::tonic::collector::metrics::v1::{
    ExportMetricsServiceRequest, ExportMetricsServiceResponse,
    metrics_service_server::MetricsService,
};
use tonic::{Response, Status};

use crate::handler::grpc::request::otlp::{export_reply, observe_ok};

#[derive(Default)]
pub struct MetricsIngester;

#[tonic::async_trait]
impl MetricsService for MetricsIngester {
    async fn export(
        &self,
        request: tonic::Request<ExportMetricsServiceRequest>,
    ) -> Result<tonic::Response<ExportMetricsServiceResponse>, tonic::Status> {
        let start = std::time::Instant::now();
        let cfg = config::get_config();

        let metadata = request.metadata().clone();
        let msg = format!(
            "Please specify organization id with header key '{}' ",
            cfg.grpc.org_header_key
        );
        if !metadata.contains_key(&cfg.grpc.org_header_key) {
            return Err(Status::invalid_argument(msg));
        }

        let in_req = request.into_inner();
        let org_id = metadata.get(&cfg.grpc.org_header_key);
        if org_id.is_none() {
            return Err(Status::invalid_argument(msg));
        }

        let user_email = metadata
            .get("user_id")
            .and_then(|id| id.to_str().ok())
            .unwrap_or_else(|| {
                log::warn!("[gRPC Metrics] user_id not found in metadata, using empty string");
                ""
            });

        let user = IngestUser::from_user_email(user_email);

        let resp = openobserve_core::metrics::otlp::handle_otlp_request(
            org_id.unwrap().to_str().unwrap(),
            in_req,
            OtlpRequestType::Grpc,
            user,
        )
        .await
        .map_err(|e| Status::internal(e.to_string()))?;
        let reply = export_reply(resp).await?;
        observe_ok("/otlp/v1/metrics", start);
        Ok(Response::new(reply))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_ingester_default() {
        let _server = MetricsIngester;
    }
}
