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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_new_cache_is_empty() {
        let cache = CacheManager::new(1024 * 1024);
        let stats = cache.stats().await;
        assert_eq!(stats.total_entries, 0);
        assert_eq!(stats.total_size_bytes, 0);
        assert_eq!(stats.max_size_bytes, 1024 * 1024);
    }

    #[tokio::test]
    async fn test_get_on_empty_cache_returns_none() {
        let cache = CacheManager::new(1024 * 1024);
        assert!(cache.get("missing_key").await.is_none());
    }

    #[tokio::test]
    async fn test_set_and_get_roundtrip() {
        let cache = CacheManager::new(1024 * 1024);
        let data = CachedData::new(bytes::Bytes::from("hello"), 3600);
        cache.set("key1".to_string(), data).await.unwrap();
        let result = cache.get("key1").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap(), bytes::Bytes::from("hello"));
    }

    #[tokio::test]
    async fn test_invalidate_removes_entry() {
        let cache = CacheManager::new(1024 * 1024);
        let data = CachedData::new(bytes::Bytes::from("value"), 3600);
        cache.set("key2".to_string(), data).await.unwrap();
        assert!(cache.get("key2").await.is_some());
        cache.invalidate("key2").await;
        assert!(cache.get("key2").await.is_none());
    }

    #[tokio::test]
    async fn test_clear_removes_all_entries() {
        let cache = CacheManager::new(1024 * 1024);
        for i in 0..3 {
            let data = CachedData::new(bytes::Bytes::from(format!("v{i}")), 3600);
            cache.set(format!("k{i}"), data).await.unwrap();
        }
        let stats = cache.stats().await;
        assert_eq!(stats.total_entries, 3);
        cache.clear().await;
        let stats = cache.stats().await;
        assert_eq!(stats.total_entries, 0);
    }

    #[tokio::test]
    async fn test_expired_entry_not_returned() {
        let cache = CacheManager::new(1024 * 1024);
        let data = CachedData {
            data: bytes::Bytes::from("old data"),
            fetched_at: 0,
            ttl_secs: 60,
        };
        cache.set("expired_key".to_string(), data).await.unwrap();
        assert!(cache.get("expired_key").await.is_none());
    }
}
