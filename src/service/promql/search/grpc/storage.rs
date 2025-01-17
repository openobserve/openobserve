// Copyright 2024 OpenObserve Inc.
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

use config::{
    get_config, is_local_disk_storage,
    meta::{
        promql::VALUE_LABEL,
        search::{ScanStats, Session as SearchSession, StorageType},
        stream::{FileKey, PartitionTimeLevel, StreamParams, StreamPartition, StreamType},
    },
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    schema::{
        get_stream_setting_index_fields, unwrap_partition_time_level, unwrap_stream_settings,
    },
};
use promql_parser::label::{MatchOp, Matchers};
use tokio::sync::Semaphore;

use crate::service::{
    db, file_list,
    search::{
        datafusion::exec::register_table,
        grpc::{storage::filter_file_list_by_tantivy_index, QueryParams},
        index::{Condition, IndexCondition},
        match_source,
    },
};

#[tracing::instrument(name = "promql:search:grpc:storage:create_context", skip(trace_id))]
pub(crate) async fn create_context(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    matchers: Matchers,
    filters: &mut [(String, Vec<String>)],
) -> Result<Option<(SessionContext, Arc<Schema>, ScanStats)>> {
    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(org_id, StreamType::Metrics, stream_name, None) {
        log::error!("stream [{}] is being deleted", stream_name);
        return Ok(None);
    }

    // get latest schema
    let stream_type = StreamType::Metrics;
    let schema = match infra::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("[trace_id {trace_id}] get schema error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                err.to_string(),
            ));
        }
    };
    if schema.fields().is_empty() {
        // stream not found
        return Ok(None);
    }

    // get index fields
    let stream_settings = unwrap_stream_settings(&schema);
    let index_fields = get_stream_setting_index_fields(&stream_settings)
        .into_iter()
        .collect::<HashSet<_>>();

    // get partition time level
    let stream_settings = stream_settings.unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    // rewrite partition filters
    let partition_keys: HashMap<&String, &StreamPartition> = stream_settings
        .partition_keys
        .iter()
        .map(|v| (&v.field, v))
        .collect();
    for entry in filters.iter_mut() {
        if let Some(partition_key) = partition_keys.get(&entry.0) {
            for val in entry.1.iter_mut() {
                *val = partition_key.get_partition_value(val);
            }
        }
    }

    // get file list
    let mut files = get_file_list(
        trace_id,
        org_id,
        stream_name,
        partition_time_level,
        time_range,
        filters,
    )
    .await?;
    if files.is_empty() {
        return Ok(None);
    }

    // calculate scan size
    let scan_stats = match file_list::calculate_files_size(&files.to_vec()).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("[trace_id {trace_id}] calculate files size error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                "calculate files size error".to_string(),
            ));
        }
    };
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: load files {}, scan_size {}, compressed_size {}",
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    // load files to local cache
    let (cache_type, deleted_files) = cache_parquet_files(trace_id, &files, &scan_stats).await?;
    if !deleted_files.is_empty() {
        // remove deleted files
        files.retain(|f| !deleted_files.contains(&f.key));
    }
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: load files {}, into {:?} cache done",
        scan_stats.files,
        cache_type
    );

    // set target partitions based on cache type
    let cfg = get_config();
    let target_partitions = if cache_type == file_data::CacheType::None {
        cfg.limit.query_thread_num
    } else {
        cfg.limit.cpu_num
    };

    let schema = Arc::new(
        schema
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    let query = Arc::new(QueryParams {
        trace_id: trace_id.to_string(),
        org_id: org_id.to_string(),
        stream_type: StreamType::Metrics,
        stream_name: stream_name.to_string(),
        time_range: Some(time_range),
        work_group: None,
        use_inverted_index: true,
    });

    // search tantivy index
    let index_condition = convert_matchers_to_index_condition(&matchers, &schema, &index_fields)?;
    if !index_condition.conditions.is_empty() && cfg.common.inverted_index_enabled {
        let (idx_took, ..) =
            filter_file_list_by_tantivy_index(query, &mut files, Some(index_condition), None)
                .await
                .map_err(|e| {
                    log::error!(
                        "[trace_id {trace_id}] promql->search->storage: filter file list by tantivy index error: {e}"
                    );
                    DataFusionError::Execution(e.to_string())
                })?;
        log::info!("[trace_id {trace_id}] promql->search->storage: filter file list by tantivy index took: {idx_took} ms",);
    }

    let session = SearchSession {
        id: trace_id.to_string(),
        storage_type: StorageType::Memory,
        work_group: None,
        target_partitions,
    };

    let ctx = register_table(
        &session,
        schema.clone(),
        stream_name,
        &files,
        HashMap::default(),
        &[],
    )
    .await?;
    Ok(Some((ctx, schema, scan_stats)))
}

#[tracing::instrument(name = "promql:search:grpc:storage:get_file_list", skip(trace_id))]
async fn get_file_list(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_range: (i64, i64),
    filters: &[(String, Vec<String>)],
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
            log::error!("[trace_id {trace_id}] get file list error: {}", err);
            return Err(DataFusionError::Execution(
                "get file list error".to_string(),
            ));
        }
    };

    let stream_params = Arc::new(StreamParams::new(org_id, stream_name, StreamType::Metrics));
    let mut files = Vec::new();
    for file in results {
        if match_source(stream_params.clone(), Some(time_range), filters, &file).await {
            files.push(file.clone());
        }
    }
    Ok(files)
}

// TODO: unify cache_parquet_files and cache_files
#[tracing::instrument(name = "promql:search:grpc:storage:cache_parquet_files", skip_all)]
async fn cache_parquet_files(
    trace_id: &str,
    files: &[FileKey],
    scan_stats: &ScanStats,
) -> Result<(file_data::CacheType, Vec<String>)> {
    let cfg = config::get_config();
    let cache_type = if cfg.memory_cache.enabled
        && scan_stats.compressed_size < cfg.memory_cache.skip_size as i64
    {
        // if scan_compressed_size < ZO_MEMORY_CACHE_SKIP_SIZE, use memory cache
        file_data::CacheType::Memory
    } else if !is_local_disk_storage()
        && cfg.disk_cache.enabled
        && scan_stats.compressed_size < cfg.disk_cache.skip_size as i64
    {
        // if scan_compressed_size < ZO_DISK_CACHE_SKIP_SIZE, use disk cache
        file_data::CacheType::Disk
    } else {
        // no cache
        return Ok((file_data::CacheType::None, vec![]));
    };

    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.query_thread_num));
    for file in files.iter() {
        let trace_id = "";
        let file_name = file.key.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = match cache_type {
                file_data::CacheType::Memory => {
                    if !file_data::memory::exist(&file_name).await
                        && !file_data::disk::exist(&file_name).await
                    {
                        file_data::memory::download(trace_id, &file_name)
                            .await
                            .err()
                    } else {
                        None
                    }
                }
                file_data::CacheType::Disk => {
                    if !file_data::disk::exist(&file_name).await {
                        file_data::disk::download(trace_id, &file_name).await.err()
                    } else {
                        None
                    }
                }
                _ => None,
            };
            let ret = if let Some(e) = ret {
                if e.to_string().to_lowercase().contains("not found")
                    || e.to_string().to_lowercase().contains("data size is zero")
                {
                    // delete file from file list
                    log::warn!("found invalid file: {}", file_name);
                    if let Err(e) = file_list::delete_parquet_file(&file_name, true).await {
                        log::error!("[trace_id {trace_id}] promql->search->storage: delete from file_list err: {}", e);
                    }
                    Some(file_name)
                } else {
                    log::error!("[trace_id {trace_id}] promql->search->storage: download file to cache err: {}", e);
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
                    "[trace_id {trace_id}] promql->search->storage: load file task err: {}",
                    e
                );
            }
        }
    }

    Ok((cache_type, delete_files))
}

fn convert_matchers_to_index_condition(
    matchers: &Matchers,
    schema: &Arc<Schema>,
    index_fields: &HashSet<String>,
) -> Result<IndexCondition> {
    let mut index_condition = IndexCondition::default();
    let cfg = get_config();
    for mat in matchers.matchers.iter() {
        if mat.name == cfg.common.column_timestamp
            || mat.name == VALUE_LABEL
            || !index_fields.contains(&mat.name)
            || schema.field_with_name(&mat.name).is_err()
        {
            continue;
        }
        let condition = match &mat.op {
            MatchOp::Equal => Condition::Equal(mat.name.clone(), mat.value.clone()),
            MatchOp::Re(regex) => Condition::Regex(mat.name.clone(), regex.to_string()),
            _ => continue,
        };
        index_condition.add_condition(condition);
    }
    Ok(index_condition)
}
