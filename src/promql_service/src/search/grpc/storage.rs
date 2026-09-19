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

use config::{
    get_config,
    meta::{
        promql::MetricsBlockScan,
        search::{Session as SearchSession, StorageType},
        stream::{
            FileKey, FileSelection, PartitionTimeLevel, StreamParams, StreamPartition, StreamType,
        },
    },
    metrics::{self, QUERY_PARQUET_CACHE_RATIO_NODE},
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;
use infra::{
    cache::file_data,
    schema::{get_partition_time_level, unwrap_stream_settings},
};
use itertools::Itertools;
use metrics_index::MetricsFileLayout;
use promql_parser::label::Matchers;
use search::{
    datafusion::{exec::register_metrics_table_with_blocks, sort_order::FileSortOrder},
    file_cache::{cache_files, calc_target_partitions, inspect_file_cache},
};
use search_service::match_source;
use tracing::Instrument;

use crate::search::grpc::Context;

#[tracing::instrument(name = "promql:search:grpc:storage:create_context", skip(trace_id))]
pub(crate) async fn create_context(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    matchers: Matchers,
    filters: &mut [(String, Vec<String>)],
) -> Result<Option<Context>> {
    let enter_span = tracing::span::Span::current();

    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(org_id, StreamType::Metrics, stream_name, None) {
        log::error!("stream [{stream_name}] is being deleted");
        return Ok(None);
    }

    // get latest schema
    let stream_type = StreamType::Metrics;
    let schema = match infra::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("[trace_id {trace_id}] get schema error: {err}");
            return Err(datafusion::error::DataFusionError::Execution(
                err.to_string(),
            ));
        }
    };
    if schema.fields().is_empty() {
        // stream not found
        return Ok(None);
    }

    // get partition time level
    let stream_settings = unwrap_stream_settings(&schema).unwrap_or_default();
    let partition_time_level = get_partition_time_level(stream_type);

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
    let mut scan_stats = match infra::file_list::calculate_files_size(&files.to_vec()).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("[trace_id {trace_id}] calculate files size error: {err}");
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
    let cfg = get_config();
    let cache_inputs = files
        .iter()
        .map(|f| {
            (
                f.id,
                &f.account,
                &f.key,
                f.meta.compressed_size,
                f.meta.max_ts,
            )
        })
        .collect_vec();
    let (cache_type, cache_hits, cache_misses) =
        if cfg.compact.metrics_index_enabled && cfg.compact.metrics_index_blocks_enabled {
            let (_, hits, misses) =
                inspect_file_cache(trace_id, &cache_inputs, &mut scan_stats, "parquet")
                    .instrument(enter_span.clone())
                    .await;
            (file_data::CacheType::None, hits, misses)
        } else {
            cache_files(trace_id, &cache_inputs, &mut scan_stats, "parquet")
                .instrument(enter_span.clone())
                .await
        };

    // report cache hit and miss metrics
    metrics::QUERY_DISK_CACHE_HIT_COUNT
        .with_label_values(&[org_id, &stream_type.to_string(), "parquet"])
        .inc_by(cache_hits);
    metrics::QUERY_DISK_CACHE_MISS_COUNT
        .with_label_values(&[org_id, &stream_type.to_string(), "parquet"])
        .inc_by(cache_misses);

    scan_stats.querier_files = scan_stats.files;
    let cached_ratio = (scan_stats.querier_memory_cached_files
        + scan_stats.querier_disk_cached_files) as f64
        / scan_stats.querier_files as f64;

    let download_msg = if cache_type == file_data::CacheType::None {
        "".to_string()
    } else {
        format!(" downloading others into {cache_type:?} in background,")
    };
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: load files {}, memory cached {}, disk cached {}, cached ratio {}%,{download_msg} took: {} ms",
        scan_stats.querier_files,
        scan_stats.querier_memory_cached_files,
        scan_stats.querier_disk_cached_files,
        (cached_ratio * 100.0) as usize,
        cache_start.elapsed().as_millis()
    );

    if scan_stats.querier_files > 0 {
        QUERY_PARQUET_CACHE_RATIO_NODE
            .with_label_values(&[org_id, &StreamType::Metrics.to_string()])
            .observe(cached_ratio);
    }

    let target_partitions =
        calc_target_partitions(cfg.limit.cpu_num, cfg.limit.query_thread_num, cached_ratio);

    log::info!(
        "[trace_id {trace_id}] promql->search->storage: session target_partitions: {target_partitions}"
    );

    let schema = Arc::new(schema.to_owned().with_metadata(Default::default()));

    // Prune indexed metrics files through their `.midx` metrics indexes: matching
    // physical rows are attached to each FileKey before the metrics table is
    // built. Files of any other layout (legacy or not yet finalized hours) are
    // scanned in full; the PromQL matchers are always applied by the query.
    let mut keep_filters = true;
    match metrics_index::search(
        trace_id,
        &mut files,
        schema.as_ref(),
        &matchers,
        target_partitions,
    )
    .await
    {
        Ok(Some((took_ms, exact))) => {
            scan_stats.idx_took = took_ms as i64;
            // exact selections already hold only the matching series' rows
            keep_filters = !exact;
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!(
                "[trace_id {trace_id}] promql->search->storage: metrics-index query failed, falling back to a full scan: {error}"
            );
        }
    };

    log::info!(
        "[trace_id {trace_id}] promql->search->storage: after metrics-index pruning, files {}, scan_size {}, compressed_size {}, index took: {} ms",
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size,
        scan_stats.idx_took
    );

    let session = SearchSession {
        id: trace_id.to_string(),
        storage_type: StorageType::Memory,
        work_group: None,
        target_partitions,
    };

    let sort_order = if cfg.search.feature_metrics_streaming_agg_enabled
        && MetricsFileLayout::all_hash_ordered(&files)
    {
        FileSortOrder::HashTimestampAsc
    } else {
        FileSortOrder::None
    };

    let block_scan = block_scan_candidate(
        stream_name,
        &files,
        sort_order,
        keep_filters,
        cfg.compact.metrics_index_enabled && cfg.compact.metrics_index_blocks_enabled,
    );
    let ctx = register_metrics_table_with_blocks(
        &session,
        schema.clone(),
        stream_name,
        files,
        sort_order,
        block_scan,
    )
    .await?;

    // keep_filters=false only when the pruner proved its selections exact
    Ok(Some((ctx, schema, scan_stats, keep_filters)))
}

fn block_scan_candidate(
    table_name: &str,
    files: &[FileKey],
    sort_order: FileSortOrder,
    keep_filters: bool,
    enabled: bool,
) -> Option<Arc<MetricsBlockScan>> {
    (enabled
        && !keep_filters
        && sort_order == FileSortOrder::HashTimestampAsc
        && block_selection_fraction(files).is_some())
    .then(|| {
        Arc::new(MetricsBlockScan {
            table_name: table_name.to_owned(),
            files: files.to_vec(),
        })
    })
}

fn block_selection_fraction(files: &[FileKey]) -> Option<f64> {
    let mut selected = 0u128;
    let mut total = 0u128;
    for file in files {
        if file.deleted
            || !file.key.ends_with(".parquet")
            || MetricsFileLayout::of(&file.key) != Some(MetricsFileLayout::Indexed)
            || file.meta.compressed_size <= 0
        {
            return None;
        }
        let records = usize::try_from(file.meta.records)
            .ok()
            .filter(|rows| *rows > 0)?;
        let Some(FileSelection::RowRanges(ranges)) = &file.selection else {
            return None;
        };
        let mut previous_end = 0;
        for range in ranges.iter() {
            if range.start < previous_end || range.start >= range.end || range.end > records {
                return None;
            }
            selected = selected.checked_add((range.end - range.start) as u128)?;
            previous_end = range.end;
        }
        total = total.checked_add(records as u128)?;
    }
    (total > 0 && selected > 0).then(|| selected as f64 / total as f64)
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
    let results = match search_service::file_list::query(
        trace_id,
        org_id,
        StreamType::Metrics,
        stream_name,
        time_level,
        time_min,
        time_max,
    )
    .await
    {
        Ok(results) => results,
        Err(err) => {
            log::error!("[trace_id {trace_id}] get file list error: {err}");
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

#[cfg(test)]
mod block_selection_tests {
    use std::ops::Range;

    use config::meta::stream::FileMeta;

    use super::*;

    fn selected(records: i64, ranges: Vec<Range<usize>>) -> FileKey {
        let mut file = FileKey::new(
            1,
            String::new(),
            "files/org/metrics/metric/2026/01/01/00/indexed-v1-unique.parquet".to_string(),
            FileMeta {
                records,
                compressed_size: 100,
                ..Default::default()
            },
            false,
        );
        file.selection = Some(FileSelection::RowRanges(Arc::new(ranges)));
        file
    }

    #[test]
    fn density_is_weighted_by_rows_without_inspecting_matcher_labels() {
        assert_eq!(
            block_selection_fraction(&[
                selected(100, std::iter::once(10..20).collect()),
                selected(300, std::iter::once(0..30).collect())
            ]),
            Some(0.1)
        );
        assert_eq!(
            block_selection_fraction(&[selected(100, std::iter::once(0..100).collect())]),
            Some(1.0)
        );
        assert_eq!(
            block_selection_fraction(&[selected(100, vec![0..10, 10..20])]),
            Some(0.2)
        );
    }

    #[test]
    fn rejects_unknown_or_incomplete_selection_coverage() {
        assert_eq!(block_selection_fraction(&[]), None);
        assert_eq!(block_selection_fraction(&[selected(0, vec![])]), None);
        assert_eq!(block_selection_fraction(&[selected(100, vec![])]), None);
        for ranges in [
            std::iter::once(10..10).collect(),
            std::iter::once(10..101).collect(),
            vec![20..30, 10..20],
            vec![0..20, 10..30],
        ] {
            assert_eq!(block_selection_fraction(&[selected(100, ranges)]), None);
        }
        let sparse = selected(100, std::iter::once(0..10).collect());
        let mut unselected = sparse.clone();
        unselected.selection = None;
        assert_eq!(block_selection_fraction(&[sparse, unselected]), None);
        for key in [
            "files/org/metrics/metric/2026/01/01/00/indexed-v1-id.vortex",
            "files/org/metrics/metric/2026/01/01/00/hash-sorted-v1-id.parquet",
        ] {
            let mut file = selected(100, std::iter::once(0..10).collect());
            file.key = key.to_string();
            assert_eq!(block_selection_fraction(&[file]), None);
        }
        let mut deleted = selected(100, std::iter::once(0..10).collect());
        deleted.deleted = true;
        assert_eq!(block_selection_fraction(&[deleted]), None);
    }
    #[test]
    fn block_rollout_flag_gates_all_selection_densities() {
        for end in [1, 25, 100] {
            let files = vec![selected(100, std::iter::once(0..end).collect())];
            assert!(
                block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, false, true)
                    .is_some()
            );
            assert!(
                block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, false, false)
                    .is_none()
            );
            assert!(
                block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, true, true)
                    .is_none()
            );
            assert!(block_scan_candidate("m", &files, FileSortOrder::None, false, true).is_none());
        }
    }
}
