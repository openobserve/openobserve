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
    path::Path,
};

use bytes::Bytes;
use config::{
    is_local_disk_storage, metrics,
    utils::{asynchronism::file::*, file::scan_files},
    CONFIG,
};
use once_cell::sync::Lazy;
use tokio::{fs, sync::RwLock};

use super::CacheStrategy;
use crate::storage;

static FILES: Lazy<RwLock<FileData>> = Lazy::new(|| RwLock::new(FileData::new()));

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    root_dir: String,
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
            CONFIG.disk_cache.max_size,
            &CONFIG.disk_cache.cache_strategy,
        )
    }

    pub fn with_capacity_and_cache_strategy(max_size: usize, strategy: &str) -> FileData {
        FileData {
            max_size,
            cur_size: 0,
            root_dir: format!(
                "{}{}",
                CONFIG.common.data_cache_dir,
                storage::format_key("")
            ),
            data: CacheStrategy::new(strategy),
        }
    }

    async fn load(&mut self) -> Result<(), anyhow::Error> {
        log::info!("Loading disk cache start");
        std::fs::create_dir_all(&self.root_dir).expect("create cache dir success");
        let wal_dir = Path::new(&self.root_dir).canonicalize().unwrap();
        let files = scan_files(&self.root_dir, "parquet").await;
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
                    .with_label_values(&[columns[1], columns[2]])
                    .dec();
                metrics::QUERY_DISK_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2]])
                    .sub(data_size as i64);
            }
        }
        log::info!("Loading disk cache done");
        Ok(())
    }

    async fn exist(&mut self, file: &str) -> bool {
        self.data.contains_key(file)
    }

    async fn get(&self, file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
        let file_path = format!("{}{}", self.root_dir, file);
        let data = match get_file_contents(&file_path).await {
            Ok(data) => Bytes::from(data),
            Err(_) => {
                return None;
            }
        };
        Some(if let Some(range) = range {
            data.slice(range)
        } else {
            data
        })
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
                "[session_id {session_id}] File disk cache is full, can't cache extra {} bytes",
                data_size
            );
            // cache is full, need release some space
            let need_release_size = min(
                CONFIG.disk_cache.max_size,
                max(CONFIG.disk_cache.release_size, data_size * 100),
            );
            self.gc(session_id, need_release_size).await?;
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
                .with_label_values(&[columns[1], columns[2]])
                .inc();
            metrics::QUERY_DISK_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2]])
                .add(data_size as i64);
        }
        Ok(())
    }

    async fn gc(
        &mut self,
        session_id: &str,
        need_release_size: usize,
    ) -> Result<(), anyhow::Error> {
        log::info!(
            "[session_id {session_id}] File disk cache start gc {}/{}, need to release {} bytes",
            self.cur_size,
            self.max_size,
            need_release_size
        );
        let mut release_size = 0;
        loop {
            let item = self.data.remove();
            if item.is_none() {
                log::error!(
                    "[session_id {session_id}] File disk cache is corrupt, it shouldn't be none"
                );
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
                    .with_label_values(&[columns[1], columns[2]])
                    .dec();
                metrics::QUERY_DISK_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2]])
                    .sub(data_size as i64);
            }
            release_size += data_size;
            if release_size >= need_release_size {
                break;
            }
        }
        self.cur_size -= release_size;
        log::info!(
            "[session_id {session_id}] File disk cache gc done, released {} bytes",
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
        self.len() == 0
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    std::fs::create_dir_all(&CONFIG.common.data_cache_dir).expect("create cache dir success");
    let mut files = FILES.write().await;
    files.load().await?;

    tokio::task::spawn(async move {
        if CONFIG.disk_cache.gc_interval == 0 {
            return;
        }
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            config::CONFIG.disk_cache.gc_interval,
        ));
        interval.tick().await; // the first tick is immediate
        loop {
            if let Err(e) = gc().await {
                log::error!("disk cache gc error: {}", e);
            }
            interval.tick().await;
        }
    });
    Ok(())
}

#[inline]
pub async fn get(file: &str, range: Option<Range<usize>>) -> Option<Bytes> {
    if !CONFIG.disk_cache.enabled {
        return None;
    }
    let files = FILES.read().await;
    files.get(file, range).await
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
    if files.exist(file).await {
        return Ok(());
    }
    files.set(session_id, file, data).await
}

async fn gc() -> Result<(), anyhow::Error> {
    if !CONFIG.disk_cache.enabled || is_local_disk_storage() {
        return Ok(());
    }
    let files = FILES.read().await;
    if files.cur_size + CONFIG.disk_cache.release_size < files.max_size {
        drop(files);
        return Ok(());
    }
    drop(files);
    let mut files = FILES.write().await;
    files.gc("global", CONFIG.disk_cache.gc_size).await?;
    drop(files);
    Ok(())
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
    if data.is_empty() {
        return Err(anyhow::anyhow!("file {} data size is zero", file));
    }
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
    async fn test_lru_cache_set_file() {
        let session_id = "session_123";
        let mut file_data = FileData::with_capacity_and_cache_strategy(1024, "lru");
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
    async fn test_lru_cache_get_file() {
        let session_id = "session_123";
        let mut file_data =
            FileData::with_capacity_and_cache_strategy(CONFIG.disk_cache.max_size, "lru");
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
    async fn test_lru_cache_miss() {
        let session_id = "session_456";
        let mut file_data = FileData::with_capacity_and_cache_strategy(10, "lru");
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

    #[tokio::test]
    async fn test_fifo_cache_set_file() {
        let session_id = "session_123";
        let mut file_data = FileData::with_capacity_and_cache_strategy(1024, "fifo");
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
    async fn test_fifo_cache_get_file() {
        let session_id = "session_123";
        let mut file_data =
            FileData::with_capacity_and_cache_strategy(CONFIG.disk_cache.max_size, "fifo");
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
    async fn test_fifo_cache_miss() {
        let session_id = "session_456";
        let mut file_data = FileData::with_capacity_and_cache_strategy(10, "fifo");
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
