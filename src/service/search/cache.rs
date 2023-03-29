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
use datafusion::datasource::file_format::file_type::FileType;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tracing::info_span;

use super::datafusion::storage::file_list::SessionType;
use super::sql::Sql;
use crate::common::file::scan_files;
use crate::infra::config::{self, CONFIG};
use crate::infra::errors::{Error, ErrorCodes};
use crate::meta;
use crate::service::db;
use crate::service::file_list::calculate_local_files_size;

/// search in local cache, which haven't been sync to object storage
#[tracing::instrument(
    name = "service:search:cache:enter",
    skip(session_id, sql, stream_type)
)]
pub async fn search(
    session_id: &str,
    sql: Arc<Sql>,
    stream_type: meta::StreamType,
) -> super::SearchResult {
    let span1 = info_span!("service:search:cache:get_file_list");
    let guard1 = span1.enter();

    // mark searching in cache
    let searching = Searching::new();

    // get file list
    let files = get_file_list(&sql, stream_type).await?;
    let file_count = files.len();
    drop(guard1);

    if file_count == 0 {
        return Ok((HashMap::new(), 0, 0));
    }

    let span2 = info_span!("service:search:cache:calculate_files_size");
    let guard2 = span2.enter();
    let scan_size = match calculate_local_files_size(&files).await {
        Ok(size) => size,
        Err(err) => {
            log::error!("calculate files size error: {}", err);
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                "calculate files size error".to_string(),
            )));
        }
    };
    log::info!(
        "[TRACE] cache->search: load files {}, scan_size {}",
        file_count,
        scan_size
    );

    drop(guard2);
    let span3 = info_span!("service:search:cache:datafusion");
    let _guard3 = span3.enter();

    // fetch all schema versions, get latest schema
    let schema = match db::schema::get(&sql.org_id, &sql.stream_name, Some(stream_type)).await {
        Ok(schema) => schema,
        Err(err) => {
            log::error!("get schema error: {}", err);
            return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                sql.stream_name.clone(),
            )));
        }
    };
    let schema = Arc::new(
        schema
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );

    let session = meta::search::Session {
        id: session_id.to_string(),
        data_type: SessionType::Cache,
    };
    let result = match super::datafusion::exec::sql(
        &session,
        stream_type,
        Some(schema),
        HashMap::new(),
        &sql,
        &files,
        FileType::JSON,
    )
    .await
    {
        Ok(res) => res,
        Err(err) => {
            log::error!("datafusion execute error: {}", err);
            return Err(super::handle_datafusion_error(err));
        }
    };

    // searching done.
    drop(searching);

    Ok((result, file_count, scan_size as usize))
}

/// get file list from local cache, no need match_source, each file will be searched
#[inline]
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
    for file in files {
        let file = Path::new(&file).canonicalize().unwrap();
        let file = file.strip_prefix(&data_dir).unwrap();
        let local_file = file.to_str().unwrap();
        let file_path = file.parent().unwrap().to_str().unwrap().replace('\\', "/");
        let file_name = file.file_name().unwrap().to_str().unwrap();
        let file_name = file_name.replace('_', "/");
        let source_file = format!("{file_path}/{file_name}");
        if sql.match_source(&source_file, false, stream_type).await {
            result.push(format!("{}{local_file}", &CONFIG.common.data_wal_dir));
        }
    }
    Ok(result)
}

/// Searching for marking searching in cache
struct Searching;

impl Searching {
    pub fn new() -> Self {
        config::SEARCHING_IN_CACHE.store(1, Ordering::Relaxed);
        Searching
    }
}

impl Drop for Searching {
    fn drop(&mut self) {
        config::SEARCHING_IN_CACHE.store(0, Ordering::Relaxed);
    }
}
