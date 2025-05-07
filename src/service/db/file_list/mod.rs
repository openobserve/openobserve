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

use std::collections::HashSet;

use config::{
    RwHashMap, RwHashSet,
    meta::stream::{FileKey, FileMeta},
};
use dashmap::{DashMap, DashSet};
use infra::errors::Result;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::infra::config::get_config as get_o2_config,
    super_cluster::stream::client::super_cluster_cache_stats,
};
use once_cell::sync::Lazy;
pub mod broadcast;
pub mod local;

pub static DEPULICATE_FILES: Lazy<RwHashSet<String>> =
    Lazy::new(|| DashSet::with_capacity_and_hasher(1024, Default::default()));

pub static DELETED_FILES: Lazy<RwHashMap<String, FileMeta>> =
    Lazy::new(|| DashMap::with_capacity_and_hasher(64, Default::default()));

pub static BLOCKED_ORGS: Lazy<HashSet<String>> = Lazy::new(|| {
    config::get_config()
        .compact
        .blocked_orgs
        .split(',')
        .map(|x| x.to_string())
        .collect()
});

pub async fn set(account: &str, key: &str, meta: Option<FileMeta>, deleted: bool) -> Result<()> {
    let file_data = FileKey::new(
        account.to_string(),
        key.to_string(),
        meta.clone().unwrap_or_default(),
        deleted,
    );

    // write into file_list storage
    // retry 5 times
    for _ in 0..5 {
        if let Err(e) = progress(account, key, meta.as_ref(), deleted).await {
            log::error!("[FILE_LIST] Error saving file to storage, retrying: {}", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        } else {
            break;
        }
    }

    let cfg = config::get_config();

    // notify other nodes
    if cfg.cache_latest_files.enabled {
        let mut q = broadcast::BROADCAST_QUEUE.write().await;
        q.push(file_data);
    }

    Ok(())
}

async fn progress(account: &str, key: &str, data: Option<&FileMeta>, delete: bool) -> Result<()> {
    if delete {
        if let Err(e) = infra::file_list::remove(key).await {
            log::error!(
                "service:db:file_list: delete {}, set_file_to_cache error: {}",
                key,
                e
            );
        }
    } else {
        if let Err(e) = infra::file_list::add(account, key, data.unwrap()).await {
            log::error!(
                "service:db:file_list: add {}, set_file_to_cache error: {}",
                key,
                e
            );
        }
        // update stream stats realtime
        if config::get_config().common.local_mode {
            if let Err(e) = infra::cache::stats::incr_stream_stats(key, data.unwrap()) {
                log::error!(
                    "service:db:file_list: add {}, incr_stream_stats error: {}",
                    key,
                    e
                );
            }
        }
    }

    Ok(())
}

pub async fn cache_stats() -> Result<()> {
    // super cluster
    #[cfg(feature = "enterprise")]
    {
        if get_o2_config().super_cluster.enabled {
            if let Err(err) = super_cluster_cache_stats().await {
                log::error!("super_cluster_cache_stats error: {err}")
            }
        } else {
            // single cluster
            if let Err(err) = single_cache_stats().await {
                log::error!("single_cache_stats error: {err}")
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        // single cluster
        if let Err(err) = single_cache_stats().await {
            log::error!("single_cache_stats error: {err}")
        }
    }

    Ok(())
}
async fn single_cache_stats() -> Result<()> {
    let orgs = crate::service::db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        let ret = infra::file_list::get_stream_stats(&org_id, None, None).await;
        if ret.is_err() {
            log::error!("Load stream stats from db  error: {}", ret.err().unwrap());
            continue;
        }

        for (stream, stats) in ret.unwrap() {
            let columns = stream.split('/').collect::<Vec<&str>>();
            let org_id = columns[0];
            let stream_type = columns[1];
            let stream_name = columns[2];
            infra::cache::stats::set_stream_stats(org_id, stream_name, stream_type.into(), stats);
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    Ok(())
}
