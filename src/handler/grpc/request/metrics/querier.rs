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

use std::pin::Pin;

use config::{meta::stream::StreamType, metrics};
use futures::Stream;
use infra::errors;
use opentelemetry::global;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {crate::service::search::SEARCH_SERVER, o2_enterprise::enterprise::search::TaskStatus};

use crate::{
    handler::grpc::{
        MetadataMap,
        cluster_rpc::{MetricsQueryRequest, MetricsQueryResponse, metrics_server::Metrics},
    },
    service::promql::search as SearchService,
};

pub struct MetricsQuerier;

#[tonic::async_trait]
impl Metrics for MetricsQuerier {
    type DataStream =
        Pin<Box<dyn Stream<Item = Result<MetricsQueryResponse, Status>> + Send + 'static>>;

    #[tracing::instrument(name = "grpc:metrics:query", skip_all, fields(org_id = req.get_ref().org_id))]
    async fn query(
        &self,
        req: Request<MetricsQueryRequest>,
    ) -> Result<Response<MetricsQueryResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx =
            global::get_text_map_propagator(|prop| prop.extract(&MetadataMap(req.metadata())));
        let _ = tracing::Span::current().set_parent(parent_cx);

        let req: &MetricsQueryRequest = req.get_ref();
        let org_id = &req.org_id;
        let stream_type = StreamType::Metrics.as_str();

        #[cfg(feature = "enterprise")]
        let trace_id = req.job.as_ref().unwrap().trace_id.clone();
        #[cfg(feature = "enterprise")]
        if !SEARCH_SERVER.contain_key(&trace_id).await {
            SEARCH_SERVER
                .insert(
                    trace_id.to_string(),
                    TaskStatus::new_follower(vec![], false),
                )
                .await;
        }
        let result = SearchService::grpc::search(req).await.map_err(|err| {
            let time = start.elapsed().as_secs_f64();
            metrics::GRPC_RESPONSE_TIME
                .with_label_values(&["/metrics/query", "500", org_id, stream_type, "", ""])
                .observe(time);
            metrics::GRPC_INCOMING_REQUESTS
                .with_label_values(&["/metrics/query", "500", org_id, stream_type, "", ""])
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
            .with_label_values(&["/metrics/query", "200", org_id, stream_type, "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/metrics/query", "200", org_id, stream_type, "", ""])
            .inc();

        // Clean up task record before returning
        #[cfg(feature = "enterprise")]
        if !SEARCH_SERVER.is_leader(&trace_id).await {
            SEARCH_SERVER.remove(&trace_id, false).await;
        }

        Ok(Response::new(result))
    }

    #[tracing::instrument(name = "grpc:metrics:data", skip_all, fields(org_id = req.get_ref().org_id))]
    async fn data(
        &self,
        req: Request<MetricsQueryRequest>,
    ) -> Result<Response<Self::DataStream>, Status> {
        let cap = std::cmp::max(2, config::get_config().limit.cpu_num);
        let (tx, rx) = mpsc::channel::<Result<MetricsQueryResponse, Status>>(cap);
        let mut req: MetricsQueryRequest = req.into_inner();
        req.query.as_mut().unwrap().query_data = true;

        log::info!(
            "[trace_id {}] promql->data->grpc: org_id: {}, use_cache: {}, time_range: [{},{}), step: {}, query: {}, label_selector: {:?}",
            req.job.as_ref().unwrap().trace_id,
            req.org_id,
            req.use_cache,
            req.query.as_ref().unwrap().start,
            req.query.as_ref().unwrap().end,
            req.query.as_ref().unwrap().step,
            req.query.as_ref().unwrap().query,
            req.query.as_ref().unwrap().label_selector,
        );

        // spawn a task to push streaming responses
        tokio::task::spawn(async move {
            if let Err(e) = crate::service::promql::search::grpc::data(&req, tx).await {
                log::error!("[gRPC:metrics:data] get data error: req:{req:?}, error:{e:?}")
            }
        });

        let out_stream = ReceiverStream::new(rx);
        Ok(Response::new(Box::pin(out_stream) as Self::DataStream))
    }
}
