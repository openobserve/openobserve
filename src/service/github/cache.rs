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

use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;

use super::types::{CachedData, GitHubError};

/// In-memory cache for GitHub data
#[derive(Debug, Clone)]
pub struct CacheManager {
    cache: Arc<RwLock<HashMap<String, CachedData>>>,
    max_size: usize,
}

impl CacheManager {
    pub fn new(max_size: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            max_size,
        }
    }

    /// Get data from cache if it exists and is not expired
    pub async fn get(&self, key: &str) -> Option<bytes::Bytes> {
        let cache = self.cache.read().await;

        if let Some(cached) = cache.get(key) {
            if !cached.is_expired() {
                log::debug!("Cache hit for key: {}", key);
                return Some(cached.data.clone());
            } else {
                log::debug!("Cache expired for key: {}", key);
            }
        } else {
            log::debug!("Cache miss for key: {}", key);
        }

        None
    }

    /// Store data in cache
    pub async fn set(&self, key: String, data: CachedData) -> Result<(), GitHubError> {
        let mut cache = self.cache.write().await;

        // Check current cache size
        let current_size: usize = cache.values().map(|v| v.data.len()).sum();

        // If adding this would exceed max size, clear expired entries
        if current_size + data.data.len() > self.max_size {
            cache.retain(|_, v| !v.is_expired());

            // If still too large, clear oldest entries
            let new_size: usize = cache.values().map(|v| v.data.len()).sum();
            if new_size + data.data.len() > self.max_size {
                log::warn!("Cache full, clearing oldest entries");
                cache.clear();
            }
        }

        cache.insert(key.clone(), data);
        log::debug!("Cached data for key: {}", key);

        Ok(())
    }

    /// Invalidate a specific cache entry
    pub async fn invalidate(&self, key: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(key);
        log::debug!("Invalidated cache for key: {}", key);
    }

    /// Clear all cache entries
    pub async fn clear(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        log::info!("Cleared all cache entries");
    }

    /// Get cache statistics
    pub async fn stats(&self) -> CacheStats {
        let cache = self.cache.read().await;
        let total_entries = cache.len();
        let total_size: usize = cache.values().map(|v| v.data.len()).sum();
        let expired_entries = cache.values().filter(|v| v.is_expired()).count();

        CacheStats {
            total_entries,
            expired_entries,
            total_size_bytes: total_size,
            max_size_bytes: self.max_size,
        }
    }
}

#[derive(Debug)]
pub struct CacheStats {
    pub total_entries: usize,
    pub expired_entries: usize,
    pub total_size_bytes: usize,
    pub max_size_bytes: usize,
}
