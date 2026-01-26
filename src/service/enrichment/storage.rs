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

use std::sync::Arc;

use anyhow::{Result, anyhow};
use arrow::array::{Array, Int64Array, RecordBatch};
use arrow_schema::SchemaRef;
use bytes::Bytes;
use config::{
    PARQUET_BATCH_SIZE, TIMESTAMP_COL_NAME, spawn_pausable_job,
    utils::{
        enrichment_local_cache::{
            get_key, get_metadata_content, get_metadata_path, get_table_dir, get_table_path,
        },
        json::Value,
        record_batch_ext::{convert_json_to_record_batch, convert_vrl_to_record_batch},
    },
};
use rayon::prelude::*;
use tokio::task::JoinHandle;

#[derive(Debug, Clone)]
pub enum Values {
    Json(Arc<Vec<serde_json::Value>>),
    Vrl(Arc<Vec<vrl::value::Value>>),
    RecordBatch(Vec<RecordBatch>),
}

impl Values {
    pub fn len(&self) -> usize {
        match self {
            Values::Json(data) => data.len(),
            Values::Vrl(data) => data.len(),
            Values::RecordBatch(batches) => batches.iter().map(|b| b.num_rows()).sum(),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            Values::Json(data) => data.is_empty(),
            Values::Vrl(data) => data.is_empty(),
            Values::RecordBatch(batches) => batches.iter().all(|b| b.num_rows() == 0),
        }
    }

    pub fn last_updated_at(&self) -> i64 {
        match self {
            Values::RecordBatch(batches) => {
                let mut max_ts = 0;
                for batch in batches {
                    if let Some(column) = batch.column_by_name(TIMESTAMP_COL_NAME)
                        && let Some(array) = column.as_any().downcast_ref::<Int64Array>()
                    {
                        for v in array.values() {
                            if *v > max_ts {
                                max_ts = *v;
                            }
                        }
                    }
                }
                max_ts
            }
            Values::Json(data) => data
                .iter()
                .map(|r| r.get(TIMESTAMP_COL_NAME).unwrap().as_i64().unwrap())
                .max()
                .unwrap(),
            _ => unimplemented!("last_updated_at is not implement for vrl"),
        }
    }

    /// Convert to JSON format if not already in that format
    pub fn to_json(&self) -> Result<Arc<Vec<serde_json::Value>>> {
        match self {
            Values::Json(data) => Ok(Arc::clone(data)),
            Values::Vrl(data) => {
                let pool = rayon::ThreadPoolBuilder::new()
                    .num_threads(config::get_config().limit.cpu_num)
                    .build()?;
                let json_data = pool.install(|| {
                    data.par_iter()
                        .map(crate::service::db::enrichment_table::convert_from_vrl)
                        .collect()
                });
                Ok(Arc::new(json_data))
            }
            Values::RecordBatch(batches) => {
                let mut records = Vec::new();
                for batch in batches {
                    let mut buf = Vec::new();
                    let mut writer = arrow_json::ArrayWriter::new(&mut buf);
                    writer
                        .write(batch)
                        .map_err(|e| anyhow!("Failed to write batch as JSON: {e}"))?;
                    writer
                        .finish()
                        .map_err(|e| anyhow!("Failed to finish JSON writer: {e}"))?;

                    let json_str = String::from_utf8(buf)
                        .map_err(|e| anyhow!("Failed to convert JSON bytes to string: {e}"))?;
                    let batch_data: Vec<Value> = serde_json::from_str(&json_str)
                        .map_err(|e| anyhow!("Failed to parse JSON: {e}"))?;
                    records.extend(batch_data);
                }
                Ok(Arc::new(records))
            }
        }
    }

    /// Convert to VRL format if not already in that format
    pub fn to_vrl(&self) -> Result<Arc<Vec<vrl::value::Value>>> {
        match self {
            Values::Vrl(data) => Ok(Arc::clone(data)),
            Values::Json(data) => {
                let pool = rayon::ThreadPoolBuilder::new()
                    .num_threads(config::get_config().limit.cpu_num)
                    .build()?;
                let vrl_data = pool.install(|| {
                    data.par_iter()
                        .map(crate::service::db::enrichment_table::convert_to_vrl)
                        .collect()
                });
                Ok(Arc::new(vrl_data))
            }
            Values::RecordBatch(batches) => {
                // Convert RecordBatch directly to VRL without intermediate JSON
                let vrl_data =
                    crate::service::db::enrichment_table::convert_recordbatch_to_vrl(batches)?;
                Ok(Arc::new(vrl_data))
            }
        }
    }

    /// Convert to RecordBatch format if not already in that format
    pub fn to_record_batch(&self, schema: &SchemaRef) -> Result<Vec<RecordBatch>> {
        match self {
            Values::RecordBatch(batches) => Ok(batches.clone()),
            Values::Vrl(data) => {
                let chunks: Vec<&[vrl::value::Value]> =
                    data.as_ref().chunks(PARQUET_BATCH_SIZE).collect();

                chunks
                    .iter()
                    .map(|chunk| convert_vrl_to_record_batch(schema, chunk))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| anyhow!("Failed to convert VRL to RecordBatch: {}", e))
            }
            Values::Json(data) => {
                let data_refs: Vec<_> = data.iter().map(|row| Arc::new(row.clone())).collect();
                convert_json_to_record_batch(schema, &data_refs)
                    .map(|batch| vec![batch])
                    .map_err(|e| anyhow!("Failed to convert JSON to RecordBatch: {}", e))
            }
        }
    }
}

pub mod remote {
    use std::sync::Arc;

    use chrono::{Datelike, Timelike};
    use config::{
        meta::stream::{FileMeta, StreamType},
        utils::{
            json::estimate_json_bytes, parquet::write_recordbatch_to_parquet,
            record_batch_ext::convert_json_to_record_batch,
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

        // Merge the data from db and convert to parquet format
        // Pass None for end_time to fetch all data (not in search context)
        let (data, min_ts, max_ts) =
            crate::service::db::enrichment_table::get_enrichment_data_from_db(
                org_id, table_name, None,
            )
            .await?;
        if data.is_empty() {
            return Ok(());
        }

        let original_size = data.iter().map(estimate_json_bytes).sum::<usize>() as i64;
        let mut file_meta = FileMeta {
            min_ts,
            max_ts,
            records: data.len() as i64,
            original_size,
            compressed_size: original_size,
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
        data: &[Value],
        created_at: i64,
    ) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let schema = infra::schema::get_cache(org_id, table_name, StreamType::EnrichmentTables)
            .await
            .map_err(|e| anyhow!("Failed to get schema from cache: {}", e))?;

        let original_size = data.iter().map(estimate_json_bytes).sum::<usize>() as i64;
        let mut file_meta = FileMeta {
            min_ts: created_at,
            max_ts: created_at,
            records: data.len() as i64,
            original_size,
            compressed_size: original_size,
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
    use config::{
        meta::stream::{FileMeta, StreamType},
        utils::parquet::write_recordbatch_to_parquet,
    };
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    use super::*;

    pub async fn store(
        org_id: &str,
        table_name: &str,
        data: Values,
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

        // Get schema from cache
        let schema = infra::schema::get_cache(org_id, table_name, StreamType::EnrichmentTables)
            .await
            .map_err(|e| anyhow!("Failed to get schema from cache: {e}"))?
            .schema()
            .clone();

        let data = data.to_record_batch(&schema)?;
        let file_meta = FileMeta {
            min_ts: updated_at,
            max_ts: updated_at,
            records: data.iter().map(|b| b.num_rows()).sum::<usize>() as i64,
            ..Default::default()
        };

        let parquet_data =
            write_recordbatch_to_parquet(schema.clone(), &data, &[], &file_meta).await?;

        // Write parquet data to file
        tokio::fs::write(&file_path, parquet_data)
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

    /// Retrieve enrichment table data as Values (optimized version)
    /// This returns data in RecordBatch format directly from parquet files,
    /// avoiding unnecessary conversions
    pub async fn retrieve(org_id: &str, table_name: &str) -> Result<Values> {
        let key = get_key(org_id, table_name);
        let file_dir = get_table_dir(&key);
        let mut files = Vec::new();
        let mut entries = tokio::fs::read_dir(&file_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_path = entry.path();
            if file_path.is_file() && file_path.extension().unwrap_or_default() == "parquet" {
                files.push(file_path);
            }
        }

        if files.is_empty() {
            return Ok(Values::RecordBatch(vec![]));
        }

        // sort the files by created_at
        files.sort_by_key(|f| f.metadata().unwrap().created().unwrap());

        // read the files in order and keep as RecordBatch
        let mut batches = Vec::new();
        for file in files {
            let file_content = tokio::fs::read(&file)
                .await
                .map_err(|e| anyhow!("Failed to read enrichment table file: {e}"))?;

            // Parse parquet file
            let reader = ParquetRecordBatchReaderBuilder::try_new(Bytes::from(file_content))
                .map_err(|e| anyhow!("Failed to create parquet reader: {e}"))?
                .build()
                .map_err(|e| anyhow!("Failed to build parquet reader: {e}"))?;

            for batch in reader {
                let batch = batch.map_err(|e| anyhow!("Failed to read record batch: {e}"))?;
                batches.push(batch);
            }
        }
        Ok(Values::RecordBatch(batches))
    }

    pub async fn delete(org_id: &str, table_name: &str) -> Result<()> {
        let key = get_key(org_id, table_name);
        let file_dir = get_table_dir(&key);
        let metadata_path = get_metadata_path();
        log::debug!(
            "enrichment table {org_id}/{table_name} to be deleted metadata path: {:?}",
            metadata_path
        );
        if !metadata_path.exists() {
            return Ok(());
        }

        log::debug!(
            "enrichment table {org_id}/{table_name} to be deleted metadata_path exists, file dir: {:?}",
            file_dir
        );
        if file_dir.exists() {
            tokio::fs::remove_dir_all(&file_dir)
                .await
                .map_err(|e| anyhow!("Failed to remove enrichment table file: {}", e))?;
        }

        log::debug!("enrichment table {org_id}/{table_name} to be deleted file dir removed");
        let mut metadata_content = get_metadata_content().await?;
        metadata_content.remove(&key);

        log::debug!(
            "enrichment table {org_id}/{table_name} to be deleted, metadata_content: {:?}",
            metadata_content
        );
        // Serialize the metadata content
        let metadata_json = serde_json::to_string_pretty(&metadata_content)
            .map_err(|e| anyhow!("Failed to serialize metadata: {}", e))?;

        log::debug!(
            "enrichment table {org_id}/{table_name} to be deleted metadata_json updated: {metadata_json}"
        );
        // Serialize and write metadata
        tokio::fs::write(&metadata_path, metadata_json)
            .await
            .map_err(|e| anyhow!("Failed to write metadata file: {}", e))?;

        log::debug!("Deleted enrichment table {key} from local storage");
        Ok(())
    }

    pub async fn get_last_updated_at(org_id: &str, table_name: &str) -> Result<i64> {
        let key = get_key(org_id, table_name);
        let metadata_content = get_metadata_content().await?;
        Ok(metadata_content.get(&key).cloned().unwrap_or_default())
    }

    pub async fn store_data_if_needed(
        org_id: &str,
        table_name: &str,
        data: Values,
        updated_at: i64,
    ) -> Result<()> {
        let key = get_key(org_id, table_name);
        let metadata_content = get_metadata_content().await?;
        let last_updated_at = metadata_content.get(&key).cloned().unwrap_or_default();
        log::debug!(
            "Checking if need to store the latest enrichment table here: metadata json updated: {last_updated_at}, updated at : {updated_at}"
        );
        if last_updated_at < updated_at || last_updated_at == 0 {
            delete(org_id, table_name).await?;
            store(org_id, table_name, data, updated_at).await?;
        }
        Ok(())
    }

    pub async fn store_data_if_needed_background(
        org_id: &str,
        table_name: &str,
        data: Values,
        updated_at: i64,
    ) -> Result<()> {
        let org_id = org_id.to_string();
        let table_name = table_name.to_string();
        tokio::task::spawn(async move {
            if let Err(e) = store_data_if_needed(&org_id, &table_name, data, updated_at).await {
                log::error!("Failed to save {org_id}/{table_name} data in the disk: {e}");
            }
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
    use std::{collections::HashMap, sync::Arc};

    use arrow::{
        array::RecordBatch,
        datatypes::{DataType, Field, Schema},
    };
    use serde_json::json;
    use tokio;

    use super::*;
    use crate::service::enrichment::storage::Values;

    // current ignore because it need database to get schema
    #[ignore]
    #[tokio::test]
    async fn test_all_sequential() {
        // Run all tests sequentially to avoid directory conflicts
        test_store_and_retrieve().await;
        test_store_multiple_versions().await;
        test_retrieve_nonexistent_table().await;
        test_delete().await;
        test_delete_nonexistent_table().await;
        test_get_last_updated_at().await;
        test_store_data_if_needed().await;
        test_store_data_if_needed_background().await;
        test_metadata_persistence().await;
        test_large_data_handling().await;
        test_error_handling().await;
    }

    async fn test_store_and_retrieve() {
        let org_id = "test_org";
        let table_name = "test_table";
        let test_data = vec![
            json!({"id": 1, "name": "Alice", "age": 25}),
            json!({"id": 2, "name": "Bob", "age": 30}),
        ];
        let updated_at = 1640995200;

        // Test store function
        let test_data = Values::Json(Arc::new(test_data));
        let result = local::store(org_id, table_name, test_data, updated_at).await;
        println!("Store result: {result:?}");
        assert!(result.is_ok(), "Store should succeed");

        // Verify file was created
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        let file_path = get_table_path(table_dir.to_str().unwrap(), updated_at);
        assert!(file_path.exists(), "Data file should exist");

        // Verify metadata was created
        let metadata_path = get_metadata_path();
        assert!(metadata_path.exists(), "Metadata file should exist");

        // Test retrieve function
        let retrieved_data = local::retrieve(org_id, table_name).await;
        assert!(retrieved_data.is_ok(), "Retrieve should succeed");

        let retrieved_data = retrieved_data.unwrap().to_json().unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve 2 records");
        assert_eq!(
            retrieved_data[0]["id"],
            json!(1),
            "First record should match"
        );
        assert_eq!(
            retrieved_data[1]["id"],
            json!(2),
            "Second record should match"
        );
    }

    async fn test_store_multiple_versions() {
        let org_id = "test_org";
        let table_name = "versioned_table";

        // Store first version
        let data_v1 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v1"})]));
        let updated_at_v1 = 1640995200;
        let result = local::store(org_id, table_name, data_v1, updated_at_v1).await;
        assert!(result.is_ok(), "First store should succeed");

        // Store second version
        let data_v2 = Values::Json(Arc::new(vec![json!({"id": 2, "version": "v2"})]));
        let updated_at_v2 = 1640995300;
        let result = local::store(org_id, table_name, data_v2, updated_at_v2).await;
        assert!(result.is_ok(), "Second store should succeed");

        // Retrieve should get both versions
        let retrieved_data = local::retrieve(org_id, table_name).await.unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve both versions");
    }

    async fn test_retrieve_nonexistent_table() {
        let result = local::retrieve("nonexistent_org", "nonexistent_table").await;
        assert!(
            result.is_err(),
            "Should return an error for nonexistent table"
        );
    }

    async fn test_delete() {
        let org_id = "test_org";
        let table_name = "delete_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // First store some data
        let result = local::store(org_id, table_name, test_data, updated_at).await;
        assert!(result.is_ok(), "Store should succeed");

        // Verify data exists
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        assert!(table_dir.exists(), "Table directory should exist");

        // Test delete function
        let result = local::delete(org_id, table_name).await;
        assert!(result.is_ok(), "Delete should succeed");

        // Verify directory was removed
        assert!(!table_dir.exists(), "Table directory should be removed");

        // Verify metadata was updated
        let metadata_content = get_metadata_content().await.unwrap();
        assert!(
            !metadata_content.contains_key(&key),
            "Key should be removed from metadata"
        );
    }

    async fn test_delete_nonexistent_table() {
        // Delete non-existent table should succeed gracefully
        let result = local::delete("nonexistent_org", "nonexistent_table").await;
        assert!(
            result.is_ok(),
            "Delete should handle nonexistent table gracefully"
        );
    }

    async fn test_get_last_updated_at() {
        let org_id = "test_org";
        let table_name = "timestamp_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // Test getting timestamp before storing data
        let result = local::get_last_updated_at(org_id, table_name).await;
        assert!(result.is_ok(), "Get last updated should succeed");
        assert_eq!(result.unwrap(), 0, "Should return 0 for non-existent table");

        // Store data
        local::store(org_id, table_name, test_data, updated_at)
            .await
            .unwrap();

        // Test getting timestamp after storing data
        let result = local::get_last_updated_at(org_id, table_name).await;
        assert!(result.is_ok(), "Get last updated should succeed");
        assert_eq!(
            result.unwrap(),
            updated_at,
            "Should return correct timestamp"
        );
    }

    async fn test_store_data_if_needed() {
        let org_id = "test_org";
        let table_name = "conditional_test_table";
        let test_data_v1 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v1"})]));
        let test_data_v2 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v2"})]));
        let updated_at_v1 = 1640995200;
        let updated_at_v2 = 1640995300;

        // Store initial data
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v1, updated_at_v1).await;
        assert!(result.is_ok(), "Initial store should succeed");

        // Verify data was stored
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v1"),
            "Should have v1 data"
        );

        // Try to store older data (should be ignored)
        let old_updated_at = 1640995100;
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v2.clone(), old_updated_at)
                .await;
        assert!(
            result.is_ok(),
            "Store with old timestamp should succeed but not update"
        );

        // Verify data wasn't changed
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v1"),
            "Should still have v1 data"
        );

        // Store newer data (should update)
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v2, updated_at_v2).await;
        assert!(result.is_ok(), "Store with newer timestamp should succeed");

        // Verify data was updated
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v2"),
            "Should now have v2 data"
        );
    }

    async fn test_store_data_if_needed_background() {
        let org_id = "test_org";
        let table_name = "background_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "background"})]));
        let updated_at = 1640995200;

        // Test background store
        let result =
            local::store_data_if_needed_background(org_id, table_name, test_data, updated_at).await;
        assert!(result.is_ok(), "Background store should succeed");

        // Wait a bit for background task to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Verify data was eventually stored
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(retrieved_data.len(), 1, "Should have stored 1 record");
        assert_eq!(
            retrieved_data[0]["data"],
            json!("background"),
            "Should have correct data"
        );
    }

    async fn test_metadata_persistence() {
        let org_id = "test_org";
        let table_name = "metadata_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // Store data
        local::store(org_id, table_name, test_data, updated_at)
            .await
            .unwrap();

        // Manually read metadata file
        let metadata_path = get_metadata_path();
        let metadata_content = tokio::fs::read_to_string(&metadata_path).await.unwrap();
        let metadata: HashMap<String, i64> = serde_json::from_str(&metadata_content).unwrap();

        let key = get_key(org_id, table_name);
        assert!(
            metadata.contains_key(&key),
            "Metadata should contain the key"
        );
        assert_eq!(
            metadata[&key], updated_at,
            "Metadata should have correct timestamp"
        );
    }

    async fn test_large_data_handling() {
        let org_id = "test_org";
        let table_name = "large_data_table";

        // Create large dataset (1000 records)
        let large_data: Vec<_> = (0..1000)
            .map(|i| {
                json!({
                    "id": i,
                    "name": format!("name_{}", i),
                    "data": "x".repeat(100), // 100 characters per record
                    "nested": {
                        "field1": i * 2,
                        "field2": format!("nested_value_{}", i)
                    }
                })
            })
            .collect();

        let updated_at = 1640995200;

        // Test storing large data
        let large_data = Values::Json(Arc::new(large_data));
        let result = local::store(org_id, table_name, large_data, updated_at).await;
        assert!(result.is_ok(), "Should handle large data successfully");

        // Test retrieving large data
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data.len(),
            1000,
            "Should retrieve all 1000 records"
        );
        assert_eq!(
            retrieved_data[0]["id"],
            json!(0),
            "First record should be correct"
        );
        assert_eq!(
            retrieved_data[999]["id"],
            json!(999),
            "Last record should be correct"
        );
    }

    async fn test_error_handling() {
        // Test with invalid JSON data
        let org_id = "test_org";
        let table_name = "error_test_table";

        // Create data that will serialize fine but test edge cases
        let test_data = Values::Json(Arc::new(vec![
            json!({"id": 1, "data": null}),
            json!({"id": 2, "special_chars": "!@#$%^&*()"}),
        ]));
        let updated_at = 1640995200;

        let result = local::store(org_id, table_name, test_data, updated_at).await;
        assert!(
            result.is_ok(),
            "Should handle special characters and null values"
        );

        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve both records");
        assert!(
            retrieved_data[0]["data"].is_null(),
            "Should preserve null values"
        );
    }

    #[test]
    fn test_values_conversions() {
        // Test JSON -> JSON (no conversion)
        let json_data = Arc::new(vec![
            serde_json::json!({"name": "Alice", "age": 30}),
            serde_json::json!({"name": "Bob", "age": 25}),
        ]);
        let value_type = Values::Json(Arc::clone(&json_data));
        let result = value_type.to_json().unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["name"], "Alice");

        // Test JSON -> VRL
        let vrl_data = value_type.to_vrl().unwrap();
        assert_eq!(vrl_data.len(), 2);

        // Test VRL -> VRL (no conversion)
        let value_type_vrl = Values::Vrl(Arc::clone(&vrl_data));
        let result_vrl = value_type_vrl.to_vrl().unwrap();
        assert_eq!(result_vrl.len(), 2);

        // Test VRL -> JSON
        let json_from_vrl = value_type_vrl.to_json().unwrap();
        assert_eq!(json_from_vrl.len(), 2);
    }

    #[test]
    fn test_values_record_batch_conversion() {
        use arrow::array::{Int64Array, StringArray};

        // Create a simple RecordBatch
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));

        let name_array = StringArray::from(vec!["Alice", "Bob"]);
        let age_array = Int64Array::from(vec![30, 25]);

        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(name_array), Arc::new(age_array)],
        )
        .unwrap();

        let value_type = Values::RecordBatch(vec![batch]);

        // Test RecordBatch -> JSON
        let json_data = value_type.to_json().unwrap();
        assert_eq!(json_data.len(), 2);
        assert_eq!(json_data[0]["name"], "Alice");
        assert_eq!(json_data[0]["age"], 30);

        // Test RecordBatch -> RecordBatch (no conversion)
        let result_batch = value_type.to_record_batch(&schema).unwrap();
        assert_eq!(result_batch.len(), 1);
        assert_eq!(result_batch[0].num_rows(), 2);
    }

    #[test]
    fn test_last_updated_at() {
        use arrow::array::{Int64Array, StringArray};

        // Create a schema with _timestamp column
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        // Create first batch with timestamps
        let name_array1 = StringArray::from(vec!["Alice", "Bob"]);
        let timestamp_array1 = Int64Array::from(vec![1000, 2000]);

        let batch1 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(name_array1), Arc::new(timestamp_array1)],
        )
        .unwrap();

        // Create second batch with timestamps
        let name_array2 = StringArray::from(vec!["Charlie", "David"]);
        let timestamp_array2 = Int64Array::from(vec![1500, 3000]);

        let batch2 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(name_array2), Arc::new(timestamp_array2)],
        )
        .unwrap();

        // Test with multiple batches
        let value_type = Values::RecordBatch(vec![batch1, batch2]);
        let max_ts = value_type.last_updated_at();
        assert_eq!(max_ts, 3000);

        // Test with empty batches
        let empty_value_type = Values::RecordBatch(vec![]);
        let max_ts_empty = empty_value_type.last_updated_at();
        assert_eq!(max_ts_empty, 0);

        // Test with batch without _timestamp column
        let schema_no_ts = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));
        let name_array3 = StringArray::from(vec!["Eve"]);
        let age_array3 = Int64Array::from(vec![25]);
        let batch3 = RecordBatch::try_new(
            schema_no_ts,
            vec![Arc::new(name_array3), Arc::new(age_array3)],
        )
        .unwrap();
        let value_type_no_ts = Values::RecordBatch(vec![batch3]);
        let max_ts_no_ts = value_type_no_ts.last_updated_at();
        assert_eq!(max_ts_no_ts, 0);
    }
}
