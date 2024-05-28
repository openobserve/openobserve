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
use opentelemetry_proto::tonic::collector::metrics::v1::{
    metrics_service_client::MetricsServiceClient, metrics_service_server::MetricsService,
    ExportMetricsServiceRequest, ExportMetricsServiceResponse,
};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{common::infra::cluster, service::search::MetadataMap};

#[derive(Default)]
pub struct MetricsServer;

#[async_trait]
impl MetricsService for MetricsServer {
    async fn export(
        &self,
        request: Request<ExportMetricsServiceRequest>,
    ) -> Result<Response<ExportMetricsServiceResponse>, Status> {
        let (metadata, extensions, message) = request.into_parts();

        let config = CONFIG.read().await;
        // basic validation
        if !metadata.contains_key(&config.grpc.org_header_key) {
            return Err(Status::invalid_argument(format!(
                "Please specify organization id with header key '{}' ",
                &config.grpc.org_header_key
            )));
        }

        // call ingester
        let mut request = Request::from_parts(metadata, extensions, message);
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(
                &tracing::Span::current().context(),
                &mut MetadataMap(request.metadata_mut()),
            )
        });
        let token: MetadataValue<_> = cluster::get_internal_grpc_token()
            .parse()
            .map_err(|_| Status::internal("invalid token".to_string()))?;
        let channel = super::get_ingester_channel().await?;
        let client = MetricsServiceClient::with_interceptor(channel, move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        });
        client
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip)
            .export(request)
            .await
    }
}
