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

use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use hashbrown::HashMap;
use tokio::sync::Mutex;

use crate::get_config;

/// Held across each metadata.json read-modify-write, or a concurrent writer's entries get lost.
static METADATA_LOCK: Mutex<()> = Mutex::const_new(());

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

    update_metadata_at(&metadata_path, |metadata| metadata.remove(&key).is_some()).await?;

    log::debug!("Deleted enrichment table {key} from local storage");
    Ok(())
}

/// Removes every local table of the org by its org directory, so no table name is needed.
pub async fn delete_org(org_id: &str) -> Result<()> {
    let metadata_path = get_metadata_path();
    let cache_dir = metadata_path
        .parent()
        .ok_or_else(|| anyhow!("enrichment table cache dir has no parent"))?;
    delete_org_in(cache_dir, org_id).await
}

pub fn get_key(org_id: &str, table_name: &str) -> String {
    format!("{org_id}/{table_name}")
}

pub fn get_table_dir(key: &str) -> PathBuf {
    let cfg = get_config();
    let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
        // The data_cache_dir is expected to end with `/`
        format!("{}enrichment_table_cache", cfg.common.data_cache_dir)
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
        // The data_cache_dir is expected to end with `/`
        format!("{}enrichment_table_cache", cfg.common.data_cache_dir)
    } else {
        cfg.enrichment_table.cache_dir.clone()
    };
    PathBuf::from(format!("{cache_dir}/metadata.json"))
}

pub async fn get_metadata_content() -> Result<HashMap<String, i64>> {
    read_metadata(&get_metadata_path()).await
}

/// Applies `update` to metadata.json under the lock, writing it back when `update` returns true.
pub async fn update_metadata(update: impl FnOnce(&mut HashMap<String, i64>) -> bool) -> Result<()> {
    update_metadata_at(&get_metadata_path(), update).await
}

/// Clean up old JSON format enrichment tables from disk
/// Scans the enrichment table cache directory and removes any directories containing .json files
pub async fn cleanup_old_json_format() -> Result<()> {
    let cfg = get_config();
    let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
        // The data_cache_dir is expected to end with `/`
        format!("{}enrichment_table_cache", cfg.common.data_cache_dir)
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

async fn delete_org_in(cache_dir: &Path, org_id: &str) -> Result<()> {
    let org_dir = cache_dir.join(org_id);
    if let Err(e) = tokio::fs::remove_dir_all(&org_dir).await
        && e.kind() != std::io::ErrorKind::NotFound
    {
        return Err(anyhow!("Failed to remove {}: {e}", org_dir.display()));
    }
    let owned = format!("{org_id}/");
    update_metadata_at(&cache_dir.join("metadata.json"), |metadata| {
        let before = metadata.len();
        metadata.retain(|key, _| !key.starts_with(&owned));
        metadata.len() != before
    })
    .await
}

async fn read_metadata(path: &Path) -> Result<HashMap<String, i64>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let metadata = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| anyhow!("Failed to read metadata file: {e}"))?;
    serde_json::from_str(&metadata).map_err(|e| anyhow!("Failed to parse metadata JSON: {e}"))
}

async fn update_metadata_at(
    path: &Path,
    update: impl FnOnce(&mut HashMap<String, i64>) -> bool,
) -> Result<()> {
    let _guard = METADATA_LOCK.lock().await;
    let mut metadata = read_metadata(path).await?;
    if !update(&mut metadata) {
        return Ok(());
    }
    let metadata = serde_json::to_string_pretty(&metadata)
        .map_err(|e| anyhow!("Failed to serialize metadata: {e}"))?;
    tokio::fs::write(path, metadata)
        .await
        .map_err(|e| anyhow!("Failed to write metadata file: {e}"))
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

    #[tokio::test]
    async fn test_delete_org_fails_while_its_directory_cannot_be_removed() {
        let cache_dir = scratch_dir("org");
        std::fs::create_dir_all(cache_dir.join("t10/tbl")).unwrap();
        std::fs::write(cache_dir.join("t1"), b"not a directory").unwrap();
        std::fs::write(
            cache_dir.join("metadata.json"),
            r#"{"t1/tbl": 1, "t10/tbl": 2}"#,
        )
        .unwrap();
        let failed = delete_org_in(&cache_dir, "t1").await;
        let metadata_after_failure =
            std::fs::read_to_string(cache_dir.join("metadata.json")).unwrap();
        std::fs::remove_file(cache_dir.join("t1")).unwrap();
        std::fs::create_dir_all(cache_dir.join("t1/tbl")).unwrap();
        std::fs::write(cache_dir.join("t1/tbl/1.parquet"), b"x").unwrap();
        let retried = delete_org_in(&cache_dir, "t1").await;
        let metadata = std::fs::read_to_string(cache_dir.join("metadata.json")).unwrap();
        let t1_gone = !cache_dir.join("t1").exists();
        let t10_kept = cache_dir.join("t10/tbl").exists();
        std::fs::remove_dir_all(&cache_dir).unwrap();
        assert!(
            failed.is_err(),
            "a directory that cannot be removed fails the delete"
        );
        assert!(
            metadata_after_failure.contains("t1/tbl"),
            "a failed delete keeps the entry for the retry: {metadata_after_failure}"
        );
        retried.unwrap();
        assert!(
            t1_gone && t10_kept,
            "t1 gone: {t1_gone}, t10 kept: {t10_kept}"
        );
        assert!(
            !metadata.contains("\"t1/tbl\"") && metadata.contains("t10/tbl"),
            "{metadata}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_concurrent_metadata_updates_keep_every_entry() {
        let cache_dir = scratch_dir("lock");
        std::fs::create_dir_all(&cache_dir).unwrap();
        let path = cache_dir.join("metadata.json");
        let writers: Vec<_> = (0..32i64)
            .map(|i| {
                let path = path.clone();
                tokio::spawn(async move {
                    update_metadata_at(&path, |metadata| {
                        metadata.insert(format!("org{i}/tbl"), i);
                        true
                    })
                    .await
                })
            })
            .collect();
        let mut results = Vec::new();
        for writer in writers {
            results.push(writer.await.unwrap());
        }
        let metadata = read_metadata(&path).await;
        std::fs::remove_dir_all(&cache_dir).unwrap();
        for result in results {
            result.unwrap();
        }
        assert_eq!(metadata.unwrap().len(), 32, "a concurrent update was lost");
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "o2-enrichment-{tag}-{}-{}",
            std::process::id(),
            crate::utils::time::now_micros()
        ))
    }
}
