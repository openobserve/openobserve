// Copyright 2022 Zinc Labs Inc. and Contributors
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
use lru::LruCache;
use once_cell::sync::Lazy;
use std::cmp::max;
use std::sync::RwLock;

use crate::infra::config::CONFIG;
use crate::infra::metrics;
use crate::infra::storage;

static FILES: Lazy<RwLock<FileData>> = Lazy::new(|| RwLock::new(FileData::new()));

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    data: LruCache<String, Bytes>,
}

impl Default for FileData {
    fn default() -> Self {
        Self::new()
    }
}

impl FileData {
    pub fn new() -> FileData {
        FileData {
            max_size: CONFIG.memory_cache.max_size,
            cur_size: 0,
            data: LruCache::unbounded(),
        }
    }

    pub fn with_capacity(max_size: usize) -> FileData {
        FileData {
            max_size,
            cur_size: 0,
            data: LruCache::unbounded(),
        }
    }

    pub fn get(&mut self, file: &str) -> Result<Bytes, anyhow::Error> {
        let data = self.data.get(file);
        if data.is_none() {
            return Err(anyhow::anyhow!("file not in cache"));
        }
        Ok(data.unwrap().to_owned())
    }

    pub fn set(&mut self, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
        let data_size = file.len() + data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "File cache is full {}/{}, can't cache {} bytes",
                self.cur_size,
                self.max_size,
                data_size
            );
            // cache is full, need release some space
            let need_release_size = max(CONFIG.memory_cache.release_size, data_size * 100);
            let mut release_size = 0;
            loop {
                let item = self.data.pop_lru();
                if item.is_none() {
                    break;
                }
                let (key, val) = item.unwrap();
                // metrics
                let columns = key.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::QUERY_CACHE_FILES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .dec();
                    metrics::QUERY_CACHE_USED_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .sub(val.len() as i64);
                }
                release_size += key.len() + val.len();
                if release_size >= need_release_size {
                    break;
                }
            }
            self.cur_size -= release_size;
        }

        self.cur_size += data_size;
        self.data.put(file.to_string(), data);
        // metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_CACHE_FILES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc();
            metrics::QUERY_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .add(data_size as i64);
        }
        Ok(())
    }

    pub fn size(&self) -> (usize, usize) {
        (self.max_size, self.cur_size)
    }
}

#[inline]
pub fn get(file: &str) -> Result<Bytes, anyhow::Error> {
    if !CONFIG.memory_cache.enabled {
        return Err(anyhow::anyhow!("memory cache is disabled"));
    }
    let mut files = FILES.write().unwrap();
    files.get(file)
}

#[inline]
pub fn exist(file: &str) -> Result<bool, anyhow::Error> {
    let mut files = FILES.write().unwrap();
    match files.get(file) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[inline]
pub fn set(file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !CONFIG.memory_cache.enabled {
        return Ok(());
    }
    let mut files = FILES.write().unwrap();
    files.set(file, data)
}

#[inline]
pub fn stats() -> (usize, usize) {
    let files = FILES.read().unwrap();
    files.size()
}

#[inline]
pub async fn download(file: &str) -> Result<Bytes, anyhow::Error> {
    let data = storage::get(file).await?;
    if let Err(e) = set(file, data.clone()) {
        return Err(anyhow::anyhow!(
            "set file {} to memory cache failed: {}",
            file,
            e
        ));
    };
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_file_cache() {
        let mut file_data = FileData::with_capacity(1024);
        let content = Bytes::from("Some text Need to store in cache");
        for i in 0..100 {
            let file_key = format!(
                "files/default/logs/olympics/2022/10/03/10/6982652937134804993_{}.parquet",
                i
            );
            let resp = file_data.set(&file_key, content.clone());
            assert!(resp.is_ok());
        }
    }

    #[test]
    fn test_get_file_from_cache() {
        let mut file_data = FileData::default();
        let file_key = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet";
        let content = Bytes::from("Some text");

        file_data.set(file_key, content.clone()).unwrap();
        assert_eq!(file_data.get(file_key).unwrap(), content);

        set(file_key, content.clone()).unwrap();
        assert!(exist(file_key).unwrap());
        assert_eq!(get(file_key).unwrap(), content);
        assert!(stats().0 > 0);
    }
}
