// Copyright 2025 OpenObserve Inc.
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
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::{Role, RoleGroup},
        stream::FileKey,
    },
    metrics,
    utils::inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
};
use infra::{cache::file_data::TRACE_ID_FOR_CACHE_LATEST_FILE, file_list as infra_file_list};
use opentelemetry::global;
use proto::cluster_rpc::{event_server::Event, EmptyResponse, FileList};
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{common::infra::cluster::get_node_from_consistent_hash, handler::grpc::MetadataMap};

pub struct Eventer;

#[tonic::async_trait]
impl Event for Eventer {
    async fn send_file_list(
        &self,
        req: Request<FileList>,
    ) -> Result<Response<EmptyResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx =
            global::get_text_map_propagator(|prop| prop.extract(&MetadataMap(req.metadata())));
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
        let cfg = get_config();
        // Warning: external meta store should not accept any file list
        // querier and compactor can accept add new files
        // ingester only accept remove old files
        if !cfg.common.meta_store_external {
            if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_compactor() {
                if let Err(e) = infra_file_list::batch_add(&put_items).await {
                    // metrics
                    let time = start.elapsed().as_secs_f64();
                    metrics::GRPC_RESPONSE_TIME
                        .with_label_values(&["/event/send_file_list", "500", "", ""])
                        .observe(time);
                    metrics::GRPC_INCOMING_REQUESTS
                        .with_label_values(&["/event/send_file_list", "500", "", ""])
                        .inc();
                    return Err(Status::internal(e.to_string()));
                }
            }
            if let Err(e) = infra_file_list::batch_remove(&del_items).await {
                // metrics
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/event/send_file_list", "500", "", ""])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/event/send_file_list", "500", "", ""])
                    .inc();
                return Err(Status::internal(e.to_string()));
            }
        }

        // cache latest files for querier
        if cfg.cache_latest_files.enabled && LOCAL_NODE.is_querier() {
            for item in put_items.iter() {
                let Some(node_name) = get_node_from_consistent_hash(
                    &item.key,
                    &Role::Querier,
                    Some(RoleGroup::Interactive),
                )
                .await
                else {
                    continue; // no querier node
                };
                if LOCAL_NODE.name.ne(&node_name) {
                    continue; // not this node
                }
                // cache parquet
                if cfg.cache_latest_files.cache_parquet {
                    if let Err(e) =
                        infra::cache::file_data::download(TRACE_ID_FOR_CACHE_LATEST_FILE, &item.key)
                            .await
                    {
                        log::error!("Failed to cache file data: {}", e);
                    }
                }
                // cache index for the parquet
                if cfg.cache_latest_files.cache_index && item.meta.index_size > 0 {
                    if let Some(ttv_file) = convert_parquet_idx_file_name_to_tantivy_file(&item.key)
                    {
                        if let Err(e) = infra::cache::file_data::download(
                            TRACE_ID_FOR_CACHE_LATEST_FILE,
                            &ttv_file,
                        )
                        .await
                        {
                            log::error!("Failed to cache file data: {}", e);
                        }
                    }
                }
            }

            // delete merge files
            if cfg.cache_latest_files.delete_merge_files {
                if cfg.cache_latest_files.cache_parquet {
                    let del_items = req
                        .items
                        .iter()
                        .filter_map(|v| if v.deleted { Some(v.key.clone()) } else { None })
                        .collect::<Vec<_>>();
                    infra::cache::file_data::delete::add(del_items);
                }
                if cfg.cache_latest_files.cache_index {
                    let del_items = req
                        .items
                        .iter()
                        .filter_map(|v| {
                            if v.deleted {
                                match v.meta.as_ref() {
                                    Some(m) if m.index_size > 0 => {
                                        convert_parquet_idx_file_name_to_tantivy_file(&v.key)
                                    }
                                    _ => None,
                                }
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    infra::cache::file_data::delete::add(del_items);
                }
            }
        }

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/event/send_file_list", "200", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/event/send_file_list", "200", "", ""])
            .inc();

        Ok(Response::new(EmptyResponse {}))
    }
}
