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
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::cluster_rpc::search_server::Search;
use crate::handler::grpc::cluster_rpc::SearchRequest;
use crate::handler::grpc::cluster_rpc::SearchResponse;
use crate::infra::errors;
use crate::infra::metrics;
use crate::service::search as SearchService;

pub struct Searcher;

#[tonic::async_trait]
impl Search for Searcher {
    #[tracing::instrument(name = "grpc:search:enter", skip_all)]
    async fn search(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref().to_owned();
        let org_id = req.org_id.clone();
        let stream_type = req.stream_type.clone();
        let result = tokio::task::spawn(async move { SearchService::grpc::search(&req).await })
            .await
            .map_err(|e| Status::internal(e.to_string()))?;
        let result = result.map_err(|err| {
            let time = start.elapsed().as_secs_f64();
            metrics::GRPC_RESPONSE_TIME
                .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                .observe(time);
            metrics::GRPC_INCOMING_REQUESTS
                .with_label_values(&["/_search", "500", &org_id, "", &stream_type])
                .inc();
            let message = if let errors::Error::ErrorCode(code) = err {
                code.to_json()
            } else {
                err.to_string()
            };
            Status::internal(message)
        })?;

        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/_search", "200", &org_id, "", &stream_type])
            .inc();

        Ok(Response::new(result))
    }
}
