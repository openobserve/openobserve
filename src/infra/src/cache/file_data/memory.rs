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

use std::{
    cmp::{max, min},
    ops::Range,
};

use bytes::Bytes;
use config::{
    RwHashMap, get_config, is_local_disk_storage, metrics, spawn_pausable_job,
    utils::{
        hash::{Sum64, gxhash},
        time::BASE_TIME,
    },
};
use futures::StreamExt;
use object_store::{GetOptions, GetResult, GetResultPayload, ObjectMeta};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::CacheStrategy;

static FILES: Lazy<Vec<RwLock<FileData>>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.memory_cache.bucket_num);
    for _ in 0..cfg.memory_cache.bucket_num {
        files.push(RwLock::new(FileData::new()));
    }
    files
});
static DATA: Lazy<Vec<RwHashMap<String, Bytes>>> = Lazy::new(|| {
    let cfg = get_config();
    let mut data = Vec::with_capacity(cfg.memory_cache.bucket_num);
    for _ in 0..cfg.memory_cache.bucket_num {
        data.push(Default::default());
    }
    data
});

pub struct FileData {
    cur_size: usize,
    data: CacheStrategy,
    #[cfg(test)]
    max_size: Option<usize>,
}

impl Default for FileData {
    fn default() -> Self {
        Self::new()
    }
}

impl FileData {
    pub fn new() -> FileData {
        let cfg = get_config();
        FileData::with_cache_strategy(&cfg.memory_cache.cache_strategy)
    }

    pub fn with_cache_strategy(strategy: &str) -> FileData {
        FileData {
            cur_size: 0,
            data: CacheStrategy::new(strategy),
            #[cfg(test)]
            max_size: None,
        }
    }

    #[cfg(test)]
    pub fn with_cache_strategy_and_max_size(strategy: &str, max_size: usize) -> FileData {
        FileData {
            cur_size: 0,
            data: CacheStrategy::new(strategy),
            max_size: Some(max_size),
        }
    }

    async fn exist(&self, file: &str) -> bool {
        self.data.contains_key(file)
    }

    async fn get(&self, file: &str, range: Option<Range<u64>>) -> Option<Bytes> {
        let idx = get_bucket_idx(file);
        let data = DATA[idx].get(file)?;
        Some(if let Some(range) = range {
            data.value().slice(range.start as usize..range.end as usize)
        } else {
            data.value().clone()
        })
    }

    async fn get_size(&self, file: &str) -> Option<usize> {
        let idx = get_bucket_idx(file);
        let data = DATA[idx].get(file)?;
        Some(data.value().len())
    }

    async fn set(&mut self, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
        let data_size = file.len() + data.len();
        #[cfg(test)]
        let max_size = self.max_size.unwrap_or(get_config().memory_cache.max_size);
        #[cfg(not(test))]
        let max_size = get_config().memory_cache.max_size;
        if self.cur_size + data_size >= max_size {
            log::info!("File memory cache is full, can't cache extra {data_size} bytes");
            // cache is full, need release some space
            let need_release_size = min(
                self.cur_size,
                max(get_config().memory_cache.release_size, data_size * 100),
            );
            self.gc(need_release_size).await?;
        }

        self.cur_size += data_size;
        self.data.insert(file.to_string(), data_size);
        // write file into cache
        let idx = get_bucket_idx(file);
        DATA[idx].insert(file.to_string(), data);
        // metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_MEMORY_CACHE_FILES
                .with_label_values(&[columns[1], columns[2]])
                .inc();
            metrics::QUERY_MEMORY_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2]])
                .add(data_size as i64);
        }
        Ok(())
    }

    async fn gc(&mut self, need_release_size: usize) -> Result<(), anyhow::Error> {
        log::info!(
            "File memory cache start gc {}/{}, need to release {} bytes",
            self.cur_size,
            get_config().memory_cache.max_size,
            need_release_size
        );
        let mut release_size = 0;
        loop {
            let item = self.data.remove();
            if item.is_none() {
                log::warn!("File memory cache is corrupt, it shouldn't be none");
                break;
            }
            let (key, data_size) = item.unwrap();
            // move the file from memory to disk cache
            let idx = get_bucket_idx(&key);
            if let Some((key, data)) = DATA[idx].remove(&key)
                && !is_local_disk_storage()
            {
                _ = super::disk::set(&key, data).await;
            }
            // metrics
            let columns = key.split('/').collect::<Vec<&str>>();
            if columns[0] == "files" {
                metrics::QUERY_MEMORY_CACHE_FILES
                    .with_label_values(&[columns[1], columns[2]])
                    .dec();
                metrics::QUERY_MEMORY_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2]])
                    .sub(data_size as i64);
            }
            release_size += data_size;
            if release_size >= need_release_size {
                break;
            }
        }
        self.cur_size -= release_size;
        let _ = DATA.iter().map(|c| c.shrink_to_fit()).collect::<Vec<_>>();
        log::info!("File memory cache gc done, released {release_size} bytes");
        Ok(())
    }

    async fn remove(&mut self, file: &str) -> Result<(), anyhow::Error> {
        log::debug!("File memory cache remove file {file}");

        let Some((key, data_size)) = self.data.remove_key(file) else {
            return Ok(());
        };
        self.cur_size -= data_size;

        // remove file from data cache
        let idx = get_bucket_idx(&key);
        DATA[idx].remove(&key);

        // metrics
        let columns = key.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_MEMORY_CACHE_FILES
                .with_label_values(&[columns[1], columns[2]])
                .dec();
            metrics::QUERY_MEMORY_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2]])
                .sub(data_size as i64);
        }

        Ok(())
    }

    fn size(&self) -> usize {
        self.cur_size
    }

    fn len(&self) -> usize {
        self.data.len()
    }

    fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    for file in FILES.iter() {
        _ = file.read().await.get("", None).await;
    }

    spawn_pausable_job!("memory_cache_gc", get_config().memory_cache.gc_interval, {
        if let Err(e) = gc().await {
            log::error!("memory cache gc error: {e}");
        }
    });
    Ok(())
}

pub async fn get_opts(file: &str, options: GetOptions) -> object_store::Result<GetResult> {
    let Some(data) = get(file, None).await else {
        return Err(object_store::Error::NotFound {
            path: file.to_string(),
            source: Box::new(std::io::Error::other("file not found")),
        });
    };

    let meta = ObjectMeta {
        location: file.into(),
        last_modified: *BASE_TIME,
        size: data.len() as u64,
        e_tag: Some(format!(
            "{:x}-{:x}",
            BASE_TIME.timestamp_micros(),
            data.len()
        )),
        version: None,
    };
    options.check_preconditions(&meta)?;

    let (range, data) = match options.range {
        Some(range) => {
            let r = range.as_range(data.len() as u64).map_err(|e| {
                object_store::Error::Precondition {
                    path: file.to_string(),
                    source: Box::new(e),
                }
            })?;
            (r.clone(), data.slice(r.start as usize..r.end as usize))
        }
        None => (0..data.len() as u64, data),
    };
    let stream = futures::stream::once(futures::future::ready(Ok(data)));

    Ok(GetResult {
        payload: GetResultPayload::Stream(stream.boxed()),
        attributes: Default::default(),
        meta,
        range,
    })
}

#[inline]
pub async fn get(file: &str, range: Option<Range<u64>>) -> Option<Bytes> {
    if !get_config().memory_cache.enabled {
        return None;
    }
    let idx = get_bucket_idx(file);
    let files = FILES[idx].read().await;
    files.get(file, range).await
}

#[inline]
pub async fn get_size(file: &str) -> Option<usize> {
    if !get_config().memory_cache.enabled {
        return None;
    }
    let idx = get_bucket_idx(file);
    let files = FILES[idx].read().await;
    files.get_size(file).await
}

#[inline]
pub async fn exist(file: &str) -> bool {
    if !get_config().memory_cache.enabled {
        return false;
    }
    let idx = get_bucket_idx(file);
    let files = FILES[idx].read().await;
    files.exist(file).await
}

#[inline]
pub async fn set(file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !get_config().memory_cache.enabled {
        return Ok(());
    }
    let idx = get_bucket_idx(file);
    let mut files = FILES[idx].write().await;
    if files.exist(file).await {
        return Ok(());
    }
    files.set(file, data).await
}

#[inline]
pub async fn remove(file: &str) -> Result<(), anyhow::Error> {
    if !get_config().memory_cache.enabled {
        return Ok(());
    }
    let idx = get_bucket_idx(file);
    let mut files = FILES[idx].write().await;
    files.remove(file).await
}

async fn gc() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if !cfg.memory_cache.enabled {
        return Ok(());
    }

    for file in FILES.iter() {
        let r = file.read().await;
        if r.cur_size + cfg.memory_cache.release_size < cfg.memory_cache.max_size {
            continue;
        }
        drop(r);
        let mut w = file.write().await;
        w.gc(cfg.memory_cache.gc_size).await?;
        drop(w);
    }

    Ok(())
}

#[inline]
pub async fn stats() -> (usize, usize) {
    let mut total_size = 0;
    let mut used_size = 0;
    for file in FILES.iter() {
        let r = file.read().await;
        let cur_size = r.size();
        total_size += get_config().memory_cache.max_size;
        used_size += cur_size;
    }
    (total_size, used_size)
}

#[inline]
pub async fn len() -> usize {
    let mut total = 0;
    for file in FILES.iter() {
        let r = file.read().await;
        total += r.len();
    }
    total
}

#[inline]
pub async fn is_empty() -> bool {
    for file in FILES.iter() {
        let r = file.read().await;
        if !r.is_empty() {
            return false;
        }
    }
    true
}

pub async fn download(
    account: &str,
    file: &str,
    size: Option<usize>,
) -> Result<usize, anyhow::Error> {
    let (data_len, data_bytes) = super::download_from_storage(account, file, size).await?;
    if let Err(e) = set(file, data_bytes).await {
        return Err(anyhow::anyhow!(
            "set file {} to memory cache failed: {}",
            file,
            e
        ));
    };
    Ok(data_len)
}

fn get_bucket_idx(file: &str) -> usize {
    let cfg = get_config();
    if cfg.memory_cache.bucket_num <= 1 {
        0
    } else {
        let h = gxhash::new().sum64(file);
        (h as usize) % cfg.memory_cache.bucket_num
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_lru_cache_set_file() {
        let mut file_data = FileData::with_cache_strategy_and_max_size("lru", 1024);
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..50 {
            let file_key = format!(
                "files/default/logs/memory/2022/10/03/10/6982652937134804993_1_{i}.parquet"
            );
            let resp = file_data.set(&file_key, content.clone()).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_lru_cache_get_file() {
        let mut file_data =
            FileData::with_cache_strategy_and_max_size("lru", get_config().memory_cache.max_size);
        let file_key = "files/default/logs/memory/2022/10/03/10/6982652937134804993_2_1.parquet";
        let content = Bytes::from("Some text");

        file_data.set(file_key, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);

        file_data.set(file_key, content.clone()).await.unwrap();
        assert!(file_data.exist(file_key).await);
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);
        assert!(file_data.size() > 0);
    }

    #[tokio::test]
    async fn test_lru_cache_miss() {
        let mut file_data = FileData::with_cache_strategy_and_max_size("lru", 100);
        let file_key1 = "files/default/logs/memory/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/memory/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data.set(file_key1, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key1, None).await.unwrap(), content);
        // set another key, will release first key
        file_data.set(file_key2, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key2, None).await.unwrap(), content);
        // get first key, should get error
        assert!(file_data.get(file_key1, None).await.is_none());
    }

    #[tokio::test]
    async fn test_fifo_cache_set_file() {
        let mut file_data = FileData::with_cache_strategy_and_max_size("fifo", 1024);
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..50 {
            let file_key = format!(
                "files/default/logs/memory/2022/10/03/10/6982652937134804993_4_{i}.parquet"
            );
            let resp = file_data.set(&file_key, content.clone()).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_fifo_cache_get_file() {
        let mut file_data =
            FileData::with_cache_strategy_and_max_size("fifo", get_config().memory_cache.max_size);
        let file_key = "files/default/logs/memory/2022/10/03/10/6982652937134804993_5_1.parquet";
        let content = Bytes::from("Some text");

        file_data.set(file_key, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);

        file_data.set(file_key, content.clone()).await.unwrap();
        assert!(file_data.exist(file_key).await);
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);
        assert!(file_data.size() > 0);
    }

    #[tokio::test]
    async fn test_fifo_cache_miss() {
        let mut file_data = FileData::with_cache_strategy_and_max_size("fifo", 100);
        let file_key1 = "files/default/logs/memory/2022/10/03/10/6982652937134804993_6_1.parquet";
        let file_key2 = "files/default/logs/memory/2022/10/03/10/6982652937134804993_6_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data.set(file_key1, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key1, None).await.unwrap(), content);
        // set another key, will release first key
        file_data.set(file_key2, content.clone()).await.unwrap();
        assert_eq!(file_data.get(file_key2, None).await.unwrap(), content);
        // get first key, should get error
        assert!(file_data.get(file_key1, None).await.is_none());
    }
}
