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

use config::{
    cluster::{is_compactor, is_querier, LOCAL_NODE_ROLE, LOCAL_NODE_UUID},
    meta::{cluster::Role, stream::FileKey},
    metrics, CONFIG,
};
use infra::file_list as infra_file_list;
use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::infra::cluster::get_node_from_consistent_hash,
    handler::grpc::cluster_rpc::{event_server::Event, EmptyResponse, FileList},
};

pub struct Eventer;

#[tonic::async_trait]
impl Event for Eventer {
    async fn send_file_list(
        &self,
        req: Request<FileList>,
    ) -> Result<Response<EmptyResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx = global::get_text_map_propagator(|prop| {
            prop.extract(&super::MetadataMap(req.metadata()))
        });
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref();
        let put_items = req
            .items
            .iter()
            .filter(|v| !v.deleted)
            .map(FileKey::from)
            .collect::<Vec<_>>();
        let del_items = req
            .items
            .iter()
            .filter(|v| v.deleted)
            .map(|v| v.key.clone())
            .collect::<Vec<_>>();
        // querier and compactor can accept add new files
        // ingester only accept remove old files
        if is_querier(&LOCAL_NODE_ROLE) || is_compactor(&LOCAL_NODE_ROLE) {
            if let Err(e) = infra_file_list::batch_add(&put_items).await {
                // metrics
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/event/send_file_list", "500", "", "", ""])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/event/send_file_list", "500", "", "", ""])
                    .inc();
                return Err(Status::internal(e.to_string()));
            }
        }
        if let Err(e) = infra_file_list::batch_remove(&del_items).await {
            // metrics
            let time = start.elapsed().as_secs_f64();
            metrics::GRPC_RESPONSE_TIME
                .with_label_values(&["/event/send_file_list", "500", "", "", ""])
                .observe(time);
            metrics::GRPC_INCOMING_REQUESTS
                .with_label_values(&["/event/send_file_list", "500", "", "", ""])
                .inc();
            return Err(Status::internal(e.to_string()));
        }

        // cache latest files for querier
        if CONFIG.memory_cache.cache_latest_files && is_querier(&LOCAL_NODE_ROLE) {
            for item in put_items {
                let Some(node) = get_node_from_consistent_hash(&item.key, &Role::Querier).await
                else {
                    continue; // no querier node
                };
                if LOCAL_NODE_UUID.ne(&node) {
                    continue; // not this node
                }
                // maybe load already merged file, no need report error
                _ = infra::cache::file_data::memory::download("download", &item.key).await;
            }
        }

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/event/send_file_list", "200", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/event/send_file_list", "200", "", "", ""])
            .inc();

        Ok(Response::new(EmptyResponse {}))
    }
}
