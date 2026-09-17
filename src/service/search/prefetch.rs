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

use config::{
    get_config,
    meta::{
        cluster::{Role, RoleGroup, get_internal_grpc_token},
        stream::StreamType,
    },
    metrics,
    utils::inverted_index::convert_parquet_file_name_to_tantivy_file,
};
use hashbrown::HashMap;
use infra::cluster;
use proto::cluster_rpc::{PreCacheFileEntry, PreCacheRequest, event_client::EventClient};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue};

/// Handle returned by `prefetch_partitions` — dropping it cancels outstanding
/// pre-fetch tasks.
pub struct PrefetchHandle {
    cancel_tx: tokio::sync::watch::Sender<bool>,
}

impl PrefetchHandle {
    fn new() -> (Self, tokio::sync::watch::Receiver<bool>) {
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        (Self { cancel_tx }, cancel_rx)
    }
}

impl Drop for PrefetchHandle {
    fn drop(&mut self) {
        let _ = self.cancel_tx.send(true);
    }
}

/// Pre-fetch files for upcoming partitions so querier nodes can start
/// downloading from object storage before the search loop reaches them.
///
/// Returns `Some(PrefetchHandle)` on success — drop it to cancel outstanding
/// work. Returns `None` if there is nothing to prefetch or an error occurs
/// during setup.
pub async fn prefetch_partitions(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    partitions: &[[i64; 2]],
    role_group: Option<RoleGroup>,
) -> Option<PrefetchHandle> {
    if partitions.is_empty() {
        return None;
    }

    let cfg = get_config();
    let start = std::time::Instant::now();

    // 1. Compute the combined time range spanning all look-ahead partitions
    let min_start = partitions.iter().map(|p| p[0]).min().unwrap();
    let max_end = partitions.iter().map(|p| p[1]).max().unwrap();

    // 2. Query file IDs for the combined range
    let file_ids = match crate::service::file_list::query_ids(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        (min_start, max_end),
    )
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            log::debug!("[PRE-CACHE trace_id {trace_id}] Failed to query file IDs: {e}");
            metrics::SEARCH_PREFETCH_REQUESTS_TOTAL
                .with_label_values(&["failed"])
                .inc();
            return None;
        }
    };

    if file_ids.is_empty() {
        return None;
    }

    // Extract just the i64 IDs for query_by_ids
    let ids: Vec<i64> = file_ids
        .iter()
        .take(cfg.limit.search_prefetch_max_files)
        .map(|f| f.id)
        .collect();

    // 3. Query full FileKey metadata
    let file_keys = match crate::service::file_list::query_by_ids(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        Some((min_start, max_end)),
        &ids,
    )
    .await
    {
        Ok(keys) => keys,
        Err(e) => {
            log::debug!("[PRE-CACHE trace_id {trace_id}] Failed to query file keys: {e}");
            metrics::SEARCH_PREFETCH_REQUESTS_TOTAL
                .with_label_values(&["failed"])
                .inc();
            return None;
        }
    };

    if file_keys.is_empty() {
        return None;
    }

    // 4. Map each file to its target querier node via consistent hashing and group the files by
    //    node gRPC address. The hash ring yields node *names*, so resolve them to addresses via the
    //    cached online querier list.
    let querier_addrs: HashMap<String, String> =
        cluster::get_cached_online_querier_nodes(role_group)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|n| (n.name, n.grpc_addr))
            .collect();
    if querier_addrs.is_empty() {
        log::debug!("[PRE-CACHE trace_id {trace_id}] no online querier nodes");
        return None;
    }
    let mut node_files: HashMap<String, Vec<PreCacheFileEntry>> = HashMap::new();

    for fk in &file_keys {
        let node_name =
            cluster::get_node_from_consistent_hash(&fk.id.to_string(), &Role::Querier, role_group)
                .await;

        let node_addr = match node_name.as_ref().and_then(|n| querier_addrs.get(n)) {
            Some(addr) => addr.clone(),
            None => continue,
        };

        // Add parquet file entry
        node_files
            .entry(node_addr.clone())
            .or_default()
            .push(PreCacheFileEntry {
                file_id: fk.id,
                account: fk.account.clone(),
                file_path: fk.key.clone(),
                file_size: fk.meta.compressed_size,
                max_ts: fk.meta.max_ts,
            });

        // Also add tantivy index file if it exists
        if fk.meta.index_size > 0 {
            if let Some(ttv_path) = convert_parquet_file_name_to_tantivy_file(&fk.key) {
                node_files
                    .entry(node_addr)
                    .or_default()
                    .push(PreCacheFileEntry {
                        file_id: fk.id,
                        account: fk.account.clone(),
                        file_path: ttv_path,
                        file_size: fk.meta.index_size,
                        max_ts: fk.meta.max_ts,
                    });
            }
        }
    }

    if node_files.is_empty() {
        return None;
    }

    // 5. Spawn async tasks to send PreCacheFiles gRPC to each node
    let (handle, cancel_rx) = PrefetchHandle::new();
    let trace_id = trace_id.to_string();

    for (node_addr, files) in node_files {
        let trace_id = trace_id.clone();
        let mut cancel_rx = cancel_rx.clone();
        let file_count = files.len();

        tokio::spawn(async move {
            tokio::select! {
                _ = cancel_rx.changed() => {
                    log::debug!(
                        "[PRE-CACHE trace_id {trace_id}] Cancelled pre-cache to {node_addr}"
                    );
                    metrics::SEARCH_PREFETCH_REQUESTS_TOTAL
                        .with_label_values(&["cancelled"])
                        .inc();
                }
                result = send_pre_cache_request(&trace_id, &node_addr, files) => {
                    match result {
                        Ok(()) => {
                            log::info!(
                                "[PRE-CACHE trace_id {trace_id}] Sent {file_count} files to {node_addr}"
                            );
                            metrics::SEARCH_PREFETCH_REQUESTS_TOTAL
                                .with_label_values(&["sent"])
                                .inc();
                        }
                        Err(e) => {
                            log::debug!(
                                "[PRE-CACHE trace_id {trace_id}] Failed to send to {node_addr}: {e}"
                            );
                            metrics::SEARCH_PREFETCH_REQUESTS_TOTAL
                                .with_label_values(&["failed"])
                                .inc();
                        }
                    }
                }
            }
        });
    }

    let elapsed = start.elapsed().as_secs_f64();
    metrics::SEARCH_PREFETCH_DURATION_SECONDS.observe(elapsed);

    log::info!(
        "[PRE-CACHE trace_id {trace_id}] Initiated pre-fetch for {} partitions, {} files in {elapsed:.3}s",
        partitions.len(),
        file_keys.len(),
    );

    Some(handle)
}

/// Send a PreCacheFiles gRPC request to a single querier node.
async fn send_pre_cache_request(
    trace_id: &str,
    node_addr: &str,
    files: Vec<PreCacheFileEntry>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid gRPC token"))?;

    let channel = infra::client::grpc::get_cached_channel(node_addr)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get gRPC channel to {node_addr}: {e}"))?;

    let mut client = EventClient::with_interceptor(channel, move |mut req: tonic::Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        Ok(req)
    });

    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    let request = tonic::Request::new(PreCacheRequest {
        trace_id: trace_id.to_string(),
        files,
    });

    client
        .pre_cache_files(request)
        .await
        .map_err(|e| anyhow::anyhow!("PreCacheFiles RPC failed: {e}"))?;

    Ok(())
}
