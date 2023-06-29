// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap as HashMap;
use datafusion::{
    arrow::{datatypes::Schema, json::reader::infer_json_schema, record_batch::RecordBatch},
    datasource::file_format::file_type::FileType,
};
use std::{io::BufReader, path::Path, sync::Arc, time::UNIX_EPOCH};
use tracing::{info_span, Instrument};

use crate::common::file::{get_file_contents, get_file_meta, scan_files};
use crate::infra::{
    cache::tmpfs,
    config::CONFIG,
    errors::{Error, ErrorCodes},
    ider, wal,
};
use crate::meta::{self, stream::ScanStats};
use crate::service::{
    db,
    search::{
        datafusion::{exec, storage::StorageType},
        sql::Sql,
    },
};

/// search in local WAL, which haven't been sync to object storage
#[tracing::instrument(name = "service:search:wal:enter", skip_all)]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: meta::StreamType,
) -> super::SearchResult {
    // get file list
    let mut files = get_file_list(&sql, stream_type).await?;
    let mut scan_stats = ScanStats::new();

    // cache files
    let work_dir = session_id.to_string();
    for file in files.clone().iter() {
        match get_file_contents(file) {
            Err(_) => {
                files.retain(|x| x != file);
            }
            Ok(file_data) => {
                scan_stats.original_size += file_data.len() as u64;
                let file_name =
                    format!("/{work_dir}/{}", file.split('/').last().unwrap_or_default());
                tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            }
        }
    }

    // check wal memory mode
    if CONFIG.common.wal_memory_mode_enabled {
        let mem_files = wal::get_search_in_memory_files(&sql.org_id, &sql.stream_name, stream_type)
            .unwrap_or_default();
        for file_data in mem_files {
            scan_stats.original_size += file_data.len() as u64;
            let file_name = format!("/{work_dir}/{}.json", ider::generate());
            tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            files.push(file_name);
        }
    }

    scan_stats.files = files.len() as u64;
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
    let files = tmpfs::list(&work_dir).unwrap_or_default();
    let mut files_group: HashMap<String, Vec<String>> = HashMap::with_capacity(2);
    if !CONFIG.common.widening_schema_evolution {
        files_group.insert(
            "latest".to_string(),
            files.iter().map(|x| x.location.to_string()).collect(),
        );
    } else {
        for file in files {
            let schema_version = get_schema_version(&file.location)?;
            let entry = files_group.entry(schema_version).or_insert_with(Vec::new);
            entry.push(file.location);
        }
    }

    let mut tasks = Vec::new();
    let single_group = files_group.len() == 1;
    for (ver, files) in files_group {
        // get schema of the file
        let file_data = tmpfs::get(files.first().unwrap()).unwrap();
        let mut schema_reader = BufReader::new(file_data.as_ref());
        let mut inferred_schema = match infer_json_schema(&mut schema_reader, None) {
            Ok(schema) => schema,
            Err(err) => {
                return Err(Error::from(err));
            }
        };
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
        let session = if single_group {
            meta::search::Session {
                id: session_id.to_string(),
                storage_type: StorageType::Tmpfs,
            }
        } else {
            let id = format!("{session_id}-{ver}");
            // move data to group tmpfs
            for file in files.iter() {
                let file_data = tmpfs::get(file).unwrap();
                let file_name = format!(
                    "/{}/{}",
                    id,
                    file.strip_prefix(&format!("/{}/", work_dir)).unwrap()
                );
                tmpfs::set(&file_name, file_data).expect("tmpfs set success");
            }
            meta::search::Session {
                id,
                storage_type: StorageType::Tmpfs,
            }
        };
        let datafusion_span = info_span!("service:search:grpc:wal:datafusion");
        let task =
            tokio::task::spawn(
                async move {
                    exec::sql(&session, schema, &diff_fields, &sql, &files, FileType::JSON).await
                }
                .instrument(datafusion_span),
            );
        tasks.push(task);
    }

    let mut results: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    for task in tasks {
        match task.await {
            Ok(ret) => match ret {
                Ok(ret) => {
                    for (k, v) in ret {
                        let group = results.entry(k).or_insert_with(Vec::new);
                        group.extend(v);
                    }
                }
                Err(err) => {
                    log::error!("datafusion execute error: {}", err);
                    return Err(super::handle_datafusion_error(err));
                }
            },
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
    }

    // clear tmpfs
    tmpfs::delete(session_id, true).unwrap();

    Ok((results, scan_stats))
}

/// get file list from local wal, no need match_source, each file will be searched
#[tracing::instrument(name = "service:search:grpc:wal:get_file_list", skip_all)]
async fn get_file_list(sql: &Sql, stream_type: meta::StreamType) -> Result<Vec<String>, Error> {
    let pattern = format!(
        "{}/files/{}/{stream_type}/{}/*.json",
        &CONFIG.common.data_wal_dir, &sql.org_id, &sql.stream_name
    );
    let files = scan_files(&pattern);

    let mut result = Vec::new();
    let data_dir = match Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
        Ok(path) => path,
        Err(_) => {
            return Ok(result);
        }
    };
    let time_range = sql.meta.time_range.unwrap_or((0, 0));
    for file in files {
        if time_range != (0, 0) {
            // check wal file created time, we can skip files which created time > end_time
            let file_meta = get_file_meta(&file).map_err(Error::from)?;
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
                    "skip wal file: {} time_range: [{},{}]",
                    file,
                    file_created,
                    file_modified
                );
                continue;
            }
        }
        let file = Path::new(&file).canonicalize().unwrap();
        let file = file.strip_prefix(&data_dir).unwrap();
        let local_file = file.to_str().unwrap();
        let file_path = file.parent().unwrap().to_str().unwrap().replace('\\', "/");
        let file_name = file.file_name().unwrap().to_str().unwrap();
        let file_name = file_name.replace('_', "/");
        let source_file = format!("{file_path}/{file_name}");
        if sql
            .match_source(&source_file, false, true, stream_type)
            .await
        {
            result.push(format!("{}{local_file}", &CONFIG.common.data_wal_dir).replace('\\', "/"));
        }
    }
    Ok(result)
}

fn get_schema_version(file: &str) -> Result<String, Error> {
    // eg: 0_2023_06_23_04_12e2211ba6a46272_level=INFO_7077863742821761024s2sgQB.json
    let column = file.split('_').collect::<Vec<&str>>();
    if column.len() < 7 {
        return Err(Error::Message("invalid wal file name".to_string()));
    }
    Ok(column[5].to_string())
}
