// Copyright 2024 OpenObserve Inc.
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
#[cfg(feature = "enterprise")]
use std::collections::HashMap;

#[cfg(feature = "enterprise")]
use config::meta::stream::StreamStats;
use config::{meta::stream::FileMeta, RwHashMap, RwHashSet};
use dashmap::{DashMap, DashSet};
use infra::{cache, cache::stats, file_list};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;
use once_cell::sync::Lazy;
#[cfg(feature = "enterprise")]
use proto::cluster_rpc::StreamStatResponse;

#[cfg(feature = "enterprise")]
use crate::handler::grpc::request::stream::{ClusterStreamClient, StreamStatKey, StreamStatsEntry};

pub mod broadcast;
pub mod local;

pub static DEPULICATE_FILES: Lazy<RwHashSet<String>> =
    Lazy::new(|| DashSet::with_capacity_and_hasher(1024, Default::default()));

pub static DELETED_FILES: Lazy<RwHashMap<String, FileMeta>> =
    Lazy::new(|| DashMap::with_capacity_and_hasher(64, Default::default()));

pub static BLOCKED_ORGS: Lazy<Vec<String>> = Lazy::new(|| {
    config::get_config()
        .compact
        .blocked_orgs
        .split(',')
        .map(|x| x.to_string())
        .collect()
});

pub async fn progress(
    key: &str,
    data: Option<&FileMeta>,
    delete: bool,
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
        if config::get_config().common.local_mode {
            if let Err(e) = cache::stats::incr_stream_stats(key, data.unwrap()) {
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

pub async fn cache_stats() -> Result<(), anyhow::Error> {
    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        if let Err(err) = super_cluster_cache_stats().await {
            log::error!("super_cluster_cache_stats error: {err}")
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
#[cfg(not(feature = "enterprise"))]
async fn single_cache_stats() -> Result<(), anyhow::Error> {
    let orgs = crate::service::db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        let ret = infra::file_list::get_stream_stats(&org_id, None, None).await;
        if ret.is_err() {
            log::error!("Load stream stats error: {}", ret.err().unwrap());
            continue;
        }
        for (stream, stats) in ret.unwrap() {
            let columns = stream.split('/').collect::<Vec<&str>>();
            let org_id = columns[0];
            let stream_type = columns[1];
            let stream_name = columns[2];
            stats::set_stream_stats(org_id, stream_name, stream_type.into(), stats);
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn super_cluster_cache_stats() -> Result<(), anyhow::Error> {
    let mut clusters = o2_enterprise::enterprise::super_cluster::kv::cluster::list().await?;
    clusters.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    clusters.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);

    if clusters.is_empty() {
        return Err(anyhow::anyhow!("No selected clusters online"));
    }

    let clients: Vec<_> = clusters.iter().map(ClusterStreamClient::new).collect();
    let clients: Vec<_> = clients.into_iter().filter_map(|c| c.ok()).collect();

    let stat_futures: Vec<_> = clients
        .iter()
        .map(|client| client.get_stream_stats())
        .collect();

    let mut results = vec![];
    let stat_results = futures_util::future::join_all(stat_futures).await;
    for (i, result) in stat_results.into_iter().enumerate() {
        match result {
            Ok(stats) => {
                log::debug!("Client {} stats: {:?}", i, stats);
                results.push(stats);
            }
            Err(e) => {
                // If the retrieval of stream stats for a cluster fails,
                // the data of this cluster will not be updated in the cache.
                // However, the previously added data will not be deleted during the merging
                // process.
                log::error!("Failed to get {i} stream stats: {}", e);
            }
        }
    }

    let merged_stats = merge_stream_stats(results)?;
    if !merged_stats.is_empty() {
        log::debug!("super_cluster_cache_stats Merged stats: {:?}", merged_stats);
        // Write merged stats
        write_merged_stats(merged_stats)?;
    }

    Ok(())
}
#[cfg(feature = "enterprise")]
fn merge_stream_stats(
    results: Vec<StreamStatResponse>,
) -> Result<HashMap<StreamStatKey, StreamStats>, anyhow::Error> {
    let mut stats_map: HashMap<StreamStatKey, StreamStats> = HashMap::new();

    for response in results {
        for entry in response.entries {
            let stream_entry = StreamStatsEntry::try_from(entry)?;
            let key = StreamStatKey::new(
                stream_entry.org_id,
                stream_entry.stream_name,
                stream_entry.stream_type,
            );

            stats_map
                .entry(key)
                .and_modify(|existing_stats| existing_stats.merge(&stream_entry.stats))
                .or_insert(stream_entry.stats);
        }
    }

    Ok(stats_map)
}
#[cfg(feature = "enterprise")]
fn write_merged_stats(stats_map: HashMap<StreamStatKey, StreamStats>) -> Result<(), anyhow::Error> {
    for (key, stats) in stats_map {
        stats::set_stream_stats(&key.org_id, &key.stream_name, key.stream_type.into(), stats);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use infra::cache::stats::get_stream_stats;
    use proto::cluster_rpc::{StreamStatEntry, StreamStatResponse};

    use super::*;

    fn create_test_stats(
        created_at: i64,
        doc_time_min: i64,
        doc_time_max: i64,
        doc_num: i64,
        file_num: i64,
        storage_size: f64,
        compressed_size: f64,
        index_size: f64,
    ) -> StreamStats {
        StreamStats {
            created_at,
            doc_time_min,
            doc_time_max,
            doc_num,
            file_num,
            storage_size,
            compressed_size,
            index_size,
        }
    }

    fn create_test_entry(
        org_id: &str,
        stream_name: &str,
        stream_type: &str,
        stats: StreamStats,
    ) -> StreamStatEntry {
        StreamStatEntry {
            stream: format!("{}/{}/{}", org_id, stream_type, stream_name),
            stats: Some(proto::cluster_rpc::StreamStats {
                created_at: stats.created_at,
                doc_time_min: stats.doc_time_min,
                doc_time_max: stats.doc_time_max,
                doc_num: stats.doc_num,
                file_num: stats.file_num,
                storage_size: stats.storage_size,
                compressed_size: stats.compressed_size,
                index_size: stats.index_size,
            }),
        }
    }

    #[test]
    fn test_merge_stream_stats() {
        // Create test data
        let stats1 = create_test_stats(100, 50, 150, 10, 2, 1000.0, 500.0, 200.0);
        let stats2 = create_test_stats(90, 40, 160, 15, 3, 1500.0, 750.0, 300.0);

        let response1 = StreamStatResponse {
            entries: vec![
                create_test_entry("org1", "stream1", "type1", stats1.clone()),
                create_test_entry("org2", "stream2", "type2", stats1.clone()),
            ],
        };

        let response2 = StreamStatResponse {
            entries: vec![
                create_test_entry("org1", "stream1", "type1", stats2.clone()),
                create_test_entry("org3", "stream3", "type3", stats2.clone()),
            ],
        };

        let results = vec![response1, response2];
        let merged = merge_stream_stats(results).unwrap();

        // Verify results
        assert_eq!(merged.len(), 3); // Should have 3 unique streams

        // Check merged stats for org1/stream1/type1
        let key = StreamStatKey::new(
            "org1".to_string(),
            "stream1".to_string(),
            "type1".to_string(),
        );
        let merged_stats = merged.get(&key).unwrap();

        // Verify merged values
        assert_eq!(merged_stats.created_at, 90); // min
        assert_eq!(merged_stats.doc_time_min, 40); // min
        assert_eq!(merged_stats.doc_time_max, 160); // max
        assert_eq!(merged_stats.doc_num, 25); // sum
        assert_eq!(merged_stats.file_num, 5); // sum
        assert_eq!(merged_stats.storage_size, 2500.0); // sum
        assert_eq!(merged_stats.compressed_size, 1250.0); // sum
        assert_eq!(merged_stats.index_size, 500.0); // sum
    }

    #[test]
    fn test_write_merged_stats() {
        let mut stats_map = HashMap::new();

        // Add test data
        let key1 = StreamStatKey::new(
            "org1".to_string(),
            "stream1".to_string(),
            "type1".to_string(),
        );
        let stats1 = create_test_stats(100, 50, 150, 10, 2, 1000.0, 500.0, 200.0);
        stats_map.insert(key1.clone(), stats1.clone());

        let key2 = StreamStatKey::new(
            "org2".to_string(),
            "stream2".to_string(),
            "type2".to_string(),
        );
        let stats2 = create_test_stats(90, 40, 160, 15, 3, 1500.0, 750.0, 300.0);
        stats_map.insert(key2.clone(), stats2.clone());

        // Test writing
        let result = write_merged_stats(stats_map);
        assert!(result.is_ok());

        let sts1 = get_stream_stats(
            key1.org_id.as_str(),
            &key1.stream_name,
            key1.stream_type.into(),
        );
        assert_eq!(sts1.index_size, stats1.index_size);
        assert_eq!(sts1.storage_size, stats1.storage_size);
        assert_eq!(sts1.compressed_size, stats1.compressed_size);
        assert_eq!(sts1.file_num, stats1.file_num);
        assert_eq!(sts1.doc_num, stats1.doc_num);
        assert_eq!(sts1.doc_time_max, stats1.doc_time_max);
        assert_eq!(sts1.doc_time_min, stats1.doc_time_min);
        assert_eq!(sts1.created_at, stats1.created_at);

        let sts2 = get_stream_stats(
            key2.org_id.as_str(),
            &key2.stream_name,
            key2.stream_type.into(),
        );
        assert_eq!(sts2.index_size, stats2.index_size);
        assert_eq!(sts2.storage_size, stats2.storage_size);
        assert_eq!(sts2.compressed_size, stats2.compressed_size);
        assert_eq!(sts2.file_num, stats2.file_num);
        assert_eq!(sts2.doc_num, stats2.doc_num);
        assert_eq!(sts2.doc_time_max, stats2.doc_time_max);
        assert_eq!(sts2.doc_time_min, stats2.doc_time_min);
        assert_eq!(sts2.created_at, stats2.created_at);
    }

    #[test]
    fn test_stream_stat_key() {
        let key1 = StreamStatKey::new(
            "org1".to_string(),
            "stream1".to_string(),
            "type1".to_string(),
        );
        let key2 = StreamStatKey::new(
            "org1".to_string(),
            "stream1".to_string(),
            "type1".to_string(),
        );
        let key3 = StreamStatKey::new(
            "org2".to_string(),
            "stream1".to_string(),
            "type1".to_string(),
        );

        // Test equality
        assert_eq!(key1, key2);
        assert_ne!(key1, key3);

        // Test hash
        let mut map = HashMap::new();
        map.insert(key1.clone(), 1);
        assert_eq!(map.get(&key2), Some(&1));
        assert_eq!(map.get(&key3), None);
    }

    #[test]
    fn test_invalid_stream_entry() {
        let invalid_entry = StreamStatEntry {
            stream: "invalid/path".to_string(),
            stats: Some(proto::cluster_rpc::StreamStats::default()),
        };

        let response = StreamStatResponse {
            entries: vec![invalid_entry],
        };

        let result = merge_stream_stats(vec![response]);
        assert!(result.is_err());
    }
}
