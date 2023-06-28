// Copyright 2022 Zinc Labs Inc. and Contributors
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
use datafusion::{arrow::record_batch::RecordBatch, datasource::file_format::file_type::FileType};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::{info_span, Instrument};

use crate::infra::{
    cache::file_data,
    config::CONFIG,
    errors::{Error, ErrorCodes},
};
use crate::meta::{self, stream::ScanStats};
use crate::service::{
    db, file_list,
    search::{
        datafusion::{exec, storage::StorageType},
        sql::Sql,
    },
};

/// search in remote object storage
#[tracing::instrument(name = "service:search:grpc:storage:enter", skip_all)]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    file_list: &[String],
    stream_type: meta::StreamType,
) -> super::SearchResult {
    // get file list
    let files = match file_list.is_empty() {
        true => get_file_list(&sql, stream_type).await?,
        false => file_list.to_vec(),
    };
    if files.is_empty() {
        return Ok((HashMap::new(), ScanStats::default()));
    }

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
    let mut files_group: HashMap<usize, Vec<String>> =
        HashMap::with_capacity(schema_versions.len());
    let mut scan_stats = ScanStats::new();
    if !CONFIG.common.widening_schema_evolution || schema_versions.len() == 1 {
        let files = files.to_vec();
        scan_stats = match file_list::calculate_files_size(&files) {
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
        scan_stats.files = files.len() as u64;
        for file in &files {
            let file_meta = file_list::get_file_meta(file).unwrap_or_default();
            // calculate scan size
            scan_stats.records += file_meta.records;
            scan_stats.original_size += file_meta.original_size;
            scan_stats.compressed_size += file_meta.compressed_size;
            // check schema version
            let schema_ver_id = match db::schema::filter_schema_version_id(
                &schema_versions,
                file_meta.min_ts,
                file_meta.max_ts,
            ) {
                Some(id) => id,
                None => {
                    log::error!(
                        "search->storage: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        &file,
                        file_meta.min_ts,
                        file_meta.max_ts
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

    // if scan_compressed_size > 80% of total memory cache, skip memory cache
    let storage_type = if !CONFIG.memory_cache.enabled
        || scan_stats.compressed_size > CONFIG.memory_cache.skip_size as u64
    {
        StorageType::FsNoCache
    } else {
        StorageType::FsMemory
    };

    // load files to local cache
    if storage_type == StorageType::FsMemory {
        let deleted_files = cache_parquet_files(&files).await?;
        if !deleted_files.is_empty() {
            // remove deleted files from files_group
            for (_, g_files) in files_group.iter_mut() {
                g_files.retain(|f| !deleted_files.contains(f));
            }
        }
        log::info!(
            "search->storage: org {}, stream {}, load files {}, into memory cache done",
            &sql.org_id,
            &sql.stream_name,
            scan_stats.files
        );
    }

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
            storage_type: storage_type.clone(),
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
        let datafusion_span = info_span!("service:search:grpc:storage:datafusion");
        let task = tokio::task::spawn(
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
    for task in tasks {
        match task.await {
            Ok(ret) => match ret {
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
            },
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
    }

    Ok((results, scan_stats))
}

#[tracing::instrument(name = "service:search:grpc:storage:get_file_list", skip_all)]
async fn get_file_list(sql: &Sql, stream_type: meta::StreamType) -> Result<Vec<String>, Error> {
    let (time_min, time_max) = sql.meta.time_range.unwrap();
    let results = match file_list::get_file_list(
        &sql.org_id,
        &sql.stream_name,
        stream_type,
        time_min,
        time_max,
    ) {
        Ok(results) => results,
        Err(err) => {
            log::error!("get file list error: {}", err);
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                "get file list error".to_string(),
            )));
        }
    };

    let mut files = Vec::new();
    for file in results {
        if sql.match_source(&file, false, false, stream_type).await {
            files.push(file.clone());
        }
    }
    Ok(files)
}

#[tracing::instrument(name = "service:search:grpc:storage:cache_parquet_files", skip_all)]
async fn cache_parquet_files(files: &[String]) -> Result<Vec<String>, Error> {
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let file = file.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            if !file_data::exist(&file).unwrap_or_default() {
                if let Err(e) = file_data::download(&file).await {
                    log::error!("search->storage: download file err: {}", e);
                    if e.to_string().to_lowercase().contains("not found") {
                        // delete file from file list
                        if let Err(e) = file_list::delete_parquet_file(&file).await {
                            log::error!("search->storage: delete from file_list err: {}", e);
                        }
                        return Some(file);
                    }
                }
            };
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
