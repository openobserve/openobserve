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

use config::{
    meta::stream::FileListDeleted,
    utils::inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
};
use infra::{file_list as infra_file_list, storage};

pub async fn delete(
    org_id: &str,
    _time_min: i64,
    time_max: i64,
    batch_size: i64,
) -> Result<i64, anyhow::Error> {
    let files = query_deleted(org_id, time_max, batch_size).await?;
    if files.is_empty() {
        return Ok(0);
    }
    let files_num = files.len() as i64;

    // delete files from storage
    let local_mode = config::get_config().common.local_mode;
    if let Err(e) = storage::del(
        files
            .iter()
            .filter_map(|file| {
                if !ingester::is_wal_file(local_mode, &file.file) {
                    Some((file.account.as_str(), file.file.as_str()))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>(),
    )
    .await
    {
        // maybe the file already deleted, so we just skip the `not found` error
        if !e.to_string().to_lowercase().contains("not found") {
            log::error!("[COMPACTOR] delete files from storage failed: {}", e);
            return Err(e.into());
        }
    }

    // delete related inverted index puffin files
    let inverted_index_files = files
        .iter()
        .filter_map(|file| {
            if file.index_file {
                convert_parquet_idx_file_name_to_tantivy_file(&file.file)
                    .map(|f| (file.account.to_string(), f))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if !inverted_index_files.is_empty() {
        if let Err(e) = storage::del(
            inverted_index_files
                .iter()
                .map(|file| (file.0.as_str(), file.1.as_str()))
                .collect::<Vec<_>>(),
        )
        .await
        {
            // maybe the file already deleted or there's not related index files,
            // so we just skip the `not found` error
            if !e.to_string().to_lowercase().contains("not found") {
                log::error!("[COMPACTOR] delete files from storage failed: {}", e);
                return Err(e.into());
            }
        }
    }

    // delete flattened files from storage
    let flattened_files = files
        .iter()
        .filter_map(|file| {
            if file.flattened {
                Some((
                    file.account.to_string(),
                    format!(
                        "files{}/{}",
                        config::get_config().common.column_all,
                        file.file.strip_prefix("files/").unwrap()
                    ),
                ))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if !flattened_files.is_empty() {
        if let Err(e) = storage::del(
            flattened_files
                .iter()
                .map(|file| (file.0.as_str(), file.1.as_str()))
                .collect::<Vec<_>>(),
        )
        .await
        {
            // maybe the file already deleted, so we just skip the `not found` error
            if !e.to_string().to_lowercase().contains("not found") {
                log::error!("[COMPACTOR] delete files from storage failed: {}", e);
                return Err(e.into());
            }
        }
    }

    // delete files from file_list_deleted table
    if let Err(e) = infra_file_list::batch_remove_deleted(
        &files
            .iter()
            .map(|file| file.file.to_owned())
            .collect::<Vec<_>>(),
    )
    .await
    {
        log::error!("[COMPACTOR] delete files from table failed: {}", e);
        return Err(e.into());
    }

    Ok(files_num)
}

async fn query_deleted(
    org_id: &str,
    time_max: i64,
    limit: i64,
) -> Result<Vec<FileListDeleted>, anyhow::Error> {
    infra_file_list::query_deleted(org_id, time_max, limit)
        .await
        .map_err(|e| e.into())
}
