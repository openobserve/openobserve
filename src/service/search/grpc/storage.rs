// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap as HashMap;
use datafusion::{arrow::record_batch::RecordBatch, common::FileType};
use futures::future::try_join_all;
use std::sync::Arc;
use tokio::{sync::Semaphore, time::Duration};
use tracing::{info_span, Instrument};

use crate::common::{
    infra::{
        cache::file_data,
        config::{is_local_disk_storage, CONFIG},
        errors::{Error, ErrorCodes},
    },
    meta::{
        self,
        common::FileKey,
        stream::{PartitionTimeLevel, ScanStats},
    },
};
use crate::service::{
    db, file_list,
    search::{
        datafusion::{exec, storage::StorageType},
        sql::Sql,
    },
    stream,
};

/// search in remote object storage
#[tracing::instrument(name = "service:search:grpc:storage:enter", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    file_list: &[FileKey],
    stream_type: meta::StreamType,
    timeout: u64,
) -> super::SearchResult {
    // fetch all schema versions, group files by version
    let schema_versions =
        match db::schema::get_versions(&sql.org_id, &sql.stream_name, stream_type).await {
            Ok(versions) => versions,
            Err(err) => {
                log::error!("get schema error: {}", err);
                return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                    sql.stream_name.clone(),
                )));
            }
        };
    if schema_versions.is_empty() {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
            sql.stream_name.clone(),
        )));
    }
    let schema_latest = schema_versions.last().unwrap();
    let schema_latest_id = schema_versions.len() - 1;

    let stream_settings = stream::stream_settings(schema_latest).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    // get file list
    let files = match file_list.is_empty() {
        true => get_file_list(&sql, stream_type, partition_time_level).await?,
        false => file_list.to_vec(),
    };
    if files.is_empty() {
        return Ok((HashMap::new(), ScanStats::default()));
    }
    log::info!(
        "search->storage: org {}, stream {}, load file_list num {}",
        &sql.org_id,
        &sql.stream_name,
        files.len(),
    );

    let mut files_group: HashMap<usize, Vec<FileKey>> =
        HashMap::with_capacity(schema_versions.len());
    let mut scan_stats = ScanStats::new();
    if !CONFIG.common.widening_schema_evolution || schema_versions.len() == 1 {
        let files = files.to_vec();
        scan_stats = match file_list::calculate_files_size(&files).await {
            Ok(size) => size,
            Err(err) => {
                log::error!("calculate files size error: {}", err);
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    "calculate files size error".to_string(),
                )));
            }
        };
        files_group.insert(schema_latest_id, files);
    } else {
        scan_stats.files = files.len() as i64;
        for file in files.iter() {
            // calculate scan size
            scan_stats.records += file.meta.records;
            scan_stats.original_size += file.meta.original_size;
            scan_stats.compressed_size += file.meta.compressed_size;
            // check schema version
            let schema_ver_id = match db::schema::filter_schema_version_id(
                &schema_versions,
                file.meta.min_ts,
                file.meta.max_ts,
            ) {
                Some(id) => id,
                None => {
                    log::error!(
                        "search->storage: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        &file.key,
                        file.meta.min_ts,
                        file.meta.max_ts
                    );
                    // HACK: use the latest verion if not found in schema versions
                    schema_latest_id
                }
            };
            let group = files_group.entry(schema_ver_id).or_insert_with(Vec::new);
            group.push(file.clone());
        }
    }

    log::info!(
        "search->storage: org {}, stream {}, load files {}, scan_size {}, compressed_size {}",
        &sql.org_id,
        &sql.stream_name,
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    // load files to local cache
    let deleted_files = cache_parquet_files(&files, &scan_stats).await?;
    if !deleted_files.is_empty() {
        // remove deleted files from files_group
        for (_, g_files) in files_group.iter_mut() {
            g_files.retain(|f| !deleted_files.contains(&f.key));
        }
    }
    log::info!(
        "search->storage: org {}, stream {}, load files {}, into memory cache done",
        &sql.org_id,
        &sql.stream_name,
        scan_stats.files
    );

    let mut tasks = Vec::new();
    for (ver, files) in files_group {
        let schema = Arc::new(
            schema_versions[ver]
                .clone()
                .with_metadata(std::collections::HashMap::new()),
        );
        let sql = sql.clone();
        let session = meta::search::Session {
            id: format!("{session_id}-{ver}"),
            storage_type: StorageType::Memory,
        };
        // cacluate the diff between latest schema and group schema
        let mut diff_fields = HashMap::new();
        if CONFIG.common.widening_schema_evolution && ver != schema_latest_id {
            let group_fields = schema.fields();
            for field in group_fields {
                if let Ok(v) = schema_latest.field_with_name(field.name()) {
                    if v.data_type() != field.data_type() {
                        diff_fields.insert(v.name().clone(), v.data_type().clone());
                    }
                }
            }
        }
        let datafusion_span = info_span!("service:search:grpc:storage:datafusion", org_id = sql.org_id,stream_name = sql.stream_name, stream_type = ?stream_type);
        let task = tokio::time::timeout(
            Duration::from_secs(timeout),
            async move {
                exec::sql(
                    &session,
                    schema,
                    &diff_fields,
                    &sql,
                    &files,
                    FileType::PARQUET,
                )
                .await
            }
            .instrument(datafusion_span),
        );
        tasks.push(task);
    }

    let mut results: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    let task_results = try_join_all(tasks)
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;
    for ret in task_results {
        match ret {
            Ok(ret) => {
                for (k, v) in ret {
                    let group = results.entry(k).or_insert_with(Vec::new);
                    group.extend(v);
                }
            }
            Err(err) => {
                log::error!("datafusion execute error: {}", err);
                return Err(super::handle_datafusion_error(err));
            }
        };
    }

    Ok((results, scan_stats))
}

#[tracing::instrument(name = "service:search:grpc:storage:get_file_list", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    sql: &Sql,
    stream_type: meta::StreamType,
    time_level: PartitionTimeLevel,
) -> Result<Vec<FileKey>, Error> {
    let (time_min, time_max) = sql.meta.time_range.unwrap();
    let file_list = match file_list::query(
        &sql.org_id,
        &sql.stream_name,
        stream_type,
        time_level,
        time_min,
        time_max,
    )
    .await
    {
        Ok(file_list) => file_list,
        Err(err) => {
            log::error!("get file list error: {}", err);
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                "get file list error".to_string(),
            )));
        }
    };

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if sql.match_source(&file, false, false, stream_type).await {
            files.push(file.to_owned());
        }
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(files)
}

#[tracing::instrument(name = "service:search:grpc:storage:cache_parquet_files", skip_all)]
async fn cache_parquet_files(
    files: &[FileKey],
    scan_stats: &ScanStats,
) -> Result<Vec<String>, Error> {
    let cache_type = if CONFIG.memory_cache.enabled
        && scan_stats.compressed_size < CONFIG.memory_cache.skip_size as i64
    {
        // if scan_compressed_size < 80% of total memory cache, use memory cache
        file_data::CacheType::Memory
    } else if !is_local_disk_storage()
        && CONFIG.disk_cache.enabled
        && scan_stats.compressed_size < CONFIG.disk_cache.skip_size as i64
    {
        // if scan_compressed_size < 80% of total disk cache, use disk cache
        file_data::CacheType::Disk
    } else {
        // no cache
        return Ok(vec![]);
    };

    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let file_name = file.key.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = match cache_type {
                file_data::CacheType::Memory => {
                    if !file_data::memory::exist(&file_name) {
                        file_data::memory::download(&file_name).await.err()
                    } else {
                        None
                    }
                }
                file_data::CacheType::Disk => {
                    if !file_data::disk::exist(&file_name) {
                        file_data::disk::download(&file_name).await.err()
                    } else {
                        None
                    }
                }
                _ => None,
            };
            if let Some(e) = ret {
                log::info!("search->storage: download file to cache err: {}", e);
                if e.to_string().to_lowercase().contains("not found") {
                    // delete file from file list
                    if let Err(e) = file_list::delete_parquet_file(&file_name, true).await {
                        log::error!("search->storage: delete from file_list err: {}", e);
                    }
                    return Some(file_name);
                }
            }
            drop(permit);
            None
        });
        tasks.push(task);
    }

    let mut delete_files = Vec::new();
    for task in tasks {
        match task.await {
            Ok(ret) => {
                if let Some(file) = ret {
                    delete_files.push(file);
                }
            }
            Err(e) => {
                log::error!("search->storage: load file task err: {}", e);
            }
        }
    }

    Ok(delete_files)
}
