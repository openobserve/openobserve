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

use std::{collections::HashSet, path::Path, sync::Arc};

use arrow::array::{ArrayRef, new_null_array};
use arrow_schema::{DataType, Field};
use chrono::DateTime;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::{ScanStats, StorageType},
        stream::{FileKey, PartitionTimeLevel, StreamParams, StreamPartition},
    },
    utils::{
        async_file::{create_wal_dir_datetime_filter, scan_files_filtered},
        file::is_exists,
        parquet::{parse_time_range_from_filename, read_metadata_from_file},
        record_batch_ext::concat_batches,
        size::bytes_to_human_readable,
        time::{DAY_MICRO_SECS, HOUR_MICRO_SECS},
    },
};
use datafusion::{
    arrow::{datatypes::Schema, record_batch::RecordBatch},
    execution::cache::cache_manager::FileStatisticsCache,
};
use futures::StreamExt;
use hashbrown::HashMap;
use infra::{
    errors::{Error, ErrorCodes},
    schema::unwrap_partition_time_level,
};
use ingester::{WAL_PARQUET_METADATA, get_memtable_id_from_file_name};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{
    common::infra::wal,
    service::{
        file_list,
        search::{
            datafusion::table_provider::memtable::NewMemTable,
            generate_filter_from_equal_items, generate_search_schema_diff,
            index::IndexCondition,
            inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
            match_source,
        },
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:parquet", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
#[allow(clippy::too_many_arguments)]
pub async fn search_parquet(
    query: Arc<super::QueryParams>,
    schema: Arc<Schema>,
    search_partition_keys: &[(String, String)],
    sorted_by_time: bool,
    file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    memtable_ids: HashSet<u64>,
) -> super::SearchTable {
    let load_start = std::time::Instant::now();
    let trace_id = &query.trace_id;
    // get file list
    let stream_settings =
        infra::schema::get_settings(&query.org_id, &query.stream_name, query.stream_type)
            .await
            .unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, query.stream_type);
    let files = get_file_list(
        query.clone(),
        &stream_settings.partition_keys,
        Some(query.time_range),
        search_partition_keys,
        partition_time_level,
        memtable_ids,
    )
    .await?;
    log::info!(
        "[trace_id {trace_id}] wal->parquet->search: get file list files: {}, took {} ms",
        files.len(),
        load_start.elapsed().as_millis()
    );
    if files.is_empty() {
        return Ok((vec![], ScanStats::new(), HashSet::new()));
    }

    let mut lock_files = files.iter().map(|f| f.key.clone()).collect::<Vec<_>>();
    let cfg = get_config();
    // get file metadata to build file_list
    let files_num = files.len();
    let mut new_files = Vec::with_capacity(files_num);
    let files_metadata = futures::stream::iter(files)
        .map(|mut file| async move {
            let cfg = get_config();
            let r = WAL_PARQUET_METADATA.read().await;
            let source_file = cfg.common.data_wal_dir.to_string() + file.key.as_str();
            if let Some(meta) = r.get(file.key.as_str()) {
                file.meta = meta.clone();
                // reset file meta if it already removed
                if !is_exists(&source_file) {
                    file.meta = Default::default();
                }
                return file;
            }
            drop(r);
            let meta = read_metadata_from_file(&source_file.into())
                .await
                .unwrap_or_default();
            file.meta = meta;
            file
        })
        .buffer_unordered(cfg.limit.cpu_num)
        .collect::<Vec<FileKey>>()
        .await;
    for file in files_metadata {
        if file.meta.is_empty() {
            wal::release_files(std::slice::from_ref(&file.key));
            lock_files.retain(|f| f != &file.key);
            continue;
        }
        let (min_ts, max_ts) = query.time_range;
        if file.meta.min_ts > max_ts || file.meta.max_ts < min_ts {
            log::debug!(
                "[trace_id {trace_id}] skip wal parquet file: {} time_range: [{},{})",
                &file.key,
                file.meta.min_ts,
                file.meta.max_ts
            );
            wal::release_files(std::slice::from_ref(&file.key));
            lock_files.retain(|f| f != &file.key);
            continue;
        }
        new_files.push(file);
    }
    let files = new_files;

    let mut scan_stats = ScanStats::new();
    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        // release all files
        wal::release_files(&lock_files);
        return Ok((vec![], scan_stats, HashSet::new()));
    }

    let scan_stats = match file_list::calculate_files_size(&files).await {
        Ok(size) => size,
        Err(err) => {
            // release all files
            wal::release_files(&lock_files);
            log::error!("[trace_id {trace_id}] calculate files size error: {err}",);
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                "calculate files size error".to_string(),
            )));
        }
    };

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] wal->parquet->search: load files {}, scan_size {}, compressed_size {}",
                files.len(),
                scan_stats.original_size,
                scan_stats.compressed_size
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("wal:parquet load".to_string())
                .search_role("follower".to_string())
                .duration(load_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "wal parquet search load files {}, scan_size {}, compressed_size {}",
                    files.len(),
                    bytes_to_human_readable(scan_stats.original_size as f64),
                    bytes_to_human_readable(scan_stats.compressed_size as f64)
                ))
                .build()
        )
    );

    // check memory circuit breaker
    if let Err(e) = ingester::check_memory_circuit_breaker() {
        // release all files
        wal::release_files(&lock_files);
        return Err(Error::ResourceError(e.to_string()));
    }

    let session = config::meta::search::Session {
        id: format!("{trace_id}-wal"),
        storage_type: StorageType::Wal,
        work_group: query.work_group.clone(),
        target_partitions: cfg.limit.cpu_num,
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
        || {
            wal::release_files(&lock_files);
        },
    )
    .await?;

    // lock these files for this request
    wal::lock_request(&query.trace_id, &lock_files);

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] wal->parquet->search: create tables took {} ms",
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("wal:parquet create tables".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );

    Ok((tables, scan_stats, HashSet::new()))
}

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:memtable", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
pub async fn search_memtable(
    query: Arc<super::QueryParams>,
    schema: Arc<Schema>,
    search_partition_keys: &[(String, String)],
    sorted_by_time: bool,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
) -> super::SearchTable {
    let load_start = std::time::Instant::now();
    let mut scan_stats = ScanStats::new();

    // format partition keys
    let stream_settings =
        infra::schema::get_settings(&query.org_id, &query.stream_name, query.stream_type)
            .await
            .unwrap_or_default();
    let partition_keys = &stream_settings.partition_keys;
    let mut filters = generate_filter_from_equal_items(search_partition_keys);
    let partition_keys: HashMap<&String, &StreamPartition> =
        partition_keys.iter().map(|v| (&v.field, v)).collect();
    for (key, value) in filters.iter_mut() {
        if let Some(partition_key) = partition_keys.get(key) {
            for val in value.iter_mut() {
                *val = partition_key.get_partition_value(val);
            }
        }
    }

    let start = std::time::Instant::now();
    let (mut memtable_ids, mut batches) = ingester::read_from_memtable(
        &query.org_id,
        query.stream_type.as_str(),
        &query.stream_name,
        Some(query.time_range),
        &filters,
    )
    .await
    .unwrap_or_default();
    let memtable_time = start.elapsed().as_millis();
    let start = std::time::Instant::now();
    let (im_ids, im_batches) = ingester::read_from_immutable(
        &query.trace_id,
        &query.org_id,
        query.stream_type.as_str(),
        &query.stream_name,
        Some(query.time_range),
        &filters,
        &memtable_ids,
    )
    .await
    .unwrap_or_default();
    let immutable_time = start.elapsed().as_millis();
    memtable_ids.extend(im_ids);
    batches.extend(im_batches);

    log::info!(
        "[trace_id {}] wal->mem->search: read from metable took {memtable_time} ms, immutable took {immutable_time} ms",
        query.trace_id,
    );

    scan_stats.files = batches.iter().map(|(_, k)| k.len()).sum::<usize>() as i64;
    if scan_stats.files == 0 {
        return Ok((vec![], ScanStats::new(), HashSet::new()));
    }

    let mut batch_groups: HashMap<Arc<Schema>, Vec<RecordBatch>> = HashMap::with_capacity(2);
    for (schema, batch) in batches {
        let entry = batch_groups.entry(schema).or_default();
        for r in batch.iter() {
            scan_stats.records += r.data.num_rows() as i64;
            scan_stats.original_size += r.data_json_size as i64;
            scan_stats.compressed_size += r.data_arrow_size as i64;
        }
        entry.extend(batch.into_iter().map(|r| r.data.clone()));
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {}] wal->mem->search: load groups {}, files {}, scan_size {}, compressed_size {}",
                query.trace_id,
                batch_groups.len(),
                scan_stats.files,
                scan_stats.original_size,
                scan_stats.compressed_size,
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("wal:memtable load".to_string())
                .search_role("follower".to_string())
                .duration(load_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "wal mem search load groups {}, files {}, scan_size {}, compressed_size {}",
                    batch_groups.len(),
                    scan_stats.files,
                    bytes_to_human_readable(scan_stats.original_size as f64),
                    bytes_to_human_readable(scan_stats.compressed_size as f64)
                ))
                .build()
        )
    );

    // check memory circuit breaker
    ingester::check_memory_circuit_breaker().map_err(|e| Error::ResourceError(e.to_string()))?;

    // construct latest schema map
    let latest_schema = Arc::new(schema.as_ref().clone().with_metadata(Default::default()));
    let mut latest_schema_map = HashMap::with_capacity(latest_schema.fields().len());
    for field in latest_schema.fields() {
        latest_schema_map.insert(field.name(), field);
    }

    let mut tables = Vec::new();
    let start = std::time::Instant::now();
    let latest_schema_fields = latest_schema.fields().len();
    for (i, (schema, record_batches)) in batch_groups.into_iter().enumerate() {
        if record_batches.is_empty() {
            continue;
        }

        let adapt_start = std::time::Instant::now();
        let batch_num = record_batches.len();
        let batch_fields = schema.fields().len();

        // if the field in latest_schema_map, but not in schema, and it is utf8view, we need to add
        // as utf8 and add utf8view to diff_fields, because it will cause different dataType between
        // batches
        let mut diff_fields = generate_search_schema_diff(&schema, &latest_schema_map);
        let (adapt_batches, new_diff_fields) = record_batches
            .into_par_iter()
            .map(|batch| adapt_batch(latest_schema.clone(), batch))
            .collect::<(Vec<RecordBatch>, Vec<HashMap<String, DataType>>)>();
        let record_batches = adapt_batches;
        for diff_field in new_diff_fields {
            if !diff_field.is_empty() {
                diff_fields.extend(diff_field);
            }
        }

        log::info!(
            "[trace_id {}] wal->mem->search: adapt batches for group {i}, schema fields {latest_schema_fields}, batch fields: {batch_fields}, diff_fields {}, batches {batch_num}, took {} ms",
            query.trace_id,
            diff_fields.len(),
            adapt_start.elapsed().as_millis()
        );

        tokio::task::coop::consume_budget().await;

        // merge small batches into big batches
        let merge_start = std::time::Instant::now();
        let batch_num = record_batches.len();
        let mut merge_groupes = Vec::new();
        let mut current_group = Vec::new();
        let group_limit = config::PARQUET_BATCH_SIZE;
        let mut group_size = 0;
        for batch in record_batches {
            if group_size > 0 && group_size + batch.num_rows() > group_limit {
                merge_groupes.push(current_group);
                current_group = Vec::new();
                group_size = 0;
            }
            group_size += batch.num_rows();
            current_group.push(batch);
        }
        if !current_group.is_empty() {
            merge_groupes.push(current_group);
        }
        let record_batches = merge_groupes
            .into_par_iter()
            .map(|mut group| {
                if group.len() == 1 {
                    group.remove(0)
                } else {
                    concat_batches(group[0].schema().clone(), group).unwrap()
                }
            })
            .collect::<Vec<_>>();

        log::info!(
            "[trace_id {}] wal->mem->search: merge batches for group {i}, batches {batch_num}, took {} ms",
            query.trace_id,
            merge_start.elapsed().as_millis()
        );

        tokio::task::coop::consume_budget().await;

        let table = match NewMemTable::try_new(
            record_batches[0].schema().clone(),
            vec![record_batches],
            diff_fields,
            sorted_by_time,
            index_condition.clone(),
            fst_fields.clone(),
            query.time_range,
        ) {
            Ok(table) => Arc::new(table),
            Err(e) => {
                log::error!(
                    "[trace_id {}] wal->mem->search: create memtable error: {e}",
                    query.trace_id,
                );
                return Err(e.into());
            }
        };
        tables.push(table as _);
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {}] wal->mem->search: create tables took {} ms",
                query.trace_id,
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("wal:memtable create tables".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );
    Ok((tables, scan_stats, memtable_ids))
}

#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
async fn get_file_list(
    query: Arc<super::QueryParams>,
    partition_keys: &[StreamPartition],
    time_range: Option<(i64, i64)>,
    search_partition_keys: &[(String, String)],
    partition_time_level: PartitionTimeLevel,
    memtable_ids: HashSet<u64>,
) -> Result<Vec<FileKey>, Error> {
    let wal_dir = match Path::new(&get_config().common.data_wal_dir).canonicalize() {
        Ok(path) => {
            let mut path = path.to_str().unwrap().to_string();
            // Hack for windows
            if let Some(stripped) = path.strip_prefix("\\\\?\\") {
                path = stripped.to_string().replace('\\', "/");
            }
            path
        }
        Err(_) => {
            return Ok(vec![]);
        }
    };

    // get all files
    let pattern = format!(
        "{}/files/{}/{}/{}/",
        wal_dir, query.org_id, query.stream_type, query.stream_name
    );
    let files = {
        let (start_ts, end_ts) = query.time_range;

        // normalize timestamps to partition boundaries
        let normalized = if partition_time_level == PartitionTimeLevel::Daily {
            (
                start_ts - start_ts % DAY_MICRO_SECS,
                end_ts - end_ts % DAY_MICRO_SECS,
            )
        } else {
            (
                start_ts - start_ts % HOUR_MICRO_SECS,
                end_ts - end_ts % HOUR_MICRO_SECS,
            )
        };

        if let Some((start_time, end_time)) = DateTime::from_timestamp_micros(normalized.0)
            .zip(DateTime::from_timestamp_micros(normalized.1))
        {
            let skip_count = AsRef::<Path>::as_ref(&pattern).components().count();
            // Skip count is the number of segments in the cannonicalised path before
            // <YY>/<MM>/<DD>/<HH>/<file> appear
            let filter = create_wal_dir_datetime_filter(
                start_time,
                end_time,
                "parquet".to_string(),
                skip_count + 1,
            );

            scan_files_filtered(&pattern, filter, None).await?
        } else {
            scan_files_filtered(&pattern, |_| true, None).await?
        }
    };

    let files = files
        .iter()
        .filter_map(|f| {
            let memtable_id = get_memtable_id_from_file_name(f);

            // filter out parquet file that already in memtable, because it will be duplicated
            if memtable_id > 0 && memtable_ids.contains(&memtable_id) {
                log::debug!(
                    "[trace_id {}] skip wal parquet file: {f} because memtable id: {memtable_id} already in memtable",
                    query.trace_id,
                );
                return None;
            }

            Some(
                f.strip_prefix(&wal_dir)
                    .unwrap()
                    .to_string()
                    .replace('\\', "/")
                    .trim_start_matches('/')
                    .to_string(),
            )
        })
        .collect::<Vec<_>>();

    if files.is_empty() {
        return Ok(vec![]);
    }

    // filter by pending delete
    let mut files = crate::service::db::file_list::local::filter_by_pending_delete(files).await;
    if files.is_empty() {
        return Ok(vec![]);
    }

    let files_num = files.len();
    files.sort_unstable();
    files.dedup();
    if files_num != files.len() {
        log::warn!(
            "[trace_id {}] wal->parquet->search: found duplicate files from {files_num} to {}",
            query.trace_id,
            files.len()
        );
    }

    // lock theses files
    wal::lock_files(&files);

    let stream_params = Arc::new(StreamParams::new(
        &query.org_id,
        &query.stream_name,
        query.stream_type,
    ));
    let mut filters = generate_filter_from_equal_items(search_partition_keys);
    let partition_keys: HashMap<&String, &StreamPartition> =
        partition_keys.iter().map(|v| (&v.field, v)).collect();
    for (key, value) in filters.iter_mut() {
        if let Some(partition_key) = partition_keys.get(key) {
            for val in value.iter_mut() {
                *val = partition_key.get_partition_value(val);
            }
        }
    }

    let mut result = Vec::with_capacity(files.len());
    let (min_ts, max_ts) = query.time_range;
    for file in files.iter() {
        let file_key = FileKey::from_file_name(file);
        if (min_ts, max_ts) != (0, 0) {
            let (file_min_ts, file_max_ts) = parse_time_range_from_filename(file);
            if (file_min_ts > 0 && file_max_ts > 0)
                && ((max_ts > 0 && file_min_ts > max_ts) || (min_ts > 0 && file_max_ts < min_ts))
            {
                log::debug!(
                    "[trace_id {}] skip wal parquet file: {file} time_range: [{file_min_ts},{file_max_ts}]",
                    query.trace_id,
                );
                wal::release_files(std::slice::from_ref(file));
                continue;
            }
        }

        if match_source(stream_params.clone(), time_range, &filters, &file_key).await {
            result.push(file_key);
        } else {
            wal::release_files(std::slice::from_ref(file));
        }
    }
    Ok(result)
}

fn adapt_batch(
    latest_schema: Arc<Schema>,
    batch: RecordBatch,
) -> (RecordBatch, HashMap<String, DataType>) {
    let mut diff_fields = HashMap::with_capacity(1);
    let batch_schema = batch.schema();
    let batch_fields = batch_schema
        .fields()
        .iter()
        .enumerate()
        .map(|(idx, f)| (f.name(), idx))
        .collect::<HashMap<_, _>>();
    let batch_cols = batch.columns();

    let mut cols: Vec<ArrayRef> = Vec::with_capacity(latest_schema.fields().len());
    let mut fields = Vec::with_capacity(latest_schema.fields().len());
    for field_latest in latest_schema.fields() {
        if let Some(idx) = batch_fields.get(field_latest.name()) {
            let field = batch_schema.field(*idx);
            cols.push(Arc::clone(&batch_cols[*idx]));
            fields.push(field.clone());
        } else if *field_latest.data_type() == DataType::Utf8View {
            // in memtable, the schema should be utf8
            cols.push(new_null_array(&DataType::Utf8, batch.num_rows()));
            fields.push(Field::new(
                field_latest.name(),
                DataType::Utf8,
                field_latest.is_nullable(),
            ));
            diff_fields.insert(field_latest.name().to_string(), DataType::Utf8View);
        } else {
            cols.push(new_null_array(field_latest.data_type(), batch.num_rows()));
            fields.push(field_latest.as_ref().clone());
        }
    }
    let schema = Arc::new(Schema::new(fields));
    (RecordBatch::try_new(schema, cols).unwrap(), diff_fields)
}

#[cfg(test)]
mod tests {
    use arrow::array::{Array, Int64Array, StringArray};
    use arrow_schema::Field;

    use super::*;

    #[test]
    fn test_adapt_batch_exact_match() {
        // Test case: batch schema exactly matches latest schema
        let batch_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
            ],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 2);
        assert_eq!(result_batch.num_rows(), 3);
        assert!(diff_fields.is_empty());

        // Verify data is preserved
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let name_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);
        assert_eq!(name_col.value(0), "a");
        assert_eq!(name_col.value(1), "b");
        assert_eq!(name_col.value(2), "c");
    }

    #[test]
    fn test_adapt_batch_missing_field() {
        // Test case: batch is missing a field that exists in latest schema
        let batch_schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
            Field::new("active", DataType::Boolean, true), // Make nullable since we'll add nulls
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![Arc::new(Int64Array::from(vec![1, 2, 3]))],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 3);
        assert_eq!(result_batch.num_rows(), 3);
        assert!(diff_fields.is_empty());

        // Verify existing data is preserved
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);

        // Verify missing fields are null
        let name_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(name_col.null_count(), 3);

        let active_col = result_batch
            .column(2)
            .as_any()
            .downcast_ref::<arrow::array::BooleanArray>()
            .unwrap();
        assert_eq!(active_col.null_count(), 3);
    }

    #[test]
    fn test_adapt_batch_utf8view_field() {
        // Test case: latest schema has Utf8View field that's missing in batch
        let batch_schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("description", DataType::Utf8View, true),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![Arc::new(Int64Array::from(vec![1, 2, 3]))],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 2);
        assert_eq!(result_batch.num_rows(), 3);
        assert_eq!(diff_fields.len(), 1);
        assert_eq!(diff_fields.get("description"), Some(&DataType::Utf8View));

        // Verify existing data is preserved
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);

        // Verify Utf8View field is added as Utf8 with nulls
        let desc_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(desc_col.null_count(), 3);
        assert_eq!(desc_col.data_type(), &DataType::Utf8);
    }

    #[test]
    fn test_adapt_batch_extra_field() {
        // Test case: batch has extra fields not in latest schema
        let batch_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
            Field::new("extra_field", DataType::Int32, false),
        ]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(arrow::array::Int32Array::from(vec![10, 20, 30])),
            ],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 2);
        assert_eq!(result_batch.num_rows(), 3);
        assert!(diff_fields.is_empty());

        // Verify only fields from latest schema are included
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let name_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);
        assert_eq!(name_col.value(0), "a");
        assert_eq!(name_col.value(1), "b");
        assert_eq!(name_col.value(2), "c");
    }

    #[test]
    fn test_adapt_batch_empty_batch() {
        // Test case: empty batch
        let batch_schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![Arc::new(Int64Array::from(Vec::<i64>::new()))],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 2);
        assert_eq!(result_batch.num_rows(), 0);
        assert!(diff_fields.is_empty());
    }

    #[test]
    fn test_adapt_batch_field_order() {
        // Test case: fields in different order
        let batch_schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, true),
            Field::new("id", DataType::Int64, false),
        ]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, true),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(Int64Array::from(vec![1, 2, 3])),
            ],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 2);
        assert_eq!(result_batch.num_rows(), 3);
        assert!(diff_fields.is_empty());

        // Verify fields are in the order of latest schema
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let name_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);
        assert_eq!(name_col.value(0), "a");
        assert_eq!(name_col.value(1), "b");
        assert_eq!(name_col.value(2), "c");
    }

    #[test]
    fn test_adapt_batch_multiple_utf8view_fields() {
        // Test case: multiple Utf8View fields in latest schema
        let batch_schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("title", DataType::Utf8View, true),
            Field::new("description", DataType::Utf8View, true), /* Make nullable since we'll
                                                                  * add nulls */
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![Arc::new(Int64Array::from(vec![1, 2, 3]))],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 3);
        assert_eq!(result_batch.num_rows(), 3);
        assert_eq!(diff_fields.len(), 2);
        assert_eq!(diff_fields.get("title"), Some(&DataType::Utf8View));
        assert_eq!(diff_fields.get("description"), Some(&DataType::Utf8View));

        // Verify existing data is preserved
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);

        // Verify Utf8View fields are added as Utf8 with nulls
        let title_col = result_batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let desc_col = result_batch
            .column(2)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(title_col.null_count(), 3);
        assert_eq!(desc_col.null_count(), 3);
        assert_eq!(title_col.data_type(), &DataType::Utf8);
        assert_eq!(desc_col.data_type(), &DataType::Utf8);
    }

    #[test]
    fn test_adapt_batch_nullable_vs_non_nullable() {
        // Test case: field exists but with different nullability
        let batch_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, true), // nullable in batch
        ]));

        let latest_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false), // non-nullable in latest
        ]));

        let batch = RecordBatch::try_new(
            batch_schema.clone(),
            vec![Arc::new(Int64Array::from(vec![Some(1), None, Some(3)]))],
        )
        .unwrap();

        let (result_batch, diff_fields) = adapt_batch(latest_schema, batch);

        assert_eq!(result_batch.schema().fields().len(), 1);
        assert_eq!(result_batch.num_rows(), 3);
        assert!(diff_fields.is_empty());

        // Verify data is preserved (including nulls)
        let id_col = result_batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.null_count(), 1);
        assert_eq!(id_col.value(0), 1);
        assert!(id_col.is_null(1));
        assert_eq!(id_col.value(2), 3);
    }
}
