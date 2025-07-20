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

use std::{path::Path, sync::Arc};

use chrono::{DateTime, Datelike, TimeZone, Utc};
use config::{
    FILE_EXT_JSON, get_config, ider,
    meta::stream::{PartitionTimeLevel, StreamParams, StreamType},
    metrics,
    utils::async_file::get_file_contents,
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use tokio::{
    fs::{File, OpenOptions, create_dir_all},
    io::AsyncWriteExt,
    sync::RwLock,
};

// MANAGER for manage using WAL files, in use, should not move to s3
static MANAGER: Lazy<Manager> = Lazy::new(Manager::new);

// SEARCHING_FILES for searching files, in use, should not move to s3
static SEARCHING_FILES: Lazy<parking_lot::RwLock<SearchingFileLocker>> =
    Lazy::new(|| parking_lot::RwLock::new(SearchingFileLocker::new()));

// SEARCHING_REQUESTS for searching requests, in use, should not move to s3
static SEARCHING_REQUESTS: Lazy<parking_lot::RwLock<HashMap<String, Vec<String>>>> =
    Lazy::new(Default::default);

type RwData = RwLock<HashMap<String, Arc<RwFile>>>;

struct SearchingFileLocker {
    inner: HashMap<String, usize>,
}

impl SearchingFileLocker {
    pub fn new() -> Self {
        Self {
            inner: Default::default(),
        }
    }

    pub fn lock(&mut self, file: String) {
        let entry = self.inner.entry(file).or_insert(0);
        *entry += 1;
    }

    pub fn release(&mut self, file: &str) {
        if let Some(entry) = self.inner.get_mut(file) {
            *entry -= 1;
            if *entry == 0 {
                self.inner.remove(file);
            }
        }
    }

    pub fn shrink_to_fit(&mut self) {
        self.inner.shrink_to_fit()
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn exist(&self, file: &str) -> bool {
        self.inner.contains_key(file)
    }

    pub fn clean(&mut self) {
        self.inner.clear();
        self.inner.shrink_to_fit();
    }
}

struct Manager {
    data: Arc<Vec<RwData>>,
}

pub struct RwFile {
    file: Option<RwLock<File>>,
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    dir: String,
    name: String,
    expired: i64,
}

pub fn init() -> Result<(), anyhow::Error> {
    _ = MANAGER.data.len();
    _ = SEARCHING_FILES.read().len();
    Ok(())
}

pub async fn get_or_create(
    thread_id: usize,
    stream: StreamParams,
    partition_time_level: Option<PartitionTimeLevel>,
    key: &str,
) -> Arc<RwFile> {
    MANAGER
        .get_or_create(thread_id, stream, partition_time_level, key)
        .await
}

pub async fn check_in_use(stream: StreamParams, file_name: &str) -> bool {
    MANAGER.check_in_use(stream, file_name).await
}

pub async fn flush_all_to_disk() {
    for data in MANAGER.data.iter() {
        for (_, file) in data.read().await.iter() {
            file.sync().await;
        }
    }
}

impl Default for Manager {
    fn default() -> Self {
        Self::new()
    }
}

impl Manager {
    pub fn new() -> Manager {
        let size = get_config().limit.cpu_num;
        let mut data = Vec::with_capacity(size);
        for _ in 0..size {
            data.push(RwLock::new(HashMap::<String, Arc<RwFile>>::default()));
        }
        Self {
            data: Arc::new(data),
        }
    }

    pub async fn get(
        &self,
        thread_id: usize,
        stream: StreamParams,
        key: &str,
    ) -> Option<Arc<RwFile>> {
        let full_key = format!(
            "{}/{}/{}/{key}",
            stream.org_id, stream.stream_type, stream.stream_name
        );
        let locker = self.data.get(thread_id)?;
        let manager = locker.read().await;
        let file = manager.get(&full_key)?.clone();

        drop(manager);

        // check size & ttl
        if file.size().await >= (get_config().limit.max_file_size_on_disk as i64)
            || file.expired() <= Utc::now().timestamp()
        {
            let mut manager = locker.write().await;
            manager.remove(&full_key);
            manager.shrink_to_fit();
            file.sync().await;
            return None;
        }

        Some(file)
    }

    pub async fn create(
        &self,
        thread_id: usize,
        stream: StreamParams,
        partition_time_level: Option<PartitionTimeLevel>,
        key: &str,
    ) -> Arc<RwFile> {
        let stream_type = stream.stream_type;
        let full_key = format!(
            "{}/{}/{}/{key}",
            stream.org_id, stream.stream_type, stream.stream_name
        );
        let mut data = self.data.get(thread_id).unwrap().write().await;
        if let Some(f) = data.get(&full_key) {
            return f.clone();
        }
        let file = Arc::new(RwFile::new(thread_id, stream, partition_time_level, key).await);
        if !stream_type.eq(&StreamType::EnrichmentTables) {
            data.insert(full_key, file.clone());
        };
        file
    }

    pub async fn get_or_create(
        &self,
        thread_id: usize,
        stream: StreamParams,
        partition_time_level: Option<PartitionTimeLevel>,
        key: &str,
    ) -> Arc<RwFile> {
        if let Some(file) = self.get(thread_id, stream.clone(), key).await {
            file
        } else {
            self.create(thread_id, stream, partition_time_level, key)
                .await
        }
    }

    pub async fn check_in_use(&self, stream: StreamParams, file_name: &str) -> bool {
        let mut columns = file_name.split('/');
        let thread_id: usize = columns
            .next()
            .unwrap()
            .parse()
            .unwrap_or_else(|_| panic!("need a thread id, but the file is: {file_name}"));
        // Remove the last element which is the file name
        // and join the rest to form the key
        columns.next_back();
        let key = itertools::Itertools::join(&mut columns, "/");
        self.get(thread_id, stream, &key)
            .await
            .is_some_and(|file| file.name() == file_name)
    }
}

impl RwFile {
    async fn new(
        thread_id: usize,
        stream: StreamParams,
        partition_time_level: Option<PartitionTimeLevel>,
        key: &str,
    ) -> RwFile {
        let cfg = get_config();
        let mut dir_path = format!(
            "{}files/{}/{}/{}/",
            &cfg.common.data_wal_dir, stream.org_id, stream.stream_type, stream.stream_name
        );
        // Hack for file_list
        let file_list_prefix = "/files//file_list//";
        if dir_path.contains(file_list_prefix) {
            dir_path = dir_path.replace(file_list_prefix, "/file_list/");
        }
        let id = ider::generate();
        let file_name = format!("{thread_id}/{key}/{id}{FILE_EXT_JSON}");
        let file_path = format!("{dir_path}{file_name}");
        create_dir_all(Path::new(&file_path).parent().unwrap())
            .await
            .unwrap();

        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .unwrap_or_else(|e| panic!("open wal file [{file_path}] error: {e}"));
        let file = Some(RwLock::new(f));

        let time_now: DateTime<Utc> = Utc::now();
        let level_duration = partition_time_level.unwrap_or_default().duration();
        let ttl = if !cfg.limit.ignore_file_retention_by_stream && level_duration > 0 {
            let time_end_day = Utc
                .with_ymd_and_hms(
                    time_now.year(),
                    time_now.month(),
                    time_now.day(),
                    23,
                    59,
                    59,
                )
                .unwrap()
                .timestamp();
            let expired = time_now.timestamp() + level_duration;
            if expired > time_end_day {
                // if the file expired time is tomorrow, it should be deleted at 23:59:59 +
                // 10min
                time_end_day + cfg.limit.max_file_retention_time as i64
            } else {
                expired
            }
        } else {
            time_now.timestamp() + cfg.limit.max_file_retention_time as i64
        };

        RwFile {
            file,
            org_id: stream.org_id.to_string(),
            stream_name: stream.stream_name.to_string(),
            stream_type: stream.stream_type,
            dir: dir_path,
            name: file_name,
            expired: ttl,
        }
    }

    #[inline]
    pub async fn write(&self, data: &[u8]) {
        // metrics
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[&self.org_id, self.stream_type.as_str()])
            .add(data.len() as i64);
        metrics::INGEST_WAL_WRITE_BYTES
            .with_label_values(&[&self.org_id, self.stream_type.as_str()])
            .inc_by(data.len() as u64);

        self.file
            .as_ref()
            .unwrap()
            .write()
            .await
            .write_all(data)
            .await
            .unwrap();
    }

    #[inline]
    pub async fn read(&self) -> Result<Vec<u8>, std::io::Error> {
        get_file_contents(&self.full_name(), None).await
    }

    #[inline]
    pub async fn sync(&self) {
        self.file
            .as_ref()
            .unwrap()
            .write()
            .await
            .sync_all()
            .await
            .unwrap()
    }

    #[inline]
    pub async fn size(&self) -> i64 {
        self.file
            .as_ref()
            .unwrap()
            .read()
            .await
            .metadata()
            .await
            .unwrap()
            .len() as i64
    }

    #[inline]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[inline]
    pub fn wal_name(&self) -> String {
        format!(
            "files/{}/{}/{}/{}",
            self.org_id, self.stream_type, self.stream_name, self.name
        )
    }

    #[inline]
    pub fn full_name(&self) -> String {
        format!("{}{}", self.dir, self.name)
    }

    #[inline]
    pub fn expired(&self) -> i64 {
        self.expired
    }
}

pub fn lock_files(files: &[String]) {
    let mut locker = SEARCHING_FILES.write();
    for file in files.iter() {
        locker.lock(file.clone());
    }
}

pub fn release_files(files: &[String]) {
    let mut locker = SEARCHING_FILES.write();
    for file in files.iter() {
        locker.release(file);
    }
    locker.shrink_to_fit();
}

pub fn lock_files_exists(file: &str) -> bool {
    SEARCHING_FILES.read().exist(file)
}

pub fn clean_lock_files() {
    let mut locker = SEARCHING_FILES.write();
    locker.clean();
}

pub fn lock_request(trace_id: &str, files: &[String]) {
    log::info!("[trace_id: {trace_id}] lock_request for wal files");
    let mut locker = SEARCHING_REQUESTS.write();
    locker.insert(trace_id.to_string(), files.to_vec());
}

pub fn release_request(trace_id: &str) {
    if !config::cluster::LOCAL_NODE.is_ingester() {
        return;
    }
    log::info!("[trace_id: {trace_id}] release_request for wal files");
    let mut locker = SEARCHING_REQUESTS.write();
    let files = locker.remove(trace_id);
    locker.shrink_to_fit();
    drop(locker);
    if let Some(files) = files {
        release_files(&files);
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    #[tokio::test]
    async fn test_wal_manager() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key1";
        let file = get_or_create(thread_id, stream, None, key).await;
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        assert_eq!(file.read().await.unwrap(), data);
        assert_eq!(file.size().await, data.len() as i64);
        assert!(file.name().contains(&format!("{thread_id}/{key}")));
    }

    #[tokio::test]
    async fn test_wal_rw_file() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key2";
        let file = RwFile::new(thread_id, stream, None, key).await;
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        assert_eq!(file.read().await.unwrap(), data);
        assert_eq!(file.size().await, data.len() as i64);
        assert!(file.name().contains(&format!("{thread_id}/{key}")));
    }

    #[tokio::test]
    async fn test_wal_file_locking() {
        let files = vec![
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key1.json".to_string(),
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key2.json".to_string(),
        ];

        // Test locking files
        lock_files(&files);
        assert!(lock_files_exists(&files[0]));
        assert!(lock_files_exists(&files[1]));

        // Test releasing files
        release_files(&files);
        assert!(!lock_files_exists(&files[0]));
        assert!(!lock_files_exists(&files[1]));
    }

    #[tokio::test]
    async fn test_wal_request_locking() {
        let trace_id = "test_trace_1234";
        let files = vec![
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key3.json".to_string(),
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key4.json".to_string(),
        ];

        // Test locking request
        lock_files(&files);
        lock_request(trace_id, &files);
        assert!(lock_files_exists(&files[0]));
        assert!(lock_files_exists(&files[1]));

        // Test releasing request
        release_request(trace_id);
        assert!(!lock_files_exists(&files[0]));
        assert!(!lock_files_exists(&files[1]));
    }

    #[tokio::test]
    async fn test_wal_file_expiration() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key5";

        // Create a file with short retention time
        let file = get_or_create(thread_id, stream.clone(), None, key).await;
        let initial_expired = file.expired();

        // Wait a bit and check if file is still accessible
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let file_after = get_or_create(thread_id, stream.clone(), None, key).await;
        assert_eq!(file_after.expired(), initial_expired);
    }

    #[tokio::test]
    async fn test_wal_manager_operations() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key6";

        // Test get_or_create
        let file1 = get_or_create(thread_id, stream.clone(), None, key).await;
        let file2 = get_or_create(thread_id, stream.clone(), None, key).await;
        assert_eq!(file1.name(), file2.name());

        // Test check_in_use
        assert!(check_in_use(stream.clone(), file1.name()).await);
        assert!(!check_in_use(stream.clone(), "1/2025/06/06/01/md5/test_key.json").await);
    }

    #[tokio::test]
    async fn test_wal_file_size_limits() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key7";

        let file = get_or_create(thread_id, stream.clone(), None, key).await;

        // Write some data
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        file.sync().await;

        // Check size
        assert_eq!(file.size().await, data.len() as i64);

        // Sync to disk
        file.sync().await;
    }

    #[tokio::test]
    async fn test_wal_file_operations() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key8";

        let file = RwFile::new(thread_id, stream, None, key).await;

        // Test write and read
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        assert_eq!(file.read().await.unwrap(), data);

        // Test file names
        assert!(file.name().contains(&format!("{thread_id}/{key}")));
        assert!(file.wal_name().contains(&format!("{thread_id}/{key}")));
        assert!(file.full_name().contains(&format!("{thread_id}/{key}")));
    }
}
