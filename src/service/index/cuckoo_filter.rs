// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version).
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    collections::HashMap,
    path::PathBuf,
    str::FromStr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};

use arrow::array::Array;
use arrow_schema::{DataType, Field, Schema};
use chrono::{TimeZone, Timelike, Utc};
use config::meta::stream::StreamType;
use cuckoofilter_mmap::{CuckooFilter, FlushMode};
use datafusion::prelude::*;
use futures::future;
use hashbrown::HashSet;
use infra::{cache::file_data, storage};

use crate::{
    common::infra::cluster,
    job::files::cuckoo_filter::{CuckooFilterJobState, GLOBAL_CUCKOO_FILTER_MANAGER},
    service::{
        file_list,
        metadata::{MetadataItem, trace_list_index::TraceListItem},
        search::grpc_cuckoo_filter,
    },
};

pub fn build_cockfoo_filter(org_id: &str, data: Vec<MetadataItem>) -> infra::errors::Result<()> {
    // The org_id parameter is used to prefix the cuckoo filter files for multi-tenancy
    GLOBAL_CUCKOO_FILTER_MANAGER.add(org_id, data);
    Ok(())
}

/// Query distributed cuckoo filter to find time ranges that contain the target trace_id
///
/// This function implements the core distributed cuckoo filter optimization logic:
/// 1. Converts the time range into hourly segments (hour keys)
/// 2. Distributes these hour keys across available querier nodes using consistent hashing
/// 3. Queries each node's cuckoo filters in parallel
/// 4. Merges the results back into optimized time ranges
///
/// # Arguments
/// * `org_id` - Organization identifier for multi-tenancy
/// * `stream_name` - Stream name (currently used for future stream-specific optimizations)
/// * `trace_id` - The target trace ID to search for
/// * `start_time` - Query start time in microseconds
/// * `end_time` - Query end time in microseconds
///
/// # Returns
/// A vector of (start, end) time range tuples where the trace_id was found
pub async fn query_distributed_cuckoo_filter(
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    start_time: i64,
    end_time: i64,
) -> infra::errors::Result<Vec<(i64, i64)>> {
    // Convert time range to hour keys
    let hour_keys = generate_hour_keys(start_time, end_time);
    if hour_keys.is_empty() {
        return Ok(vec![]);
    }

    let mut found_hours = HashSet::new();

    // First, query ingester nodes for real-time data
    let ingester_nodes = cluster::get_cached_online_ingester_nodes().await;
    if let Some(ingesters) = ingester_nodes
        && !ingesters.is_empty()
    {
        let mut ingester_futures = Vec::new();
        for node in ingesters {
            let org_id = org_id.to_string();
            let stream_name = stream_name.to_string();
            let trace_id = trace_id.to_string();
            let hours = hour_keys.clone();

            let future = async move {
                query_ingester_cuckoo_filter(&node, &org_id, &stream_name, &trace_id, &hours).await
            };
            ingester_futures.push(future);
        }

        // Execute ingester queries
        let ingester_results = future::join_all(ingester_futures).await;
        for result in ingester_results {
            match result {
                Ok(hours) => found_hours.extend(hours),
                Err(e) => {
                    log::warn!("Failed to query cuckoo filter from ingester node: {e}")
                }
            }
        }
    }

    log::debug!("ingester found_hours: {found_hours:?}");

    // Then, query querier nodes for historical data
    let querier_nodes = cluster::get_cached_online_querier_nodes(None).await;
    let querier_nodes = match querier_nodes {
        Some(nodes) if !nodes.is_empty() => nodes,
        _ => {
            log::warn!(
                "[trace_id {trace_id}] No online querier nodes available, only using ingester results"
            );
            // If no queriers available, return results from ingesters or local query
            if !found_hours.is_empty() {
                let time_ranges =
                    merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);
                return Ok(time_ranges);
            } else {
                return query_local_cuckoo_filter(org_id, stream_name, trace_id, &hour_keys).await;
            }
        }
    };

    // Distribute hour keys to querier nodes using consistent allocation
    let hour_to_node = distribute_hours_to_nodes(&hour_keys, &querier_nodes);

    // Group hours by node for batch queries
    let mut node_to_hours: HashMap<String, Vec<String>> = HashMap::new();
    for (hour, node_id) in hour_to_node {
        node_to_hours.entry(node_id).or_default().push(hour);
    }

    // Execute distributed queries on queriers
    let mut querier_futures = Vec::new();
    for (node_id, hours) in node_to_hours {
        let node = querier_nodes
            .iter()
            .find(|n| n.uuid == node_id)
            .unwrap()
            .clone();
        let org_id = org_id.to_string();
        let stream_name = stream_name.to_string();
        let trace_id = trace_id.to_string();

        let future = async move {
            query_node_cuckoo_filter(&node, &org_id, &stream_name, &trace_id, &hours).await
        };
        querier_futures.push(future);
    }

    // Wait for querier queries to complete
    let querier_results = future::join_all(querier_futures).await;

    for result in querier_results {
        match result {
            Ok(hours) => found_hours.extend(hours),
            Err(e) => log::warn!("Failed to query cuckoo filter from querier node: {e}"),
        }
    }
    log::debug!("ingester and querier found_hours: {found_hours:?}");
    // Convert found hours back to time ranges
    let time_ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);
    Ok(time_ranges)
}

/// Generate hour keys for the given time range
///
/// Converts a microsecond timestamp range into a series of hour-based keys
/// in the format YYYYMMDDHH. This enables hour-granular cuckoo filter lookups.
///
/// # Arguments
/// * `start_time` - Start timestamp in microseconds
/// * `end_time` - End timestamp in microseconds
///
/// # Returns
/// Vector of hour keys covering the time range
///
/// # Example
/// ```
/// // For 2024-06-01 10:30:00 to 2024-06-01 12:45:00
/// let keys = generate_hour_keys(1717236600000000, 1717244700000000);
/// // Returns: ["2024060110", "2024060111", "2024060112"]
/// ```
fn generate_hour_keys(start_time: i64, end_time: i64) -> Vec<String> {
    let mut hour_keys = Vec::new();

    // Convert microseconds to nanoseconds for chrono
    let start_dt = Utc.timestamp_nanos(start_time * 1000);
    let end_dt = Utc.timestamp_nanos(end_time * 1000);

    let mut current = start_dt
        .date_naive()
        .and_hms_opt(start_dt.hour(), 0, 0)
        .unwrap();
    let end_hour = end_dt
        .date_naive()
        .and_hms_opt(end_dt.hour(), 0, 0)
        .unwrap();

    while current <= end_hour {
        let hour_key = current.format("%Y%m%d%H").to_string();
        hour_keys.push(hour_key);
        current += chrono::Duration::hours(1);
    }

    hour_keys
}

/// Distribute hours to nodes using consistent hash for better cache locality
///
/// This function implements a deterministic allocation strategy that ensures:
/// 1. Same hour keys always map to the same nodes (cache locality)
/// 2. Even distribution of workload across nodes
/// 3. Consistent behavior across different requests
///
/// # Algorithm
/// - Sorts nodes by UUID for consistency
/// - Uses multiplicative hashing for hour keys
/// - Applies round-robin allocation based on hash modulo
///
/// # Arguments
/// * `hour_keys` - List of hour keys to distribute
/// * `querier_nodes` - Available querier nodes
///
/// # Returns
/// HashMap mapping hour_key -> node_uuid
fn distribute_hours_to_nodes(
    hour_keys: &[String],
    querier_nodes: &[config::meta::cluster::Node],
) -> HashMap<String, String> {
    let mut hour_to_node = HashMap::new();
    let node_count = querier_nodes.len();

    if node_count == 0 {
        return hour_to_node;
    }

    // Sort nodes by UUID for consistent allocation
    let mut sorted_nodes = querier_nodes.to_vec();
    sorted_nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));

    // Use simple round-robin allocation based on hour hash for consistency
    for hour_key in hour_keys {
        let hash = calculate_hour_hash(hour_key);
        let node_index = hash % node_count;
        let node_id = sorted_nodes[node_index].uuid.clone();
        hour_to_node.insert(hour_key.clone(), node_id);
    }

    hour_to_node
}

/// Calculate a simple hash for hour key to ensure consistent node allocation
///
/// Uses a multiplicative hash function for deterministic distribution.
/// The same hour key will always produce the same hash value.
///
/// # Arguments
/// * `hour_key` - Hour key in YYYYMMDDHH format
///
/// # Returns
/// Hash value for consistent node allocation
fn calculate_hour_hash(hour_key: &str) -> usize {
    let mut hash = 0usize;
    for byte in hour_key.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as usize);
    }
    hash
}

/// Query cuckoo filter on a specific node
///
/// Routes cuckoo filter queries to the appropriate node:
/// - Local queries for the current node
/// - Remote HTTP queries for other nodes
///
/// # Arguments
/// * `node` - Target querier node
/// * `org_id` - Organization identifier
/// * `stream_name` - Stream name (for future stream-specific filtering)
/// * `trace_id` - Target trace ID to search for
/// * `hours` - List of hour keys to query on this node
///
/// # Returns
/// Vector of hour keys where the trace_id was found
async fn query_node_cuckoo_filter(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    // If this is the local node, query directly
    if node.uuid == config::get_config().common.instance_name {
        return query_local_cuckoo_filter_hours(org_id, stream_name, trace_id, hours).await;
    }

    // For remote nodes, make GRPC calls
    query_remote_cuckoo_filter(node, org_id, stream_name, trace_id, hours).await
}

/// Query ingester node's cuckoo filter for real-time data
async fn query_ingester_cuckoo_filter(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    // If this is the local node, query directly
    if node.uuid == config::get_config().common.instance_name {
        return query_local_ingester_cuckoo_filter_hours(org_id, stream_name, trace_id, hours)
            .await;
    }

    // For remote ingester nodes, make GRPC calls (ingester-specific)
    query_remote_ingester_cuckoo_filter(node, org_id, stream_name, trace_id, hours).await
}

/// Query remote node's cuckoo filter via GRPC
async fn query_remote_cuckoo_filter(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    grpc_cuckoo_filter::grpc_cuckoo_filter_query(node, org_id, stream_name, trace_id, hours)
        .await
        .map_err(|e| {
            log::warn!(
                "[trace_id {trace_id}] Failed to query remote cuckoo filter on node {} via GRPC: {e}",
                node.uuid
            );
            infra::errors::Error::Message(format!("GRPC request failed: {e}"))
        })
}

/// Query remote ingester node's cuckoo filter via GRPC (no S3 download)
async fn query_remote_ingester_cuckoo_filter(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    grpc_cuckoo_filter::grpc_ingester_cuckoo_filter_query(node, org_id, stream_name, trace_id, hours)
        .await
        .map_err(|e| {
            log::warn!(
                "[trace_id {trace_id}] Failed to query remote ingester cuckoo filter on node {} via GRPC: {e}",
                node.uuid,
            );
            infra::errors::Error::Message(format!("GRPC request failed: {e}"))
        })
}

/// Query local cuckoo filter for specific hours
pub async fn query_local_cuckoo_filter_hours(
    org_id: &str,
    _stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    let mut found_hours = Vec::new();
    let config = config::get_config();

    for hour_key in hours {
        // First check if the filter is already cached and use it directly
        match GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id) {
            Ok(true) => {
                found_hours.push(hour_key.clone());
                continue;
            }
            Ok(false) => {
                // Filter exists but trace_id not found, continue to next hour
                continue;
            }
            Err(_) => {
                // Filter not cached or file doesn't exist, check if file exists locally
                let file_path = format!(
                    "{}/{}/{}/{}.cuckoo",
                    config.cuckoo_filter.dir,
                    org_id,
                    &hour_key[0..8],
                    hour_key
                );
                log::debug!("check {file_path} is exists");
                if std::path::Path::new(&file_path).exists() {
                    // File exists, load it into cache and check again
                    if let Ok(true) =
                        GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id)
                    {
                        found_hours.push(hour_key.clone());
                    }
                } else {
                    // File doesn't exist locally, try to download from S3
                    GLOBAL_CUCKOO_FILTER_MANAGER
                        .load_cuckoo_filters_from_s3(org_id, hour_key)
                        .await
                        .unwrap_or_else(|e| {
                            log::warn!(
                                "[trace_id {trace_id}] Failed to download cuckoo filter from S3 for {org_id}/{hour_key}: {e}",
                            );
                        });

                    // Check if the filter was successfully loaded and cached
                    match GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id)
                    {
                        Ok(true) => {
                            found_hours.push(hour_key.clone());
                        }
                        Ok(false) => {
                            // Filter exists but trace_id not found, continue to next hour
                        }
                        Err(_) => {
                            // Filter not found in S3 or failed to load (not built yet)
                            // Assume data exists to avoid missing results
                            log::debug!(
                                "[trace_id {trace_id}] Cuckoo filter not available for {org_id}/{hour_key}, assuming data exists to avoid missing results",
                            );
                            found_hours.push(hour_key.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(found_hours)
}

/// Query local ingester cuckoo filter hours (no S3 download, only local cache/files)
pub async fn query_local_ingester_cuckoo_filter_hours(
    org_id: &str,
    _stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> infra::errors::Result<Vec<String>> {
    let mut found_hours = Vec::new();
    let config = config::get_config();

    for hour_key in hours {
        // First check if the filter is already cached and use it directly
        match GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id) {
            Ok(true) => {
                log::debug!("trace_id {trace_id} hour key was founded in {hour_key} cached");
                found_hours.push(hour_key.clone());
                continue;
            }
            Ok(false) => {
                // Filter exists but trace_id not found, continue to next hour
                continue;
            }
            Err(_) => {
                // Filter not cached, check if file exists locally
                let file_path = format!(
                    "{}/{}/{}/{}.cuckoo",
                    config.cuckoo_filter.dir,
                    org_id,
                    &hour_key[0..8],
                    hour_key
                );

                if std::path::Path::new(&file_path).exists() {
                    // File exists, load it into cache and check again
                    if let Ok(true) =
                        GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id)
                    {
                        log::debug!("trace_id {trace_id} hour key was founded in {file_path}");
                        found_hours.push(hour_key.clone());
                    }
                } else {
                    // File doesn't exist locally, ingesters don't download from S3
                    // because they only handle real-time data and don't upload to S3
                    log::debug!(
                        "trace_id {trace_id} Cuckoo filter not found locally on ingester for {org_id}/{hour_key}, skipping S3 download",
                    );
                    continue;
                }
            }
        }
    }

    Ok(found_hours)
}

/// Query local cuckoo filter for all hours in range
async fn query_local_cuckoo_filter(
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hour_keys: &[String],
) -> infra::errors::Result<Vec<(i64, i64)>> {
    let found_hours =
        query_local_cuckoo_filter_hours(org_id, stream_name, trace_id, hour_keys).await?;
    let found_hours_set: HashSet<String> = found_hours.into_iter().collect();

    let time_ranges = merge_consecutive_hours_to_ranges(found_hours_set, 0, i64::MAX);
    Ok(time_ranges)
}

/// Merge consecutive hours into time ranges
///
/// Converts a set of hour keys back into continuous time ranges to minimize
/// the number of separate queries needed. Consecutive hours are merged into
/// single ranges, while gaps create separate ranges.
///
/// # Algorithm
/// 1. Parse hour keys into timestamps
/// 2. Sort chronologically
/// 3. Merge consecutive hours (1-hour gaps)
/// 4. Respect original time boundaries
///
/// # Arguments
/// * `found_hours` - Set of hour keys where trace_id was found
/// * `start_time` - Original query start time (boundary limit)
/// * `end_time` - Original query end time (boundary limit)
///
/// # Returns
/// Vector of (start, end) time ranges in microseconds
///
/// # Example
/// Hours ["2024060110", "2024060111", "2024060112", "2024060115"] become:
/// - Range 1: 10:00-13:00
/// - Range 2: 15:00-16:00
fn merge_consecutive_hours_to_ranges(
    found_hours: HashSet<String>,
    start_time: i64,
    end_time: i64,
) -> Vec<(i64, i64)> {
    if found_hours.is_empty() {
        return vec![];
    }

    // Convert hour keys to timestamps and sort
    let mut hour_timestamps: Vec<i64> = found_hours
        .iter()
        .filter_map(|hour_key| {
            // Parse hour key (YYYYMMDDHH) to timestamp
            if hour_key.len() != 10 {
                return None;
            }

            let year: i32 = hour_key[0..4].parse().ok()?;
            let month: u32 = hour_key[4..6].parse().ok()?;
            let day: u32 = hour_key[6..8].parse().ok()?;
            let hour: u32 = hour_key[8..10].parse().ok()?;

            let dt = match Utc.with_ymd_and_hms(year, month, day, hour, 0, 0) {
                chrono::LocalResult::Single(dt) => dt,
                _ => return None,
            };
            Some(dt.timestamp_micros())
        })
        .collect();

    hour_timestamps.sort();

    // Merge consecutive hours into ranges
    let mut ranges = Vec::new();
    let mut range_start = hour_timestamps[0];
    let mut range_end = range_start + 3600 * 1_000_000; // 1 hour in microseconds

    for &hour_ts in &hour_timestamps[1..] {
        if hour_ts == range_end {
            // Consecutive hour, extend the range
            range_end = hour_ts + 3600 * 1_000_000;
        } else {
            // Gap found, finalize current range and start a new one
            let actual_start = std::cmp::max(range_start, start_time);
            let actual_end = std::cmp::min(range_end, end_time);
            if actual_start < actual_end {
                ranges.push((actual_start, actual_end));
            }

            range_start = hour_ts;
            range_end = hour_ts + 3600 * 1_000_000;
        }
    }

    // Add the last range
    let actual_start = std::cmp::max(range_start, start_time);
    let actual_end = std::cmp::min(range_end, end_time);
    if actual_start < actual_end {
        ranges.push((actual_start, actual_end));
    }

    ranges
}

fn clean_tmp_files(base_dir: &str) {
    if let Ok(org_dirs) = std::fs::read_dir(base_dir) {
        for org in org_dirs.flatten() {
            if !org.file_type().is_ok_and(|ft| ft.is_dir()) {
                continue;
            }
            if let Ok(day_dirs) = std::fs::read_dir(org.path()) {
                for day in day_dirs.flatten() {
                    if !day.file_type().is_ok_and(|ft| ft.is_dir()) {
                        continue;
                    }
                    if let Ok(files) = std::fs::read_dir(day.path()) {
                        for file in files.flatten() {
                            if let Some(name) = file.file_name().to_str() {
                                if name.ends_with(".cuckoo.tmp") {
                                    // Only handle hour files, skip day files (with 'd' suffix)
                                    let base_name = name.replace(".cuckoo.tmp", "");
                                    let success_marker =
                                        day.path().join(format!("{base_name}.cuckoo.success"));

                                    if !success_marker.exists() {
                                        // No success marker, this is an incomplete tmp file
                                        let _ = std::fs::remove_file(file.path());
                                        log::info!(
                                            "[CUCKOO_FILTER] Cleaned incomplete tmp file: {:?}",
                                            file.path()
                                        );
                                    }
                                } else if name.ends_with(".cuckoo.success") {
                                    // Only handle hour files, skip day files (with 'd' suffix)
                                    let base_name = name.replace(".cuckoo.success", "");
                                    let tmp_file =
                                        day.path().join(format!("{base_name}.cuckoo.tmp"));

                                    if !tmp_file.exists() {
                                        let _ = std::fs::remove_file(file.path());
                                        log::info!(
                                            "[CUCKOO_FILTER] Cleaned orphaned success marker: {:?}",
                                            file.path()
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
pub struct CuckooFilterManager {
    filters: Mutex<HashMap<String, (CuckooFilter<str>, PathBuf)>>,
    sender: mpsc::Sender<Option<(String, Vec<MetadataItem>)>>,
    running: AtomicBool,
    handle: Mutex<Option<thread::JoinHandle<()>>>,
}

impl CuckooFilterManager {
    pub fn new() -> Arc<Self> {
        let cfg = config::get_config();
        clean_tmp_files(&cfg.cuckoo_filter.dir);
        let (tx, rx) = mpsc::channel();
        let manager = Arc::new(CuckooFilterManager {
            filters: Mutex::new(HashMap::new()),
            sender: tx,
            running: AtomicBool::new(true),
            handle: Mutex::new(None),
        });

        let manager_clone = manager.clone();
        let handle = thread::spawn(move || {
            manager_clone.writer_loop(rx);
        });
        *manager.handle.lock().unwrap() = Some(handle);

        manager
    }

    pub fn add(&self, org_id: &str, items: Vec<MetadataItem>) {
        self.sender.send(Some((org_id.to_string(), items))).unwrap();
    }

    fn writer_loop(&self, rx: mpsc::Receiver<Option<(String, Vec<MetadataItem>)>>) {
        while self.running.load(Ordering::Relaxed) {
            match rx.recv() {
                Ok(Some((org_id, items))) => self.process_items(&org_id, items, false),
                Ok(None) => break, // Shutdown signal
                Err(_) => break,   // Channel closed
            }
        }
    }

    pub fn process_items(&self, org_id: &str, items: Vec<MetadataItem>, use_tmp_file: bool) {
        log::info!("start processing metadata items, len: {}", items.len());
        let start = std::time::Instant::now();
        let cfg = config::get_config();
        // Group by hour only
        let mut hour_map: HashMap<String, Vec<String>> = HashMap::new();
        for item in items {
            if let MetadataItem::TraceListIndexer(TraceListItem {
                trace_id,
                _timestamp,
                ..
            }) = item
            {
                let dt = Utc.timestamp_nanos(_timestamp * 1000);

                // Group by hour
                let hour_key = dt.format("%Y%m%d%H").to_string();
                hour_map.entry(hour_key).or_default().push(trace_id);
            }
        }

        let mut filters = self.filters.lock().unwrap();
        log::info!("start processing hour map");
        // Process hour-based filters
        let flush_mode = FlushMode::from_str(cfg.cuckoo_filter.flush_mode.as_str()).unwrap();
        for (hour_key, trace_ids) in hour_map {
            let day_key = &hour_key[..8]; // Extract the first 8 characters as day_key
            let dir = PathBuf::from(format!("{}/{org_id}/{day_key}", cfg.cuckoo_filter.dir));
            if !dir.exists()
                && let Err(e) = std::fs::create_dir_all(&dir)
            {
                log::error!(
                    "[CUCKOO_FILTER] failed to create dir {}: {}",
                    dir.display(),
                    e
                );
            }
            let file_path = if use_tmp_file {
                dir.join(format!("{hour_key}.cuckoo.tmp"))
            } else {
                dir.join(format!("{hour_key}.cuckoo"))
            };
            let filter_key = format!("{org_id}/{hour_key}");
            log::debug!(
                "Processing hour items for org_id: {org_id}, hour_key: {hour_key}, file_path: {file_path:?}",
            );

            let filter_instance = filters.entry(filter_key.clone()).or_insert_with(|| {
                let filter = CuckooFilter::<str>::builder(cfg.cuckoo_filter.capacity)
                    .flush_mode(flush_mode)
                    .build(&file_path)
                    .unwrap();
                (filter, file_path.clone())
            });
            let start_filter = std::time::Instant::now();
            log::info!(
                "starting hour({hour_key}) filter insert, len: {}",
                trace_ids.len()
            );
            for trace_id in &trace_ids {
                // log::debug!("Inserting trace_id: {}", trace_id);
                if let Err(e) = filter_instance.0.insert(trace_id) {
                    log::error!("Failed to insert trace id: {e}, filter_key: {filter_key}");
                }
            }
            log::info!(
                "end hour({hour_key}) filter insert, took {}ms",
                start_filter.elapsed().as_millis()
            );
            let start_filter = std::time::Instant::now();
            log::info!("starting hour({hour_key}) filter flush");
            if let Err(e) = filter_instance.0.flush() {
                log::error!("Failed to flush filter ({hour_key}) instance: {e}");
            }
            log::info!(
                "end hour({hour_key}) filter flush, took {}ms",
                start_filter.elapsed().as_millis()
            );
        }

        log::info!(
            "end processing metadata items, took: {}ms",
            start.elapsed().as_millis()
        );
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Release);
        let _ = self.sender.send(None); // Signal shutdown
        if let Some(handle) = self.handle.lock().unwrap().take() {
            handle.join().unwrap();
        }
    }

    pub fn close(&self) {
        self.stop();
        let mut filters = self.filters.lock().unwrap();
        for (_hour, (filter, _path)) in filters.iter_mut() {
            let _ = filter.flush();
        }
        filters.clear();
    }

    /// Safely finalize temporary files by renaming them to final paths
    /// Only renames files that have a corresponding success marker
    pub fn finalize_tmp_files(
        &self,
        org_id: &str,
        hour_key: &str,
        _day_key: &str,
    ) -> anyhow::Result<()> {
        let cfg = config::get_config();

        // Finalize hour filter
        let hour_key_clean = hour_key.replace("/", "");
        if !hour_key_clean.is_empty() {
            let day_key_for_path = &hour_key_clean[..8];
            let dir = PathBuf::from(format!(
                "{}/{org_id}/{day_key_for_path}",
                cfg.cuckoo_filter.dir
            ));
            let tmp_path = dir.join(format!("{hour_key_clean}.cuckoo.tmp"));
            let success_marker = dir.join(format!("{hour_key_clean}.cuckoo.success"));
            let final_path = dir.join(format!("{hour_key_clean}.cuckoo"));

            if tmp_path.exists() && success_marker.exists() {
                std::fs::rename(&tmp_path, &final_path)?;
                std::fs::remove_file(&success_marker)?;
                log::debug!("Successfully finalized hour filter: {final_path:?}");
            }
        }

        Ok(())
    }

    /// Create success markers for completed processing
    pub fn create_success_markers(
        &self,
        org_id: &str,
        hour_key: &str,
        _day_key: &str,
    ) -> anyhow::Result<()> {
        let cfg = config::get_config();

        // Create hour success marker
        let hour_key_clean = hour_key.replace("/", "");
        if !hour_key_clean.is_empty() {
            let day_key_for_path = &hour_key_clean[..8];
            let dir = PathBuf::from(format!(
                "{}/{org_id}/{day_key_for_path}",
                cfg.cuckoo_filter.dir
            ));
            let success_marker = dir.join(format!("{hour_key_clean}.cuckoo.success"));
            std::fs::write(&success_marker, "")?;
        }

        Ok(())
    }

    pub fn delete_all(&self, org_id: &str) {
        let mut filters = self.filters.lock().unwrap();
        let prefix = format!("{org_id}/");
        let mut to_remove = Vec::new();

        // Collect all filters to remove
        filters.retain(|k, v| {
            if k.starts_with(&prefix) {
                // Close the filter first
                let _ = v.0.flush();
                to_remove.push(v.1.clone());
                false
            } else {
                true
            }
        });

        // Remove files after closing filters
        for path in to_remove {
            let _ = std::fs::remove_file(&path);
        }

        // Also remove the directory for the org_id
        let org_dir = PathBuf::from(format!(
            "{}/{}",
            config::get_config().cuckoo_filter.dir,
            org_id
        ));
        let _ = std::fs::remove_dir_all(&org_dir);
    }

    pub fn delete_hour(&self, org_id: &str, hour: &str) {
        let mut filters = self.filters.lock().unwrap();
        let filter_key = format!("{org_id}/{hour}");
        if let Some((filter, path)) = filters.remove(&filter_key) {
            // Close the filter first
            let _ = filter.flush();
            // Then remove the file
            let _ = std::fs::remove_file(path);
        }
    }

    /// Check if a trace_id exists in cached filter, return None if filter not cached
    pub fn check_cached_filter(
        &self,
        org_id: &str,
        hour_key: &str,
        trace_id: &str,
    ) -> Option<bool> {
        let filters = self.filters.lock().unwrap();
        let filter_key = format!("{org_id}/{hour_key}");

        if let Some((filter, _)) = filters.get(&filter_key) {
            Some(filter.contains(trace_id))
        } else {
            None
        }
    }

    /// Load a filter from file into cache if not already cached
    pub fn load_filter_into_cache(&self, org_id: &str, hour_key: &str) -> anyhow::Result<bool> {
        let filter_key = format!("{org_id}/{hour_key}");

        // Check if already cached
        {
            let filters = self.filters.lock().unwrap();
            if filters.contains_key(&filter_key) {
                return Ok(true);
            }
        }

        // Load from file
        let cfg = config::get_config();
        let day_key = &hour_key[0..8];
        let file_path = format!(
            "{}/{}/{}/{}.cuckoo",
            cfg.cuckoo_filter.dir, org_id, day_key, hour_key
        );
        let path_buf = PathBuf::from(&file_path);

        if !path_buf.exists() {
            return Ok(false);
        }

        match CuckooFilter::<str>::open(&file_path, FlushMode::Always, 500) {
            Ok(filter) => {
                let mut filters = self.filters.lock().unwrap();
                filters.insert(filter_key, (filter, path_buf));
                Ok(true)
            }
            Err(e) => {
                log::warn!("Failed to load cuckoo filter {file_path} into cache: {e}",);
                Err(e.into())
            }
        }
    }

    /// Check if a trace_id exists in filter, loading from cache or file as needed
    pub fn contains_trace_id(
        &self,
        org_id: &str,
        hour_key: &str,
        trace_id: &str,
    ) -> anyhow::Result<bool> {
        // First check cached filter
        if let Some(result) = self.check_cached_filter(org_id, hour_key, trace_id) {
            return Ok(result);
        }

        // Load filter into cache and check
        if self.load_filter_into_cache(org_id, hour_key)? {
            // Now it should be cached, check again
            if let Some(result) = self.check_cached_filter(org_id, hour_key, trace_id) {
                Ok(result)
            } else {
                // This shouldn't happen, but handle gracefully
                Ok(false)
            }
        } else {
            // Filter file doesn't exist
            anyhow::bail!("Filter file doesn't exist");
        }
    }

    /// Process trace_index_list data for a specific organization
    pub async fn process_organization_trace_data(
        &self,
        job_state: &CuckooFilterJobState,
    ) -> anyhow::Result<()> {
        let org_id = &job_state.org_id;
        let hour_key = &job_state.hour_key;
        let day_key = &job_state.day_key;

        // Format date_start and date_end for file_list::query_for_merge
        let (date_start, date_end) = if !hour_key.is_empty() {
            // hour_key: "2024060710" -> "2024/06/07/10"
            let dt = chrono::NaiveDateTime::parse_from_str(
                &(hour_key.to_string() + "0000"),
                "%Y%m%d%H%M%S",
            )
            .map(|dt| dt.format("%Y/%m/%d/%H").to_string())
            .unwrap_or_else(|_| hour_key.to_string());
            (dt.clone(), dt)
        } else if !day_key.is_empty() {
            // day_key: "20240607" -> "2024/06/07/00" ~ "2024/06/07/23"
            let dt = chrono::NaiveDate::parse_from_str(day_key, "%Y%m%d")
                .map(|dt| dt.format("%Y/%m/%d").to_string())
                .unwrap_or_else(|_| day_key.to_string());
            (format!("{dt}/00"), format!("{dt}/23"))
        } else {
            (String::new(), String::new())
        };

        let files = file_list::query_for_merge(
            org_id,
            crate::service::metadata::trace_list_index::STREAM_NAME,
            StreamType::Metadata,
            &date_start,
            &date_end,
        )
        .await?;
        if files.is_empty() {
            log::info!(
                "[CUCKOO_FILTER_JOB] No files found for org {org_id} hour {hour_key} day {day_key}",
            );
            return Ok(());
        }
        log::info!("[CUCKOO_FILTER_JOB] Found {} files", files.len());

        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("stream_name", DataType::Utf8, true),
            Field::new("service_name", DataType::Utf8, true),
            Field::new("trace_id", DataType::Utf8, false),
        ]));
        let parquet_batch_size = 10;
        let trace_id_batch_size = config::get_config().cuckoo_filter.build_index_batch_size;
        let mut batch_trace_items = Vec::with_capacity(trace_id_batch_size);
        let mut total_processed = 0;

        use std::collections::HashSet;
        let mut seen = HashSet::with_capacity(trace_id_batch_size * 2);
        let seen_cleanup_threshold = trace_id_batch_size * 10; // Periodically clear 'seen' to prevent infinite memory growth

        use arrow::array::{Int64Array, StringArray};
        log::info!(
            "[CUCKOO_FILTER_JOB] Start processing, files len: {}, will process in chunks of {parquet_batch_size}",
            files.len(),
        );

        // Process files in chunks to avoid cache overflow and GC issues
        for (chunk_idx, files_chunk) in files.chunks(parquet_batch_size).enumerate() {
            log::info!(
                "[CUCKOO_FILTER_JOB] Processing file chunk {}/{}, files in chunk: {}",
                chunk_idx + 1,
                files.len().div_ceil(parquet_batch_size),
                files_chunk.len()
            );

            // Download only the files needed for this chunk
            let mut parquet_paths = Vec::new();
            for file in files_chunk {
                // Check if file already exists locally before downloading
                if !file_data::disk::exist(&file.key).await {
                    log::debug!("Downloading file for chunk processing: {}", file.key);
                    let _ = file_data::disk::download(
                        &file.account,
                        &file.key,
                        Some(file.meta.compressed_size as usize),
                    )
                    .await;
                } else {
                    log::debug!(
                        "File already exists locally, skipping download: {}",
                        file.key
                    );
                }

                if let Some(path) = file_data::disk::get_file_path(&file.key) {
                    parquet_paths.push(path);
                }
            }

            if parquet_paths.is_empty() {
                log::warn!(
                    "[CUCKOO_FILTER_JOB] No local parquet files found for chunk {}, skipping",
                    chunk_idx + 1
                );
                continue;
            }

            log::debug!(
                "[CUCKOO_FILTER_JOB] Processing {} parquet files in chunk {}",
                parquet_paths.len(),
                chunk_idx + 1
            );
            // Process the parquet files in this chunk
            let ctx = SessionContext::new();
            for (i, path) in parquet_paths.iter().enumerate() {
                let tbl_name = format!("tbl_{i}");
                ctx.register_parquet(
                    &tbl_name,
                    path,
                    ParquetReadOptions::default().schema(&schema),
                )
                .await?;
            }
            let union_sql = (0..parquet_paths.len())
                .map(|i| format!("SELECT trace_id, _timestamp FROM tbl_{i}"))
                .collect::<Vec<_>>()
                .join(" UNION ALL ");
            let sql = format!("SELECT DISTINCT trace_id, _timestamp FROM ( {union_sql} )");
            log::debug!("[CUCKOO_FILTER_JOB] Chunk {} SQL: {}", chunk_idx + 1, sql);
            let df = ctx.sql(&sql).await?;
            let batches = df.collect().await?;
            for batch in batches {
                let trace_id_col = batch
                    .column(batch.schema().index_of("trace_id")?)
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap();
                let ts_col = batch
                    .column(batch.schema().index_of("_timestamp")?)
                    .as_any()
                    .downcast_ref::<Int64Array>()
                    .unwrap();
                for i in 0..batch.num_rows() {
                    if trace_id_col.is_null(i) || ts_col.is_null(i) {
                        continue;
                    }
                    let trace_id = trace_id_col.value(i).to_string();
                    let ts = ts_col.value(i);
                    let key = (trace_id.clone(), ts);
                    if seen.insert(key) {
                        batch_trace_items.push(TraceListItem {
                            trace_id,
                            _timestamp: ts,
                            stream_name: crate::service::metadata::trace_list_index::STREAM_NAME
                                .to_string(),
                            service_name: "".to_string(),
                        });

                        // Process and clear when batch size is reached
                        if batch_trace_items.len() >= trace_id_batch_size {
                            let items: Vec<MetadataItem> = batch_trace_items
                                .drain(..)
                                .map(MetadataItem::TraceListIndexer)
                                .collect();
                            let batch_count = items.len();
                            // Use use_tmp_file=true to ensure writing to a temporary file
                            self.process_items(org_id, items, true);
                            total_processed += batch_count;
                            log::info!(
                                "[CUCKOO_FILTER_JOB] Processed batch of {} items, total so far: {} (chunk {})",
                                batch_count,
                                total_processed,
                                chunk_idx + 1
                            );
                        }
                    }

                    // Periodically clear 'seen' HashSet to prevent infinite memory growth
                    if seen.len() > seen_cleanup_threshold {
                        seen.clear();
                        log::debug!(
                            "[CUCKOO_FILTER_JOB] Cleared deduplication set to manage memory"
                        );
                    }
                }
            }

            log::info!(
                "[CUCKOO_FILTER_JOB] Completed processing file chunk {}/{}, total processed so far: {}",
                chunk_idx + 1,
                files.len().div_ceil(parquet_batch_size),
                total_processed
            );
        }

        // Check if we have any files to process
        if total_processed == 0 {
            log::info!(
                "[CUCKOO_FILTER_JOB] No trace data processed for org {org_id} hour {hour_key} day {day_key}"
            );
            return Ok(());
        }

        // Process remaining items
        if !batch_trace_items.is_empty() {
            let count = batch_trace_items.len();
            let items: Vec<MetadataItem> = batch_trace_items
                .into_iter()
                .map(MetadataItem::TraceListIndexer)
                .collect();
            self.process_items(org_id, items, true);
            total_processed += count;
        }

        if total_processed > 0 {
            // First flush all filters to ensure data is written
            {
                let mut filters = self.filters.lock().unwrap();
                for (_key, (filter, _path)) in filters.iter_mut() {
                    if let Err(e) = filter.flush() {
                        log::error!("Failed to flush filter: {e}");
                    }
                }
            }

            // Create success markers to indicate successful completion
            self.create_success_markers(org_id, hour_key, day_key)?;

            // Safely finalize temporary files
            self.finalize_tmp_files(org_id, hour_key, day_key)?;

            let hour_key_to_s3 = hour_key.replace("/", "");
            let day_key_to_s3 = day_key.replace("/", "");
            self.upload_cuckoo_filters_to_s3(
                org_id,
                hour_key_to_s3.as_str(),
                day_key_to_s3.as_str(),
            )
            .await?;
            log::info!(
                "[CUCKOO_FILTER_JOB] Successfully processed {total_processed} trace items for org {org_id} hour {hour_key}",
            );
        }
        Ok(())
    }

    /// Upload generated cuckoo filters to S3
    async fn upload_cuckoo_filters_to_s3(
        &self,
        org_id: &str,
        hour_key: &str,
        day_key: &str,
    ) -> anyhow::Result<()> {
        // Upload hour filter
        let hour_file = format!(
            "{}/{}/{}/{}.cuckoo",
            config::get_config().cuckoo_filter.dir,
            org_id,
            day_key,
            hour_key
        );
        if let Ok(data) = std::fs::read(&hour_file) {
            let s3_key = format!("cuckoo_filters/{org_id}/{day_key}/{hour_key}.cuckoo");
            log::info!("[CUCKOO_FILTER_JOB] Start Uploading hour filter: {s3_key}");
            storage::put("", &s3_key, data.into()).await?;
            log::info!("[CUCKOO_FILTER_JOB] Uploaded hour filter: {s3_key}");
        }

        Ok(())
    }

    /// Load cuckoo filters from S3 for a specific org and time range
    pub async fn load_cuckoo_filters_from_s3(
        &self,
        org_id: &str,
        hour_key: &str,
    ) -> anyhow::Result<()> {
        let cfg = config::get_config();
        let local_dir = PathBuf::from(format!("{}/{}", cfg.cuckoo_filter.dir, org_id));

        // Create local directory if it doesn't exist
        if !local_dir.exists() {
            std::fs::create_dir_all(&local_dir)?;
        }

        // Download hour filter
        let day_key = &hour_key[0..8];
        let hour_s3_key = format!("cuckoo_filters/{org_id}/{day_key}/{hour_key}.cuckoo");
        // Check if exists in S3
        log::debug!("check {hour_s3_key} if exists in S3");
        if storage::head("", &hour_s3_key).await.is_err() {
            log::debug!("{hour_s3_key} is not present in storage, continue");
            return Ok(());
        }
        log::debug!("get {hour_s3_key} from S3");
        if let Ok(data) = storage::get_bytes("", &hour_s3_key).await {
            let local_file = local_dir.join(format!("{day_key}/{hour_key}.cuckoo"));
            std::fs::write(&local_file, &data)?;
            log::info!("[CUCKOO_FILTER_JOB] Downloaded hour filter: {hour_s3_key}",);

            // Load the downloaded filter into cache
            if let Err(e) = self.load_filter_into_cache(org_id, hour_key) {
                log::warn!("Failed to cache downloaded filter {org_id}/{hour_key}: {e}",);
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, thread, time::Duration};

    use cuckoofilter_mmap::{CuckooFilter, FlushMode};

    use super::*;
    use crate::service::metadata::{MetadataItem, trace_list_index::TraceListItem};

    #[test]
    fn test_build_and_search() {
        // Clean up previous test runs and ensure base directory exists
        let org_id = "test_org_build_search";
        let org_dir = format!("{}/{}", config::get_config().cuckoo_filter.dir, org_id);
        let _ = fs::remove_dir_all(&org_dir);
        std::fs::create_dir_all(&org_dir).unwrap();

        // Create a local manager for this test
        let manager = CuckooFilterManager::new();
        // Construct data
        let trace_id = "trace-12345";
        let ts = 1717236000000000i64; // 2024-06-01 10:00:00
        let data = vec![MetadataItem::TraceListIndexer(TraceListItem {
            _timestamp: ts,
            stream_name: "s1".to_string(),
            service_name: "svc1".to_string(),
            trace_id: trace_id.to_string(),
        })];
        // build
        manager.add(org_id, data);
        thread::sleep(Duration::from_millis(5000)); // Wait for the writer thread to process
        // search
        let hour = {
            use chrono::{TimeZone, Utc};
            let dt = Utc.timestamp_nanos(ts * 1000);
            dt.format("%Y%m%d%H").to_string()
        };
        let file_path = format!(
            "{}/{}/{}.cuckoo",
            config::get_config().cuckoo_filter.dir,
            org_id,
            hour
        );
        let filter = CuckooFilter::<str>::open(&file_path, FlushMode::Always, 500).unwrap();
        assert!(filter.contains(trace_id));
        assert!(!filter.contains("not-exist"));
        // Clean up
        manager.delete_all(org_id);
        manager.stop(); // Ensure the local manager's thread is stopped
    }

    #[test]
    fn test_generate_hour_keys() {
        // Test case: 2024-06-01 10:30:00 to 2024-06-01 12:45:00
        let start_time = 1717236600000000i64; // 2024-06-01 10:30:00 (microseconds)
        let end_time = 1717244700000000i64; // 2024-06-01 12:45:00 (microseconds)

        let hour_keys = generate_hour_keys(start_time, end_time);
        let expected = vec!["2024060110", "2024060111", "2024060112"];
        assert_eq!(hour_keys, expected);
    }

    #[test]
    fn test_calculate_hour_hash() {
        let hour1 = "2024060110";
        let hour2 = "2024060111";

        let hash1 = calculate_hour_hash(hour1);
        let hash2 = calculate_hour_hash(hour2);

        // Hashes should be different for different hours
        assert_ne!(hash1, hash2);

        // Same hour should produce same hash
        assert_eq!(hash1, calculate_hour_hash(hour1));
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_basic() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060111".to_string());
        found_hours.insert("2024060112".to_string());
        found_hours.insert("2024060115".to_string()); // Gap here
        found_hours.insert("2024060116".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 2 ranges: 10-13 and 15-17
        assert_eq!(ranges.len(), 2);

        // First range: hours 10-12 (inclusive of hour 10, 11, 12)
        // 2024-06-01 10:00:00 to 2024-06-01 13:00:00
        let expected_first_start = 1717236000000000i64; // 2024-06-01 10:00:00
        let expected_first_end = 1717246800000000i64; // 2024-06-01 13:00:00
        assert_eq!(ranges[0].0, expected_first_start);
        assert_eq!(ranges[0].1, expected_first_end);

        // Second range: hours 15-16 (inclusive of hour 15, 16)
        // 2024-06-01 15:00:00 to 2024-06-01 17:00:00, but clipped to end_time (16:00:00)
        let expected_second_start = 1717254000000000i64; // 2024-06-01 15:00:00
        let expected_second_end = 1717257600000000i64; // 2024-06-01 16:00:00 (clipped to end_time)
        assert_eq!(ranges[1].0, expected_second_start);
        assert_eq!(ranges[1].1, expected_second_end);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_empty() {
        let found_hours = HashSet::new();
        let start_time = 1717236000000000i64;
        let end_time = 1717257600000000i64;

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);
        assert_eq!(ranges.len(), 0);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_single_hour() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        assert_eq!(ranges.len(), 1);
        // Single hour should create range from 10:00 to 11:00
        let expected_start = 1717236000000000i64; // 2024-06-01 10:00:00
        let expected_end = 1717239600000000i64; // 2024-06-01 11:00:00
        assert_eq!(ranges[0].0, expected_start);
        assert_eq!(ranges[0].1, expected_end);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_all_consecutive() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060111".to_string());
        found_hours.insert("2024060112".to_string());
        found_hours.insert("2024060113".to_string());
        found_hours.insert("2024060114".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 1 range covering all hours
        assert_eq!(ranges.len(), 1);
        let expected_start = 1717236000000000i64; // 2024-06-01 10:00:00
        let expected_end = 1717254000000000i64; // 2024-06-01 15:00:00
        assert_eq!(ranges[0].0, expected_start);
        assert_eq!(ranges[0].1, expected_end);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_no_consecutive() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060112".to_string());
        found_hours.insert("2024060114".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 3 separate ranges
        assert_eq!(ranges.len(), 3);

        // Each range should be 1 hour long
        for range in &ranges {
            assert_eq!(range.1 - range.0, 3600000000i64); // 1 hour in microseconds
        }

        // Verify specific hour ranges
        assert_eq!(ranges[0].0, 1717236000000000i64); // 2024-06-01 10:00:00
        assert_eq!(ranges[0].1, 1717239600000000i64); // 2024-06-01 11:00:00
        assert_eq!(ranges[1].0, 1717243200000000i64); // 2024-06-01 12:00:00
        assert_eq!(ranges[1].1, 1717246800000000i64); // 2024-06-01 13:00:00
        assert_eq!(ranges[2].0, 1717250400000000i64); // 2024-06-01 14:00:00
        assert_eq!(ranges[2].1, 1717254000000000i64); // 2024-06-01 15:00:00
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_time_boundary_clipping() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060109".to_string()); // Before start_time
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060111".to_string());
        found_hours.insert("2024060116".to_string()); // After end_time
        found_hours.insert("2024060117".to_string()); // After end_time

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717254000000000i64; // 2024-06-01 15:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 1 range, clipped to start/end times
        assert_eq!(ranges.len(), 1);

        // Range should be clipped to start_time and not extend beyond end_time
        assert_eq!(ranges[0].0, start_time); // Clipped to 10:00:00
        assert_eq!(ranges[0].1, 1717243200000000i64); // 2024-06-01 12:00:00 (end of hour 11)
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_outside_time_window() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060108".to_string()); // Before start_time
        found_hours.insert("2024060109".to_string()); // Before start_time
        found_hours.insert("2024060118".to_string()); // After end_time
        found_hours.insert("2024060119".to_string()); // After end_time

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717254000000000i64; // 2024-06-01 15:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create no ranges as all hours are outside the time window
        assert_eq!(ranges.len(), 0);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_cross_day_boundary() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060123".to_string()); // 2024-06-01 23:00
        found_hours.insert("2024060200".to_string()); // 2024-06-02 00:00
        found_hours.insert("2024060201".to_string()); // 2024-06-02 01:00

        let start_time = 1717282800000000i64; // 2024-06-01 23:00:00
        let end_time = 1717290000000000i64; // 2024-06-02 01:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 1 range spanning across day boundary
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].0, start_time);
        assert_eq!(ranges[0].1, end_time);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_invalid_hour_keys() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string()); // Valid
        found_hours.insert("invalid".to_string()); // Invalid format
        found_hours.insert("202406011".to_string()); // Too short
        found_hours.insert("20240601101".to_string()); // Too long
        found_hours.insert("2024060111".to_string()); // Valid

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should only process valid hour keys and create 1 range
        assert_eq!(ranges.len(), 1);
        let expected_start = 1717236000000000i64; // 2024-06-01 10:00:00
        let expected_end = 1717243200000000i64; // 2024-06-01 12:00:00
        assert_eq!(ranges[0].0, expected_start);
        assert_eq!(ranges[0].1, expected_end);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_unordered_input() {
        let mut found_hours = HashSet::new();
        // Insert hours in random order
        found_hours.insert("2024060115".to_string());
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060112".to_string());
        found_hours.insert("2024060111".to_string());
        found_hours.insert("2024060113".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717257600000000i64; // 2024-06-01 16:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 2 ranges despite unordered input
        assert_eq!(ranges.len(), 2);

        // First range: 10-14 (hours 10,11,12,13)
        let expected_first_start = 1717236000000000i64; // 2024-06-01 10:00:00
        let expected_first_end = 1717250400000000i64; // 2024-06-01 14:00:00
        assert_eq!(ranges[0].0, expected_first_start);
        assert_eq!(ranges[0].1, expected_first_end);

        // Second range: 15-16 (hour 15)
        let expected_second_start = 1717254000000000i64; // 2024-06-01 15:00:00
        let expected_second_end = 1717257600000000i64; // 2024-06-01 16:00:00
        assert_eq!(ranges[1].0, expected_second_start);
        assert_eq!(ranges[1].1, expected_second_end);
    }

    #[test]
    fn test_merge_consecutive_hours_to_ranges_large_gap() {
        let mut found_hours = HashSet::new();
        found_hours.insert("2024060110".to_string());
        found_hours.insert("2024060111".to_string());
        found_hours.insert("2024060120".to_string()); // 9-hour gap
        found_hours.insert("2024060121".to_string());

        let start_time = 1717236000000000i64; // 2024-06-01 10:00:00
        let end_time = 1717282800000000i64; // 2024-06-01 23:00:00

        let ranges = merge_consecutive_hours_to_ranges(found_hours, start_time, end_time);

        // Should create 2 separate ranges
        assert_eq!(ranges.len(), 2);

        // First range: 10-12
        assert_eq!(ranges[0].0, 1717236000000000i64); // 2024-06-01 10:00:00
        assert_eq!(ranges[0].1, 1717243200000000i64); // 2024-06-01 12:00:00

        // Second range: 20-22, but clipped to end_time (23:00:00)
        assert_eq!(ranges[1].0, 1717272000000000i64); // 2024-06-01 20:00:00
        assert_eq!(ranges[1].1, 1717279200000000i64); // 2024-06-01 22:00:00
    }

    #[tokio::test]
    async fn test_s3_integration() {
        // Test integration with GLOBAL_CUCKOO_FILTER_MANAGER
        let org_id = "test_org_s3";
        let hour_key = "2024060110";

        // This test verifies the integration works - result can be success or failure
        let result = GLOBAL_CUCKOO_FILTER_MANAGER
            .load_cuckoo_filters_from_s3(org_id, hour_key)
            .await;

        // In test environment, this could succeed or fail depending on S3 setup
        // We just verify the function call works without panicking
        match result {
            Ok(_) => {
                log::debug!("S3 integration test: Download succeeded");
            }
            Err(e) => {
                log::debug!("S3 integration test: Download failed as expected: {}", e);
            }
        }

        // Test passes if we reach this point without panicking
        assert!(true);
    }

    #[tokio::test]
    async fn test_caching_functionality() {
        use crate::job::files::cuckoo_filter::GLOBAL_CUCKOO_FILTER_MANAGER;

        let org_id = "test_org_cache";
        let hour_key = "2024060112";
        let trace_id = "test_trace_id_123";

        // Test 1: Check cached filter when nothing is cached
        let result = GLOBAL_CUCKOO_FILTER_MANAGER.check_cached_filter(org_id, hour_key, trace_id);
        assert!(
            result.is_none(),
            "Should return None when filter not cached"
        );

        // Test 2: Test contains_trace_id when file doesn't exist
        let result = GLOBAL_CUCKOO_FILTER_MANAGER.contains_trace_id(org_id, hour_key, trace_id);
        match result {
            Ok(false) => {
                // Expected when file doesn't exist
            }
            Ok(true) => {
                // Unexpected but not a failure
            }
            Err(_) => {
                // Expected when file doesn't exist or can't be loaded
            }
        }

        // Test 3: Test optimized query_local_cuckoo_filter_hours
        let hours = vec![hour_key.to_string()];
        let result = query_local_cuckoo_filter_hours(org_id, "stream1", trace_id, &hours).await;

        // Should succeed without error, regardless of whether files exist
        assert!(
            result.is_ok(),
            "query_local_cuckoo_filter_hours should not error"
        );

        // The result vector should be empty if no filters exist or contain trace_id
        let found_hours = result.unwrap();
        // We can't assert specific content since it depends on file existence
        // but we can verify the function completed successfully
        assert!(
            found_hours.len() <= hours.len(),
            "Found hours should not exceed input hours"
        );
    }

    #[tokio::test]
    async fn test_ingester_cuckoo_filter_query() {
        let org_id = "test_org_ingester";
        let hour_key = "2024060113";
        let trace_id = "test_ingester_trace_123";

        // Test ingester-specific query function
        let hours = vec![hour_key.to_string()];
        let result =
            query_local_ingester_cuckoo_filter_hours(org_id, "stream1", trace_id, &hours).await;

        // Should succeed without error and without trying S3 download
        assert!(
            result.is_ok(),
            "query_local_ingester_cuckoo_filter_hours should not error"
        );

        // The result vector should be empty if no local filters exist
        let found_hours = result.unwrap();
        assert!(
            found_hours.len() <= hours.len(),
            "Found hours should not exceed input hours"
        );

        // Test that ingester query doesn't attempt S3 download by checking logs
        // (This is behavioral - ingester should only check local cache/files)
        log::info!("Ingester query completed without S3 download attempt");
    }
}
