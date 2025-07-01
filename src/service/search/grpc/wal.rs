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

use std::{path::Path, sync::Arc};

use arrow::array::{ArrayRef, new_null_array};
use arrow_schema::{DataType, Field};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::{ScanStats, StorageType},
        stream::{FileKey, StreamParams, StreamPartition},
    },
    utils::{
        file::{is_exists, scan_files},
        parquet::{parse_time_range_from_filename, read_metadata_from_file},
        record_batch_ext::concat_batches,
        size::bytes_to_human_readable,
    },
};
use datafusion::{
    arrow::{datatypes::Schema, record_batch::RecordBatch},
    execution::cache::cache_manager::FileStatisticsCache,
};
use futures::StreamExt;
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
use ingester::WAL_PARQUET_METADATA;

use crate::{
    common::infra::wal,
    service::{
        db, file_list,
        search::{
            datafusion::{exec, table_provider::memtable::NewMemTable},
            generate_filter_from_equal_items, generate_search_schema_diff,
            grpc::utils,
            index::IndexCondition,
            inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
            match_source,
        },
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:parquet", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
pub async fn search_parquet(
    query: Arc<super::QueryParams>,
    schema: Arc<Schema>,
    search_partition_keys: &[(String, String)],
    sorted_by_time: bool,
    file_stat_cache: Option<FileStatisticsCache>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
) -> super::SearchTable {
    let load_start = std::time::Instant::now();
    // get file list
    let stream_settings =
        infra::schema::get_settings(&query.org_id, &query.stream_name, query.stream_type)
            .await
            .unwrap_or_default();
    let files = get_file_list(
        query.clone(),
        &stream_settings.partition_keys,
        query.time_range,
        search_partition_keys,
    )
    .await?;
    if files.is_empty() {
        return Ok((vec![], ScanStats::new()));
    }

    let mut scan_stats = ScanStats::new();
    let mut lock_files = files.iter().map(|f| f.key.clone()).collect::<Vec<_>>();
    let cfg = get_config();
    // get file metadata to build file_list
    let files_num = files.len();
    let mut new_files = Vec::with_capacity(files_num);
    let files_metadata = futures::stream::iter(files)
        .map(|file| async move {
            let cfg = get_config();
            let r = WAL_PARQUET_METADATA.read().await;
            let source_file = cfg.common.data_wal_dir.to_string() + file.key.as_str();
            if let Some(meta) = r.get(file.key.as_str()) {
                let mut file = file;
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
            let mut file = file;
            file.meta = meta;
            WAL_PARQUET_METADATA
                .write()
                .await
                .insert(file.key.clone(), file.meta.clone());
            file
        })
        .buffer_unordered(cfg.limit.cpu_num)
        .collect::<Vec<FileKey>>()
        .await;
    for file in files_metadata {
        if file.meta.is_empty() {
            wal::release_files(&[file.key.clone()]);
            lock_files.retain(|f| f != &file.key);
            continue;
        }
        if let Some((min_ts, max_ts)) = query.time_range {
            if file.meta.min_ts > max_ts || file.meta.max_ts < min_ts {
                log::debug!(
                    "[trace_id {}] skip wal parquet file: {} time_range: [{},{})",
                    query.trace_id,
                    &file.key,
                    file.meta.min_ts,
                    file.meta.max_ts
                );
                wal::release_files(&[file.key.clone()]);
                lock_files.retain(|f| f != &file.key);
                continue;
            }
        }
        new_files.push(file);
    }
    let files = new_files;

    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        // release all files
        wal::release_files(&lock_files);
        return Ok((vec![], scan_stats));
    }

    // fetch all schema versions, group files by version
    let schema_versions = match infra::schema::get_versions(
        &query.org_id,
        &query.stream_name,
        query.stream_type,
        query.time_range,
    )
    .await
    {
        Ok(versions) => versions,
        Err(err) => {
            log::error!("[trace_id {}] get schema error: {}", query.trace_id, err);
            // release all files
            wal::release_files(&lock_files);
            return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                query.stream_name.clone(),
            )));
        }
    };
    if schema_versions.is_empty() {
        // release all files
        wal::release_files(&lock_files);
        return Ok((vec![], ScanStats::new()));
    }
    let latest_schema_id = schema_versions.len() - 1;

    let mut files_group: HashMap<usize, Vec<FileKey>> =
        HashMap::with_capacity(schema_versions.len());
    let mut scan_stats = ScanStats::new();
    if schema_versions.len() == 1 {
        let files = files.to_vec();
        scan_stats = match file_list::calculate_files_size(&files).await {
            Ok(size) => size,
            Err(err) => {
                // release all files
                wal::release_files(&lock_files);
                log::error!(
                    "[trace_id {}] calculate files size error: {}",
                    query.trace_id,
                    err
                );
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    "calculate files size error".to_string(),
                )));
            }
        };
        files_group.insert(latest_schema_id, files);
    } else {
        scan_stats.files = files.len() as i64;
        for file in files.iter() {
            // calculate scan size
            scan_stats.records += file.meta.records;
            scan_stats.original_size += file.meta.original_size;
            scan_stats.compressed_size += file.meta.compressed_size;
            // check schema version
            let schema_ver_id = match db::schema::filter_schema_version_id(
                &schema_versions,
                file.meta.min_ts,
                file.meta.max_ts,
            ) {
                Some(id) => id,
                None => {
                    log::error!(
                        "[trace_id {}] wal->parquet->search: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        query.trace_id,
                        &file.key,
                        file.meta.min_ts,
                        file.meta.max_ts
                    );
                    // HACK: use the latest version if not found in schema versions
                    latest_schema_id
                }
            };
            let group = files_group.entry(schema_ver_id).or_default();
            group.push(file.clone());
        }
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {}] wal->parquet->search: load groups {}, files {}, scan_size {}, compressed_size {}",
                query.trace_id,
                files_group.len(),
                scan_stats.files,
                scan_stats.original_size,
                scan_stats.compressed_size
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("wal:parquet load".to_string())
                .search_role("follower".to_string())
                .duration(load_start.elapsed().as_millis() as usize)
                .desc(format!(
                    "wal parquet search load groups {}, files {}, scan_size {}, compressed_size {}",
                    files_group.len(),
                    scan_stats.files,
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

    // construct latest schema map
    let latest_schema = Arc::new(schema.as_ref().clone().with_metadata(Default::default()));
    let mut latest_schema_map = HashMap::with_capacity(latest_schema.fields().len());
    for field in latest_schema.fields() {
        latest_schema_map.insert(field.name(), field);
    }

    let mut tables = Vec::new();
    let start = std::time::Instant::now();
    for (ver, files) in files_group {
        if files.is_empty() {
            continue;
        }
        if files.is_empty() {
            continue;
        }
        let schema = schema_versions[ver]
            .clone()
            .with_metadata(Default::default());
        let schema = utils::change_schema_to_utf8_view(schema);
        let session = config::meta::search::Session {
            id: format!("{}-wal-{ver}", query.trace_id),
            storage_type: StorageType::Wal,
            work_group: query.work_group.clone(),
            target_partitions: cfg.limit.cpu_num,
        };

        let diff_fields = generate_search_schema_diff(&schema, &latest_schema_map);
        match exec::create_parquet_table(
            &session,
            latest_schema.clone(),
            &files,
            diff_fields,
            sorted_by_time,
            file_stat_cache.clone(),
            index_condition.clone(),
            fst_fields.clone(),
            true,
        )
        .await
        {
            Ok(v) => tables.push(v),
            Err(e) => {
                // release all files
                wal::release_files(&lock_files);
                return Err(e.into());
            }
        }
    }

    // lock these files for this request
    wal::lock_request(&query.trace_id, &lock_files);

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {}] wal->parquet->search: create tables took {} ms",
                query.trace_id,
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

    Ok((tables, scan_stats))
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

    let mut batches = ingester::read_from_memtable(
        &query.org_id,
        query.stream_type.as_str(),
        &query.stream_name,
        query.time_range,
        &filters,
    )
    .await
    .unwrap_or_default();
    batches.extend(
        ingester::read_from_immutable(
            &query.org_id,
            query.stream_type.as_str(),
            &query.stream_name,
            query.time_range,
            &filters,
        )
        .await
        .unwrap_or_default(),
    );
    scan_stats.files = batches.iter().map(|(_, k)| k.len()).sum::<usize>() as i64;
    if scan_stats.files == 0 {
        return Ok((vec![], ScanStats::new()));
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
    for (schema, record_batches) in batch_groups {
        if record_batches.is_empty() {
            continue;
        }

        // the field in latest_schema_map, but not in schema,
        // so not in the diff_fields, result in Utf8View issue
        // so we need to add it to the diff_fields
        let mut diff_fields = generate_search_schema_diff(&schema, &latest_schema_map);
        let mut adapt_batches = Vec::with_capacity(record_batches.len());
        for batch in record_batches {
            adapt_batches.push(adapt_batch(latest_schema.clone(), batch, &mut diff_fields));
        }
        let record_batches = adapt_batches;

        tokio::task::coop::consume_budget().await;

        // merge small batches into big batches
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
            .into_iter()
            .map(|mut group| {
                if group.len() == 1 {
                    group.remove(0)
                } else {
                    concat_batches(group[0].schema().clone(), group).unwrap()
                }
            })
            .collect::<Vec<_>>();

        tokio::task::coop::consume_budget().await;

        let table = match NewMemTable::try_new(
            record_batches[0].schema().clone(),
            vec![record_batches],
            diff_fields,
            sorted_by_time,
            index_condition.clone(),
            fst_fields.clone(),
        ) {
            Ok(table) => Arc::new(table),
            Err(e) => {
                log::error!(
                    "[trace_id {}] wal->mem->search: create memtable error: {}",
                    query.trace_id,
                    e
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
    Ok((tables, scan_stats))
}

#[tracing::instrument(name = "service:search:grpc:wal:get_file_list_inner", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
async fn get_file_list_inner(
    query: Arc<super::QueryParams>,
    partition_keys: &[StreamPartition],
    time_range: Option<(i64, i64)>,
    search_partition_keys: &[(String, String)],
    wal_dir: &str,
    file_ext: &str,
) -> Result<Vec<FileKey>, Error> {
    let wal_dir = match Path::new(wal_dir).canonicalize() {
        Ok(path) => {
            let mut path = path.to_str().unwrap().to_string();
            // Hack for windows
            if path.starts_with("\\\\?\\") {
                path = path[4..].to_string();
                path = path.replace('\\', "/");
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
    let files = scan_files(&pattern, file_ext, None).unwrap_or_default();
    let files = files
        .iter()
        .map(|f| {
            f.strip_prefix(&wal_dir)
                .unwrap()
                .to_string()
                .replace('\\', "/")
                .trim_start_matches('/')
                .to_string()
        })
        .collect::<Vec<_>>();

    // use same lock to combine the operations of filter by pending delete and lock files
    let wal_lock = infra::local_lock::lock("wal").await?;
    let lock_guard = wal_lock.lock().await;

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
            "[trace_id {}] wal->parquet->search: found duplicate files from {} to {}",
            query.trace_id,
            files_num,
            files.len()
        );
    }

    // lock theses files
    wal::lock_files(&files);
    drop(lock_guard);

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
    let (min_ts, max_ts) = query.time_range.unwrap_or((0, 0));
    for file in files.iter() {
        let file_key = FileKey::from_file_name(file);
        if (min_ts, max_ts) != (0, 0) {
            let (file_min_ts, file_max_ts) = parse_time_range_from_filename(file);
            if (file_min_ts > 0 && file_max_ts > 0)
                && ((max_ts > 0 && file_min_ts > max_ts) || (min_ts > 0 && file_max_ts < min_ts))
            {
                log::debug!(
                    "[trace_id {}] skip wal parquet file: {} time_range: [{},{})",
                    query.trace_id,
                    &file,
                    file_min_ts,
                    file_max_ts
                );
                wal::release_files(&[file.clone()]);
                continue;
            }
        }
        if match_source(stream_params.clone(), time_range, &filters, &file_key).await {
            result.push(file_key);
        } else {
            wal::release_files(&[file.clone()]);
        }
    }
    Ok(result)
}

/// get file list from local wal, no need match_source, each file will be
/// searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all, fields(org_id = query.org_id, stream_name = query.stream_name))]
async fn get_file_list(
    query: Arc<super::QueryParams>,
    partition_keys: &[StreamPartition],
    time_range: Option<(i64, i64)>,
    search_partition_keys: &[(String, String)],
) -> Result<Vec<FileKey>, Error> {
    get_file_list_inner(
        query,
        partition_keys,
        time_range,
        search_partition_keys,
        &get_config().common.data_wal_dir,
        "parquet",
    )
    .await
}

fn adapt_batch(
    latest_schema: Arc<Schema>,
    batch: RecordBatch,
    diff_fields: &mut HashMap<String, DataType>,
) -> RecordBatch {
    let batch_schema = &*batch.schema();
    let batch_cols = batch.columns().to_vec();

    let mut cols: Vec<ArrayRef> = Vec::with_capacity(latest_schema.fields().len());
    let mut fields = Vec::with_capacity(latest_schema.fields().len());
    for field_latest in latest_schema.fields() {
        if let Some((idx, field)) = batch_schema.column_with_name(field_latest.name()) {
            cols.push(Arc::clone(&batch_cols[idx]));
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
    RecordBatch::try_new(schema, cols).unwrap()
}
