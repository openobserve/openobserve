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

use std::path::Path;

use config::{
    get_config,
    meta::{cluster::Role, stream::StreamType},
    metrics::{self},
    utils::async_file::scan_files,
};
use hashbrown::HashMap;
use infra::{cache, cluster::get_cached_online_nodes, db::get_db};
use tokio::time;

use crate::{
    common::infra::config::{ORG_USERS, USERS},
    service::db,
};

pub async fn run() -> Result<(), anyhow::Error> {
    // load metrics
    load_query_cache_limit_bytes().await?;
    load_ingest_wal_used_bytes().await?;

    // update metrics every 60 seconds
    loop {
        tokio::time::sleep(time::Duration::from_secs(60)).await;
        if let Err(e) = update_metadata_metrics().await {
            log::error!("Error update metadata metrics: {e}");
        }
        if let Err(e) = update_storage_metrics().await {
            log::error!("Error update storage metrics: {e}");
        }
        if config::cluster::LOCAL_NODE.is_ingester()
            && let Err(e) = update_parquet_metrics().await
        {
            log::error!("Error update parquet metrics: {e}");
        }
        if let Err(e) = update_parquet_metadata_cache_metrics().await {
            log::error!("Error update parquet metadata cache metrics: {e}");
        }
    }
}

async fn load_query_cache_limit_bytes() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    metrics::QUERY_MEMORY_CACHE_LIMIT_BYTES
        .with_label_values::<&str>(&[])
        .set(cfg.memory_cache.max_size as i64);
    metrics::QUERY_DISK_CACHE_LIMIT_BYTES
        .with_label_values::<&str>(&[])
        .set((cfg.disk_cache.max_size * cfg.disk_cache.bucket_num) as i64);
    Ok(())
}

async fn load_ingest_wal_used_bytes() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let data_dir = match Path::new(&cfg.common.data_wal_dir).canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };
    let pattern = format!("{}files/", &cfg.common.data_wal_dir);
    let files = scan_files(pattern, "parquet", None)
        .await
        .unwrap_or_default();
    let mut sizes = HashMap::new();
    for file in files {
        let local_file = file.to_owned();
        let Ok(local_path) = Path::new(&file).canonicalize() else {
            continue;
        };
        let file_path = local_path
            .strip_prefix(&data_dir)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let columns = file_path.split('/').collect::<Vec<&str>>();
        let _ = columns[0].to_string();
        let org_id = columns[1].to_string();
        let stream_type = columns[2].to_string();
        let entry = sizes.entry((org_id, stream_type)).or_insert(0);
        *entry += match std::fs::metadata(local_file) {
            Ok(metadata) => metadata.len(),
            Err(_) => 0,
        };
    }
    for ((org_id, stream_type), size) in sizes {
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[&org_id, &stream_type])
            .set(size as i64);
    }
    Ok(())
}

async fn update_metadata_metrics() -> Result<(), anyhow::Error> {
    if !config::cluster::LOCAL_NODE.is_compactor() {
        return Ok(());
    }

    let db = get_db().await;
    let stats = db.stats().await?;
    metrics::META_STORAGE_BYTES
        .with_label_values::<&str>(&[])
        .set(stats.bytes_len);
    metrics::META_STORAGE_KEYS
        .with_label_values::<&str>(&[])
        .set(stats.keys_count);

    if get_config().common.local_mode {
        metrics::META_NUM_NODES.with_label_values(&["all"]).set(1);
    } else {
        metrics::META_NUM_NODES.reset();
        let nodes = get_cached_online_nodes().await;
        if let Some(nodes) = nodes {
            for node in nodes {
                if node.is_ingester() {
                    metrics::META_NUM_NODES
                        .with_label_values(&[Role::Ingester.to_string().as_str()])
                        .inc();
                }
                if node.is_querier() {
                    metrics::META_NUM_NODES
                        .with_label_values(&[Role::Querier.to_string().as_str()])
                        .inc();
                }
                if node.is_compactor() {
                    metrics::META_NUM_NODES
                        .with_label_values(&[Role::Compactor.to_string().as_str()])
                        .inc();
                }
                if node.is_router() {
                    metrics::META_NUM_NODES
                        .with_label_values(&[Role::Router.to_string().as_str()])
                        .inc();
                }
                if node.is_alert_manager() {
                    metrics::META_NUM_NODES
                        .with_label_values(&[Role::AlertManager.to_string().as_str()])
                        .inc();
                }
            }
        }
    }

    let stream_types = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
    let orgs = db::schema::list_organizations_from_cache().await;
    metrics::META_NUM_ORGANIZATIONS
        .with_label_values::<&str>(&[])
        .set(orgs.len() as i64);
    for org_id in &orgs {
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(org_id, stream_type).await;
            if !streams.is_empty() {
                metrics::META_NUM_STREAMS
                    .with_label_values::<&str>(&[org_id.as_str(), stream_type.as_str()])
                    .set(streams.len() as i64);
            }
        }
    }

    // let users = db.count("/user/").await?;
    let users = USERS.len();

    metrics::META_NUM_USERS_TOTAL
        .with_label_values::<&str>(&[])
        .set(users as i64);
    for org_id in &orgs {
        let mut count: i64 = 0;
        for user in ORG_USERS.iter() {
            if user.key().starts_with(&format!("{org_id}/")) {
                count += 1;
            }
        }
        metrics::META_NUM_USERS
            .with_label_values(&[org_id.as_str()])
            .set(count);
    }

    metrics::META_NUM_FUNCTIONS.reset();
    let functions = db.list_keys("/function/").await?;
    for key in functions {
        let key = key.strip_prefix("/function/").unwrap();
        let columns = key.split('/').collect::<Vec<&str>>();
        if columns.len() <= 2 {
            // query functions
            metrics::META_NUM_FUNCTIONS
                .with_label_values(&[columns[0], "", "query"])
                .inc();
        } else {
            // ingest functions
            metrics::META_NUM_FUNCTIONS
                .with_label_values(&[columns[0], columns[1], "ingest"])
                .inc();
        }
    }

    // TODO alert
    // TODO dashboard

    Ok(())
}

async fn update_storage_metrics() -> Result<(), anyhow::Error> {
    if !config::cluster::LOCAL_NODE.is_compactor() {
        return Ok(());
    }

    // reset metrics
    metrics::STORAGE_ORIGINAL_BYTES.reset();
    metrics::STORAGE_COMPRESSED_BYTES.reset();
    metrics::STORAGE_FILES.reset();
    metrics::STORAGE_RECORDS.reset();

    // update metrics
    let stats = cache::stats::get_stats();
    for (key, stat) in stats {
        let columns = key.split('/').collect::<Vec<&str>>();
        let cur_val = metrics::STORAGE_ORIGINAL_BYTES
            .with_label_values(&[columns[0], columns[1]])
            .get();
        metrics::STORAGE_ORIGINAL_BYTES
            .with_label_values(&[columns[0], columns[1]])
            .set(cur_val + stat.storage_size as i64);
        let cur_val = metrics::STORAGE_COMPRESSED_BYTES
            .with_label_values(&[columns[0], columns[1]])
            .get();
        metrics::STORAGE_COMPRESSED_BYTES
            .with_label_values(&[columns[0], columns[1]])
            .set(cur_val + stat.compressed_size as i64);
        let cur_val = metrics::STORAGE_FILES
            .with_label_values(&[columns[0], columns[1]])
            .get();
        metrics::STORAGE_FILES
            .with_label_values(&[columns[0], columns[1]])
            .set(cur_val + stat.file_num);
        let cur_val = metrics::STORAGE_RECORDS
            .with_label_values(&[columns[0], columns[1]])
            .get();
        metrics::STORAGE_RECORDS
            .with_label_values(&[columns[0], columns[1]])
            .set(cur_val + stat.doc_num);
    }
    Ok(())
}

async fn update_parquet_metrics() -> Result<(), anyhow::Error> {
    // Call the ingester's parquet metrics collection function
    ingester::collect_wal_parquet_metrics()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to collect parquet metrics: {}", e))?;
    Ok(())
}

async fn update_parquet_metadata_cache_metrics() -> Result<(), anyhow::Error> {
    let file_num =
        crate::service::search::datafusion::storage::file_statistics_cache::GLOBAL_CACHE.len();
    let mem_size = crate::service::search::datafusion::storage::file_statistics_cache::GLOBAL_CACHE
        .memory_size();
    metrics::QUERY_PARQUET_METADATA_CACHE_FILES
        .with_label_values::<&str>(&[])
        .set(file_num as i64);
    metrics::QUERY_PARQUET_METADATA_CACHE_USED_BYTES
        .with_label_values::<&str>(&[])
        .set(mem_size as i64);
    Ok(())
}
