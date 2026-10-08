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
    cmp::Reverse,
    collections::{BinaryHeap, VecDeque},
    hash::Hasher,
    ops::Range,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

use anyhow::{Context, Result, ensure};
use bytes::Bytes;
use config::{
    meta::{
        promql::{
            MetricsBlockScan,
            value::{EvalContext, Labels, Sample},
        },
        stream::FileKey,
    },
    utils::hash::gxhash,
};
use datafusion::error::DataFusionError;
use hashbrown::{HashMap, HashSet};
use itertools::Either;
use metrics_index::{
    block::{BlockDecoder, DecodedBlockRef, Index},
    block_cache::{CacheKey, CachedIndex, INDEX_CACHE, IndexCache, ParentIdentity, cache_limit},
};
use promql_parser::label::Matchers;
use tokio::task::JoinSet;

use super::{SeriesStream, plan::LabelColumns};
use crate::series_loader::label_interner::LabelInterner;

const PREFLIGHT_YIELD_INTERVAL: usize = 1024;
const PREFETCH_BLOCKS: usize = 512;
const PREFETCH_BYTES: usize = 16 * 1024 * 1024;

struct MetadataLoad<'a> {
    file: &'a FileKey,
    labels: &'a [String],
    key: CacheKey,
    sidecar: String,
    limit: usize,
    cache: &'a Mutex<IndexCache>,
    flights: &'a Arc<loads::LoadRegistry>,
}

impl MetadataLoad<'_> {
    async fn run(
        self,
        mut seed: Option<Arc<CachedIndex>>,
        mut complete: bool,
    ) -> Result<Arc<LoadedFile>> {
        let Self {
            file,
            labels,
            key,
            sidecar,
            limit,
            cache,
            flights,
        } = self;
        loop {
            if complete {
                let entry = seed.unwrap();
                return Ok(Arc::new(LoadedFile {
                    account: file.account.clone(),
                    sidecar,
                    index: Arc::new(entry.index.project(labels)?),
                }));
            }
            match flights.claim(key.clone()) {
                loads::Claim::Waiter(flight) => {
                    if let Some(loaded) = flight.wait().await? {
                        complete = loaded.index.missing_labels(labels)?.is_empty();
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
                    let loaded = load_entry(file, labels, &key.parent, &sidecar, seed).await;
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
            "[trace_id: {}] [PromQL] metrics blocks read: selected_blocks {}, selected_bytes {}, read_batches {}, returned_bytes {}, decoded_blocks {}, completed_partitions {}/{}, requested_ranges {}",
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
            let data = infra::cache::storage::get_ranges(
                &self.file.account,
                &self.file.sidecar.as_str().into(),
                &ranges,
            )
            .await?;
            ensure!(data.len() == ids.len(), "incomplete block range response");
            for (range, payload) in ranges.iter().zip(&data) {
                ensure!(
                    payload.len() as u64 == range.end - range.start,
                    "truncated block range response"
                );
            }
            stats.read_batches += 1;
            stats.read_ranges += ranges.len() as u64;
            stats.read_bytes += data.iter().map(|bytes| bytes.len() as u64).sum::<u64>();
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
    heads: BinaryHeap<Reverse<(u64, usize)>>,
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
        let heads = partition
            .files
            .iter()
            .enumerate()
            .filter_map(|(id, file)| file.hash().map(|hash| Reverse((hash, id))))
            .collect();
        let interners = partition
            .columns
            .series
            .iter()
            .map(|name| LabelInterner::new(name.clone()))
            .collect();
        Self {
            files: partition.files,
            heads,
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
            let Some(Reverse((hash, first_file))) = self.heads.pop() else {
                self.head = None;
                if !self.ended {
                    self.stats
                        .completed_partitions
                        .fetch_add(1, Ordering::Relaxed);
                    self.ended = true;
                }
                return Ok(None);
            };
            let first = &self.files[first_file];
            let head = (Arc::clone(&first.file.index), first.head().unwrap());
            self.samples.clear();
            if self.decoder.is_none() {
                self.decoder = Some(BlockDecoder::new().map_err(external)?);
            }
            let decoder = self.decoder.as_mut().expect("decoder initialized");
            let mut file_id = first_file;
            loop {
                let cursor = &mut self.files[file_id];
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
                if let Some(next_hash) = cursor.hash() {
                    self.heads.push(Reverse((next_hash, file_id)));
                }
                let Some(Reverse((next_hash, _))) = self.heads.peek() else {
                    break;
                };
                if *next_hash != hash {
                    break;
                }
                file_id = self.heads.pop().unwrap().0.1;
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

struct BlockSelectedFile {
    file: Arc<LoadedFile>,
    selection: BlockSelection,
}

enum BlockSelection {
    All(Range<usize>),
    Filtered(Vec<usize>),
}

impl BlockSelection {
    fn ids(&self) -> impl Iterator<Item = usize> + '_ {
        match self {
            Self::All(range) => Either::Left(range.clone()),
            Self::Filtered(ids) => Either::Right(ids.iter().copied()),
        }
    }
}

struct SelectedFile {
    file: Arc<LoadedFile>,
    ids: Vec<usize>,
}

struct SeriesValidation {
    first_file: usize,
    first_block: usize,
}

struct ValidatedPartition {
    files: Vec<FileCursor>,
    series: usize,
    selected_blocks: usize,
    selected_bytes: u64,
}

pub async fn load_metrics_block_index(file: &FileKey, labels: &[String]) -> Result<Arc<Index>> {
    Ok(Arc::clone(&load_index(file, labels).await?.index))
}

pub(super) async fn prepare(
    scan: &MetricsBlockScan,
    matchers: &Matchers,
    columns: Arc<LabelColumns>,
    partitions: &[(u64, u64)],
    offset: i64,
    lookback: i64,
    eval: &EvalContext,
) -> Result<Vec<PreparedPartition>> {
    let window =
        query_window(eval, offset, lookback).context("invalid or overflowing block time window")?;
    ensure!(
        !scan.files.is_empty() && !partitions.is_empty(),
        "empty block source"
    );
    let mut labels = columns
        .group
        .iter()
        .chain(&columns.series)
        .chain(
            matchers
                .matchers
                .iter()
                .filter(|matcher| {
                    !["__name__", "_timestamp", "value"].contains(&matcher.name.as_str())
                })
                .map(|matcher| &matcher.name),
        )
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
    }
    let metadata_started = Instant::now();
    let concurrency = partitions
        .len()
        .min(config::get_config().limit.cpu_num.max(1))
        .clamp(1, 32);
    let load_labels = Arc::new(labels);
    let loaded = load_metadata(&scan.files, Arc::clone(&load_labels), partitions.len()).await?;
    let metadata_ms = metadata_started.elapsed().as_secs_f64() * 1000.0;
    let selection_started = Instant::now();
    let matchers = Arc::new(matchers.clone());
    let jobs = loaded
        .into_iter()
        .map(|file| {
            let matchers = Arc::clone(&matchers);
            async move {
                let selection = if matchers.matchers.is_empty() && matchers.or_matchers.is_empty() {
                    BlockSelection::All(0..file.index.blocks.len())
                } else {
                    let index = Arc::clone(&file.index);
                    let filter = Arc::clone(&matchers);
                    let ids = tokio::task::spawn_blocking(move || {
                        metrics_index::matching_blocks(&index, &filter)
                    })
                    .await??;
                    BlockSelection::Filtered(ids)
                };
                let valid = match &selection {
                    BlockSelection::All(range) => {
                        range.start == 0 && range.end <= file.index.blocks.len()
                    }
                    BlockSelection::Filtered(ids) => {
                        ids.iter().all(|&id| id < file.index.blocks.len())
                            && ids.windows(2).all(|pair| pair[0] < pair[1])
                    }
                };
                ensure!(valid, "block selection IDs are not unique and ordered");
                Ok(BlockSelectedFile { file, selection })
            }
        })
        .collect::<Vec<_>>();
    let selected = collect_preflight_tasks(jobs, concurrency).await?;
    let label_matched_files = selected
        .iter()
        .filter(|file| file.selection.ids().next().is_some())
        .count();
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
        "[trace_id: {}] [PromQL] metrics blocks preflight: {} candidate files, {} label-matched files, {} series, {} hash partitions, metadata cache {} bytes",
        eval.trace_id,
        scan.files.len(),
        label_matched_files,
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

async fn load_metadata(
    files: &[FileKey],
    labels: Arc<Vec<String>>,
    target_partitions: usize,
) -> Result<Vec<Arc<LoadedFile>>> {
    let workers = target_partitions.min(files.len());
    ensure!(workers > 0, "empty metadata load");
    let mut groups = (0..workers).map(|_| Vec::new()).collect::<Vec<_>>();
    for (index, file) in files.iter().cloned().enumerate() {
        groups[index % workers].push((index, file));
    }
    let jobs = groups.into_iter().map(|group| {
        let labels = Arc::clone(&labels);
        async move {
            let mut loaded = Vec::with_capacity(group.len());
            for (index, file) in group {
                loaded.push((index, load_index(&file, &labels).await?));
            }
            Ok(loaded)
        }
    });
    let mut loaded = vec![None; files.len()];
    for group in collect_preflight_tasks(jobs, workers).await? {
        for (index, file) in group {
            loaded[index] = Some(file);
        }
    }
    Ok(loaded
        .into_iter()
        .map(|file| file.expect("all metadata jobs completed"))
        .collect())
}

async fn load_index(file: &FileKey, labels: &[String]) -> Result<Arc<LoadedFile>> {
    let limit = cache_limit();
    load_index_cached(file, labels, &INDEX_CACHE, &loads::FILE_LOADS, limit).await
}

async fn load_index_cached(
    file: &FileKey,
    labels: &[String],
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
    let lookup = {
        let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.trim(limit);
        cache.lookup(&key)
    };
    let (cached, complete) = lookup.classify(labels)?;
    MetadataLoad {
        file,
        labels,
        key,
        sidecar,
        limit,
        cache,
        flights,
    }
    .run(cached, complete)
    .await
}

async fn load_entry(
    file: &FileKey,
    labels: &[String],
    parent: &ParentIdentity,
    sidecar: &str,
    cached: Option<Arc<CachedIndex>>,
) -> Result<Arc<CachedIndex>> {
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

pub(crate) fn query_window(eval: &EvalContext, offset: i64, lookback: i64) -> Option<(i64, i64)> {
    let start = eval.start.checked_sub(offset)?;
    let end = eval.end.checked_sub(offset)?;
    if lookback < 0 || end < start {
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
    selected: BlockSelectedFile,
    partitions: Arc<Vec<(u64, u64)>>,
) -> Result<Vec<SelectedFile>> {
    let mut shards = (0..partitions.len())
        .map(|_| Vec::new())
        .collect::<Vec<_>>();
    for (position, id) in selected.selection.ids().enumerate() {
        let block = &selected.file.index.blocks.block(id);
        let shard = partitions.partition_point(|range| range.1 < block.hash);
        ensure!(
            shard < partitions.len() && block.hash >= partitions[shard].0,
            "hash outside shard intervals"
        );
        shards[shard].push(id);
        if (position + 1).is_multiple_of(PREFLIGHT_YIELD_INTERVAL) {
            tokio::task::yield_now().await;
        }
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
        for chunk in file.ids.chunks(PREFLIGHT_YIELD_INTERVAL) {
            for &id in chunk {
                let block = &file.file.index.blocks.block(id);
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
                        });
                    }
                    hashbrown::hash_map::Entry::Occupied(entry) => {
                        let previous = entry.get();
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
                    }
                }
            }
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
        for chunk in file.ids.chunks(PREFLIGHT_YIELD_INTERVAL) {
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
    use std::sync::atomic::{AtomicBool, AtomicUsize};

    use async_trait::async_trait;
    use config::{
        meta::{
            promql::value::Label,
            stream::{FileMeta, FileSelection},
        },
        metrics::promql::IndexBlocksCacheMetrics,
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
    use metrics_index::{
        block::{BlockWriter, ParentMetadata},
        block_cache::{CacheWeight, SidecarBinding},
    };
    use object_store::{
        CopyOptions, GetOptions, GetRange, GetResult, ListResult, MultipartUpload, ObjectMeta,
        ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, path::Path,
    };
    use promql_parser::label::{MatchOp, Matcher, Matchers};
    use tokio::sync::Notify;

    use super::*;
    use crate::{
        ScanSource,
        series_stream::{
            SeriesSource,
            plan::{StreamingSelector, execute_partitioned},
        },
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
        sample_ends: HashMap<String, u64>,
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
            let is_sample = self
                .sample_ends
                .get(&location.to_string())
                .is_some_and(|end| {
                    matches!(options.range.as_ref(), Some(GetRange::Bounded(range)) if range.end <= *end)
                });
            if is_sample {
                self.calls.fetch_add(1, Ordering::SeqCst);
                self.active.fetch_add(1, Ordering::SeqCst);
                let _active = ActiveRead(Arc::clone(&self.active));
                self.entered.notify_one();
                if let Some(gate) = &self.gate {
                    gate.notified().await;
                }
                return self.inner.get_opts(location, options).await;
            }
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
        metadata_calls: Arc<AtomicUsize>,
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
            let sample_ends = files
                .iter()
                .filter_map(|(file, bytes)| {
                    let sidecar = config::meta::promql::index::metrics_index_path(&file.key)?;
                    let size = bytes.len() as u64;
                    let tail = bytes.get(
                        bytes
                            .len()
                            .checked_sub(metrics_index::block::MIDX_TRAILER_LEN)?..,
                    )?;
                    let trailer = metrics_index::block::MidxTrailer::read(tail, size).ok()?;
                    Some((sidecar, trailer.blocks_end(size)))
                })
                .collect();
            let store = TrackingStore {
                inner: Arc::new(object_store::memory::InMemory::new()),
                sample_ends,
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
                metadata_calls: Arc::clone(&store.metadata_calls),
                calls: Arc::clone(&store.calls),
                active: Arc::clone(&store.active),
                entered: Arc::clone(&store.entered),
            };
            infra::storage::add_account(&id, Box::new(store)).await;
            fixture
        }
        fn scan(&self, files: impl IntoIterator<Item = FileKey>) -> MetricsBlockScan {
            MetricsBlockScan {
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
    async fn cancelling_shared_metadata_load_cleans_inflight() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::with_gates(std::slice::from_ref(&data), false, true).await;
        let key = fixture.scan([data.0]).files.remove(0);
        let first_file = key.clone();
        let first = tokio::spawn(async move { load_index(&first_file, &[]).await });
        fixture.entered.notified().await;
        let second_file = key.clone();
        let second = tokio::spawn(async move { load_index(&second_file, &[]).await });
        tokio::task::yield_now().await;
        assert_eq!(fixture.active.load(Ordering::SeqCst), 1);
        second.abort();
        assert!(matches!(second.await, Err(error) if error.is_cancelled()));
        assert_eq!(fixture.active.load(Ordering::SeqCst), 1);
        first.abort();
        assert!(matches!(first.await, Err(error) if error.is_cancelled()));
        assert_eq!(fixture.active.load(Ordering::SeqCst), 0);
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
    }

    #[tokio::test(flavor = "current_thread")]
    async fn metadata_load_respects_target_partitions() {
        let files = (0..3)
            .map(|hash| file(&[(hash, 10, 1.0, Some("x"))]))
            .collect::<Vec<_>>();
        let fixture = Fixture::with_gates(&files, false, true).await;
        let scan = fixture.scan(files.into_iter().map(|(file, _)| file));
        let loading =
            tokio::spawn(async move { load_metadata(&scan.files, Arc::new(vec![]), 2).await });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while fixture.active.load(Ordering::SeqCst) < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(fixture.active.load(Ordering::SeqCst), 2);
        assert_eq!(fixture.metadata_calls.load(Ordering::SeqCst), 2);
        loading.abort();
        assert!(matches!(loading.await, Err(error) if error.is_cancelled()));
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
        let prepared = prepare(
            &scan,
            &Matchers::empty(),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
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
    async fn parallel_preflight_checks_labels_outside_query_time_before_pruning() {
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
        for files in [vec![first.0.clone(), overlap.0], vec![duplicate.0]] {
            assert!(
                prepare(
                    &fixture.scan(files),
                    &Matchers::empty(),
                    columns(),
                    &intervals(),
                    100,
                    20,
                    &eval(),
                )
                .await
                .is_ok()
            );
        }
        let error = prepare(
            &fixture.scan([first.0, changed_label.0]),
            &Matchers::empty(),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await;
        assert!(
            error
                .err()
                .unwrap()
                .to_string()
                .contains("different projected labels")
        );
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn time_window_preserves_offset_and_accepts_sparse_evaluation() {
        let eval = EvalContext::new(1_000_000, 3_000_000, 500_000, "test".into());
        assert_eq!(
            query_window(&eval, 200_000, 1_000_000),
            Some((-200_000, 2_800_000))
        );
        let sparse = EvalContext::new(10_000_000, 20_000_000, 10_000_000, "test".into());
        assert_eq!(
            query_window(&sparse, 0, 1_000_000),
            Some((9_000_000, 20_000_000))
        );
        assert_eq!(query_window(&eval, i64::MIN, 1), None);
    }

    #[tokio::test]
    async fn sparse_evaluation_uses_block_source() {
        let data = file(&[(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(2));
        let source = ScanSource::Blocks(Arc::new(fixture.scan([data.0])));
        let matchers = Matchers::empty();
        let selector = StreamingSelector {
            table_name: "m",
            matchers: &matchers,
            offset: 100,
        };
        let eval = EvalContext::new(130, 230, 100, "sparse-block".into());
        let sources = execute_partitioned(
            &ctx,
            &source,
            &selector,
            LabelColumns::grouped(vec!["group".into()]),
            20,
            &eval,
        )
        .await
        .unwrap();
        for source in sources {
            assert!(matches!(source.await.unwrap(), SeriesSource::Block(_)));
        }
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
        let prepared = prepare(
            &scan,
            &Matchers::empty(),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
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
    async fn merge_orders_shared_hashes_and_exhausted_files() {
        let first = file(&[(1, 10, 1.0, Some("a")), (4, 10, 4.0, Some("d"))]);
        let second = file(&[(1, 20, 2.0, Some("a")), (2, 10, 3.0, Some("b"))]);
        let third = file(&[(3, 10, 5.0, Some("c"))]);
        let fixture = Fixture::new(&[first.clone(), second.clone(), third.clone()], false).await;
        let scan = fixture.scan([first.0, second.0, third.0]);
        let prepared = prepare(
            &scan,
            &Matchers::empty(),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        let mut actual = Vec::new();
        while stream.advance().await.unwrap().is_some() {
            let labels = stream.labels();
            let mut samples = Vec::new();
            stream.consume(&mut samples).await.unwrap();
            actual.push((
                labels,
                samples.into_iter().map(|s| s.value.to_bits()).collect(),
            ));
        }
        assert_eq!(
            actual,
            [
                (
                    vec![Arc::new(Label::new("group", "a"))],
                    vec![1.0f64.to_bits(), 2.0f64.to_bits()]
                ),
                (
                    vec![Arc::new(Label::new("group", "b"))],
                    vec![3.0f64.to_bits()]
                ),
                (
                    vec![Arc::new(Label::new("group", "c"))],
                    vec![5.0f64.to_bits()]
                ),
                (
                    vec![Arc::new(Label::new("group", "d"))],
                    vec![4.0f64.to_bits()]
                ),
            ]
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
        let scan = MetricsBlockScan { files: vec![file] };
        let prepared = prepare(
            &scan,
            &Matchers::empty(),
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
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
    async fn cache_miss_delegates_ranges_to_storage() {
        let fixture = Fixture::new(&[], false).await;
        let sidecar = format!(
            "files/o/mindex/m/2026/09/23/00/ranges-{}.midx",
            config::ider::uuid()
        );
        let ranges = (0..64u64)
            .map(|index| {
                let start = index * 64 * 1024;
                start..start + 512
            })
            .collect::<Vec<_>>();
        infra::storage::put(
            &fixture.account,
            &sidecar,
            Bytes::from(vec![0; ranges.last().unwrap().end as usize]),
        )
        .await
        .unwrap();

        let data =
            infra::cache::storage::get_ranges(&fixture.account, &sidecar.as_str().into(), &ranges)
                .await
                .unwrap();
        assert_eq!(data.len(), ranges.len());
        assert!(data.iter().all(|bytes| bytes.len() == 512));
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
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
        bytes[index.blocks.block(1).block_offset as usize] ^= 1;
        key.selection = None;
        let fixture = Fixture::new(&[(key.clone(), bytes)], false).await;
        let matchers = parsed_matchers(r#"m{group=~"first|last"}"#);
        let prepared = prepare(
            &fixture.scan([key]),
            &matchers,
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
        assert_eq!(stats.read_ranges.load(Ordering::Relaxed), 2);
        assert_eq!(stats.completed_partitions.load(Ordering::Relaxed), 1);
        assert_eq!(
            stats.read_bytes.load(Ordering::Relaxed),
            stats.selected_bytes
        );
    }

    #[test]
    fn midx_regex_selection_preserves_parser_anchoring_and_normalization() {
        let (_, bytes) = file(&[
            (1, 10, 1.0, Some("first")),
            (2, 10, 2.0, Some("last")),
            (3, 10, 3.0, Some("first-extra")),
            (4, 10, 4.0, Some("prefix-last")),
            (5, 10, 5.0, Some("middle")),
            (6, 10, 6.0, Some("bc{abc}")),
            (7, 10, 7.0, Some("xbc{abc}")),
            (8, 10, 8.0, Some("bc{abc}x")),
        ]);
        let index = metrics_index::block::decode_file(
            &bytes,
            &ParentMetadata {
                rows: 8,
                compressed_size: 123,
            },
            &["group".into()],
        )
        .unwrap();
        for (pattern, operator, expected) in [
            ("first|last", "=~", vec![0, 1]),
            ("first|last", "!~", vec![2, 3, 4, 5, 6, 7]),
            ("bc{abc}", "=~", vec![5]),
            ("bc{abc}", "!~", vec![0, 1, 2, 3, 4, 6, 7]),
        ] {
            let query = format!(r#"m{{group{operator}"{pattern}"}}"#);
            let matchers = parsed_matchers(&query);
            assert_eq!(
                metrics_index::matching_blocks(&index, &matchers).unwrap(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn filtered_block_selection_reuses_one_decode_without_global_cache() {
        let data = file(&[
            (1, 10, 1.0, Some("x")),
            (1, 20, 2.0, Some("x")),
            (2, 10, 3.0, Some("y")),
        ]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let file = fixture.scan([data.0]).files.remove(0);
        let (cache, registry) = observed_cache();
        let cache = Mutex::new(cache);
        let flights = Arc::new(loads::LoadRegistry::default());
        let loaded = load_index_cached(&file, &["group".into()], &cache, &flights, 0)
            .await
            .unwrap();
        assert!(cache.lock().unwrap().is_empty());
        assert!(
            cache_snapshot(&registry)
                .values()
                .all(|value| *value == 0.0)
        );
        let reads = fixture.metadata_calls.load(Ordering::SeqCst);
        assert!(reads > 0);
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "group", "x")]);
        assert_eq!(
            metrics_index::matching_blocks(&loaded.index, &matchers).unwrap(),
            vec![0]
        );
        assert_eq!(fixture.metadata_calls.load(Ordering::SeqCst), reads);
    }

    #[tokio::test]
    async fn missing_file_label_selects_no_blocks_without_payload_reads() {
        let data = file(&[(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        for matcher in [
            Matcher::new(MatchOp::Equal, "path", "/api/bar"),
            Matcher::new(MatchOp::Equal, "path", ""),
            Matcher::new(MatchOp::NotEqual, "path", "/api/bar"),
            parsed_matchers(r#"m{path=~".*"}"#).matchers.remove(0),
            parsed_matchers(r#"m{path!~"api.*"}"#).matchers.remove(0),
        ] {
            let prepared = prepare(
                &fixture.scan([data.0.clone()]),
                &Matchers::new(vec![matcher]),
                columns(),
                &intervals(),
                100,
                20,
                &eval(),
            )
            .await
            .unwrap();
            assert_eq!(prepared[0].stats.selected_blocks, 0);
            for partition in prepared {
                let mut stream = BlockSeriesStream::new(partition);
                assert!(stream.advance().await.unwrap().is_none());
            }
        }
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn new_label_selects_only_new_schema_file() {
        let old = file(&[(1, 10, 1.0, Some("old"))]);
        let source = batch(&[(2, 10, 3.0, Some("new")), (2, 20, 4.0, Some("new"))]);
        let mut fields = source.schema().fields().to_vec();
        fields.push(Arc::new(Field::new("env", DataType::Utf8, true)));
        let mut arrays = source.columns().to_vec();
        arrays.push(Arc::new(StringArray::from(vec!["prod", "prod"])));
        let new = file_batch(
            RecordBatch::try_new(Arc::new(Schema::new(fields)), arrays).unwrap(),
            vec!["group".into(), "env".into()],
        );
        let fixture = Fixture::new(&[old.clone(), new.clone()], false).await;
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "env", "prod")]);
        let prepared = prepare(
            &fixture.scan([old.0, new.0]),
            &matchers,
            columns(),
            &intervals(),
            100,
            20,
            &eval(),
        )
        .await
        .unwrap();
        assert_eq!(prepared[0].stats.selected_blocks, 1);
        let mut stream = BlockSeriesStream::new(prepared.into_iter().next().unwrap());
        assert!(stream.advance().await.unwrap().is_some());
        assert_eq!(stream.labels(), vec![Arc::new(Label::new("group", "new"))]);
        let mut samples = Vec::new();
        stream.consume(&mut samples).await.unwrap();
        assert_eq!(
            samples
                .iter()
                .map(|sample| sample.value)
                .collect::<Vec<_>>(),
            [3.0, 4.0]
        );
        assert!(stream.advance().await.unwrap().is_none());
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn projected_label_missing_from_midx_still_fails() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let file = fixture.scan([data.0]).files.remove(0);
        let index = load_metrics_block_index(&file, &[]).await.unwrap();
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "group", "x")]);
        let error = metrics_index::matching_blocks(&index, &matchers)
            .err()
            .unwrap();
        assert!(
            error
                .to_string()
                .contains("MIDX lacks identity label group")
        );
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
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
            let source = if blocks {
                ScanSource::Blocks(Arc::clone(&scan))
            } else {
                ScanSource::HashSorted
            };
            let ctx = SessionContext::new_with_config(config);
            let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                .unwrap()
                .with_sort_order(vec![vec![
                    col("__hash__").sort(true, false),
                    col("_timestamp").sort(true, false),
                ]]);
            ctx.register_table("m", Arc::new(table)).unwrap();
            let matchers = Matchers::empty();
            let selector = StreamingSelector {
                table_name: "m",
                matchers: &matchers,
                offset: 0,
            };
            let sources = execute_partitioned(
                &ctx,
                &source,
                &selector,
                LabelColumns::grouped(vec![]),
                20,
                &eval,
            )
            .await
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
            let source = if blocks {
                ScanSource::Blocks(Arc::clone(&scan))
            } else {
                ScanSource::HashSorted
            };
            let ctx = SessionContext::new_with_config(config);
            let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                .unwrap()
                .with_sort_order(vec![vec![
                    col("__hash__").sort(true, false),
                    col("_timestamp").sort(true, false),
                ]]);
            ctx.register_table("m", Arc::new(table)).unwrap();
            contexts.push((ctx, source));
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
            for (ctx, source) in &contexts {
                let matchers = Matchers::empty();
                let selector = StreamingSelector {
                    table_name: "m",
                    matchers: &matchers,
                    offset: 0,
                };
                let sources = execute_partitioned(
                    ctx,
                    source,
                    &selector,
                    LabelColumns::grouped(vec!["group".into()]),
                    20,
                    &eval,
                )
                .await
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
    async fn preflight_preserves_duplicate_timestamps_and_overlapping_files() {
        let a = file(&[
            (1, 10, 1.0, Some("x")),
            (1, 20, 2.0, Some("x")),
            (1, 30, 3.0, Some("x")),
        ]);
        let b = file(&[(1, 30, 9.0, Some("x")), (1, 40, 10.0, Some("x"))]);
        let duplicate = file(&[(2, 10, 1.0, Some("x")), (2, 10, 2.0, Some("x"))]);
        let boundary = file(&[
            (3, 10, 1.0, Some("x")),
            (3, 20, 2.0, Some("x")),
            (3, 20, 3.0, Some("x")),
            (3, 30, 4.0, Some("x")),
        ]);
        let fixture = Fixture::new(
            &[a.clone(), b.clone(), duplicate.clone(), boundary.clone()],
            false,
        )
        .await;
        for (scan, expected) in [
            (
                fixture.scan([a.0, b.0]),
                vec![(110, 1.0), (120, 2.0), (130, 3.0), (130, 9.0), (140, 10.0)],
            ),
            (fixture.scan([duplicate.0]), vec![(110, 1.0), (110, 2.0)]),
            (
                fixture.scan([boundary.0]),
                vec![(110, 1.0), (120, 2.0), (120, 3.0), (130, 4.0)],
            ),
        ] {
            let reads = fixture.calls.load(Ordering::SeqCst);
            let prepared = prepare(
                &scan,
                &Matchers::empty(),
                columns(),
                &intervals(),
                100,
                20,
                &eval(),
            )
            .await
            .unwrap();
            assert_eq!(fixture.calls.load(Ordering::SeqCst), reads);
            let mut actual = Vec::new();
            for partition in prepared {
                let mut stream = BlockSeriesStream::new(partition);
                while stream.advance().await.unwrap().is_some() {
                    let mut samples = Vec::new();
                    stream.consume(&mut samples).await.unwrap();
                    actual.extend(
                        samples
                            .into_iter()
                            .map(|sample| (sample.timestamp, sample.value)),
                    );
                }
            }
            actual.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
            assert_eq!(actual, expected);
            assert!(fixture.calls.load(Ordering::SeqCst) > reads);
        }
    }

    #[tokio::test]
    async fn duplicate_timestamps_do_not_fail_range_functions() {
        use std::time::Duration;

        use crate::{functions, streaming_eval};

        let data = file(&[
            (1, 10, 1.0, Some("x")),
            (1, 20, 2.0, Some("x")),
            (1, 30, 3.0, Some("x")),
            (1, 30, 4.0, Some("x")),
        ]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let source = ScanSource::Blocks(Arc::new(fixture.scan([data.0])));
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(28));
        let eval = EvalContext::new(120, 130, 5, "duplicate-range-functions".into());
        for name in ["count_over_time", "irate", "rate", "resets"] {
            let matchers = Matchers::empty();
            let selector = StreamingSelector {
                table_name: "m",
                matchers: &matchers,
                offset: 100,
            };
            let sources = execute_partitioned(
                &ctx,
                &source,
                &selector,
                LabelColumns::grouped(vec!["group".into()]),
                20,
                &eval,
            )
            .await
            .unwrap();
            let func: Arc<dyn functions::RangeFunc> =
                Arc::from(functions::fusable_range_func(name).unwrap());
            let range = Arc::new(streaming_eval::RangeExpr::new(
                func,
                Duration::from_micros(20),
                &eval,
            ));
            assert!(
                streaming_eval::eval_range(sources, range).await.is_ok(),
                "{name}"
            );
        }
        assert!(fixture.calls.load(Ordering::SeqCst) > 0);
    }

    #[tokio::test]
    async fn missing_metadata_fails_before_source_scan() {
        let rows = [(1, 10, 1.0, Some("x")), (1, 20, 2.0, Some("x"))];
        let valid = file(&rows);
        let missing = file(&[(2, 30, 3.0, Some("y"))]);
        let fixture = Fixture::new(std::slice::from_ref(&valid), false).await;
        let source = ScanSource::Blocks(Arc::new(fixture.scan([valid.0, missing.0])));
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(2));
        let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
            .unwrap()
            .with_sort_order(vec![vec![
                col("__hash__").sort(true, false),
                col("_timestamp").sort(true, false),
            ]]);
        ctx.register_table("m", Arc::new(table)).unwrap();
        let matchers = Matchers::empty();
        let selector = StreamingSelector {
            table_name: "m",
            matchers: &matchers,
            offset: 100,
        };
        let error = execute_partitioned(
            &ctx,
            &source,
            &selector,
            LabelColumns::grouped(vec!["group".into()]),
            20,
            &eval(),
        )
        .await
        .err()
        .unwrap();
        assert!(!error.to_string().is_empty());
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
                let source = if enabled {
                    ScanSource::Blocks(Arc::new(fixture.scan(files.iter().map(|v| v.0.clone()))))
                } else {
                    ScanSource::HashSorted
                };
                let ctx =
                    SessionContext::new_with_config(SessionConfig::new().with_target_partitions(2));
                let table = MemTable::try_new(schema(), vec![vec![batch(&rows)]])
                    .unwrap()
                    .with_sort_order(vec![vec![
                        col("__hash__").sort(true, false),
                        col("_timestamp").sort(true, false),
                    ]]);
                ctx.register_table("m", Arc::new(table)).unwrap();
                let matchers = Matchers::empty();
                let selector = StreamingSelector {
                    table_name: "m",
                    matchers: &matchers,
                    offset: 0,
                };
                let result = execute_partitioned(
                    &ctx,
                    &source,
                    &selector,
                    LabelColumns::grouped(vec!["group".into()]),
                    20,
                    &EvalContext::new(10, 40, 10, "compatibility".into()),
                )
                .await;
                if enabled && legacy_count > 0 {
                    assert!(result.is_err());
                    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
                    continue;
                }
                let sources = result.unwrap();
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
            &Matchers::empty(),
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
                &Matchers::empty(),
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
            prepare(
                &scan,
                &Matchers::empty(),
                columns(),
                &intervals(),
                100,
                20,
                &eval(),
            ),
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
            &Matchers::empty(),
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
            &Matchers::empty(),
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
            &Matchers::empty(),
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
                .strip_prefix("zo_metrics_blocks_cache_")
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
        assert_eq!(values.len(), 5);
        values
    }

    #[test]
    fn metadata_cache_lookup_classifies_full_partial_and_missing_keys() {
        let (mut cache, registry) = observed_cache();
        let (key, entry, weight) = cache_entry();
        cache.trim(weight.total);
        let (cached, complete) = cache.lookup(&key).classify(&["group".into()]).unwrap();
        assert!(cached.is_none());
        assert!(!complete);
        let partial = Arc::new(CachedIndex {
            index: Arc::new(entry.index.project(&[]).unwrap().for_cache()),
            binding: entry.binding.clone(),
        });
        cache.insert(key.clone(), partial, weight.total).unwrap();
        let (cached, complete) = cache.lookup(&key).classify(&["group".into()]).unwrap();
        assert!(cached.is_some());
        assert!(!complete);
        cache.insert(key.clone(), entry, weight.total).unwrap();
        let (cached, complete) = cache
            .lookup(&key)
            .classify(&["group".into(), "absent_from_source".into()])
            .unwrap();
        assert!(cached.is_some());
        assert!(complete);
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 2.0);
        assert_eq!(values["partial_hits_total"], 1.0);
        assert_eq!(values["misses_total"], 1.0);
        assert!(cache.lookup(&key).classify(&["value".into()]).is_err());
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 3.0);
        assert_eq!(values["partial_hits_total"], 1.0);
        assert_eq!(values["misses_total"], 1.0);
    }

    #[test]
    fn metadata_cache_lookup_classifies_after_releasing_cache_lock() {
        let (cache, registry) = observed_cache();
        let cache = Mutex::new(cache);
        let (key, entry, weight) = cache_entry();
        let partial = Arc::new(CachedIndex {
            index: Arc::new(entry.index.project(&[]).unwrap().for_cache()),
            binding: entry.binding.clone(),
        });
        let lookup = {
            let mut cache = cache.lock().unwrap();
            cache.insert(key.clone(), partial, weight.total).unwrap();
            cache.lookup(&key)
        };
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 1.0);
        assert_eq!(values["partial_hits_total"], 0.0);
        cache.try_lock().unwrap().trim(0);
        let (cached, complete) = lookup.classify(&["group".into()]).unwrap();
        assert!(cached.is_some());
        assert!(!complete);
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 1.0);
        assert_eq!(values["partial_hits_total"], 1.0);
        assert_eq!(values["misses_total"], 0.0);
        assert_eq!(values["used_bytes"], 0.0);
    }

    #[test]
    fn metadata_cache_get_preserves_key_lookup_compatibility() {
        let (mut cache, registry) = observed_cache();
        let (key, entry, weight) = cache_entry();
        assert!(cache.get(&key).is_none());
        assert_eq!(cache_snapshot(&registry)["misses_total"], 0.0);
        cache.trim(weight.total);
        assert!(cache.get(&key).is_none());
        cache.insert(key.clone(), entry, weight.total).unwrap();
        assert!(cache.get(&key).is_some());
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 1.0);
        assert_eq!(values["partial_hits_total"], 0.0);
        assert_eq!(values["misses_total"], 1.0);
    }

    #[test]
    fn metadata_cache_peek_and_merge_do_not_count_lookups() {
        let (mut cache, registry) = observed_cache();
        let (key, entry, weight) = cache_entry();
        assert!(cache.peek(&key).is_none());
        cache
            .insert(key.clone(), Arc::clone(&entry), weight.total)
            .unwrap();
        assert!(cache.peek(&key).is_some());
        cache.insert(key.clone(), entry, weight.total).unwrap();
        assert!(cache.peek(&key).is_some());
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 0.0);
        assert_eq!(values["partial_hits_total"], 0.0);
        assert_eq!(values["misses_total"], 0.0);
    }

    #[tokio::test]
    async fn metadata_cache_lookup_counts_incremental_label_load_once() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let file = fixture.scan([data.0]).files.remove(0);
        let (cache, registry) = observed_cache();
        let cache = Mutex::new(cache);
        let flights = Arc::new(loads::LoadRegistry::default());
        load_index_cached(&file, &[], &cache, &flights, usize::MAX)
            .await
            .unwrap();
        let directory_reads = fixture.metadata_calls.load(Ordering::SeqCst);
        let labels = ["group".into()];
        let loaded = load_index_cached(&file, &labels, &cache, &flights, usize::MAX)
            .await
            .unwrap();
        assert!(loaded.index.labels.column_by_name("group").is_some());
        let label_reads = fixture.metadata_calls.load(Ordering::SeqCst);
        assert!(label_reads > directory_reads);
        load_index_cached(&file, &labels, &cache, &flights, usize::MAX)
            .await
            .unwrap();
        assert_eq!(fixture.metadata_calls.load(Ordering::SeqCst), label_reads);
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 2.0);
        assert_eq!(values["partial_hits_total"], 1.0);
        assert_eq!(values["misses_total"], 1.0);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn metadata_cache_singleflight_waiter_keeps_initial_miss() {
        let data = file(&[(1, 10, 1.0, Some("x"))]);
        let fixture = Fixture::new(std::slice::from_ref(&data), false).await;
        let file = fixture.scan([data.0]).files.remove(0);
        let key = CacheKey {
            account: file.account.clone(),
            parent: ParentIdentity {
                object_key: file.key.clone(),
                rows: file.meta.records as u64,
                compressed_size: file.meta.compressed_size as u64,
            },
        };
        let entry = Arc::new(CachedIndex {
            index: Arc::new(
                metrics_index::block::decode_file(
                    &data.1,
                    &key.parent.metadata(),
                    &["group".into()],
                )
                .unwrap(),
            ),
            binding: SidecarBinding::parse(
                data.1.len() as u64,
                &data.1[data.1.len() - metrics_index::block::MIDX_TRAILER_LEN..],
            )
            .unwrap(),
        });
        let (cache, registry) = observed_cache();
        let cache = Arc::new(Mutex::new(cache));
        let flights = Arc::new(loads::LoadRegistry::default());
        let loads::Claim::Owner(owner) = flights.claim(key) else {
            panic!("first claim must own the load");
        };
        let worker_cache = Arc::clone(&cache);
        let worker_flights = Arc::clone(&flights);
        let waiting = tokio::spawn(async move {
            load_index_cached(
                &file,
                &["group".into()],
                &worker_cache,
                &worker_flights,
                usize::MAX,
            )
            .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while cache_snapshot(&registry)["misses_total"] == 0.0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!waiting.is_finished());
        owner.complete(&Ok(entry));
        assert!(
            waiting
                .await
                .unwrap()
                .unwrap()
                .index
                .labels
                .column_by_name("group")
                .is_some()
        );
        assert_eq!(fixture.metadata_calls.load(Ordering::SeqCst), 0);
        let values = cache_snapshot(&registry);
        assert_eq!(values["hits_total"], 0.0);
        assert_eq!(values["partial_hits_total"], 0.0);
        assert_eq!(values["misses_total"], 1.0);
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
        assert_eq!(values["misses_total"], 1.0);
        assert_eq!(values["hits_total"], 0.0);
        assert_eq!(values["partial_hits_total"], 0.0);
        assert_eq!(values["used_bytes"], 0.0);
        assert_eq!(values["evictions_total"], 0.0);
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

    fn parsed_matchers(query: &str) -> Matchers {
        let promql_parser::parser::Expr::VectorSelector(selector) =
            promql_parser::parser::parse(query).unwrap()
        else {
            panic!("expected vector selector");
        };
        selector.matchers
    }
}
