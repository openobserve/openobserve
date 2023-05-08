// Copyright 2022 Zinc Labs Inc. and Contributors
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

use opentelemetry::global;
use std::time::Instant;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::cluster_rpc::metrics_server::Metrics;
use crate::handler::grpc::cluster_rpc::MetricsQueryRequest;
use crate::handler::grpc::cluster_rpc::MetricsQueryResponse;
use crate::infra::errors;
use crate::infra::metrics;
use crate::meta;
use crate::service::promql::search as SearchService;

#[derive(Default)]
pub struct Querier {}

#[tonic::async_trait]
impl Metrics for Querier {
    #[tracing::instrument(name = "grpc:metrics:enter", skip(self, req))]
    async fn query(
        &self,
        req: Request<MetricsQueryRequest>,
    ) -> Result<Response<MetricsQueryResponse>, Status> {
        let start = Instant::now();
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref();
        let org_id = req.org_id.clone();
        let stream_type = meta::StreamType::Metrics.to_string();
        let result = match SearchService::exec_for_grpc(req).await {
            Ok(res) => res,
            Err(err) => {
                // metrics
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/prom/v1/query", "500", &org_id, "", &stream_type])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/prom/v1/query", "500", &org_id, "", &stream_type])
                    .inc();
                return Err(match err {
                    errors::Error::ErrorCode(code) => Status::internal(code.to_json()),
                    _ => Status::internal(err.to_string()),
                });
            }
        };

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/prom/v1/query", "200", &org_id, "", &stream_type])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/prom/v1/query", "200", &org_id, "", &stream_type])
            .inc();

        Ok(Response::new(result))
    }
}
