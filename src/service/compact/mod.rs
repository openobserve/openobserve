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

use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

use crate::common::infra::{
    cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
    config::CONFIG,
    dist_lock,
};
use crate::common::meta::StreamType;
use crate::service::db;

mod file_list;
pub mod file_list_deleted;
mod merge;
pub mod retention;
pub mod stats;

pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

/// compactor delete run steps:
pub async fn run_delete() -> Result<(), anyhow::Error> {
    // check data retention
    if CONFIG.compact.data_retention_days > 0 {
        let now = Utc::now();
        let date = now - Duration::days(CONFIG.compact.data_retention_days);
        let data_lifecycle_end = date.format("%Y-%m-%d").to_string();

        let orgs = db::schema::list_organizations_from_cache();
        let stream_types = [
            StreamType::Logs,
            StreamType::Metrics,
            StreamType::Traces,
            StreamType::EnrichmentTables,
            StreamType::Metadata,
        ];
        for org_id in orgs {
            // get the working node for the organization
            let (_, node) = db::compact::organization::get_offset(&org_id, "retention").await;
            if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
                log::error!("[COMPACT] organization {org_id} is merging by {node}");
                continue;
            }

            // before start merging, set current node to lock the organization
            let lock_key = format!("compact/organization/{org_id}");
            let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
            // check the working node for the organization again, maybe other node locked it first
            let (_, node) = db::compact::organization::get_offset(&org_id, "retention").await;
            if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
                log::error!("[COMPACT] organization {org_id} is merging by {node}");
                dist_lock::unlock(&locker).await?;
                continue;
            }
            if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
                db::compact::organization::set_offset(
                    &org_id,
                    "retention",
                    0,
                    Some(&LOCAL_NODE_UUID.clone()),
                )
                .await?;
            }
            // already bind to this node, we can unlock now
            dist_lock::unlock(&locker).await?;
            drop(locker);

            for stream_type in stream_types {
                let streams = db::schema::list_streams_from_cache(&org_id, stream_type);
                for stream_name in streams {
                    let schema = db::schema::get(&org_id, &stream_name, stream_type).await?;
                    let stream = super::stream::stream_res(&stream_name, stream_type, schema, None);
                    let stream_data_retention_end = if stream.settings.data_retention > 0 {
                        let date = now - Duration::days(stream.settings.data_retention);
                        date.format("%Y-%m-%d").to_string()
                    } else {
                        data_lifecycle_end.clone()
                    };
                    if let Err(e) = retention::delete_by_stream(
                        &stream_data_retention_end,
                        &org_id,
                        &stream_name,
                        stream_type,
                    )
                    .await
                    {
                        log::error!(
                            "[COMPACTOR] lifecycle: delete_by_stream [{}/{}/{}] error: {}",
                            org_id,
                            stream_type,
                            stream_name,
                            e
                        );
                    }
                }
            }
        }
    }

    // delete files
    let jobs = db::compact::retention::list().await?;
    for job in jobs {
        let columns = job.split('/').collect::<Vec<&str>>();
        let org_id = columns[0];
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2];
        let retention = columns[3];
        tokio::task::yield_now().await; // yield to other tasks

        let ret = if retention.eq("all") {
            retention::delete_all(org_id, stream_name, stream_type).await
        } else {
            let date_range = retention.split(',').collect::<Vec<&str>>();
            retention::delete_by_date(
                org_id,
                stream_name,
                stream_type,
                (date_range[0], date_range[1]),
            )
            .await
        };

        if let Err(e) = ret {
            log::error!(
                "[COMPACTOR] delete: delete [{}/{}/{}] error: {}",
                org_id,
                stream_type,
                stream_name,
                e
            );
        }
    }

    Ok(())
}

/// compactor merge run steps:
/// 1. get all organization
/// 2. range streams by organization & stream_type
/// 3. get a cluster lock for compactor stream
/// 4. read last compacted offset: year/month/day/hour
/// 5. read current hour all files
/// 6. compact small files to big files -> COMPACTOR_MAX_FILE_SIZE
/// 7. write to storage
/// 8. delete small files keys & write big files keys, use transaction
/// 9. delete small files from storage
/// 10. update last compacted offset
/// 11. release cluster lock
/// 12. compact file list from storage
pub async fn run_merge() -> Result<(), anyhow::Error> {
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    let orgs = db::schema::list_organizations_from_cache();
    let stream_types = [
        StreamType::Logs,
        StreamType::Metrics,
        StreamType::Traces,
        StreamType::EnrichmentTables,
        StreamType::Metadata,
    ];
    for org_id in orgs {
        // get the working node for the organization
        let (_, node) = db::compact::organization::get_offset(&org_id, "merge").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[COMPACT] organization {org_id} is merging by {node}");
            continue;
        }

        // before start merging, set current node to lock the organization
        let lock_key = format!("compact/organization/{org_id}");
        let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
        // check the working node for the organization again, maybe other node locked it first
        let (_, node) = db::compact::organization::get_offset(&org_id, "merge").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[COMPACT] organization {org_id} is merging by {node}");
            dist_lock::unlock(&locker).await?;
            continue;
        }
        if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
            db::compact::organization::set_offset(
                &org_id,
                "merge",
                0,
                Some(&LOCAL_NODE_UUID.clone()),
            )
            .await?;
        }
        // already bind to this node, we can unlock now
        dist_lock::unlock(&locker).await?;
        drop(locker);

        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type);
            let mut tasks = Vec::with_capacity(streams.len());
            for stream_name in streams {
                // check if we are allowed to merge or just skip
                if db::compact::retention::is_deleting_stream(
                    &org_id,
                    &stream_name,
                    stream_type,
                    None,
                ) {
                    log::info!(
                        "[COMPACTOR] the stream [{}/{}/{}] is deleting, just skip",
                        &org_id,
                        stream_type,
                        &stream_name,
                    );
                    continue;
                }

                let org_id = org_id.clone();
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let task = tokio::task::spawn(async move {
                    if let Err(e) = merge::merge_by_stream(&org_id, &stream_name, stream_type).await
                    {
                        log::error!(
                            "[COMPACTOR] merge_by_stream [{}:{}:{}] error: {}",
                            org_id,
                            stream_type,
                            stream_name,
                            e
                        );
                    }
                    drop(permit);
                });
                tasks.push(task);
            }
            for task in tasks {
                task.await?;
            }
        }
    }

    // after compact, compact file list from storage
    if !CONFIG.common.meta_store_external {
        let last_file_list_offset = db::compact::file_list::get_offset().await?;
        if let Err(e) = file_list::run(last_file_list_offset).await {
            log::error!("[COMPACTOR] merge file list error: {}", e);
        }
    }

    Ok(())
}

/// compactor delete files run steps:
/// 1. get pending deleted files from file_list_deleted table, created_at > 2 hours
/// 2. delete files from storage
pub async fn run_delete_files() -> Result<(), anyhow::Error> {
    let now = Utc::now();
    let time_max = now - Duration::hours(CONFIG.compact.delete_files_delay_hours);
    let time_max = Utc
        .with_ymd_and_hms(
            time_max.year(),
            time_max.month(),
            time_max.day(),
            time_max.hour(),
            0,
            0,
        )
        .unwrap();
    let time_max = time_max.timestamp_micros();
    let orgs = db::schema::list_organizations_from_cache();
    for org_id in orgs {
        // get the working node for the organization
        let (_, node) = db::compact::organization::get_offset(&org_id, "file_list_deleted").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[COMPACT] organization {org_id} is merging by {node}");
            continue;
        }

        // before start merging, set current node to lock the organization
        let lock_key = format!("compact/organization/{org_id}");
        let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
        // check the working node for the organization again, maybe other node locked it first
        let (offset, node) =
            db::compact::organization::get_offset(&org_id, "file_list_deleted").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[COMPACT] organization {org_id} is merging by {node}");
            dist_lock::unlock(&locker).await?;
            continue;
        }
        if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
            db::compact::organization::set_offset(
                &org_id,
                "file_list_deleted",
                offset,
                Some(&LOCAL_NODE_UUID.clone()),
            )
            .await?;
        }
        // already bind to this node, we can unlock now
        dist_lock::unlock(&locker).await?;
        drop(locker);

        if let Err(e) = file_list_deleted::delete(&org_id, offset, time_max).await {
            log::error!("[COMPACTOR] delete files error: {}", e);
        }

        // update offset
        db::compact::organization::set_offset(
            &org_id,
            "file_list_deleted",
            time_max,
            Some(&LOCAL_NODE_UUID.clone()),
        )
        .await?;
    }

    Ok(())
}
