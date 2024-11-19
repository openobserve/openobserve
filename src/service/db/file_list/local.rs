// Copyright 2024 OpenObserve Inc.
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

use config::{
    meta::stream::{FileKey, FileMeta},
    utils::parquet::parse_file_key_columns,
};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

/// use queue to batch send broadcast to other nodes
pub static BROADCAST_QUEUE: Lazy<RwLock<Vec<FileKey>>> =
    Lazy::new(|| RwLock::new(Vec::with_capacity(2048)));

pub async fn set(key: &str, meta: Option<FileMeta>, deleted: bool) -> Result<(), anyhow::Error> {
    let (_stream_key, _date_key, _file_name) = parse_file_key_columns(key)?;
    let file_data = FileKey::new(key, meta.clone().unwrap_or_default(), deleted);

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
    if !cfg.common.meta_store_external || cfg.memory_cache.cache_latest_files {
        let mut q = BROADCAST_QUEUE.write().await;
        q.push(file_data);
    }

    Ok(())
}
