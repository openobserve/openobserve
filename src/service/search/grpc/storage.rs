// Copyright 2023 Zinc Labs Inc.
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

use ahash::AHashMap as HashMap;
use datafusion::{arrow::record_batch::RecordBatch, common::FileType};
use futures::future::try_join_all;
use tokio::{sync::Semaphore, time::Duration};
use tracing::{info_span, Instrument};

use crate::{
    common::{
        infra::{
            cache::file_data,
            config::{is_local_disk_storage, CONFIG},
            errors::{Error, ErrorCodes},
        },
        meta::{
            self,
            common::FileKey,
            search::SearchType,
            stream::{PartitionTimeLevel, ScanStats},
        },
    },
    service::{
        db, file_list,
        search::{
            datafusion::{exec, storage::StorageType},
            sql::Sql,
        },
        stream,
    },
};

/// search in remote object storage
#[tracing::instrument(name = "service:search:grpc:storage:enter", skip_all, fields(session_id = ?session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
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
                log::error!("[session_id {session_id}] get schema error: {}", err);
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
        true => get_file_list(session_id, &sql, stream_type, partition_time_level).await?,
        false => file_list.to_vec(),
    };
    if files.is_empty() {
        return Ok((HashMap::new(), ScanStats::default()));
    }
    log::info!(
        "[session_id {session_id}] search->storage: org {}, stream {}, load file_list num {}",
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
                log::error!(
                    "[session_id {session_id}] calculate files size error: {}",
                    err
                );
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
                        "[session_id {session_id}] search->storage: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        &file.key,
                        file.meta.min_ts,
                        file.meta.max_ts
                    );
                    // HACK: use the latest verion if not found in schema versions
                    schema_latest_id
                }
            };
            let group = files_group.entry(schema_ver_id).or_default();
            group.push(file.clone());
        }
    }

    log::info!(
        "[session_id {session_id}] search->storage: org {}, stream {}, load files {}, scan_size {}, compressed_size {}",
        &sql.org_id,
        &sql.stream_name,
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    if CONFIG.common.memory_circuit_breaker_enable {
        super::check_memory_circuit_breaker(&scan_stats)?;
    }

    // load files to local cache
    let (cache_type, deleted_files) = cache_parquet_files(session_id, &files, &scan_stats).await?;
    if !deleted_files.is_empty() {
        // remove deleted files from files_group
        for (_, g_files) in files_group.iter_mut() {
            g_files.retain(|f| !deleted_files.contains(&f.key));
        }
    }
    log::info!(
        "[session_id {session_id}] search->storage: org {}, stream {}, load files {}, into {:?} cache done",
        &sql.org_id,
        &sql.stream_name,
        scan_stats.files,
        cache_type,
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
            search_type: if !sql.meta.group_by.is_empty() {
                SearchType::Aggregation
            } else {
                SearchType::Normal
            },
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
            for (field, alias) in sql.meta.field_alias.iter() {
                if let Some(v) = diff_fields.get(field) {
                    diff_fields.insert(alias.to_string(), v.clone());
                }
            }
        }
        let datafusion_span = info_span!("service:search:grpc:storage:datafusion", session_id, org_id = sql.org_id,stream_name = sql.stream_name, stream_type = ?stream_type);
        let task = tokio::time::timeout(
            Duration::from_secs(timeout),
            async move {
                exec::sql(
                    &session,
                    schema,
                    &diff_fields,
                    &sql,
                    &files,
                    None,
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
                    let v = v
                        .into_iter()
                        .filter(|r| r.num_rows() > 0)
                        .collect::<Vec<_>>();
                    if !v.is_empty() {
                        let group = results.entry(k).or_default();
                        group.extend(v);
                    }
                }
            }
            Err(err) => {
                log::error!(
                    "[session_id {session_id}] datafusion execute error: {}",
                    err
                );
                return Err(super::handle_datafusion_error(err));
            }
        };
    }

    Ok((results, scan_stats))
}

#[tracing::instrument(name = "service:search:grpc:storage:get_file_list", skip_all, fields(session_id = ?session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    session_id: &str,
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
        true,
    )
    .await
    {
        Ok(file_list) => file_list,
        Err(err) => {
            log::error!("[session_id {session_id}] get file list error: {}", err);
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

#[tracing::instrument(
    name = "service:search:grpc:storage:cache_parquet_files",
    skip_all,
    fields(session_id = ?session_id)
)]
async fn cache_parquet_files(
    session_id: &str,
    files: &[FileKey],
    scan_stats: &ScanStats,
) -> Result<(file_data::CacheType, Vec<String>), Error> {
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
        return Ok((file_data::CacheType::None, vec![]));
    };

    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let session_id = session_id.to_string();
        let file_name = file.key.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = match cache_type {
                file_data::CacheType::Memory => {
                    if !file_data::memory::exist(&file_name).await {
                        file_data::memory::download(&session_id, &file_name)
                            .await
                            .err()
                    } else {
                        None
                    }
                }
                file_data::CacheType::Disk => {
                    if !file_data::disk::exist(&file_name).await {
                        file_data::disk::download(&session_id, &file_name)
                            .await
                            .err()
                    } else {
                        None
                    }
                }
                _ => None,
            };
            let ret = if let Some(e) = ret {
                if e.to_string().to_lowercase().contains("not found") {
                    // delete file from file list
                    if let Err(e) = file_list::delete_parquet_file(&file_name, true).await {
                        log::error!(
                            "[session_id {session_id}] search->storage: delete from file_list err: {}",
                            e
                        );
                    }
                    Some(file_name)
                } else {
                    log::error!(
                        "[session_id {session_id}] search->storage: download file to cache err: {}",
                        e
                    );
                    None
                }
            } else {
                None
            };
            drop(permit);
            ret
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
                log::error!(
                    "[session_id {session_id}] search->storage: load file task err: {}",
                    e
                );
            }
        }
    }

    Ok((cache_type, delete_files))
}
