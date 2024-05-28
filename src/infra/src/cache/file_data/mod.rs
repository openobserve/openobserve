// Copyright 2024 Zinc Labs Inc.
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

pub mod disk;
pub mod memory;

use std::collections::VecDeque;

use config::CONFIG;
use hashbrown::HashSet;
use hashlink::lru_cache::LruCache;

const INITIAL_CACHE_SIZE: usize = 128;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum CacheType {
    Disk,
    Memory,
    None,
}

enum CacheStrategy {
    Lru(LruCache<String, usize>),
    Fifo((VecDeque<(String, usize)>, HashSet<String>)),
}

impl CacheStrategy {
    fn new(name: &str) -> Self {
        match name.to_lowercase().as_str() {
            "lru" => CacheStrategy::Lru(LruCache::new_unbounded()),
            "fifo" => CacheStrategy::Fifo((
                VecDeque::with_capacity(INITIAL_CACHE_SIZE),
                HashSet::with_capacity(INITIAL_CACHE_SIZE),
            )),
            _ => CacheStrategy::Lru(LruCache::new_unbounded()),
        }
    }

    fn insert(&mut self, key: String, value: usize) {
        match self {
            CacheStrategy::Lru(cache) => {
                cache.insert(key, value);
            }
            CacheStrategy::Fifo((queue, set)) => {
                set.insert(key.clone());
                queue.push_back((key, value));
            }
        }
    }

    fn remove(&mut self) -> Option<(String, usize)> {
        match self {
            CacheStrategy::Lru(cache) => cache.remove_lru(),
            CacheStrategy::Fifo((queue, set)) => {
                if queue.is_empty() {
                    return None;
                }
                let (key, size) = queue.pop_front().unwrap();
                set.remove(&key);
                Some((key, size))
            }
        }
    }

    fn contains_key(&self, key: &str) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.contains_key(key),
            CacheStrategy::Fifo((_, set)) => set.contains(key),
        }
    }

    fn len(&self) -> usize {
        match self {
            CacheStrategy::Lru(cache) => cache.len(),
            CacheStrategy::Fifo((queue, _)) => queue.len(),
        }
    }

    fn is_empty(&self) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.is_empty(),
            CacheStrategy::Fifo((queue, _)) => queue.is_empty(),
        }
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    disk::init().await?;
    memory::init().await?;
    Ok(())
}

pub async fn download(trace_id: &str, file: &str) -> Result<(), anyhow::Error> {
    let config = CONFIG.read().await;
    if config.memory_cache.enabled {
        memory::download(trace_id, file).await
    } else if config.disk_cache.enabled {
        disk::download(trace_id, file).await
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lru_cache_miss() {
        let mut cache = CacheStrategy::new("lru");
        let key1 = "a";
        let key2 = "b";
        cache.insert(key1.to_string(), 1);
        cache.insert(key2.to_string(), 2);
        cache.contains_key(key1);
        cache.remove();
        assert!(cache.contains_key(key1));
        assert!(!cache.contains_key(key2));
    }

    #[test]
    fn test_fifo_cache_miss() {
        let mut cache = CacheStrategy::new("fifo");
        let key1 = "a";
        let key2 = "b";
        cache.insert(key1.to_string(), 1);
        cache.insert(key2.to_string(), 2);
        cache.contains_key(key1);
        cache.remove();
        assert!(!cache.contains_key(key1));
        assert!(cache.contains_key(key2));
    }
}
