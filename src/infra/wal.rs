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

use bytes::{Bytes, BytesMut};
use dashmap::DashMap as HashMap;
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
pub static MANAGER: Lazy<Manager> = Lazy::new(Manager::new);

// MEMORY_FILES for in-memory mode WAL files, already not in use, should move to s3
pub static MEMORY_FILES: Lazy<MemoryFiles> = Lazy::new(MemoryFiles::new);

struct Manager {
    data: Arc<Vec<HashMap<String, Arc<RwFile>>>>,
}

struct MemoryFiles {
    data: HashMap<String, Arc<Bytes>>,
}

struct RwFile {
    use_cache: bool,
    file: Option<RwLock<File>>,
    cache: Option<RwLock<BytesMut>>,
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
    dir: String,
    name: String,
    created: i64,
    expired: i64,
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
            data.push(HashMap::<String, Arc<RwFile>>::default());
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
            .get(&full_key)
        {
            Some(file) => file.value().clone(),
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
        if !stream_type.eq(&StreamType::EnrichmentTable) {
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

impl MemoryFiles {
    pub fn new() -> MemoryFiles {
        Self {
            data: RwLock::new(HashMap::with_capacity(16)),
        }
    }

    pub fn get(&self, file_name: &str) -> Option<Bytes> {
        self.data.read().unwrap().get(file_name).cloned()
    }

    pub fn insert(&mut self, file_name: String, data: Bytes) {
        self.data.write().unwrap().insert(file_name, data);
    }

    pub fn remove(&mut self, file_name: &str) {
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
            (
                None,
                Some(RwLock::new(BytesMut::with_capacity(
                    CONFIG.limit.max_file_size_on_disk as usize / 16,
                ))),
            )
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
            FILES.write().unwrap().insert(
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
            self.file
                .as_ref()
                .unwrap()
                .read()
                .unwrap()
                .metadata()
                .unwrap()
                .len() as i64
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
        let thread_data = data.read().unwrap();
        for (_, file) in thread_data.iter() {
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
    for (file, data) in MEMORY_FILES.read().unwrap().iter() {
        if file.starts_with(&prefix) {
            files.push(data.to_vec());
        }
    }
    Ok(files)
}

pub fn flush_all_to_disk() {
    for data in MANAGER.data.iter() {
        let thread_data = data.read().unwrap();
        for (_, file) in thread_data.iter() {
            file.sync();
        }
    }

    for (file, data) in MEMORY_FILES.read().unwrap().iter() {
        let file_path = format!("{}{}", CONFIG.common.data_wal_dir, file);
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .append(true)
            .open(file_path)
            .unwrap();
        f.write_all(data).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
}
