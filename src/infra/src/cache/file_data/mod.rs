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

pub mod delete;
pub mod disk;
pub mod memory;

use std::{
    collections::{BTreeMap, VecDeque},
    ops::Range,
};

use bytes::Bytes;
use config::utils::time::get_ymdh_from_micros;
use hashbrown::HashSet;
use hashlink::lru_cache::LruCache;
use object_store::{GetOptions, GetResult};

const DOWNLOAD_RETRY_TIMES: usize = 3;
const INITIAL_CACHE_SIZE: usize = 128;
pub const TRACE_ID_FOR_CACHE_LATEST_FILE: &str = "cache_latest_file";

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum CacheType {
    Disk,
    Memory,
    None,
}

enum CacheStrategy {
    Lru(LruCache<String, usize>),
    Fifo(VecDeque<(String, usize)>, HashSet<String>),
    TimeLru(
        BTreeMap<u64, usize>,
        Vec<LruCache<String, usize>>,
        HashSet<String>,
    ),
}

enum FileType {
    Parquet,
    Ttv,
}

impl CacheStrategy {
    fn new(name: &str) -> Self {
        match name.to_lowercase().as_str() {
            "lru" => CacheStrategy::Lru(LruCache::new_unbounded()),
            "fifo" => CacheStrategy::Fifo(
                VecDeque::with_capacity(INITIAL_CACHE_SIZE),
                HashSet::with_capacity(INITIAL_CACHE_SIZE),
            ),
            "time_lru" => CacheStrategy::TimeLru(
                BTreeMap::new(),
                Vec::new(),
                HashSet::with_capacity(INITIAL_CACHE_SIZE),
            ),
            _ => CacheStrategy::Lru(LruCache::new_unbounded()),
        }
    }

    fn insert(&mut self, key: String, size: usize) {
        match self {
            CacheStrategy::Lru(cache) => {
                cache.insert(key, size);
            }
            CacheStrategy::Fifo(queue, set) => {
                set.insert(key.clone());
                queue.push_back((key, size));
            }
            CacheStrategy::TimeLru(map, cache, set) => {
                let time = get_file_time(&key).unwrap_or(0);
                set.insert(key.clone());
                let idx = map.entry(time).or_insert_with(|| {
                    cache.push(LruCache::new_unbounded());
                    cache.len() - 1
                });
                cache[*idx].insert(key, size);
            }
        }
    }

    fn remove(&mut self) -> Option<(String, usize)> {
        match self {
            CacheStrategy::Lru(cache) => cache.remove_lru(),
            CacheStrategy::Fifo(queue, set) => {
                if queue.is_empty() {
                    return None;
                }
                queue.pop_front().map(|(key, size)| {
                    set.remove(&key);
                    (key, size)
                })
            }
            CacheStrategy::TimeLru(map, cache, set) => {
                if map.is_empty() {
                    return None;
                }
                let mut idx = None;
                for (_, val) in map.iter() {
                    if !cache[*val].is_empty() {
                        idx = Some(*val);
                        break;
                    }
                }
                let idx = idx?;
                let (key, size) = cache[idx].remove_lru()?;
                set.remove(&key);
                Some((key, size))
            }
        }
    }

    fn remove_key(&mut self, key: &str) -> Option<(String, usize)> {
        match self {
            CacheStrategy::Lru(cache) => cache.remove_entry(key),
            CacheStrategy::Fifo(queue, set) => {
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
            CacheStrategy::TimeLru(map, cache, set) => {
                if map.is_empty() {
                    return None;
                }
                let time = get_file_time(key).unwrap_or(0);
                let idx = map.get(&time).copied()?;
                let (key, size) = cache[idx].remove_entry(key)?;
                set.remove(&key);
                Some((key, size))
            }
        }
    }

    fn contains_key(&self, key: &str) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.contains_key(key),
            CacheStrategy::Fifo(_, set) => set.contains(key),
            CacheStrategy::TimeLru(_, _, set) => set.contains(key),
        }
    }

    fn len(&self) -> usize {
        match self {
            CacheStrategy::Lru(cache) => cache.len(),
            CacheStrategy::Fifo(queue, _) => queue.len(),
            CacheStrategy::TimeLru(_, _, set) => set.len(),
        }
    }

    fn is_empty(&self) -> bool {
        match self {
            CacheStrategy::Lru(cache) => cache.is_empty(),
            CacheStrategy::Fifo(queue, _) => queue.is_empty(),
            CacheStrategy::TimeLru(map, ..) => map.is_empty(),
        }
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    disk::init().await?;
    memory::init().await?;
    Ok(())
}

pub async fn download(
    account: &str,
    file: &str,
    size: Option<usize>,
) -> Result<usize, anyhow::Error> {
    let cfg = config::get_config();
    if cfg.memory_cache.enabled {
        memory::download(account, file, size).await
    } else if cfg.disk_cache.enabled {
        disk::download(account, file, size).await
    } else {
        Ok(0)
    }
}

async fn validate_file(bytes: &[u8], ftype: FileType) -> Result<(), anyhow::Error> {
    match ftype {
        FileType::Parquet => {
            let b = Bytes::copy_from_slice(bytes);
            let mut reader = parquet::file::metadata::ParquetMetaDataReader::new();
            reader.try_parse(&b)?;
        }
        FileType::Ttv => {
            if bytes.len() < 12 {
                return Err(anyhow::anyhow!("invalid puffin file"));
            }
            let footer = &bytes[bytes.len() - 12..bytes.len()];
            if footer[8..12] != [0x50, 0x46, 0x41, 0x31] {
                return Err(anyhow::anyhow!("puffin footer magic mismatch"));
            }
            let payload_size = i32::from_le_bytes(footer[0..4].try_into().unwrap());
            if bytes.len() < 12 + payload_size as usize {
                return Err(anyhow::anyhow!("payload size mismatch"));
            }
        }
    }
    Ok(())
}

async fn download_from_storage(
    account: &str,
    file: &str,
    size: Option<usize>,
) -> Result<(usize, bytes::Bytes), anyhow::Error> {
    let mut data_len = 0;
    let mut data_bytes = bytes::Bytes::new();
    let mut retry_time = 1;
    let mut expected_blob_size = 0;
    for i in 0..DOWNLOAD_RETRY_TIMES {
        // get the initial headers
        let res = crate::storage::get(account, file).await?;
        // this is the size blob store has
        expected_blob_size = res.meta.size;
        if expected_blob_size == 0 {
            return Err(anyhow::anyhow!("file {} data size is zero", file));
        }

        // download the actual bytes
        let data = res.bytes().await?;
        data_len = data.len();
        data_bytes = data;

        // if the downloaded length is not equal to what the blog store
        // sent in headers, we might have a partial download, so we log
        // and retry
        if data_len as u64 != expected_blob_size {
            let msg = if i == DOWNLOAD_RETRY_TIMES - 1 {
                format!("after {DOWNLOAD_RETRY_TIMES} retries")
            } else {
                "will retry".to_string()
            };
            log::warn!(
                "download file {file} found size mismatch with blob store header, expected: {expected_blob_size}, actual: {data_len}, {msg}",
            );
            tokio::time::sleep(tokio::time::Duration::from_secs(retry_time)).await;
            retry_time *= 2;
            continue;
        } else {
            // size matches
            break;
        }
    }
    // if even after retries, the download size does not match, we skip it
    // no point in validating or setting the value
    if data_len as u64 != expected_blob_size {
        return Err(anyhow::anyhow!(
            "file {file} could not be downloaded completely: expected {expected_blob_size}, got {data_len} skipping"
        ));
    }

    // now the size we downloaded matches what blob store has or tried the max attempts, we check
    // if it matches with what we have in db or not. Also because the size matches blob store/we
    // have exceeded try attempts, there is no sense in retrying here, because that is the size
    // we are going to get every time.
    match size {
        None => Ok((data_len, data_bytes)),
        Some(size) => {
            if data_len == size {
                Ok((data_len, data_bytes))
            } else {
                // the entry in db does not match what there is actually in the blob store
                // so we check if the footer is valid. If it is, then the db entry is invalid
                // and we reset it. If footer is invalid, the the store has a corrupted file
                // so we mark it as deleted, and return error.
                let valid_parquet = file.ends_with(".parquet")
                    && validate_file(&data_bytes, FileType::Parquet).await.is_ok();
                let valid_ttv = file.ends_with(".ttv")
                    && validate_file(&data_bytes, FileType::Ttv).await.is_ok();
                if valid_parquet || valid_ttv {
                    log::warn!(
                        "download file {file} found size mismatch, remote : {expected_blob_size}, db: {size}, correcting db as valid file",
                    );
                    // only update for parquet files, not ttv files
                    if file.ends_with(".parquet") {
                        crate::file_list::update_compressed_size(file, data_len as i64).await?;
                        crate::file_list::LOCAL_CACHE
                            .update_compressed_size(file, data_len as i64)
                            .await?;
                    }
                    Ok((data_len, data_bytes))
                } else {
                    log::warn!(
                        "download file {file} found corrupt file, remote: {expected_blob_size}, db: {size}, deleting entry from file_list "
                    );
                    // only update for parquet files, not ttv files
                    if file.ends_with(".parquet") {
                        crate::file_list::remove(file).await?;
                        crate::file_list::LOCAL_CACHE.remove(file).await?;
                    }
                    Err(anyhow::anyhow!("file {file} is corrupted in blob store"))
                }
            }
        }
    }
}

/// set the data to the cache
///
/// store the data to the memory cache or disk cache
pub async fn set(key: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    // set the data to the memory cache
    if cfg.memory_cache.enabled {
        memory::set(key, data).await
    } else if cfg.disk_cache.enabled {
        disk::set(key, data).await
    } else {
        Ok(())
    }
}

pub async fn get(
    account: &str,
    file: &str,
    range: Option<Range<u64>>,
) -> object_store::Result<bytes::Bytes> {
    let options = GetOptions {
        range: range.map(|r| r.into()),
        ..Default::default()
    };
    get_opts(account, file, options, true).await?.bytes().await
}

pub async fn get_opts(
    account: &str,
    file: &str,
    options: GetOptions,
    remote: bool,
) -> object_store::Result<GetResult> {
    let cfg = config::get_config();
    // get from memory cache
    if cfg.memory_cache.enabled
        && let Ok(ret) = memory::get_opts(file, options.clone()).await
    {
        return Ok(ret);
    }
    // get from disk cache
    if cfg.disk_cache.enabled
        && let Ok(ret) = disk::get_opts(file, options.clone()).await
    {
        return Ok(ret);
    }

    // get from storage
    if remote {
        return crate::storage::get_opts(account, file, options).await;
    }

    Err(object_store::Error::NotFound {
        path: file.to_string(),
        source: Box::new(std::io::Error::other(file)),
    })
}

pub async fn get_size(account: &str, file: &str) -> object_store::Result<usize> {
    get_size_opts(account, file, true).await
}

pub async fn get_size_opts(account: &str, file: &str, remote: bool) -> object_store::Result<usize> {
    let cfg = config::get_config();
    // get from memory cache
    if cfg.memory_cache.enabled
        && let Some(v) = memory::get_size(file).await
    {
        return Ok(v);
    }
    // get from disk cache
    if cfg.disk_cache.enabled
        && let Some(v) = disk::get_size(file).await
    {
        return Ok(v);
    }

    // get from storage
    if remote {
        let meta = crate::storage::head(account, file).await?;
        return Ok(meta.size as usize);
    }

    Err(object_store::Error::NotFound {
        path: file.to_string(),
        source: Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, file)),
    })
}

/// get the file time from the file name
///
/// metrics_cache:
/// metrics_results/default/2025/04/08/06/
/// 17caf18281f2a17c76a803a9cd59a207_1744091424000000_1744091426789749_1744089728661252.pb
/// log_cache:
/// results/default/logs/default/16042959487540176184_30_zo_sql_key/
/// 1744081170000000_1744081170000000_1_0.json
/// parquet_cache:
/// files/default/logs/disk/2025/04/08/06/7315292721030106704.parquet
/// aggregation cache:
/// aggregations/default/logs/default/16042959487540176184/1744081170000000_1744081170000000.arrow
fn get_file_time(file: &str) -> Option<u64> {
    let parts = file.split('/').collect::<Vec<_>>();
    if parts.len() < 6 {
        return None;
    }
    let date = match parts[0] {
        "metrics_results" => {
            format!("{}{}{}{}", parts[2], parts[3], parts[4], parts[5])
        }
        "results" => {
            let (_, _, _, meta) = disk::parse_result_cache_key(file)?;
            get_ymdh_from_micros(meta.start_time).replace("/", "")
        }
        "files" => {
            if parts.len() < 8 {
                return None;
            }
            format!("{}{}{}{}", parts[4], parts[5], parts[6], parts[7])
        }
        "aggregations" => {
            let (_, _, _, meta) = disk::parse_aggregation_cache_key(file)?;
            get_ymdh_from_micros(meta.start_time).replace("/", "")
        }
        _ => {
            return None;
        }
    };
    date.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_data_lru_cache_miss() {
        let mut cache = CacheStrategy::new("lru");
        let key1 = "files/default/logs/b/2025/04/08/06/1.parquet";
        let key2 = "files/default/logs/b/2025/04/08/06/2.parquet";
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
        let key1 = "files/default/logs/b/2025/04/08/06/1.parquet";
        let key2 = "files/default/logs/b/2025/04/08/06/2.parquet";
        cache.insert(key1.to_string(), 1);
        cache.insert(key2.to_string(), 2);
        cache.contains_key(key1);
        cache.remove();
        assert!(!cache.contains_key(key1));
        assert!(cache.contains_key(key2));
    }

    #[test]
    fn test_file_data_time_lru_cache_miss() {
        let mut cache = CacheStrategy::new("time_lru");
        let key_small = "files/default/logs/b/2025/04/08/01/1.parquet";
        let key_big = "files/default/logs/b/2099/04/08/02/2.parquet";
        let key_other = "files/default/logs/b/2025/04/08/03/2.parquet";
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
        let file = "metrics_results/default/2025/04/08/06/17caf18281f2a17c76a803a9cd59a207_1744091424000000_1744091426789749_1744089728661252.pb";
        let time = get_file_time(file);
        assert_eq!(time, Some(2025040806));

        let file = "results/default/logs/default/16042959487540176184_30_zo_sql_key/1744081170000000_1744081170000000_1_0.json";
        let time = get_file_time(file);
        assert_eq!(time, Some(2025040802));

        let file = "files/default/logs/disk/2022/10/03/10/7315292721030106704.parquet";
        let time = get_file_time(file);
        assert_eq!(time, Some(2022100310));

        let file = "aggregations/default/logs/default/16042959487540176184/1744081170000000_1744081170000000.arrow";
        let time = get_file_time(file);
        assert_eq!(time, Some(2025040802));
    }
}
