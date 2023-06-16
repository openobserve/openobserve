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
use std::{path::Path, sync::Arc, time::UNIX_EPOCH};

use crate::common::file::{get_file_contents, get_file_meta, scan_files};
use crate::infra::{
    cache::tmpfs,
    config::CONFIG,
    errors::{Error, ErrorCodes},
    ider, wal,
};
use crate::meta;
use crate::service::{
    db,
    search::{datafusion::storage::StorageType, sql::Sql},
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
    let mut scan_size = 0;

    // cache files
    let work_dir = session_id.to_string();
    for file in files.clone().iter() {
        match get_file_contents(file) {
            Err(_) => {
                files.retain(|x| x != file);
            }
            Ok(file_data) => {
                scan_size += file_data.len();
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
            scan_size += file_data.len();
            let file_name = format!("/{work_dir}/{}.json", ider::generate());
            tmpfs::set(&file_name, file_data.into()).expect("tmpfs set success");
            files.push(file_name);
        }
    }

    let file_count = files.len();
    if file_count == 0 {
        return Ok((HashMap::new(), 0, 0));
    }
    log::info!("wal->search: load files {file_count}, scan_size {scan_size}");

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
        storage_type: StorageType::Tmpfs,
    };
    let result = match super::datafusion::exec::sql(
        &session,
        schema,
        &HashMap::new(),
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

    // clear tmpfs
    tmpfs::delete(&format!("/{}/", session_id), true).unwrap();

    Ok((result, file_count, scan_size))
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
