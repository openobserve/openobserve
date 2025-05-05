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

use config::meta::stream::FileListDeleted;
use hashbrown::HashSet;
use infra::errors::Result;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

static PENDING_DELETE_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

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
        .batch_remove_deleted(&[file.to_string()])
        .await?;
    // remove from memory cache
    PENDING_DELETE_FILES.write().await.remove(file);
    Ok(())
}

pub async fn get_pending_delete() -> Vec<String> {
    PENDING_DELETE_FILES.read().await.iter().cloned().collect()
}

pub async fn filter_by_pending_delete(mut files: Vec<String>) -> Vec<String> {
    let r = PENDING_DELETE_FILES.read().await;
    files.retain(|file| !r.contains(file));
    drop(r);
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
