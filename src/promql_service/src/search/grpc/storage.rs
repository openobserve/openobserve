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
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::{MetricsBlockScan, NAME_LABEL, VALUE_LABEL, is_metrics_hash_excluded_label},
        search::{ScanStats, Session as SearchSession, StorageType},
        stream::{FileKey, PartitionTimeLevel, StreamParams, StreamPartition, StreamType},
    },
    metrics::{self, QUERY_PARQUET_CACHE_RATIO_NODE},
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    schema::{get_stream_partition_time_level, unwrap_stream_settings},
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

#[derive(Debug)]
pub(super) struct BlockPreference<'a> {
    pub enabled: bool,
    pub output_labels: &'a HashSet<String>,
}

#[tracing::instrument(name = "promql:search:grpc:storage:create_context", skip(trace_id))]
pub(crate) async fn create_context(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    matchers: Matchers,
    filters: &mut [(String, Vec<String>)],
    block_preference: BlockPreference<'_>,
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
    // files are selected by min_ts/max_ts, so a range spanning a level change still
    // finds both layouts; the level is only passed along as a hint
    let partition_time_level =
        get_stream_partition_time_level(stream_type, Some(&stream_settings), time_range.1);

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
    let block_eligible = block_preference.enabled
        && get_config().compact.metrics_index_enabled
        && get_config().search.feature_metrics_streaming_agg_enabled
        && files.iter().all(block_parent_eligible)
        && block_output_labels_supported(&schema, block_preference.output_labels)
        && block_matchers_supported(&schema, &matchers);
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
    let (cache_type, cache_hits, cache_misses) = if block_eligible {
        let (_, hits, misses) = inspect_file_cache(trace_id, &cache_inputs, &mut scan_stats)
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

    let cfg = get_config();
    let target_partitions =
        calc_target_partitions(cfg.limit.cpu_num, cfg.limit.query_thread_num, cached_ratio);

    log::info!(
        "[trace_id {trace_id}] promql->search->storage: session target_partitions: {target_partitions}"
    );

    let schema = Arc::new(schema.to_owned().with_metadata(Default::default()));

    if block_eligible {
        log::info!(
            "[trace_id {trace_id}] promql->search->storage: MIDX block candidate across {} files; row selection deferred to block preflight",
            files.len()
        );
    }
    cache_metrics_index_files(trace_id, org_id, &files).await;

    let mut keep_filters = true;
    if !block_eligible {
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
                keep_filters = !exact;
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!(
                    "[trace_id {trace_id}] promql->search->storage: metrics-index row selection failed; continuing the source scan: {error}"
                );
            }
        };
    }

    // every indexed file was pruned away: nothing in storage can match the selector
    if files.is_empty() {
        log::info!(
            "[trace_id {trace_id}] promql->search->storage: metrics-index pruning left no files, index took: {} ms",
            scan_stats.idx_took
        );
        return Ok(None);
    }

    log::info!(
        "[trace_id {trace_id}] promql->search->storage: after metrics-index path selection, files {}, scan_size {}, compressed_size {}, index took: {} ms",
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

    let block_scan = block_scan_candidate(stream_name, &files, sort_order, block_eligible);
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

fn block_parent_eligible(file: &FileKey) -> bool {
    !file.deleted
        && config::FileFormat::from_extension(&file.key).is_some()
        && MetricsFileLayout::of(&file.key) == Some(MetricsFileLayout::Indexed)
        && file.meta.records > 0
        && file.meta.compressed_size > 0
        && file.meta.mindex_size > 0
}

fn block_output_labels_supported(
    schema: &arrow::datatypes::Schema,
    label_selector: &HashSet<String>,
) -> bool {
    !schema.fields().iter().any(|field| {
        (label_selector.is_empty() || label_selector.contains(field.name()))
            && is_metrics_hash_excluded_label(field.name())
            && matches!(
                field.data_type(),
                arrow::datatypes::DataType::Utf8
                    | arrow::datatypes::DataType::LargeUtf8
                    | arrow::datatypes::DataType::Utf8View
            )
    })
}

fn block_matchers_supported(schema: &arrow::datatypes::Schema, matchers: &Matchers) -> bool {
    matchers.or_matchers.is_empty()
        && matchers.matchers.iter().all(|matcher| {
            if [NAME_LABEL, VALUE_LABEL, TIMESTAMP_COL_NAME].contains(&matcher.name.as_str()) {
                return true;
            }
            let Ok(field) = schema.field_with_name(&matcher.name) else {
                return false;
            };
            !is_metrics_hash_excluded_label(&matcher.name)
                && matches!(
                    field.data_type(),
                    arrow::datatypes::DataType::Utf8
                        | arrow::datatypes::DataType::LargeUtf8
                        | arrow::datatypes::DataType::Utf8View
                )
        })
}

fn block_scan_candidate(
    table_name: &str,
    files: &[FileKey],
    sort_order: FileSortOrder,
    enabled: bool,
) -> Option<Arc<MetricsBlockScan>> {
    (enabled
        && sort_order == FileSortOrder::HashTimestampAsc
        && !files.is_empty()
        && files.iter().all(block_parent_eligible))
    .then(|| {
        Arc::new(MetricsBlockScan {
            table_name: table_name.to_owned(),
            files: files.to_vec(),
        })
    })
}

/// Prefetch the `.midx` sidecars like the Tantivy path prefetches `.ttv` files:
/// misses download in the background, this query reads them from storage.
async fn cache_metrics_index_files(trace_id: &str, org_id: &str, files: &[FileKey]) {
    let sidecars = files
        .iter()
        .filter(|f| f.meta.mindex_size > 0)
        .filter_map(|f| MetricsFileLayout::metrics_index_path(&f.key).map(|path| (f, path)))
        .collect_vec();
    if sidecars.is_empty() {
        return;
    }
    let start = std::time::Instant::now();
    let mut sidecar_stats = ScanStats {
        compressed_size: sidecars.iter().fold(0i64, |size, (file, _)| {
            size.saturating_add(file.meta.mindex_size)
        }),
        ..Default::default()
    };
    let (cache_type, cache_hits, cache_misses) = cache_files(
        trace_id,
        &sidecars
            .iter()
            .map(|(f, path)| {
                (
                    f.id,
                    &f.account,
                    path,
                    f.meta.mindex_size.max(0),
                    f.meta.max_ts,
                )
            })
            .collect_vec(),
        &mut sidecar_stats,
        "midx",
    )
    .await;
    metrics::QUERY_DISK_CACHE_HIT_COUNT
        .with_label_values(&[org_id, &StreamType::Metrics.to_string(), "midx"])
        .inc_by(cache_hits);
    metrics::QUERY_DISK_CACHE_MISS_COUNT
        .with_label_values(&[org_id, &StreamType::Metrics.to_string(), "midx"])
        .inc_by(cache_misses);
    log::info!(
        "[trace_id {trace_id}] promql->search->storage: metrics index files {}, compressed_size {}, memory cached {}, disk cached {}, downloading others into {cache_type:?} in background, took: {} ms",
        sidecars.len(),
        sidecar_stats.compressed_size,
        sidecar_stats.querier_memory_cached_files,
        sidecar_stats.querier_disk_cached_files,
        start.elapsed().as_millis()
    );
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
mod tests {
    use config::meta::stream::FileMeta;
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use promql_parser::label::{MatchOp, Matcher};

    use super::*;

    fn file(records: i64) -> FileKey {
        FileKey::new(
            1,
            String::new(),
            "files/org/metrics/m/2026/09/23/00/indexed-v1-id.parquet".into(),
            FileMeta {
                records,
                compressed_size: 100,
                mindex_size: 50,
                ..Default::default()
            },
            false,
        )
    }

    #[test]
    fn unfiltered_scan_uses_all_rows_without_source_selection() {
        let files = vec![file(100)];
        let scan =
            block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, true).unwrap();
        assert_eq!(scan.files.len(), 1);
        assert!(files[0].selection.is_none());
    }

    #[test]
    fn filtered_scan_is_chosen_before_row_selection() {
        let files = vec![file(100)];
        assert!(block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, true).is_some());
        assert!(
            block_scan_candidate("m", &files, FileSortOrder::HashTimestampAsc, false).is_none()
        );
        let mut missing = files;
        missing[0].meta.mindex_size = 0;
        assert!(
            block_scan_candidate("m", &missing, FileSortOrder::HashTimestampAsc, true).is_none()
        );
    }

    #[test]
    fn block_matchers_require_identity_labels() {
        let schema = Schema::new(vec![
            Field::new("path", DataType::Utf8, true),
            Field::new("start_time", DataType::Utf8, true),
        ]);
        let path = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "/api/bar")]);
        let point = Matchers::new(vec![Matcher::new(MatchOp::Equal, "start_time", "x")]);
        assert!(block_matchers_supported(&schema, &path));
        assert!(!block_matchers_supported(&schema, &point));
    }

    #[test]
    fn block_output_labels_require_identity_metadata() {
        let schema = Schema::new(vec![
            Field::new("path", DataType::Utf8, true),
            Field::new("start_time", DataType::Utf8, true),
            Field::new("flag", DataType::Utf8View, true),
            Field::new("trace_id", DataType::LargeUtf8, true),
            Field::new("is_monotonic", DataType::Boolean, true),
        ]);
        assert!(!block_output_labels_supported(&schema, &HashSet::new()));
        for name in ["start_time", "flag", "trace_id"] {
            assert!(!block_output_labels_supported(
                &schema,
                &HashSet::from([name.to_string()]),
            ));
        }
        assert!(block_output_labels_supported(
            &schema,
            &HashSet::from(["path".to_string()]),
        ));
        assert!(block_output_labels_supported(
            &schema,
            &HashSet::from(["is_monotonic".to_string()]),
        ));
    }
}
