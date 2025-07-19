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

use std::path::PathBuf;

use anyhow::{Result, anyhow};
use hashbrown::HashMap;

use crate::get_config;

pub async fn delete(org_id: &str, table_name: &str) -> Result<()> {
    let key = get_key(org_id, table_name);
    let file_dir = get_table_dir(&key);
    let metadata_path = get_metadata_path();
    if !metadata_path.exists() {
        return Ok(());
    }

    if file_dir.exists() {
        tokio::fs::remove_dir_all(&file_dir)
            .await
            .map_err(|e| anyhow!("Failed to remove enrichment table file: {}", e))?;
    }

    let mut metadata_content = get_metadata_content().await?;
    metadata_content.remove(&key);

    // Serialize the metadata content
    let metadata_json = serde_json::to_string_pretty(&metadata_content)
        .map_err(|e| anyhow!("Failed to serialize metadata: {}", e))?;

    // Serialize and write metadata
    tokio::fs::write(&metadata_path, metadata_json)
        .await
        .map_err(|e| anyhow!("Failed to write metadata file: {}", e))?;

    log::debug!("Deleted enrichment table {} from local storage", key);
    Ok(())
}

pub fn get_key(org_id: &str, table_name: &str) -> String {
    format!("{}/{}", org_id, table_name)
}

pub fn get_table_dir(key: &str) -> PathBuf {
    let cfg = get_config();
    let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
        format!("{}/enrichment_table_cache", cfg.common.data_cache_dir)
    } else {
        cfg.enrichment_table.cache_dir.clone()
    };
    PathBuf::from(format!("{cache_dir}/{key}"))
}

pub fn get_table_path(table_dir: &str, created_at: i64) -> PathBuf {
    PathBuf::from(format!("{table_dir}/{created_at}.json"))
}

pub fn get_metadata_path() -> PathBuf {
    let cfg = get_config();
    let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
        format!("{}/enrichment_table_cache", cfg.common.data_cache_dir)
    } else {
        cfg.enrichment_table.cache_dir.clone()
    };
    PathBuf::from(format!("{cache_dir}/metadata.json"))
}

pub async fn get_metadata_content() -> Result<HashMap<String, i64>> {
    let metadata_path = get_metadata_path();
    if metadata_path.exists() {
        let existing_metadata = tokio::fs::read_to_string(&metadata_path)
            .await
            .map_err(|e| anyhow!("Failed to read metadata file: {}", e))?;
        let existing_metadata: HashMap<String, i64> = serde_json::from_str(&existing_metadata)
            .map_err(|e| anyhow!("Failed to parse metadata JSON: {}", e))?;
        Ok(existing_metadata)
    } else {
        Ok(HashMap::new())
    }
}
