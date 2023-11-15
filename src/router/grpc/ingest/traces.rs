// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use async_trait::async_trait;
use opentelemetry_proto::tonic::collector::trace::v1::{
    trace_service_client::TraceServiceClient, trace_service_server::TraceService,
    ExportTraceServiceRequest, ExportTraceServiceResponse,
};
use tonic::{
    codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request, Status,
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::common::{
    infra::{cluster, config::CONFIG},
    utils::rand::get_rand_element,
};
use crate::service::search::MetadataMap;

#[derive(Default)]
pub struct TraceServer;

#[async_trait]
impl TraceService for TraceServer {
    async fn export(
        &self,
        request: tonic::Request<ExportTraceServiceRequest>,
    ) -> Result<tonic::Response<ExportTraceServiceResponse>, tonic::Status> {
        let (metadata, extensions, message) = request.into_parts();

        // basic validation
        if !metadata.contains_key(&CONFIG.grpc.org_header_key) {
            return Err(Status::invalid_argument(format!(
                "Please specify organization id with header key '{}' ",
                &CONFIG.grpc.org_header_key
            )));
        }

        // call ingester
        let nodes = cluster::get_cached_online_ingester_nodes();
        if nodes.is_none() || nodes.as_ref().unwrap().is_empty() {
            return Err(Status::internal("No online ingester nodes".to_string()));
        }
        // checking nodes
        let nodes = nodes.unwrap();
        let node = get_rand_element(&nodes);

        let mut request = tonic::Request::from_parts(metadata, extensions, message);
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(
                &tracing::Span::current().context(),
                &mut MetadataMap(request.metadata_mut()),
            )
        });

        let token: MetadataValue<_> = cluster::get_internal_grpc_token()
            .parse()
            .map_err(|_| Status::internal("invalid token".to_string()))?;
        let channel = Channel::from_shared(node.grpc_addr.clone())
            .unwrap()
            .connect()
            .await
            .map_err(|err| {
                log::error!(
                    "[ROUTER] grpc->ingest->traces: node: {}, connect err: {:?}",
                    &node.grpc_addr,
                    err
                );
                Status::internal("connect querier error".to_string())
            })?;
        let client = TraceServiceClient::with_interceptor(channel, move |mut req: Request<()>| {
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
