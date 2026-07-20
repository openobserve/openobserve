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

pub use ::search::file_cache::{cache_files, calc_target_partitions};
use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::{ScanStats, StorageType},
        stream::FileKey,
    },
    metrics::{self, QUERY_PARQUET_CACHE_RATIO_NODE},
    utils::size::bytes_to_human_readable,
};
use datafusion::execution::cache::cache_manager::FileStatisticsCache;
use hashbrown::HashSet;
use infra::{
    cache::file_data,
    errors::{Error, ErrorCodes},
};
use itertools::Itertools;
use tracing::Instrument;

pub use crate::service::search::tantivy::tantivy_search;
use crate::service::{
    file_list,
    search::{
        bloom_pruner,
        index::IndexCondition,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    },
};

/// search in remote object storage
#[tracing::instrument(name = "service:search:grpc:storage", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
#[allow(clippy::too_many_arguments)]
pub async fn search(
    query: Arc<super::QueryParams>,
    schema: Arc<Schema>,
    file_list: &[FileKey],
    sorted_by_time: bool,
    file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    mut index_condition: Option<IndexCondition>,
    mut fst_fields: Vec<String>,
    bloom_indexed_fields: Vec<String>,
    idx_optimize_rule: Option<IndexOptimizeMode>,
) -> super::SearchTable {
    let super::QueryParams {
        trace_id,
        org_id,
        stream_type,
        stream_name,
        use_inverted_index,
        work_group,
        ..
    } = query.as_ref();
    let enter_span = tracing::span::Span::current();
    log::info!("[trace_id {trace_id}] search->storage: enter");
    let mut files = file_list.to_vec();
    if files.is_empty() {
        return Ok((vec![], ScanStats::default(), HashSet::new()));
    }
    let original_files_len = files.len();
    log::info!(
        "[trace_id {trace_id}] search->storage: stream {org_id}/{stream_type}/{stream_name}, load file_list num {}",
        files.len(),
    );

    let mut idx_took = 0;
    let mut is_add_filter_back = false;
    if *use_inverted_index && !index_condition.as_ref().unwrap().is_condition_all() {
        // check bloom filter first
        let (bloom_took, ok) = check_bloom_filter(
            query.clone(),
            &mut files,
            index_condition.clone(),
            bloom_indexed_fields,
        )
        .await?;
        if ok {
            log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] search->bloom: stream {org_id}/{stream_type}/{stream_name}, bloom filter reduced file_list num to {} in {bloom_took} ms",
                    files.len(),
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("storage bloom filter reduced file_list num".to_string())
                    .search_role("follower".to_string())
                    .duration(idx_took)
                    .desc(format!(
                        "bloom filter reduced file_list from {original_files_len} to {} in {bloom_took} ms",
                        files.len(),
                    ))
                    .build()
                )
            );
        }

        // check tantivy index
        (idx_took, is_add_filter_back, ..) = tantivy_search(
            query.clone(),
            &mut files,
            index_condition.clone(),
            idx_optimize_rule,
        )
        .await?;

        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] search->tantivy: stream {org_id}/{stream_type}/{stream_name}, inverted index reduced file_list num to {} in {idx_took} ms",
                    files.len(),
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("storage inverted index reduced file_list num".to_string())
                    .search_role("follower".to_string())
                    .duration(idx_took)
                    .desc(format!(
                        "inverted index reduced file_list from {original_files_len} to {} in {idx_took} ms",
                        files.len(),
                    ))
                    .build()
            )
        );
    }

    // set index_condition to None, means we do not need to add filter back
    if !is_add_filter_back {
        index_condition = None;
        fst_fields = vec![];
    }

    let cfg = get_config();
    let mut scan_stats = match file_list::calculate_files_size(&files).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("[trace_id {trace_id}] calculate files size error: {err}",);
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                "calculate files size error".to_string(),
            )));
        }
    };

    log::info!(
        "[trace_id {trace_id}] search->storage: stream {org_id}/{stream_type}/{stream_name}, load files {}, scan_size {}, compressed_size {}",
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    // check memory circuit breaker
    ingester::check_memory_circuit_breaker().map_err(|e| Error::ResourceError(e.to_string()))?;

    // load files to local cache
    let cache_start = std::time::Instant::now();
    let (cache_type, cache_hits, cache_misses) = cache_files(
        &query.trace_id,
        &files
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
            .collect_vec(),
        &mut scan_stats,
        "parquet",
    )
    .instrument(enter_span.clone())
    .await;

    // report cache hit and miss metrics
    metrics::QUERY_DISK_CACHE_HIT_COUNT
        .with_label_values(&[org_id.as_str(), stream_type.as_str(), "parquet"])
        .inc_by(cache_hits);
    metrics::QUERY_DISK_CACHE_MISS_COUNT
        .with_label_values(&[org_id.as_str(), stream_type.as_str(), "parquet"])
        .inc_by(cache_misses);

    scan_stats.idx_took = idx_took as i64;
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
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] search->storage: stream {org_id}/{stream_type}/{stream_name}, load files {}, memory cached {}, disk cached {}, cached ratio {}%,{download_msg} took: {} ms",
                scan_stats.querier_files,
                scan_stats.querier_memory_cached_files,
                scan_stats.querier_disk_cached_files,
                (cached_ratio * 100.0) as usize,
                cache_start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("storage load files".to_string())
                .search_role("follower".to_string())
                .duration(cache_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "load files {}, memory cached {}, disk cached {}, scan_size {}, compressed_size {}",
                    scan_stats.querier_files,
                    scan_stats.querier_memory_cached_files,
                    scan_stats.querier_disk_cached_files,
                    bytes_to_human_readable(scan_stats.original_size as f64),
                    bytes_to_human_readable(scan_stats.compressed_size as f64)
                ))
                .build()
        )
    );

    if scan_stats.querier_files > 0 {
        QUERY_PARQUET_CACHE_RATIO_NODE
            .with_label_values(&[org_id.as_str(), stream_type.as_str()])
            .observe(cached_ratio);
    }

    let target_partitions =
        calc_target_partitions(cfg.limit.cpu_num, cfg.limit.query_thread_num, cached_ratio);

    log::info!(
        "[trace_id {trace_id}] search->storage: session target_partitions: {target_partitions}"
    );

    let session = config::meta::search::Session {
        id: format!("{trace_id}-storage"),
        storage_type: StorageType::Memory,
        work_group: work_group.clone(),
        target_partitions,
    };

    let start = std::time::Instant::now();
    let tables = super::create_tables_from_files(
        files,
        session,
        query.clone(),
        schema,
        sorted_by_time,
        file_stat_cache,
        index_condition,
        fst_fields,
        || {},
    )
    .await?;

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] search->storage: create tables took: {} ms",
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("storage create tables".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );
    Ok((tables, scan_stats, HashSet::new()))
}

/// Check bloom filter for the file list
#[tracing::instrument(name = "service:search:grpc:storage:check_bloom_filter", skip_all)]
pub async fn check_bloom_filter(
    query: Arc<super::QueryParams>,
    file_list: &mut Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    bloom_indexed_fields: Vec<String>,
) -> Result<(usize, bool), Error> {
    let cfg = get_config();
    if !cfg.common.bloom_filter_enabled
        || file_list.is_empty()
        || bloom_indexed_fields.is_empty()
        || index_condition.is_none()
    {
        return Ok((0, false));
    }

    let start = std::time::Instant::now();
    let before_num = file_list.len();
    // The pruner pulls the bloom-decidable predicates out of the
    // IndexCondition itself; if none are decidable it returns the
    // input untouched (no `.bf` is touched).
    *file_list = bloom_pruner::prune(
        &query.trace_id,
        &query.org_id,
        query.stream_type,
        &query.stream_name,
        file_list.to_vec(),
        index_condition.as_ref().unwrap(),
        bloom_indexed_fields,
    )
    .await;

    // metrics
    let elapsed = start.elapsed();
    let after_num = file_list.len();
    config::metrics::BLOOM_PRUNE_KEEP_RATIO
        .with_label_values(&[query.org_id.as_str(), query.stream_type.as_str()])
        .observe(after_num as f64 / before_num as f64);

    config::metrics::BLOOM_PRUNE_DURATION
        .with_label_values(&[query.org_id.as_str(), query.stream_type.as_str()])
        .observe(elapsed.as_secs_f64());

    Ok((elapsed.as_millis() as usize, true))
}
