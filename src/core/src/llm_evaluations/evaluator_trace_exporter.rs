// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use opentelemetry_proto::tonic::collector::trace::v1::trace_service_client::TraceServiceClient;
use tonic::{Request, codec::CompressionEncoding, metadata::MetadataValue};

use crate::llm_evaluations::evaluator_trace::{EvaluatorTrace, create_evaluator_trace_request};

#[derive(Debug, Default)]
pub struct EvaluatorTraceExporter;

impl EvaluatorTraceExporter {
    pub async fn export(org_id: &str, traces: Vec<EvaluatorTrace>, node_idx: usize) {
        if traces.is_empty() {
            return;
        }

        let request = create_evaluator_trace_request(traces);
        if request.resource_spans.is_empty() {
            return;
        }

        let cfg = config::get_config();
        let token: MetadataValue<_> = match config::meta::cluster::get_internal_grpc_token().parse()
        {
            Ok(token) => token,
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to parse internal gRPC token for evaluator traces: {e}"
                );
                return;
            }
        };

        let (_addr, channel) = match openobserve_node::grpc::get_ingester_channel().await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to get ingester channel for evaluator traces: {e}"
                );
                return;
            }
        };

        let client = TraceServiceClient::with_interceptor(channel, move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        });

        let org_header_key: tonic::metadata::MetadataKey<_> = match cfg.grpc.org_header_key.parse()
        {
            Ok(key) => key,
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to parse org header key for evaluator traces: {e}"
                );
                return;
            }
        };
        let stream_header_key: tonic::metadata::MetadataKey<_> = match cfg
            .grpc
            .stream_header_key
            .parse()
        {
            Ok(key) => key,
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to parse stream header key for evaluator traces: {e}"
                );
                return;
            }
        };
        let org_header_value: MetadataValue<_> = match org_id.parse() {
            Ok(value) => value,
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to parse org header value for evaluator traces: {e}"
                );
                return;
            }
        };
        let stream_header_value: MetadataValue<_> =
            match config::meta::self_reporting::evaluator::EVALUATOR_STREAM.parse() {
                Ok(value) => value,
                Err(e) => {
                    log::error!(
                        "[Pipeline]: LLM evaluation node {node_idx} failed to parse _evaluator stream header value: {e}"
                    );
                    return;
                }
            };

        let mut grpc_request = Request::new(request);
        grpc_request.set_timeout(std::time::Duration::from_secs(
            cfg.limit.grpc_ingest_timeout,
        ));
        grpc_request
            .metadata_mut()
            .insert(org_header_key, org_header_value);
        grpc_request
            .metadata_mut()
            .insert(stream_header_key, stream_header_value);

        match client
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip)
            .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
            .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
            .export(grpc_request)
            .await
        {
            Ok(response) => {
                if response.get_ref().partial_success.is_some() {
                    log::warn!(
                        "[Pipeline]: LLM evaluation node {node_idx} exported evaluator traces with partial success: {:?}",
                        response.get_ref()
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[Pipeline]: LLM evaluation node {node_idx} failed to export evaluator traces over OTLP gRPC: {e}"
                );
            }
        }
    }
}
