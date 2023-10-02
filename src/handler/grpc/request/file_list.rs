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

use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::common::{
    infra::{file_list as infra_file_list, metrics},
    meta::{stream::PartitionTimeLevel, StreamType},
};
use crate::handler::grpc::cluster_rpc::{
    filelist_server::Filelist, EmptyRequest, FileKey, FileList, FileListQueryRequest, MaxIdResponse,
};

pub struct Filelister;

#[tonic::async_trait]
impl Filelist for Filelister {
    async fn max_id(&self, req: Request<EmptyRequest>) -> Result<Response<MaxIdResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let max_id = infra_file_list::get_max_pk_value()
            .await
            .map_err(|e| Status::internal(e.to_string()))?;

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/file_list/max_id", "200", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/file_list/max_id", "200", "", "", ""])
            .inc();

        Ok(Response::new(MaxIdResponse { max_id }))
    }

    async fn query(
        &self,
        req: Request<FileListQueryRequest>,
    ) -> Result<Response<FileList>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req: &FileListQueryRequest = req.get_ref();
        let org_id = &req.org_id;
        let stream_type = StreamType::from(req.stream_type.as_str());
        let stream_name = &req.stream_name;
        let time_level = PartitionTimeLevel::from(req.time_level.as_str());
        let time_range = (req.start_time, req.end_time);
        let files =
            infra_file_list::query(org_id, stream_type, stream_name, time_level, time_range)
                .await
                .map_err(|e| Status::internal(e.to_string()))?;
        let items: Vec<FileKey> = files
            .into_iter()
            .map(|(file, meta)| FileKey {
                key: file,
                meta: Some((&meta).into()),
                deleted: false,
            })
            .collect::<_>();

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/file_list/query", "200", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/file_list/query", "200", "", "", ""])
            .inc();

        Ok(Response::new(FileList { items }))
    }
}
