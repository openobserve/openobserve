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

use dashmap::DashMap;
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use once_cell::sync::Lazy;
use std::sync::Arc;

use crate::common::infra::{
    cache, cluster,
    config::{RwHashMap, CONFIG},
};
use crate::common::meta::common::FileMeta;

pub mod broadcast;
pub mod dynamo_db;
pub mod local;
pub mod remote;

pub static DELETED_FILES: Lazy<RwHashMap<String, FileMeta>> =
    Lazy::new(|| DashMap::with_capacity_and_hasher(64, Default::default()));

pub static BLOCKED_ORGS: Lazy<Vec<&str>> =
    Lazy::new(|| CONFIG.compact.blocked_orgs.split(',').collect());

pub async fn progress(
    key: &str,
    data: FileMeta,
    delete: bool,
    download: bool,
) -> Result<(), anyhow::Error> {
    let old_data = cache::file_list::get_file_from_cache(key);
    match delete {
        true => {
            let data = match old_data {
                Ok(meta) => meta,
                Err(_e) => {
                    return Ok(());
                }
            };
            match cache::file_list::del_file_from_cache(key) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: delete {}, set_file_to_cache error: {}",
                        key,
                        e
                    );
                }
            }
            if old_data.is_err() {
                return Ok(()); // not exists, skip decrease stats
            };
            match cache::stats::decr_stream_stats(key, data) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: delete {}, incr_stream_stats error: {}",
                        key,
                        e
                    );
                }
            }
        }
        false => {
            match cache::file_list::set_file_to_cache(key, data) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: add {}, set_file_to_cache error: {}",
                        key,
                        e
                    );
                }
            }
            if download
                && CONFIG.memory_cache.cache_latest_files
                && cluster::is_querier(&cluster::LOCAL_NODE_ROLE)
            {
                // maybe load already merged file, no need report error
                _ = cache::file_data::download(key).await;
            }
            if old_data.is_ok() {
                return Ok(()); // already exists, skip increase stats
            };
            match cache::stats::incr_stream_stats(key, data) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: add {}, incr_stream_stats error: {}",
                        key,
                        e
                    );
                }
            }
        }
    }

    Ok(())
}

pub fn get_sample_table_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("stream", DataType::Utf8, false), // org/stream_type/stram_name
        Field::new("date", DataType::Utf8, false),   // 2023/08/01/15
        Field::new("file", DataType::Utf8, false),   // 7068342949293207552.parquet
        Field::new("min_ts", DataType::Int64, false),
        Field::new("max_ts", DataType::Int64, false),
        Field::new("records", DataType::UInt64, false),
        Field::new("original_size", DataType::UInt64, false),
        Field::new("compressed_size", DataType::UInt64, false),
        Field::new("deleted", DataType::Boolean, false),
    ]))
}
