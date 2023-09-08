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
use lru::LruCache;
use once_cell::sync::Lazy;
use std::{cmp::max, path::Path, sync::RwLock};

use crate::common::{
    infra::{
        config::{is_local_disk_storage, CONFIG},
        metrics, storage,
    },
    utils::file::{get_file_meta, put_file_contents, scan_files},
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
            data: LruCache::unbounded(),
        }
    }

    pub fn load(&mut self) -> Result<(), anyhow::Error> {
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
            let meta = get_file_meta(&file)?;
            let data_size = meta.len() as usize;
            self.cur_size += data_size;
            self.data.put(file_key.clone(), data_size);
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

    pub fn exist(&mut self, file: &str) -> bool {
        self.data.get(file).is_some()
    }

    pub fn set(&mut self, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
        let data_size = data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "File disk cache is full {}/{}, can't cache {} bytes",
                self.cur_size,
                self.max_size,
                data_size
            );
            // cache is full, need release some space
            let need_release_size = max(CONFIG.disk_cache.release_size, data_size * 100);
            let mut release_size = 0;
            loop {
                let item = self.data.pop_lru();
                if item.is_none() {
                    break;
                }
                let (key, data_size) = item.unwrap();
                // delete file from local disk
                let file_path = format!("{}{}", self.root_dir, key);
                std::fs::remove_file(&file_path)?;
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
        self.data.put(file.to_string(), data_size);
        // write file into local disk
        let file_path = format!("{}{}", self.root_dir, file);
        std::fs::create_dir_all(Path::new(&file_path).parent().unwrap())?;
        put_file_contents(&file_path, &data)?;
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

    pub fn size(&self) -> (usize, usize) {
        (self.max_size, self.cur_size)
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub fn init() -> Result<(), anyhow::Error> {
    std::fs::create_dir_all(&CONFIG.common.data_cache_dir).expect("create cache dir success");
    let mut files = FILES.write().unwrap();
    files.load()?;
    Ok(())
}

#[inline]
pub fn exist(file: &str) -> bool {
    let mut files = FILES.write().unwrap();
    files.exist(file)
}

#[inline]
pub fn set(file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !CONFIG.disk_cache.enabled || is_local_disk_storage() {
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
pub fn len() -> usize {
    let files = FILES.read().unwrap();
    files.data.len()
}

#[inline]
pub async fn download(file: &str) -> Result<Bytes, anyhow::Error> {
    let data = storage::get(file).await?;
    if let Err(e) = set(file, data.clone()) {
        return Err(anyhow::anyhow!(
            "set file {} to disk cache failed: {}",
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
        assert!(file_data.exist(file_key));

        set(file_key, content.clone()).unwrap();
        assert!(exist(file_key));
    }

    #[test]
    fn test_cache_miss() {
        let mut file_data = FileData::with_capacity(100);
        let file_key1 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet";
        let file_key2 = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_2.parquet";
        let content = Bytes::from("Some text");
        // set one key
        file_data.set(file_key1, content.clone()).unwrap();
        assert!(file_data.exist(file_key1));
        // set another key, will release first key
        file_data.set(file_key2, content.clone()).unwrap();
        assert!(file_data.exist(file_key2));
        // get first key, should get error
        assert!(!file_data.exist(file_key1));
    }
}
