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

use ::datafusion::{datasource::TableProvider, prelude::SessionContext};
use arrow_schema::DataType;
use config::{
    cluster::LOCAL_NODE,
    datafusion::request::FlightSearchRequest,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::ScanStats,
        sql::TableReferenceExt,
        stream::{FileKey, StreamSettings, StreamType},
    },
};
use hashbrown::HashMap;
use infra::{
    errors::Error,
    schema::{
        get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields, get_stream_setting_index_updated_at_for_fields,
        unwrap_stream_created_at, unwrap_stream_settings,
    },
};
use itertools::Itertools;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::sampling::execution::apply_sampling_to_files;
use rayon::slice::ParallelSliceMut;

use super::{index::IndexPlan, plan::StreamSource};
use crate::{
    grpc::{QueryParams, storage, wal},
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    match_file,
    tantivy::aggregate::{IndexAggregate, prepare_aggregate},
};

/// Stream settings narrowed to the fields that exist in the query schema.
pub(super) struct StreamSearchSettings {
    pub(super) settings: Option<StreamSettings>,
    pub(super) created_at: Option<i64>,
    pub(super) fts_fields: Vec<String>,
    pub(super) index_fields: Vec<String>,
    pub(super) bloom_fields: Vec<String>,
    pub(super) partition_keys: Vec<(String, String)>,
}

impl StreamSearchSettings {
    pub(super) async fn load(req: &FlightSearchRequest, source: &StreamSource) -> Self {
        let schema_fields: HashMap<_, _> = source
            .schema
            .fields()
            .iter()
            .map(|field| (field.name(), field))
            .collect();
        let db_schema = infra::schema::get(
            &req.query_identifier.org_id,
            &source.stream.stream_name(),
            source.stream_type,
        )
        .await
        .unwrap_or_else(|_| arrow_schema::Schema::empty());
        let settings = unwrap_stream_settings(&db_schema);
        let fts_fields = get_stream_setting_fts_fields(&settings)
            .into_iter()
            .filter(|v| {
                schema_fields
                    .get(v)
                    .map(|f| {
                        [DataType::Utf8, DataType::Utf8View, DataType::LargeUtf8]
                            .contains(f.data_type())
                    })
                    .unwrap_or_default()
            })
            .collect_vec();
        let index_fields = get_stream_setting_index_fields(&settings)
            .into_iter()
            .filter(|v| schema_fields.contains_key(v))
            .collect_vec();
        let bloom_fields = get_stream_setting_bloom_filter_fields(&settings)
            .into_iter()
            .filter(|v| schema_fields.contains_key(v))
            .collect_vec();
        let partition_keys = req
            .index_info
            .equal_keys
            .iter()
            .filter(|v| schema_fields.contains_key(&v.key))
            .map(|v| (v.key.to_string(), v.value.to_string()))
            .collect();
        Self {
            created_at: unwrap_stream_created_at(&db_schema),
            settings,
            fts_fields,
            index_fields,
            bloom_fields,
            partition_keys,
        }
    }

    // the index cutoff only depends on the fields the query actually reads from the index
    // and we don't check the FTS fields here on purpose
    pub(super) async fn index_updated_at(&self, mode: &IndexOptimizeMode) -> i64 {
        let distinct_fields_updated_at =
            infra::db::tantivy_index::get_ttv_distinct_fields_updated_at().await;
        let index_updated_at = get_stream_setting_index_updated_at_for_fields(
            &self.settings,
            self.created_at,
            &mode.referenced_fields(),
            distinct_fields_updated_at,
        );
        let ttv_timestamp_updated_at =
            infra::db::tantivy_index::get_ttv_timestamp_updated_at().await;
        let index_updated_at = index_updated_at.max(ttv_timestamp_updated_at);

        if matches!(
            mode,
            IndexOptimizeMode::SimpleTopN(..) | IndexOptimizeMode::SimpleMultiHistogram(..)
        ) {
            let ttv_secondary_index_updated_at =
                infra::db::tantivy_index::get_ttv_secondary_index_updated_at().await;
            return index_updated_at.max(ttv_secondary_index_updated_at);
        }

        index_updated_at
    }
}

/// Where each object-storage file of this partition is read from.
#[derive(Default)]
pub(super) struct RoutedFiles {
    pub(super) metadata_count_files: Vec<FileKey>,
    pub(super) index_aggregate: Option<IndexAggregate>,
    /// Parquet or vortex files left for the storage scan; `None` when the request has no file ids.
    pub(super) scan_files: Option<Vec<FileKey>>,
}

pub(super) async fn route_files(
    query: &Arc<QueryParams>,
    req: &FlightSearchRequest,
    settings: &StreamSearchSettings,
    index: &IndexPlan,
    scan_stats: &mut ScanStats,
) -> Result<RoutedFiles, Error> {
    if req.search_info.file_id_list.is_empty() {
        return Ok(RoutedFiles::default());
    }
    let trace_id = query.trace_id.as_str();
    let (mut scan_files, file_list_took) = get_file_list_by_ids(
        trace_id,
        &query.org_id,
        query.stream_type,
        &query.stream_name,
        Some(query.time_range),
        &settings.partition_keys,
        &req.search_info.file_id_list,
    )
    .await?;
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] flight->search in: part_id: {}, get file_list by ids, files: {}, took: {file_list_took} ms",
                req.query_identifier.partition,
                scan_files.len()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search get file_list by ids".to_string())
                .search_role("follower".to_string())
                .duration(file_list_took)
                .build()
        )
    );

    let mut metadata_count_files = Vec::new();
    if index.use_metadata_count() {
        (metadata_count_files, scan_files) =
            split_metadata_count_files(scan_files, query.time_range);
        if !metadata_count_files.is_empty() {
            log::info!(
                "[trace_id {trace_id}] flight->search: metadata count files: {}, remaining storage files: {}",
                metadata_count_files.len(),
                scan_files.len()
            );
        }
    }

    let mut index_aggregate = None;
    if let Some(mode) = index.aggregate_mode() {
        let start = std::time::Instant::now();
        let index_updated_at = settings.index_updated_at(mode).await;
        // TODO: support IndexOptimizeMode::SimpleDistinct for add timestamp
        // filter to tantivy search
        let distinct_range =
            matches!(mode, IndexOptimizeMode::SimpleDistinct(..)).then_some(query.time_range);
        let index_files;
        (index_files, scan_files) =
            split_file_list_by_time_range(scan_files, index_updated_at, distinct_range);
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search: handle tantivy optimize, tantivy files: {}, datafusion files: {}",
                    index_files.len(),
                    scan_files.len()
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search handle tantivy optimize".to_string())
                    .search_role("follower".to_string())
                    .duration(start.elapsed().as_millis() as usize)
                    .build()
            )
        );
        if !index_files.is_empty() {
            let start = std::time::Instant::now();
            let prepared = prepare_aggregate(
                query.clone(),
                index_files,
                index.condition.clone(),
                mode.clone(),
            )
            .await;
            log::info!(
                "[trace_id {trace_id}] flight->search: index aggregate, answered files: {}, fallback files: {}, took: {} ms",
                prepared
                    .answered
                    .as_ref()
                    .map_or(0, |answered| answered.files.len()),
                prepared.fallback_files.len(),
                start.elapsed().as_millis(),
            );
            scan_files.extend(prepared.fallback_files);
            index_aggregate = prepared.answered;
            scan_stats.idx_took += prepared.took as i64;
        }
    }

    // Apply sampling if configured (enterprise feature)
    #[cfg(feature = "enterprise")]
    if let Some(sampling_config) = &req.search_info.sampling_config {
        apply_sampling_to_files(
            &mut scan_files,
            sampling_config,
            Some(query.time_range),
            req.search_info.histogram_interval,
            trace_id,
        );
    }

    Ok(RoutedFiles {
        metadata_count_files,
        index_aggregate,
        scan_files: Some(scan_files),
    })
}

pub(super) async fn search_tables(
    query: &Arc<QueryParams>,
    ctx: &SessionContext,
    source: &StreamSource,
    settings: &StreamSearchSettings,
    index: &IndexPlan,
    scan_files: Option<Vec<FileKey>>,
    scan_stats: &mut ScanStats,
) -> Result<Vec<Arc<dyn TableProvider>>, Error> {
    let trace_id = query.trace_id.as_str();
    let file_stats_cache = ctx.runtime_env().cache_manager.get_file_statistic_cache();
    let mut tables = Vec::new();

    if let Some(files) = scan_files {
        let start = std::time::Instant::now();
        let (tbls, stats, _) = storage::search(
            query.clone(),
            source.schema.clone(),
            &files,
            source.sort_order,
            file_stats_cache.clone(),
            index.condition.clone(),
            settings.fts_fields.clone(),
            settings.bloom_fields.clone(),
            index.scan_mode(),
        )
        .await
        .inspect_err(|e| {
            log::error!("[trace_id {trace_id}] flight->search: search storage parquet error: {e}")
        })?;
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search: storage search completed, {} files",
                    files.len()
                ),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search storage search".to_string())
                    .search_role("follower".to_string())
                    .duration(start.elapsed().as_millis() as usize)
                    .build()
            )
        );
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    if !LOCAL_NODE.is_ingester() {
        return Ok(tables);
    }

    // search in WAL memory first to capture the snapshot_time
    let (tbls, stats, memtable_ids) = wal::search_memtable(
        query.clone(),
        source.schema.clone(),
        &settings.partition_keys,
        source.sort_order,
        index.condition.clone(),
        settings.fts_fields.clone(),
    )
    .await
    .inspect_err(|e| {
        log::error!("[trace_id {trace_id}] flight->search: search wal memtable error: {e:?}")
    })?;
    tables.extend(tbls);
    scan_stats.add(&stats);

    // Now search in WAL parquet with snapshot_time filter
    let (tbls, stats, _) = wal::search_parquet(
        query.clone(),
        source.schema.clone(),
        &settings.partition_keys,
        source.sort_order,
        file_stats_cache,
        index.condition.clone(),
        settings.fts_fields.clone(),
        memtable_ids,
    )
    .await
    .inspect_err(|e| {
        log::error!("[trace_id {trace_id}] flight->search: search wal parquet error: {e}")
    })?;
    tables.extend(tbls);
    scan_stats.add(&stats);

    Ok(tables)
}

pub(super) fn collect_stats(files: &[FileKey]) -> ScanStats {
    let mut scan_stats = ScanStats::new();
    scan_stats.files = files.len() as i64;
    for file in files.iter() {
        scan_stats.records += file.meta.records;
        scan_stats.original_size += file.meta.original_size;
        scan_stats.compressed_size += file.meta.compressed_size;
        scan_stats.idx_scan_size += file.meta.index_size;
    }
    scan_stats
}

#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip_all, fields(org_id = org_id, stream_name = stream_name))]
async fn get_file_list_by_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    equal_items: &[(String, String)],
    ids: &[i64],
) -> Result<(Vec<FileKey>, usize), Error> {
    let start = std::time::Instant::now();
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    let partition_keys = &stream_settings.partition_keys;
    let file_list =
        crate::file_list::query_by_ids(trace_id, org_id, stream_type, stream_name, time_range, ids)
            .await?;

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if match_file(
            org_id,
            stream_type,
            stream_name,
            time_range,
            &file,
            partition_keys,
            equal_items,
        )
        .await
        {
            files.push(file);
        }
    }
    files.par_sort_unstable_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    Ok((files, start.elapsed().as_millis() as usize))
}

fn split_metadata_count_files(
    file_list: Vec<FileKey>,
    time_range: (i64, i64),
) -> (Vec<FileKey>, Vec<FileKey>) {
    file_list
        .into_iter()
        .partition(|file| file.meta.min_ts >= time_range.0 && file.meta.max_ts < time_range.1)
}

fn split_file_list_by_time_range(
    file_list: Vec<FileKey>,
    index_updated_at: i64,
    time_range: Option<(i64, i64)>,
) -> (Vec<FileKey>, Vec<FileKey>) {
    file_list.into_iter().partition(|file| {
        file.meta.min_ts >= index_updated_at
            && file.meta.index_size > 0
            && time_range
                .is_none_or(|(start, end)| file.meta.min_ts >= start && file.meta.max_ts <= end)
    })
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn make_file(min_ts: i64, max_ts: i64, index_size: i64) -> FileKey {
        FileKey {
            meta: FileMeta {
                min_ts,
                max_ts,
                index_size,
                records: 10,
                original_size: 100,
                compressed_size: 50,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn test_split_file_list_empty() {
        let (tantivy, datafusion) = split_file_list_by_time_range(vec![], 0, None);
        assert!(tantivy.is_empty());
        assert!(datafusion.is_empty());
    }

    #[test]
    fn test_split_file_list_all_tantivy() {
        let files = vec![make_file(100, 200, 512), make_file(300, 400, 1024)];
        let (tantivy, datafusion) = split_file_list_by_time_range(files, 0, None);
        assert_eq!(tantivy.len(), 2);
        assert!(datafusion.is_empty());
    }

    #[test]
    fn test_split_file_list_no_index_goes_to_datafusion() {
        let files = vec![make_file(100, 200, 0)]; // index_size == 0
        let (tantivy, datafusion) = split_file_list_by_time_range(files, 0, None);
        assert!(tantivy.is_empty());
        assert_eq!(datafusion.len(), 1);
    }

    #[test]
    fn test_split_file_list_before_index_updated_at() {
        let files = vec![make_file(100, 200, 512)];
        let (tantivy, datafusion) = split_file_list_by_time_range(files, 500, None);
        assert!(tantivy.is_empty());
        assert_eq!(datafusion.len(), 1);
    }

    #[test]
    fn test_split_file_list_for_metadata_count_only_full_range_files() {
        let files = vec![
            make_file(100, 199, 0), // fully in [100, 200)
            make_file(99, 150, 0),  // overlaps the start boundary
            make_file(150, 200, 0), // touches the exclusive end boundary
        ];

        let (metadata, scan) = split_metadata_count_files(files, (100, 200));

        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0].meta.min_ts, 100);
        assert_eq!(metadata[0].meta.max_ts, 199);
        assert_eq!(scan.len(), 2);
    }

    #[test]
    fn test_collect_stats_empty() {
        let stats = collect_stats(&[]);
        assert_eq!(stats.files, 0);
        assert_eq!(stats.records, 0);
        assert_eq!(stats.original_size, 0);
        assert_eq!(stats.compressed_size, 0);
        assert_eq!(stats.idx_scan_size, 0);
    }

    #[test]
    fn test_collect_stats_aggregates() {
        let files = vec![make_file(0, 100, 10), make_file(100, 200, 20)];
        let stats = collect_stats(&files);
        assert_eq!(stats.files, 2);
        assert_eq!(stats.records, 20); // 10 + 10
        assert_eq!(stats.original_size, 200); // 100 + 100
        assert_eq!(stats.compressed_size, 100); // 50 + 50
        assert_eq!(stats.idx_scan_size, 30); // 10 + 20
    }
}
