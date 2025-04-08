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

pub mod disk;
pub mod memory;

use std::{
    collections::{BTreeMap, VecDeque},
    ops::Range,
};

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
    FileTime(BTreeMap<String, usize>, HashSet<String>),
}

impl CacheStrategy {
    fn new(name: &str) -> Self {
        match name.to_lowercase().as_str() {
            "lru" => CacheStrategy::Lru(LruCache::new_unbounded()),
            "fifo" => CacheStrategy::Fifo((
                VecDeque::with_capacity(INITIAL_CACHE_SIZE),
                HashSet::with_capacity(INITIAL_CACHE_SIZE),
            )),
            "filetime" | "file_time" => {
                CacheStrategy::FileTime(BTreeMap::new(), HashSet::with_capacity(INITIAL_CACHE_SIZE))
            }
            _ => CacheStrategy::Lru(LruCache::new_unbounded()),
        }
    }

    fn insert(&mut self, key: String, size: usize) {
        match self {
            CacheStrategy::Lru(cache) => {
                cache.insert(key, size);
            }
            CacheStrategy::Fifo((queue, set)) => {
                set.insert(key.clone());
                queue.push_back((key, size));
            }
            CacheStrategy::FileTime(map, set) => {
                let time = get_file_time(&key).unwrap_or(config::utils::time::now_micros() as u64);
                set.insert(key.clone());
                map.insert(format!("{}/{}", time, key), size);
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
                queue.pop_front().map(|(key, size)| {
                    set.remove(&key);
                    (key, size)
                })
            }
            CacheStrategy::FileTime(map, set) => {
                if map.is_empty() {
                    return None;
                }
                map.pop_first().map(|(key, size)| {
                    let (_, key) = key.split_once('/').unwrap();
                    set.remove(key);
                    (key.to_string(), size)
                })
            }
        }
    }

    fn remove_key(&mut self, key: &str) -> Option<(String, usize)> {
        match self {
            CacheStrategy::Lru(cache) => cache.remove_entry(key),
            CacheStrategy::Fifo((queue, set)) => {
                if queue.is_empty() {
                    return None;
                }
                let mut index = 0;
                while index < queue.len() {
                    if queue[index].0 == key {
                        let (k, v) = queue.remove(index).unwrap();
                        set.remove(&k);
                        return Some((k, v));
                    }
                    index += 1;
                }
                None
            }
            CacheStrategy::FileTime(map, set) => {
                if map.is_empty() {
                    return None;
                }
                let keys = map.extract_if(|k, _v| k.ends_with(key)).collect::<Vec<_>>();
                if keys.is_empty() {
                    return None;
                }
                let (key, size) = &keys[0];
                let (_, key) = key.split_once('/').unwrap();
                set.remove(key);
                Some((key.to_string(), *size))
            }
        }
    }

    fn contains_key(&self, key: &str) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.contains_key(key),
            CacheStrategy::Fifo((_, set)) => set.contains(key),
            CacheStrategy::FileTime(_, set) => set.contains(key),
        }
    }

    fn len(&self) -> usize {
        match self {
            CacheStrategy::Lru(cache) => cache.len(),
            CacheStrategy::Fifo((queue, _)) => queue.len(),
            CacheStrategy::FileTime(map, _) => map.len(),
        }
    }

    fn is_empty(&self) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.is_empty(),
            CacheStrategy::Fifo((queue, _)) => queue.is_empty(),
            CacheStrategy::FileTime(map, _) => map.is_empty(),
        }
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    disk::init().await?;
    memory::init().await?;
    Ok(())
}

pub async fn download(trace_id: &str, file: &str) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    if cfg.memory_cache.enabled {
        memory::download(trace_id, file).await
    } else if cfg.disk_cache.enabled {
        disk::download(trace_id, file).await
    } else {
        Ok(())
    }
}

/// set the data to the cache
///
/// store the data to the memory cache or disk cache
pub async fn set(trace_id: &str, key: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    // set the data to the memory cache
    if cfg.memory_cache.enabled {
        memory::set(trace_id, key, data).await
    } else if cfg.disk_cache.enabled {
        disk::set(trace_id, key, data).await
    } else {
        Ok(())
    }
}

pub async fn get(file: &str, range: Option<Range<usize>>) -> object_store::Result<bytes::Bytes> {
    get_opts(file, range, true).await
}

pub async fn get_opts(
    file: &str,
    range: Option<Range<usize>>,
    remote: bool,
) -> object_store::Result<bytes::Bytes> {
    let cfg = config::get_config();
    // get from memory cache
    if cfg.memory_cache.enabled {
        if let Some(v) = memory::get(file, range.clone()).await {
            return Ok(v);
        }
    }
    // get from disk cache
    if cfg.disk_cache.enabled {
        if let Some(v) = disk::get(file, range.clone()).await {
            return Ok(v);
        }
    }
    // get from storage
    if remote {
        return match range {
            Some(r) => crate::storage::get_range(file, r).await,
            None => crate::storage::get(file).await,
        };
    }

    Err(object_store::Error::NotFound {
        path: file.to_string(),
        source: Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, file)),
    })
}

pub async fn get_size(file: &str) -> object_store::Result<usize> {
    get_size_opts(file, true).await
}

pub async fn get_size_opts(file: &str, remote: bool) -> object_store::Result<usize> {
    let cfg = config::get_config();
    // get from memory cache
    if cfg.memory_cache.enabled {
        if let Some(v) = memory::get_size(file).await {
            return Ok(v);
        }
    }
    // get from disk cache
    if cfg.disk_cache.enabled {
        if let Some(v) = disk::get_size(file).await {
            return Ok(v);
        }
    }
    // get from storage
    if remote {
        let meta = crate::storage::head(file).await?;
        return Ok(meta.size);
    }

    Err(object_store::Error::NotFound {
        path: file.to_string(),
        source: Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, file)),
    })
}

/// get the file time from the file name
///
/// metrics_cache:
/// metrics_results/2025/04/08/06/
/// 17caf18281f2a17c76a803a9cd59a207_1744091424000000_1744091426789749_1744089728661252.pb
/// log_cache:
/// results/default/logs/default/16042959487540176184_30_zo_sql_key/
/// 1744081170000000_1744081170000000_1_0.json
/// parquet_cache:
/// files/default/logs/disk/2025/04/08/06/7315292721030106704.parquet
fn get_file_time(file: &str) -> Option<u64> {
    let file = file.split('/').next_back()?;
    let time = file.split('.').next()?;
    if !time.contains('_') {
        return time.parse::<u64>().ok();
    }

    let columns = time.split('_').collect::<Vec<_>>();
    if columns.is_empty() {
        return None;
    }
    if let Ok(time) = columns[0].parse::<u64>() {
        return Some(time);
    }
    if columns.len() < 2 {
        return None;
    }
    if let Ok(time) = columns[1].parse::<u64>() {
        return Some(time);
    }
    if columns.len() < 3 {
        return None;
    }
    if let Ok(time) = columns[2].parse::<u64>() {
        return Some(time);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_data_lru_cache_miss() {
        let mut cache = CacheStrategy::new("lru");
        let key1 = "a/b/1.parquet";
        let key2 = "b/c/2.parquet";
        cache.insert(key1.to_string(), 1);
        cache.insert(key2.to_string(), 2);
        cache.contains_key(key1);
        cache.remove(); // contains_key() does not mark the key1 as used -> removed
        assert!(!cache.contains_key(key1));
        assert!(cache.contains_key(key2));
    }

    #[test]
    fn test_file_data_fifo_cache_miss() {
        let mut cache = CacheStrategy::new("fifo");
        let key1 = "a/b/1.parquet";
        let key2 = "b/c/2.parquet";
        cache.insert(key1.to_string(), 1);
        cache.insert(key2.to_string(), 2);
        cache.contains_key(key1);
        cache.remove();
        assert!(!cache.contains_key(key1));
        assert!(cache.contains_key(key2));
    }

    #[test]
    fn test_file_data_file_time_cache_miss() {
        let mut cache = CacheStrategy::new("file_time");
        let key_small = "b/c/2024.parquet";
        let key_big = "a/b/2025.parquet";
        let key_other = "a/b/2023.parquet";
        cache.insert(key_small.to_string(), 1);
        cache.insert(key_big.to_string(), 2);
        cache.insert(key_other.to_string(), 3);
        cache.contains_key(key_small);
        cache.remove();
        cache.remove();
        assert!(!cache.contains_key(key_small));
        assert!(!cache.contains_key(key_other));
        assert!(cache.contains_key(key_big));
    }

    #[test]
    fn test_file_data_get_file_time() {
        let file = "metrics_results/2025/04/08/06/17caf18281f2a17c76a803a9cd59a207_1744091424000000_1744091426789749_1744089728661252.pb";
        let time = get_file_time(file);
        assert_eq!(time, Some(1744091424000000));

        let file = "results/default/logs/default/16042959487540176184_30_zo_sql_key/1744081170000000_1744081170000000_1_0.json";
        let time = get_file_time(file);
        assert_eq!(time, Some(1744081170000000));

        let file = "files/default/logs/disk/2022/10/03/10/7315292721030106704.parquet";
        let time = get_file_time(file);
        assert_eq!(time, Some(7315292721030106704));
    }
}
