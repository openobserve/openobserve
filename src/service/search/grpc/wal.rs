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

use ahash::AHashMap as HashMap;
use arrow::ipc::reader::StreamReader;
use datafusion::{
    arrow::{datatypes::Schema, record_batch::RecordBatch},
    common::FileType,
};
use futures::future::try_join_all;
use std::{io::BufReader, path::Path, sync::Arc, time::UNIX_EPOCH};
use memory_stats::memory_stats;
use std::{
    io::{BufReader, Cursor},
    path::Path,
    sync::Arc,
    time::UNIX_EPOCH,
};
use tokio::time::Duration;

use tracing::{info_span, Instrument};

use crate::common::{
    infra::{
        cache::tmpfs,
        config::{CONFIG, FILE_EXT_ARROW, FILE_EXT_JSON},
        errors::{Error, ErrorCodes},
        wal,
    },
    meta::{
        self, common::FileKey, prom::NAME_LABEL, search::SearchType, stream::ScanStats, StreamType,
    },
    utils::{
        file::{get_file_contents, get_file_meta, scan_files},
        schema::infer_json_schema,
    },
};
use crate::service::{
    db,
    schema::filter_schema_null_fields,
    search::{
        datafusion::{exec, storage::StorageType},
        sql::Sql,
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:enter", skip_all, fields(session_id = ?session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: meta::StreamType,
    timeout: u64,
) -> super::SearchResult {
    // get file list
    let mut files = get_file_list(session_id, &sql, stream_type, FILE_EXT_JSON).await?;
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
                let mut file_data = file_data;
                // check json file is complete
                if !file_data.ends_with(b"\n") {
                    if let Ok(s) = String::from_utf8(file_data.clone()) {
                        if let Some(last_line) = s.lines().last() {
                            if serde_json::from_str::<serde_json::Value>(last_line).is_err() {
                                // remove last line
                                // filter by stream name if data is for metrics
                                file_data = file_data[..file_data.len() - last_line.len()].to_vec();
                            }
                        }
                    }
                }
                if stream_type.eq(&StreamType::Metrics) {
                    let metric_key = format!("\"{NAME_LABEL}\":\"{}\"", &sql.stream_name);
                    if let Ok(s) = String::from_utf8(file_data.clone()) {
                        let filtered_lines: Vec<&str> = s
                            .lines()
                            .filter(|line| line.contains(&metric_key))
                            .collect();

                        // Convert the filtered lines back to a single String
                        let filtered_content = filtered_lines.join("\n");

                        // Convert the String back to a Vec<u8>
                        file_data = filtered_content.into_bytes();
                    }
                }

                scan_stats.original_size += file_data.len() as i64;
                let file_name = format!("/{work_dir}/{}", file.key);
                tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            }
        }
    }

    // check wal memory mode
    if CONFIG.common.wal_memory_mode_enabled {
        let mem_files = wal::get_search_in_memory_files(&sql.org_id, &sql.stream_name, stream_type)
            .await
            .unwrap_or_default();
        for (file_key, file_data) in mem_files {
            scan_stats.original_size += file_data.len() as i64;
            let file_name = format!("/{work_dir}/{file_key}");
            tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            files.push(FileKey::from_file_name(&file_name));
        }
    }

    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        wal::release_files(&lock_files).await;
        tmpfs::delete(session_id, true).unwrap();
        return Ok((HashMap::new(), scan_stats));
    }
    log::info!(
        "[session_id {session_id}] wal->search: load files {}, scan_size {}",
        scan_stats.files,
        scan_stats.original_size
    );

    if CONFIG.common.memory_circuit_breaker_enable {
        super::check_memory_circuit_breaker(&scan_stats)?;
    }

    // fetch all schema versions, get latest schema
    let schema_latest = match db::schema::get(&sql.org_id, &sql.stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("[session_id {session_id}] get schema error: {}", err);
            // release all files
            wal::release_files(&lock_files).await;
            tmpfs::delete(session_id, true).unwrap();
            return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                sql.stream_name.clone(),
            )));
        }
    };
    let schema_latest = Arc::new(
        schema_latest
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    // check schema version
    let files = tmpfs::list(&work_dir, FILE_EXT_JSON).unwrap_or_default();

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
            println!("File name is {}", &file.location);
            let schema_version = get_schema_version(&file.location)?;
            let entry = files_group.entry(schema_version).or_default();
            entry.push(FileKey::from_file_name(&file.location));
        }
    }

    let mut tasks = Vec::new();
    let single_group = files_group.len() == 1;
    for (ver, files) in files_group {
        // get schema of the file
        let file_data = tmpfs::get(&files.first().unwrap().key).unwrap();
        let mut schema_reader = BufReader::new(file_data.as_ref());
        let mut inferred_schema = match infer_json_schema(&mut schema_reader, None, stream_type) {
            Ok(schema) => schema,
            Err(err) => {
                // release all files
                wal::release_files(&lock_files).await;
                tmpfs::delete(session_id, true).unwrap();
                return Err(Error::from(err));
            }
        };
        filter_schema_null_fields(&mut inferred_schema);
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
        let session = if single_group {
            meta::search::Session {
                id: session_id.to_string(),
                storage_type: StorageType::Tmpfs,
                search_type: if !sql.meta.group_by.is_empty() {
                    SearchType::Aggregation
                } else {
                    SearchType::Normal
                },
            }
        } else {
            let id = format!("{session_id}-{ver}");
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
            "service:search:grpc:wal:datafusion",
            org_id = sql.org_id,
            stream_name = sql.stream_name,
            stream_type = ?stream_type
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
                    FileType::JSON,
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
                // release all files
                wal::release_files(&lock_files).await;
                tmpfs::delete(session_id, true).unwrap();
                return Err(super::handle_datafusion_error(err));
            }
        };
    }

    // release all files
    wal::release_files(&lock_files).await;
    // clear tmpfs
    tmpfs::delete(session_id, true).unwrap();

    Ok((results, scan_stats))
}

/// get file list from local wal, no need match_source, each file will be searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    sql: &Sql,
    stream_type: meta::StreamType,
    extension: &str,
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
    let pattern = if stream_type.eq(&meta::StreamType::Metrics) && extension == FILE_EXT_JSON {
        format!(
            "{}/files/{}/{stream_type}/{}/",
            wal_dir, &sql.org_id, &sql.org_id
        )
    } else {
        format!(
            "{}/files/{}/{stream_type}/{}/",
            wal_dir, &sql.org_id, &sql.stream_name
        )
    };
    let files = scan_files(&pattern);
    if files.is_empty() {
        return Ok(vec![]);
    }

    // lock theses files
    let files = if stream_type.eq(&meta::StreamType::Metrics) && extension == FILE_EXT_ARROW {
        let mut ret = vec![];
        for file in files {
            if file.as_str().ends_with(&extension) && !wal::should_exclude_file(&file).await {
                ret.push(
                    file.strip_prefix(&wal_dir)
                        .unwrap()
                        .to_string()
                        .replace('\\', "/")
                        .trim_start_matches('/')
                        .to_string(),
                );
            }
        }
        ret
    } else {
        files
            .iter()
            .filter(|f| f.as_str().ends_with(&extension))
            .map(|f| {
                f.strip_prefix(&wal_dir)
                    .unwrap()
                    .to_string()
                    .replace('\\', "/")
                    .trim_start_matches('/')
                    .to_string()
            })
            .collect::<Vec<_>>()
    };
    wal::lock_files(&files).await;

    let mut result = Vec::with_capacity(files.len());
    let time_range = sql.meta.time_range.unwrap_or((0, 0));
    for file in files.iter() {
        if time_range != (0, 0) {
            // check wal file created time, we can skip files which created time > end_time
            let source_file = wal_dir.to_string() + "/" + file.as_str();
            let file_meta = match get_file_meta(&source_file) {
                Ok(meta) => meta,
                Err(_) => {
                    log::error!(
                        "[session_id {session_id}] skip wal file: {} get file meta error",
                        file
                    );
                    wal::release_files(&[file.clone()]).await;
                    continue;
                }
            };
            let file_modified = file_meta
                .modified()
                .unwrap_or(UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros();
            let file_created = file_meta
                .created()
                .unwrap_or(UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros();
            let file_created = (file_created as i64)
                - chrono::Duration::hours(CONFIG.limit.ingest_allowed_upto)
                    .num_microseconds()
                    .unwrap_or_default();

            if (time_range.0 > 0 && (file_modified as i64) < time_range.0)
                || (time_range.1 > 0 && file_created > time_range.1)
            {
                log::info!(
                    "[session_id {session_id}] skip wal file: {} time_range: [{},{}]",
                    file,
                    file_created,
                    file_modified
                );
                wal::release_files(&[file.clone()]).await;
                continue;
            }
        }
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
    // eg: /a-b-c-d/files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/7099303408192061440f3XQ2p.json
    let column = file.split('/').collect::<Vec<&str>>();
    if column.len() < 12 {
        return Err(Error::Message(format!("invalid wal file name: {}", file)));
    }
    Ok(column[11].to_string())
}

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search_arrow:wal:enter", skip_all, fields(org_id = sql.org_id, stream_name = sql.stream_name))]
pub async fn search_arrow(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: meta::StreamType,
    timeout: u64,
) -> super::SearchResult {
    // get file list
    let mut files = get_file_list(session_id, &sql, stream_type, FILE_EXT_ARROW).await?;
    let mut scan_stats = ScanStats::new();
    let lock_files = files.iter().map(|f| f.key.clone()).collect::<Vec<_>>();

    // cache files
    let work_dir = session_id.to_string();
    for file in files.clone().iter() {
        let source_file = CONFIG.common.data_wal_dir.to_string() + file.key.as_str();
        match get_file_contents(&source_file) {
            Err(_) => {
                log::error!("skip wal file: {} get file content error", &file.key);
                files.retain(|x| x != file);
            }
            Ok(file_data) => {
                scan_stats.original_size += file_data.len() as i64;
                let file_name = format!("/{work_dir}/{}", file.key);
                tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            }
        }
    }

    // check wal memory mode
    if CONFIG.common.wal_memory_mode_enabled {
        let mem_files = wal::get_search_in_memory_files(&sql.org_id, &sql.stream_name, stream_type)
            .await
            .unwrap_or_default();
        for (file_key, file_data) in mem_files {
            scan_stats.original_size += file_data.len() as i64;
            let file_name = format!("/{work_dir}/{file_key}");
            tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            files.push(FileKey::from_file_name(&file_name));
        }
    }

    scan_stats.files = files.len() as i64;
    if scan_stats.files == 0 {
        return Ok((HashMap::new(), scan_stats));
    }
    log::info!(
        "wal->search: load files {}, scan_size {}",
        scan_stats.files,
        scan_stats.original_size
    );

    // fetch all schema versions, get latest schema
    let schema_latest = match db::schema::get(&sql.org_id, &sql.stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("get schema error: {}", err);
            // release all files
            wal::release_files(&lock_files).await;
            tmpfs::delete(session_id, true).unwrap();
            return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                sql.stream_name.clone(),
            )));
        }
    };
    let schema_latest = Arc::new(
        schema_latest
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    // check schema version
    let tmpfs_files = tmpfs::list(&work_dir, FILE_EXT_ARROW).unwrap_or_default();

    let mut files_group: HashMap<String, Vec<FileKey>> = HashMap::with_capacity(2);
    if !CONFIG.common.widening_schema_evolution {
        files_group.insert(
            "latest".to_string(),
            tmpfs_files
                .iter()
                .map(|f| FileKey::from_file_name(&f.location))
                .collect(),
        );
    } else {
        for file in tmpfs_files {
            let schema_version = get_schema_version(&file.location)?;
            let entry = files_group.entry(schema_version).or_default();
            entry.push(FileKey::from_file_name(&file.location));
        }
    }

    let mut tasks = Vec::new();
    for (_ver, local_files) in files_group {
        // get schema of the file
        let meta = std::collections::HashMap::new();
        let mut inferred_schema: Schema = Schema::empty();

        let mut record_batches = Vec::<RecordBatch>::new();
        for file in local_files.iter() {
            let file_data = match tmpfs::get(&file.key) {
                Ok(data) => data,
                Err(err) => {
                    log::error!("Error reading file {} from tmpfs: {:?}", file.key, err);
                    continue;
                }
            };
            let buf_reader = Cursor::new(file_data);
            let stream_reader = StreamReader::try_new(buf_reader, None)?;
            for read_result in stream_reader {
                let record_batch = read_result?;
                if record_batch.num_rows() > 0 {
                    if inferred_schema.fields().is_empty() {
                        inferred_schema = record_batch
                            .schema()
                            .as_ref()
                            .clone()
                            .with_metadata(meta.clone());
                    }
                    record_batches.push(record_batch);
                }
            }
        }

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
        let session = meta::search::Session {
            id: session_id.to_string(),
            storage_type: StorageType::Tmpfs,
            search_type: if !sql.meta.group_by.is_empty() {
                SearchType::Aggregation
            } else {
                SearchType::Normal
            },
        };
        let datafusion_span = info_span!(
            "service:search:grpc:wal:datafusion",
            org_id = sql.org_id,
            stream_name = sql.stream_name,
            stream_type = ?stream_type
        );

        let task = tokio::time::timeout(
            Duration::from_secs(timeout),
            async move {
                exec::sql(
                    &session,
                    schema,
                    &diff_fields,
                    &sql,
                    &local_files,
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
                // release all files
                wal::release_files(&lock_files).await;
                tmpfs::delete(session_id, true).unwrap();
                return Err(super::handle_datafusion_error(err));
            }
        };
    }

    // release all files
    wal::release_files(&lock_files).await;
    // clear tmpfs
    tmpfs::delete(session_id, true).unwrap();

    Ok((results, scan_stats))
}
