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

use std::sync::{Arc, LazyLock, Mutex};

use anyhow::Result;
use config::metrics::promql::{INDEX_BLOCKS_CACHE_METRICS, IndexBlocksCacheMetrics};
use hashlink::LruCache;

use crate::block::{self, Index, ParentMetadata};

pub static INDEX_CACHE: LazyLock<Mutex<IndexCache>> =
    LazyLock::new(|| Mutex::new(IndexCache::new(INDEX_BLOCKS_CACHE_METRICS.clone())));

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

pub fn cache_limit() -> usize {
    config::get_config()
        .search
        .metrics_blocks_cache_max_size
        .saturating_mul(1024 * 1024)
}
