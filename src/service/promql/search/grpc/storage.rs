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

use datafusion::{
    arrow::datatypes::Schema,
    datasource::file_format::file_type::FileType,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use std::sync::Arc;
use tokio::sync::Semaphore;

use crate::infra::{cache::file_data, config::CONFIG};
use crate::meta::{search::Session as SearchSession, stream::StreamParams, StreamType};
use crate::service::{
    db, file_list,
    search::{
        datafusion::{exec::register_table, storage::StorageType},
        match_source,
    },
};

#[tracing::instrument(name = "promql:search:grpc:storage:create_context", skip_all)]
pub(crate) async fn create_context(
    session_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(&str, &str)],
) -> Result<(SessionContext, Arc<Schema>)> {
    // get file list
    let files = get_file_list(org_id, stream_name, time_range, filters).await?;
    let file_count = files.len();
    if files.is_empty() {
        return Ok((SessionContext::new(), Arc::new(Schema::empty())));
    }

    // calcuate scan size
    let (scan_original_size, scan_compressed_size) =
        match file_list::calculate_files_size(&files.to_vec()).await {
            Ok(size) => size,
            Err(err) => {
                log::error!("calculate files size error: {}", err);
                return Err(datafusion::error::DataFusionError::Execution(
                    "calculate files size error".to_string(),
                ));
            }
        };
    log::info!(
        "promql->search->storage: load files {}, scan_size {}, compressed_size {}",
        file_count,
        scan_original_size,
        scan_compressed_size
    );

    // if scan_compressed_size > 80% of total memory cache, skip memory cache
    let storage_type = if !CONFIG.memory_cache.enabled
        || scan_compressed_size > CONFIG.memory_cache.skip_size as u64
    {
        StorageType::FsNoCache
    } else {
        StorageType::FsMemory
    };

    // load files to local cache
    if storage_type == StorageType::FsMemory {
        cache_parquet_files(&files).await?;
        log::info!(
            "promql->search->storage: load files {}, into memory cache done",
            file_count
        );
    }

    // fetch all schema versions, get latest schema
    let stream_type = StreamType::Metrics;
    let schema = match db::schema::get(org_id, stream_name, Some(stream_type)).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("get schema error: {}", err);
            return Err(datafusion::error::DataFusionError::Execution(
                err.to_string(),
            ));
        }
    };
    let schema = Arc::new(
        schema
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    let session = SearchSession {
        id: session_id.to_string(),
        storage_type,
    };

    register_table(
        &session,
        StreamParams {
            org_id,
            stream_name,
            stream_type,
        },
        Some(schema),
        stream_name,
        &files,
        FileType::PARQUET,
    )
    .await
}

#[tracing::instrument(name = "promql:search:grpc:storage:get_file_list", skip_all)]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(&str, &str)],
) -> Result<Vec<String>> {
    let (time_min, time_max) = time_range;
    let results = match file_list::get_file_list(
        org_id,
        stream_name,
        Some(StreamType::Metrics),
        time_min,
        time_max,
    )
    .await
    {
        Ok(results) => results,
        Err(err) => {
            log::error!("get file list error: {}", err);
            return Err(DataFusionError::Execution(
                "get file list error".to_string(),
            ));
        }
    };

    let mut files = Vec::new();
    for file in results {
        if match_source(
            StreamParams {
                org_id,
                stream_name,
                stream_type: StreamType::Metrics,
            },
            Some(time_range),
            filters,
            &file,
            false,
            false,
        )
        .await
        {
            files.push(file.clone());
        }
    }
    Ok(files)
}

#[tracing::instrument(name = "promql:search:grpc:storage:cache_parquet_files", skip_all)]
async fn cache_parquet_files(files: &[String]) -> Result<()> {
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let file = file.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Result<(), anyhow::Error>> =
            tokio::task::spawn(async move {
                if !file_data::exist(&file).unwrap_or_default() {
                    if let Err(e) = file_data::download(&file).await {
                        log::error!("promql->search->storage: load file {}, err: {}", &file, e);
                    }
                };
                drop(permit);
                Ok(())
            });
        tasks.push(task);
    }

    for task in tasks {
        match task.await {
            Ok(ret) => {
                if let Err(err) = ret {
                    return Err(DataFusionError::Execution(err.to_string()));
                }
            }
            Err(err) => {
                return Err(DataFusionError::Execution(err.to_string()));
            }
        };
    }

    Ok(())
}
