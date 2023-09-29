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

use datafusion::{
    arrow::datatypes::Schema,
    common::FileType,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use std::sync::Arc;
use tokio::sync::Semaphore;

use crate::common::{
    infra::{
        cache::file_data,
        config::{is_local_disk_storage, CONFIG},
    },
    meta::{
        common::FileKey,
        search::Session as SearchSession,
        stream::{PartitionTimeLevel, ScanStats, StreamParams},
        StreamType,
    },
};
use crate::service::{
    db, file_list,
    search::{
        datafusion::{exec::register_table, storage::StorageType},
        match_source,
    },
    stream,
};

#[tracing::instrument(name = "promql:search:grpc:storage:create_context", skip_all, fields(org_id = org_id, stream_name = stream_name))]
pub(crate) async fn create_context(
    session_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(&str, &str)],
) -> Result<(SessionContext, Arc<Schema>, ScanStats)> {
    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(org_id, stream_name, StreamType::Metrics, None) {
        log::error!("stream [{}] is being deleted", stream_name);
        return Ok((
            SessionContext::new(),
            Arc::new(Schema::empty()),
            ScanStats::default(),
        ));
    }

    // get latest schema
    let stream_type = StreamType::Metrics;
    let schema = match db::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("get schema error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                err.to_string(),
            ));
        }
    };
    let stream_settings = stream::stream_settings(&schema).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    // get file list
    let mut files = get_file_list(
        org_id,
        stream_name,
        partition_time_level,
        time_range,
        filters,
    )
    .await?;
    if files.is_empty() {
        return Ok((
            SessionContext::new(),
            Arc::new(Schema::empty()),
            ScanStats::default(),
        ));
    }

    // calcuate scan size
    let scan_stats = match file_list::calculate_files_size(&files.to_vec()).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("calculate files size error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                "calculate files size error".to_string(),
            ));
        }
    };
    log::info!(
        "promql->search->storage: load files {}, scan_size {}, compressed_size {}",
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    // load files to local cache
    let (cache_type, deleted_files) = cache_parquet_files(&files, &scan_stats).await?;
    if !deleted_files.is_empty() {
        // remove deleted files
        files.retain(|f| !deleted_files.contains(&f.key));
    }
    log::info!(
        "promql->search->storage: load files {}, into {:?} cache done",
        scan_stats.files,
        cache_type
    );

    let schema = Arc::new(
        schema
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    let session = SearchSession {
        id: session_id.to_string(),
        storage_type: StorageType::Memory,
    };

    let ctx = register_table(
        &session,
        schema.clone(),
        stream_name,
        &files,
        FileType::PARQUET,
    )
    .await?;
    Ok((ctx, schema, scan_stats))
}

#[tracing::instrument(name = "promql:search:grpc:storage:get_file_list", skip_all, fields(org_id = org_id, stream_name = stream_name))]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_range: (i64, i64),
    filters: &[(&str, &str)],
) -> Result<Vec<FileKey>> {
    let (time_min, time_max) = time_range;
    let results = match file_list::query(
        org_id,
        stream_name,
        StreamType::Metrics,
        time_level,
        time_min,
        time_max,
    )
    .await
    {
        Ok(results) => results,
        Err(err) => {
            log::error!("get file list error: {}", err);
            return Err(DataFusionError::Execution(
                "get file list error".to_string(),
            ));
        }
    };

    let mut files = Vec::new();
    for file in results {
        if match_source(
            StreamParams::new(org_id, stream_name, StreamType::Metrics),
            Some(time_range),
            filters,
            &file,
            false,
            false,
        )
        .await
        {
            files.push(file.clone());
        }
    }
    Ok(files)
}

#[tracing::instrument(name = "promql:search:grpc:storage:cache_parquet_files", skip_all)]
async fn cache_parquet_files(
    files: &[FileKey],
    scan_stats: &ScanStats,
) -> Result<(file_data::CacheType, Vec<String>)> {
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
        let file_name = file.key.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = match cache_type {
                file_data::CacheType::Memory => {
                    if !file_data::memory::exist(&file_name).await {
                        file_data::memory::download(&file_name).await.err()
                    } else {
                        None
                    }
                }
                file_data::CacheType::Disk => {
                    if !file_data::disk::exist(&file_name).await {
                        file_data::disk::download(&file_name).await.err()
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
                        log::error!("promql->search->storage: delete from file_list err: {}", e);
                    }
                    Some(file_name)
                } else {
                    log::error!("promql->search->storage: download file to cache err: {}", e);
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
                log::error!("promql->search->storage: load file task err: {}", e);
            }
        }
    }

    Ok((cache_type, delete_files))
}
