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

mod loads;

use std::{
    collections::VecDeque,
    hash::Hasher,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

use anyhow::{Context, Result, ensure};
use bytes::Bytes;
#[cfg(test)]
use config::metrics::promql::IndexBlocksCacheMetrics;
use config::{
    meta::{
        promql::{
            MetricsBlockScan,
            value::{EvalContext, Labels, Sample},
        },
        stream::{FileKey, FileSelection},
    },
    utils::hash::gxhash,
};
use datafusion::error::DataFusionError;
use futures::{StreamExt, stream};
use hashbrown::{HashMap, HashSet};
#[cfg(test)]
use metrics_index::block::ParentMetadata;
#[cfg(test)]
use metrics_index::parsed_cache::CacheWeight;
#[cfg(test)]
use metrics_index::parsed_cache::SidecarBinding;
use metrics_index::{
    block::{BlockDecoder, DecodedBlockRef, Index},
    parsed_cache::{CacheKey, CachedIndex, INDEX_CACHE, IndexCache, ParentIdentity, cache_limit},
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    task::JoinSet,
};

use super::{SeriesStream, block_ranges::plan_coalesced_ranges, plan::LabelColumns};
use crate::series_loader::label_interner::LabelInterner;

const PREFLIGHT_CPU_CHUNK: usize = 1024;
const PREFETCH_BLOCKS: usize = 128;
const PREFETCH_BYTES: usize = 4 * 1024 * 1024;
const COALESCE_MAX_GAP: u64 = 16 * 1024;
const COALESCE_MAX_SPAN: u64 = 1024 * 1024;
static METADATA_WORKERS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| {
    Arc::new(Semaphore::new(
        config::get_config().limit.cpu_num.clamp(1, 32),
    ))
});
static FILE_LOADS: LazyLock<Arc<loads::LoadRegistry>> =
    LazyLock::new(|| Arc::new(loads::LoadRegistry::default()));
struct MetadataLoad<'a> {
    file: &'a FileKey,
    labels: &'a [String],
    key: CacheKey,
    sidecar: String,
    limit: usize,
    permit: Arc<OwnedSemaphorePermit>,
    cache: &'a Mutex<IndexCache>,
    flights: &'a Arc<loads::LoadRegistry>,
}

impl MetadataLoad<'_> {
    async fn run(self, mut seed: Option<Arc<CachedIndex>>) -> Result<Arc<LoadedFile>> {
        let Self {
            file,
            labels,
            key,
            sidecar,
            limit,
            permit,
            cache,
            flights,
        } = self;
        loop {
            if seed
                .as_ref()
                .map(|entry| entry.index.missing_labels(labels))
                .transpose()?
                .is_some_and(|missing| missing.is_empty())
            {
                let binding = seed.as_ref().map(|entry| entry.binding.clone());
                let loaded = load_entry(
                    file,
                    labels,
                    &key.parent,
                    &sidecar,
                    seed,
                    Arc::clone(&permit),
                )
                .await;
                let entry = match loaded {
                    Ok(value) => value,
                    Err(error) => {
                        cache
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove_bound(&key, binding.as_ref());
                        return Err(error);
                    }
                };
                return Ok(Arc::new(LoadedFile {
                    account: file.account.clone(),
                    sidecar,
                    index: Arc::new(entry.index.project(labels)?),
                }));
            }
            match flights.claim(key.clone()) {
                loads::Claim::Waiter(flight) => {
                    if let Some(loaded) = flight.wait().await? {
                        seed = Some(loaded);
                    }
                }
                loads::Claim::Owner(owner) => {
                    if limit > 0
                        && let Some(current) =
                            cache.lock().unwrap_or_else(|e| e.into_inner()).peek(&key)
                    {
                        seed = Some(current);
                    }
                    let binding = seed.as_ref().map(|entry| entry.binding.clone());
                    let prior = seed.clone();
                    let loaded = load_entry(
                        file,
                        labels,
                        &key.parent,
                        &sidecar,
                        seed,
                        Arc::clone(&permit),
                    )
                    .await;
                    match loaded {
                        Ok(entry) => {
                            let admitted = if prior
                                .as_ref()
                                .is_some_and(|prior| Arc::ptr_eq(prior, &entry))
                            {
                                Ok(entry)
                            } else {
                                cache.lock().unwrap_or_else(|e| e.into_inner()).insert(
                                    key.clone(),
                                    entry,
                                    limit,
                                )
                            };
                            owner.complete(&admitted);
                            let entry = admitted?;
                            return Ok(Arc::new(LoadedFile {
                                account: file.account.clone(),
                                sidecar,
                                index: Arc::new(entry.index.project(labels)?),
                            }));
                        }
                        Err(error) => {
                            cache
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .remove_bound(&key, binding.as_ref());
                            let failed = Err(anyhow::anyhow!("{error:#}"));
                            owner.complete(&failed);
                            return Err(error);
                        }
                    }
                }
            }
        }
    }
}

struct ReadStats {
    trace_id: String,
    partitions: usize,
    selected_blocks: usize,
    selected_bytes: u64,
    read_batches: AtomicU64,
    read_ranges: AtomicU64,
    read_bytes: AtomicU64,
    decoded_blocks: AtomicU64,
    completed_partitions: AtomicU64,
}

impl Drop for ReadStats {
    fn drop(&mut self) {
        log::info!(
            "[trace_id: {}] [PromQL] metrics blocks read: selected_blocks {}, selected_bytes {}, read_batches {}, read_bytes {}, decoded_blocks {}, completed_partitions {}/{}, read_ranges {}",
            self.trace_id,
            self.selected_blocks,
            self.selected_bytes,
            self.read_batches.load(Ordering::Relaxed),
            self.read_bytes.load(Ordering::Relaxed),
            self.decoded_blocks.load(Ordering::Relaxed),
            self.completed_partitions.load(Ordering::Relaxed),
            self.partitions,
            self.read_ranges.load(Ordering::Relaxed),
        );
    }
}

#[derive(Default)]
struct PartitionReadStats {
    read_batches: u64,
    read_ranges: u64,
    read_bytes: u64,
    decoded_blocks: u64,
}

struct LoadedFile {
    account: String,
    sidecar: String,
    index: Arc<Index>,
}

pub(super) struct PreparedPartition {
    files: Vec<FileCursor>,
    columns: Arc<LabelColumns>,
    window: (i64, i64),
    offset: i64,
    stats: Arc<ReadStats>,
}

struct FileCursor {
    file: Arc<LoadedFile>,
    selected: Vec<usize>,
    next: usize,
    pending: VecDeque<(usize, Bytes)>,
}

impl FileCursor {
    fn head(&self) -> Option<usize> {
        self.selected.get(self.next).copied()
    }
    fn hash(&self) -> Option<u64> {
        self.head().map(|id| self.file.index.blocks.block(id).hash)
    }

    async fn decode_next<'a>(
        &mut self,
        decoder: &'a mut BlockDecoder,
        stats: &mut PartitionReadStats,
    ) -> Result<DecodedBlockRef<'a>> {
        let block_id = self.head().context("missing block cursor")?;
        if self.pending.is_empty() {
            let mut end = self.next;
            let mut bytes = 0usize;
            while end < self.selected.len() && end - self.next < PREFETCH_BLOCKS {
                let size = self
                    .file
                    .index
                    .blocks
                    .block(self.selected[end])
                    .block_length as usize;
                if end > self.next && bytes.saturating_add(size) > PREFETCH_BYTES {
                    break;
                }
                bytes = bytes.saturating_add(size);
                end += 1;
            }
            let ids = &self.selected[self.next..end];
            let ranges = ids
                .iter()
                .map(|id| self.file.index.blocks.block(*id).block_range())
                .collect::<Vec<_>>();
            let read_plan = plan_coalesced_ranges(
                &ranges,
                COALESCE_MAX_GAP,
                COALESCE_MAX_SPAN,
                PREFETCH_BYTES as u64,
            )?;
            let data = infra::storage::get_ranges(
                &self.file.account,
                &self.file.sidecar,
                &read_plan.ranges,
            )
            .await?;
            stats.read_batches += 1;
            stats.read_ranges += read_plan.ranges.len() as u64;
            stats.read_bytes += data.iter().map(|bytes| bytes.len() as u64).sum::<u64>();
            let data = read_plan.into_payloads(data)?;
            ensure!(data.len() == ids.len(), "incomplete block range response");
            self.pending.extend(ids.iter().copied().zip(data));
        }
        let (id, payload) = self
            .pending
            .pop_front()
            .context("missing prefetched block")?;
        ensure!(id == block_id, "block prefetch order changed");
        let decoded = decoder.decode(&payload, &self.file.index.blocks.block(id))?;
        self.next += 1;
        stats.decoded_blocks += 1;
        Ok(decoded)
    }
}

pub(crate) struct BlockSeriesStream {
    files: Vec<FileCursor>,
    columns: Arc<LabelColumns>,
    interners: Vec<LabelInterner>,
    window: (i64, i64),
    offset: i64,
    head: Option<(Arc<Index>, usize)>,
    samples: Vec<Sample>,
    ready: bool,
    ended: bool,
    decoder: Option<BlockDecoder>,
    local_stats: PartitionReadStats,
    stats: Arc<ReadStats>,
}

impl BlockSeriesStream {
    pub(super) fn new(partition: PreparedPartition) -> Self {
        let interners = partition
            .columns
            .series
            .iter()
            .map(|name| LabelInterner::new(name.clone()))
            .collect();
        Self {
            files: partition.files,
            columns: partition.columns,
            interners,
            window: partition.window,
            offset: partition.offset,
            head: None,
            samples: Vec::new(),
            ready: false,
            ended: false,
            decoder: None,
            local_stats: PartitionReadStats::default(),
            stats: partition.stats,
        }
    }
}

impl Drop for BlockSeriesStream {
    fn drop(&mut self) {
        self.stats
            .read_batches
            .fetch_add(self.local_stats.read_batches, Ordering::Relaxed);
        self.stats
            .read_ranges
            .fetch_add(self.local_stats.read_ranges, Ordering::Relaxed);
        self.stats
            .read_bytes
            .fetch_add(self.local_stats.read_bytes, Ordering::Relaxed);
        self.stats
            .decoded_blocks
            .fetch_add(self.local_stats.decoded_blocks, Ordering::Relaxed);
    }
}

impl SeriesStream for BlockSeriesStream {
    async fn advance(&mut self) -> datafusion::error::Result<Option<u64>> {
        if self.ready {
            return Err(DataFusionError::Execution(
                "consume must follow advance".into(),
            ));
        }
        loop {
            let Some(hash) = self.files.iter().filter_map(FileCursor::hash).min() else {
                self.head = None;
                if !self.ended {
                    self.stats
                        .completed_partitions
                        .fetch_add(1, Ordering::Relaxed);
                    self.ended = true;
                }
                return Ok(None);
            };
            let first = self
                .files
                .iter()
                .find(|file| file.hash() == Some(hash))
                .unwrap();
            let head = (Arc::clone(&first.file.index), first.head().unwrap());
            self.samples.clear();
            if self.decoder.is_none() {
                self.decoder = Some(BlockDecoder::new().map_err(external)?);
            }
            let decoder = self.decoder.as_mut().expect("decoder initialized");
            for cursor in &mut self.files {
                while cursor.hash() == Some(hash) {
                    let block = cursor
                        .decode_next(decoder, &mut self.local_stats)
                        .await
                        .map_err(external)?;
                    for (timestamp, bits) in block
                        .timestamps
                        .iter()
                        .copied()
                        .zip(block.value_bits.iter().copied())
                    {
                        if timestamp >= self.window.0 && timestamp <= self.window.1 {
                            let timestamp =
                                timestamp.checked_add(self.offset).ok_or_else(|| {
                                    DataFusionError::Execution(
                                        "metrics block timestamp offset overflow".into(),
                                    )
                                })?;
                            self.samples
                                .push(Sample::new(timestamp, f64::from_bits(bits)));
                        }
                    }
                }
            }
            if self.samples.is_empty() {
                continue;
            }
            self.samples.sort_unstable_by_key(|sample| sample.timestamp);
            let mut signature = gxhash::new_hasher();
            for name in &self.columns.group {
                if let Some(value) = label_value(&head.0, head.1, name).map_err(external)? {
                    signature.write(name.as_bytes());
                    signature.write(value.as_bytes());
                }
            }
            self.head = Some(head);
            self.ready = true;
            return Ok(Some(signature.finish()));
        }
    }

    fn labels(&mut self) -> Labels {
        let (index, row) = self.head.as_ref().expect("advance yielded a series");
        self.columns
            .series
            .iter()
            .zip(&mut self.interners)
            .filter_map(|(name, interner)| {
                label_value(index, *row, name)
                    .expect("preflight checked label columns")
                    .map(|value| interner.intern(value))
            })
            .collect()
    }

    async fn consume(&mut self, samples: &mut Vec<Sample>) -> datafusion::error::Result<()> {
        if !self.ready {
            return Err(DataFusionError::Execution(
                "advance must precede consume".into(),
            ));
        }
        std::mem::swap(samples, &mut self.samples);
        self.samples.clear();
        self.ready = false;
        Ok(())
    }
}

struct SelectedFile {
    file: Arc<LoadedFile>,
    ids: Vec<usize>,
}

enum SeriesIntervals {
    One((i64, i64)),
    Many(Vec<(i64, i64)>),
}

impl SeriesIntervals {
    fn push(&mut self, interval: (i64, i64)) {
        match self {
            Self::One(first) => *self = Self::Many(vec![*first, interval]),
            Self::Many(intervals) => intervals.push(interval),
        }
    }

    fn disjoint(&mut self) -> bool {
        match self {
            Self::One(_) => true,
            Self::Many(intervals) => {
                intervals.sort_unstable();
                intervals.windows(2).all(|pair| pair[0].1 < pair[1].0)
            }
        }
    }
}

struct SeriesValidation {
    first_file: usize,
    first_block: usize,
    intervals: SeriesIntervals,
}

struct ValidatedPartition {
    files: Vec<FileCursor>,
    series: usize,
    selected_blocks: usize,
    selected_bytes: u64,
}

pub async fn load_metrics_block_index(file: &FileKey, labels: &[String]) -> Result<Arc<Index>> {
    Ok(Arc::clone(
        &load_index_inner(file, labels, Arc::clone(&METADATA_WORKERS))
            .await?
            .index,
    ))
}

pub(super) async fn prepare(
    scan: &MetricsBlockScan,
    columns: Arc<LabelColumns>,
    partitions: &[(u64, u64)],
    offset: i64,
    lookback: i64,
    eval: &EvalContext,
) -> Result<Vec<PreparedPartition>> {
    let window = query_window(eval, offset, lookback)
        .context("unsupported sparse or overflowing time window")?;
    ensure!(
        !scan.files.is_empty() && !partitions.is_empty(),
        "empty block source"
    );
    let mut labels = columns
        .group
        .iter()
        .chain(&columns.series)
        .cloned()
        .collect::<Vec<_>>();
    labels.sort();
    labels.dedup();
    let mut seen = HashSet::new();
    for file in &scan.files {
        ensure!(
            seen.insert((&file.account, &file.key)),
            "duplicate block parent"
        );
        ensure!(
            scan.unfiltered || matches!(file.selection, Some(FileSelection::RowRanges(_))),
            "exact row-range selection required"
        );
    }
    let metadata_started = Instant::now();
    let concurrency = partitions
        .len()
        .min(config::get_config().limit.cpu_num.max(1))
        .clamp(1, 32);
    let load_labels = Arc::new(labels);
    let jobs = scan
        .files
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, file)| {
            let labels = Arc::clone(&load_labels);
            Box::pin(async move { load_index(&file, &labels).await.map(|file| (index, file)) })
                as futures::future::BoxFuture<'static, Result<(usize, Arc<LoadedFile>)>>
        })
        .collect::<Vec<_>>();
    let mut loads = stream::iter(jobs).buffer_unordered(concurrency);
    let mut loaded = vec![None; scan.files.len()];
    while let Some(file) = loads.next().await {
        let (index, file) = file?;
        loaded[index] = Some(file);
    }
    let loaded = loaded
        .into_iter()
        .map(|file| file.expect("all metadata jobs completed"))
        .collect::<Vec<_>>();
    let metadata_ms = metadata_started.elapsed().as_secs_f64() * 1000.0;
    let selection_started = Instant::now();
    let jobs = scan
        .files
        .iter()
        .zip(loaded)
        .map(|(source, file)| {
            let ranges = match &source.selection {
                Some(FileSelection::RowRanges(ranges)) => Some(Arc::clone(ranges)),
                None if scan.unfiltered => None,
                _ => unreachable!("selection was validated"),
            };
            async move {
                tokio::task::yield_now().await;
                let ids =
                    file.index
                        .select_blocks(ranges.as_deref().map(Vec::as_slice), None, None)?;
                ensure!(
                    ids.windows(2).all(|pair| pair[0] < pair[1]),
                    "block selection is not unique and ordered"
                );
                Ok(SelectedFile { file, ids })
            }
        })
        .collect::<Vec<_>>();
    let selected = collect_preflight_tasks(jobs, concurrency).await?;
    let selection_ms = selection_started.elapsed().as_secs_f64() * 1000.0;
    let bucketing_started = Instant::now();
    let intervals = Arc::new(partitions.to_vec());
    let jobs = selected
        .into_iter()
        .map(|file| bucket_selected_file(file, Arc::clone(&intervals)))
        .collect::<Vec<_>>();
    let bucketed = collect_preflight_tasks(jobs, concurrency).await?;
    let mut shards = (0..partitions.len())
        .map(|_| Vec::new())
        .collect::<Vec<_>>();
    for file in bucketed {
        for (shard, selected) in shards.iter_mut().zip(file) {
            if !selected.ids.is_empty() {
                shard.push(selected);
            }
        }
    }
    let bucketing_ms = bucketing_started.elapsed().as_secs_f64() * 1000.0;
    let validation_started = Instant::now();
    let jobs = shards
        .into_iter()
        .map(|files| validate_partition(files, Arc::clone(&load_labels), window, offset))
        .collect::<Vec<_>>();
    let validated = collect_preflight_tasks(jobs, concurrency).await?;
    let validation_ms = validation_started.elapsed().as_secs_f64() * 1000.0;
    let finalize_started = Instant::now();
    let series = validated
        .iter()
        .map(|partition| partition.series)
        .sum::<usize>();
    let stats = Arc::new(ReadStats {
        trace_id: eval.trace_id.clone(),
        partitions: partitions.len(),
        selected_blocks: validated
            .iter()
            .map(|partition| partition.selected_blocks)
            .sum(),
        selected_bytes: validated
            .iter()
            .map(|partition| partition.selected_bytes)
            .sum(),
        read_batches: AtomicU64::new(0),
        read_ranges: AtomicU64::new(0),
        read_bytes: AtomicU64::new(0),
        decoded_blocks: AtomicU64::new(0),
        completed_partitions: AtomicU64::new(0),
    });
    let results = validated
        .into_iter()
        .map(|partition| PreparedPartition {
            files: partition.files,
            columns: Arc::clone(&columns),
            window,
            offset,
            stats: Arc::clone(&stats),
        })
        .collect::<Vec<_>>();
    log::info!(
        "[trace_id: {}] [PromQL] metrics blocks preflight phases: metadata {:.3} ms, selection {:.3} ms, bucketing {:.3} ms, validation {:.3} ms, finalize {:.3} ms",
        eval.trace_id,
        metadata_ms,
        selection_ms,
        bucketing_ms,
        validation_ms,
        finalize_started.elapsed().as_secs_f64() * 1000.0,
    );
    log::info!(
        "[trace_id: {}] [PromQL] metrics blocks prepared cursors: min {}, max {}, total {}",
        eval.trace_id,
        results
            .iter()
            .map(|partition| partition.files.len())
            .min()
            .unwrap_or(0),
        results
            .iter()
            .map(|partition| partition.files.len())
            .max()
            .unwrap_or(0),
        results
            .iter()
            .map(|partition| partition.files.len())
            .sum::<usize>(),
    );
    log::info!(
        "[trace_id: {}] [PromQL] metrics blocks preflight: {} files, {} series, {} hash partitions, metadata cache {} bytes",
        eval.trace_id,
        scan.files.len(),
        series,
        partitions.len(),
        INDEX_CACHE.lock().unwrap_or_else(|e| e.into_inner()).bytes
    );
    Ok(results)
}

fn external(error: anyhow::Error) -> DataFusionError {
    DataFusionError::External(error.into())
}

fn label_value<'a>(index: &'a Index, row: usize, name: &str) -> Result<Option<&'a str>> {
    index.label_value(row, name)
}

async fn load_index(file: &FileKey, labels: &[String]) -> Result<Arc<LoadedFile>> {
    load_index_inner(file, labels, Arc::clone(&METADATA_WORKERS)).await
}

async fn load_index_inner(
    file: &FileKey,
    labels: &[String],
    workers: Arc<Semaphore>,
) -> Result<Arc<LoadedFile>> {
    let limit = cache_limit();
    load_index_cached(file, labels, workers, &INDEX_CACHE, &FILE_LOADS, limit).await
}

async fn load_index_cached(
    file: &FileKey,
    labels: &[String],
    workers: Arc<Semaphore>,
    cache: &Mutex<IndexCache>,
    flights: &Arc<loads::LoadRegistry>,
    limit: usize,
) -> Result<Arc<LoadedFile>> {
    let parent = ParentIdentity {
        object_key: file.key.clone(),
        rows: u64::try_from(file.meta.records)?,
        compressed_size: u64::try_from(file.meta.compressed_size)?,
    };
    ensure!(
        parent.rows > 0 && parent.compressed_size > 0,
        "invalid block parent identity"
    );
    ensure!(
        file.meta.mindex_size > 0,
        "block sidecar size is not recorded"
    );
    let sidecar = config::meta::promql::index::metrics_index_path(&file.key)
        .context("unsupported block parent layout")?;
    let key = CacheKey {
        account: file.account.clone(),
        parent: parent.clone(),
    };
    let cached = {
        let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.trim(limit);
        cache.get(&key)
    };
    let permit = Arc::new(
        workers
            .acquire_owned()
            .await
            .context("metrics metadata admission closed")?,
    );
    MetadataLoad {
        file,
        labels,
        key,
        sidecar,
        limit,
        permit,
        cache,
        flights,
    }
    .run(cached)
    .await
}

async fn load_entry(
    file: &FileKey,
    labels: &[String],
    parent: &ParentIdentity,
    sidecar: &str,
    cached: Option<Arc<CachedIndex>>,
    permit: Arc<OwnedSemaphorePermit>,
) -> Result<Arc<CachedIndex>> {
    if cached
        .as_ref()
        .map(|entry| entry.index.missing_labels(labels))
        .transpose()?
        .is_some_and(|missing| missing.is_empty())
    {
        return Ok(cached.unwrap());
    }
    let _permit = permit;
    Ok(metrics_index::fetch_parsed_index(
        &file.account,
        sidecar,
        parent.metadata(),
        file.meta.mindex_size,
        labels,
        cached,
    )
    .await?)
}

fn query_window(eval: &EvalContext, offset: i64, lookback: i64) -> Option<(i64, i64)> {
    let start = eval.start.checked_sub(offset)?;
    let end = eval.end.checked_sub(offset)?;
    if lookback < 0 || end < start {
        return None;
    }
    if start != end
        && eval.step > 0
        && eval.step >= lookback.checked_mul(5)?
        && end
            .checked_sub(start)?
            .checked_div(eval.step)?
            .checked_add(1)?
            < 30
    {
        return None;
    }
    Some((start.checked_sub(lookback)?, end))
}

async fn collect_preflight_tasks<T, F>(
    jobs: impl IntoIterator<Item = F>,
    concurrency: usize,
) -> Result<Vec<T>>
where
    T: Send + 'static,
    F: Future<Output = Result<T>> + Send + 'static,
{
    let mut jobs = jobs.into_iter().enumerate();
    let mut tasks = JoinSet::new();
    let mut results = Vec::new();
    for _ in 0..concurrency.max(1) {
        let Some((position, job)) = jobs.next() else {
            break;
        };
        results.push(None);
        tasks.spawn(async move { (position, job.await) });
    }
    while let Some(joined) = tasks.join_next().await {
        let result = match joined {
            Ok((position, value)) => value.map(|value| (position, value)),
            Err(error) => Err(anyhow::anyhow!("block preflight task failed: {error}")),
        };
        match result {
            Ok((position, value)) => results[position] = Some(value),
            Err(error) => {
                tasks.shutdown().await;
                return Err(error);
            }
        }
        if let Some((position, job)) = jobs.next() {
            results.push(None);
            tasks.spawn(async move { (position, job.await) });
        }
    }
    Ok(results
        .into_iter()
        .map(|value| value.expect("all preflight tasks joined"))
        .collect())
}

async fn bucket_selected_file(
    selected: SelectedFile,
    partitions: Arc<Vec<(u64, u64)>>,
) -> Result<Vec<SelectedFile>> {
    let mut shards = (0..partitions.len())
        .map(|_| Vec::new())
        .collect::<Vec<_>>();
    for chunk in selected.ids.chunks(PREFLIGHT_CPU_CHUNK) {
        for &id in chunk {
            let block = &selected.file.index.blocks.block(id);
            let shard = partitions.partition_point(|range| range.1 < block.hash);
            ensure!(
                shard < partitions.len() && block.hash >= partitions[shard].0,
                "hash outside shard intervals"
            );
            shards[shard].push(id);
        }
        tokio::task::yield_now().await;
    }
    Ok(shards
        .into_iter()
        .map(|ids| SelectedFile {
            file: Arc::clone(&selected.file),
            ids,
        })
        .collect())
}

async fn validate_partition(
    files: Vec<SelectedFile>,
    labels: Arc<Vec<String>>,
    window: (i64, i64),
    offset: i64,
) -> Result<ValidatedPartition> {
    let mut identities: HashMap<u64, SeriesValidation> = HashMap::new();
    for (file_id, file) in files.iter().enumerate() {
        for chunk in file.ids.chunks(PREFLIGHT_CPU_CHUNK) {
            for &id in chunk {
                let block = &file.file.index.blocks.block(id);
                ensure!(
                    block.strictly_increasing,
                    "duplicate timestamps require source-reader tie semantics"
                );
                ensure!(
                    block.min_timestamp.checked_add(offset).is_some()
                        && block.max_timestamp.checked_add(offset).is_some(),
                    "timestamp offset overflow"
                );
                match identities.entry(block.hash) {
                    hashbrown::hash_map::Entry::Vacant(entry) => {
                        entry.insert(SeriesValidation {
                            first_file: file_id,
                            first_block: id,
                            intervals: SeriesIntervals::One((
                                block.min_timestamp,
                                block.max_timestamp,
                            )),
                        });
                    }
                    hashbrown::hash_map::Entry::Occupied(mut entry) => {
                        let previous = entry.get_mut();
                        if previous.first_file != file_id {
                            for name in labels.iter() {
                                ensure!(
                                    label_value(
                                        &files[previous.first_file].file.index,
                                        previous.first_block,
                                        name
                                    )? == label_value(&file.file.index, id, name)?,
                                    "same-hash fragments have different projected labels"
                                );
                            }
                        }
                        previous
                            .intervals
                            .push((block.min_timestamp, block.max_timestamp));
                    }
                }
            }
            tokio::task::yield_now().await;
        }
    }
    for (position, series) in identities.values_mut().enumerate() {
        ensure!(
            series.intervals.disjoint(),
            "overlapping file/block timestamps require source-reader tie semantics"
        );
        if (position + 1) % PREFLIGHT_CPU_CHUNK == 0 {
            tokio::task::yield_now().await;
        }
    }
    let series = identities.len();
    drop(identities);
    let mut result = ValidatedPartition {
        files: Vec::new(),
        series,
        selected_blocks: 0,
        selected_bytes: 0,
    };
    for file in files {
        let mut selected = Vec::with_capacity(file.ids.len());
        for chunk in file.ids.chunks(PREFLIGHT_CPU_CHUNK) {
            for &id in chunk {
                let block = &file.file.index.blocks.block(id);
                if block.max_timestamp >= window.0 && block.min_timestamp <= window.1 {
                    selected.push(id);
                    result.selected_blocks += 1;
                    result.selected_bytes += u64::from(block.block_length);
                }
            }
            tokio::task::yield_now().await;
        }
        if !selected.is_empty() {
            result.files.push(FileCursor {
                file: file.file,
                selected,
                next: 0,
                pending: VecDeque::new(),
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    mod shared_cache;

    use std::sync::atomic::{AtomicBool, AtomicUsize};

    use async_trait::async_trait;
    use config::meta::{
        promql::{HASH_SORTED_TABLE_SUFFIX, value::Label},
        stream::FileMeta,
    };
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
            datatypes::{DataType, Field, Schema},
        },
        datasource::MemTable,
        prelude::{SessionConfig, SessionContext, col},
    };
    use futures::stream::BoxStream;
    use metrics_index::block::BlockWriter;
    use object_store::{
        CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
        PutMultipartOptions, PutOptions, PutPayload, PutResult, path::Path,
    };
    use promql_parser::label::{MatchOp, Matcher, Matchers};
    use tokio::sync::Notify;

    use super::*;
    use crate::series_stream::{
        SeriesSource,
        plan::{StreamingSelector, execute_partitioned},
    };

    type Row = (u64, i64, f64, Option<&'static str>);

    struct ActiveRead(Arc<AtomicUsize>);
    impl Drop for ActiveRead {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[derive(Debug)]
    struct TrackingStore {
        inner: Arc<object_store::memory::InMemory>,
        metadata_calls: Arc<AtomicUsize>,
        metadata_blocked: Arc<AtomicBool>,
        calls: Arc<AtomicUsize>,
        active: Arc<AtomicUsize>,
        entered: Arc<Notify>,
        gate: Option<Arc<Notify>>,
        metadata_gate: Option<Arc<Notify>>,
    }
    impl std::fmt::Display for TrackingStore {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("metrics-block-test")
        }
    }
    #[async_trait]
    impl ObjectStore for TrackingStore {
        async fn get_opts(
            &self,
            location: &Path,
            options: GetOptions,
        ) -> object_store::Result<GetResult> {
            self.metadata_calls.fetch_add(1, Ordering::SeqCst);
            if let Some(gate) = &self.metadata_gate
                && self.metadata_blocked.load(Ordering::SeqCst)
            {
                self.active.fetch_add(1, Ordering::SeqCst);
                let _active = ActiveRead(Arc::clone(&self.active));
                self.entered.notify_one();
                gate.notified().await;
            }
            self.inner.get_opts(location, options).await
        }
        async fn get_ranges(
            &self,
            location: &Path,
            ranges: &[std::ops::Range<u64>],
        ) -> object_store::Result<Vec<Bytes>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.active.fetch_add(1, Ordering::SeqCst);
            let _active = ActiveRead(Arc::clone(&self.active));
            self.entered.notify_one();
            if let Some(gate) = &self.gate {
                gate.notified().await;
            }
            self.inner.get_ranges(location, ranges).await
        }
        async fn put_opts(
            &self,
            location: &Path,
            payload: PutPayload,
            options: PutOptions,
        ) -> object_store::Result<PutResult> {
            self.inner.put_opts(location, payload, options).await
        }
        async fn put_multipart_opts(
            &self,
            location: &Path,
            options: PutMultipartOptions,
        ) -> object_store::Result<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(location, options).await
        }
        fn delete_stream(
            &self,
            locations: BoxStream<'static, object_store::Result<Path>>,
        ) -> BoxStream<'static, object_store::Result<Path>> {
            self.inner.delete_stream(locations)
        }
        fn list(
            &self,
            prefix: Option<&Path>,
        ) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
            self.inner.list(prefix)
        }
        async fn list_with_delimiter(
            &self,
            prefix: Option<&Path>,
        ) -> object_store::Result<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }
        async fn copy_opts(
            &self,
            from: &Path,
            to: &Path,
            options: CopyOptions,
        ) -> object_store::Result<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    struct Fixture {
        account: String,
        inner: Arc<object_store::memory::InMemory>,
        metadata_calls: Arc<AtomicUsize>,
        metadata_blocked: Arc<AtomicBool>,
        metadata_gate: Option<Arc<Notify>>,
        calls: Arc<AtomicUsize>,
        active: Arc<AtomicUsize>,
        entered: Arc<Notify>,
    }
    impl Fixture {
        async fn new(files: &[(FileKey, Vec<u8>)], blocked: bool) -> Self {
            Self::with_gates(files, blocked, false).await
        }

        async fn with_gates(
            files: &[(FileKey, Vec<u8>)],
            blocked: bool,
            metadata_blocked: bool,
        ) -> Self {
            let id = config::ider::uuid();
            let account = format!("{id}:default");
            let store = TrackingStore {
                inner: Arc::new(object_store::memory::InMemory::new()),
                metadata_calls: Arc::new(AtomicUsize::new(0)),
                metadata_blocked: Arc::new(AtomicBool::new(metadata_blocked)),
                calls: Arc::new(AtomicUsize::new(0)),
                active: Arc::new(AtomicUsize::new(0)),
                entered: Arc::new(Notify::new()),
                gate: blocked.then(|| Arc::new(Notify::new())),
                metadata_gate: metadata_blocked.then(|| Arc::new(Notify::new())),
            };
            for (file, bytes) in files {
                store
                    .inner
                    .put_opts(
                        &config::meta::promql::index::metrics_index_path(&file.key)
                            .unwrap()
                            .into(),
                        Bytes::from(bytes.clone()).into(),
                        PutOptions::default(),
                    )
                    .await
                    .unwrap();
            }
            let fixture = Self {
                account,
                inner: Arc::clone(&store.inner),
                metadata_calls: Arc::clone(&store.metadata_calls),
                metadata_blocked: Arc::clone(&store.metadata_blocked),
                metadata_gate: store.metadata_gate.clone(),
                calls: Arc::clone(&store.calls),
                active: Arc::clone(&store.active),
                entered: Arc::clone(&store.entered),
            };
            infra::storage::add_account(&id, Box::new(store)).await;
            fixture
        }
        fn scan(&self, files: impl IntoIterator<Item = FileKey>) -> MetricsBlockScan {
            MetricsBlockScan {
                table_name: "m".into(),
                unfiltered: false,
                files: files
                    .into_iter()
                    .map(|mut file| {
                        file.account = self.account.clone();
                        file
                    })
                    .collect(),
            }
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn metadata_admission_bounds_remote_io_and_cancels_waiters() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::with_gates(std::slice::from_ref(&data), false, true).await;
        let key = fixture.scan([data.0]).files.remove(0);
        let workers = Arc::new(Semaphore::new(1));
        let first_file = key.clone();
        let first_workers = Arc::clone(&workers);
        let first =
            tokio::spawn(async move { load_index_inner(&first_file, &[], first_workers).await });
        fixture.entered.notified().await;
        let second_file = key.clone();
        let second_workers = Arc::clone(&workers);
        let second =
            tokio::spawn(async move { load_index_inner(&second_file, &[], second_workers).await });
        tokio::task::yield_now().await;
        assert_eq!(fixture.active.load(Ordering::SeqCst), 1);
        assert_eq!(workers.available_permits(), 0);
        second.abort();
        assert!(matches!(second.await, Err(error) if error.is_cancelled()));
        assert_eq!(fixture.active.load(Ordering::SeqCst), 1);
        first.abort();
        assert!(matches!(first.await, Err(error) if error.is_cancelled()));
        assert_eq!(fixture.active.load(Ordering::SeqCst), 0);
        assert_eq!(workers.available_permits(), 1);
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
        let cache_key = CacheKey {
            account: key.account.clone(),
            parent: ParentIdentity {
                object_key: key.key.clone(),
                rows: key.meta.records as u64,
                compressed_size: key.meta.compressed_size as u64,
            },
        };
        assert!(
            INDEX_CACHE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&cache_key)
                .is_none()
        );
        workers.close();
        assert!(load_index_inner(&key, &[], workers).await.is_err());
        assert_eq!(fixture.active.load(Ordering::SeqCst), 0);
    }

    fn schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("group", DataType::Utf8, true),
        ]))
    }
    fn batch(rows: &[Row]) -> RecordBatch {
        RecordBatch::try_new(
            schema(),
            vec![
                Arc::new(UInt64Array::from_iter_values(rows.iter().map(|r| r.0))),
                Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.1))),
                Arc::new(Float64Array::from_iter_values(rows.iter().map(|r| r.2))),
                Arc::new(StringArray::from(
                    rows.iter().map(|r| r.3).collect::<Vec<_>>(),
                )),
            ],
        )
        .unwrap()
    }
    fn file(rows: &[Row]) -> (FileKey, Vec<u8>) {
        file_batch(batch(rows), vec!["group".into()])
    }

    #[tokio::test]
    async fn label_pruning_seeds_block_metadata_cache() {
        let mut data = file(&[(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))]);
        data.0.key = data.0.key.replace(".parquet", ".vortex");
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let mut scan = fixture.scan([data.0]);
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "group", "x")]);
        let (_, exact) = metrics_index::search(
            "shared-index-test",
            &mut scan.files,
            schema().as_ref(),
            &matchers,
            1,
        )
        .await
        .unwrap()
        .unwrap();
        assert!(exact);
        let reads_after_pruning = fixture.metadata_calls.load(Ordering::SeqCst);
        assert!(reads_after_pruning > 0);
        let prepared = prepare(&scan, columns(), &intervals(), 100, 20, &eval())
            .await
            .unwrap();
        assert!(!prepared.is_empty());
        assert_eq!(
            fixture.metadata_calls.load(Ordering::SeqCst),
            reads_after_pruning
        );
    }

    fn file_batch(batch: RecordBatch, label_columns: Vec<String>) -> (FileKey, Vec<u8>) {
        let records = batch.num_rows();
        let timestamps = batch
            .column_by_name("_timestamp")
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let min_ts = *timestamps.values().iter().min().unwrap();
        let max_ts = *timestamps.values().iter().max().unwrap();
        let key = format!(
            "files/o/metrics/m/2026/09/18/06/indexed-v1-{}.parquet",
            config::ider::uuid()
        );
        let parent = ParentIdentity {
            object_key: key.clone(),
            rows: records as u64,
            compressed_size: 123,
        };
        let mut writer = BlockWriter::new(
            Vec::new(),
            batch.schema(),
            label_columns,
            parent.metadata(),
            2,
        )
        .unwrap();
        writer.write(&batch).unwrap();
        let bytes = writer.finish().unwrap();
        let mut file = FileKey::new(
            0,
            String::new(),
            key,
            FileMeta {
                records: records as i64,
                compressed_size: 123,
                mindex_size: bytes.len() as i64,
                min_ts,
                max_ts,
                ..Default::default()
            },
            false,
        );
        file.with_selection(
            FileSelection::RowRanges(Arc::new(std::iter::once(0..records).collect())),
            Some(131072),
        );
        (file, bytes)
    }
    fn columns() -> Arc<LabelColumns> {
        Arc::new(LabelColumns::grouped(vec!["group".into()]))
    }
    fn intervals() -> Vec<(u64, u64)> {
        let span = 1u128 << 64;
        (0..28u128)
            .map(|i| ((span * i / 28) as u64, (span * (i + 1) / 28 - 1) as u64))
            .collect()
    }
    fn eval() -> EvalContext {
        EvalContext::new(130, 140, 5, "block-test".into())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn parallel_preflight_preserves_order_and_bounds_live_tasks() {
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let jobs = (0..9).map(|index| {
            let active = Arc::clone(&active);
            let peak = Arc::clone(&peak);
            async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                let _guard = ActiveRead(active);
                peak.fetch_max(count, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(9 - index)).await;
                Ok(index)
            }
        });
        let result = collect_preflight_tasks(jobs, 3).await.unwrap();
        assert_eq!(result, (0..9).collect::<Vec<_>>());
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert_eq!(peak.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn parallel_preflight_error_and_panic_abort_and_drain_pending_tasks() {
        for panic in [false, true] {
            let active = Arc::new(AtomicUsize::new(0));
            let entered = Arc::new(Notify::new());
            let waiting_active = Arc::clone(&active);
            let waiting_entered = Arc::clone(&entered);
            let waiting = Box::pin(async move {
                waiting_active.fetch_add(1, Ordering::SeqCst);
                let _guard = ActiveRead(waiting_active);
                waiting_entered.notify_one();
                futures::future::pending::<Result<usize>>().await
            }) as futures::future::BoxFuture<'static, Result<usize>>;
            let failing = Box::pin(async move {
                entered.notified().await;
                assert!(!panic, "injected preflight panic");
                anyhow::bail!("injected preflight failure")
            }) as futures::future::BoxFuture<'static, Result<usize>>;
            let error = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                collect_preflight_tasks(vec![waiting, failing], 2),
            )
            .await
            .unwrap()
            .unwrap_err();
            assert!(error.to_string().contains(if panic {
                "task failed"
            } else {
                "injected preflight failure"
            }));
            assert_eq!(active.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn cancelling_parallel_preflight_drops_owned_cpu_tasks() {
        let active = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Notify::new());
        let task_active = Arc::clone(&active);
        let task_entered = Arc::clone(&entered);
        let task = tokio::spawn(collect_preflight_tasks(
            [async move {
                task_active.fetch_add(1, Ordering::SeqCst);
                let _guard = ActiveRead(task_active);
                task_entered.notify_one();
                futures::future::pending::<Result<usize>>().await
            }],
            1,
        ));
        entered.notified().await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while active.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("dropping preflight must abort its owned tasks");
    }

    #[tokio::test]
    async fn parallel_preflight_validates_fragments_outside_query_time_before_pruning() {
        let first = file(&[(1, -100, 1.0, None), (9, 20, 9.0, Some("inside"))]);
        let overlap = file(&[(1, -100, 2.0, None)]);
        let changed_label = file(&[(1, -90, 3.0, Some("changed"))]);
        let duplicate = file(&[(1, -100, 1.0, None), (1, -100, 2.0, None)]);
        let fixture = Fixture::new(
            &[
                first.clone(),
                overlap.clone(),
                changed_label.clone(),
                duplicate.clone(),
            ],
            false,
        )
        .await;
        for (files, expected) in [
            (vec![first.0.clone(), overlap.0], "overlapping"),
            (
                vec![first.0.clone(), changed_label.0],
                "different projected labels",
            ),
            (vec![duplicate.0], "duplicate timestamps"),
        ] {
            let error = prepare(
                &fixture.scan(files),
                columns(),
                &intervals(),
                100,
                20,
                &eval(),
            )
            .await;
            assert!(error.err().unwrap().to_string().contains(expected));
        }
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn time_window_preserves_offset_and_rejects_sparse_evaluation() {
        let eval = EvalContext::new(1_000_000, 3_000_000, 500_000, "test".into());
        assert_eq!(
            query_window(&eval, 200_000, 1_000_000),
            Some((-200_000, 2_800_000))
        );
        let sparse = EvalContext::new(10_000_000, 20_000_000, 10_000_000, "test".into());
        assert_eq!(query_window(&sparse, 0, 1_000_000), None);
        assert_eq!(query_window(&eval, i64::MIN, 1), None);
    }

    #[tokio::test]
    async fn blocks_merge_fragments_filter_time_preserve_bits_labels_and_shards() {
        let nan = f64::from_bits(0x7ff8000000000042);
        let first = file(&[
            (0, 0, 1.0, None),
            (0, 10, nan, None),
            (0, 20, -0.0, None),
            (u64::MAX, 10, 3.0, Some("")),
        ]);
        let second = file(&[
            (0, 30, 0.0, None),
            (0, 40, 7.0, None),
            (0, 50, 8.0, None),
            (u64::MAX, 40, 9.0, Some("")),
        ]);
        let fixture = Fixture::new(&[first.clone(), second.clone()], false).await;
        let scan = fixture.scan([first.0, second.0]);
        let prepared = prepare(&scan, columns(), &intervals(), 100, 20, &eval())
            .await
            .unwrap();
        assert_eq!(prepared.len(), 28);
        let stats = Arc::clone(&prepared[0].stats);
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
        let mut result = Vec::new();
        for (shard, partition) in prepared.into_iter().enumerate() {
            let mut stream = BlockSeriesStream::new(partition);
            let mut samples = Vec::new();
            while stream.advance().await.unwrap().is_some() {
                stream.consume(&mut samples).await.unwrap();
                result.push((
                    shard,
                    stream.labels(),
                    samples
                        .iter()
                        .map(|s| (s.timestamp, s.value.to_bits()))
                        .collect::<Vec<_>>(),
                ));
            }
        }
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].0, 0);
        assert!(result[0].1.is_empty());
        assert_eq!(
            result[0].2,
            vec![
                (110, nan.to_bits()),
                (120, (-0.0f64).to_bits()),
                (130, 0.0f64.to_bits()),
                (140, 7.0f64.to_bits())
            ]
        );
        assert_eq!(result[1].0, 27);
        assert_eq!(result[1].1, vec![Arc::new(Label::new("group", ""))]);
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 4);
        assert_eq!(stats.read_batches.load(Ordering::Relaxed), 4);
        assert_eq!(stats.completed_partitions.load(Ordering::Relaxed), 28);
        assert_eq!(
            stats.decoded_blocks.load(Ordering::Relaxed),
            stats.selected_blocks as u64
        );
    }

    #[tokio::test]
    async fn local_disk_sidecar_reads_selected_samples_without_mmap() {
        let (mut file, bytes) = file(&[
            (0, 10, 1.0, Some("x")),
            (0, 20, 2.0, Some("x")),
            (1, 10, 3.0, Some("y")),
        ]);
        let directory = tempfile::tempdir().unwrap();
        let sidecar = config::meta::promql::index::metrics_index_path(&file.key).unwrap();
        let path = directory.path().join(&sidecar);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
        let id = config::ider::uuid();
        infra::storage::add_account(
            &id,
            Box::new(
                object_store::local::LocalFileSystem::new_with_prefix(directory.path()).unwrap(),
            ),
        )
        .await;
        file.account = format!("{id}:default");
        let scan = MetricsBlockScan {
            table_name: "m".into(),
            files: vec![file],
            unfiltered: false,
        };
        let prepared = prepare(&scan, columns(), &intervals(), 100, 20, &eval())
            .await
            .unwrap();
        let mut result = Vec::new();
        for partition in prepared {
            let mut stream = BlockSeriesStream::new(partition);
            while stream.advance().await.unwrap().is_some() {
                let labels = stream.labels();
                let mut samples = Vec::new();
                stream.consume(&mut samples).await.unwrap();
                result.push((
                    labels,
                    samples
                        .iter()
                        .map(|sample| (sample.timestamp, sample.value.to_bits()))
                        .collect::<Vec<_>>(),
                ));
            }
        }
        result.sort_by(|left, right| left.1.cmp(&right.1));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].0, vec![Arc::new(Label::new("group", "x"))]);
        assert_eq!(
            result[0].1,
            vec![(110, 1.0f64.to_bits()), (120, 2.0f64.to_bits())]
        );
        assert_eq!(result[1].0, vec![Arc::new(Label::new("group", "y"))]);
        assert_eq!(result[1].1, vec![(110, 3.0f64.to_bits())]);
    }

    #[tokio::test]
    async fn coalesced_reads_slice_only_selected_blocks_and_flush_local_stats() {
        let (mut key, mut bytes) = file(&[
            (1, 10, 1.0, Some("first")),
            (1, 20, -0.0, Some("first")),
            (2, 10, 7.0, Some("unselected")),
            (2, 20, 8.0, Some("unselected")),
            (3, 10, 9.0, Some("last")),
            (3, 20, 10.0, Some("last")),
        ]);
        let index = metrics_index::block::decode_file(
            &bytes,
            &ParentMetadata {
                rows: 6,
                compressed_size: 123,
            },
            &["group".into()],
        )
        .unwrap();
        assert_eq!(index.blocks.len(), 3);
        // The gap is read but its unselected payload must never be decoded.
        bytes[index.blocks.block(1).block_offset as usize] ^= 1;
        key.with_selection(
            FileSelection::RowRanges(Arc::new(vec![0..2, 4..6])),
            Some(131072),
        );
        let fixture = Fixture::new(&[(key.clone(), bytes)], false).await;
        let prepared = prepare(
            &fixture.scan([key]),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        let stats = Arc::clone(&prepared[0].stats);
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        assert!(stream.decoder.is_none());
        let mut actual = Vec::new();
        let mut samples = Vec::new();
        while stream.advance().await.unwrap().is_some() {
            stream.consume(&mut samples).await.unwrap();
            actual.push(
                samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>(),
            );
        }
        assert_eq!(
            actual,
            vec![
                vec![(110, 1.0f64.to_bits()), (120, (-0.0f64).to_bits())],
                vec![(110, 9.0f64.to_bits()), (120, 10.0f64.to_bits())]
            ]
        );
        assert_eq!(stream.local_stats.decoded_blocks, 2);
        assert_eq!(stats.decoded_blocks.load(Ordering::Relaxed), 0);
        assert!(stream.decoder.is_some());
        drop(stream);
        assert_eq!(stats.decoded_blocks.load(Ordering::Relaxed), 2);
        assert_eq!(stats.read_batches.load(Ordering::Relaxed), 1);
        assert_eq!(stats.read_ranges.load(Ordering::Relaxed), 1);
        assert_eq!(stats.completed_partitions.load(Ordering::Relaxed), 1);
        assert!(stats.read_bytes.load(Ordering::Relaxed) > stats.selected_bytes);
    }

    #[tokio::test]
    async fn blocks_preserve_ungrouped_sum_rate_with_empty_label_projection() {
        use std::time::Duration;

        use config::meta::promql::value::Value;

        use crate::{aggregations::AggOp, functions, streaming_eval};

        let rows = [
            (0, 10, 0.0, Some("x")),
            (0, 20, 2.0, Some("x")),
            (0, 30, 1.0, Some("x")),
            (0, 40, 4.0, Some("x")),
            (u64::MAX, 10, 10.0, None),
            (u64::MAX, 20, 13.0, None),
            (u64::MAX, 30, 17.0, None),
            (u64::MAX, 40, 20.0, None),
        ];
        let data = file(&rows);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let scan = Arc::new(fixture.scan([data.0]));
        let eval = EvalContext::new(30, 40, 5, "ungrouped-block-rate".into());
        let mut values = Vec::new();
        for blocks in [false, true] {
            let mut config = SessionConfig::new().with_target_partitions(28);
            config
                .options_mut()
                .optimizer
                .enable_round_robin_repartition = false;
            config.options_mut().optimizer.prefer_existing_sort = true;
            if blocks {
                config.set_extension(Arc::clone(&scan));
            }
            let ctx = SessionContext::new_with_config(config);
            let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                .unwrap()
                .with_sort_order(vec![vec![
                    col("__hash__").sort(true, false),
                    col("_timestamp").sort(true, false),
                ]]);
            ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
                .unwrap();
            let matchers = Matchers::empty();
            let selector = StreamingSelector {
                table_name: "m",
                matchers: &matchers,
                offset: 0,
            };
            let sources = execute_partitioned(
                &ctx,
                schema().as_ref(),
                &selector,
                LabelColumns::grouped(vec![]),
                20,
                &eval,
            )
            .await
            .unwrap()
            .unwrap();
            let func: Arc<dyn functions::RangeFunc> =
                Arc::from(functions::fusable_range_func("rate").unwrap());
            let range = Arc::new(streaming_eval::RangeExpr::new(
                func,
                Duration::from_micros(20),
                &eval,
            ));
            let Value::Matrix(matrix) = streaming_eval::aggregate(sources, AggOp::Sum, range)
                .await
                .unwrap()
                .0
            else {
                panic!("expected grouped matrix");
            };
            assert_eq!(matrix.len(), 1);
            assert!(matrix[0].labels.is_empty());
            values.push(
                matrix[0]
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>(),
            );
        }
        assert_eq!(values[0], values[1]);
        assert!(
            fixture.calls.load(Ordering::SeqCst) > 0,
            "must exercise the block reader"
        );
    }

    #[tokio::test]
    async fn blocks_preserve_all_fusable_range_function_results() {
        use std::time::Duration;

        use crate::{functions, streaming_eval};

        let rows = [
            (0, 10, 0.0, Some("x")),
            (0, 20, 2.0, Some("x")),
            (0, 30, 1.0, Some("x")),
            (0, 40, 4.0, Some("x")),
            (u64::MAX, 10, 10.0, None),
            (u64::MAX, 20, 13.0, None),
            (u64::MAX, 30, 17.0, None),
            (u64::MAX, 40, 20.0, None),
        ];
        let data = file(&rows);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let scan = Arc::new(fixture.scan([data.0]));
        let eval = EvalContext::new(30, 40, 5, "all-block-range-functions".into());
        let mut contexts = Vec::new();
        for blocks in [false, true] {
            let mut config = SessionConfig::new().with_target_partitions(28);
            config
                .options_mut()
                .optimizer
                .enable_round_robin_repartition = false;
            config.options_mut().optimizer.prefer_existing_sort = true;
            if blocks {
                config.set_extension(Arc::clone(&scan));
            }
            let ctx = SessionContext::new_with_config(config);
            let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                .unwrap()
                .with_sort_order(vec![vec![
                    col("__hash__").sort(true, false),
                    col("_timestamp").sort(true, false),
                ]]);
            ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
                .unwrap();
            contexts.push(ctx);
        }
        for name in [
            "avg_over_time",
            "changes",
            "count_over_time",
            "delta",
            "deriv",
            "idelta",
            "increase",
            "irate",
            "last_over_time",
            "max_over_time",
            "min_over_time",
            "rate",
            "resets",
            "stddev_over_time",
            "stdvar_over_time",
            "sum_over_time",
        ] {
            let mut outputs = Vec::new();
            for ctx in &contexts {
                let matchers = Matchers::empty();
                let selector = StreamingSelector {
                    table_name: "m",
                    matchers: &matchers,
                    offset: 0,
                };
                let sources = execute_partitioned(
                    ctx,
                    schema().as_ref(),
                    &selector,
                    LabelColumns::grouped(vec!["group".into()]),
                    20,
                    &eval,
                )
                .await
                .unwrap()
                .unwrap();
                let func: Arc<dyn functions::RangeFunc> =
                    Arc::from(functions::fusable_range_func(name).unwrap());
                let range = Arc::new(streaming_eval::RangeExpr::new(
                    func,
                    Duration::from_micros(20),
                    &eval,
                ));
                let (series, _) = streaming_eval::eval_range(sources, range).await.unwrap();
                let mut output = series
                    .into_iter()
                    .map(|series| {
                        (
                            series
                                .labels
                                .iter()
                                .map(|label| (label.name.clone(), label.value.clone()))
                                .collect::<Vec<_>>(),
                            series
                                .samples
                                .iter()
                                .map(|sample| (sample.timestamp, sample.value.to_bits()))
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect::<Vec<_>>();
                output.sort_unstable();
                outputs.push(output);
            }
            assert_eq!(outputs[0], outputs[1], "range function {name}");
        }
        assert!(fixture.calls.load(Ordering::SeqCst) > 0);
    }

    #[tokio::test]
    async fn preflight_rejects_partial_series_duplicates_and_cross_file_ties_without_payload() {
        let a = file(&[
            (1, 10, 1.0, Some("x")),
            (1, 20, 2.0, Some("x")),
            (1, 30, 3.0, Some("x")),
        ]);
        let b = file(&[(1, 30, 9.0, Some("x")), (1, 40, 10.0, Some("x"))]);
        let duplicate = file(&[(2, 10, 1.0, Some("x")), (2, 10, 2.0, Some("x"))]);
        let fixture = Fixture::new(&[a.clone(), b.clone(), duplicate.clone()], false).await;
        let mut partial = a.0.clone();
        partial.with_selection(
            FileSelection::RowRanges(Arc::new(std::iter::once(0..2).collect())),
            Some(131072),
        );
        for scan in [
            fixture.scan([partial]),
            fixture.scan([a.0, b.0]),
            fixture.scan([duplicate.0]),
        ] {
            assert!(
                prepare(&scan, columns(), &intervals(), 100, 20, &eval())
                    .await
                    .is_err()
            );
        }
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn missing_metadata_falls_back_to_original_stream_before_payload() {
        let rows = [(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))];
        let valid = file(&rows);
        let missing = file(&[(2, 30, 3.0, Some("y"))]);
        let fixture = Fixture::new(std::slice::from_ref(&valid), false).await;
        let scan = fixture.scan([valid.0, missing.0]);
        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(2)
                .with_extension(Arc::new(scan)),
        );
        let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
            .unwrap()
            .with_sort_order(vec![vec![
                col("__hash__").sort(true, false),
                col("_timestamp").sort(true, false),
            ]]);
        ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
            .unwrap();
        let matchers = Matchers::empty();
        let selector = StreamingSelector {
            table_name: "m",
            matchers: &matchers,
            offset: 100,
        };
        let sources = execute_partitioned(
            &ctx,
            schema().as_ref(),
            &selector,
            LabelColumns::grouped(vec!["group".into()]),
            20,
            &eval(),
        )
        .await
        .unwrap()
        .unwrap();
        for source in sources {
            assert!(matches!(source.await.unwrap(), SeriesSource::DataFusion(_)));
        }
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn legacy_new_mixed_and_disabled_sources_preserve_same_series_fragments() {
        use datafusion::arrow::{array::UInt32Array, ipc::writer::FileWriter};
        let rows = [
            (1, 10, 1.0, Some("x")),
            (1, 20, -0.0, Some("x")),
            (1, 30, 3.0, Some("x")),
            (1, 40, 4.0, Some("x")),
        ];
        let legacy_schema = Arc::new(Schema::new(vec![
            Field::new("__oo_midx_row_count", DataType::UInt32, false),
            Field::new("group", DataType::Utf8, true),
        ]));
        let legacy_batch = RecordBatch::try_new(
            Arc::clone(&legacy_schema),
            vec![
                Arc::new(UInt32Array::from(vec![2])),
                Arc::new(StringArray::from(vec!["x"])),
            ],
        )
        .unwrap();
        let mut legacy = Vec::new();
        let mut writer = FileWriter::try_new(&mut legacy, &legacy_schema).unwrap();
        writer.write(&legacy_batch).unwrap();
        writer.finish().unwrap();
        for legacy_count in [0, 1, 2] {
            for enabled in [false, true] {
                let mut files = vec![file(&rows[..2]), file(&rows[2..])];
                for source in files.iter_mut().take(legacy_count) {
                    source.1 = legacy.clone();
                }
                let fixture = Fixture::new(&files, false).await;
                let mut config = SessionConfig::new().with_target_partitions(2);
                if enabled {
                    config.set_extension(Arc::new(fixture.scan(files.iter().map(|v| v.0.clone()))));
                }
                let ctx = SessionContext::new_with_config(config);
                let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                    .unwrap()
                    .with_sort_order(vec![vec![
                        col("__hash__").sort(true, false),
                        col("_timestamp").sort(true, false),
                    ]]);
                ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
                    .unwrap();
                let matchers = Matchers::empty();
                let selector = StreamingSelector {
                    table_name: "m",
                    matchers: &matchers,
                    offset: 0,
                };
                let sources = execute_partitioned(
                    &ctx,
                    schema().as_ref(),
                    &selector,
                    LabelColumns::grouped(vec!["group".into()]),
                    20,
                    &EvalContext::new(10, 40, 10, "compatibility".into()),
                )
                .await
                .unwrap()
                .unwrap();
                let mut actual = Vec::new();
                for source in sources {
                    let mut source = source.await.unwrap();
                    assert_eq!(
                        matches!(&source, SeriesSource::Block(_)),
                        enabled && legacy_count == 0
                    );
                    while source.advance().await.unwrap().is_some() {
                        let mut samples = Vec::new();
                        source.consume(&mut samples).await.unwrap();
                        actual.extend(samples.iter().map(|s| (s.timestamp, s.value.to_bits())));
                    }
                }
                actual.sort_unstable();
                assert_eq!(
                    actual,
                    rows.iter()
                        .map(|r| (r.1, r.2.to_bits()))
                        .collect::<Vec<_>>()
                );
                assert_eq!(
                    fixture.calls.load(Ordering::SeqCst) > 0,
                    enabled && legacy_count == 0
                );
            }
        }
    }

    #[tokio::test]
    async fn schema_evolution_distinguishes_absent_null_and_empty_labels() {
        let original = batch(&[(1, 10, 1.0, None), (1, 20, 2.0, None)]);
        let absent = RecordBatch::try_new(
            Arc::new(Schema::new(original.schema().fields()[..3].to_vec())),
            original.columns()[..3].to_vec(),
        )
        .unwrap();
        let absent = file_batch(absent, vec![]);
        let null = file(&[(1, 30, 3.0, None), (1, 40, 4.0, None)]);
        let empty = file(&[(1, 30, 3.0, Some("")), (1, 40, 4.0, Some(""))]);
        let fixture = Fixture::new(&[absent.clone(), null.clone(), empty.clone()], false).await;
        let prepared = prepare(
            &fixture.scan([absent.0.clone(), null.0]),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        assert!(stream.advance().await.unwrap().is_some());
        assert!(stream.labels().is_empty());
        let mut samples = Vec::new();
        stream.consume(&mut samples).await.unwrap();
        assert_eq!(samples.len(), 4);
        assert!(
            prepare(
                &fixture.scan([absent.0, empty.0]),
                columns(),
                &intervals(),
                100,
                20,
                &eval()
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn malformed_metadata_cancels_other_pending_preflight_reads() {
        let pending = file(&[(1, 10, 1.0, Some("x"))]);
        let mut malformed = file(&[(2, 10, 2.0, Some("y"))]);
        let end = malformed.1.len();
        malformed.1[end - 1] ^= 1;
        let slow = Fixture::with_gates(std::slice::from_ref(&pending), false, true).await;
        let fast = Fixture::new(std::slice::from_ref(&malformed), false).await;
        let mut scan = slow.scan([pending.0]);
        scan.files.extend(fast.scan([malformed.0]).files);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            prepare(&scan, columns(), &intervals(), 100, 20, &eval()),
        )
        .await
        .expect("later metadata error must not wait behind pending reads");
        assert!(result.is_err());
        assert!(
            futures::FutureExt::now_or_never(slow.entered.notified()).is_some(),
            "the canceled metadata request must have started"
        );
        assert_eq!(slow.active.load(Ordering::SeqCst), 0);
        assert_eq!(slow.calls.load(Ordering::SeqCst), 0);
        assert_eq!(fast.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn corrupt_payload_fails_after_preflight_instead_of_falling_back() {
        let (key, mut bytes) = file(&[(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))]);
        let parent = ParentIdentity {
            object_key: key.key.clone(),
            rows: 2,
            compressed_size: 123,
        };
        let index =
            metrics_index::block::decode_file(&bytes, &parent.metadata(), &["group".into()])
                .unwrap();
        bytes[index.blocks.block(0).block_offset as usize] ^= 1;
        let fixture = Fixture::new(&[(key.clone(), bytes)], false).await;
        let prepared = prepare(
            &fixture.scan([key]),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        let stats = Arc::clone(&prepared[0].stats);
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        assert!(stream.advance().await.is_err());
        assert_eq!(stats.read_batches.load(Ordering::Relaxed), 0);
        drop(stream);
        assert_eq!(stats.read_batches.load(Ordering::Relaxed), 1);
        assert_eq!(stats.decoded_blocks.load(Ordering::Relaxed), 0);
        assert_eq!(stats.completed_partitions.load(Ordering::Relaxed), 0);
        assert!(stats.read_bytes.load(Ordering::Relaxed) > 0);
    }

    #[tokio::test]
    async fn dropping_prepared_sources_never_starts_payload_reads() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let prepared = prepare(
            &fixture.scan([data.0]),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        drop(prepared);
        tokio::task::yield_now().await;
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn cancelling_pending_payload_drops_owned_read() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), true).await;
        let prepared = prepare(
            &fixture.scan([data.0]),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        let task = tokio::spawn(async move { stream.advance().await });
        fixture.entered.notified().await;
        assert_eq!(fixture.active.load(Ordering::SeqCst), 1);
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(fixture.active.load(Ordering::SeqCst), 0);
    }

    fn observed_cache() -> (IndexCache, prometheus::Registry) {
        let metrics = IndexBlocksCacheMetrics::default();
        let registry = prometheus::Registry::new();
        registry.register(Box::new(metrics.clone())).unwrap();
        (IndexCache::new(metrics), registry)
    }

    fn cache_entry() -> (CacheKey, Arc<CachedIndex>, CacheWeight) {
        let (file, bytes) = file(&[(1, 10, 1.0, Some("a-long-label-buffer"))]);
        let parent = ParentIdentity {
            object_key: file.key.clone(),
            rows: 1,
            compressed_size: 123,
        };
        let binding = SidecarBinding::parse(
            bytes.len() as u64,
            &bytes[bytes.len() - metrics_index::block::MIDX_TRAILER_LEN..],
        )
        .unwrap();
        let index = Arc::new(
            metrics_index::block::decode_file(&bytes, &parent.metadata(), &["group".into()])
                .unwrap(),
        );
        let key = CacheKey {
            account: "a".into(),
            parent,
        };
        let entry = Arc::new(CachedIndex { index, binding });
        let weight = CacheWeight::new(&key, &entry);
        (key, entry, weight)
    }

    fn cache_snapshot(registry: &prometheus::Registry) -> HashMap<String, f64> {
        let mut values = HashMap::new();
        for family in registry.gather() {
            let name = family
                .name()
                .strip_prefix("zo_metrics_index_blocks_cache_")
                .unwrap();
            for metric in family.get_metric() {
                assert!(
                    metric
                        .get_label()
                        .iter()
                        .all(|label| { ["cluster", "instance", "role"].contains(&label.name()) })
                );
                let name = name.to_owned();
                let value = if metric.gauge.is_some() {
                    metric.gauge.as_ref().unwrap().value()
                } else {
                    metric.counter.as_ref().unwrap().value()
                };
                assert!(value >= 0.0);
                assert!(values.insert(name, value).is_none());
            }
        }
        assert_eq!(values.len(), 3);
        values
    }

    #[test]
    fn metadata_cache_metrics_track_lru_replacement_invalidation_and_shrink() {
        let (mut cache, registry) = observed_cache();
        let (a, entry, weight) = cache_entry();
        let mut b = a.clone();
        b.account = "b".into();
        let mut c = a.clone();
        c.account = "c".into();
        cache.trim(weight.total * 2);
        assert!(cache.get(&a).is_none());
        cache
            .insert(a.clone(), Arc::clone(&entry), weight.total * 2)
            .unwrap();
        let first = cache_snapshot(&registry);
        assert_eq!(first["used_bytes"], weight.total as f64);
        cache
            .insert(b.clone(), Arc::clone(&entry), weight.total * 2)
            .unwrap();
        assert!(cache.get(&a).is_some());
        cache
            .insert(c.clone(), Arc::clone(&entry), weight.total * 2)
            .unwrap();
        assert!(cache.get(&b).is_none());
        assert!(cache.get(&a).is_some());
        cache.insert(a.clone(), entry, weight.total * 2).unwrap();
        assert_eq!(
            cache_snapshot(&registry)["used_bytes"],
            (weight.total * 2) as f64
        );
        assert_eq!(cache_snapshot(&registry)["evictions_total"], 1.0);
        cache.remove(&c);
        assert_eq!(cache_snapshot(&registry)["used_bytes"], weight.total as f64);
        assert_eq!(cache_snapshot(&registry)["evictions_total"], 1.0);
        cache.remove(&c);
        cache.trim(weight.total - 1);
        let values = cache_snapshot(&registry);
        assert_eq!(values["used_bytes"], 0.0);
        assert_eq!(values["hits_total"], 2.0);
        assert_eq!(values["evictions_total"], 2.0);
    }

    #[test]
    fn metadata_cache_metrics_reject_disabled_and_oversize_without_admission() {
        let (mut cache, registry) = observed_cache();
        let (key, entry, weight) = cache_entry();
        cache.trim(0);
        assert!(cache.get(&key).is_none());
        cache.insert(key.clone(), Arc::clone(&entry), 0).unwrap();
        cache.trim(weight.total - 1);
        assert!(cache.get(&key).is_none());
        cache
            .insert(key.clone(), Arc::clone(&entry), weight.total - 1)
            .unwrap();
        let values = cache_snapshot(&registry);
        assert!(values.values().all(|value| *value == 0.0));
        cache.insert(key, entry, weight.total).unwrap();
        cache.trim(0);
        let reset = cache_snapshot(&registry);
        assert_eq!(reset["used_bytes"], 0.0);
        assert_eq!(reset["evictions_total"], 1.0);
        let (_, registry) = observed_cache();
        assert!(
            cache_snapshot(&registry)
                .values()
                .all(|value| *value == 0.0)
        );
    }

    #[test]
    fn metadata_cache_metrics_remain_coherent_during_concurrent_mutation_and_scraping() {
        let (cache, registry) = observed_cache();
        let cache = Arc::new(Mutex::new(cache));
        let (key, entry, weight) = cache_entry();
        std::thread::scope(|scope| {
            for worker in 0..4 {
                let cache = Arc::clone(&cache);
                let mut key = key.clone();
                key.account = ((b'a' + worker) as char).to_string();
                let entry = Arc::clone(&entry);
                scope.spawn(move || {
                    for iteration in 0..100 {
                        let mut cache = cache.lock().unwrap();
                        cache.trim(weight.total * 3);
                        cache
                            .insert(key.clone(), Arc::clone(&entry), weight.total * 3)
                            .unwrap();
                        assert!(cache.get(&key).is_some());
                        if iteration % 5 == 0 {
                            cache.remove(&key);
                        }
                    }
                });
            }
            for _ in 0..1000 {
                cache_snapshot(&registry);
            }
        });
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 400.0);
        assert!(values["evictions_total"] >= 1.0);
        assert!(values["used_bytes"] <= (weight.total * 3) as f64);
        assert_eq!(values["used_bytes"], cache.lock().unwrap().bytes as f64);
    }

    #[tokio::test]
    async fn metadata_cache_metrics_release_accounting_before_cancelled_query_arc() {
        let (mut cache, registry) = observed_cache();
        let (key, entry, weight) = cache_entry();
        let weak = Arc::downgrade(&entry.index);
        cache.insert(key.clone(), entry, weight.total).unwrap();
        let cache = Arc::new(Mutex::new(cache));
        let worker_cache = Arc::clone(&cache);
        let (started, entered) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let held = Arc::clone(&worker_cache.lock().unwrap().get(&key).unwrap().index);
            started.send(()).unwrap();
            std::future::pending::<()>().await;
            drop(held);
        });
        entered.await.unwrap();
        cache.lock().unwrap().trim(0);
        let values = cache_snapshot(&registry);
        assert_eq!(values["used_bytes"], 0.0);
        assert_eq!(values["evictions_total"], 1.0);
        assert_eq!(values["hits_total"], 1.0);
        assert!(weak.upgrade().is_some());
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn metadata_cache_accounts_buffers_and_purges_on_budget_reduction() {
        let (file, bytes) = file(&[(1, 10, 1.0, Some("a-long-label-buffer"))]);
        let parent = ParentIdentity {
            object_key: file.key,
            rows: 1,
            compressed_size: 123,
        };
        let index = Arc::new(
            metrics_index::block::decode_file(&bytes, &parent.metadata(), &["group".into()])
                .unwrap(),
        );
        let key = CacheKey {
            account: "a".into(),
            parent,
        };
        let expected_heap = index.estimated_heap_size();
        let index = Arc::new(CachedIndex {
            index,
            binding: SidecarBinding::parse(
                bytes.len() as u64,
                &bytes[bytes.len() - metrics_index::block::MIDX_TRAILER_LEN..],
            )
            .unwrap(),
        });
        let mut cache = IndexCache::default();
        cache
            .insert(key.clone(), Arc::clone(&index), usize::MAX)
            .unwrap();
        assert!(cache.bytes >= expected_heap + std::mem::size_of::<CachedIndex>());
        assert!(cache.get(&key).is_some());
        let mut other = key.clone();
        other.account = "b".into();
        assert!(cache.get(&other).is_none());
        cache.trim(cache.bytes - 1);
        assert!(cache.get(&key).is_none());
        assert_eq!(cache.bytes, 0);
        cache.insert(key.clone(), index, usize::MAX).unwrap();
        cache.trim(0);
        assert!(cache.get(&key).is_none());
        assert_eq!(cache.bytes, 0);
    }
}
