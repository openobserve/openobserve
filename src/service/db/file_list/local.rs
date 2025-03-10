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

use config::meta::stream::{FileKey, FileListDeleted, FileMeta};
use hashbrown::HashSet;
use infra::errors::Result;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

static PENDING_DELETE_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

/// use queue to batch send broadcast to other nodes
pub static BROADCAST_QUEUE: Lazy<RwLock<Vec<FileKey>>> =
    Lazy::new(|| RwLock::new(Vec::with_capacity(2048)));

pub async fn set(key: &str, meta: Option<FileMeta>, deleted: bool) -> Result<()> {
    let file_data = FileKey::new(key.to_string(), meta.clone().unwrap_or_default(), deleted);

    // write into file_list storage
    // retry 5 times
    for _ in 0..5 {
        if let Err(e) = super::progress(key, meta.as_ref(), deleted).await {
            log::error!("[FILE_LIST] Error saving file to storage, retrying: {}", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        } else {
            break;
        }
    }

    let cfg = config::get_config();

    // notify other nodes
    if cfg.memory_cache.cache_latest_files {
        let mut q = BROADCAST_QUEUE.write().await;
        q.push(file_data);
    }

    Ok(())
}

pub async fn exist_pending_delete(file: &str) -> bool {
    PENDING_DELETE_FILES.read().await.contains(file)
}

pub async fn add_pending_delete(org_id: &str, file: &str) -> Result<()> {
    // add to memory cache
    {
        PENDING_DELETE_FILES.write().await.insert(file.to_string());
    }
    // add to local db for persistence
    let ts = config::utils::time::now_micros();
    infra::file_list::LOCAL_CACHE
        .batch_add_deleted(
            org_id,
            ts,
            &[FileListDeleted {
                file: file.to_string(),
                index_file: false,
                flattened: false,
            }],
        )
        .await
}

pub async fn remove_pending_delete(file: &str) -> Result<()> {
    // remove from memory cache
    {
        PENDING_DELETE_FILES.write().await.remove(file);
    }
    // remove from local db for persistence
    infra::file_list::LOCAL_CACHE
        .batch_remove_deleted(&[file.to_string()])
        .await
}

pub async fn filter_by_pending_delete(mut files: Vec<String>) -> Vec<String> {
    let r = PENDING_DELETE_FILES.read().await;
    files.retain(|file| !r.contains(file));
    files
}

pub async fn load_pending_delete() -> Result<()> {
    let files = infra::file_list::LOCAL_CACHE.list_deleted().await?;
    for file in files {
        PENDING_DELETE_FILES.write().await.insert(file.file);
    }
    Ok(())
}
