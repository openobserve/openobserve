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

use config::meta::stream::{FileKey, FileListDeleted};
use infra::errors::Result;

pub async fn exist_pending_delete(file: &str) -> bool {
    infra::file_list::pending_delete::exist(file).await
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
    infra::file_list::pending_delete::register(file).await;
    Ok(())
}

pub async fn remove_pending_delete(file: &str) -> Result<()> {
    // remove from local db for persistence
    infra::file_list::LOCAL_CACHE
        .batch_remove_deleted(&[FileKey::from_file_name(file)])
        .await?;
    // remove from memory cache
    infra::file_list::pending_delete::unregister(file).await;
    Ok(())
}

pub async fn get_pending_delete() -> Vec<String> {
    infra::file_list::pending_delete::list().await
}

pub async fn filter_by_pending_delete(files: Vec<String>) -> Vec<String> {
    infra::file_list::pending_delete::filter(files).await
}

pub async fn load_pending_delete() -> Result<()> {
    let files = infra::file_list::LOCAL_CACHE.list_deleted().await?;
    for file in files {
        if ingester::is_wal_file(&file.file) {
            infra::file_list::pending_delete::register(&file.file).await;
        }
    }
    Ok(())
}

pub async fn add_removing(file: &str) -> Result<()> {
    // add to memory cache
    infra::file_list::pending_delete::add_removing(file).await;
    Ok(())
}

pub async fn remove_removing(file: &str) -> Result<()> {
    // remove from memory cache
    infra::file_list::pending_delete::remove_removing(file).await;
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
        infra::file_list::pending_delete::register(test_file).await;

        let exists = exist_pending_delete(test_file).await;
        assert!(exists);

        // Clean up
        infra::file_list::pending_delete::unregister(test_file).await;
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
        for i in 0..10 {
            let file = format!("{test_file}_{i}");
            assert_eq!(
                infra::file_list::pending_delete::filter(vec![file.clone()]).await,
                vec![file]
            );
        }
    }
}
