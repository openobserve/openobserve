// Copyright 2023 Zinc Labs Inc.
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

use dashmap::{DashMap, DashSet};
use once_cell::sync::Lazy;

use crate::common::{
    infra::{
        cache, cluster,
        config::{RwHashMap, RwHashSet, CONFIG},
        file_list,
    },
    meta::common::FileMeta,
};

pub mod broadcast;
pub mod local;
pub mod remote;

pub static DEPULICATE_FILES: Lazy<RwHashSet<String>> =
    Lazy::new(|| DashSet::with_capacity_and_hasher(1024, Default::default()));

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
    if delete {
        if let Err(e) = file_list::remove(key).await {
            log::error!(
                "service:db:file_list: delete {}, set_file_to_cache error: {}",
                key,
                e
            );
        }
    } else {
        if let Err(e) = file_list::add(key, &data).await {
            log::error!(
                "service:db:file_list: add {}, set_file_to_cache error: {}",
                key,
                e
            );
        }
        if download
            && CONFIG.memory_cache.cache_latest_files
            && cluster::is_querier(&cluster::LOCAL_NODE_ROLE)
        {
            // maybe load already merged file, no need report error
            _ = cache::file_data::memory::download(key).await;
        }
    }

    Ok(())
}
