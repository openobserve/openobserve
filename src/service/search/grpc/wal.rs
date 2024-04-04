// Copyright 2023 Zinc Labs Inc.
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

use arrow::array::{new_null_array, ArrayRef};
use config::{
    meta::stream::{FileKey, PartitionTimeLevel, StreamType},
    utils::{
        file::scan_files,
        parquet::{parse_time_range_from_filename, read_metadata_from_file},
    },
    CONFIG,
};
use datafusion::{
    arrow::{datatypes::Schema, record_batch::RecordBatch},
    common::FileType,
};
use futures::future::try_join_all;
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
use tokio::time::Duration;
use tracing::{info_span, Instrument};

use crate::{
    common::{
        infra::wal,
        meta::{
            self,
            search::SearchType,
            stream::{ScanStats, StreamPartition},
        },
    },
    service::{
        db, file_list,
        search::{
            datafusion::{exec, storage::StorageType},
            sql::Sql,
        },
        stream,
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:parquet::enter", skip_all, fields(session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search_parquet(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: StreamType,
    work_group: &str,
    timeout: u64,
) -> super::SearchResult {
    // fetch all schema versions, group files by version
    let schema_versions =
        match db::schema::get_versions(&sql.org_id, &sql.stream_name, stream_type).await {
            Ok(versions) => versions,
            Err(err) => {
                log::error!("[session_id {session_id}] get schema error: {}", err);
                return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                    sql.stream_name.clone(),
                )));
            }
        };
    if schema_versions.is_empty() {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
            sql.stream_name.clone(),
        )));
    }
    let schema_latest = schema_versions.last().unwrap();
    let schema_latest_id = schema_versions.len() - 1;

    let stream_settings = stream::stream_settings(schema_latest).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    // get file list
    let files = get_file_list(
        session_id,
        &sql,
        stream_type,
        &partition_time_level,
        &stream_settings.partition_keys,
    )
    .await?;
    if files.is_empty() {
        return Ok((HashMap::new(), ScanStats::new()));
    }

    let mut scan_stats = ScanStats::new();
    let lock_files = files.iter().map(|f| f.key.clone()).collect::<Vec<_>>();

    // get file metadata to build file_list
    let mut new_files = Vec::with_capacity(files.len());
    for file in files.iter() {
        let source_file = CONFIG.common.data_wal_dir.to_string() + file.key.as_str();
        let parquet_meta = read_metadata_from_file(&source_file.into())
            .await
            .unwrap_or_default();

        if let Some((min_ts, max_ts)) = sql.meta.time_range {
            if parquet_meta.min_ts > max_ts || parquet_meta.max_ts < min_ts {
                log::debug!(
                    "[session_id {session_id}] skip wal parquet file: {} time_range: [{},{}]",
                    &file.key,
                    parquet_meta.min_ts,
                    parquet_meta.max_ts
                );
                wal::release_files(&[file.key.clone()]).await;
                continue;
            }
        }
        let mut file = file.clone();
        file.meta = parquet_meta;
        new_files.push(file);
    }
    let files = new_files;

    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        // release all files
        wal::release_files(&lock_files).await;
        return Ok((HashMap::new(), scan_stats));
    }

    let mut files_group: HashMap<usize, Vec<FileKey>> =
        HashMap::with_capacity(schema_versions.len());
    let mut scan_stats = ScanStats::new();
    if !CONFIG.common.widening_schema_evolution || schema_versions.len() == 1 {
        let files = files.to_vec();
        scan_stats = match file_list::calculate_files_size(&files).await {
            Ok(size) => size,
            Err(err) => {
                // release all files
                wal::release_files(&lock_files).await;
                log::error!(
                    "[session_id {session_id}] calculate files size error: {}",
                    err
                );
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    "calculate files size error".to_string(),
                )));
            }
        };
        files_group.insert(schema_latest_id, files);
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
                    // release all files
                    wal::release_files(&lock_files).await;
                    log::error!(
                        "[session_id {session_id}] wal->parquet->search: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        &file.key,
                        file.meta.min_ts,
                        file.meta.max_ts
                    );
                    // HACK: use the latest verion if not found in schema versions
                    schema_latest_id
                }
            };
            let group = files_group.entry(schema_ver_id).or_default();
            group.push(file.clone());
        }
    }

    log::info!(
        "[session_id {session_id}] wal->parquet->search: load groups {}, files {}, scan_size {}, compressed_size {}",
        files_group.len(),
        scan_stats.files,
        scan_stats.original_size,
        scan_stats.compressed_size
    );

    if CONFIG.common.memory_circuit_breaker_enable {
        if let Err(e) = super::check_memory_circuit_breaker(session_id, &scan_stats) {
            // release all files
            wal::release_files(&lock_files).await;
            return Err(e);
        }
    }

    // construct latest schema map
    let mut schema_latest_map = HashMap::with_capacity(schema_latest.fields().len());
    for field in schema_latest.fields() {
        schema_latest_map.insert(field.name(), field.data_type());
    }

    let mut tasks = Vec::new();
    for (ver, files) in files_group {
        let mut schema = schema_versions[ver]
            .clone()
            .with_metadata(std::collections::HashMap::new());
        let sql = sql.clone();
        let session = meta::search::Session {
            id: format!("{session_id}-wal-{ver}"),
            storage_type: StorageType::Wal,
            search_type: if !sql.meta.group_by.is_empty() {
                SearchType::Aggregation
            } else {
                SearchType::Normal
            },
            work_group: Some(work_group.to_string()),
        };
        // cacluate the diff between latest schema and group schema
        let mut diff_fields = HashMap::new();
        let group_fields = schema.fields();
        for field in group_fields {
            if let Some(data_type) = schema_latest_map.get(field.name()) {
                if *data_type != field.data_type() {
                    diff_fields.insert(field.name().clone(), (*data_type).clone());
                }
            }
        }
        for (field, alias) in sql.meta.field_alias.iter() {
            if let Some(v) = diff_fields.get(field) {
                diff_fields.insert(alias.to_string(), v.clone());
            }
        }
        // add not exists field for wal infered schema
        let mut new_fields = Vec::new();
        for field in sql.meta.fields.iter() {
            if schema.field_with_name(field).is_err() {
                if let Ok(field) = schema_latest.field_with_name(field) {
                    new_fields.push(Arc::new(field.clone()));
                }
            }
        }
        if !new_fields.is_empty() {
            let new_schema = Schema::new(new_fields);
            schema = Schema::try_merge(vec![schema, new_schema])?;
        }
        let datafusion_span = info_span!(
            "service:search:grpc:wal:parquet:datafusion",
            session_id,
            org_id = sql.org_id,
            stream_name = sql.stream_name,
            stream_type = stream_type.to_string(),
        );
        let schema = Arc::new(schema);
        let task = tokio::time::timeout(
            Duration::from_secs(timeout),
            async move {
                exec::sql(
                    &session,
                    schema,
                    &diff_fields,
                    &sql,
                    &files,
                    None,
                    FileType::PARQUET,
                )
                .await
            }
            .instrument(datafusion_span),
        );
        tasks.push(task);
    }

    let mut results: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    let task_results = match try_join_all(tasks).await {
        Ok(v) => v,
        Err(e) => {
            // release all files
            wal::release_files(&lock_files).await;
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                e.to_string(),
            )));
        }
    };
    for ret in task_results {
        match ret {
            Ok(ret) => {
                for (k, v) in ret {
                    let v = v
                        .into_iter()
                        .filter(|r| r.num_rows() > 0)
                        .collect::<Vec<_>>();
                    if !v.is_empty() {
                        let group = results.entry(k).or_default();
                        group.extend(v);
                    }
                }
            }
            Err(err) => {
                // release all files
                wal::release_files(&lock_files).await;
                log::error!(
                    "[session_id {session_id}] datafusion execute error: {}",
                    err
                );
                return Err(err.into());
            }
        };
    }

    // release all files
    wal::release_files(&lock_files).await;

    Ok((results, scan_stats))
}

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:mem:enter", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search_memtable(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: StreamType,
    work_group: &str,
    timeout: u64,
) -> super::SearchResult {
    let schema_latest = db::schema::get(&sql.org_id, &sql.stream_name, stream_type)
        .await
        .unwrap_or(Schema::empty());
    // let schema_settings = stream_settings(&schema_latest).unwrap_or_default();
    // let partition_time_level =
    // unwrap_partition_time_level(schema_settings.partition_time_level,
    // stream_type);

    let mut scan_stats = ScanStats::new();

    let mut batches = ingester::read_from_memtable(
        &sql.org_id,
        &stream_type.to_string(),
        &sql.stream_name,
        sql.meta.time_range,
    )
    .await
    .unwrap_or_default();
    batches.extend(
        ingester::read_from_immutable(
            &sql.org_id,
            &stream_type.to_string(),
            &sql.stream_name,
            sql.meta.time_range,
        )
        .await
        .unwrap_or_default(),
    );
    scan_stats.files = batches.iter().map(|(_, k)| k.len()).sum::<usize>() as i64;
    if scan_stats.files == 0 {
        return Ok((HashMap::new(), ScanStats::new()));
    }

    let mut batch_groups: HashMap<Arc<Schema>, Vec<RecordBatch>> = HashMap::with_capacity(2);
    for (schema, batch) in batches {
        let entry = batch_groups.entry(schema).or_default();
        for r in batch.iter() {
            scan_stats.records += r.data.num_rows() as i64;
            scan_stats.original_size += r.data_json_size as i64;
        }
        entry.extend(batch.into_iter().map(|r| r.data.clone()));
    }

    log::info!(
        "[session_id {session_id}] wal->mem->search: load groups {}, files {}, scan_size {}",
        batch_groups.len(),
        scan_stats.files,
        scan_stats.original_size
    );

    if CONFIG.common.memory_circuit_breaker_enable {
        super::check_memory_circuit_breaker(session_id, &scan_stats)?;
    }

    // fetch all schema versions, get latest schema
    let schema_latest = Arc::new(
        schema_latest
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    // construct latest schema map
    let mut schema_latest_map = HashMap::with_capacity(schema_latest.fields().len());
    for field in schema_latest.fields() {
        schema_latest_map.insert(field.name(), field.data_type());
    }

    let mut tasks = Vec::new();
    for (ver, (mut schema, mut record_batches)) in batch_groups.into_iter().enumerate() {
        // calulate schema diff
        let mut diff_fields = HashMap::new();
        let group_fields = schema.fields();
        for field in group_fields {
            if let Some(data_type) = schema_latest_map.get(field.name()) {
                if *data_type != field.data_type() {
                    diff_fields.insert(field.name().clone(), (*data_type).clone());
                }
            }
        }
        // add not exists field for wal infered schema
        let mut new_fields = Vec::new();
        for field in sql.meta.fields.iter() {
            if schema.field_with_name(field).is_err() {
                if let Ok(field) = schema_latest.field_with_name(field) {
                    new_fields.push(Arc::new(field.clone()));
                }
            }
        }
        for field in schema_latest.fields() {
            if schema.field_with_name(field.name()).is_err() {
                new_fields.push(field.clone());
            }
        }
        if !new_fields.is_empty() {
            let new_schema = Schema::new(new_fields);
            schema = Arc::new(Schema::try_merge(vec![
                schema.as_ref().clone(),
                new_schema,
            ])?);
            // fix recordbatch
            for batch in record_batches.iter_mut() {
                *batch = adapt_batch(&schema, batch);
            }
        }

        let sql = sql.clone();
        let session = meta::search::Session {
            id: format!("{session_id}-mem-{ver}"),
            storage_type: StorageType::Tmpfs,
            search_type: if !sql.meta.group_by.is_empty() {
                SearchType::Aggregation
            } else {
                SearchType::Normal
            },
            work_group: Some(work_group.to_string()),
        };

        let datafusion_span = info_span!(
            "service:search:grpc:wal:mem:datafusion",
            org_id = sql.org_id,
            stream_name = sql.stream_name,
            stream_type = stream_type.to_string(),
        );

        let task = tokio::time::timeout(
            Duration::from_secs(timeout),
            async move {
                exec::sql(
                    &session,
                    schema,
                    &diff_fields,
                    &sql,
                    &Vec::new(),
                    Some(record_batches),
                    FileType::ARROW,
                )
                .await
            }
            .instrument(datafusion_span),
        );
        tasks.push(task);
    }

    let mut results: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    let task_results = try_join_all(tasks)
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;
    for ret in task_results {
        match ret {
            Ok(ret) => {
                for (k, v) in ret {
                    let v = v
                        .into_iter()
                        .filter(|r| r.num_rows() > 0)
                        .collect::<Vec<_>>();
                    if !v.is_empty() {
                        let group = results.entry(k).or_default();
                        group.extend(v);
                    }
                }
            }
            Err(err) => {
                log::error!("datafusion execute error: {}", err);
                return Err(err.into());
            }
        };
    }

    Ok((results, scan_stats))
}

#[tracing::instrument(name = "service:search:grpc:wal:get_file_list_inner", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list_inner(
    session_id: &str,
    sql: &Sql,
    stream_type: StreamType,
    _partition_time_level: &PartitionTimeLevel,
    partition_keys: &[StreamPartition],
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
        "{}/files/{}/{stream_type}/{}/",
        wal_dir, &sql.org_id, &sql.stream_name
    );
    let files = scan_files(&pattern, file_ext);
    if files.is_empty() {
        return Ok(vec![]);
    }

    // lock theses files
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
    wal::lock_files(&files).await;

    let mut result = Vec::with_capacity(files.len());
    let (min_ts, max_ts) = sql.meta.time_range.unwrap_or((0, 0));
    for file in files.iter() {
        let file_key = FileKey::from_file_name(file);
        if (min_ts, max_ts) != (0, 0) {
            let (file_min_ts, file_max_ts) = parse_time_range_from_filename(file);
            if (file_min_ts > 0 && file_max_ts > 0)
                && ((max_ts > 0 && file_min_ts > max_ts) || (min_ts > 0 && file_max_ts < min_ts))
            {
                log::debug!(
                    "[session_id {session_id}] skip wal parquet file: {} time_range: [{},{}]",
                    &file,
                    file_min_ts,
                    file_max_ts
                );
                wal::release_files(&[file.clone()]).await;
                continue;
            }
        }
        if sql
            .match_source(&file_key, false, true, stream_type, partition_keys)
            .await
        {
            result.push(file_key);
        } else {
            wal::release_files(&[file.clone()]).await;
        }
    }
    Ok(result)
}

/// get file list from local wal, no need match_source, each file will be
/// searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    session_id: &str,
    sql: &Sql,
    stream_type: StreamType,
    _partition_time_level: &PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Result<Vec<FileKey>, Error> {
    get_file_list_inner(
        session_id,
        sql,
        stream_type,
        _partition_time_level,
        partition_keys,
        &CONFIG.common.data_wal_dir,
        "parquet",
    )
    .await
}

/// get file list from local mutable arrow idx file, each file will be searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list_arrow", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list_arrow(
    session_id: &str,
    sql: &Sql,
    stream_type: StreamType,
    _partition_time_level: &PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Result<Vec<FileKey>, Error> {
    get_file_list_inner(
        session_id,
        sql,
        stream_type,
        _partition_time_level,
        partition_keys,
        &CONFIG.common.data_idx_dir,
        "arrow",
    )
    .await
}

pub fn adapt_batch(table_schema: &Schema, batch: &RecordBatch) -> RecordBatch {
    let batch_schema = &*batch.schema();
    let batch_cols = batch.columns().to_vec();

    let mut cols: Vec<ArrayRef> = Vec::with_capacity(table_schema.fields().len());
    for table_field in table_schema.fields() {
        if let Some((batch_idx, _)) = batch_schema.column_with_name(table_field.name().as_str()) {
            cols.push(Arc::clone(&batch_cols[batch_idx]));
        } else {
            cols.push(new_null_array(table_field.data_type(), batch.num_rows()))
        }
    }

    let merged_schema = Arc::new(table_schema.clone());
    RecordBatch::try_new(merged_schema, cols).unwrap()
}
