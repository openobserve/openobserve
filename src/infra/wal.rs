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

use ahash::AHashMap as HashMap;
use bytes::{Bytes, BytesMut};
use once_cell::sync::Lazy;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::{Arc, RwLock},
};

use crate::common::file::get_file_contents;
use crate::infra::{config::CONFIG, ider, metrics};
use crate::meta::StreamType;

// MANAGER for manage using WAL files, in use, should not move to s3
static MANAGER: Lazy<Manager> = Lazy::new(Manager::new);

// MEMORY_FILES for in-memory mode WAL files, already not in use, should move to s3
pub static MEMORY_FILES: Lazy<MemoryFiles> = Lazy::new(MemoryFiles::new);

type RwData = RwLock<HashMap<String, Arc<RwFile>>>;

struct Manager {
    data: Arc<Vec<RwData>>,
}

pub struct MemoryFiles {
    pub data: Arc<RwLock<HashMap<String, Bytes>>>,
}

pub struct RwFile {
    use_cache: bool,
    file: Option<RwLock<File>>,
    cache: Option<RwLock<BytesMut>>,
    org_id: String,
    stream_name: String,
    stream_type: StreamType,
    dir: String,
    name: String,
    expired: i64,
}

pub fn get_or_create(
    thread_id: usize,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    key: &str,
    use_cache: bool,
) -> Arc<RwFile> {
    MANAGER.get_or_create(thread_id, org_id, stream_name, stream_type, key, use_cache)
}

pub fn check_in_use(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    file_name: &str,
) -> bool {
    MANAGER.check_in_use(org_id, stream_name, stream_type, file_name)
}

pub fn get_search_in_memory_files(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Vec<Vec<u8>>, std::io::Error> {
    if !CONFIG.common.wal_memory_mode_enabled {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    // read usesing files in use
    for data in MANAGER.data.iter() {
        for (_, file) in data.read().unwrap().iter() {
            if file.org_id == org_id
                && file.stream_name == stream_name
                && file.stream_type == stream_type
            {
                if let Ok(data) = file.read() {
                    files.push(data);
                }
            }
        }
    }
    // read memory files waiting to be moved to s3
    let prefix = format!("files/{org_id}/{stream_type}/{stream_name}/");
    for (file, data) in MEMORY_FILES.list() {
        if file.starts_with(&prefix) {
            files.push(data.to_vec());
        }
    }
    Ok(files)
}

pub fn flush_all_to_disk() {
    for data in MANAGER.data.iter() {
        for (_, file) in data.read().unwrap().iter() {
            file.sync();
        }
    }

    for (file, data) in MEMORY_FILES.list() {
        let file_path = format!("{}{}", CONFIG.common.data_wal_dir, file);
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .append(true)
            .open(file_path)
            .unwrap();
        f.write_all(&data).unwrap();
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

    pub fn get(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        key: &str,
    ) -> Option<Arc<RwFile>> {
        let full_key = format!("{org_id}_{stream_name}_{stream_type}_{key}");
        let file = match self
            .data
            .get(thread_id)
            .unwrap()
            .read()
            .unwrap()
            .get(&full_key)
        {
            Some(file) => file.clone(),
            None => {
                return None;
            }
        };

        // check size & ttl
        if file.size() >= (CONFIG.limit.max_file_size_on_disk as i64)
            || file.expired() <= chrono::Utc::now().timestamp()
        {
            self.data
                .get(thread_id)
                .unwrap()
                .write()
                .unwrap()
                .remove(&full_key);
            file.sync();
            return None;
        }

        Some(file)
    }

    pub fn create(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        key: &str,
        use_cache: bool,
    ) -> Arc<RwFile> {
        let full_key = format!("{org_id}_{stream_name}_{stream_type}_{key}");
        let file = Arc::new(RwFile::new(
            thread_id,
            org_id,
            stream_name,
            stream_type,
            key,
            use_cache,
        ));
        let mut data = self.data.get(thread_id).unwrap().write().unwrap();
        if !stream_type.eq(&StreamType::EnrichmentTables) {
            data.insert(full_key, file.clone());
        };
        file
    }

    pub fn get_or_create(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        key: &str,
        use_cache: bool,
    ) -> Arc<RwFile> {
        if let Some(file) = self.get(thread_id, org_id, stream_name, stream_type, key) {
            file
        } else {
            self.create(thread_id, org_id, stream_name, stream_type, key, use_cache)
        }
    }

    pub fn check_in_use(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        file_name: &str,
    ) -> bool {
        let columns = file_name.split('_').collect::<Vec<&str>>();
        let thread_id: usize = columns[0].parse().unwrap();
        let key = columns[1..columns.len() - 1].join("_");
        if let Some(file) = self.get(thread_id, org_id, stream_name, stream_type, &key) {
            if file.name() == file_name {
                return true;
            }
        }
        false
    }
}

impl Default for MemoryFiles {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryFiles {
    pub fn new() -> MemoryFiles {
        Self {
            data: Arc::new(RwLock::new(HashMap::default())),
        }
    }

    pub fn list(&self) -> HashMap<String, Bytes> {
        self.data.read().unwrap().clone()
    }

    pub fn insert(&self, file_name: String, data: Bytes) {
        self.data.write().unwrap().insert(file_name, data);
    }

    pub fn remove(&self, file_name: &str) {
        let mut data = self.data.write().unwrap();
        data.remove(file_name);
        data.shrink_to_fit();
    }
}

impl RwFile {
    fn new(
        thread_id: usize,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        key: &str,
        use_cache: bool,
    ) -> RwFile {
        let mut dir_path = format!(
            "{}files/{org_id}/{stream_type}/{stream_name}/",
            &CONFIG.common.data_wal_dir
        );
        // Hack for file_list
        let file_list_prefix = "/files//file_list//";
        if dir_path.contains(file_list_prefix) {
            dir_path = dir_path.replace(file_list_prefix, "/file_list/");
        }
        let id = ider::generate();
        let file_name = format!("{thread_id}_{key}_{id}{}", &CONFIG.common.file_ext_json);
        let file_path = format!("{dir_path}{file_name}");
        std::fs::create_dir_all(&dir_path).unwrap();

        let (file, cache) = if use_cache {
            (None, Some(RwLock::new(BytesMut::with_capacity(524288)))) // 512KB
        } else {
            let f = OpenOptions::new()
                .write(true)
                .create(true)
                .append(true)
                .open(&file_path)
                .unwrap_or_else(|e| panic!("open wal file [{file_path}] error: {e}"));
            (Some(RwLock::new(f)), None)
        };
        RwFile {
            use_cache,
            file,
            cache,
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            stream_type,
            dir: dir_path,
            name: file_name,
            expired: chrono::Utc::now().timestamp() + CONFIG.limit.max_file_retention_time as i64,
        }
    }

    #[inline]
    pub fn write(&self, data: &[u8]) {
        // metrics
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[
                &self.org_id,
                &self.stream_name,
                self.stream_type.to_string().as_str(),
            ])
            .add(data.len() as i64);
        metrics::INGEST_WAL_WRITE_BYTES
            .with_label_values(&[
                &self.org_id,
                &self.stream_name,
                self.stream_type.to_string().as_str(),
            ])
            .inc_by(data.len() as u64);
        if self.use_cache {
            self.cache
                .as_ref()
                .unwrap()
                .write()
                .unwrap()
                .extend_from_slice(data);
        } else {
            self.file
                .as_ref()
                .unwrap()
                .write()
                .unwrap()
                .write_all(data)
                .unwrap();
        }
    }

    #[inline]
    pub fn read(&self) -> Result<Vec<u8>, std::io::Error> {
        if self.use_cache {
            Ok(self
                .cache
                .as_ref()
                .unwrap()
                .read()
                .unwrap()
                .to_owned()
                .into())
        } else {
            get_file_contents(&self.full_name())
        }
    }

    #[inline]
    pub fn sync(&self) {
        if self.use_cache {
            let file_path = format!("{}{}", self.dir, self.name);
            let file_path = file_path.strip_prefix(&CONFIG.common.data_wal_dir).unwrap();
            MEMORY_FILES.insert(
                file_path.to_string(),
                self.cache
                    .as_ref()
                    .unwrap()
                    .read()
                    .unwrap()
                    .to_owned()
                    .freeze(),
            );
        } else {
            self.file
                .as_ref()
                .unwrap()
                .write()
                .unwrap()
                .sync_all()
                .unwrap()
        }
    }

    #[inline]
    pub fn size(&self) -> i64 {
        if self.use_cache {
            self.cache.as_ref().unwrap().write().unwrap().len() as i64
        } else {
            match self.file.as_ref().unwrap().read() {
                Ok(f) => f.metadata().unwrap().len() as i64,
                Err(_) => 0,
            }
        }
    }

    #[inline]
    pub fn name(&self) -> &str {
        &self.name
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wal_manager() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let key = "test_key";
        let use_cache = false;
        let file = get_or_create(thread_id, org_id, stream_name, stream_type, key, use_cache);
        let data = "test_data".to_string().into_bytes();
        file.write(&data);
        assert_eq!(file.read().unwrap(), data);
        assert_eq!(file.size(), data.len() as i64);
        assert!(file.name().contains(&format!("{}_{}", thread_id, key)));
    }

    #[test]
    fn test_memory_files() {
        let memory_files = MemoryFiles::new();
        let file_name = "test_file".to_string();
        let data = Bytes::from("test_data".to_string().into_bytes());
        memory_files.insert(file_name.clone(), data.clone());
        assert_eq!(memory_files.list().len(), 1);
        memory_files.remove(&file_name);
        assert_eq!(memory_files.list().len(), 0);
    }

    #[test]
    fn test_rw_file() {
        let thread_id = 1;
        let org_id = "test_org";
        let stream_name = "test_stream";
        let stream_type = StreamType::Logs;
        let key = "test_key";
        let use_cache = false;
        let file = RwFile::new(thread_id, org_id, stream_name, stream_type, key, use_cache);
        let data = "test_data".to_string().into_bytes();
        file.write(&data);
        assert_eq!(file.read().unwrap(), data);
        assert_eq!(file.size(), data.len() as i64);
        assert!(file.name().contains(&format!("{}_{}", thread_id, key)));
    }
}
