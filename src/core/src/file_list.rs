// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Compatibility facade for file-list operations that now live below core.

use config::utils::file::get_file_meta;
use infra::errors::Result;
pub use infra::file_list::delete_parquet_file;
pub use search_service::file_list::{query, query_for_merge};

pub fn calculate_local_files_size(files: &[String]) -> Result<u64> {
    Ok(files
        .iter()
        .map(|file| {
            get_file_meta(file)
                .map(|meta| meta.len())
                .unwrap_or_default()
        })
        .sum())
}

pub async fn update_compressed_size(key: &str, size: i64) -> Result<()> {
    infra::file_list::update_compressed_size(key, size).await?;
    infra::file_list::LOCAL_CACHE
        .update_compressed_size(key, size)
        .await
}
