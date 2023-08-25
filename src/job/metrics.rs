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

use ahash::HashMap;
use std::path::Path;
use tokio::time;

use crate::common::{
    infra::{
        cache, cluster,
        config::{CONFIG, USERS},
        metrics,
    },
    meta::StreamType,
    utils::file::scan_files,
};
use crate::service::db;

pub async fn run() -> Result<(), anyhow::Error> {
    // load metrics
    load_query_cache_limit_bytes().await?;
    load_ingest_wal_used_bytes().await?;

    // update metrics every 60 seconds
    let mut interval = time::interval(time::Duration::from_secs(6000));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        if let Err(e) = update_metadata_metrics().await {
            log::error!("Error update metadata metrics: {}", e);
        }
        if let Err(e) = update_storage_metrics().await {
            log::error!("Error update storage metrics: {}", e);
        }
    }
}

async fn load_query_cache_limit_bytes() -> Result<(), anyhow::Error> {
    metrics::QUERY_CACHE_LIMIT_BYTES
        .with_label_values(&[])
        .set(CONFIG.memory_cache.max_size as i64);
    Ok(())
}

async fn load_ingest_wal_used_bytes() -> Result<(), anyhow::Error> {
    let data_dir = match Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };
    let pattern = format!("{}files/", &CONFIG.common.data_wal_dir);
    let files = scan_files(&pattern);
    let mut sizes = HashMap::default();
    for file in files {
        let local_file = file.to_owned();
        let local_path = Path::new(&file).canonicalize().unwrap();
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
        let stream_name = columns[3].to_string();
        let entry = sizes.entry((org_id, stream_name, stream_type)).or_insert(0);
        *entry += match std::fs::metadata(local_file) {
            Ok(metadata) => metadata.len(),
            Err(_) => 0,
        };
    }
    for ((org_id, stream_name, stream_type), size) in sizes {
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[&org_id, &stream_name, &stream_type])
            .set(size as i64);
    }
    Ok(())
}

async fn update_metadata_metrics() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let stats = db.stats().await?;
    metrics::META_STORAGE_BYTES
        .with_label_values(&[])
        .set(stats.bytes_len as i64);
    metrics::META_STORAGE_KEYS
        .with_label_values(&[])
        .set(stats.keys_count as i64);

    if CONFIG.common.local_mode {
        metrics::META_NUM_NODES.with_label_values(&["all"]).set(1);
    } else {
        metrics::META_NUM_NODES.reset();
        let nodes = cluster::get_cached_online_nodes();
        if nodes.is_some() {
            for node in nodes.unwrap() {
                if cluster::is_ingester(&node.role) {
                    metrics::META_NUM_NODES
                        .with_label_values(&[cluster::Role::Ingester.to_string().as_str()])
                        .inc();
                }
                if cluster::is_querier(&node.role) {
                    metrics::META_NUM_NODES
                        .with_label_values(&[cluster::Role::Querier.to_string().as_str()])
                        .inc();
                }
                if cluster::is_compactor(&node.role) {
                    metrics::META_NUM_NODES
                        .with_label_values(&[cluster::Role::Compactor.to_string().as_str()])
                        .inc();
                }
                if cluster::is_router(&node.role) {
                    metrics::META_NUM_NODES
                        .with_label_values(&[cluster::Role::Router.to_string().as_str()])
                        .inc();
                }
                if cluster::is_alert_manager(&node.role) {
                    metrics::META_NUM_NODES
                        .with_label_values(&[cluster::Role::AlertManager.to_string().as_str()])
                        .inc();
                }
            }
        }
    }

    let stream_types = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
    let orgs = db::schema::list_organizations_from_cache();
    metrics::META_NUM_ORGANIZATIONS
        .with_label_values(&[])
        .set(orgs.len() as i64);
    for org_id in &orgs {
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(org_id, stream_type);
            if !streams.is_empty() {
                metrics::META_NUM_STREAMS
                    .with_label_values(&[org_id.as_str(), stream_type.to_string().as_str()])
                    .set(streams.len() as i64);
            }
        }
    }

    //let users = db.count("/user/").await?;
    let users = USERS.len();

    metrics::META_NUM_USERS_TOTAL
        .with_label_values(&[])
        .set(users as i64);
    for org_id in &orgs {
        let mut count: i64 = 0;
        for user in USERS.clone().iter() {
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
                .with_label_values(&[columns[0], "", "", "query"])
                .inc();
        } else {
            // ingest functions
            metrics::META_NUM_FUNCTIONS
                .with_label_values(&[columns[0], columns[2], columns[1], "ingest"])
                .inc();
        }
    }

    // TODO alert
    // TODO dashboard

    Ok(())
}

async fn update_storage_metrics() -> Result<(), anyhow::Error> {
    let stats = cache::stats::get_stats();
    for (key, stat) in stats {
        let columns = key.split('/').collect::<Vec<&str>>();
        metrics::STORAGE_ORIGINAL_BYTES
            .with_label_values(&[columns[0], columns[2], columns[1]])
            .set(stat.storage_size as i64);
        metrics::STORAGE_COMPRESSED_BYTES
            .with_label_values(&[columns[0], columns[2], columns[1]])
            .set(stat.compressed_size as i64);
        metrics::STORAGE_FILES
            .with_label_values(&[columns[0], columns[2], columns[1]])
            .set(stat.file_num as i64);
        metrics::STORAGE_RECORDS
            .with_label_values(&[columns[0], columns[2], columns[1]])
            .set(stat.doc_num as i64);
    }
    Ok(())
}
