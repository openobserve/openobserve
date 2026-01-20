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

use std::{collections::HashSet, sync::Arc};

use anyhow::Context;
use arrow_schema::Schema;
use config::{
    INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, is_local_disk_storage,
    meta::{
        bitvec::BitVec,
        inverted_index::IndexOptimizeMode,
        search::{ScanStats, StorageType},
        stream::{FileKey, StreamType},
    },
    metrics::{self, QUERY_PARQUET_CACHE_RATIO_NODE},
    utils::{
        inverted_index::convert_parquet_file_name_to_tantivy_file,
        size::bytes_to_human_readable,
        tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
        time::BASE_TIME,
    },
};
use datafusion::execution::cache::cache_manager::FileStatisticsCache;
use futures::{StreamExt, stream};
use hashbrown::HashMap;
use infra::{
    cache::file_data,
    errors::{Error, ErrorCodes},
};
use itertools::Itertools;
use roaring::RoaringBitmap;
use tantivy::Directory;
use tokio::sync::Semaphore;
use tokio_stream::StreamExt as _;
use tracing::Instrument;

use crate::service::{
    file_list,
    search::{
        grpc::{
            tantivy_result::{TantivyMultiResult, TantivyMultiResultBuilder, TantivyResult},
            tantivy_result_cache::{self, CacheEntry},
        },
        index::IndexCondition,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    },
    tantivy::puffin_directory::{
        caching_directory::CachingDirectory,
        footer_cache::FooterCache,
        reader::{PuffinDirReader, warm_up_terms},
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
                    "[trace_id {trace_id}] search->storage: stream {org_id}/{stream_type}/{stream_name}, inverted index reduced file_list num to {} in {idx_took} ms",
                    files.len(),
                ),
                SearchInspectorFieldsBuilder::new()
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

    // set target partitions based on cache type
    let target_partitions = if cache_type == file_data::CacheType::None {
        cfg.limit.query_thread_num
    } else {
        cfg.limit.cpu_num
    };

    log::debug!("search->storage: session target_partitions: {target_partitions}");

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
                .node_name(LOCAL_NODE.name.clone())
                .component("storage create tables".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );
    Ok((tables, scan_stats, HashSet::new()))
}

#[tracing::instrument(name = "service:search:grpc:storage:cache_files", skip_all)]
pub async fn cache_files(
    trace_id: &str,
    files: &[(i64, &String, &String, i64, i64)],
    scan_stats: &mut ScanStats,
    file_type: &str,
) -> (file_data::CacheType, u64, u64) {
    // check how many files already cached
    let mut cached_files = HashSet::with_capacity(files.len());
    let (mut cache_hits, mut cache_misses) = (0, 0);

    let start = std::time::Instant::now();
    for (_id, _account, file, _size, max_ts) in files.iter() {
        if file_data::memory::exist(file).await {
            scan_stats.querier_memory_cached_files += 1;
            cached_files.insert(file);
            cache_hits += 1;
        } else if file_data::disk::exist(file).await {
            scan_stats.querier_disk_cached_files += 1;
            cached_files.insert(file);
            cache_hits += 1;
        } else {
            cache_misses += 1;
        };

        // Record file access metrics
        let stream_type = if file_type == "index" {
            config::meta::stream::StreamType::Index
        } else {
            // Determine stream type from the file path
            if file.contains("/logs/") {
                config::meta::stream::StreamType::Logs
            } else if file.contains("/metrics/") {
                config::meta::stream::StreamType::Metrics
            } else if file.contains("/traces/") {
                config::meta::stream::StreamType::Traces
            } else {
                config::meta::stream::StreamType::Logs // Default
            }
        };

        let current_time = chrono::Utc::now().timestamp_micros();
        let file_age_seconds = (current_time - max_ts) / 1_000_000;
        let file_age_hours = file_age_seconds as f64 / 3600.0;

        if file_age_hours > 0.0 {
            config::metrics::FILE_ACCESS_TIME
                .with_label_values(&[&stream_type.to_string()])
                .observe(file_age_hours);
        }
    }

    let check_cache_took = start.elapsed().as_millis() as usize;
    if check_cache_took > 1000 {
        log::warn!(
            "[trace_id {trace_id}] search->storage: check file cache took: {check_cache_took} ms",
        );
    }

    let files_num = files.len() as i64;
    if files_num == scan_stats.querier_memory_cached_files + scan_stats.querier_disk_cached_files {
        // all files are cached
        return (file_data::CacheType::Disk, cache_hits, cache_misses);
    }

    // check cache size
    let cfg = get_config();
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
        // no cache, the files are too big than cache size
        return (file_data::CacheType::None, cache_hits, cache_misses);
    };

    let trace_id = trace_id.to_string();
    let files = files
        .iter()
        .filter_map(|(id, account, file, size, ts)| {
            if cached_files.contains(&file) {
                None
            } else {
                Some((*id, account.to_string(), file.to_string(), *size, *ts))
            }
        })
        .collect_vec();
    let file_type = file_type.to_string();
    tokio::spawn(async move {
        let files_num = files.len();
        for (id, account, file, size, ts) in files {
            if let Err(e) = crate::job::queue_download(
                trace_id.clone(),
                id,
                account,
                file.clone(),
                size,
                ts,
                cache_type,
            )
            .await
            {
                log::error!(
                    "[trace_id {trace_id}] error in queuing file {file} for background download: {e}"
                );
            }
        }
        log::info!(
            "[trace_id {trace_id}] search->storage: successfully enqueued {files_num} files of {file_type} for background download into {cache_type:?}",
        );
    });

    // if cached file less than 50% of the total files, return None
    if scan_stats.querier_memory_cached_files + scan_stats.querier_disk_cached_files < files_num / 2
    {
        (file_data::CacheType::None, cache_hits, cache_misses)
    } else {
        (cache_type, cache_hits, cache_misses)
    }
}

/// Filter file list using inverted index
/// This function will load the index file corresponding to each file in the file list.
/// FSTs in those files are used to match the incoming query in `SearchRequest`.
/// If the query does not match any FST in the index file, the file will be filtered out.
/// If the query does match then the segment IDs for the file will be updated.
/// If the query not find corresponding index file, the file will *not* be filtered out.
#[tracing::instrument(name = "service:search:grpc:storage:tantivy_search", skip_all)]
pub async fn tantivy_search(
    query: Arc<super::QueryParams>,
    file_list: &mut Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    idx_optimize_mode: Option<IndexOptimizeMode>,
) -> Result<(usize, bool, TantivyMultiResult), Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    // Cache the corresponding Index files
    let mut scan_stats = ScanStats::new();
    let mut file_list_map = file_list
        .drain(..)
        .map(|f| (f.key.clone(), f))
        .collect::<HashMap<_, _>>();
    let index_file_names = file_list_map
        .iter()
        .filter_map(|(_, f)| {
            scan_stats.compressed_size += f.meta.index_size;
            if f.meta.index_size > 0 {
                convert_parquet_file_name_to_tantivy_file(&f.key)
                    .map(|ttv_file| (ttv_file, f.clone()))
            } else {
                None
            }
        })
        .collect_vec();
    scan_stats.querier_files = index_file_names.len() as i64;
    let (cache_type, cache_hits, cache_misses) = cache_files(
        &query.trace_id,
        &index_file_names
            .iter()
            .map(|(ttv_file, f)| (f.id, &f.account, ttv_file, f.meta.index_size, f.meta.max_ts))
            .collect_vec(),
        &mut scan_stats,
        "index",
    )
    .await;

    // report cache hit and miss metrics
    metrics::QUERY_DISK_CACHE_HIT_COUNT
        .with_label_values(&[query.org_id.as_str(), query.stream_type.as_str(), "index"])
        .inc_by(cache_hits);
    metrics::QUERY_DISK_CACHE_MISS_COUNT
        .with_label_values(&[query.org_id.as_str(), query.stream_type.as_str(), "index"])
        .inc_by(cache_misses);

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
                "[trace_id {}] search->tantivy: stream {}/{}/{}, load tantivy index files {}, index size: {}, memory cached {}, disk cached {}, cached ratio {}%,{download_msg} took: {} ms",
                query.trace_id,
                query.org_id,
                query.stream_type,
                query.stream_name,
                scan_stats.querier_files,
                bytes_to_human_readable(scan_stats.compressed_size as f64),
                scan_stats.querier_memory_cached_files,
                scan_stats.querier_disk_cached_files,
                (cached_ratio * 100.0) as usize,
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("tantivy load files".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .desc(format!(
                    "load tantivy index files {}, memory cached {}, disk cached {}",
                    scan_stats.querier_files,
                    scan_stats.querier_memory_cached_files,
                    scan_stats.querier_disk_cached_files,
                ))
                .build()
        )
    );

    if scan_stats.querier_files > 0 {
        QUERY_PARQUET_CACHE_RATIO_NODE
            .with_label_values(&[&query.org_id, &StreamType::Index.to_string()])
            .observe(cached_ratio);
    }

    // set target partitions based on cache type
    let target_partitions = if cache_type == file_data::CacheType::None {
        cfg.limit.query_thread_num
    } else {
        cfg.limit.query_index_thread_num
    };

    let search_start = std::time::Instant::now();
    let mut is_add_filter_back = file_list_map.len() != index_file_names.len();
    let time_range = query.time_range;
    let index_parquet_files = index_file_names.into_iter().map(|(_, f)| f).collect_vec();
    let (index_parquet_files, query_limit) =
        partition_tantivy_files(index_parquet_files, &idx_optimize_mode, target_partitions);

    let mut no_more_files = false;
    let mut tantivy_result_builder = TantivyMultiResultBuilder::new(&idx_optimize_mode);
    let group_num = index_parquet_files.first().unwrap_or(&vec![]).len();
    let max_group_len = index_parquet_files.len();

    log::info!(
        "[trace_id {}] search->tantivy: target_partitions: {target_partitions}, group_num: {group_num}, max_group_len: {max_group_len}",
        query.trace_id,
    );

    for file_group in index_parquet_files {
        if no_more_files {
            // delete the rest of the files
            for file in file_group {
                file_list_map.remove(&file.key);
            }
            continue;
        }

        // Spawn a task for each group of files get row_id from index
        let mut tasks = Vec::new();
        let semaphore = std::sync::Arc::new(Semaphore::new(target_partitions));
        for file in file_group {
            let trace_id = query.trace_id.to_string();
            let index_condition_clone = index_condition.clone();
            let idx_optimize_rule_clone = idx_optimize_mode.clone();
            let semaphore_clone = semaphore.clone();
            let task = tokio::task::spawn(async move {
                let permit = semaphore_clone.acquire_owned().await.unwrap();
                let ret = search_tantivy_index(
                    &trace_id,
                    time_range,
                    index_condition_clone,
                    idx_optimize_rule_clone,
                    &file,
                )
                .await;
                drop(permit);
                match ret {
                    Ok(ret) => Ok(ret),
                    Err(e) => {
                        log::error!(
                            "[trace_id {trace_id}] search->tantivy: error filtering via index: {}, index_size: {}, error: {e:?}",
                            file.key,
                            file.meta.index_size,
                        );
                        Err(e)
                    }
                }
            });
            tasks.push(task)
        }

        // if more than cpu_num's file returned many row_ids, we skip tantivy search
        let mut threshold_num = cfg.limit.cpu_num;
        let mut total_row_ids_percent = 0;
        let mut tasks = stream::iter(tasks).buffer_unordered(target_partitions);
        while let Some(result) = match tasks.try_next().await {
            Err(e) => {
                let took = start.elapsed().as_millis() as usize;
                log::error!(
                    "[trace_id {}] search->tantivy: error filtering via index, error: {e:?}, took: {took} ms",
                    query.trace_id,
                );
                // search error, need add filter back
                return Ok((took, true, TantivyMultiResult::RowNums(0)));
            }
            Ok(result) => result,
        } {
            // Each result corresponds to a file in the file list
            match result {
                Ok((file_name, result)) => {
                    if file_name.is_empty() {
                        // no need inverted index for this file, need add filter back
                        let took = start.elapsed().as_millis() as usize;
                        threshold_num -= 1;
                        total_row_ids_percent += result.percent();
                        if threshold_num == 0 {
                            log::warn!(
                                "[trace_id {}] search->tantivy: skip tantivy search, too many row_ids returned from tantivy index, avg percent: {}, took: {took} ms",
                                query.trace_id,
                                total_row_ids_percent as f64 / cfg.limit.cpu_num as f64,
                            );
                            file_list.extend(file_list_map.into_values());
                            return Ok((took, true, TantivyMultiResult::RowNums(0)));
                        }
                        is_add_filter_back = true;
                        continue;
                    }
                    match result {
                        TantivyResult::RowIdsBitVec(num_rows, bitvec) => {
                            if num_rows == 0 {
                                // if the bitmap is empty then we remove the file from the list
                                file_list_map.remove(&file_name);
                            } else {
                                // Replace the segment IDs in the existing `FileKey` with the found
                                tantivy_result_builder.add_row_nums(num_rows as u64);
                                let file = file_list_map.get_mut(&file_name).unwrap();
                                file.with_segment_ids(bitvec);
                            }
                        }
                        TantivyResult::Count(count) => {
                            tantivy_result_builder.add_row_nums(count as u64);
                            file_list_map.remove(&file_name); // maybe we do not need to remove it?
                        }
                        TantivyResult::Histogram(histogram) => {
                            tantivy_result_builder.add_histogram(histogram);
                            file_list_map.remove(&file_name);
                        }
                        TantivyResult::TopN(top_n) => {
                            tantivy_result_builder.add_top_n(top_n);
                            file_list_map.remove(&file_name);
                        }
                        TantivyResult::Distinct(distinct) => {
                            tantivy_result_builder.add_distinct(distinct);
                            file_list_map.remove(&file_name);
                        }
                        TantivyResult::RowIds(_) => {
                            unreachable!("RowIds should not be returned");
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[trace_id {}] search->tantivy: error filtering via index. Keep file to search, error: {e}",
                        query.trace_id,
                    );
                    is_add_filter_back = true;
                    continue;
                }
            }
        }
        // if limit is set and total hits exceed the limit, we stop searching
        if query_limit > 0 && tantivy_result_builder.num_rows() > query_limit {
            no_more_files = true;
        }
    }

    // get the result
    let tantivy_result = tantivy_result_builder.build();

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {}] search->tantivy: total hits for index_condition: {:?} found {}, is_add_filter_back: {}, file_num: {}, took: {} ms",
                query.trace_id,
                index_condition,
                tantivy_result,
                is_add_filter_back,
                file_list_map.len(),
                search_start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("tantivy search".to_string())
                .search_role("follower".to_string())
                .duration(search_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "found {}, is_add_filter_back: {}, file_num: {}",
                    tantivy_result,
                    is_add_filter_back,
                    file_list_map.len(),
                ))
                .build()
        )
    );

    file_list.extend(file_list_map.into_values());
    Ok((
        start.elapsed().as_millis() as usize,
        is_add_filter_back,
        tantivy_result,
    ))
}

pub async fn get_tantivy_directory(
    _trace_id: &str,
    file_account: &str,
    file_name: &str,
    file_size: i64,
) -> anyhow::Result<PuffinDirReader> {
    let file_account = file_account.to_string();
    let source = object_store::ObjectMeta {
        location: file_name.into(),
        last_modified: *BASE_TIME,
        size: file_size as u64,
        e_tag: None,
        version: None,
    };
    Ok(PuffinDirReader::from_path(file_account, source).await?)
}

async fn search_tantivy_index(
    trace_id: &str,
    time_range: (i64, i64),
    index_condition: Option<IndexCondition>,
    idx_optimize_rule: Option<IndexOptimizeMode>,
    parquet_file: &FileKey,
) -> anyhow::Result<(String, TantivyResult)> {
    let file_account = parquet_file.account.clone();
    let Some(ttv_file_name) = convert_parquet_file_name_to_tantivy_file(&parquet_file.key) else {
        return Err(anyhow::anyhow!(
            "[trace_id {trace_id}] search->storage: Unable to find tantivy index files for parquet file {}",
            parquet_file.key.clone()
        ));
    };

    let cfg = get_config();
    let mut cache_key = String::new();
    if cfg.common.inverted_index_result_cache_enabled {
        metrics::TANTIVY_RESULT_CACHE_REQUESTS_TOTAL
            .with_label_values::<&str>(&[])
            .inc();
        cache_key = generate_cache_key(&index_condition, &idx_optimize_rule, parquet_file);
        if let Some(result) = tantivy_result_cache::GLOBAL_CACHE.get(&cache_key) {
            metrics::TANTIVY_RESULT_CACHE_HITS_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
            return Ok((parquet_file.key.to_string(), result));
        }
    }

    // open the tantivy index
    log::debug!("[trace_id {trace_id}] init cache for tantivy file: {ttv_file_name}");

    let puffin_dir = Arc::new(
        get_tantivy_directory(
            trace_id,
            &file_account,
            &ttv_file_name,
            parquet_file.meta.index_size,
        )
        .await?,
    );
    let footer_cache = FooterCache::from_directory(puffin_dir.clone()).await?;
    let cache_dir = CachingDirectory::new_with_cacher(puffin_dir, Arc::new(footer_cache));
    let reader_directory: Box<dyn Directory> = Box::new(cache_dir);

    let index = tantivy::Index::open(reader_directory)?;
    index
        .tokenizers()
        .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Search));
    let reader = index
        .reader_builder()
        .reload_policy(tantivy::ReloadPolicy::Manual)
        .num_warming_threads(0)
        .try_into()?;
    let tantivy_index = Arc::new(index);
    let tantivy_reader = Arc::new(reader);

    let searcher = tantivy_reader.searcher();
    let tantivy_schema = tantivy_index.schema();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();

    // check if the index has multiple segments
    let seg_metas = tantivy_index
        .searchable_segment_metas()
        .context("Count segments")?;
    if seg_metas.len() > 1 {
        return Err(anyhow::anyhow!(
            "Multiple segments in tantivy index not supported"
        ));
    }

    // generate the tantivy query
    let condition: IndexCondition =
        index_condition.ok_or(anyhow::anyhow!("IndexCondition not found"))?;
    let query = condition.to_tantivy_query(tantivy_schema.clone(), fts_field)?;
    let need_all_term_fields = condition
        .need_all_term_fields()
        .into_iter()
        .chain(get_simple_distinct_field(&idx_optimize_rule).into_iter())
        .filter_map(|filed| tantivy_schema.get_field(&filed).ok())
        .collect::<HashSet<_>>();

    // warm up the terms in the query
    let mut warm_terms: HashMap<tantivy::schema::Field, HashMap<tantivy::Term, bool>> =
        HashMap::new();
    query.query_terms(&mut |term, need_position| {
        let field = term.field();
        let entry = warm_terms.entry(field).or_default();
        entry.insert(term.clone(), need_position);
    });

    let need_fast_field = idx_optimize_rule.as_ref().and_then(|rule| match rule {
        IndexOptimizeMode::SimpleHistogram(..) => Some(TIMESTAMP_COL_NAME.to_string()),
        IndexOptimizeMode::SimpleTopN(field, ..) => Some(field.to_string()),
        _ => None,
    });
    warm_up_terms(
        &searcher,
        &warm_terms,
        need_all_term_fields,
        need_fast_field,
    )
    .await?;

    // search the index
    let file_in_range =
        parquet_file.meta.min_ts >= time_range.0 && parquet_file.meta.max_ts < time_range.1;
    let res = tokio::task::spawn_blocking(move || match (file_in_range, idx_optimize_rule) {
        (false, _) | (true, None) => TantivyResult::handle_matched_docs(&searcher, query),
        (true, Some(IndexOptimizeMode::SimpleSelect(limit, ascend))) => {
            TantivyResult::handle_simple_select(&searcher, query, limit, ascend)
        }
        (true, Some(IndexOptimizeMode::SimpleCount)) => {
            TantivyResult::handle_simple_count(&searcher, query)
        }
        (true, Some(IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets))) => {
            // fail the function if field not in tantivy schema
            if tantivy_schema.get_field(TIMESTAMP_COL_NAME).is_err() {
                log::warn!("_timestamp not index in tantivy file: {ttv_file_name}");
                return Ok(TantivyResult::Histogram(vec![]));
            }
            TantivyResult::handle_simple_histogram(
                &searcher,
                query,
                min_value,
                bucket_width,
                num_buckets,
            )
        }
        (true, Some(IndexOptimizeMode::SimpleTopN(field, limit, ascend))) => {
            TantivyResult::handle_simple_top_n(&searcher, query, &field, limit, ascend)
        }
        (true, Some(IndexOptimizeMode::SimpleDistinct(field, limit, ascend))) => {
            if tantivy_schema.get_field(&field).is_err() {
                log::warn!("search->tantivy: {field} not index in tantivy file: {ttv_file_name}");
                Ok(TantivyResult::Distinct(HashSet::new()))
            } else {
                TantivyResult::handle_simple_distinct(&searcher, &condition, &field, limit, ascend)
            }
        }
    })
    .await??;

    let key = parquet_file.key.to_string();
    let mut percent = 0.0;
    let result = match res {
        TantivyResult::Count(count) => TantivyResult::Count(count),
        TantivyResult::Histogram(histogram) => TantivyResult::Histogram(histogram),
        TantivyResult::TopN(top_n) => TantivyResult::TopN(top_n),
        TantivyResult::Distinct(distinct) => TantivyResult::Distinct(distinct),
        TantivyResult::RowIds(row_ids) => {
            if row_ids.is_empty() || parquet_file.meta.records == 0 {
                return Ok((key, TantivyResult::RowIdsBitVec(0, BitVec::EMPTY)));
            }
            // return early if the number of matched docs is too large
            let skip_threshold = cfg.limit.inverted_index_skip_threshold;
            let row_ids_percent = row_ids.len() as f64 / parquet_file.meta.records as f64 * 100.0;
            if skip_threshold > 0 && row_ids_percent > skip_threshold as f64 {
                // return empty file name means we need to add filter back and skip tantivy search
                log::info!(
                    "search->tantivy: file: {}, result percent {row_ids_percent}% is too large, back to datafusion",
                    parquet_file.key
                );
                return Ok((
                    "".to_string(),
                    TantivyResult::RowIdsBitVec(row_ids_percent as usize, BitVec::EMPTY),
                ));
            }
            percent = row_ids_percent;
            let max_doc_id = *row_ids.iter().max().unwrap_or(&0) as i64;
            if max_doc_id >= parquet_file.meta.records {
                return Err(anyhow::anyhow!(
                    "doc_id {} is out of range, records {}",
                    max_doc_id,
                    parquet_file.meta.records,
                ));
            }
            // NOTE: the BitVec's length should equal to the number of records in the parquet file
            let mut res = BitVec::repeat(false, parquet_file.meta.records as usize);
            let num_rows = row_ids.len();
            for id in row_ids {
                res.set(id as usize, true);
            }
            TantivyResult::RowIdsBitVec(num_rows, res)
        }
        TantivyResult::RowIdsBitVec(..) => {
            unreachable!("unsupported tantivy search result in search_tantivy_index")
        }
    };

    // cache the result if the memory size is less than the limit
    if cfg.common.inverted_index_result_cache_enabled
        && !cache_key.is_empty()
        && (result.get_memory_size() < cfg.limit.inverted_index_result_cache_max_entry_size
            || percent < 1.0)
    {
        let entry = get_cache_entry(result.clone(), percent, parquet_file.meta.records as usize);
        tantivy_result_cache::GLOBAL_CACHE.put(cache_key, entry);
    }
    Ok((key, result))
}

/// if simple distinct without filter, we need to warm up the field
fn get_simple_distinct_field(idx_optimize_rule: &Option<IndexOptimizeMode>) -> Vec<String> {
    if let Some(IndexOptimizeMode::SimpleDistinct(field, ..)) = idx_optimize_rule {
        vec![field.to_string()]
    } else {
        vec![]
    }
}

// partition the tantivy files by time range
// the return file groups should execte one by one
fn partition_tantivy_files(
    index_parquet_files: Vec<FileKey>,
    idx_optimize_mode: &Option<IndexOptimizeMode>,
    target_partitions: usize,
) -> (Vec<Vec<FileKey>>, usize) {
    let (file_groups, limit) = if let Some(IndexOptimizeMode::SimpleSelect(limit, _ascend)) =
        idx_optimize_mode
        && *limit > 0
    {
        let file_groups = group_files_by_time_range(index_parquet_files, target_partitions);
        (file_groups, *limit)
    } else {
        // splite the filter groups by target partitions
        let file_groups = into_chunks(index_parquet_files, target_partitions);
        (file_groups, 0)
    };

    if limit == 0 {
        (file_groups, limit)
    } else {
        (regroup_tantivy_files(file_groups), limit)
    }
}

// regroup the tantivy for better performance
// after [`partition_tantivy_files`] we get multiple groups that order by time range desc and each
// group's time range not overlap, when execute the tantivy search, we get the last file in each
// group and do the tantivy search.
// so in this function, we recursive collect the last file in each group
fn regroup_tantivy_files(file_groups: Vec<Vec<FileKey>>) -> Vec<Vec<FileKey>> {
    let group_num = file_groups.len();
    let max_group_len = file_groups.iter().map(|g| g.len()).max().unwrap_or(0);
    let mut new_file_groups: Vec<Vec<FileKey>> = vec![Vec::new(); max_group_len];

    let mut file_groups: Vec<_> = file_groups
        .into_iter()
        .map(|mut group| {
            group.reverse();
            group.into_iter()
        })
        .collect();

    for new_group in new_file_groups.iter_mut().take(max_group_len) {
        for file_group in file_groups.iter_mut().take(group_num) {
            if let Some(file) = file_group.next() {
                new_group.push(file)
            }
        }
    }

    new_file_groups
}

fn into_chunks<T>(mut v: Vec<T>, chunk_size: usize) -> Vec<Vec<T>> {
    let mut chunks = Vec::new();
    while !v.is_empty() {
        let take = if v.len() >= chunk_size {
            chunk_size
        } else {
            v.len()
        };
        let chunk: Vec<T> = v.drain(..take).collect();
        chunks.push(chunk);
    }
    chunks
}

// Group files by time range
// use the min_ts & max_ts of the file.meta to group files and each group can't contains crossing
// time range files
fn group_files_by_time_range(mut files: Vec<FileKey>, partition_num: usize) -> Vec<Vec<FileKey>> {
    let expect_group_elements = files.len().div_ceil(partition_num);
    // sort files by max_ts in ascending order
    files.sort_unstable_by(|a, b| a.meta.max_ts.cmp(&b.meta.max_ts));
    // group by time range
    let mut file_groups_indices: Vec<Vec<FileKey>> = vec![];
    for file in files {
        let file_group_to_insert = file_groups_indices.iter_mut().find(|group| {
            file.meta.min_ts
                > group
                    .last()
                    .expect("groups should be nonempty at construction")
                    .meta
                    .max_ts
        });
        match file_group_to_insert {
            Some(group) => group.push(file),
            None => file_groups_indices.push(vec![file]),
        }
    }
    // regroup if the number of groups is less than expect partitions
    if file_groups_indices
        .first()
        .is_some_and(|g| g.len() <= expect_group_elements)
    {
        file_groups_indices
    } else {
        repartition_sorted_groups(file_groups_indices, expect_group_elements)
    }
}

// repartition the groups to the number of partitions
fn repartition_sorted_groups(
    mut groups: Vec<Vec<FileKey>>,
    expect_group_elements: usize,
) -> Vec<Vec<FileKey>> {
    if groups.is_empty() {
        return groups;
    }

    loop {
        if groups[0].len() <= expect_group_elements {
            break;
        }
        let max_group = groups.remove(0);
        let chunk_num = max_group.len().div_ceil(expect_group_elements);
        let mut new_groups = vec![vec![]; chunk_num];
        for (k, item) in max_group.into_iter().enumerate() {
            new_groups[k % chunk_num].push(item);
        }
        groups.extend(new_groups);
    }

    groups
}

fn get_cache_entry(tantivy_result: TantivyResult, percent: f64, parquet_rows: usize) -> CacheEntry {
    match tantivy_result {
        TantivyResult::RowIdsBitVec(num_rows, bitvec) => {
            // if the percent is less than 1.0, we use roaring bitmap to store the row ids
            // otherwise, we use bitvec to store the row ids.
            // because the bitvec is not efficient for small percent, and the roaring bitmap is not
            // efficient for large percent.
            if percent < 1.0 {
                let mut roaring = RoaringBitmap::new();
                for (i, bit) in bitvec.into_iter().enumerate() {
                    if bit {
                        roaring.insert(i as u32);
                    }
                }
                CacheEntry::RowIdsRoaring(num_rows, roaring, parquet_rows)
            } else {
                CacheEntry::RowIdsBitVec(num_rows, bitvec)
            }
        }
        TantivyResult::Count(count) => CacheEntry::Count(count),
        TantivyResult::Histogram(histogram) => CacheEntry::Histogram(histogram),
        TantivyResult::TopN(top_n) => CacheEntry::TopN(top_n),
        TantivyResult::Distinct(distinct) => CacheEntry::Distinct(distinct),
        TantivyResult::RowIds(_) => {
            unreachable!("unsupported tantivy search result in search_tantivy_index")
        }
    }
}

fn generate_cache_key(
    index_condition: &Option<IndexCondition>,
    idx_optimize_rule: &Option<IndexOptimizeMode>,
    parquet_file: &FileKey,
) -> String {
    let condition = match index_condition {
        Some(condition) => condition.to_query(),
        None => return String::new(),
    };
    let rule = match idx_optimize_rule {
        Some(rule) => rule.to_rule_string(),
        None => return String::new(),
    };
    format!("{}_{}_{}", condition, rule, parquet_file.key)
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;
    use crate::service::search::{
        grpc::tantivy_result::TantivyResult,
        index::{Condition, IndexCondition},
    };

    fn create_file_key(min_ts: i64, max_ts: i64) -> FileKey {
        FileKey {
            key: format!("file_{min_ts}_{max_ts}"),
            meta: FileMeta {
                min_ts,
                max_ts,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn test_group_files_by_time_range() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
        ];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);
        assert!(groups.len() >= 3);
    }

    #[test]
    fn test_group_files_by_time_range_with_overlap() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(5, 15),
            create_file_key(11, 20),
            create_file_key(18, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
        ];
        let partition_num = 2;
        let groups = group_files_by_time_range(files, partition_num);
        assert!(groups.len() >= 2);
    }

    #[test]
    fn test_group_files_by_time_range_with_less_partitions() {
        let files = vec![create_file_key(1, 10), create_file_key(11, 20)];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);
        assert!(groups.len() >= 2);
    }

    #[test]
    fn test_repartition_sorted_groups() {
        let groups = vec![
            vec![create_file_key(1, 10), create_file_key(11, 20)],
            vec![create_file_key(21, 30), create_file_key(31, 40)],
        ];
        let expect_group_elements = 1;
        let repartitioned_groups = repartition_sorted_groups(groups, expect_group_elements);
        assert!(repartitioned_groups.len() >= 4);
    }

    #[test]
    fn test_repartition_sorted_groups_with_large_group() {
        let groups = vec![vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
        ]];
        let expect_group_elements = 2;
        let repartitioned_groups = repartition_sorted_groups(groups, expect_group_elements);
        assert!(repartitioned_groups.len() >= 3);
    }

    #[test]
    fn test_histogram_i64() {
        const MARGIN_IN_BYTES: usize = 1_000_000;
        const MEMORY_BUDGET_NUM_BYTES_MIN: usize = ((MARGIN_IN_BYTES as u32) * 15u32) as usize;

        let mut schema_builder = tantivy::schema::SchemaBuilder::new();
        let val_field = schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
        let schema = schema_builder.build();
        let index = tantivy::index::Index::create_in_ram(schema);
        let mut writer = index
            .writer_with_num_threads(1, MEMORY_BUDGET_NUM_BYTES_MIN)
            .unwrap();
        writer
            .add_document(tantivy::doc!(val_field=>12i64))
            .unwrap();
        writer
            .add_document(tantivy::doc!(val_field=>-30i64))
            .unwrap();
        writer
            .add_document(tantivy::doc!(val_field=>-12i64))
            .unwrap();
        writer
            .add_document(tantivy::doc!(val_field=>-10i64))
            .unwrap();
        writer.commit().unwrap();
        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        let all_query = tantivy::query::AllQuery;
        let histogram_collector = tantivy::collector::HistogramCollector::new(
            TIMESTAMP_COL_NAME.to_string(),
            -20i64,
            10u64,
            4,
        );
        let histogram = searcher.search(&all_query, &histogram_collector).unwrap();
        assert_eq!(histogram, vec![1, 1, 0, 1]);
    }

    #[test]
    fn test_regroup_tantivy_files_basic() {
        let file_groups = vec![
            vec![create_file_key(1, 10), create_file_key(11, 20)],
            vec![create_file_key(21, 30), create_file_key(31, 40)],
        ];
        let result = regroup_tantivy_files(file_groups);

        // Should have 2 groups (max length of input groups)
        assert_eq!(result.len(), 2);

        // First group should contain the last file from each input group
        assert_eq!(result[0].len(), 2);
        assert_eq!(result[0][0].key, "file_11_20"); // Last file from first group
        assert_eq!(result[0][1].key, "file_31_40"); // Last file from second group

        // Second group should contain the first file from each input group
        assert_eq!(result[1].len(), 2);
        assert_eq!(result[1][0].key, "file_1_10"); // First file from first group
        assert_eq!(result[1][1].key, "file_21_30"); // First file from second group
    }

    #[test]
    fn test_regroup_tantivy_files_uneven_groups() {
        let file_groups = vec![
            vec![
                create_file_key(1, 10),
                create_file_key(11, 20),
                create_file_key(21, 30),
            ],
            vec![create_file_key(31, 40)],
        ];
        let result = regroup_tantivy_files(file_groups);

        // Should have 3 groups (max length of input groups)
        assert_eq!(result.len(), 3);

        // First group should contain the last file from each input group
        assert_eq!(result[0].len(), 2);
        assert_eq!(result[0][0].key, "file_21_30"); // Last file from first group
        assert_eq!(result[0][1].key, "file_31_40"); // Last file from second group

        // Second group should contain the middle file from first group, none from second
        assert_eq!(result[1].len(), 1);
        assert_eq!(result[1][0].key, "file_11_20"); // Middle file from first group

        // Third group should contain the first file from first group, none from second
        assert_eq!(result[2].len(), 1);
        assert_eq!(result[2][0].key, "file_1_10"); // First file from first group
    }

    #[test]
    fn test_regroup_tantivy_files_empty_groups() {
        let file_groups: Vec<Vec<FileKey>> = vec![];
        let result = regroup_tantivy_files(file_groups);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_regroup_tantivy_files_single_group() {
        let file_groups = vec![vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
        ]];
        let result = regroup_tantivy_files(file_groups);

        // Should have 3 groups (length of the single input group)
        assert_eq!(result.len(), 3);

        // Each group should contain one file
        assert_eq!(result[0].len(), 1);
        assert_eq!(result[0][0].key, "file_21_30"); // Last file

        assert_eq!(result[1].len(), 1);
        assert_eq!(result[1][0].key, "file_11_20"); // Middle file

        assert_eq!(result[2].len(), 1);
        assert_eq!(result[2][0].key, "file_1_10"); // First file
    }

    #[test]
    fn test_into_chunks_basic() {
        let v = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let chunks = into_chunks(v, 3);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], vec![1, 2, 3]);
        assert_eq!(chunks[1], vec![4, 5, 6]);
        assert_eq!(chunks[2], vec![7, 8]);
    }

    #[test]
    fn test_get_simple_distinct_field_none() {
        let idx_optimize_rule = None;
        let result = get_simple_distinct_field(&idx_optimize_rule);
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_get_simple_distinct_field_simple_distinct() {
        let idx_optimize_rule = Some(
            config::meta::inverted_index::IndexOptimizeMode::SimpleDistinct(
                "test_field".to_string(),
                100,
                false,
            ),
        );
        let result = get_simple_distinct_field(&idx_optimize_rule);
        assert_eq!(result, vec!["test_field".to_string()]);
    }

    #[test]
    fn test_get_simple_distinct_field_other_mode() {
        let idx_optimize_rule = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let result = get_simple_distinct_field(&idx_optimize_rule);
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_partition_tantivy_files_simple_select_with_limit() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
        ];
        let idx_optimize_mode =
            Some(config::meta::inverted_index::IndexOptimizeMode::SimpleSelect(100, false));
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 100);
        assert!(!file_groups.is_empty());
    }

    #[test]
    fn test_partition_tantivy_files_simple_select_no_limit() {
        let files = vec![create_file_key(1, 10), create_file_key(11, 20)];
        let idx_optimize_mode =
            Some(config::meta::inverted_index::IndexOptimizeMode::SimpleSelect(0, false));
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 0);
        assert_eq!(file_groups.len(), 1);
    }

    #[test]
    fn test_partition_tantivy_files_other_mode() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
        ];
        let idx_optimize_mode = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 0);
        assert!(file_groups.len() <= 2);
    }

    #[test]
    fn test_generate_cache_key_none_condition() {
        let index_condition = None;
        let idx_optimize_rule = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let parquet_file = &create_file_key(1, 10);

        let result = generate_cache_key(&index_condition, &idx_optimize_rule, parquet_file);
        assert_eq!(result, String::new());
    }

    #[test]
    fn test_generate_cache_key_none_rule() {
        use crate::service::search::index::{Condition, IndexCondition};

        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        let idx_optimize_rule = None;
        let parquet_file = &create_file_key(1, 10);

        let result = generate_cache_key(&Some(index_condition), &idx_optimize_rule, parquet_file);
        assert_eq!(result, String::new());
    }

    #[test]
    fn test_generate_cache_key_valid() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        let idx_optimize_rule = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let parquet_file = &create_file_key(1, 10);

        let result = generate_cache_key(&Some(index_condition), &idx_optimize_rule, parquet_file);
        assert!(!result.is_empty());
        assert!(result.contains("file_1_10"));
    }

    #[test]
    fn test_get_cache_entry_row_ids_bitvec_small_percent() {
        let mut bitvec = BitVec::repeat(false, 4);
        bitvec.set(0, true);
        bitvec.set(2, true);
        let result = TantivyResult::RowIdsBitVec(2, bitvec);
        let percent = 0.5; // Less than 1.0, should use roaring bitmap
        let parquet_rows = 4;

        let entry = get_cache_entry(result, percent, parquet_rows);
        match entry {
            tantivy_result_cache::CacheEntry::RowIdsRoaring(num_rows, roaring, rows) => {
                assert_eq!(num_rows, 2);
                assert_eq!(rows, 4);
                assert_eq!(roaring.len(), 2); // Should contain positions 0 and 2
                assert!(roaring.contains(0));
                assert!(roaring.contains(2));
            }
            _ => panic!("Expected RowIdsRoaring cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_row_ids_bitvec_large_percent() {
        let mut bitvec = BitVec::repeat(false, 4);
        bitvec.set(0, true);
        bitvec.set(1, true);
        bitvec.set(3, true);
        let result = TantivyResult::RowIdsBitVec(3, bitvec);
        let percent = 2.0; // Greater than 1.0, should use bitvec
        let parquet_rows = 4;

        let entry = get_cache_entry(result, percent, parquet_rows);
        match entry {
            tantivy_result_cache::CacheEntry::RowIdsBitVec(num_rows, returned_bitvec) => {
                assert_eq!(num_rows, 3);
                assert_eq!(returned_bitvec.len(), 4);
                assert_eq!(returned_bitvec.get(0).unwrap(), true);
                assert_eq!(returned_bitvec.get(1).unwrap(), true);
                assert_eq!(returned_bitvec.get(2).unwrap(), false);
                assert_eq!(returned_bitvec.get(3).unwrap(), true);
            }
            _ => panic!("Expected RowIdsBitVec cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_count() {
        let result = TantivyResult::Count(42);
        let percent = 1.0;
        let parquet_rows = 100;

        let entry = get_cache_entry(result, percent, parquet_rows);
        match entry {
            tantivy_result_cache::CacheEntry::Count(count) => {
                assert_eq!(count, 42);
            }
            _ => panic!("Expected Count cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_histogram() {
        let histogram_data = vec![1, 2, 3, 4];
        let result = TantivyResult::Histogram(histogram_data.clone());
        let percent = 1.0;
        let parquet_rows = 100;

        let entry = get_cache_entry(result, percent, parquet_rows);
        match entry {
            tantivy_result_cache::CacheEntry::Histogram(histogram) => {
                assert_eq!(histogram, histogram_data);
            }
            _ => panic!("Expected Histogram cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_distinct() {
        let mut distinct_values = HashSet::new();
        distinct_values.insert("value1".to_string());
        distinct_values.insert("value2".to_string());
        let result = TantivyResult::Distinct(distinct_values.clone());
        let percent = 1.0;
        let parquet_rows = 100;

        let entry = get_cache_entry(result, percent, parquet_rows);
        match entry {
            tantivy_result_cache::CacheEntry::Distinct(distinct) => {
                assert_eq!(distinct, distinct_values);
            }
            _ => panic!("Expected Distinct cache entry"),
        }
    }

    #[test]
    fn test_into_chunks_exact_divisible() {
        let v = vec![1, 2, 3, 4, 5, 6];
        let chunks = into_chunks(v, 2);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], vec![1, 2]);
        assert_eq!(chunks[1], vec![3, 4]);
        assert_eq!(chunks[2], vec![5, 6]);
    }

    #[test]
    fn test_into_chunks_empty_vector() {
        let v: Vec<i32> = vec![];
        let chunks = into_chunks(v, 3);

        assert_eq!(chunks.len(), 0);
    }

    #[test]
    fn test_into_chunks_chunk_size_larger_than_vector() {
        let v = vec![1, 2];
        let chunks = into_chunks(v, 5);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], vec![1, 2]);
    }

    #[test]
    fn test_repartition_sorted_groups_empty() {
        let groups: Vec<Vec<FileKey>> = vec![];
        let result = repartition_sorted_groups(groups, 2);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_repartition_sorted_groups_no_split_needed() {
        let groups = vec![vec![create_file_key(1, 10)], vec![create_file_key(11, 20)]];
        let expect_group_elements = 2;
        let result = repartition_sorted_groups(groups.clone(), expect_group_elements);

        // Should remain unchanged since groups are already small enough
        assert_eq!(result, groups);
    }

    #[test]
    fn test_group_files_by_time_range_single_file() {
        let files = vec![create_file_key(1, 10)];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 1);
        assert_eq!(groups[0][0].key, "file_1_10");
    }

    #[test]
    fn test_group_files_by_time_range_no_overlap_many_partitions() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
        ];
        let partition_num = 10; // More partitions than files
        let groups = group_files_by_time_range(files, partition_num);

        // Should create separate groups for non-overlapping files
        assert_eq!(groups.len(), 3);
        for group in &groups {
            assert_eq!(group.len(), 1); // Each file should be in its own group
        }
    }

    #[test]
    fn test_regroup_tantivy_files_many_single_element_groups() {
        let file_groups = vec![
            vec![create_file_key(1, 10)],
            vec![create_file_key(11, 20)],
            vec![create_file_key(21, 30)],
        ];
        let result = regroup_tantivy_files(file_groups);

        assert_eq!(result.len(), 1); // Max group length is 1
        assert_eq!(result[0].len(), 3); // Should contain all files
        assert_eq!(result[0][0].key, "file_1_10");
        assert_eq!(result[0][1].key, "file_11_20");
        assert_eq!(result[0][2].key, "file_21_30");
    }
}
