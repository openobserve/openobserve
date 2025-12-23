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

use config::{cluster::LOCAL_NODE, meta::cluster::get_internal_grpc_token};
use infra::{
    client::grpc::get_cached_channel,
    cluster,
    errors::{Error, ErrorCodes},
};
use proto::cluster_rpc;
use tonic::{Request, codec::CompressionEncoding, metadata::MetadataValue};
use tracing::{Instrument, info_span};

use crate::service::search::server_internal_error;

pub async fn delete_cached_results(path: String, delete_ts: i64) -> bool {
    let trace_id = path.clone();
    let mut delete_response = true;
    // get nodes from cluster
    let mut nodes = match cluster::get_cached_online_querier_nodes(None).await {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] delete_cached_results: no querier node online");
            return false;
        }
    };
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);

    nodes.sort_by_key(|x| x.id);

    let local_node = cluster::get_node_by_uuid(LOCAL_NODE.uuid.as_str()).await;
    nodes.retain(|node| node.is_querier() && !node.uuid.eq(LOCAL_NODE.uuid.as_str()));

    let querier_num = nodes.len();
    if querier_num == 0 && local_node.is_none() {
        log::error!("no querier node online");
        return false;
    };

    let mut tasks = Vec::new();

    for node in nodes {
        let cfg = config::get_config();
        let node_addr = node.grpc_addr.clone();

        let grpc_span = info_span!(
            "service:search:cluster:cacher:delete_cached_results",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );

        let trace_id = trace_id.clone();
        let local_path = path.clone();
        let task = tokio::task::spawn(
            async move {
                let req = cluster_rpc::DeleteResultCacheRequest {
                   path: local_path.clone(),
                   ts: delete_ts,
                };

                let request = tonic::Request::new(req);

                log::info!(
                    "[trace_id {trace_id}] delete_cached_results->grpc: request node: {}",
                    &node_addr
                );

                let token: MetadataValue<_> = get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = get_cached_channel(&node_addr).await.map_err(|err| {
                    log::error!(
                        "[trace_id {trace_id}] delete_cached_results->grpc: node: {}, connect err: {:?}",
                        &node.grpc_addr,
                        err
                    );
                    server_internal_error("connect search node error")
                })?;
                let mut client =
                    cluster_rpc::query_cache_client::QueryCacheClient::with_interceptor(
                        channel,
                        move |mut req: Request<()>| {
                            req.metadata_mut().insert("authorization", token.clone());

                            Ok(req)
                        },
                    );
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
                let response = match client.delete_result_cache(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] delete_cached_results->grpc: node: {}, get_cached_results err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        let err = ErrorCodes::from_json(err.message())?;
                        return Err(Error::ErrorCode(err));
                    }
                };

                Ok((node.clone(), response))
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }
    match crate::service::search::cache::cacher::delete_cache(&path, delete_ts, None, None).await {
        Ok(_) => {
            log::info!(
                "[trace_id {trace_id}] delete_cached_results->grpc: local node delete success"
            );
        }
        Err(e) => {
            delete_response = false;
            log::error!(
                "[trace_id {trace_id}] delete_cached_results->grpc: local node delete error: {e}"
            );
        }
    };

    for task in tasks {
        match task.await {
            Ok(res) => match res {
                Ok((node, node_res)) => match node_res.deleted {
                    true => {
                        log::debug!(
                            "[trace_id {trace_id}] delete_cached_results->grpc: node: {}, delete success",
                            &node.grpc_addr
                        );
                    }
                    false => {
                        delete_response = false;
                        log::error!(
                            "[trace_id {trace_id}] delete_cached_results->grpc: node delete error: node: {}",
                            &node.grpc_addr
                        );
                    }
                },
                Err(err) => {
                    delete_response = false;
                    log::error!(
                        "[trace_id {trace_id}] delete_cached_results->grpc: node delete error: {err}"
                    );
                }
            },
            Err(e) => {
                delete_response = false;
                log::error!(
                    "[trace_id {trace_id}] delete_cached_results-> grpc: node delete error: {e}"
                );
            }
        }
    }
    delete_response
}
