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

use hashbrown::HashMap;
use once_cell::sync::Lazy;

// SEARCHING_FILES for searching files, in use, should not move to s3
static SEARCHING_FILES: Lazy<parking_lot::RwLock<SearchingFileLocker>> =
    Lazy::new(|| parking_lot::RwLock::new(SearchingFileLocker::new()));

// SEARCHING_REQUESTS for searching requests, in use, should not move to s3
static SEARCHING_REQUESTS: Lazy<parking_lot::RwLock<HashMap<String, Vec<String>>>> =
    Lazy::new(Default::default);

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

pub fn init() -> Result<(), anyhow::Error> {
    _ = SEARCHING_FILES.read().len();
    Ok(())
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
}
