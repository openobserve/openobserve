use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::cluster_rpc::event_server::Event;
use crate::handler::grpc::cluster_rpc::EmptyResponse;
use crate::handler::grpc::cluster_rpc::FileList;
use crate::meta::common::FileMeta;
use crate::service::db::file_list;

#[derive(Default)]
pub struct Eventer {}

#[tonic::async_trait]
impl Event for Eventer {
    #[tracing::instrument(name = "grpc:event:SendFileList:enter", skip(self, req))]
    async fn send_file_list(
        &self,
        req: Request<FileList>,
    ) -> Result<Response<EmptyResponse>, Status> {
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref();
        for file in req.items.iter() {
            log::info!("received event:file, {:?}", file);
            if let Err(e) = file_list::progress(
                &file.key,
                FileMeta::from(file.meta.as_ref().unwrap()),
                file.deleted,
            )
            .await
            {
                return Err(Status::internal(e.to_string()));
            }
        }

        let result = EmptyResponse {};

        Ok(Response::new(result))
    }
}
