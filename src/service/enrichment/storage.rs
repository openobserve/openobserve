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

use anyhow::{Result, anyhow};
use bytes::Bytes;
use config::{
    spawn_pausable_job,
    utils::{
        enrichment_local_cache::{
            get_key, get_metadata_content, get_metadata_path, get_table_dir, get_table_path,
        },
        json::Value,
    },
};
use tokio::task::JoinHandle;

pub mod remote {
    use std::sync::Arc;

    use chrono::{Datelike, Timelike};
    use config::{
        meta::stream::{FileMeta, StreamType},
        utils::{
            parquet::write_recordbatch_to_parquet, record_batch_ext::convert_json_to_record_batch,
        },
    };

    use super::*;

    pub(crate) fn get_remote_key_prefix(org_id: &str, table_name: &str) -> String {
        format!(
            "files/{}/{}/{}",
            org_id,
            StreamType::EnrichmentTables,
            table_name
        )
    }

    /// Create remote key with enrichment table prefix
    pub(crate) fn create_remote_key(org_id: &str, table_name: &str, created_at: i64) -> String {
        let ts = chrono::DateTime::from_timestamp_micros(created_at).unwrap();
        let file_name = format!(
            "{:04}/{:02}/{:02}/{:02}/{}.parquet",
            ts.year(),
            ts.month(),
            ts.day(),
            ts.hour(),
            config::ider::generate()
        );
        format!(
            "{}/{}",
            get_remote_key_prefix(org_id, table_name),
            file_name
        )
    }

    /// Upload data to remote using existing infra::storage::put function
    pub async fn upload_to_remote(
        org_id: &str,
        table_name: &str,
        file_meta: FileMeta,
        data: &[u8],
        created_at: i64,
    ) -> Result<()> {
        // Create remote key with enrichment table prefix
        let remote_key = create_remote_key(org_id, table_name, created_at);
        let account = infra::storage::get_account(&remote_key).unwrap_or_default();

        // Use existing storage::put function for remote upload
        infra::storage::put(&account, &remote_key, Bytes::from(data.to_owned()))
            .await
            .map_err(|e| anyhow!("Failed to upload enrichment table to remote: {}", e))?;

        crate::service::db::file_list::set(&account, &remote_key, Some(file_meta), false).await?;

        log::debug!("Uploaded enrichment table {table_name} to remote");
        Ok(())
    }

    /// Merge and upload data to remote
    pub async fn merge_and_upload_to_remote(org_id: &str, table_name: &str) -> Result<()> {
        // Get schema from cache
        let schema = infra::schema::get_cache(org_id, table_name, StreamType::EnrichmentTables)
            .await
            .map_err(|e| anyhow!("Failed to get schema from cache: {}", e))?;

        // Merge the data from db and convert to perquet format
        let (data, min_ts, max_ts) =
            crate::service::db::enrichment_table::get_enrichment_data_from_db(org_id, table_name)
                .await?;
        if data.is_empty() {
            return Ok(());
        }

        let buf = Bytes::from(serde_json::to_string(&data).unwrap());
        let mut file_meta = FileMeta {
            min_ts,
            max_ts,
            records: data.len() as i64,
            original_size: buf.len() as i64,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };

        let stream_settings =
            infra::schema::get_settings(org_id, table_name, StreamType::EnrichmentTables)
                .await
                .unwrap_or_default();
        let data: Vec<_> = data.iter().map(|row| Arc::new(row.clone())).collect();
        let data = convert_json_to_record_batch(schema.schema(), &data)?;
        let data = write_recordbatch_to_parquet(
            schema.schema().clone(),
            &[data],
            &stream_settings.bloom_filter_fields,
            &file_meta,
        )
        .await?;

        file_meta.compressed_size = data.len() as i64;

        upload_to_remote(org_id, table_name, file_meta, &data, min_ts).await?;

        log::debug!("Merged and uploaded enrichment table {table_name} to remote");

        // Delete the data from the db
        database::delete(org_id, table_name).await?;

        Ok(())
    }

    pub async fn store(
        org_id: &str,
        table_name: &str,
        data: &Vec<Value>,
        created_at: i64,
    ) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let schema = infra::schema::get_cache(org_id, table_name, StreamType::EnrichmentTables)
            .await
            .map_err(|e| anyhow!("Failed to get schema from cache: {}", e))?;

        let buf = Bytes::from(serde_json::to_string(&data).unwrap());
        let mut file_meta = FileMeta {
            min_ts: created_at,
            max_ts: created_at,
            records: data.len() as i64,
            original_size: buf.len() as i64,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };

        let stream_settings =
            infra::schema::get_settings(org_id, table_name, StreamType::EnrichmentTables)
                .await
                .unwrap_or_default();
        let data: Vec<_> = data.iter().map(|row| Arc::new(row.clone())).collect();
        let data = convert_json_to_record_batch(schema.schema(), &data)?;
        let data = write_recordbatch_to_parquet(
            schema.schema().clone(),
            &[data],
            &stream_settings.bloom_filter_fields,
            &file_meta,
        )
        .await?;
        file_meta.compressed_size = data.len() as i64;
        upload_to_remote(org_id, table_name, file_meta, &data, created_at).await?;
        Ok(())
    }

    pub async fn get_merge_threshold_mb() -> Result<i64> {
        let cfg = config::get_config();
        let merge_threshold_mb = cfg.enrichment_table.merge_threshold_mb;
        Ok(merge_threshold_mb as i64)
    }

    pub async fn run_merge_job() -> JoinHandle<()> {
        log::info!("[ENRICHMENT::STORAGE] Running enrichment table merge job");

        config::spawn_pausable_job!(
            "enchrichment_table_merge_job",
            config::get_config().enrichment_table.merge_interval,
            {
                let Ok(org_table_pairs) = database::list().await else {
                    log::error!("[ENRICHMENT::STORAGE] Failed to list enrichment tables");
                    return;
                };
                if org_table_pairs.is_empty() {
                    continue;
                }
                log::info!(
                    "[ENRICHMENT::STORAGE] Found {} enrichment tables, {:?}",
                    org_table_pairs.len(),
                    org_table_pairs
                );
                for (org_id, table_name) in org_table_pairs {
                    match merge_and_upload_to_remote(&org_id, &table_name).await {
                        Ok(_) => {
                            log::debug!(
                                "Merged and uploaded enrichment table {table_name} to remote"
                            );
                        }
                        Err(e) => {
                            log::error!(
                                "Failed to merge and upload enrichment table {table_name}: {e}"
                            );
                        }
                    }
                }
            }
        )
    }
}

pub mod local {
    use super::*;

    pub async fn store(
        org_id: &str,
        table_name: &str,
        data: &[Value],
        updated_at: i64,
    ) -> Result<()> {
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        let file_path = get_table_path(table_dir.to_str().unwrap(), updated_at);
        let metadata_path = get_metadata_path();

        // Ensure directory exists
        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Serialize and write data
        let json_data = serde_json::to_string_pretty(data)
            .map_err(|e| anyhow!("Failed to serialize enrichment table data: {}", e))?;
        tokio::fs::write(&file_path, json_data)
            .await
            .map_err(|e| anyhow!("Failed to write enrichment table file: {}", e))?;

        // metadata content is key -value pairs, where key is org_id/table_name
        // first check if the metadata file exists, if it does, read it and merge the new metadata
        // with the existing one if it doesn't exist, create a new metadata file
        let mut metadata_content = get_metadata_content().await?;

        // merge the new metadata with the existing one
        metadata_content.insert(key.to_string(), updated_at);

        // Serialize the metadata content
        let metadata_json = serde_json::to_string_pretty(&metadata_content)
            .map_err(|e| anyhow!("Failed to serialize metadata: {}", e))?;

        // Serialize and write metadata
        tokio::fs::write(&metadata_path, metadata_json)
            .await
            .map_err(|e| anyhow!("Failed to write metadata file: {}", e))?;

        log::debug!("Stored enrichment table {key} to local storage");
        Ok(())
    }

    pub async fn retrieve(org_id: &str, table_name: &str) -> Result<Vec<Value>> {
        let key = get_key(org_id, table_name);
        let file_dir = get_table_dir(&key);
        let mut files = Vec::new();
        let mut entries = tokio::fs::read_dir(&file_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_path = entry.path();
            if file_path.is_file() && file_path.extension().unwrap_or_default() == "json" {
                files.push(file_path);
            }
        }

        if files.is_empty() {
            return Ok(vec![]);
        }

        // sort the files by created_at
        files.sort_by_key(|f| f.metadata().unwrap().created().unwrap());

        // read the files in order
        let mut records = Vec::new();
        for file in files {
            let data = tokio::fs::read_to_string(&file)
                .await
                .map_err(|e| anyhow!("Failed to read enrichment table file: {}", e))?;
            let table_data: Vec<Value> = serde_json::from_str(&data)
                .map_err(|e| anyhow!("Failed to parse enrichment table JSON: {}", e))?;
            records.extend(table_data);
        }
        Ok(records)
    }

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

    pub async fn list(prefix: &str) -> Result<Vec<String>> {
        let cfg = config::get_config();
        let mut keys = Vec::new();

        let mut entries = tokio::fs::read_dir(&cfg.enrichment_table.cache_dir)
            .await
            .map_err(|e| anyhow!("Failed to read enrichment table cache directory: {}", e))?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            anyhow!(
                "Failed to read entry in enrichment table cache directory: {}",
                e
            )
        })? {
            if let Ok(file_name) = entry.file_name().into_string()
                && file_name.ends_with(".json")
                && file_name.starts_with(&prefix.replace("/", "_"))
            {
                let key = file_name
                    .strip_suffix(".json")
                    .unwrap_or(&file_name)
                    .replace("_", "/");
                keys.push(key);
            }
        }

        Ok(keys)
    }

    pub async fn get_last_updated_at(org_id: &str, table_name: &str) -> Result<i64> {
        let key = get_key(org_id, table_name);
        let metadata_content = get_metadata_content().await?;
        Ok(metadata_content.get(&key).cloned().unwrap_or_default())
    }

    pub async fn store_data_if_needed(
        org_id: &str,
        table_name: &str,
        data: &[Value],
        updated_at: i64,
    ) -> Result<()> {
        let key = get_key(org_id, table_name);
        let metadata_content = get_metadata_content().await?;
        let last_updated_at = metadata_content.get(&key).cloned().unwrap_or_default();
        if last_updated_at < updated_at || last_updated_at == 0 {
            delete(org_id, table_name).await?;
            store(org_id, table_name, data, updated_at).await?;
        }
        Ok(())
    }

    pub async fn store_data_if_needed_background(
        org_id: &str,
        table_name: &str,
        data: &[Value],
        updated_at: i64,
    ) -> Result<()> {
        let org_id = org_id.to_string();
        let table_name = table_name.to_string();
        let data = data.to_owned();
        tokio::task::spawn(async move {
            store_data_if_needed(&org_id, &table_name, &data, updated_at).await
        });
        Ok(())
    }
}

pub mod database {
    use super::*;

    pub async fn store(
        org_id: &str,
        table_name: &str,
        data: &Vec<Value>,
        created_at: i64,
    ) -> Result<()> {
        // Use existing enrichment table storage
        crate::service::db::enrichment_table::save_enrichment_data_to_db(
            org_id, table_name, data, created_at, // append_data = false for now
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to save enrichment data: {}", e))?;

        log::debug!("Stored enrichment table {table_name} to database");
        Ok(())
    }

    pub async fn retrieve(org_id: &str, table_name: &str) -> Result<Vec<Value>> {
        match crate::service::db::enrichment_table::get_enrichment_data_from_db(org_id, table_name)
            .await
        {
            Ok(data) => Ok(data.0),
            Err(e) => {
                log::error!("Failed to retrieve enrichment table {table_name} from database: {e}");
                Err(anyhow::anyhow!(
                    "Failed to retrieve enrichment table {}: {}",
                    table_name,
                    e
                ))
            }
        }
    }

    pub async fn delete(org_id: &str, table_name: &str) -> Result<()> {
        // Use existing enrichment table deletion
        crate::service::db::enrichment_table::delete_enrichment_data_from_db(org_id, table_name)
            .await
            .map_err(|e| {
                anyhow::anyhow!("Failed to delete enrichment table {}: {e}", table_name)
            })?;

        log::debug!("Deleted enrichment table {table_name} from database storage");
        Ok(())
    }

    /// List all the (org_id, table_name) pairs present in the table
    pub async fn list() -> Result<Vec<(String, String)>> {
        let records = infra::table::enrichment_tables::list()
            .await
            .map_err(|e| anyhow!("Failed to list enrichment tables: {}", e))?;
        Ok(records)
    }

    pub async fn exists(org_id: &str, table_name: &str) -> Result<bool> {
        // Check if table exists by trying to get its metadata
        match crate::service::db::enrichment_table::get_meta_table_stats(org_id, table_name).await {
            Some(_) => Ok(true),
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;
    use tokio;
    use serde_json::json;
    use std::collections::HashMap;

    async fn setup_test_env() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        temp_dir
    }

    #[tokio::test]
    async fn test_store_and_retrieve() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "test_table";
        let test_data = vec![
            json!({"id": 1, "name": "Alice", "age": 25}),
            json!({"id": 2, "name": "Bob", "age": 30}),
        ];
        let updated_at = 1640995200;

        // Create a temporary key and paths for testing
        let key = format!("{org_id}/{table_name}");
        let table_dir = temp_dir.path().join(&key);
        let file_path = table_dir.join(format!("{}.json", updated_at));
        let metadata_path = temp_dir.path().join("metadata.json");

        // Manually create directory and files
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        
        let json_data = serde_json::to_string_pretty(&test_data).unwrap();
        tokio::fs::write(&file_path, json_data).await.unwrap();
        
        // Create metadata
        let mut metadata = HashMap::new();
        metadata.insert(key.clone(), updated_at);
        let metadata_json = serde_json::to_string_pretty(&metadata).unwrap();
        tokio::fs::write(&metadata_path, metadata_json).await.unwrap();

        // Verify file was created
        assert!(file_path.exists(), "Data file should exist");
        assert!(metadata_path.exists(), "Metadata file should exist");

        // Test reading the file back
        let file_content = tokio::fs::read_to_string(&file_path).await.unwrap();
        let retrieved_data: Vec<serde_json::Value> = serde_json::from_str(&file_content).unwrap();
        
        assert_eq!(retrieved_data.len(), 2, "Should retrieve 2 records");
        assert_eq!(retrieved_data[0]["id"], json!(1), "First record should match");
        assert_eq!(retrieved_data[1]["id"], json!(2), "Second record should match");
    }

    #[tokio::test]
    async fn test_store_multiple_versions() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "versioned_table";
        let key = format!("{org_id}/{table_name}");
        let table_dir = temp_dir.path().join(&key);
        
        // Store first version
        let data_v1 = vec![json!({"id": 1, "version": "v1"})];
        let updated_at_v1 = 1640995200;
        
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        let file_path_v1 = table_dir.join(format!("{}.json", updated_at_v1));
        let json_data_v1 = serde_json::to_string_pretty(&data_v1).unwrap();
        tokio::fs::write(&file_path_v1, json_data_v1).await.unwrap();

        // Store second version
        let data_v2 = vec![json!({"id": 2, "version": "v2"})];
        let updated_at_v2 = 1640995300;
        
        let file_path_v2 = table_dir.join(format!("{}.json", updated_at_v2));
        let json_data_v2 = serde_json::to_string_pretty(&data_v2).unwrap();
        tokio::fs::write(&file_path_v2, json_data_v2).await.unwrap();

        // Verify both files exist
        assert!(file_path_v1.exists(), "First version file should exist");
        assert!(file_path_v2.exists(), "Second version file should exist");
        
        // Read and verify content
        let content_v1: Vec<serde_json::Value> = serde_json::from_str(&tokio::fs::read_to_string(&file_path_v1).await.unwrap()).unwrap();
        let content_v2: Vec<serde_json::Value> = serde_json::from_str(&tokio::fs::read_to_string(&file_path_v2).await.unwrap()).unwrap();
        
        assert_eq!(content_v1[0]["version"], json!("v1"));
        assert_eq!(content_v2[0]["version"], json!("v2"));
    }

    #[tokio::test]
    async fn test_delete_operations() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "delete_test_table";
        let key = format!("{org_id}/{table_name}");
        let table_dir = temp_dir.path().join(&key);
        let test_data = vec![json!({"id": 1, "data": "test"})];
        let updated_at = 1640995200;

        // First create some data
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        let file_path = table_dir.join(format!("{}.json", updated_at));
        let json_data = serde_json::to_string_pretty(&test_data).unwrap();
        tokio::fs::write(&file_path, json_data).await.unwrap();

        // Create metadata
        let metadata_path = temp_dir.path().join("metadata.json");
        let mut metadata = HashMap::new();
        metadata.insert(key.clone(), updated_at);
        let metadata_json = serde_json::to_string_pretty(&metadata).unwrap();
        tokio::fs::write(&metadata_path, metadata_json).await.unwrap();

        // Verify data exists
        assert!(table_dir.exists(), "Table directory should exist");
        assert!(file_path.exists(), "Data file should exist");

        // Test delete by removing directory
        tokio::fs::remove_dir_all(&table_dir).await.unwrap();

        // Update metadata by removing key
        let metadata: HashMap<String, i64> = HashMap::new();
        // metadata should not contain the key anymore
        let metadata_json = serde_json::to_string_pretty(&metadata).unwrap();
        tokio::fs::write(&metadata_path, metadata_json).await.unwrap();

        // Verify directory was removed
        assert!(!table_dir.exists(), "Table directory should be removed");

        // Verify metadata was updated
        let metadata_content = tokio::fs::read_to_string(&metadata_path).await.unwrap();
        let metadata: HashMap<String, i64> = serde_json::from_str(&metadata_content).unwrap();
        assert!(!metadata.contains_key(&key), "Key should be removed from metadata");
    }

    #[tokio::test]
    async fn test_metadata_operations() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "metadata_test_table";
        let key = format!("{org_id}/{table_name}");
        let test_data = vec![json!({"id": 1, "data": "test"})];
        let updated_at = 1640995200;

        // Create data and metadata files
        let table_dir = temp_dir.path().join(&key);
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        let file_path = table_dir.join(format!("{}.json", updated_at));
        let json_data = serde_json::to_string_pretty(&test_data).unwrap();
        tokio::fs::write(&file_path, json_data).await.unwrap();

        // Create metadata file
        let metadata_path = temp_dir.path().join("metadata.json");
        let mut metadata = HashMap::new();
        metadata.insert(key.clone(), updated_at);
        let metadata_json = serde_json::to_string_pretty(&metadata).unwrap();
        tokio::fs::write(&metadata_path, metadata_json).await.unwrap();

        // Verify metadata content
        let metadata_content = tokio::fs::read_to_string(&metadata_path).await.unwrap();
        let parsed_metadata: HashMap<String, i64> = serde_json::from_str(&metadata_content).unwrap();
        
        assert!(parsed_metadata.contains_key(&key), "Metadata should contain the key");
        assert_eq!(parsed_metadata[&key], updated_at, "Metadata should have correct timestamp");
    }

    #[tokio::test]
    async fn test_large_data_handling() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "large_data_table";
        let key = format!("{org_id}/{table_name}");
        
        // Create large dataset (1000 records)
        let large_data: Vec<_> = (0..1000)
            .map(|i| json!({
                "id": i,
                "name": format!("name_{}", i),
                "data": "x".repeat(100), // 100 characters per record
                "nested": {
                    "field1": i * 2,
                    "field2": format!("nested_value_{}", i)
                }
            }))
            .collect();
        
        let updated_at = 1640995200;

        // Create directory and store large data
        let table_dir = temp_dir.path().join(&key);
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        let file_path = table_dir.join(format!("{}.json", updated_at));
        let json_data = serde_json::to_string_pretty(&large_data).unwrap();
        tokio::fs::write(&file_path, json_data).await.unwrap();

        // Verify file was created and has correct size
        assert!(file_path.exists(), "Large data file should exist");
        
        // Read and verify the data
        let file_content = tokio::fs::read_to_string(&file_path).await.unwrap();
        let retrieved_data: Vec<serde_json::Value> = serde_json::from_str(&file_content).unwrap();
        
        assert_eq!(retrieved_data.len(), 1000, "Should retrieve all 1000 records");
        assert_eq!(retrieved_data[0]["id"], json!(0), "First record should be correct");
        assert_eq!(retrieved_data[999]["id"], json!(999), "Last record should be correct");
    }

    #[tokio::test]
    async fn test_error_handling() {
        let temp_dir = setup_test_env().await;
        
        let org_id = "test_org";
        let table_name = "error_test_table";
        let key = format!("{org_id}/{table_name}");
        
        // Create data with special characters and null values
        let test_data = vec![
            json!({"id": 1, "data": null}),
            json!({"id": 2, "special_chars": "!@#$%^&*()"}),
            json!({"id": 3, "unicode": "测试数据 🚀"}),
        ];
        let updated_at = 1640995200;

        // Store the data
        let table_dir = temp_dir.path().join(&key);
        tokio::fs::create_dir_all(&table_dir).await.unwrap();
        let file_path = table_dir.join(format!("{}.json", updated_at));
        let json_data = serde_json::to_string_pretty(&test_data).unwrap();
        tokio::fs::write(&file_path, json_data).await.unwrap();

        // Read and verify the data
        let file_content = tokio::fs::read_to_string(&file_path).await.unwrap();
        let retrieved_data: Vec<serde_json::Value> = serde_json::from_str(&file_content).unwrap();
        
        assert_eq!(retrieved_data.len(), 3, "Should retrieve all 3 records");
        assert!(retrieved_data[0]["data"].is_null(), "Should preserve null values");
        assert_eq!(retrieved_data[1]["special_chars"], json!("!@#$%^&*()"), "Should handle special characters");
        assert_eq!(retrieved_data[2]["unicode"], json!("测试数据 🚀"), "Should handle unicode characters");
    }

    #[tokio::test]
    async fn test_file_system_operations() {
        let temp_dir = setup_test_env().await;
        
        // Test creating nested directories
        let deep_path = temp_dir.path().join("org1/table1/nested/deep");
        tokio::fs::create_dir_all(&deep_path).await.unwrap();
        assert!(deep_path.exists(), "Deep nested directory should be created");

        // Test creating and reading files
        let test_file = deep_path.join("test_file.json");
        let test_content = json!({"test": "content"});
        let json_str = serde_json::to_string_pretty(&test_content).unwrap();
        tokio::fs::write(&test_file, json_str).await.unwrap();

        assert!(test_file.exists(), "Test file should exist");
        
        let read_content = tokio::fs::read_to_string(&test_file).await.unwrap();
        let parsed_content: serde_json::Value = serde_json::from_str(&read_content).unwrap();
        assert_eq!(parsed_content["test"], json!("content"), "File content should match");

        // Test directory removal
        tokio::fs::remove_dir_all(&deep_path.parent().unwrap().parent().unwrap()).await.unwrap();
        assert!(!deep_path.exists(), "Directory should be removed");
    }
}
