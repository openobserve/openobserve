use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::cluster_rpc::search_server::Search;
use crate::handler::grpc::cluster_rpc::SearchRequest;
use crate::handler::grpc::cluster_rpc::SearchResponse;
use crate::service::search as SearchService;

#[derive(Default)]
pub struct Searcher {}

#[tonic::async_trait]
impl Search for Searcher {
    #[tracing::instrument(name = "grpc:search:enter", skip(self, req))]
    async fn search(
        &self,
        req: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref();
        let result = match SearchService::exec::search(req).await {
            Ok(res) => res,
            Err(err) => {
                return Err(Status::internal(err.to_string()));
            }
        };
        Ok(Response::new(result))
    }
}
