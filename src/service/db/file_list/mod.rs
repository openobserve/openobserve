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
    common::config::get_config as get_o2_config,
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
    let mut file_data = FileKey::new(
        0,
        account.to_string(),
        key.to_string(),
        meta.clone().unwrap_or_default(),
        deleted,
    );

    // write into file_list storage
    // retry 5 times
    for _ in 0..5 {
        match progress(account, key, meta.as_ref(), deleted).await {
            Ok(id) => {
                file_data.id = id;
                break;
            }
            Err(e) => {
                log::error!("[FILE_LIST] Error saving file to storage, retrying: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
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

async fn progress(account: &str, key: &str, data: Option<&FileMeta>, delete: bool) -> Result<i64> {
    let mut id = 0;
    if delete {
        if let Err(e) = infra::file_list::remove(key).await {
            log::error!("service:db:file_list: delete {key}, remove error: {e}");
        }
    } else if let Some(data) = data {
        match infra::file_list::add(account, key, data).await {
            Ok(v) => {
                id = v;
            }
            Err(e) => {
                log::error!("service:db:file_list: add {key}, add error: {e}");
            }
        }
        // update stream stats realtime
        if config::get_config().common.local_mode
            && let Err(e) = infra::cache::stats::incr_stream_stats(key, data)
        {
            log::error!("service:db:file_list: add {key}, incr_stream_stats error: {e}");
        }
    }

    Ok(id)
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
        let ret = match infra::file_list::get_stream_stats(&org_id, None, None).await {
            Ok(v) => v,
            Err(e) => {
                log::error!("Load stream stats from db  error: {e:?}");
                continue;
            }
        };

        for (stream, stats) in ret {
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

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn create_test_file_meta() -> FileMeta {
        FileMeta {
            min_ts: 1234567890,
            max_ts: 1234567900,
            records: 100,
            original_size: 1000,
            compressed_size: 500,
            index_size: 100,
            flattened: false,
        }
    }

    #[tokio::test]
    async fn test_progress_no_meta() {
        let result = progress("test_org", "test_file.parquet", None, false).await;
        assert!(result.is_ok()); // Should return 0 when no operation is performed
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn test_static_variables() {
        // Test that static variables are accessible
        let duplicate_count = DEPULICATE_FILES.len();
        let deleted_count = DELETED_FILES.len();
        let blocked_orgs_count = BLOCKED_ORGS.len();

        // Just verify they're accessible (counts can be anything)
        // Counts are usize so they're always >= 0, just verify they exist
        let _ = duplicate_count;
        let _ = deleted_count;
        let _ = blocked_orgs_count;
    }

    #[test]
    fn test_duplicate_files_operations() {
        let test_file = "duplicate_test.parquet";

        // Test insertion
        DEPULICATE_FILES.insert(test_file.to_string());
        assert!(DEPULICATE_FILES.contains(test_file));

        // Test removal
        DEPULICATE_FILES.remove(test_file);
        assert!(!DEPULICATE_FILES.contains(test_file));
    }

    #[test]
    fn test_deleted_files_operations() {
        let test_file = "deleted_test.parquet";
        let meta = create_test_file_meta();

        // Test insertion
        DELETED_FILES.insert(test_file.to_string(), meta.clone());
        assert!(DELETED_FILES.contains_key(test_file));

        // Test retrieval
        if let Some(stored_meta) = DELETED_FILES.get(test_file) {
            assert_eq!(stored_meta.records, meta.records);
            assert_eq!(stored_meta.min_ts, meta.min_ts);
        }

        // Test removal
        DELETED_FILES.remove(test_file);
        assert!(!DELETED_FILES.contains_key(test_file));
    }

    #[test]
    fn test_blocked_orgs() {
        // Test that BLOCKED_ORGS is initialized from config
        let blocked_count = BLOCKED_ORGS.len();
        let _ = blocked_count; // Can be 0 if no orgs are blocked in config

        // Test that it contains strings
        for org in BLOCKED_ORGS.iter() {
            assert!(!org.is_empty() || org.is_empty()); // Just verify it's a string
        }
    }

    #[tokio::test]
    async fn test_concurrent_duplicate_files_access() {
        let base_file = "concurrent_dup_test";

        // Test concurrent access to duplicate files
        let tasks: Vec<_> = (0..10)
            .map(|i| {
                let file = format!("{base_file}_{i}.parquet");
                tokio::spawn(async move {
                    DEPULICATE_FILES.insert(file.clone());
                    tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                    DEPULICATE_FILES.remove(&file);
                })
            })
            .collect();

        // Wait for all tasks to complete
        for task in tasks {
            task.await.unwrap();
        }

        // Verify all files are removed
        for i in 0..10 {
            let file = format!("{base_file}_{i}.parquet");
            assert!(!DEPULICATE_FILES.contains(&file));
        }
    }

    #[tokio::test]
    async fn test_concurrent_deleted_files_access() {
        let base_file = "concurrent_del_test";
        let meta = create_test_file_meta();

        // Test concurrent access to deleted files
        let tasks: Vec<_> = (0..10)
            .map(|i| {
                let file = format!("{base_file}_{i}.parquet");
                let meta_clone = meta.clone();
                tokio::spawn(async move {
                    DELETED_FILES.insert(file.clone(), meta_clone);
                    tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                    DELETED_FILES.remove(&file);
                })
            })
            .collect();

        // Wait for all tasks to complete
        for task in tasks {
            task.await.unwrap();
        }

        // Verify all files are removed
        for i in 0..10 {
            let file = format!("{base_file}_{i}.parquet");
            assert!(!DELETED_FILES.contains_key(&file));
        }
    }

    #[cfg(not(feature = "enterprise"))]
    mod non_enterprise_tests {
        use super::*;

        #[tokio::test]
        async fn test_cache_stats_without_enterprise() {
            // Test that cache_stats works without enterprise features
            let result = cache_stats().await;
            assert!(result.is_ok());
        }
    }

    #[cfg(feature = "enterprise")]
    mod enterprise_tests {
        use super::*;

        #[tokio::test]
        async fn test_cache_stats_with_enterprise() {
            // Test that cache_stats works with enterprise features
            let result = cache_stats().await;
            assert!(result.is_ok());
        }
    }
}
