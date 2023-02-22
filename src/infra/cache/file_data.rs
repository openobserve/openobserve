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
use std::cmp::max;
use std::sync::RwLock;

use crate::infra::config::CONFIG;
use crate::infra::storage;

lazy_static! {
    pub static ref FILES: RwLock<FileData> = RwLock::new(FileData::new());
}

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

    pub fn get(&mut self, file: &str) -> Result<Bytes, anyhow::Error> {
        let data = self.data.get(file);
        if data.is_none() {
            return Err(anyhow::anyhow!("file not in cache"));
        }
        Ok(data.unwrap().to_owned())
    }

    pub fn set(&mut self, file: &str, data: Bytes) -> Result<(), anyhow::Error> {
        let data_size = data.len();
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "[TRACE] File cache is full {}/{}, can't cache {} bytes",
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
                let (_, v) = item.unwrap();
                release_size += v.len();
                if release_size >= need_release_size {
                    break;
                }
            }
            self.cur_size -= release_size;
        }

        self.cur_size += data_size;
        self.data.put(file.to_string(), data);
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
#[tracing::instrument(name = "infra:cache:file_data:download")]
pub async fn download(file: &str) -> Result<Bytes, anyhow::Error> {
    let store = &storage::DEFAULT;
    let data = store.get(file).await?;
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
    fn test_get_file_from_cache() {
        let mut file_data = FileData::default();
        let file_key = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet";
        let content = Bytes::from("Some text");

        let resp = file_data.set(file_key, content.clone());
        assert!(resp.is_ok());

        let resp = file_data.get(file_key);
        assert_eq!(resp.unwrap(), content);

        let resp = set(file_key, content.clone());
        assert!(resp.is_ok());

        let resp = exist(file_key);
        assert_eq!(resp.unwrap(), true);

        let resp = get(file_key);
        assert_eq!(resp.unwrap(), content);

        let resp = stats();
        assert!(resp.0 > 0);
    }
}
