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

use std::{io::Cursor, path::Path, sync::Arc};

use ahash::AHashMap as HashMap;
use arrow::array::{new_null_array, ArrayRef};
use config::{
    meta::stream::{FileKey, StreamType},
    utils::parquet::read_metadata_from_bytes,
    CONFIG,
};
use datafusion::{
    arrow::{datatypes::Schema, record_batch::RecordBatch},
    common::FileType,
};
use futures::future::try_join_all;
use parquet::arrow::ParquetRecordBatchStreamBuilder;
use tokio::time::Duration;
use tracing::{info_span, Instrument};

use crate::{
    common::{
        infra::{
            cache::tmpfs,
            errors::{Error, ErrorCodes},
            wal,
        },
        meta::{
            self,
            search::SearchType,
            stream::{PartitionTimeLevel, ScanStats},
        },
        utils::file::{get_file_contents, scan_files},
    },
    service::{
        db,
        search::{
            datafusion::{exec, storage::StorageType},
            sql::Sql,
        },
        stream::{stream_settings, unwrap_partition_time_level},
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:parquet::enter", skip_all, fields(session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search_parquet(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: StreamType,
    timeout: u64,
) -> super::SearchResult {
    let schema_latest = db::schema::get(&sql.org_id, &sql.stream_name, stream_type)
        .await
        .unwrap_or(Schema::empty());
    let schema_settings = stream_settings(&schema_latest).unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(schema_settings.partition_time_level, stream_type);

    // get file list
    let mut files = get_file_list(session_id, &sql, stream_type, &partition_time_level).await?;
    if files.is_empty() {
        return Ok((HashMap::new(), ScanStats::new()));
    }

    let lock_files = files.iter().map(|f| f.key.clone()).collect::<Vec<_>>();
    let mut scan_stats = ScanStats::new();

    // cache files
    let work_dir = session_id.to_string();
    for file in files.clone().iter() {
        let source_file = CONFIG.common.data_wal_dir.to_string() + file.key.as_str();
        match get_file_contents(&source_file) {
            Err(_) => {
                log::error!(
                    "[session_id {session_id}] skip wal file: {} get file content error",
                    &file.key
                );
                files.retain(|x| x != file);
            }
            Ok(file_data) => {
                let file_data = file_data.into();
                let parquet_meta = read_metadata_from_bytes(&file_data)
                    .await
                    .unwrap_or_default();
                scan_stats.original_size += parquet_meta.original_size;
                if let Some((min_ts, max_ts)) = sql.meta.time_range {
                    if parquet_meta.min_ts <= max_ts && parquet_meta.max_ts >= min_ts {
                        let file_name = format!("/{work_dir}/{}", file.key);
                        tmpfs::set(&file_name, file_data).expect("tmpfs set success");
                    } else {
                        log::debug!(
                            "[session_id {session_id}] skip wal file: {} time_range: [{},{}]",
                            &file.key,
                            parquet_meta.min_ts,
                            parquet_meta.max_ts
                        );
                        files.retain(|x| x != file);
                    }
                }
            }
        }
    }

    // release all files
    wal::release_files(&lock_files).await;

    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        tmpfs::delete(session_id, true).unwrap();
        return Ok((HashMap::new(), scan_stats));
    }

    // fetch all schema versions, get latest schema
    let schema_latest = Arc::new(
        schema_latest
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    // check schema version
    let files = tmpfs::list(&work_dir, "").unwrap_or_default();

    let mut files_group: HashMap<String, Vec<FileKey>> = HashMap::with_capacity(2);
    if !CONFIG.common.widening_schema_evolution {
        files_group.insert(
            "latest".to_string(),
            files
                .iter()
                .map(|f| FileKey::from_file_name(&f.location))
                .collect(),
        );
    } else {
        for file in files {
            let schema_version = get_schema_version(&file.location)?;
            let entry = files_group.entry(schema_version).or_default();
            entry.push(FileKey::from_file_name(&file.location));
        }
    }

    log::info!(
        "[session_id {session_id}] wal->mem->search: load groups {}, files {}, scan_size {}",
        files_group.len(),
        scan_stats.files,
        scan_stats.original_size
    );

    let mut tasks = Vec::new();
    let is_single_group = files_group.len() == 1;
    for (ver, files) in files_group {
        // get schema of the file
        let file_data = tmpfs::get(&files.first().unwrap().key).unwrap();
        let schema_reader = Cursor::new(file_data);
        let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        let mut inferred_schema = arrow_reader
            .schema()
            .as_ref()
            .clone()
            .with_metadata(std::collections::HashMap::new());
        // calulate schema diff
        let mut diff_fields = HashMap::new();
        let group_fields = inferred_schema.fields();
        for field in group_fields {
            if let Ok(v) = schema_latest.field_with_name(field.name()) {
                if v.data_type() != field.data_type() {
                    diff_fields.insert(v.name().clone(), v.data_type().clone());
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
        for field in schema_latest.fields() {
            if inferred_schema.field_with_name(field.name()).is_err() {
                new_fields.push(field.clone());
            }
        }
        if !new_fields.is_empty() {
            let new_schema = Schema::new(new_fields);
            inferred_schema = Schema::try_merge(vec![inferred_schema, new_schema])?;
        }
        let schema = Arc::new(inferred_schema);
        let sql = sql.clone();
        let session = if is_single_group {
            meta::search::Session {
                // here must be session_id, because the files set within this prefix
                id: session_id.to_string(),
                storage_type: StorageType::Tmpfs,
                search_type: if !sql.meta.group_by.is_empty() {
                    SearchType::Aggregation
                } else {
                    SearchType::Normal
                },
            }
        } else {
            let id = format!("{session_id}-parquet-{ver}");
            // move data to group tmpfs
            for file in files.iter() {
                let file_data = tmpfs::get(&file.key).unwrap();
                let file_name = format!(
                    "/{}/{}",
                    id,
                    file.key.strip_prefix(&format!("/{}/", work_dir)).unwrap()
                );
                tmpfs::set(&file_name, file_data).expect("tmpfs set success");
            }
            meta::search::Session {
                id,
                storage_type: StorageType::Tmpfs,
                search_type: if !sql.meta.group_by.is_empty() {
                    SearchType::Aggregation
                } else {
                    SearchType::Normal
                },
            }
        };
        let datafusion_span = info_span!(
            "service:search:grpc:wal:parquet:datafusion",
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
                log::error!(
                    "[session_id {session_id}] datafusion execute error: {}",
                    err
                );
                tmpfs::delete(session_id, true).unwrap();
                return Err(err.into());
            }
        };
    }

    // clear tmpfs
    tmpfs::delete(session_id, true).unwrap();

    Ok((results, scan_stats))
}

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:mem:enter", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search_memtable(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: StreamType,
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
        scan_stats.original_size += batch.iter().map(|r| r.data_json_size).sum::<usize>() as i64;
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

    let mut tasks = Vec::new();
    for (ver, (mut schema, mut record_batches)) in batch_groups.into_iter().enumerate() {
        // calulate schema diff
        let mut diff_fields = HashMap::new();
        let group_fields = schema.fields();
        for field in group_fields {
            if let Ok(v) = schema_latest.field_with_name(field.name()) {
                if v.data_type() != field.data_type() {
                    diff_fields.insert(v.name().clone(), v.data_type().clone());
                }
            }
        }
        // add not exists field for wal infered schema
        let mut new_fields = Vec::new();
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

/// get file list from local wal, no need match_source, each file will be
/// searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    _session_id: &str,
    sql: &Sql,
    stream_type: StreamType,
    _partition_time_level: &PartitionTimeLevel,
) -> Result<Vec<FileKey>, Error> {
    let wal_dir = match Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
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
    let files = scan_files(&pattern, "parquet");
    if files.is_empty() {
        return Ok(vec![]);
    }

    // lock theses files
    let files = files
        .iter()
        .filter(|f| f.ends_with(".parquet"))
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
    for file in files.iter() {
        let file_key = FileKey::from_file_name(file);
        if sql.match_source(&file_key, false, true, stream_type).await {
            result.push(file_key);
        } else {
            wal::release_files(&[file.clone()]).await;
        }
    }
    Ok(result)
}

fn get_schema_version(file: &str) -> Result<String, Error> {
    // eg: /a-b-c-d/files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
    // 7099303408192061440f3XQ2p.parquet
    let column = file.split('/').collect::<Vec<&str>>();
    if column.len() < 12 {
        return Err(Error::Message(format!("invalid wal file name: {}", file)));
    }
    Ok(column[11].to_string())
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
