// Copyright 2023 Zinc Labs Inc.
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
use config::{RwHashMap, CONFIG};
use hashlink::lru_cache::LruCache;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use crate::common::infra::{metrics, storage};

static FILES: Lazy<RwLock<FileData>> = Lazy::new(|| RwLock::new(FileData::new()));
static DATA: Lazy<RwHashMap<String, Bytes>> = Lazy::new(Default::default);

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    data: LruCache<String, usize>,
}

impl Default for FileData {
    fn default() -> Self {
        Self::new()
    }
}

impl FileData {
    pub fn new() -> FileData {
        FileData::with_capacity(CONFIG.memory_cache.max_size)
    }

    pub fn with_capacity(max_size: usize) -> FileData {
        FileData {
            max_size,
            cur_size: 0,
            data: LruCache::new_unbounded(),
        }
    }

    async fn exist(&mut self, file: &str) -> bool {
        self.data.contains_key(file)
    }

    async fn get(&self, file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
        let data = DATA.get(file)?;
        Some(if let Some(range) = range {
            data.value().slice(range)
        } else {
            data.value().clone()
        })
    }

    async fn set(
        &mut self,
        session_id: &str,
        file: &str,
        data: Bytes,
    ) -> Result<(), anyhow::Error> {
        let data_size = file.len() + data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "[session_id {session_id}] File memory cache is full {}/{}, can't cache extra {} bytes",
                self.cur_size,
                self.max_size,
                data_size
            );
            // cache is full, need release some space
            let need_release_size = min(
                CONFIG.disk_cache.max_size,
                max(CONFIG.disk_cache.release_size, data_size * 100),
            );
            let mut release_size = 0;
            loop {
                let item = self.data.remove_lru();
                if item.is_none() {
                    log::error!(
                        "[session_id {session_id}] File memory cache is corrupt, it shouldn't be none"
                    );
                    break;
                }
                let (key, data_size) = item.unwrap();
                // remove file from data cache
                DATA.remove(&key);
                // metrics
                let columns = key.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::QUERY_MEMORY_CACHE_FILES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .dec();
                    metrics::QUERY_MEMORY_CACHE_USED_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .sub(data_size as i64);
                }
                release_size += data_size;
                if release_size >= need_release_size {
                    break;
                }
            }
            self.cur_size -= release_size;
            DATA.shrink_to_fit();
        }

        self.cur_size += data_size;
        self.data.insert(file.to_string(), data_size);
        // write file into cache
        DATA.insert(file.to_string(), data);
        // metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_MEMORY_CACHE_FILES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc();
            metrics::QUERY_MEMORY_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .add(data_size as i64);
        }
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
    let files = FILES.read().await;
    _ = files.get("", None).await;
    Ok(())
}

#[inline]
pub async fn get(file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
    if !CONFIG.memory_cache.enabled {
        return None;
    }
    let files = FILES.read().await;
    files.get(file, range).await
}

#[inline]
pub async fn exist(file: &str) -> bool {
    if !CONFIG.memory_cache.enabled {
        return false;
    }
    let mut files = FILES.write().await;
    files.exist(file).await
}

#[inline]
pub async fn set(session_id: &str, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !CONFIG.memory_cache.enabled {
        return Ok(());
    }
    let mut files = FILES.write().await;
    if files.exist(file).await {
        return Ok(());
    }
    files.set(session_id, file, data).await
}

#[inline]
pub async fn stats() -> (usize, usize) {
    let files = FILES.read().await;
    files.size()
}

#[inline]
pub async fn len() -> usize {
    let files = FILES.read().await;
    files.len()
}

#[inline]
pub async fn is_empty() -> bool {
    let files = FILES.read().await;
    files.is_empty()
}

pub async fn download(session_id: &str, file: &str) -> Result<(), anyhow::Error> {
    let data = storage::get(file).await?;
    if let Err(e) = set(session_id, file, data).await {
        return Err(anyhow::anyhow!(
            "set file {} to memory cache failed: {}",
            file,
            e
        ));
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cache_set_file() {
        let session_id = "session_123";
        let mut file_data = FileData::with_capacity(1024);
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..100 {
            let file_key = format!(
                "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1_{}.parquet",
                i
            );
            let resp = file_data.set(session_id, &file_key, content.clone()).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_cache_get_file() {
        let session_id = "session_123";
        let mut file_data = FileData::default();
        let file_key = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_2_1.parquet";
        let content = Bytes::from("Some text");

        file_data
            .set(session_id, file_key, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);

        file_data
            .set(session_id, file_key, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key).await);
        assert_eq!(file_data.get(file_key, None).await.unwrap(), content);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let session_id = "session_456";
        let mut file_data = FileData::with_capacity(100);
        let file_key1 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data
            .set(session_id, file_key1, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key1, None).await.unwrap(), content);
        // set another key, will release first key
        file_data
            .set(session_id, file_key2, content.clone())
            .await
            .unwrap();
        assert_eq!(file_data.get(file_key2, None).await.unwrap(), content);
        // get first key, should get error
        assert!(file_data.get(file_key1, None).await.is_none());
    }
}
