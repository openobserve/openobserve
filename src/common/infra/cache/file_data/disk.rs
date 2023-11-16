// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use bytes::Bytes;
use hashlink::lru_cache::LruCache;
use once_cell::sync::Lazy;
use std::{
    cmp::{max, min},
    path::Path,
};
use tokio::{fs, sync::RwLock};

use crate::common::{
    infra::{
        config::{is_local_disk_storage, CONFIG},
        metrics, storage,
    },
    utils::asynchronism::file::*,
    utils::file::scan_files,
};

static FILES: Lazy<RwLock<FileData>> = Lazy::new(|| RwLock::new(FileData::new()));

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    root_dir: String,
    data: LruCache<String, usize>,
}

impl Default for FileData {
    fn default() -> Self {
        Self::new()
    }
}

impl FileData {
    pub fn new() -> FileData {
        FileData::with_capacity(CONFIG.disk_cache.max_size)
    }

    pub fn with_capacity(max_size: usize) -> FileData {
        FileData {
            max_size,
            cur_size: 0,
            root_dir: CONFIG.common.data_cache_dir.to_string(),
            data: LruCache::new_unbounded(),
        }
    }

    async fn load(&mut self) -> Result<(), anyhow::Error> {
        let wal_dir = Path::new(&self.root_dir).canonicalize().unwrap();
        let files = scan_files(&self.root_dir);
        for file in files {
            let local_path = Path::new(&file).canonicalize().unwrap();
            let file_key = local_path
                .strip_prefix(&wal_dir)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            let meta = get_file_meta(&file).await?;
            let data_size = meta.len() as usize;
            self.cur_size += data_size;
            self.data.insert(file_key.clone(), data_size);
            // metrics
            let columns = file_key.split('/').collect::<Vec<&str>>();
            if columns[0] == "files" {
                metrics::QUERY_DISK_CACHE_FILES
                    .with_label_values(&[columns[1], columns[3], columns[2]])
                    .dec();
                metrics::QUERY_DISK_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[3], columns[2]])
                    .sub(data_size as i64);
            }
        }
        Ok(())
    }

    async fn exist(&mut self, file: &str) -> bool {
        self.data.get(file).is_some()
    }

    async fn set(
        &mut self,
        session_id: &str,
        file: &str,
        data: Bytes,
    ) -> Result<(), anyhow::Error> {
        let data_size = data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "[session_id {session_id}] File disk cache is full {}/{}, can't cache extra {} bytes",
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
                    log::error!("[session_id {session_id}] File disk cache is corrupt, it shouldn't be none");
                    break;
                }
                let (key, data_size) = item.unwrap();
                // delete file from local disk
                let file_path = format!("{}{}", self.root_dir, key);
                fs::remove_file(&file_path).await?;
                // metrics
                let columns = key.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::QUERY_DISK_CACHE_FILES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .dec();
                    metrics::QUERY_DISK_CACHE_USED_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .sub(data_size as i64);
                }
                release_size += data_size;
                if release_size >= need_release_size {
                    break;
                }
            }
            self.cur_size -= release_size;
        }

        self.cur_size += data_size;
        self.data.insert(file.to_string(), data_size);
        // write file into local disk
        let file_path = format!("{}{}", self.root_dir, file);
        fs::create_dir_all(Path::new(&file_path).parent().unwrap()).await?;
        put_file_contents(&file_path, &data).await?;
        // metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_DISK_CACHE_FILES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc();
            metrics::QUERY_DISK_CACHE_USED_BYTES
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
        self.len() == 0
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    std::fs::create_dir_all(&CONFIG.common.data_cache_dir).expect("create cache dir success");
    let mut files = FILES.write().await;
    files.load().await?;
    Ok(())
}

#[inline]
pub async fn exist(file: &str) -> bool {
    if !CONFIG.disk_cache.enabled {
        return false;
    }
    let mut files = FILES.write().await;
    files.exist(file).await
}

#[inline]
pub async fn set(session_id: &str, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !CONFIG.disk_cache.enabled || is_local_disk_storage() {
        return Ok(());
    }
    let mut files = FILES.write().await;
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
            "set file {} to disk cache failed: {}",
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
        assert!(file_data.exist(file_key).await);

        file_data
            .set(session_id, file_key, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key).await);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let session_id = "session_456";
        let mut file_data = FileData::with_capacity(10);
        let file_key1 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data
            .set(session_id, file_key1, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key1).await);
        // set another key, will release first key
        file_data
            .set(session_id, file_key2, content.clone())
            .await
            .unwrap();
        assert!(file_data.exist(file_key2).await);
        // get first key, should get error
        assert!(!file_data.exist(file_key1).await);
    }
}
