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

use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::VALUE_LABEL,
        search::{ScanStats, Session as SearchSession, StorageType},
        stream::{FileKey, PartitionTimeLevel, StreamParams, StreamPartition, StreamType},
    },
    metrics::QUERY_PARQUET_CACHE_RATIO_NODE,
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
use itertools::Itertools;
use promql_parser::label::{MatchOp, Matchers};
use tracing::Instrument;

use crate::service::{
    db, file_list,
    search::{
        datafusion::exec::register_table,
        grpc::{
            QueryParams,
            storage::{cache_files, filter_file_list_by_tantivy_index},
        },
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
    let enter_span = tracing::span::Span::current();

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
    let file_list_start = std::time::Instant::now();
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
    let mut scan_stats = match file_list::calculate_files_size(&files.to_vec()).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("[trace_id {trace_id}] calculate files size error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                "calculate files size error".to_string(),
            ));
        }
    };
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: load files {}, scan_size {}, compressed_size {}, took: {} ms",
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size,
        file_list_start.elapsed().as_millis()
    );

    // load files to local cache
    let cache_start = std::time::Instant::now();
    let cache_type = cache_files(
        trace_id,
        &files
            .iter()
            .map(|f| (&f.account, &f.key, f.meta.compressed_size))
            .collect_vec(),
        &mut scan_stats,
        "parquet",
    )
    .instrument(enter_span.clone())
    .await
    .map_err(|e| {
        log::error!("[trace_id {trace_id}] promql->search->storage: cache files error: {e}");
        DataFusionError::Execution(e.to_string())
    })?;

    scan_stats.querier_files = scan_stats.files;
    let parquet_cached_ratio = (((scan_stats.querier_memory_cached_files
        + scan_stats.querier_disk_cached_files)
        * 100) as f64
        / scan_stats.querier_files as f64) as usize;

    let download_msg = if cache_type == file_data::CacheType::None {
        "".to_string()
    } else {
        format!(" downloading others into {:?} in background,", cache_type)
    };
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: load files {}, memory cached {}, disk cached {}, cache ratio: {},{download_msg} took: {} ms",
        scan_stats.querier_files,
        scan_stats.querier_memory_cached_files,
        scan_stats.querier_disk_cached_files,
        parquet_cached_ratio,
        cache_start.elapsed().as_millis()
    );

    if parquet_cached_ratio > 0 {
        QUERY_PARQUET_CACHE_RATIO_NODE
            .with_label_values(&[org_id, &stream_type.to_string()])
            .inc_by(parquet_cached_ratio as u64);
    }

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
        log::info!(
            "[trace_id {trace_id}] promql->search->storage: filter file list by tantivy index took: {idx_took} ms",
        );
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
        true,
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
        trace_id,
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
    let mut files = Vec::with_capacity(results.len());
    for file in results {
        if match_source(stream_params.clone(), Some(time_range), filters, &file).await {
            files.push(file);
        }
    }
    Ok(files)
}

fn convert_matchers_to_index_condition(
    matchers: &Matchers,
    schema: &Arc<Schema>,
    index_fields: &HashSet<String>,
) -> Result<IndexCondition> {
    let mut index_condition = IndexCondition::default();
    for mat in matchers.matchers.iter() {
        if mat.name == TIMESTAMP_COL_NAME
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
