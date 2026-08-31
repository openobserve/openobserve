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

use std::sync::Arc;

use ::datafusion::{arrow::datatypes::Schema, error::DataFusionError};
use bytes::Bytes;
use config::{
    FileFormat, get_config, ider, is_local_disk_storage,
    meta::stream::{FileKey, FileMeta, StorageType, StreamType},
    metrics,
    utils::{parquet::read_schema_from_bytes, schema_ext::SchemaExt},
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    file_list as infra_file_list,
    runtime::DATAFUSION_RUNTIME,
    schema::{
        SchemaCache, get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields,
    },
    storage,
};
use metrics_index::MetricsFileLayout;
use schema::generate_schema_for_defined_schema_fields;
use search::datafusion::{
    exec::TableBuilder,
    merge::{self, MergeMode, MergeOutput, MergeResult},
};
use tantivy_utils::index_builder::{TantivyIndexOptions, create_tantivy_index};
use tokio::sync::Semaphore;

// merge small files into big file, upload to storage, returns the big file key and merged files
// params:
// - thread_id: the id of the thread
// - org_id: the id of the organization
// - stream_type: the type of the stream
// - stream_name: the name of the stream
// - prefix: the prefix of the files
// - files_with_size: the files to merge
// - mode: what the merge produces (decided by the scheduler)
// returns:
// - new_files: the files that are merged
// - retain_file_list: the files that are not merged
pub async fn merge_files(
    thread_id: usize,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    prefix: &str,
    files_with_size: &[FileKey],
    mode: &MergeMode,
) -> Result<(Vec<FileKey>, Vec<FileKey>), anyhow::Error> {
    let start = std::time::Instant::now();
    // a whole-batch mode (downsampling) merges everything it is given, even a
    // single file; otherwise 0/1 files means nothing to do
    let merge_whole_batch = mode.merges_whole_batch();
    if files_with_size.len() <= 1 && !merge_whole_batch {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut new_file_size = 0;
    let mut new_compressed_file_size = 0;
    let mut new_file_list = Vec::new();
    let cfg = get_config();
    for file in files_with_size.iter() {
        if (new_file_size + file.meta.original_size > cfg.compact.max_file_size as i64
            || new_compressed_file_size + file.meta.compressed_size
                > cfg.compact.max_file_size as i64)
            && !merge_whole_batch
        {
            break;
        }
        new_file_size += file.meta.original_size;
        new_compressed_file_size += file.meta.compressed_size;
        new_file_list.push(file.clone());
        // metrics
        metrics::COMPACT_MERGED_FILES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc();
        metrics::COMPACT_MERGED_BYTES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by(file.meta.original_size as u64);
    }
    // no files need to merge
    if new_file_list.len() <= 1 && !merge_whole_batch {
        return Ok((Vec::new(), Vec::new()));
    }

    let retain_file_list = new_file_list.clone();

    // cache parquet files
    let deleted_files = cache_remote_files(&new_file_list).await?;
    log::info!(
        "[COMPACTOR:WORKER:{thread_id}] download {} parquet files, took: {} ms",
        new_file_list.len(),
        start.elapsed().as_millis()
    );
    if !deleted_files.is_empty() {
        new_file_list.retain(|f| !deleted_files.contains(&f.key));
    }
    if new_file_list.len() <= 1 && !merge_whole_batch {
        return Ok((Vec::new(), retain_file_list));
    }

    // get time range and stats for these files in a single iteration
    let (min_ts, max_ts, total_records, new_file_size) = new_file_list.iter().fold(
        (i64::MAX, i64::MIN, 0, 0),
        |(min_ts, max_ts, records, size), file| {
            (
                min_ts.min(file.meta.min_ts),
                max_ts.max(file.meta.max_ts),
                records + file.meta.records,
                size + file.meta.original_size,
            )
        },
    );
    let min_ts = if min_ts == i64::MAX { 0 } else { min_ts };
    let max_ts = if max_ts == i64::MIN { 0 } else { max_ts };
    let new_file_meta = FileMeta {
        min_ts,
        max_ts,
        records: total_records,
        original_size: new_file_size,
        compressed_size: 0,
        flattened: false,
        index_size: 0,
        bloom_ver: 0,
    };
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!("merge_files error: records is 0"));
    }

    // get latest version of schema
    let latest_schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema);
    let bloom_filter_fields = get_stream_setting_bloom_filter_fields(&stream_settings);
    let full_text_search_fields = get_stream_setting_fts_fields(&stream_settings);
    let index_fields = get_stream_setting_index_fields(&stream_settings);
    let (defined_schema_fields, need_original, index_original_data, index_all_values, storage_type) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields,
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
                s.storage_type,
            ),
            None => (Vec::new(), false, false, false, StorageType::Normal),
        };
    let latest_schema = if !defined_schema_fields.is_empty() {
        let latest_schema = SchemaCache::new(latest_schema);
        let latest_schema = generate_schema_for_defined_schema_fields(
            stream_type,
            &latest_schema,
            &defined_schema_fields,
            need_original,
            index_original_data,
            index_all_values,
        );
        latest_schema.schema().clone()
    } else {
        Arc::new(latest_schema)
    };

    // read schema from parquet file and group files by schema
    let mut schemas = HashMap::new();
    let files = new_file_list.clone();
    let mut fi = 0;
    for file in new_file_list.iter() {
        fi += 1;
        log::info!(
            "[COMPACTOR:WORKER:{thread_id}:{fi}] merge small file: {}",
            file.key
        );
        let buf = file_data::get(&file.account, &file.key, None).await?;
        let file_format = FileFormat::from_extension(&file.key)
            .ok_or_else(|| anyhow::anyhow!("invalid file format: {}", file.key))?;
        let schema = match read_schema_from_bytes(file_format, &buf).await {
            Ok(schema) => schema,
            Err(e) => {
                log::error!(
                    "[COMPACTOR:WORKER:{thread_id}:{fi}] read schema error for file: {}, err: {e}",
                    file.key
                );
                return Err(e);
            }
        };
        let schema = schema.as_ref().clone().with_metadata(Default::default());
        let schema_key = schema.hash_key();
        if !schemas.contains_key(&schema_key) {
            schemas.insert(schema_key.clone(), schema);
        }
    }

    // generate the parquet schema
    let all_fields = schemas
        .values()
        .flat_map(|s| s.fields().iter().map(|f| f.name().to_string()))
        .collect::<HashSet<_>>();
    let schema = Arc::new(latest_schema.retain(all_fields));

    // generate datafusion tables
    let trace_id = ider::generate();
    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: 2,
    };

    let input_sort_order = mode.input_sort_order(&files);
    log::debug!(
        "[COMPACTOR:WORKER:{thread_id}] merge [{mode}] input sort order: {input_sort_order}, files: {}",
        files.len()
    );
    let tables = match TableBuilder::new()
        .sort_order(input_sort_order)
        .build(session, files.clone(), schema.clone())
        .await
    {
        Ok(tables) => tables,
        Err(e) => {
            log::error!("create_parquet_table err: {e}, files: {files:?}, schema: {schema:?}");
            return Err(DataFusionError::Plan(format!("create_parquet_table err: {e}")).into());
        }
    };

    let merge_result = {
        let mode = mode.clone();
        DATAFUSION_RUNTIME
            .spawn(async move {
                merge::merge_parquet_files(
                    schema,
                    tables,
                    &bloom_filter_fields,
                    new_file_meta,
                    &mode,
                    MergeOutput::for_compactor(stream_type),
                )
                .await
            })
            .await?
    };

    // clear session data
    search::datafusion::storage::file_list::clear(&trace_id);

    let files = new_file_list.into_iter().map(|f| f.key).collect::<Vec<_>>();
    let buf = match merge_result {
        Ok(v) => v,
        Err(e) => {
            log::error!("merge_parquet_files err: {e}, files: {files:?}");
            return Err(DataFusionError::Plan(format!("merge_parquet_files err: {e}")).into());
        }
    };

    let latest_schema_fields = latest_schema
        .fields()
        .iter()
        .map(|f| f.name())
        .collect::<HashSet<_>>();
    let need_index = full_text_search_fields
        .iter()
        .chain(index_fields.iter())
        .any(|f| latest_schema_fields.contains(f));
    if !need_index {
        log::debug!("skip index generation for stream: {org_id}/{stream_type}/{stream_name}");
    }

    let storage_tier = if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
        storage::StorageTier::InfrequentAccess
    } else {
        storage::StorageTier::Default
    };

    let MergeResult {
        files: merged_files,
        file_format,
    } = buf;
    // an empty result would delete the source files without a replacement
    if merged_files.is_empty() {
        return Err(anyhow::anyhow!(
            "merge_parquet_files error: produced no files"
        ));
    }
    let mut new_files = Vec::with_capacity(merged_files.len());
    for file in merged_files {
        let id = ider::generate_file_name();
        let new_file_key = format!("{prefix}/{}", file.file_name(&id, file_format));
        let (data, mut new_file_meta, metrics_index_path) = file.into_upload_parts().await?;
        let buf = Bytes::from(data);
        new_file_meta.compressed_size = buf.len() as i64;
        if new_file_meta.compressed_size == 0 {
            return Err(anyhow::anyhow!(
                "merge_parquet_files error: compressed_size is 0"
            ));
        }

        // upload file to storage
        if cfg.cache_latest_files.enabled
            && cfg.cache_latest_files.cache_parquet
            && cfg.cache_latest_files.download_from_node
        {
            infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
            log::debug!("merge_files {new_file_key} file_data::disk::set success");
        }

        let account = storage::get_account(org_id, &new_file_key).unwrap_or_default();
        storage::put_with_tier(&account, &new_file_key, buf.clone(), storage_tier).await?;

        // Indexed metrics files own a `.midx` metrics index; it is not tracked in
        // file_list and is deleted together with the data file
        if let Some(metrics_index_path) = metrics_index_path {
            let metrics_index_key = MetricsFileLayout::metrics_index_path(&new_file_key)
                .ok_or_else(|| {
                    anyhow::anyhow!("metrics index for a non-indexed metrics file: {new_file_key}")
                })?;
            let metrics_index = Bytes::from(tokio::fs::read(&metrics_index_path).await?);
            storage::put_with_tier(
                &account,
                &metrics_index_key,
                metrics_index.clone(),
                storage_tier,
            )
            .await?;
            log::debug!(
                "[COMPACTOR:WORKER:{thread_id}] wrote metrics index {metrics_index_key}, size: {}",
                metrics_index.len()
            );
        }

        if cfg.search.inverted_index_enabled && stream_type.support_index() && need_index {
            generate_inverted_index(
                org_id,
                &new_file_key,
                &full_text_search_fields,
                &index_fields,
                &retain_file_list,
                &mut new_file_meta,
                latest_schema.clone(),
                buf,
                storage_tier,
            )
            .await?;
        }
        new_files.push(FileKey::new(0, account, new_file_key, new_file_meta, false));
    }
    log::info!(
        "[COMPACTOR:WORKER:{thread_id}] merged {} files into {} new file(s): {:?}, original_size: {}, compressed_size: {}, took: {} ms",
        retain_file_list.len(),
        new_files.len(),
        new_files.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(),
        new_files.iter().map(|f| f.meta.original_size).sum::<i64>(),
        new_files
            .iter()
            .map(|f| f.meta.compressed_size)
            .sum::<i64>(),
        start.elapsed().as_millis(),
    );

    Ok((new_files, retain_file_list))
}

#[allow(clippy::too_many_arguments)]
async fn generate_inverted_index(
    org_id: &str,
    new_file_key: &str,
    fts_fields: &[String],
    index_fields: &[String],
    retain_file_list: &[FileKey],
    new_file_meta: &mut FileMeta,
    latest_schema: Arc<Schema>,
    buf: Bytes,
    storage_tier: storage::StorageTier,
) -> Result<(), anyhow::Error> {
    let index_size = create_tantivy_index(
        TantivyIndexOptions {
            caller: "COMPACTOR",
            org_id,
            data_file_name: new_file_key,
            storage_tier,
        },
        fts_fields,
        index_fields,
        latest_schema, // Use stream schema to include all configured fields
        buf,
    )
    .await
    .map_err(|e| {
        anyhow::anyhow!(
            "create_tantivy_index_on_compactor for file: {new_file_key}, error: {e}, need delete files: {retain_file_list:?}",
        )
    })?;
    new_file_meta.index_size = index_size as i64;

    Ok(())
}

async fn cache_remote_files(files: &[FileKey]) -> Result<Vec<String>, anyhow::Error> {
    let cfg = get_config();
    let scan_size = files.iter().map(|f| f.meta.compressed_size).sum::<i64>();
    if is_local_disk_storage()
        || !cfg.disk_cache.enabled
        || scan_size >= cfg.disk_cache.skip_size as i64
    {
        return Ok(Vec::new());
    };

    let mut tasks = Vec::with_capacity(files.len());
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.cpu_num));
    for file in files.iter() {
        let file_account = file.account.to_string();
        let file_name = file.key.to_string();
        let file_size = file.meta.compressed_size as usize;
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = if !file_data::disk::exist(&file_name).await {
                file_data::disk::download(&file_account, &file_name, Some(file_size)).await
            } else {
                Ok(0)
            };
            // In case where the parquet file is not found or has no data, we assume that it
            // must have been deleted by some external entity, and hence we
            // should remove the entry from file_list table.
            let file_name = match ret {
                Ok(data_len) => {
                    if data_len > 0 && data_len != file_size {
                        log::warn!(
                            "[COMPACT] download file {file_name} found size mismatch, expected: {file_size}, actual: {data_len}, will skip it",
                        );
                        // skip this file for compact
                        Some(file_name)
                    } else {
                        None
                    }
                }
                Err(e) => {
                    if e.to_string().to_lowercase().contains("not found")
                        || e.to_string().to_lowercase().contains("data size is zero")
                    {
                        // delete file from file list
                        log::error!("[COMPACT] found invalid file: {file_name}, will delete it");
                        if let Err(e) =
                            infra_file_list::delete_parquet_file(&file_account, &file_name, true)
                                .await
                        {
                            log::error!("[COMPACT] delete from file_list err: {e}");
                        }
                        Some(file_name)
                    } else {
                        log::error!("[COMPACT] download file to cache err: {e}");
                        // remove downloaded file
                        let _ = file_data::disk::remove(&file_name).await;
                        None
                    }
                }
            };
            drop(permit);
            file_name
        });
        tasks.push(task);
    }

    let mut delete_files = Vec::new();
    for task in tasks {
        match task.await {
            Ok(file) => {
                if let Some(file) = file {
                    delete_files.push(file);
                }
            }
            Err(e) => {
                log::error!("[COMPACTOR] load file task err: {e}");
            }
        }
    }

    Ok(delete_files)
}
