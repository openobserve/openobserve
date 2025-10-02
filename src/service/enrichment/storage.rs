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

        // Question: this convert only used for calculate original_size and compressed_size?
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
                .map_err(|e| anyhow!("Failed to read enrichment table file: {}", e))?;

            // Parse parquet file
            let reader = ParquetRecordBatchReaderBuilder::try_new(Bytes::from(file_content))
                .map_err(|e| anyhow!("Failed to create parquet reader: {}", e))?
                .build()
                .map_err(|e| anyhow!("Failed to build parquet reader: {}", e))?;

            for batch in reader {
                let batch = batch.map_err(|e| anyhow!("Failed to read record batch: {}", e))?;
                batches.push(batch);
            }
        }
        Ok(Values::RecordBatch(batches))
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
                && file_name.ends_with(".parquet")
                && file_name.starts_with(&prefix.replace("/", "_"))
            {
                let key = file_name
                    .strip_suffix(".parquet")
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
        data: Values,
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
        data: Values,
        updated_at: i64,
    ) -> Result<()> {
        let org_id = org_id.to_string();
        let table_name = table_name.to_string();
        tokio::task::spawn(async move {
            store_data_if_needed(&org_id, &table_name, data, updated_at).await
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::RecordBatch,
        datatypes::{DataType, Field, Schema},
    };

    use crate::service::enrichment::storage::Values;

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
