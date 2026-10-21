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
use promql_service::search as SearchService;
use search_service::{QueryRegistration, SEARCH_SERVER};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::{
    MetadataMap,
    cluster_rpc::{
        MetricsQueryRequest, MetricsQueryResponse, MetricsQueryStmt, metrics_server::Metrics,
    },
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

        let req = req.into_inner();
        let (_, trace_id) = query_and_trace_id(&req)?;
        let (req, registration) = register_follower(req, &trace_id);

        let org_id = &req.org_id;
        let stream_type = StreamType::Metrics.as_str();
        let result = SearchService::grpc::search(&req, registration.tracker()).await;
        drop(registration);

        let result = result.map_err(|err| {
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

        Ok(Response::new(result))
    }

    #[tracing::instrument(name = "grpc:metrics:data", skip_all, fields(org_id = req.get_ref().org_id))]
    async fn data(
        &self,
        req: Request<MetricsQueryRequest>,
    ) -> Result<Response<Self::DataStream>, Status> {
        let mut req: MetricsQueryRequest = req.into_inner();

        let (query, trace_id) = query_and_trace_id(&req)?;
        log::info!(
            "[trace_id {trace_id}] promql->data->grpc: org_id: {}, use_cache: {}, time_range: [{},{}), step: {}, query: {}, label_selector: {:?}",
            req.org_id,
            req.use_cache,
            query.start,
            query.end,
            query.step,
            query.query,
            query.label_selector,
        );
        if let Some(query) = req.query.as_mut() {
            query.query_data = true;
        }

        let (req, registration) = register_follower(req, &trace_id);

        // spawn a task to push streaming responses
        let cap = std::cmp::max(2, config::get_config().limit.cpu_num);
        let (tx, rx) = mpsc::channel::<Result<MetricsQueryResponse, Status>>(cap);
        tokio::task::spawn(async move {
            let result = promql_service::search::grpc::data(&req, registration.tracker(), tx).await;
            drop(registration);
            if let Err(e) = result {
                log::error!("[gRPC:metrics:data] get data error: req:{req:?}, error:{e:?}")
            }
        });

        let out_stream = ReceiverStream::new(rx);
        Ok(Response::new(Box::pin(out_stream) as Self::DataStream))
    }
}

/// Runs the request under its own `{trace_id}-{suffix}` id that a cancel of `trace_id` reaches.
fn register_follower(
    mut req: MetricsQueryRequest,
    trace_id: &str,
) -> (MetricsQueryRequest, QueryRegistration) {
    let registration = SEARCH_SERVER.register_follower(&req.org_id, trace_id);
    // file lists are keyed by this id, so concurrent requests need their own
    if let Some(job) = req.job.as_mut() {
        job.trace_id = registration.tracker().query_id().to_string();
    }
    (req, registration)
}

fn query_and_trace_id(req: &MetricsQueryRequest) -> Result<(&MetricsQueryStmt, String), Status> {
    let Some(query) = req.query.as_ref() else {
        return Err(Status::invalid_argument("metrics request has no query"));
    };
    let Some(job) = req.job.as_ref() else {
        return Err(Status::invalid_argument("metrics request has no job"));
    };
    Ok((query, job.trace_id.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handler::grpc::cluster_rpc::Job;

    fn requests_missing_fields() -> [MetricsQueryRequest; 2] {
        [
            MetricsQueryRequest::default(),
            MetricsQueryRequest {
                query: Some(MetricsQueryStmt::default()),
                ..Default::default()
            },
        ]
    }

    #[tokio::test]
    async fn test_query_without_query_or_job_is_invalid_argument() {
        for req in requests_missing_fields() {
            let status = MetricsQuerier.query(Request::new(req)).await.unwrap_err();
            assert_eq!(status.code(), tonic::Code::InvalidArgument);
        }
    }

    #[tokio::test]
    async fn test_data_without_query_or_job_is_invalid_argument() {
        let job_only = MetricsQueryRequest {
            job: Some(Job::default()),
            ..Default::default()
        };
        for req in requests_missing_fields().into_iter().chain([job_only]) {
            let Err(status) = MetricsQuerier.data(Request::new(req)).await else {
                panic!("a request without a query and a job must be rejected");
            };
            assert_eq!(status.code(), tonic::Code::InvalidArgument);
        }
    }

    #[test]
    fn test_follower_runs_under_its_own_id_below_the_trace() {
        let req = |trace_id: &str| MetricsQueryRequest {
            org_id: "org".to_string(),
            job: Some(Job {
                trace_id: trace_id.to_string(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let (first, first_registration) = register_follower(req("t"), "t");
        let (second, second_registration) = register_follower(req("t"), "t");

        let first_id = first.job.unwrap().trace_id;
        let second_id = second.job.unwrap().trace_id;
        assert_ne!(first_id, second_id);
        assert!(first_id.starts_with("t-"));
        assert_eq!(first_id, first_registration.tracker().query_id());
        assert_eq!(second_id, second_registration.tracker().query_id());
    }
}
