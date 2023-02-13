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
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::datasource::file_format::file_type::FileType;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::{info_span, Instrument};

use super::datafusion::storage::file_list::SessionType;
use super::sql::Sql;
use crate::infra::cache::file_data;
use crate::infra::config::CONFIG;
use crate::meta;
use crate::service::{db, file_list};

/// search in remote object storage
#[tracing::instrument(
    name = "service:search:storage:enter",
    skip(session_id, sql, file_list, stream_type)
)]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    file_list: &[String],
    stream_type: meta::StreamType,
) -> super::SearchResult {
    let span1 = info_span!("service:search:storage:get_file_list");
    let guard1 = span1.enter();

    // get file list
    let files = match file_list.is_empty() {
        true => get_file_list(&sql, stream_type).await?,
        false => file_list.to_vec(),
    };
    let file_count = files.len();
    drop(guard1);

    if file_count == 0 {
        return Ok((HashMap::new(), 0, 0));
    }

    // load files to local cache
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let span = info_span!("service:search:storage:load_files");
        let file = file.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Result<(), anyhow::Error>> = tokio::task::spawn(
            async move {
                if !file_data::exist(&file).unwrap_or_default() {
                    if let Err(e) = file_data::download(&file).await {
                        log::error!("storage->search: load file {}, err: {}", &file, e);
                    }
                };
                drop(permit);
                Ok(())
            }
            .instrument(span),
        );
        tasks.push(task);
    }

    for task in tasks {
        match task.await {
            Ok(ret) => {
                if let Err(e) = ret {
                    return Err(anyhow::anyhow!(e));
                }
            }
            Err(e) => {
                return Err(anyhow::anyhow!(e));
            }
        };
    }
    log::info!("[TRACE] storage->search: load files {} done", file_count);

    let span3 = info_span!("service:search:storage:group_and_calc_files_size");
    let guard3 = span3.enter();

    // fetch all schema versions, group files by version
    let schema_versions =
        db::schema::get_versions(&sql.org_id, &sql.stream_name, Some(stream_type)).await?;
    let schema_latest = schema_versions.last().unwrap();
    let schema_latest_id = schema_versions.len() - 1;
    let mut files_group: HashMap<usize, Vec<String>> =
        HashMap::with_capacity(schema_versions.len());
    let mut scan_size = 0;
    if !CONFIG.common.widening_schema_evoluation || schema_versions.len() == 1 {
        scan_size = file_list::calculate_files_size(&files.to_vec()).await?;
        files_group.insert(schema_latest_id, files);
    } else {
        for file in files {
            let file_meta = file_list::get_file_meta(&file).await.unwrap_or_default();
            // calculate scan size
            scan_size += file_meta.original_size;
            // check schema version
            let schema_ver_id = match db::schema::filter_schema_version_id(
                &schema_versions,
                file_meta.min_ts,
                file_meta.max_ts,
            ) {
                Some(id) => id,
                None => {
                    log::error!(
                        "storage->search: file {} schema version not found, will use the latest schema, min_ts: {}, max_ts: {}",
                        &file,
                        file_meta.min_ts,
                        file_meta.max_ts
                    );
                    // HACK: use the latest verion if not found in schema versions
                    schema_latest_id
                }
            };
            let group = files_group.entry(schema_ver_id).or_insert_with(Vec::new);
            group.push(file);
        }
    }

    log::info!(
        "[TRACE] storage->search: load files {}, scan_size {}",
        file_count,
        scan_size
    );
    drop(guard3);

    let mut tasks = Vec::new();
    for (ver, files) in files_group {
        let span = info_span!("service:search:storage:datafusion");
        let schema = Arc::new(
            schema_versions[ver]
                .clone()
                .with_metadata(std::collections::HashMap::new()),
        );
        let sql = sql.clone();
        let session = meta::search::Session {
            id: format!("{}-{}", session_id, ver),
            data_type: SessionType::Remote,
        };
        // cacluate the diff between latest schema and group schema
        let mut diff_fields = HashMap::new();
        if CONFIG.common.widening_schema_evoluation && ver != schema_latest_id {
            let group_fields = schema.fields();
            for field in group_fields {
                if let Ok(v) = schema_latest.field_with_name(field.name()) {
                    if v.data_type() != field.data_type() {
                        diff_fields.insert(v.name().clone(), v.data_type().clone());
                    }
                }
            }
        }
        let task = tokio::task::spawn(
            async move {
                super::datafusion::exec::sql(
                    &session,
                    stream_type,
                    Some(schema),
                    diff_fields,
                    &sql,
                    &files,
                    FileType::PARQUET,
                )
                .await
            }
            .instrument(span),
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
                Err(e) => {
                    return Err(anyhow::anyhow!(e));
                }
            },
            Err(e) => {
                return Err(anyhow::anyhow!(e));
            }
        };
    }

    Ok((results, file_count, scan_size as usize))
}

#[inline]
async fn get_file_list(
    sql: &Sql,
    stream_type: meta::StreamType,
) -> Result<Vec<String>, anyhow::Error> {
    let (time_min, time_max) = sql.meta.time_range.unwrap();
    let results = file_list::get_file_list(
        &sql.org_id,
        &sql.stream_name,
        Some(stream_type),
        time_min,
        time_max,
    )
    .await?;

    let mut files = Vec::new();
    for file in results {
        if sql.match_source(&file, false, stream_type).await {
            files.push(file.clone());
        }
    }
    Ok(files)
}
