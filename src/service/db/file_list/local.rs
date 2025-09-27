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

use std::path::{Path, PathBuf};

use config::meta::stream::{FileKey, FileListDeleted};
use hashbrown::HashSet;
use infra::{
    errors::Result,
    file_list::{LOCAL_CACHE, LocalCache},
};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

pub struct FileDeletionManager {
    pending: RwLock<HashSet<PathBuf>>,
    removing: RwLock<HashSet<PathBuf>>,

    local_cache: LocalCache,
}

impl FileDeletionManager {
    pub fn new(local_cache: LocalCache) -> Self {
        Self {
            pending: Default::default(),
            removing: Default::default(),

            local_cache,
        }
    }

    pub async fn is_deletion_pending(&self, file: impl AsRef<Path>) -> bool {
        self.pending.read().await.contains(file.as_ref())
    }

    pub async fn queue_for_deletion(
        &self,
        org_id: &str,
        account: &str,
        file: impl AsRef<str>,
    ) -> Result<()> {
        let ts = config::utils::time::now_micros();
        let file = file.as_ref();

        let file_to_local = file.to_string();
        let write_to_local = async {
            let file_list_deleted = FileListDeleted {
                id: 0,
                account: account.to_string(),
                file: file_to_local,
                index_file: false,
                flattened: false,
            };

            infra::file_list::LOCAL_CACHE
                .batch_add_deleted(org_id, ts, &[file_list_deleted])
                .await
        };

        let write_to_inmemory = async { self.pending.write().await.insert(PathBuf::from(file)) };

        let (result, _) = tokio::join!(write_to_local, write_to_inmemory);

        result
    }

    pub async fn dequeue_from_deletion(&self, file: impl AsRef<str>) -> Result<()> {
        let file = file.as_ref();
        let remove_local_cache = async {
            infra::file_list::LOCAL_CACHE
                .batch_remove_deleted(&[FileKey::from_file_name(file)])
                .await
        };

        // remove from memory cache
        let remove_from_inmemory = async { self.pending.write().await.remove(Path::new(file)) };
        let (result, _) = tokio::join!(remove_local_cache, remove_from_inmemory);

        result
    }

    pub async fn list_pending_delete(&self) -> Vec<PathBuf> {
        self.pending.read().await.iter().cloned().collect()
    }

    pub async fn filter_for_active<T>(&self, mut files: Vec<T>) -> Vec<T>
    where
        T: AsRef<Path>,
    {
        let (removing, pending) = tokio::join!(self.removing.read(), self.pending.read());

        files.retain(|f| {
            let path_buf = f.as_ref().to_path_buf();
            !pending.contains(&path_buf) && !removing.contains(&path_buf)
        });

        files
    }

    pub async fn start_removing(&self, file: impl AsRef<Path>) -> Result<()> {
        self.removing
            .write()
            .await
            .insert(file.as_ref().to_path_buf());

        Ok(())
    }

    pub async fn complete_removal(&self, file: impl AsRef<Path>) -> Result<()> {
        self.removing.write().await.remove(file.as_ref());

        Ok(())
    }

    pub async fn reload_pending_from_local(&self) -> Result<()> {
        let local_mode = config::get_config().common.local_mode;
        let (mut pending, files) =
            tokio::join!(self.pending.write(), self.local_cache.list_deleted());
        files?
            .into_iter()
            .filter(|f| ingester::is_wal_file(local_mode, &f.file))
            .for_each(|f| {
                pending.insert(PathBuf::from(f.file));
            });

        Ok(())
    }
}

pub static FILE_DELETION_MANAGER: Lazy<FileDeletionManager> =
    Lazy::new(|| FileDeletionManager::new(LOCAL_CACHE.clone()));

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use infra::file_list::connect_local_cache;

    use super::*;

    #[tokio::test]
    async fn test_exist_pending_delete() {
        // Test with non-existent file
        let file_deletion_manager = FileDeletionManager::new(connect_local_cache());
        assert!(
            !file_deletion_manager
                .is_deletion_pending(
                    "/a/b/c/d/files/default/logs/olympics/2022/10/03/10/non_existent_file.parquet"
                )
                .await
        );

        // Add a file and test it exists
        let test_file =
            "/a/b/c/d/files/default/logs/olympics/2022/10/03/10/test_file_exist.parquet";
        let _ = file_deletion_manager
            .queue_for_deletion("SomeOrg", "SomeAccount", test_file)
            .await;

        // Check if the inmemory state has been updated
        assert!(file_deletion_manager.is_deletion_pending(test_file).await);
        // TODO: Check if the local sqlite cache has been updated

        // Clean up
        let _ = file_deletion_manager.dequeue_from_deletion(test_file).await;
        // Check if the inmemory state has been updated
        assert!(!file_deletion_manager.is_deletion_pending(test_file).await);
        // TODO: Check if the local sqlite cache has been updated
    }

    #[tokio::test]
    async fn test_concurrent_access() {
        let file_deletion_manager = Arc::new(FileDeletionManager::new(connect_local_cache()));

        let test_file = "concurrent_test.parquet";

        // Test concurrent read/write access doesn't deadlock
        let tasks: Vec<_> = (0..100)
            .map(|i| {
                let file = format!("{test_file}_{i}");
                let file_deletion_manager = file_deletion_manager.clone();
                tokio::spawn(async move {
                    let _ = file_deletion_manager.start_removing(&file).await;
                    let _ = file_deletion_manager.complete_removal(&file).await;
                })
            })
            .collect();

        // Wait for all tasks to complete
        for task in tasks {
            task.await.unwrap();
        }

        // All files should be removed
        let removing_files = file_deletion_manager.removing.read().await;
        for i in 0..100 {
            let file = PathBuf::from(format!("{test_file}_{i}"));
            assert!(!removing_files.contains(&file));
        }
    }
}
