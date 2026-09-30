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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

use anyhow::{Context, Result, anyhow, ensure};
use config::{
    meta::stream::FileKey,
    metrics::promql::{INDEX_BLOCKS_CACHE_METRICS, IndexBlocksCacheMetrics},
};
use hashlink::LruCache;
use tokio::sync::Notify;

use crate::{
    block::{self, Index, ParentMetadata},
    layout::MetricsFileLayout,
    reader::fetch_parsed_index,
};

pub static INDEX_CACHE: LazyLock<Mutex<IndexCache>> =
    LazyLock::new(|| Mutex::new(IndexCache::new(INDEX_BLOCKS_CACHE_METRICS.clone())));
static FILE_LOADS: LazyLock<Arc<LoadRegistry>> =
    LazyLock::new(|| Arc::new(LoadRegistry::default()));

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ParentIdentity {
    pub object_key: String,
    pub rows: u64,
    pub compressed_size: u64,
}

impl ParentIdentity {
    pub fn metadata(&self) -> ParentMetadata {
        ParentMetadata {
            rows: self.rows,
            compressed_size: self.compressed_size,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub account: String,
    pub parent: ParentIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidecarBinding {
    pub size: u64,
    pub trailer: [u8; block::MIDX_TRAILER_LEN],
}

impl SidecarBinding {
    pub fn parse(size: u64, bytes: &[u8]) -> Result<Self> {
        block::MidxTrailer::read(bytes, size)?;
        Ok(Self {
            size,
            trailer: bytes.try_into()?,
        })
    }
}

pub struct CachedIndex {
    pub index: Arc<Index>,
    pub binding: SidecarBinding,
}

/// A data file's `.midx` sidecar and the parent facts its index is bound to.
#[derive(Clone, Debug)]
pub struct Sidecar {
    pub account: String,
    pub data_path: String,
    pub path: String,
    pub parent: ParentMetadata,
    pub size: i64,
}

impl Sidecar {
    pub fn of(file: &FileKey) -> Result<Self> {
        let parent = ParentMetadata {
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
        Ok(Self {
            path: MetricsFileLayout::metrics_index_path(&file.key)
                .context("unsupported block parent layout")?,
            account: file.account.clone(),
            data_path: file.key.clone(),
            parent,
            size: file.meta.mindex_size,
        })
    }

    fn key(&self) -> CacheKey {
        CacheKey {
            account: self.account.clone(),
            parent: ParentIdentity {
                object_key: self.data_path.clone(),
                rows: self.parent.rows,
                compressed_size: self.parent.compressed_size,
            },
        }
    }
}

pub struct IndexCache {
    entries: LruCache<CacheKey, (Arc<CachedIndex>, CacheWeight)>,
    pub bytes: usize,
    limit: usize,
    metrics: IndexBlocksCacheMetrics,
}

impl IndexCache {
    pub fn new(metrics: IndexBlocksCacheMetrics) -> Self {
        Self {
            entries: LruCache::new_unbounded(),
            bytes: 0,
            limit: 0,
            metrics,
        }
    }

    pub fn trim(&mut self, limit: usize) {
        self.limit = limit;
        self.evict_until_fit(limit);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&mut self, key: &CacheKey) -> Option<Arc<CachedIndex>> {
        if self.limit == 0 {
            return None;
        }
        let entry = self.entries.get(key).map(|entry| Arc::clone(&entry.0));
        if entry.is_some() {
            self.metrics.hits.inc();
        }
        entry
    }

    pub fn remove(&mut self, key: &CacheKey) {
        if let Some((_, weight)) = self.entries.remove(key) {
            self.bytes = self.bytes.saturating_sub(weight.total);
            self.metrics.used.set(self.bytes as f64);
        }
    }

    pub fn peek(&self, key: &CacheKey) -> Option<Arc<CachedIndex>> {
        self.entries.peek(key).map(|entry| Arc::clone(&entry.0))
    }

    pub fn remove_bound(&mut self, key: &CacheKey, binding: Option<&SidecarBinding>) {
        if self
            .entries
            .peek(key)
            .is_some_and(|entry| binding.is_some_and(|binding| entry.0.binding == *binding))
        {
            self.remove(key);
        }
    }

    pub fn insert(
        &mut self,
        key: CacheKey,
        index: Arc<CachedIndex>,
        limit: usize,
    ) -> Result<Arc<CachedIndex>> {
        self.limit = limit;
        if limit == 0 {
            return Ok(index);
        }
        let index = if let Some(existing) = self
            .peek(&key)
            .filter(|existing| existing.binding == index.binding)
        {
            Arc::new(CachedIndex {
                index: Arc::new(existing.index.merge_columns(&index.index)?),
                binding: index.binding.clone(),
            })
        } else {
            index
        };
        let weight = CacheWeight::new(&key, &index);
        if weight.total > limit {
            return Ok(index);
        }
        if let Some((_, old)) = self.entries.insert(key, (Arc::clone(&index), weight)) {
            self.bytes = self.bytes.saturating_sub(old.total);
        }
        self.bytes = self.bytes.saturating_add(weight.total);
        self.evict_until_fit(limit);
        Ok(index)
    }

    fn evict_until_fit(&mut self, limit: usize) {
        while self.bytes > limit {
            let Some((_, (_, weight))) = self.entries.remove_lru() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(weight.total);
            self.metrics.evictions.inc();
        }
        self.metrics.used.set(self.bytes as f64);
    }
}

impl Default for IndexCache {
    fn default() -> Self {
        Self::new(IndexBlocksCacheMetrics::default())
    }
}

#[derive(Clone, Copy)]
pub struct CacheWeight {
    pub total: usize,
}

impl CacheWeight {
    pub fn new(key: &CacheKey, index: &CachedIndex) -> Self {
        let total = index
            .index
            .estimated_heap_size()
            .saturating_add(std::mem::size_of::<CachedIndex>())
            .saturating_add(std::mem::size_of::<CacheKey>())
            .saturating_add(key.account.capacity())
            .saturating_add(key.parent.object_key.capacity())
            .saturating_add(8 * std::mem::size_of::<usize>());
        Self { total }
    }
}

#[derive(Default)]
struct LoadRegistry {
    entries: Mutex<HashMap<CacheKey, Arc<Flight>>>,
}

impl LoadRegistry {
    fn claim(self: &Arc<Self>, key: CacheKey) -> Claim {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(flight) = entries.get(&key) {
            return Claim::Waiter(Arc::clone(flight));
        }
        let flight = Arc::new(Flight {
            result: Mutex::new(FlightState::Pending),
            ready: Notify::new(),
        });
        entries.insert(key.clone(), Arc::clone(&flight));
        Claim::Owner(Owner {
            registry: Arc::clone(self),
            key,
            flight,
            completed: false,
        })
    }
}

enum Claim {
    Owner(Owner),
    Waiter(Arc<Flight>),
}

struct Flight {
    result: Mutex<FlightState>,
    ready: Notify,
}

impl Flight {
    async fn wait(&self) -> Result<Option<Arc<CachedIndex>>> {
        loop {
            let notified = self.ready.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            match &*self
                .result
                .lock()
                .unwrap_or_else(|error| error.into_inner())
            {
                FlightState::Ready(result) => {
                    return result
                        .as_ref()
                        .map(|value| Some(Arc::clone(value)))
                        .map_err(|error| anyhow!(error.clone()));
                }
                FlightState::Cancelled => return Ok(None),
                FlightState::Pending => {}
            }
            notified.await;
        }
    }
}

enum FlightState {
    Pending,
    Ready(Result<Arc<CachedIndex>, String>),
    Cancelled,
}

struct Owner {
    registry: Arc<LoadRegistry>,
    key: CacheKey,
    flight: Arc<Flight>,
    completed: bool,
}

impl Owner {
    fn complete(mut self, result: &Result<Arc<CachedIndex>>) {
        let value = result
            .as_ref()
            .map(Arc::clone)
            .map_err(|error| format!("{error:#}"));
        *self
            .flight
            .result
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = FlightState::Ready(value);
        self.completed = true;
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        if !self.completed {
            *self
                .flight
                .result
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = FlightState::Cancelled;
        }
        let mut entries = self
            .registry
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .get(&self.key)
            .is_some_and(|flight| Arc::ptr_eq(flight, &self.flight))
        {
            entries.remove(&self.key);
        }
        drop(entries);
        self.flight.ready.notify_waiters();
    }
}

pub fn cache_limit() -> usize {
    config::get_config()
        .search
        .metrics_blocks_cache_max_size
        .saturating_mul(1024 * 1024)
}

/// Loads `sidecar`'s index with `labels` decoded, through the shared cache.
pub async fn load_index(sidecar: &Sidecar, labels: &[String]) -> Result<Index> {
    load_index_in(&INDEX_CACHE, cache_limit(), sidecar, labels).await
}

/// Loads through `cache`; concurrent loads of one file share a single fetch and decode.
pub async fn load_index_in(
    cache: &Mutex<IndexCache>,
    limit: usize,
    sidecar: &Sidecar,
    labels: &[String],
) -> Result<Index> {
    let key = sidecar.key();
    let mut seed = {
        let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.trim(limit);
        cache.get(&key)
    };
    loop {
        if let Some(entry) = &seed
            && covers(entry, labels)?
        {
            return entry.index.project(labels);
        }
        match FILE_LOADS.claim(key.clone()) {
            Claim::Waiter(flight) => {
                if let Some(loaded) = flight.wait().await? {
                    seed = Some(loaded);
                }
            }
            Claim::Owner(owner) => {
                if limit > 0
                    && let Some(current) =
                        cache.lock().unwrap_or_else(|e| e.into_inner()).peek(&key)
                {
                    seed = Some(current);
                }
                let binding = seed.as_ref().map(|entry| entry.binding.clone());
                let prior = seed.clone();
                match fetch_parsed_index(sidecar, labels, seed).await {
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
                        return admitted?.index.project(labels);
                    }
                    Err(error) => {
                        cache
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove_bound(&key, binding.as_ref());
                        owner.complete(&Err(anyhow!("{error:#}")));
                        return Err(error);
                    }
                }
            }
        }
    }
}

/// Whether `entry` holds every requested label; labels absent from the source need no decoding.
pub(crate) fn covers(entry: &CachedIndex, labels: &[String]) -> Result<bool> {
    Ok(entry.index.missing_labels(labels)?.is_empty())
}
