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
