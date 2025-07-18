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

use std::{collections::HashMap, path::PathBuf};

use anyhow::{Result, anyhow};
use bytes::Bytes;
use config::utils::json::Value;
use serde::{Deserialize, Serialize};

pub mod s3 {
    use std::sync::Arc;

    use chrono::{Datelike, Timelike};
    use config::{
        meta::stream::{FileMeta, StreamType},
        utils::{
            arrow::record_batches_to_json_rows,
            parquet::{read_recordbatch_from_bytes, write_recordbatch_to_parquet},
            record_batch_ext::convert_json_to_record_batch,
            time::now_micros,
        },
    };

    const ENRICHMENT_TABLE_S3_KEY: &str = "/enrichment_table_s3/";

    use infra::db as infra_db;

    use super::*;

    #[derive(Debug, Default, Serialize, Deserialize)]
    pub struct S3EnrichmentTableMeta {
        pub s3_last_updated: i64,
    }

    fn get_s3_key_prefix(org_id: &str, table_name: &str) -> String {
        format!(
            "files/{}/{}/{}",
            org_id,
            StreamType::EnrichmentTables,
            table_name
        )
    }

    /// Create S3 key with enrichment table prefix
    fn create_s3_key(org_id: &str, table_name: &str, created_at: i64) -> String {
        let ts = chrono::DateTime::from_timestamp_micros(created_at).unwrap();
        let file_name = format!(
            "{:04}/{:02}/{:02}/{:02}/{}.parquet",
            ts.year(),
            ts.month(),
            ts.day(),
            ts.hour(),
            config::ider::generate()
        );
        format!("{}/{}", get_s3_key_prefix(org_id, table_name), file_name)
    }

    /// Upload data to S3 using existing infra::storage::put function
    pub async fn upload_to_s3(
        org_id: &str,
        table_name: &str,
        file_meta: FileMeta,
        data: &[u8],
        created_at: i64,
    ) -> Result<()> {
        // Create S3 key with enrichment table prefix
        let s3_key = create_s3_key(org_id, table_name, created_at);

        // Use existing storage::put function for S3 upload
        infra::storage::put(&s3_key, Bytes::from(data.to_owned()))
            .await
            .map_err(|e| anyhow!("Failed to upload enrichment table to S3: {}", e))?;

        crate::service::db::file_list::set(&s3_key, Some(file_meta), false).await?;

        log::debug!("Uploaded enrichment table {} to S3", table_name);
        Ok(())
    }

    /// Fetch data from S3 using existing infra::storage::get_bytes function
    pub async fn retrieve(org_id: &str, table_name: &str) -> Result<Vec<Value>> {
        // Create S3 key with enrichment table prefix
        let s3_key = get_s3_key_prefix(org_id, table_name);

        let files = infra::storage::list(&s3_key).await?;

        let mut records = Vec::new();
        for file in files {
            match infra::storage::get(&file).await {
                Ok(data_bytes) => {
                    let data_bytes = data_bytes
                        .bytes()
                        .await
                        .map_err(|e| anyhow!("Failed to get data bytes: {}", e))?;
                    let (_schema, batches) = read_recordbatch_from_bytes(&data_bytes).await?;
                    let batches: Vec<_> = batches.iter().collect();
                    let table_data = record_batches_to_json_rows(&batches)?;
                    let table_data = table_data
                        .iter()
                        .map(|row| Value::Object(row.clone()))
                        .collect::<Vec<_>>();
                    log::debug!("Fetched enrichment table {} from S3", s3_key);
                    records.extend(table_data);
                }
                Err(e) => {
                    log::warn!("Enrichment table {} not found in S3: {}", s3_key, e);
                }
            }
        }
        Ok(records)
    }

    /// Merge and upload data to S3
    pub async fn merge_and_upload_to_s3(org_id: &str, table_name: &str) -> Result<()> {
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
        let file_meta = FileMeta {
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

        upload_to_s3(org_id, table_name, file_meta, &data, min_ts).await?;

        log::debug!("Merged and uploaded enrichment table {} to S3", table_name);

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
        let file_meta = FileMeta {
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
        upload_to_s3(org_id, table_name, file_meta, &data, created_at).await?;
        Ok(())
    }

    pub async fn delete(org_id: &str, table_name: &str) -> Result<()> {
        // Create S3 key with enrichment table prefix
        let s3_key = get_s3_key_prefix(org_id, table_name);

        let files = infra::storage::list(&s3_key)
            .await
            .map_err(|e| anyhow!("Failed to list S3 keys for deletion: {}", e))?;
        let files: Vec<_> = files.iter().map(|file| file.as_str()).collect();

        if files.is_empty() {
            return Ok(());
        }

        log::debug!(
            "Attempting to delete {} files for enrichment table {} from S3",
            files.len(),
            table_name
        );

        infra::storage::del(&files)
            .await
            .map_err(|e| anyhow!("Failed to delete enrichment table from S3: {}", e))?;

        log::debug!("Deleted enrichment table {} from S3", table_name);
        Ok(())
    }

    pub async fn get_merge_threshold_mb() -> Result<i64> {
        let cfg = config::get_config();
        let merge_threshold_mb = cfg.enrichment_table.merge_threshold_mb;
        Ok(merge_threshold_mb as i64)
    }

    pub async fn run_merge_job() -> Result<()> {
        log::info!("[ENRICHMENT::STORAGE] Running enrichment table merge job");
        let cfg = config::get_config();
        // let merge_threshold_mb = cfg.enrichment_table.merge_threshold_mb;
        let merge_interval_seconds = cfg.enrichment_table.merge_interval_seconds;
        let db = infra_db::get_db().await;

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(merge_interval_seconds)).await;
            let org_table_pairs = database::list().await?;
            log::info!(
                "[ENRICHMENT::STORAGE] Found {} enrichment tables, {:?}",
                org_table_pairs.len(),
                org_table_pairs
            );
            for (org_id, table_name) in org_table_pairs {
                match merge_and_upload_to_s3(&org_id, &table_name).await {
                    Ok(_) => {
                        let meta = S3EnrichmentTableMeta {
                            s3_last_updated: now_micros(),
                        };
                        db.put(
                            ENRICHMENT_TABLE_S3_KEY,
                            serde_json::to_string(&meta).unwrap().into(),
                            false,
                            None,
                        )
                        .await?;
                        log::debug!("Merged and uploaded enrichment table {} to S3", table_name);
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to merge and upload enrichment table {}: {}",
                            table_name,
                            e
                        );
                    }
                }
            }
        }
    }

    pub async fn get_last_updated_at() -> Result<i64> {
        let db = infra_db::get_db().await;
        let metadata: S3EnrichmentTableMeta = {
            let metadata = db.get(ENRICHMENT_TABLE_S3_KEY).await.unwrap_or_default();
            let metadata = String::from_utf8_lossy(&metadata);
            serde_json::from_str(&metadata).unwrap_or_default()
        };

        Ok(metadata.s3_last_updated)
    }
}

pub mod local {
    use super::*;

    fn get_key(org_id: &str, table_name: &str) -> String {
        format!("{}/{}", org_id, table_name)
    }

    fn get_table_dir(key: &str) -> PathBuf {
        let cfg = config::get_config();
        let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
            format!("{}/enrichment_table_cache", cfg.common.data_cache_dir)
        } else {
            cfg.enrichment_table.cache_dir.clone()
        };
        PathBuf::from(format!("{cache_dir}/{key}"))
    }

    fn get_table_path(table_dir: &str, created_at: i64) -> PathBuf {
        PathBuf::from(format!("{table_dir}/{created_at}.json"))
    }

    fn get_metadata_path() -> PathBuf {
        let cfg = config::get_config();
        let cache_dir = if cfg.enrichment_table.cache_dir.is_empty() {
            format!("{}/enrichment_table_cache", cfg.common.data_cache_dir)
        } else {
            cfg.enrichment_table.cache_dir.clone()
        };
        PathBuf::from(format!("{cache_dir}/metadata.json"))
    }

    async fn get_metadata_content() -> Result<HashMap<String, i64>> {
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

        log::debug!("Stored enrichment table {} to local storage", key);
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

        log::debug!("Deleted enrichment table {} from local storage", key);
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
            if let Ok(file_name) = entry.file_name().into_string() {
                if file_name.ends_with(".json") && file_name.starts_with(&prefix.replace("/", "_"))
                {
                    let key = file_name
                        .strip_suffix(".json")
                        .unwrap_or(&file_name)
                        .replace("_", "/");
                    keys.push(key);
                }
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

        log::debug!("Stored enrichment table {} to database", table_name);
        Ok(())
    }

    pub async fn retrieve(org_id: &str, table_name: &str) -> Result<Vec<Value>> {
        match crate::service::db::enrichment_table::get_enrichment_data_from_db(org_id, table_name)
            .await
        {
            Ok(data) => Ok(data.0),
            Err(e) => {
                log::error!(
                    "Failed to retrieve enrichment table {} from database: {}",
                    table_name,
                    e
                );
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

        log::debug!(
            "Deleted enrichment table {} from database storage",
            table_name
        );
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
