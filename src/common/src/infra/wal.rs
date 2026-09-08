// Copyright 2026 OpenObserve Inc.
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

use std::sync::LazyLock as Lazy;

use hashbrown::{HashMap, HashSet};

// SEARCHING_FILES for searching files, in use, should not move to s3
static SEARCHING_FILES: Lazy<parking_lot::RwLock<SearchingFileLocker>> =
    Lazy::new(|| parking_lot::RwLock::new(SearchingFileLocker::new()));

// SEARCHING_REQUESTS for searching requests, in use, should not move to s3
static SEARCHING_REQUESTS: Lazy<parking_lot::RwLock<HashMap<String, Vec<String>>>> =
    Lazy::new(Default::default);

struct SearchingFileLocker {
    inner: HashMap<String, usize>,
}

/// Owns the `SEARCHING_FILES` locks of one search, releasing them on drop so a cancelled
/// search cannot pin wal files for the life of the process.
pub struct SearchingFiles {
    trace_id: String,
    files: HashSet<String>,
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

impl SearchingFiles {
    /// An empty guard, for the paths that return before any lock is taken.
    pub fn empty(trace_id: &str) -> Self {
        Self {
            trace_id: trace_id.to_string(),
            files: HashSet::new(),
        }
    }

    pub fn lock(trace_id: &str, files: &[String]) -> Self {
        // a set, so release_one is O(1) over a file list that can run to thousands
        let files: HashSet<String> = files.iter().cloned().collect();
        lock_files(&files);
        Self {
            trace_id: trace_id.to_string(),
            files,
        }
    }

    /// Release one file now and stop tracking it.
    pub fn release_one(&mut self, file: &str) {
        if self.files.remove(file) {
            release_files(std::iter::once(file));
        }
    }

    /// Hand the remaining locks to the trace id; `release_request` releases them from there.
    pub fn into_request(mut self) {
        let files: Vec<String> = self.files.drain().collect();
        lock_request(&self.trace_id, files);
    }
}

impl Drop for SearchingFiles {
    fn drop(&mut self) {
        if self.files.is_empty() {
            return;
        }
        log::debug!(
            "[trace_id {}] wal->search: released {} file locks on drop",
            self.trace_id,
            self.files.len()
        );
        release_files(&self.files);
    }
}

pub fn init() -> Result<(), anyhow::Error> {
    _ = SEARCHING_FILES.read().len();
    Ok(())
}

fn lock_files<I: IntoIterator<Item = S>, S: AsRef<str>>(files: I) {
    let mut locker = SEARCHING_FILES.write();
    for file in files {
        locker.lock(file.as_ref().to_string());
    }
}

fn release_files<I: IntoIterator<Item = S>, S: AsRef<str>>(files: I) {
    let mut locker = SEARCHING_FILES.write();
    for file in files {
        locker.release(file.as_ref());
    }
}

pub fn lock_files_exists(file: &str) -> bool {
    SEARCHING_FILES.read().exist(file)
}

pub fn lock_files_len() -> usize {
    SEARCHING_FILES.read().len()
}

pub fn clean_lock_files() {
    let mut locker = SEARCHING_FILES.write();
    locker.clean();
}

fn lock_request(trace_id: &str, files: Vec<String>) {
    log::info!("[trace_id: {trace_id}] lock_request for wal files");
    let mut locker = SEARCHING_REQUESTS.write();
    locker
        .entry(trace_id.to_string())
        .or_default()
        .extend(files);
}

pub fn release_request(trace_id: &str) {
    let files = SEARCHING_REQUESTS.write().remove(trace_id);
    if let Some(files) = files {
        log::info!("[trace_id: {trace_id}] release_request for wal files");
        release_files(&files);
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    // tests below mutate the shared global SEARCHING_FILES map; serialize the
    // ones that assert on lock presence so clean_lock_files() from a parallel
    // test cannot clear locks mid-assertion
    static TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    #[tokio::test]
    async fn test_wal_file_locking() {
        let _guard = TEST_LOCK.lock();
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
        let _guard = TEST_LOCK.lock();
        let trace_id = "test_trace_1234";
        let files = vec![
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key3.json".to_string(),
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key4.json".to_string(),
        ];

        // Lock files and record the request
        lock_files(&files);
        lock_request(trace_id, files.clone());
        assert!(lock_files_exists(&files[0]));
        assert!(lock_files_exists(&files[1]));

        release_request(trace_id);
        assert!(!lock_files_exists(&files[0]));
        assert!(!lock_files_exists(&files[1]));
    }

    #[test]
    fn test_init_succeeds() {
        assert!(init().is_ok());
    }

    #[test]
    fn test_file_not_locked_initially() {
        assert!(!lock_files_exists(
            "files/org/logs/stream/1/md5/never_locked.json"
        ));
    }

    #[test]
    fn test_clean_lock_files_clears_all() {
        let _guard = TEST_LOCK.lock();
        let files = vec![
            "files/org/logs/stream/1/md5/clean_test_a.json".to_string(),
            "files/org/logs/stream/1/md5/clean_test_b.json".to_string(),
        ];
        lock_files(&files);
        assert!(lock_files_exists(&files[0]));
        clean_lock_files();
        assert!(!lock_files_exists(&files[0]));
        assert!(!lock_files_exists(&files[1]));
    }

    #[test]
    fn test_file_lock_reference_counting() {
        let _guard = TEST_LOCK.lock();
        let files = vec!["files/org/logs/stream/1/md5/refcount_test.json".to_string()];
        lock_files(&files);
        lock_files(&files);
        // one release - still locked
        release_files(&files);
        assert!(lock_files_exists(&files[0]));
        // second release - now free
        release_files(&files);
        assert!(!lock_files_exists(&files[0]));
    }

    #[test]
    fn test_searching_files_releases_on_drop() {
        let _guard = TEST_LOCK.lock();
        let files = vec![
            "files/org/logs/stream/1/md5/guard_drop_a.json".to_string(),
            "files/org/logs/stream/1/md5/guard_drop_b.json".to_string(),
        ];
        {
            let _locks = SearchingFiles::lock("trace_drop", &files);
            assert!(lock_files_exists(&files[0]));
            assert!(lock_files_exists(&files[1]));
        }
        assert!(!lock_files_exists(&files[0]));
        assert!(!lock_files_exists(&files[1]));
    }

    #[test]
    fn test_searching_files_locks_duplicates_once() {
        let _guard = TEST_LOCK.lock();
        let file = "files/org/logs/stream/1/md5/guard_dup.json".to_string();
        {
            let _locks = SearchingFiles::lock("trace_dup", &[file.clone(), file.clone()]);
            assert!(lock_files_exists(&file));
        }
        assert!(!lock_files_exists(&file));
    }

    #[test]
    fn test_searching_files_release_one() {
        let _guard = TEST_LOCK.lock();
        let files = vec![
            "files/org/logs/stream/1/md5/guard_one_a.json".to_string(),
            "files/org/logs/stream/1/md5/guard_one_b.json".to_string(),
        ];
        {
            let mut locks = SearchingFiles::lock("trace_one", &files);
            locks.release_one(&files[0]);
            assert!(!lock_files_exists(&files[0]));
            assert!(lock_files_exists(&files[1]));
            // releasing an untracked file is a no-op
            locks.release_one(&files[0]);
            assert!(lock_files_exists(&files[1]));
        }
        assert!(!lock_files_exists(&files[1]));
    }

    #[test]
    fn test_searching_files_into_request_keeps_locks() {
        let _guard = TEST_LOCK.lock();
        let trace_id = "trace_into_request";
        let files = vec!["files/org/logs/stream/1/md5/guard_into.json".to_string()];
        {
            let locks = SearchingFiles::lock(trace_id, &files);
            locks.into_request();
        }
        // ownership moved to SEARCHING_REQUESTS, so the guard's drop released nothing
        assert!(lock_files_exists(&files[0]));
        release_request(trace_id);
        assert!(!lock_files_exists(&files[0]));
    }
}
