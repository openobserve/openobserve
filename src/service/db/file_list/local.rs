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

use config::meta::stream::{FileKey, FileListDeleted};
use hashbrown::HashSet;
use infra::errors::Result;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

static PENDING_DELETE_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

static REMOVING_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

pub async fn exist_pending_delete(file: &str) -> bool {
    PENDING_DELETE_FILES.read().await.contains(file)
}

pub async fn add_pending_delete(org_id: &str, account: &str, file: &str) -> Result<()> {
    // add to local db for persistence
    let ts = config::utils::time::now_micros();
    infra::file_list::LOCAL_CACHE
        .batch_add_deleted(
            org_id,
            ts,
            &[FileListDeleted {
                id: 0,
                account: account.to_string(),
                file: file.to_string(),
                index_file: false,
                flattened: false,
            }],
        )
        .await?;
    // add to memory cache
    PENDING_DELETE_FILES.write().await.insert(file.to_string());
    Ok(())
}

pub async fn remove_pending_delete(file: &str) -> Result<()> {
    // remove from local db for persistence
    infra::file_list::LOCAL_CACHE
        .batch_remove_deleted(&[FileKey::from_file_name(file)])
        .await?;
    // remove from memory cache
    PENDING_DELETE_FILES.write().await.remove(file);
    Ok(())
}

pub async fn get_pending_delete() -> Vec<String> {
    PENDING_DELETE_FILES.read().await.iter().cloned().collect()
}

pub async fn filter_by_pending_delete(mut files: Vec<String>) -> Vec<String> {
    // Acquire locks in a consistent order to prevent deadlocks
    let pending = PENDING_DELETE_FILES.read().await;
    let removing = REMOVING_FILES.read().await;

    // Filter in a single pass using both sets
    files.retain(|file| !pending.contains(file) && !removing.contains(file));
    drop(pending);
    drop(removing);

    files
}

pub async fn load_pending_delete() -> Result<()> {
    let local_mode = config::get_config().common.local_mode;
    let files = infra::file_list::LOCAL_CACHE.list_deleted().await?;
    for file in files {
        if ingester::is_wal_file(local_mode, &file.file) {
            PENDING_DELETE_FILES.write().await.insert(file.file);
        }
    }
    Ok(())
}

pub async fn add_removing(file: &str) -> Result<()> {
    // add to memory cache
    REMOVING_FILES.write().await.insert(file.to_string());
    Ok(())
}

pub async fn remove_removing(file: &str) -> Result<()> {
    // remove from memory cache
    REMOVING_FILES.write().await.remove(file);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_exist_pending_delete() {
        // Test with non-existent file
        let exists = exist_pending_delete("non_existent_file.parquet").await;
        assert!(!exists);

        // Add a file and test it exists
        let test_file = "test_file_exist.parquet";
        PENDING_DELETE_FILES
            .write()
            .await
            .insert(test_file.to_string());

        let exists = exist_pending_delete(test_file).await;
        assert!(exists);

        // Clean up
        PENDING_DELETE_FILES.write().await.remove(test_file);
    }

    #[test]
    fn test_static_variables() {
        // Test that static variables are accessible
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let pending_count = PENDING_DELETE_FILES.read().await.len();
            let removing_count = REMOVING_FILES.read().await.len();

            // Just verify they're accessible (counts can be anything)
            // Counts are usize so they're always >= 0, just verify they exist
            let _ = pending_count;
            let _ = removing_count;
        });
    }

    #[tokio::test]
    async fn test_concurrent_access() {
        let test_file = "concurrent_test.parquet";

        // Test concurrent read/write access doesn't deadlock
        let tasks: Vec<_> = (0..10)
            .map(|i| {
                let file = format!("{test_file}_{i}");
                tokio::spawn(async move {
                    let _ = add_removing(&file).await;
                    let _ = remove_removing(&file).await;
                })
            })
            .collect();

        // Wait for all tasks to complete
        for task in tasks {
            task.await.unwrap();
        }

        // All files should be removed
        let removing_files = REMOVING_FILES.read().await;
        for i in 0..10 {
            let file = format!("{test_file}_{i}");
            assert!(!removing_files.contains(&file));
        }
    }
}
