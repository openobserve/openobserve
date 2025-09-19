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

use std::sync::atomic::AtomicIsize;

use once_cell::sync::Lazy;
use scc::HashMap;

// SEARCHING_FILES for searching files, in use, should not move to s3
static SEARCHING_FILES: Lazy<HashMap<String, AtomicIsize>> = Lazy::new(HashMap::new);

// SEARCHING_REQUESTS for searching requests, in use, should not move to s3
static SEARCHING_REQUESTS: Lazy<HashMap<String, Vec<String>>> = Lazy::new(HashMap::new);

pub async fn init() -> Result<(), anyhow::Error> {
    _ = SEARCHING_FILES.clear_async().await;
    Ok(())
}

pub async fn lock_files(files: &[String]) {
    futures::future::join_all(files.iter().map(|file| {
        Box::pin(async {
            SEARCHING_FILES
                .entry_async(file.clone())
                .await
                .or_insert(0.into())
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        })
    }))
    .await;
}

pub async fn release_files(files: &[String]) {
    // Because usize data in the Entry can be moved along with the task, I need
    // to guarantee that inc/dec won't suffer a race condition. The guarantees
    // of concurrency by scc::HashMap are only for the Entry not the data inside.
    // Which is why I picked Atomics over regular isize/usize.
    let futures = files.iter().map(|file| {
        Box::pin(SEARCHING_FILES.remove_if_async(file, |e| {
            e.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) <= 1
        }))
    });
    futures::future::join_all(futures).await;
}

pub async fn lock_files_exists(file: &str) -> bool {
    SEARCHING_FILES.contains_async(file).await
}

pub async fn clean_lock_files() {
    let _ = init().await.inspect_err(|e| {
        log::error!(
            "Error clearing all the locks under SEARCHING_FILES: e={:?}",
            e
        );
    });
}

pub async fn lock_request(trace_id: &str, files: &[String]) {
    log::info!("[trace_id: {trace_id}] lock_request for wal files");
    let _ = SEARCHING_REQUESTS
        .insert_async(trace_id.to_string(), files.to_vec())
        .await
        .inspect_err(|e| {
            log::error!(
                "Error inserting {trace_id} into SEARCHING_REQUESTS. e={:?}",
                e
            );
        });
}

pub async fn release_request(trace_id: &str) {
    if !config::cluster::LOCAL_NODE.is_ingester() {
        return;
    }
    log::info!("[trace_id: {trace_id}] release_request for wal files");
    let files = SEARCHING_REQUESTS.remove_async(trace_id).await;
    if let Some((_, files)) = files {
        release_files(&files).await;
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
        lock_files(&files).await;
        assert!(lock_files_exists(&files[0]).await);
        assert!(lock_files_exists(&files[1]).await);

        // Test releasing files
        release_files(&files).await;
        assert!(!lock_files_exists(&files[0]).await);
        assert!(!lock_files_exists(&files[1]).await);
    }

    #[tokio::test]
    async fn test_wal_request_locking() {
        let trace_id = "test_trace_1234";
        let files = vec![
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key3.json".to_string(),
            "files/test_org/logs/test_stream/1/2025/06/06/01/1/md5/test_key4.json".to_string(),
        ];

        // Test locking request
        lock_files(&files).await;
        let _ = lock_request(trace_id, &files).await;
        assert!(lock_files_exists(&files[0]).await);
        assert!(lock_files_exists(&files[1]).await);

        // Test releasing request
        release_request(trace_id).await;
        assert!(!lock_files_exists(&files[0]).await);
        assert!(!lock_files_exists(&files[1]).await);
    }
}
