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

use std::{
    cmp::{max, min},
    ops::Range,
};

use bytes::Bytes;
use config::{
    metrics,
    utils::hash::{gxhash, Sum32},
    RwHashMap, CONFIG,
};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::CacheStrategy;
use crate::storage;

static FILES: Lazy<Vec<RwLock<FileData>>> = Lazy::new(|| {
    let mut files = Vec::with_capacity(CONFIG.memory_cache.bucket_num);
    for _ in 0..CONFIG.memory_cache.bucket_num {
        files.push(RwLock::new(FileData::new()));
    }
    files
});
static DATA: Lazy<Vec<RwHashMap<String, Bytes>>> = Lazy::new(|| {
    let mut datas = Vec::with_capacity(CONFIG.memory_cache.bucket_num);
    for _ in 0..CONFIG.memory_cache.bucket_num {
        datas.push(Default::default());
    }
    datas
});

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    data: CacheStrategy,
}

impl Default for FileData {
    fn default() -> Self {
        Self::new()
    }
}

impl FileData {
    pub fn new() -> FileData {
        FileData::with_capacity_and_cache_strategy(
            CONFIG.memory_cache.max_size,
            &CONFIG.memory_cache.cache_strategy,
        )
    }

    pub fn with_capacity_and_cache_strategy(max_size: usize, strategy: &str) -> FileData {
        FileData {
            max_size,
            cur_size: 0,
            data: CacheStrategy::new(strategy),
        }
    }

    async fn exist(&self, file: &str) -> bool {
        self.data.contains_key(file)
    }

    async fn get(&self, file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
        let idx = get_bucket_idx(file);
        let data = DATA[idx].get(file)?;
        Some(if let Some(range) = range {
            data.value().slice(range)
        } else {
            data.value().clone()
        })
    }

    async fn set(&mut self, trace_id: &str, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
        let data_size = file.len() + data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "[trace_id {trace_id}] File memory cache is full, can't cache extra {} bytes",
                data_size
            );
            // cache is full, need release some space
            let need_release_size = min(
                self.max_size,
                max(CONFIG.memory_cache.release_size, data_size * 100),
            );
            self.gc(trace_id, need_release_size).await?;
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

    async fn gc(&mut self, trace_id: &str, need_release_size: usize) -> Result<(), anyhow::Error> {
        log::info!(
            "[trace_id {trace_id}] File memory cache start gc {}/{}, need to release {} bytes",
            self.cur_size,
            self.max_size,
            need_release_size
        );
        let mut release_size = 0;
        loop {
            let item = self.data.remove();
            if item.is_none() {
                log::error!(
                    "[trace_id {trace_id}] File memory cache is corrupt, it shouldn't be none"
                );
                break;
            }
            let (key, data_size) = item.unwrap();
            // move the file from memory to disk cache
            let idx = get_bucket_idx(&key);
            if let Some((key, data)) = DATA[idx].remove(&key) {
                _ = super::disk::set(trace_id, &key, data).await;
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
        log::info!(
            "[trace_id {trace_id}] File memory cache gc done, released {} bytes",
            release_size
        );
        Ok(())
    }

    fn size(&self) -> (usize, usize) {
        (self.max_size, self.cur_size)
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

    tokio::task::spawn(async move {
        if CONFIG.memory_cache.gc_interval == 0 {
            return;
        }
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            config::CONFIG.memory_cache.gc_interval,
        ));
        interval.tick().await; // the first tick is immediate
        loop {
            if let Err(e) = gc().await {
                log::error!("memory cache gc error: {}", e);
            }
            interval.tick().await;
        }
    });
    Ok(())
}

#[inline]
pub async fn get(file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
    if !CONFIG.memory_cache.enabled {
        return None;
    }
    let idx = get_bucket_idx(file);
    let files = FILES[idx].read().await;
    files.get(file, range).await
}

#[inline]
pub async fn exist(file: &str) -> bool {
    if !CONFIG.memory_cache.enabled {
        return false;
    }
    let idx = get_bucket_idx(file);
    let files = FILES[idx].read().await;
    files.exist(file).await
}

#[inline]
pub async fn set(trace_id: &str, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !CONFIG.memory_cache.enabled {
        return Ok(());
    }
    let idx = get_bucket_idx(file);
    let mut files = FILES[idx].write().await;
    if files.exist(file).await {
        return Ok(());
    }
    files.set(trace_id, file, data).await
}

async fn gc() -> Result<(), anyhow::Error> {
    if !CONFIG.memory_cache.enabled {
        return Ok(());
    }

    for file in FILES.iter() {
        let r = file.read().await;
        if r.cur_size + CONFIG.memory_cache.release_size < r.max_size {
            drop(r);
            continue;
        }
        drop(r);
        let mut w = file.write().await;
        w.gc("global", CONFIG.memory_cache.gc_size).await?;
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
        let (max_size, cur_size) = r.size();
        total_size += max_size;
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

pub async fn download(trace_id: &str, file: &str) -> Result<(), anyhow::Error> {
    let data = storage::get(file).await?;
    if data.is_empty() {
        return Err(anyhow::anyhow!("file {} data size is zero", file));
    }
    if let Err(e) = set(trace_id, file, data).await {
        return Err(anyhow::anyhow!(
            "set file {} to memory cache failed: {}",
            file,
            e
        ));
    };
    Ok(())
}

fn get_bucket_idx(file: &str) -> usize {
    if CONFIG.memory_cache.bucket_num <= 1 {
        0
    } else {
        let h = gxhash::new().sum32(file);
        (h as usize) % CONFIG.memory_cache.bucket_num
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_lru_cache_set_file() {
        let trace_id = "session_123";
        let mut file_data = FileData::with_capacity_and_cache_strategy(1024, "lru");
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..100 {
            let file_key = format!(
                "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1_{}.parquet",
                i
            );
            let resp = file_data.set(trace_id, &file_key, content.clone()).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_lru_cache_get_file() {
        let trace_id = "session_123";
        let mut file_data =
            FileData::with_capacity_and_cache_strategy(CONFIG.memory_cache.max_size, "lru");
        let file_key = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_2_1.parquet";
        let content = Bytes::from("Some text");

        file_data
            .set(trace_id, file_key, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);

        file_data
            .set(trace_id, file_key, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key).await);
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_lru_cache_miss() {
        let trace_id = "session_456";
        let mut file_data = FileData::with_capacity_and_cache_strategy(100, "lru");
        let file_key1 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data
            .set(trace_id, file_key1, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key1, None).await.unwrap(), content);
        // set another key, will release first key
        file_data
            .set(trace_id, file_key2, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key2, None).await.unwrap(), content);
        // get first key, should get error
        assert!(file_data.get(file_key1, None).await.is_none());
    }

    #[tokio::test]
    async fn test_fifo_cache_set_file() {
        let trace_id = "session_123";
        let mut file_data = FileData::with_capacity_and_cache_strategy(1024, "fifo");
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..100 {
            let file_key = format!(
                "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1_{}.parquet",
                i
            );
            let resp = file_data.set(trace_id, &file_key, content.clone()).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_fifo_cache_get_file() {
        let trace_id = "session_123";
        let mut file_data =
            FileData::with_capacity_and_cache_strategy(CONFIG.memory_cache.max_size, "fifo");
        let file_key = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_2_1.parquet";
        let content = Bytes::from("Some text");

        file_data
            .set(trace_id, file_key, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);

        file_data
            .set(trace_id, file_key, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key).await);
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_fifo_cache_miss() {
        let trace_id = "session_456";
        let mut file_data = FileData::with_capacity_and_cache_strategy(100, "fifo");
        let file_key1 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data
            .set(trace_id, file_key1, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key1, None).await.unwrap(), content);
        // set another key, will release first key
        file_data
            .set(trace_id, file_key2, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key2, None).await.unwrap(), content);
        // get first key, should get error
        assert!(file_data.get(file_key1, None).await.is_none());
    }
}
