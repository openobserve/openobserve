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

pub mod cache;
mod partition;
pub mod search;

use std::{collections::HashSet, ops::Bound, sync::Arc};

use arrow::{
    buffer::{BooleanBuffer, MutableBuffer},
    util::bit_util,
};
use config::{
    INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::ScanStats,
        stream::{FileKey, FileSelection, StreamType},
    },
    metrics::{self, QUERY_PARQUET_CACHE_RATIO_NODE},
    tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
    utils::{inverted_index::to_tantivy_name, size::bytes_to_human_readable},
};
use futures::{StreamExt, stream};
use hashbrown::HashMap;
use infra::{cache::file_data, errors::Error};
use itertools::Itertools;
pub use search::{TantivyMultiResult, TantivyMultiResultBuilder, TantivyResult};
use tantivy::{
    Directory, ReloadPolicy, Term,
    query::{BooleanQuery, Occur, Query, RangeQuery},
    schema::Field,
};
use tantivy_utils::puffin_directory::{
    PROP_ROW_GROUP_SIZE,
    caching_directory::CachingDirectory,
    footer_cache::FooterCache,
    reader::{PuffinDirReader, warm_up_terms},
};
use tokio::sync::Semaphore;
use tokio_stream::StreamExt as _;

use self::{
    cache::{self as tantivy_result_cache, CacheEntry},
    partition::partition_tantivy_files,
};
use crate::service::search::{
    grpc::{QueryParams, calc_target_partitions, storage::cache_files},
    index::IndexCondition,
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};

/// Filter file list using tantivy index
#[tracing::instrument(name = "service:search:grpc:storage:tantivy_search", skip_all)]
pub async fn tantivy_search(
    query: Arc<QueryParams>,
    file_list: &mut Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    idx_optimize_mode: Option<IndexOptimizeMode>,
) -> Result<(usize, bool, TantivyMultiResult), Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let trace_id = &query.trace_id;

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
                to_tantivy_name(&f.key).map(|ttv_file| (ttv_file, f.clone()))
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
                "[trace_id {trace_id}] search->tantivy: stream {}/{}/{}, load tantivy index files {}, index size: {}, memory cached {}, disk cached {}, cached ratio {}%,{download_msg} took: {} ms",
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
                .trace_id(query.trace_id.to_string())
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

    let target_partitions =
        calc_target_partitions(cfg.limit.cpu_num, cfg.limit.query_thread_num, cached_ratio);

    log::info!(
        "[trace_id {trace_id}] search->tantivy: session target_partitions: {target_partitions}",
    );

    let search_start = std::time::Instant::now();
    let mut is_add_filter_back = file_list_map.len() != index_file_names.len();
    if is_add_filter_back {
        log::info!(
            "[trace_id {trace_id}] search->tantivy: {} of {} files have no tantivy index, the filter will be added back to datafusion for them",
            file_list_map.len() - index_file_names.len(),
            file_list_map.len(),
        );
    }
    let time_range = query.time_range;
    let index_parquet_files = index_file_names.into_iter().map(|(_, f)| f).collect_vec();
    let (index_parquet_files, query_limit) =
        partition_tantivy_files(index_parquet_files, &idx_optimize_mode, target_partitions);

    let mut no_more_files = false;
    let mut tantivy_result_builder = TantivyMultiResultBuilder::new(&idx_optimize_mode);
    let group_num = index_parquet_files.first().unwrap_or(&vec![]).len();
    let max_group_len = index_parquet_files.len();

    log::info!(
        "[trace_id {trace_id}] search->tantivy: target_partitions: {target_partitions}, group_num: {group_num}, max_group_len: {max_group_len}",
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
        let semaphore = Arc::new(Semaphore::new(target_partitions));
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
                    "[trace_id {trace_id}] search->tantivy: error filtering via index, error: {e:?}, took: {took} ms",
                );
                // search error, need add filter back
                return Ok((took, true, TantivyMultiResult::RowNums(0)));
            }
            Ok(result) => result,
        } {
            // Each result corresponds to a file in the file list
            match result {
                Ok((file_name, result, has_skipped_conditions)) => {
                    // when has_skipped_conditions is true, we should add filter back to datafusion,
                    // because the index result is not accurate
                    if has_skipped_conditions {
                        is_add_filter_back = true;
                    }
                    if file_name.is_empty() {
                        // no need inverted index for this file, need add filter back
                        let took = start.elapsed().as_millis() as usize;
                        threshold_num -= 1;
                        total_row_ids_percent += result.percent();
                        if threshold_num == 0 {
                            log::warn!(
                                "[trace_id {trace_id}] search->tantivy: skip tantivy search, too many row_ids returned from tantivy index, avg percent: {}, took: {took} ms",
                                total_row_ids_percent as f64 / cfg.limit.cpu_num as f64,
                            );
                            file_list.extend(file_list_map.into_values());
                            return Ok((took, true, TantivyMultiResult::RowNums(0)));
                        }
                        is_add_filter_back = true;
                        continue;
                    }
                    match result {
                        TantivyResult::RowIdsSelection {
                            row_ids,
                            row_group_size,
                        } => {
                            let matched = row_ids.count_set_bits() as u64;
                            tantivy_result_builder.add_row_nums(matched);
                            let file = file_list_map.get_mut(&file_name).unwrap();
                            file.with_selection(FileSelection::Rows(row_ids), row_group_size);
                        }
                        TantivyResult::NoMatch => {
                            file_list_map.remove(&file_name);
                        }
                        TantivyResult::Count(count) => {
                            tantivy_result_builder.add_row_nums(count as u64);
                            file_list_map.remove(&file_name); // maybe we do not need to remove it?
                        }
                        TantivyResult::Histogram(histogram) => {
                            tantivy_result_builder.add_histogram(histogram);
                            file_list_map.remove(&file_name);
                        }
                        TantivyResult::MultiHistogram(multi_histogram) => {
                            tantivy_result_builder.add_multi_histogram(multi_histogram);
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
                        TantivyResult::Skipped { .. } => {
                            // skipped results always come with an empty file
                            // name and are handled before this match
                            unreachable!("Skipped should not be returned with a file name");
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[trace_id {trace_id}] search->tantivy: error filtering via index. Keep file to search, error: {e}"
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
                "[trace_id {trace_id}] search->tantivy: total hits for index_condition: {index_condition:?} found {tantivy_result}, is_add_filter_back: {is_add_filter_back}, file_num: {}, took: {} ms",
                file_list_map.len(),
                search_start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(query.trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("tantivy search".to_string())
                .search_role("follower".to_string())
                .duration(search_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "found {tantivy_result}, is_add_filter_back: {is_add_filter_back}, file_num: {}",
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
    file_account: &str,
    file_name: &str,
    file_size: i64,
) -> anyhow::Result<PuffinDirReader> {
    let file_account = file_account.to_string();
    let source = object_store::ObjectMeta {
        location: file_name.into(),
        last_modified: *config::utils::time::BASE_TIME,
        size: file_size as u64,
        e_tag: None,
        version: None,
    };
    Ok(PuffinDirReader::from_path(file_account, source).await?)
}

/// Returns (file_key, result, has_skipped_conditions).
/// when has_skipped_conditions is true, we should all filter back to datafusion.
async fn search_tantivy_index(
    trace_id: &str,
    time_range: (i64, i64),
    index_condition: Option<IndexCondition>,
    idx_optimize_rule: Option<IndexOptimizeMode>,
    parquet_file: &FileKey,
) -> anyhow::Result<(String, TantivyResult, bool)> {
    let file_account = parquet_file.account.clone();
    let Some(ttv_file_name) = to_tantivy_name(&parquet_file.key) else {
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
            return Ok((parquet_file.key.to_string(), result, false));
        }
    }

    // open the tantivy index
    log::debug!("[trace_id {trace_id}] init cache for tantivy file: {ttv_file_name}");

    let puffin_dir = Arc::new(
        get_tantivy_directory(&file_account, &ttv_file_name, parquet_file.meta.index_size).await?,
    );
    // Read the row group size that the writer used when this tantivy index was
    // built. Old .ttv files predate this property — None falls back to the
    // legacy assumption in the access-plan code.
    let row_group_size = puffin_dir
        .get_property(PROP_ROW_GROUP_SIZE)
        .and_then(|s| s.parse::<u32>().ok());
    let footer_cache = FooterCache::from_directory(puffin_dir.clone(), &ttv_file_name).await?;
    let cache_dir = CachingDirectory::new_with_cacher(puffin_dir, Arc::new(footer_cache));
    let reader_directory: Box<dyn Directory> = Box::new(cache_dir);

    let index = tantivy::Index::open(reader_directory)?;
    index
        .tokenizers()
        .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Search));
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .num_warming_threads(0)
        .try_into()?;
    let tantivy_index = Arc::new(index);
    let tantivy_reader = Arc::new(reader);

    let searcher = tantivy_reader.searcher();
    let tantivy_schema = tantivy_index.schema();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();

    // check if the index has multiple segments
    if tantivy_index.searchable_segment_metas()?.len() > 1 {
        return Err(anyhow::anyhow!(
            "one tantivy file should only have one segment"
        ));
    }

    // generate the tantivy query
    let condition: IndexCondition =
        index_condition.ok_or(anyhow::anyhow!("IndexCondition not found"))?;
    let (mut query, has_skipped_conditions) =
        condition.to_tantivy_query(trace_id, tantivy_schema.clone(), fts_field)?;

    // when the file is not fully within the time range, add a timestamp filter
    let (start_time, end_time) = time_range;
    let file_in_range =
        parquet_file.meta.min_ts >= start_time && parquet_file.meta.max_ts < end_time;
    if !file_in_range && let Ok(ts_field) = tantivy_schema.get_field(TIMESTAMP_COL_NAME) {
        let ts_range = RangeQuery::new(
            Bound::Included(Term::from_field_i64(ts_field, start_time)),
            Bound::Excluded(Term::from_field_i64(ts_field, end_time)),
        );
        query = Box::new(BooleanQuery::new(vec![
            (Occur::Must, query),
            (Occur::Must, Box::new(ts_range)),
        ]));
    }

    let need_all_term_fields = condition
        .need_all_term_fields()
        .into_iter()
        .chain(get_simple_distinct_field(&idx_optimize_rule))
        .filter_map(|filed| tantivy_schema.get_field(&filed).ok())
        .collect::<HashSet<_>>();

    // warm up the terms in the query
    let mut warm_terms: HashMap<Field, HashMap<Term, bool>> = HashMap::new();
    query.query_terms(&mut |term, need_position| {
        let field = term.field();
        let entry = warm_terms.entry(field).or_default();
        entry.insert(term.clone(), need_position);
    });

    let mut need_fast_field = HashSet::new();
    if let Some(rule) = &idx_optimize_rule {
        match rule {
            IndexOptimizeMode::SimpleHistogram(..) => {
                need_fast_field.insert(TIMESTAMP_COL_NAME.to_string());
            }
            IndexOptimizeMode::SimpleMultiHistogram(.., name) => {
                need_fast_field.insert(TIMESTAMP_COL_NAME.to_string());
                need_fast_field.insert(name.clone());
            }
            IndexOptimizeMode::SimpleTopN(fields, ..) => {
                for field in fields {
                    need_fast_field.insert(field.clone());
                }
            }
            _ => {}
        }
    }
    if !file_in_range {
        need_fast_field.insert(TIMESTAMP_COL_NAME.to_string());
    }

    warm_up_terms(
        &searcher,
        &warm_terms,
        need_all_term_fields,
        need_fast_field,
    )
    .await?;

    // search the index
    let file_min_ts = parquet_file.meta.min_ts;
    let file_max_ts = parquet_file.meta.max_ts;
    let res = tokio::task::spawn_blocking(move || match idx_optimize_rule.clone() {
        None => TantivyResult::handle_matched_docs(&searcher, query),
        Some(IndexOptimizeMode::SimpleSelect(limit, ascend)) => {
            TantivyResult::handle_simple_select(&searcher, query, limit, ascend)
        }
        Some(IndexOptimizeMode::SimpleCount) => {
            TantivyResult::handle_simple_count(&searcher, query)
        }
        Some(IndexOptimizeMode::SimpleHistogram(..)) => TantivyResult::handle_simple_histogram(
            &searcher,
            query,
            &condition,
            idx_optimize_rule.unwrap(),
            file_in_range,
            file_min_ts,
            file_max_ts,
        ),
        Some(IndexOptimizeMode::SimpleMultiHistogram(
            min_value,
            max_value,
            bucket_width,
            ts_offset,
            breakdown_field,
        )) => TantivyResult::handle_simple_multi_histogram(
            &searcher,
            query,
            min_value,
            max_value,
            bucket_width,
            ts_offset,
            &breakdown_field,
        ),
        Some(IndexOptimizeMode::SimpleTopN(fields, limit, ascend)) => {
            TantivyResult::handle_simple_top_n(&searcher, query, &fields, limit, ascend)
        }
        Some(IndexOptimizeMode::SimpleDistinct(field, limit, ascend)) => {
            TantivyResult::handle_simple_distinct(&searcher, &condition, &field, limit, ascend)
        }
    })
    .await??;

    let key = parquet_file.key.to_string();
    let result = match res {
        TantivyResult::Count(count) => TantivyResult::Count(count),
        TantivyResult::Histogram(histogram) => TantivyResult::Histogram(histogram),
        TantivyResult::MultiHistogram(multi_histogram) => {
            TantivyResult::MultiHistogram(multi_histogram)
        }
        TantivyResult::TopN(top_n) => TantivyResult::TopN(top_n),
        TantivyResult::Distinct(distinct) => TantivyResult::Distinct(distinct),
        TantivyResult::RowIds(row_ids) => {
            match build_row_ids_selection(trace_id, parquet_file, row_ids, row_group_size)? {
                RowIdsOutcome::Return(key, result, has_skipped) => {
                    return Ok((key, result, has_skipped));
                }
                RowIdsOutcome::Selection { result } => result,
            }
        }
        TantivyResult::RowIdsSelection { .. }
        | TantivyResult::NoMatch
        | TantivyResult::Skipped { .. } => {
            unreachable!("unsupported tantivy search result in search_tantivy_index")
        }
    };

    // cache the result if the memory size is less than the limit
    // Do not cache when conditions were skipped — the result is incomplete.
    if cfg.common.inverted_index_result_cache_enabled
        && !cache_key.is_empty()
        && !has_skipped_conditions
        && result.get_memory_size() < cfg.limit.inverted_index_result_cache_max_entry_size
    {
        let entry = get_cache_entry(result.clone());
        tantivy_result_cache::GLOBAL_CACHE.put(cache_key, entry);
    }
    Ok((key, result, has_skipped_conditions))
}

/// Outcome of turning tantivy row-id hits into a parquet access plan.
enum RowIdsOutcome {
    /// Return immediately from `search_tantivy_index`, bypassing the result
    /// cache (either no match, or too many hits so we fall back to datafusion).
    Return(String, TantivyResult, bool),
    /// A row-id selection to cache and return.
    Selection { result: TantivyResult },
}

/// Convert the matched tantivy row ids into a `RowIdsSelection` access plan,
/// or signal an early return when there is no match or too many hits.
fn build_row_ids_selection(
    trace_id: &str,
    parquet_file: &FileKey,
    row_ids: Vec<u32>,
    row_group_size: Option<u32>,
) -> anyhow::Result<RowIdsOutcome> {
    if row_ids.is_empty() || parquet_file.meta.records == 0 {
        return Ok(RowIdsOutcome::Return(
            parquet_file.key.to_string(),
            TantivyResult::NoMatch,
            false,
        ));
    }
    // return early if the number of matched docs is too large
    let skip_threshold = get_config().limit.inverted_index_skip_threshold;
    let row_ids_percent = row_ids.len() as f64 / parquet_file.meta.records as f64 * 100.0;
    if skip_threshold > 0 && row_ids_percent > skip_threshold as f64 {
        // return empty file name means we need to add filter back and skip tantivy search
        log::info!(
            "[trace_id {trace_id}] search->tantivy: file: {}, result percent {row_ids_percent}% is too large, back to datafusion",
            parquet_file.key
        );
        return Ok(RowIdsOutcome::Return(
            "".to_string(),
            TantivyResult::Skipped {
                percent: row_ids_percent as usize,
            },
            true,
        ));
    }
    let max_doc_id = row_ids.iter().copied().max().unwrap() as i64;
    if max_doc_id >= parquet_file.meta.records {
        return Err(anyhow::anyhow!(
            "doc_id {max_doc_id} is out of range, records {}",
            parquet_file.meta.records,
        ));
    }
    let num_rows = parquet_file.meta.records as usize;
    let mut buffer = MutableBuffer::from_len_zeroed(bit_util::ceil(num_rows, 8));
    let slice = buffer.as_slice_mut();
    for &id in &row_ids {
        bit_util::set_bit(slice, id as usize);
    }
    let row_ids = BooleanBuffer::new(buffer.into(), 0, num_rows);
    Ok(RowIdsOutcome::Selection {
        result: TantivyResult::RowIdsSelection {
            row_ids: Arc::new(row_ids),
            row_group_size,
        },
    })
}

/// if simple distinct without filter, we need to warm up the field
fn get_simple_distinct_field(idx_optimize_rule: &Option<IndexOptimizeMode>) -> Vec<String> {
    if let Some(IndexOptimizeMode::SimpleDistinct(field, ..)) = idx_optimize_rule {
        vec![field.to_string()]
    } else {
        vec![]
    }
}

fn get_cache_entry(tantivy_result: TantivyResult) -> CacheEntry {
    match tantivy_result {
        TantivyResult::RowIdsSelection {
            row_ids,
            row_group_size,
        } => {
            // the packed ids are immutable and shared via Arc, so caching is
            // a refcount bump
            CacheEntry::RowIds(row_ids, row_group_size)
        }
        TantivyResult::Count(count) => CacheEntry::Count(count),
        TantivyResult::Histogram(histogram) => CacheEntry::Histogram(histogram),
        TantivyResult::MultiHistogram(multi_histogram) => {
            CacheEntry::MultiHistogram(multi_histogram)
        }
        TantivyResult::TopN(top_n) => CacheEntry::TopN(top_n),
        TantivyResult::Distinct(distinct) => CacheEntry::Distinct(distinct),
        TantivyResult::RowIds(_) | TantivyResult::NoMatch | TantivyResult::Skipped { .. } => {
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
    format!("{condition}_{rule}_{}", parquet_file.key)
}

#[cfg(test)]
mod tests {
    use arrow::buffer::BooleanBuffer;
    use config::{TIMESTAMP_COL_NAME, meta::stream::FileMeta};

    use super::*;
    use crate::service::search::index::{Condition, IndexCondition};

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
    fn test_generate_cache_key_none_condition() {
        let index_condition = None;
        let idx_optimize_rule = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let parquet_file = &create_file_key(1, 10);

        let result = generate_cache_key(&index_condition, &idx_optimize_rule, parquet_file);
        assert_eq!(result, String::new());
    }

    #[test]
    fn test_generate_cache_key_none_rule() {
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
    fn test_get_cache_entry_row_ids_selection() {
        let result = TantivyResult::RowIdsSelection {
            row_ids: Arc::new(BooleanBuffer::from_iter(
                (0..4u32).map(|i| [0u32, 2].contains(&i)),
            )),
            row_group_size: Some(1024),
        };

        let entry = get_cache_entry(result);
        match entry {
            CacheEntry::RowIds(packed, row_group_size) => {
                assert_eq!(packed.count_set_bits(), 2);
                assert_eq!(packed.set_indices().collect::<Vec<_>>(), vec![0, 2]);
                assert_eq!(row_group_size, Some(1024));
            }
            _ => panic!("Expected RowIds cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_count() {
        let result = TantivyResult::Count(42);

        let entry = get_cache_entry(result);
        match entry {
            CacheEntry::Count(count) => {
                assert_eq!(count, 42);
            }
            _ => panic!("Expected Count cache entry"),
        }
    }

    #[test]
    fn test_get_cache_entry_histogram() {
        let histogram_data = vec![1, 2, 3, 4];
        let result = TantivyResult::Histogram(histogram_data.clone());

        let entry = get_cache_entry(result);
        match entry {
            CacheEntry::Histogram(histogram) => {
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

        let entry = get_cache_entry(result);
        match entry {
            CacheEntry::Distinct(distinct) => {
                assert_eq!(distinct, distinct_values);
            }
            _ => panic!("Expected Distinct cache entry"),
        }
    }
}
