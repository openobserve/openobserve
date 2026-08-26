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

use std::sync::{
    Arc, LazyLock as Lazy,
    atomic::{AtomicI64, Ordering},
};

use config::{
    get_config,
    meta::promql::value::{RangeValue, Value},
    utils::{
        hash::{Sum64, gxhash},
        time::{HourFormat, get_ymdh_from_micros, now_micros, second_micros},
    },
};
use hashbrown::{HashMap, HashSet};
use infra::errors::{Error, Result};
use prost::Message;
use tokio::sync::RwLock;

const METRICS_INDEX_CACHE_GC_PERCENT: usize = 10; // gc releases 10% of the memory budget
const METRICS_INDEX_CACHE_MAX_ITEMS: usize = 100;
const METRICS_INDEX_CACHE_BUCKETS: usize = 100;
// Arc control block (strong + weak counts) + the Vec's pointer slot + the item itself
const METRICS_INDEX_ITEM_OVERHEAD: usize = 16
    + std::mem::size_of::<Arc<MetricsIndexCacheItem>>()
    + std::mem::size_of::<MetricsIndexCacheItem>();

static CACHE_KEY_SUFFIX: Lazy<AtomicI64> = Lazy::new(|| AtomicI64::new(now_micros()));

static GLOBAL_CACHE: Lazy<Vec<RwLock<MetricsIndex>>> = Lazy::new(|| {
    // metrics_cache_max_size is resolved to bytes in check_config
    let max_bytes = get_config().limit.metrics_cache_max_size;
    let mut metrics = Vec::with_capacity(METRICS_INDEX_CACHE_BUCKETS);
    for _ in 0..METRICS_INDEX_CACHE_BUCKETS {
        metrics.push(RwLock::new(MetricsIndex::new(
            max_bytes / METRICS_INDEX_CACHE_BUCKETS,
        )));
    }
    metrics
});

pub async fn get_cache_stats() -> (usize, usize, usize) {
    let mut total_len = 0;
    let mut total_cap = 0;
    let mut total_mem = 0;
    for bucket in GLOBAL_CACHE.iter() {
        let (len, cap, mem_size) = bucket.read().await.stats();
        total_len += len;
        total_cap += cap;
        total_mem += mem_size;
    }
    (total_len, total_cap, total_mem)
}

pub async fn init() -> Result<()> {
    // drop index entries whose disk files get evicted by the disk cache gc
    infra::cache::file_data::disk::set_metrics_result_cache_evict_hook(|files| {
        tokio::spawn(remove_evicted_files(files));
    });

    let cfg = get_config();
    if !cfg.common.result_cache_enabled {
        return Ok(());
    }

    tokio::task::spawn(async move {
        log::info!("Loading disk metrics cache start");
        loop {
            if infra::cache::file_data::disk::LOADING_FROM_DISK_DONE.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
        let mut w = infra::cache::file_data::disk::METRICS_RESULT_CACHE
            .write()
            .await;
        let items = std::mem::take(&mut *w);
        for item in items.iter() {
            if let Err(e) = load(item).await {
                log::error!("load disk metrics cache error: {e}");
            }
        }
        log::info!(
            "Loading disk metrics cache done, total items: {}",
            items.len()
        );
    });
    Ok(())
}

/// Get the samples from the cache
///
/// This function will return the samples from the cache if the samples are found.
/// If the samples are not found, it will return None.
pub async fn get(
    query: &str,
    start: i64,
    end: i64,
    step: i64,
) -> Result<Option<(i64, Vec<proto::cluster_rpc::Series>)>> {
    // get the bucket cache
    let key = get_hash_key(query, step);
    let bucket_id = get_bucket_id(&key);
    let r = GLOBAL_CACHE[bucket_id].read().await;
    let Some(index) = r.data.get(&key) else {
        return Ok(None);
    };
    if !index.query.is_empty() && index.query != query {
        log::warn!(
            "HASH conflict, query changed from {} to {}, skip cache",
            index.query,
            query
        );
        return Ok(None);
    }
    index.touch();

    // get the best key
    let mut best_key = String::new();
    let mut best_diff = 0;
    for entry in index.entries.iter() {
        if start < entry.start {
            continue;
        }
        let mut d = entry.end - start;
        if end <= entry.end {
            d = end - start;
        }
        if d >= best_diff {
            best_key = entry.key.clone();
            best_diff = d;
        }
    }
    drop(r);
    if best_key.is_empty() {
        return Ok(None);
    }

    // get the data from disk cache
    let Some(data) = infra::cache::file_data::disk::get(&best_key, None).await else {
        // need to drop the key from index
        let mut w = GLOBAL_CACHE[bucket_id].write().await;
        w.remove_files(&key, &HashSet::from_iter([best_key]));
        drop(w);
        return Ok(None);
    };
    let mut resp = match proto::cluster_rpc::MetricsQueryResponse::decode(data) {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("decode metrics query response error: {e}");
            return Ok(None);
        }
    };
    if resp.series.is_empty() {
        return Ok(None);
    }

    let mut new_start = start;
    for series in resp.series.iter_mut() {
        // filter the samples, remove the samples over time range
        let value_n = series.samples.len();
        let mut first_i = 0;
        while first_i < value_n && series.samples[first_i].time < start {
            first_i += 1;
        }
        if first_i > 0 {
            series.samples.drain(0..first_i);
        }
        let value_n = series.samples.len();
        let mut last_i = value_n;
        while last_i > 0 && series.samples[last_i - 1].time > end {
            last_i -= 1;
        }
        if last_i < value_n {
            series.samples.drain(last_i..);
        }

        // filter the exemplars, remove the exemplars over time range
        if let Some(exemplars) = series.exemplars.as_mut() {
            let value_n = exemplars.exemplars.len();
            let mut first_i = 0;
            while first_i < value_n && exemplars.exemplars[first_i].time < start {
                first_i += 1;
            }
            if first_i > 0 {
                exemplars.exemplars.drain(0..first_i);
            }
            let value_n = exemplars.exemplars.len();
            let mut last_i = value_n;
            while last_i > 0 && exemplars.exemplars[last_i - 1].time > end {
                last_i -= 1;
            }
            if last_i < value_n {
                exemplars.exemplars.drain(last_i..);
            }
        }

        // update the new start
        let ns = if let Some(exemplars) = series.exemplars.as_ref() {
            exemplars.exemplars.last().map(|v| v.time).unwrap_or(0)
        } else {
            series.samples.last().map(|v| v.time).unwrap_or(0)
        };
        if ns > new_start {
            new_start = ns;
        }
    }

    // if new_start == start, it means we have no data in cache, so we need to return None
    if new_start == start {
        return Ok(None);
    }

    // if new_start > start, it means we have data in cache, so we need to add step for next query
    new_start += step;
    Ok(Some((new_start, resp.series)))
}

#[allow(clippy::too_many_arguments)]
pub async fn set(
    trace_id: &str,
    org: &str,
    query: &str,
    start: i64,
    end: i64,
    step: i64,
    mut range_values: Vec<RangeValue>,
    update: bool,
) -> Result<()> {
    // check time range, if over ZO_MAX_FILE_RETENTION_TIME, return
    let cfg = get_config();
    let max_ts = now_micros() - second_micros(cfg.limit.cache_delay_secs);
    let new_end = if end > max_ts { max_ts } else { end };
    if range_values.is_empty() || start >= max_ts || new_end <= start + step {
        // all of the data in retention time, no need to store
        return Ok(());
    }

    // get the bucket cache
    let key = get_hash_key(query, step);
    let bucket_id = get_bucket_id(&key);
    let r = GLOBAL_CACHE[bucket_id].read().await;
    if let Some(index) = r.data.get(&key) {
        if !index.query.is_empty() && index.query != query {
            log::warn!(
                "HASH conflict, query changed from {} to {}, skip cache",
                index.query,
                query
            );
            return Ok(());
        }
        // check if the cache already covered
        if !update
            && index
                .entries
                .iter()
                .any(|entry| entry.start <= start && entry.end >= new_end)
        {
            return Ok(());
        }
    }
    drop(r);

    // filter the samples
    if end >= max_ts {
        let mut empty_item_index = Vec::new();
        for (i, series) in range_values.iter_mut().enumerate() {
            let mut empty_data = false;
            // check samples
            let value_n = series.samples.len();
            let mut last_i = value_n;
            for i in (0..last_i).rev() {
                if series.samples[i].timestamp < max_ts {
                    last_i = i;
                    break;
                }
            }
            if last_i == value_n {
                // all of the data are over the retention time, no need to store
                empty_data = true;
            } else if last_i + 1 == value_n {
                // all of the data are not in retention time, no need to drain
            } else {
                // last_i is the last item not in retention time, so we need to drain the samples
                // after last_i
                series.samples.drain(last_i + 1..);
            }

            // check exemplars
            if let Some(exemplars) = series.exemplars.as_mut() {
                empty_data = false;
                let value_n = exemplars.len();
                let mut last_i = value_n;
                for i in (0..last_i).rev() {
                    if exemplars[i].timestamp < max_ts {
                        last_i = i;
                        break;
                    }
                }
                if last_i == value_n {
                    // all of the data are over the retention time, no need to store
                    empty_data = true;
                } else if last_i + 1 == value_n {
                    // all of the data are not in retention time, no need to drain
                } else {
                    // last_i is the last item not in retention time, so we need to drain the
                    // samples after last_i
                    exemplars.drain(last_i + 1..);
                }
            }

            if empty_data {
                empty_item_index.push(i);
            }
        }
        // remove the empty items
        if !empty_item_index.is_empty() {
            for i in empty_item_index.into_iter().rev() {
                range_values.remove(i);
            }
        }
    };

    // convert RangeValue to proto::cluster_rpc::MetricsQueryResponse then encode to vec
    let mut resp = proto::cluster_rpc::MetricsQueryResponse::default();
    super::grpc::add_value(&mut resp, Value::Matrix(range_values));
    let bytes_data = resp.encode_to_vec();

    // store the series to disk cache
    let cache_key = get_cache_item_key(&key, org, start, new_end);
    infra::cache::file_data::disk::set(&cache_key, bytes_data.into())
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    // store the cache item
    let cache_item = MetricsIndexCacheItem::new(&cache_key, start, new_end);
    let evicted = insert_index(bucket_id, key, query, cache_item).await;
    if evicted > 0 {
        log::debug!("[trace_id {trace_id}] promql->search->cache: evicted {evicted} index entries");
    }

    Ok(())
}

/// load the cache item from the secondary storage
pub async fn load(cache_key: &str) -> Result<()> {
    let cfg = get_config();
    if !cfg.common.result_cache_enabled {
        return Ok(());
    }
    let Some((key, start, end)) = parse_cache_item_key(cache_key) else {
        return Ok(());
    };
    let bucket_id = get_bucket_id(&key);
    let cache_item = MetricsIndexCacheItem::new(cache_key, start, end);
    insert_index(bucket_id, key, "", cache_item).await;

    Ok(())
}

/// Insert into the bucket index and delete the disk files of any evicted entries,
/// so budget enforcement and file cleanup cannot be separated. Returns the evicted count.
async fn insert_index(
    bucket_id: usize,
    key: String,
    query: &str,
    item: MetricsIndexCacheItem,
) -> usize {
    let mut w = GLOBAL_CACHE[bucket_id].write().await;
    let evicted = w.insert(key, query, item);
    drop(w);
    let evicted_len = evicted.len();
    if !evicted.is_empty() {
        // detached: the cleanup has no ordering dependency on the caller
        tokio::spawn(remove_disk_files(evicted));
    }
    evicted_len
}

/// drop the index entries whose disk files were evicted by the disk cache gc
async fn remove_evicted_files(files: Vec<String>) {
    // group by bucket and key so each bucket lock is taken once
    let mut buckets: HashMap<usize, HashMap<String, HashSet<String>>> = HashMap::new();
    for file in files {
        let Some((key, ..)) = parse_cache_item_key(&file) else {
            continue;
        };
        buckets
            .entry(get_bucket_id(&key))
            .or_default()
            .entry(key)
            .or_default()
            .insert(file);
    }
    for (bucket_id, keys) in buckets {
        let mut w = GLOBAL_CACHE[bucket_id].write().await;
        for (key, file_keys) in keys {
            w.remove_files(&key, &file_keys);
        }
        drop(w);
    }
}

/// delete the disk files of entries evicted from the index
async fn remove_disk_files(evicted: Vec<Arc<MetricsIndexCacheItem>>) {
    for item in evicted {
        if let Err(e) = infra::cache::file_data::disk::remove(&item.key).await {
            log::warn!("Remove evicted metrics cache file {} error: {e}", item.key);
        }
    }
}

fn get_hash_key(query: &str, step: i64) -> String {
    config::utils::md5::hash(&format!("{query}-{step}"))
}

fn get_cache_item_key(prefix: &str, org: &str, start: i64, end: i64) -> String {
    format!(
        "metrics_results/{}/{}/{}_{}_{}_{}.pb",
        org,
        get_ymdh_from_micros(start, HourFormat::Real),
        prefix,
        start,
        end,
        CACHE_KEY_SUFFIX.fetch_add(1, Ordering::SeqCst)
    )
}

/// parse the cache item key
///
/// the key format is: metrics_results/{date}/{prefix}_{start}_{end}_{suffix}.json
fn parse_cache_item_key(key: &str) -> Option<(String, i64, i64)> {
    if !key.starts_with("metrics_results/") || !key.ends_with(".pb") {
        return None;
    }
    let item_key = key.split('/').next_back().unwrap_or("");
    let parts = item_key.split('_').collect::<Vec<_>>();
    if parts.len() != 4 {
        return None;
    }

    let prefix = parts[0];
    let Ok(start) = parts[1].parse::<i64>() else {
        return None;
    };
    let Ok(end) = parts[2].parse::<i64>() else {
        return None;
    };
    Some((prefix.to_string(), start, end))
}

fn get_bucket_id(key: &str) -> usize {
    let hash = gxhash::new().sum64(key);
    hash as usize % METRICS_INDEX_CACHE_BUCKETS
}

struct MetricsIndex {
    data: HashMap<String, MetricsIndexCache>,
    max_size: usize, // memory budget in bytes for this bucket
    cur_size: usize, // accounted bytes of keys, queries and entries
}

impl MetricsIndex {
    fn new(max_size: usize) -> Self {
        Self {
            data: HashMap::new(),
            max_size,
            cur_size: 0,
        }
    }

    /// Insert the item under the key, enforcing the per-key item cap and the memory budget.
    /// Returns the evicted items so the caller can delete their disk files.
    fn insert(
        &mut self,
        key: String,
        query: &str,
        item: MetricsIndexCacheItem,
    ) -> Vec<Arc<MetricsIndexCacheItem>> {
        let base_size = index_base_size(&key, query);
        let cur_size = &mut self.cur_size;
        let index = self.data.entry(key).or_insert_with(|| {
            *cur_size += base_size;
            MetricsIndexCache::new(query)
        });
        index.touch();
        let mut evicted = Vec::new();
        if index.entries.len() >= METRICS_INDEX_CACHE_MAX_ITEMS {
            // remove the first half items
            evicted.extend(index.entries.drain(0..METRICS_INDEX_CACHE_MAX_ITEMS / 2));
            self.cur_size -= evicted.iter().map(|v| item_size(v)).sum::<usize>();
        }
        self.cur_size += item_size(&item);
        index.entries.push(Arc::new(item));
        evicted.extend(self.gc());
        evicted
    }

    /// Remove entries by their disk file keys; drops the key when its entry list becomes empty.
    fn remove_files(&mut self, key: &str, file_keys: &HashSet<String>) {
        let Some(index) = self.data.get_mut(key) else {
            return;
        };
        let mut freed = 0;
        index.entries.retain(|entry| {
            if file_keys.contains(entry.key.as_str()) {
                freed += item_size(entry);
                false
            } else {
                true
            }
        });
        self.cur_size -= freed;
        if !index.entries.is_empty() {
            return;
        }
        if let Some(index) = self.data.remove(key) {
            self.cur_size -= index_base_size(key, &index.query);
        }
    }

    /// When over budget, evict the least recently used keys until
    /// METRICS_INDEX_CACHE_GC_PERCENT of the budget is free.
    fn gc(&mut self) -> Vec<Arc<MetricsIndexCacheItem>> {
        if self.cur_size <= self.max_size {
            return Vec::new();
        }
        log::warn!("MetricsIndex is over its memory budget, releasing the coldest keys");
        let target = self.max_size - self.max_size * METRICS_INDEX_CACHE_GC_PERCENT / 100;
        let mut keys = self
            .data
            .iter()
            .map(|(k, v)| (k.clone(), v.last_used.load(Ordering::Relaxed)))
            .collect::<Vec<_>>();
        keys.sort_unstable_by_key(|(_, last_used)| *last_used);
        let mut evicted = Vec::new();
        for (key, _) in keys {
            if self.cur_size <= target {
                break;
            }
            let Some(index) = self.data.remove(&key) else {
                continue;
            };
            self.cur_size -= key_size(&key, &index);
            evicted.extend(index.entries);
        }
        evicted
    }

    fn stats(&self) -> (usize, usize, usize) {
        let mut total_len = 0;
        let mut total_cap = 0;
        for v in self.data.values() {
            total_len += v.entries.len();
            total_cap += v.entries.capacity();
        }
        (total_len, total_cap, self.cur_size)
    }
}

struct MetricsIndexCache {
    query: String,
    entries: Vec<Arc<MetricsIndexCacheItem>>,
    last_used: AtomicI64,
}

impl MetricsIndexCache {
    fn new(query: &str) -> Self {
        Self {
            query: query.to_string(),
            entries: Vec::new(),
            last_used: AtomicI64::new(now_micros()),
        }
    }

    fn touch(&self) {
        self.last_used.store(now_micros(), Ordering::Relaxed);
    }
}

struct MetricsIndexCacheItem {
    key: String,
    start: i64,
    end: i64,
}

impl MetricsIndexCacheItem {
    fn new(key: &str, start: i64, end: i64) -> Self {
        Self {
            key: key.to_string(),
            start,
            end,
        }
    }
}

fn index_base_size(key: &str, query: &str) -> usize {
    key.len() + query.len() + std::mem::size_of::<MetricsIndexCache>()
}

fn item_size(item: &MetricsIndexCacheItem) -> usize {
    METRICS_INDEX_ITEM_OVERHEAD + item.key.len()
}

fn key_size(key: &str, index: &MetricsIndexCache) -> usize {
    index_base_size(key, &index.query) + index.entries.iter().map(|v| item_size(v)).sum::<usize>()
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{Labels, Sample};
    use promql::adjust_start_end;

    use super::*;

    #[test]
    fn test_promql_cache_hash_key_generation() {
        let query = "test_query";
        let step = 60000000; // 60 seconds in microseconds

        let key = get_hash_key(query, step);
        assert_eq!(key, "b235015c612525ad7c11c109e3fdc261");
    }

    #[test]
    fn test_promql_cache_bucket_distribution() {
        let key1 = "test_query-60000000";
        let key2 = "test_query-60000000";

        let bucket1 = get_bucket_id(key1);
        let bucket2 = get_bucket_id(key2);

        assert!(bucket1 < METRICS_INDEX_CACHE_BUCKETS);
        assert!(bucket2 < METRICS_INDEX_CACHE_BUCKETS);
    }

    #[tokio::test]
    async fn test_promql_cache_set_and_get() {
        let org = "default";
        let trace_id = "test_trace1";
        let query = "test_query1";
        let end = now_micros();
        let start = end - second_micros(3600);
        let step = second_micros(15);
        let (start, end) = adjust_start_end(start, end, step);

        // Create test samples
        let mut range_values = vec![RangeValue {
            labels: Labels::new(),
            samples: vec![],
            exemplars: None,
            time_window: None,
        }];
        let max_ts = end - second_micros(get_config().limit.cache_delay_secs as i64);
        let mut valid_max_ts = 0;
        for i in 0..((end - start + step) / step) {
            let ts = start + step * i;
            if ts <= max_ts {
                valid_max_ts = ts;
            }
            range_values[0].samples.push(Sample {
                timestamp: ts,
                value: i as f64,
            });
        }

        let expected_value = range_values.first().unwrap().clone();

        // Test setting cache
        let set_result = set(trace_id, org, query, start, end, step, range_values, false).await;
        assert!(set_result.is_ok());

        // Test getting cache
        let get_result = get(query, start, end, step).await;
        assert!(get_result.is_ok());

        if let Ok(Some((new_start, cached_range_values))) = get_result {
            assert!(!cached_range_values.is_empty());
            assert_eq!(
                cached_range_values[0].samples[0].value,
                expected_value.samples[0].value
            );
            assert_eq!(new_start, valid_max_ts + step);
        } else {
            panic!("Failed to get cached values");
        }
    }

    #[tokio::test]
    async fn test_promql_cache_max_items() {
        let org = "default";
        let trace_id = "test_trace2";
        let query = "test_query2";
        let end = now_micros();
        let start = end - second_micros(3600);
        let step = second_micros(15);
        let (start, end) = adjust_start_end(start, end, step);

        // Add more than METRICS_INDEX_CACHE_MAX_ITEMS entries
        for i in 0..METRICS_INDEX_CACHE_MAX_ITEMS + 2 {
            let start = start + step * i as i64;
            let range_values = vec![RangeValue {
                labels: Labels::new(),
                samples: vec![Sample {
                    timestamp: start,
                    value: i as f64,
                }],
                exemplars: None,
                time_window: None,
            }];

            let set_result = set(
                trace_id,
                org,
                query,
                start,
                end,
                step,
                range_values.clone(),
                false,
            )
            .await;
            assert!(set_result.is_ok());
        }

        // Verify that the cache size is maintained
        let key = get_hash_key(query, step);
        let bucket_id = get_bucket_id(&key);
        let metrics = GLOBAL_CACHE[bucket_id].read().await;

        if let Some(index) = metrics.data.get(&key) {
            assert!(index.entries.len() <= METRICS_INDEX_CACHE_MAX_ITEMS);
        } else {
            panic!("Cache entry not found");
        }
    }

    #[test]
    fn test_parse_cache_item_key() {
        // Test valid key
        let key = "metrics_results/2024/01/01/00/prefix_1234_5678_suffix.pb";
        let result = parse_cache_item_key(key);
        assert!(result.is_some());
        let (prefix, start, end) = result.unwrap();
        assert_eq!(prefix, "prefix");
        assert_eq!(start, 1234);
        assert_eq!(end, 5678);

        // Test invalid keys
        let invalid_keys = vec![
            "invalid_key",                      // Too few parts
            "prefix_abc_def_suffix.pb",         // Non-numeric values
            "prefix_1234_5678",                 // Missing .pb extension
            "prefix/1234/5678/extra/suffix.pb", // Too many parts
        ];

        for invalid_key in invalid_keys {
            assert!(parse_cache_item_key(invalid_key).is_none());
        }
    }

    #[tokio::test]
    async fn test_get_cache_stats_basic() {
        // Test that get_cache_stats returns valid tuple structure
        let (total_len, total_cap, _total_mem) = get_cache_stats().await;

        // Capacity should be >= length
        assert!(total_cap >= total_len);
    }

    #[tokio::test]
    async fn test_get_cache_stats_consistency() {
        // Test that stats returns valid values across multiple calls
        // Note: In a concurrent test environment, values may change due to other tests
        let (len1, cap1, mem1) = get_cache_stats().await;
        let (len2, cap2, mem2) = get_cache_stats().await;

        // Capacity may change but should be reasonable
        assert!(cap2 >= len2);
        assert!(cap1 >= len1);

        // Values may change due to concurrent tests, but should not vary wildly
        let len_diff = len2.abs_diff(len1);
        let cap_diff = cap2.abs_diff(cap1);
        let mem_diff = mem2.abs_diff(mem1);
        assert!(len_diff < 1000 || len1 == 0 || len2 == 0);
        assert!(cap_diff < 10000 || cap1 == 0 || cap2 == 0);
        assert!(mem_diff < 1000000 || mem1 == 0 || mem2 == 0);
    }

    #[tokio::test]
    async fn test_get_cache_stats_with_data() {
        // Get initial stats
        let (initial_len, initial_cap, initial_mem) = get_cache_stats().await;

        // Add some cache data
        let org = "test_org_stats";
        let trace_id = "test_trace_stats";
        let query = "test_query_stats";
        let end = now_micros();
        let start = end - second_micros(3600);
        let step = second_micros(15);
        let (start, end) = adjust_start_end(start, end, step);

        let range_values = vec![RangeValue {
            labels: Labels::new(),
            samples: vec![Sample {
                timestamp: start,
                value: 42.0,
            }],
            exemplars: None,
            time_window: None,
        }];

        let _ = set(trace_id, org, query, start, end, step, range_values, false).await;

        // Get stats after adding data
        let (after_len, after_cap, after_mem) = get_cache_stats().await;

        // Verify that stats increased or stayed the same
        assert!(after_len >= initial_len);
        assert!(after_cap >= initial_cap);
        assert!(after_mem >= initial_mem);
    }

    #[tokio::test]
    async fn test_get_cache_stats_aggregates_all_buckets() {
        // This test verifies that get_cache_stats correctly aggregates across all buckets
        let (total_len, total_cap, total_mem) = get_cache_stats().await;

        // Manually calculate stats for verification
        let mut manual_len = 0;
        let mut manual_cap = 0;
        let mut manual_mem = 0;

        for bucket in GLOBAL_CACHE.iter() {
            let (len, cap, mem) = bucket.read().await.stats();
            manual_len += len;
            manual_cap += cap;
            manual_mem += mem;
        }

        // The aggregated stats should match our manual calculation
        assert_eq!(total_len, manual_len);
        assert_eq!(total_cap, manual_cap);
        assert_eq!(total_mem, manual_mem);
    }

    #[test]
    fn test_metrics_index_size_accounting() {
        let mut metrics = MetricsIndex::new(1024 * 1024);
        let (len, _cap, mem) = metrics.stats();
        assert_eq!(len, 0);
        assert_eq!(mem, 0);

        metrics.insert(
            "acct_key".to_string(),
            "acct_query",
            MetricsIndexCacheItem::new("metrics_results/org/acct1.pb", 100, 200),
        );
        metrics.insert(
            "acct_key".to_string(),
            "acct_query",
            MetricsIndexCacheItem::new("metrics_results/org/acct2.pb", 200, 300),
        );
        let (len, _cap, mem) = metrics.stats();
        assert_eq!(len, 2);
        assert_eq!(
            mem,
            index_base_size("acct_key", "acct_query")
                + item_size(&MetricsIndexCacheItem::new(
                    "metrics_results/org/acct1.pb",
                    100,
                    200
                ))
                + item_size(&MetricsIndexCacheItem::new(
                    "metrics_results/org/acct2.pb",
                    200,
                    300
                ))
        );

        // removing one file frees its bytes; removing the last one drops the key
        metrics.remove_files(
            "acct_key",
            &HashSet::from_iter(["metrics_results/org/acct1.pb".to_string()]),
        );
        let (len, _cap, mem_after) = metrics.stats();
        assert_eq!(len, 1);
        assert!(mem_after < mem);
        metrics.remove_files(
            "acct_key",
            &HashSet::from_iter(["metrics_results/org/acct2.pb".to_string()]),
        );
        assert!(metrics.data.is_empty());
        assert_eq!(metrics.cur_size, 0);
    }

    #[test]
    fn test_metrics_index_gc_evicts_coldest_keys() {
        let mut metrics = MetricsIndex::new(1024 * 1024);
        for i in 0..3 {
            metrics.insert(
                format!("gc_key_{i}"),
                "q",
                MetricsIndexCacheItem::new(&format!("metrics_results/org/gc{i}.pb"), 0, 1),
            );
        }
        for i in 0..3i64 {
            metrics
                .data
                .get(&format!("gc_key_{i}"))
                .unwrap()
                .last_used
                .store(i, Ordering::Relaxed);
        }

        // shrink the budget below the current size and gc: only the coldest key goes
        metrics.max_size = metrics.cur_size - 1;
        let evicted = metrics.gc();
        assert_eq!(evicted.len(), 1);
        assert_eq!(evicted[0].key, "metrics_results/org/gc0.pb");
        assert!(!metrics.data.contains_key("gc_key_0"));
        assert!(metrics.data.contains_key("gc_key_1"));
        assert!(metrics.data.contains_key("gc_key_2"));
        assert!(metrics.cur_size <= metrics.max_size);
    }

    #[tokio::test]
    async fn test_get_cache_stats_empty_buckets() {
        // Test that get_cache_stats handles empty buckets correctly
        // Even with empty buckets, the function should return valid values
        let (len, cap, _mem) = get_cache_stats().await;

        // All values should be non-negative (usize is always >= 0)
        // The function should complete without panicking
        assert!(len <= cap); // Length should not exceed capacity
    }
}
