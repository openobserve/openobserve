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
use config::utils::{
    enrichment_local_cache::{
        get_key, get_metadata_content, get_metadata_path, get_table_dir, get_table_path,
    },
    json::Value,
};

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

    fn get_remote_key_prefix(org_id: &str, table_name: &str) -> String {
        format!(
            "files/{}/{}/{}",
            org_id,
            StreamType::EnrichmentTables,
            table_name
        )
    }

    /// Create remote key with enrichment table prefix
    fn create_remote_key(org_id: &str, table_name: &str, created_at: i64) -> String {
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

        log::debug!("Uploaded enrichment table {} to remote", table_name);
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

        log::debug!(
            "Merged and uploaded enrichment table {} to remote",
            table_name
        );

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

    pub async fn run_merge_job() -> Result<()> {
        log::info!("[ENRICHMENT::STORAGE] Running enrichment table merge job");
        let cfg = config::get_config();
        // let merge_threshold_mb = cfg.enrichment_table.merge_threshold_mb;
        let merge_interval = cfg.enrichment_table.merge_interval;

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(merge_interval)).await;
            let org_table_pairs = database::list().await?;
            log::info!(
                "[ENRICHMENT::STORAGE] Found {} enrichment tables, {:?}",
                org_table_pairs.len(),
                org_table_pairs
            );
            for (org_id, table_name) in org_table_pairs {
                match merge_and_upload_to_remote(&org_id, &table_name).await {
                    Ok(_) => {
                        log::debug!(
                            "Merged and uploaded enrichment table {} to remote",
                            table_name
                        );
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
