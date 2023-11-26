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
    data: Option<&FileMeta>,
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
        if let Err(e) = file_list::add(key, data.unwrap()).await {
            log::error!(
                "service:db:file_list: add {}, set_file_to_cache error: {}",
                key,
                e
            );
        }
        // update stream stats realtime
        if CONFIG.common.local_mode {
            if let Err(e) = cache::stats::incr_stream_stats(key, data.unwrap()) {
                log::error!(
                    "service:db:file_list: add {}, incr_stream_stats error: {}",
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
            _ = cache::file_data::memory::download("", key).await;
        }
    }

    Ok(())
}
