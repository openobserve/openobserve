// Copyright 2024 OpenObserve Inc.
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
use infra::errors::{Error, ErrorCodes};
use proto::cluster_rpc::{self, DeleteResultCacheRequest, QueryCacheRequest};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, Request};
use tracing::{info_span, Instrument};

use crate::{
    common::meta::search::{CacheQueryRequest, CachedQueryResponse},
    service::{
        grpc::get_cached_channel,
        search::{infra_cluster, server_internal_error},
    },
};

#[tracing::instrument(name = "service:search:cluster:cacher:get_cached_results", skip_all)]
pub async fn get_cached_results(
    query_key: String,
    file_path: String,
    trace_id: String,
    cache_req: CacheQueryRequest,
) -> Option<CachedQueryResponse> {
    let start = std::time::Instant::now();
    // get nodes from cluster
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(None).await {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] get_cached_results: no querier node online");
            return None;
        }
    };
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);

    nodes.sort_by_key(|x| x.id);

    let local_node = infra_cluster::get_node_by_uuid(LOCAL_NODE.uuid.as_str()).await;
    nodes.retain(|node| node.is_querier() && !node.uuid.eq(LOCAL_NODE.uuid.as_str()));

    let querier_num = nodes.len();
    if querier_num == 0 && local_node.is_none() {
        log::error!("no querier node online");
        return None;
    };

    let ts_column = cache_req.ts_column;
    let mut tasks = Vec::new();
    for node in nodes {
        let cfg = config::get_config();
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:cacher:get_cached_results",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );
        let query_key = query_key.clone();
        let file_path = file_path.clone();
        let trace_id = trace_id.clone();
        let ts_column = ts_column.to_string();
        let task = tokio::task::spawn(
            async move {
                let req = QueryCacheRequest {
                   start_time: cache_req.q_start_time,
                    end_time: cache_req.q_end_time,
                    is_aggregate :cache_req.is_aggregate,
                    query_key,
                    file_path,
                    timestamp_col: ts_column.to_string(),
                    trace_id:trace_id.clone(),
                    discard_interval:cache_req.discard_interval,
                    is_descending:cache_req.is_descending,
                };

                let mut request = tonic::Request::new(req);
                request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));

                log::info!(
                    "[trace_id {trace_id}] get_cached_results->grpc: request node: {}",
                    &node_addr
                );

                let token: MetadataValue<_> = get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = get_cached_channel(&node_addr).await.map_err(|err| {
                    log::error!(
                        "[trace_id {trace_id}] get_cached_results->grpc: node: {}, connect err: {:?}",
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
                let response = match client.get_cached_result(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[trace_id {trace_id}] get_cached_results->grpc: node: {}, get_cached_results err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(super::super::server_internal_error("querier node error"));
                    }
                };

                Ok((node.clone(), response))
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::new();

    for task in tasks {
        match task.await {
            Ok(res) => match res {
                Ok((node, node_res)) => match node_res.response {
                    Some(res) => {
                        let cached_res: config::meta::search::Response = match res.cached_response {
                            Some(cached_response) => {
                                match serde_json::from_slice(&cached_response.data) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        log::error!(
                                            "[trace_id {trace_id}] get_cached_results->grpc: node: {}, cached_response parse error: {:?}",
                                            &node.grpc_addr,
                                            e
                                        );
                                        config::meta::search::Response::default()
                                    }
                                }
                            }
                            None => {
                                log::error!(
                                    "[trace_id {trace_id}] get_cached_results->grpc: node: {}, no cached_response",
                                    &node.grpc_addr
                                );
                                config::meta::search::Response::default()
                            }
                        };

                        results.push((
                            node,
                            CachedQueryResponse {
                                cached_response: cached_res,
                                deltas: vec![],
                                has_cached_data: res.has_cached_data,
                                cache_query_response: res.cache_query_response,
                                response_start_time: res.cache_start_time,
                                response_end_time: res.cache_end_time,
                                ts_column: ts_column.clone(),
                                is_descending: res.is_descending,
                                limit: -1,
                            },
                        ));
                    }
                    None => {
                        log::info!(
                            "[trace_id {trace_id}] get_cached_results->grpc: node: {}, no cached data",
                            &node.grpc_addr
                        );
                    }
                },
                Err(err) => {
                    log::error!(
                        "[trace_id {trace_id}] get_cached_results->grpc: node search error: {err}"
                    );
                }
            },
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] get_cached_results->grpc: node search error: {e}"
                );
            }
        }
    }

    if let Some(local_resp) = crate::service::search::cache::cacher::get_cached_results(
        &file_path,
        &trace_id,
        CacheQueryRequest {
            q_start_time: cache_req.q_start_time,
            q_end_time: cache_req.q_end_time,
            is_aggregate: cache_req.is_aggregate,
            ts_column,
            discard_interval: cache_req.discard_interval,
            is_descending: cache_req.is_descending,
        },
    )
    .await
    {
        results.push((local_node.unwrap(), local_resp));
    }

    match results
        .iter()
        .filter(|(_, cache_meta)| {
            // to make sure there is overlap between cache time range and query time range &
            log::info!(
                "[CACHE CANDIDATES {trace_id}] get_cached_results->grpc: cache_meta.response_start_time: {}, cache_meta.response_end_time: {}",
                cache_meta.response_start_time,
                cache_meta.response_end_time);

            cache_meta.response_start_time <= cache_req.q_end_time
                && cache_meta.response_end_time >= cache_req.q_start_time
        })
        .max_by_key(|(_, result)| {
            result.response_end_time -result.response_start_time
        }) {
        Some((node, result)) => {
            log::info!(
                "[CACHE SELECTED {trace_id}] get_cached_results->cluster: node: {}, get cached result took {} ms selected cache cache_meta.response_start_time: {}, cache_meta.response_end_time: {}",
                &node.grpc_addr,
                start.elapsed().as_millis(),
                result.response_start_time,
                result.response_end_time
            );
            Some(result.clone())
        }
        None => None,
    }
}

pub async fn delete_cached_results(path: String) -> bool {
    let trace_id = path.clone();
    let mut delete_response = true;
    // get nodes from cluster
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(None).await {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] delete_cached_results: no querier node online");
            return false;
        }
    };
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);

    nodes.sort_by_key(|x| x.id);

    let local_node = infra_cluster::get_node_by_uuid(LOCAL_NODE.uuid.as_str()).await;
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
                let req = DeleteResultCacheRequest {
                   path: local_path.clone(),
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
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(super::super::server_internal_error("querier node error"));
                    }
                };

                Ok((node.clone(), response))
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }
    match crate::service::search::cache::cacher::delete_cache(&path).await {
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
