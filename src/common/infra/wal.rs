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

use std::{path::Path, sync::Arc};

use arrow::{ipc::writer::StreamWriter, record_batch::RecordBatch};
use arrow_schema::Schema;
use chrono::{DateTime, Datelike, TimeZone, Utc};
use config::{
    ider,
    meta::stream::{PartitionTimeLevel, StreamType},
    metrics,
    utils::asynchronism::file::get_file_contents,
    CONFIG, FILE_EXT_ARROW, FILE_EXT_JSON,
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use tokio::{
    fs::{create_dir_all, File, OpenOptions},
    io::AsyncWriteExt,
    sync::RwLock,
};

use crate::common::meta::stream::StreamParams;

type RwData = RwLock<HashMap<String, Arc<RwFile>>>;

// MANAGER for manage using WAL files, in use, should not move to s3
static MANAGER: Lazy<Manager> = Lazy::new(Manager::new);

// SEARCHING_FILES for searching files, in use, should not move to s3
static SEARCHING_FILES: Lazy<tokio::sync::RwLock<SearchingFileLocker>> =
    Lazy::new(|| tokio::sync::RwLock::new(SearchingFileLocker::new()));

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
        self.inner.get(file).is_some()
    }
}

struct Manager {
    data: Arc<Vec<RwData>>,
}

pub struct RwFile {
    file: Option<RwLock<File>>,
    arrow_file: Option<RwLock<StreamWriter<std::fs::File>>>,
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    dir: String,
    name: String,
    expired: i64,
    use_arrow: bool,
}

pub async fn init() -> Result<(), anyhow::Error> {
    _ = MANAGER.data.len();
    _ = SEARCHING_FILES.read().await.len();
    Ok(())
}

pub async fn get_or_create(
    thread_id: usize,
    stream: StreamParams,
    partition_time_level: Option<PartitionTimeLevel>,
    key: &str,
) -> Arc<RwFile> {
    MANAGER
        .get_or_create(thread_id, stream, partition_time_level, key, None)
        .await
}

pub async fn get_or_create_arrow(
    thread_id: usize,
    stream: StreamParams,
    partition_time_level: Option<PartitionTimeLevel>,
    key: &str,
    schema: Option<Schema>,
) -> Arc<RwFile> {
    MANAGER
        .get_or_create(thread_id, stream, partition_time_level, key, schema)
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
        let size = CONFIG.limit.cpu_num;
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
        let file = match manager.get(&full_key) {
            Some(file) => file.clone(),
            None => {
                return None;
            }
        };
        drop(manager);

        // check size & ttl
        if file.size().await >= (CONFIG.limit.max_file_size_on_disk as i64)
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
        schema: Option<Schema>,
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
        let file =
            Arc::new(RwFile::new(thread_id, stream, partition_time_level, key, schema).await);
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
        schema: Option<Schema>,
    ) -> Arc<RwFile> {
        if let Some(file) = self.get(thread_id, stream.clone(), key).await {
            file
        } else {
            self.create(thread_id, stream, partition_time_level, key, schema)
                .await
        }
    }

    pub async fn check_in_use(&self, stream: StreamParams, file_name: &str) -> bool {
        let columns = file_name.split('/').collect::<Vec<&str>>();
        let thread_id: usize = columns
            .first()
            .unwrap()
            .parse()
            .unwrap_or_else(|_| panic!("need a thread id, but the file is: {file_name}"));
        let key = columns[1..columns.len() - 1].join("/");
        if let Some(file) = self.get(thread_id, stream, &key).await {
            if file.name() == file_name {
                return true;
            }
        }
        false
    }
}

impl RwFile {
    async fn new(
        thread_id: usize,
        stream: StreamParams,
        partition_time_level: Option<PartitionTimeLevel>,
        key: &str,
        schema: Option<Schema>,
    ) -> RwFile {
        let use_arrow = schema.is_some();

        let mut dir_path = if use_arrow {
            format!(
                "{}files/{}/{}/{}/",
                &CONFIG.common.data_idx_dir, stream.org_id, stream.stream_type, stream.stream_name
            )
        } else {
            format!(
                "{}files/{}/{}/{}/",
                &CONFIG.common.data_wal_dir, stream.org_id, stream.stream_type, stream.stream_name
            )
        };
        // Hack for file_list
        let file_list_prefix = "/files//file_list//";
        if dir_path.contains(file_list_prefix) {
            dir_path = dir_path.replace(file_list_prefix, "/file_list/");
        }
        let id = ider::generate();
        let file_name = if use_arrow {
            format!("{thread_id}/{key}/{id}{}", FILE_EXT_ARROW)
        } else {
            format!("{thread_id}/{key}/{id}{}", FILE_EXT_JSON)
        };
        let file_path = format!("{dir_path}{file_name}");
        create_dir_all(Path::new(&file_path).parent().unwrap())
            .await
            .unwrap();

        let (file, arrow_file) = if use_arrow {
            let file_path = format!("{dir_path}{file_name}");
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(file_path)
                .unwrap();
            let writer = StreamWriter::try_new(file, &schema.unwrap()).unwrap();

            (None, Some(RwLock::new(writer)))
        } else {
            let f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file_path)
                .await
                .unwrap_or_else(|e| panic!("open wal file [{file_path}] error: {e}"));
            (Some(RwLock::new(f)), None)
        };

        let time_now: DateTime<Utc> = Utc::now();
        let level_duration = partition_time_level.unwrap_or_default().duration();
        let ttl = if !CONFIG.limit.ignore_file_retention_by_stream && level_duration > 0 {
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
                time_end_day + CONFIG.limit.max_file_retention_time as i64
            } else {
                expired
            }
        } else {
            time_now.timestamp() + CONFIG.limit.max_file_retention_time as i64
        };

        RwFile {
            file,
            arrow_file,
            org_id: stream.org_id.to_string(),
            stream_name: stream.stream_name.to_string(),
            stream_type: stream.stream_type,
            dir: dir_path,
            name: file_name,
            expired: ttl,
            use_arrow,
        }
    }

    #[inline]
    pub async fn write(&self, data: &[u8]) {
        // metrics
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[&self.org_id, self.stream_type.to_string().as_str()])
            .add(data.len() as i64);
        metrics::INGEST_WAL_WRITE_BYTES
            .with_label_values(&[&self.org_id, self.stream_type.to_string().as_str()])
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
    pub async fn write_arrow(&self, data: RecordBatch) {
        self.arrow_file
            .as_ref()
            .unwrap()
            .write()
            .await
            .write(&data)
            .unwrap()
    }

    #[inline]
    pub async fn read(&self) -> Result<Vec<u8>, std::io::Error> {
        get_file_contents(&self.full_name()).await
    }

    #[inline]
    pub async fn sync(&self) {
        if let Some(file) = self.file.as_ref() {
            file.write().await.sync_all().await.unwrap();
        } else if let Some(arrow_file) = self.arrow_file.as_ref() {
            arrow_file.write().await.finish().unwrap();
        } else {
            log::info!("Unable to sync file: {}", self.name)
        }
    }

    #[inline]
    pub async fn size(&self) -> i64 {
        if self.use_arrow {
            self.arrow_file
                .as_ref()
                .unwrap()
                .read()
                .await
                .get_ref()
                .metadata()
                .unwrap()
                .len() as i64
        } else {
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

pub async fn lock_files(files: &[String]) {
    let mut locker = SEARCHING_FILES.write().await;
    for file in files.iter() {
        locker.lock(file.clone());
    }
}

pub async fn release_files(files: &[String]) {
    let mut locker = SEARCHING_FILES.write().await;
    for file in files.iter() {
        locker.release(file);
    }
    locker.shrink_to_fit();
}

pub async fn lock_files_exists(file: &str) -> bool {
    SEARCHING_FILES.read().await.exist(file)
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
        let key = "test_key";
        let file = get_or_create(thread_id, stream, None, key).await;
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        assert_eq!(file.read().await.unwrap(), data);
        assert_eq!(file.size().await, data.len() as i64);
        assert!(file.name().contains(&format!("{}/{}", thread_id, key)));
    }

    #[tokio::test]
    async fn test_wal_rw_file() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let stream = StreamParams::new(org_id, stream_name, stream_type);
        let key = "test_key";
        let file = RwFile::new(thread_id, stream, None, key, None).await;
        let data = "test_data".to_string().into_bytes();
        file.write(&data).await;
        assert_eq!(file.read().await.unwrap(), data);
        assert_eq!(file.size().await, data.len() as i64);
        assert!(file.name().contains(&format!("{}/{}", thread_id, key)));
    }
}
