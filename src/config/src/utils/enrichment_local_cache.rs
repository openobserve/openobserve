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

    log::debug!("Deleted enrichment table {key} from local storage");
    Ok(())
}

pub fn get_key(org_id: &str, table_name: &str) -> String {
    format!("{org_id}/{table_name}")
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
    PathBuf::from(format!("{table_dir}/{created_at}.parquet"))
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

/// Clean up old JSON format enrichment tables from disk
/// Scans the enrichment table cache directory and removes any directories containing .json files
pub async fn cleanup_old_json_format() -> Result<()> {
    let cfg = get_config();
    let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
        format!("{}/enrichment_table_cache", cfg.common.data_cache_dir)
    } else {
        cfg.enrichment_table.cache_dir.clone()
    };

    let cache_path = std::path::Path::new(&cache_dir);
    if !cache_path.exists() {
        return Ok(());
    }

    log::info!(
        "Checking for old JSON format enrichment tables in {}",
        cache_dir
    );

    let mut has_old_json = false;

    // Scan all directories recursively for non-metadata JSON files
    let mut org_entries = tokio::fs::read_dir(cache_path).await?;
    while let Some(org_entry) = org_entries.next_entry().await? {
        let org_path = org_entry.path();
        if !org_path.is_dir() {
            continue;
        }

        // Scan table directories
        let mut table_entries = tokio::fs::read_dir(&org_path).await?;
        while let Some(table_entry) = table_entries.next_entry().await? {
            let table_path = table_entry.path();
            if !table_path.is_dir() {
                continue;
            }

            // Check if this table directory contains .json files (excluding metadata.json)
            let mut file_entries = tokio::fs::read_dir(&table_path).await?;
            while let Some(file_entry) = file_entries.next_entry().await? {
                let file_path = file_entry.path();
                if file_path.is_file()
                    && file_path.extension().unwrap_or_default() == "json"
                    && file_entry.file_name() != "metadata.json"
                {
                    has_old_json = true;
                    break;
                }
            }

            if has_old_json {
                break;
            }
        }

        if has_old_json {
            break;
        }
    }

    // If we found any old JSON files, remove all data in cache_dir
    if has_old_json {
        log::info!(
            "Found old JSON format enrichment tables, removing all data in cache directory: {}",
            cache_dir
        );

        // Remove all entries in the cache directory
        let mut entries = tokio::fs::read_dir(cache_path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                tokio::fs::remove_dir_all(&path).await?;
            } else {
                tokio::fs::remove_file(&path).await?;
            }
        }

        log::info!("Successfully cleaned up all data in cache directory");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_key() {
        let key = get_key("org123", "table456");
        assert_eq!(key, "org123/table456");

        let key2 = get_key("test_org", "my_table");
        assert_eq!(key2, "test_org/my_table");

        // Test with special characters
        let key3 = get_key("test-org@123", "table_name_with_spaces");
        assert_eq!(key3, "test-org@123/table_name_with_spaces");

        // Test with empty strings
        let key4 = get_key("", "");
        assert_eq!(key4, "/");
    }

    #[test]
    fn test_get_table_path() {
        let table_dir = "/tmp/test_cache/org123/table456";
        let created_at = 1640995200; // 2022-01-01 00:00:00 UTC

        let table_path = get_table_path(table_dir, created_at);
        let expected_path = format!("{table_dir}/{created_at}.parquet");
        assert_eq!(table_path.to_string_lossy(), expected_path);

        // Test with different timestamp
        let table_path2 = get_table_path(table_dir, 1640995300);
        let expected_path2 = format!("{}/{}.parquet", table_dir, 1640995300);
        assert_eq!(table_path2.to_string_lossy(), expected_path2);
    }

    #[test]
    fn test_get_table_dir_and_metadata_path() {
        // Test that the functions return valid paths
        let table_dir = get_table_dir("org123/table456");
        assert!(
            table_dir
                .to_string_lossy()
                .contains("enrichment_table_cache")
        );
        assert!(table_dir.to_string_lossy().contains("org123/table456"));

        let metadata_path = get_metadata_path();
        assert!(
            metadata_path
                .to_string_lossy()
                .contains("enrichment_table_cache")
        );
        assert!(metadata_path.to_string_lossy().contains("metadata.json"));
    }

    #[test]
    fn test_get_table_dir_with_custom_cache_dir() {
        // Test that the functions return valid paths with custom cache dir
        let table_dir = get_table_dir("org123/table456");
        assert!(table_dir.to_string_lossy().contains("org123/table456"));

        let metadata_path = get_metadata_path();
        assert!(metadata_path.to_string_lossy().contains("metadata.json"));
    }
}
