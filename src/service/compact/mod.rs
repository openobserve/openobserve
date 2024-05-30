// Copyright 2024 Zinc Labs Inc.
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

use std::sync::Arc;

use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use config::{
    cluster::LOCAL_NODE_UUID,
    get_config,
    meta::{cluster::Role, stream::StreamType},
};
use infra::dist_lock;
use once_cell::sync::Lazy;
use tokio::sync::{mpsc, Mutex, Semaphore};

use crate::{
    common::infra::cluster::{get_node_by_uuid, get_node_from_consistent_hash},
    service::db,
};

mod file_list;
pub mod file_list_deleted;
pub mod flatten;
pub mod merge;
pub mod retention;
pub mod stats;

pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

/// compactor retention run steps:
pub async fn run_retention() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // check data retention
    if cfg.compact.data_retention_days > 0 {
        let now = Utc::now();
        let date = now - Duration::try_days(cfg.compact.data_retention_days).unwrap();
        let data_lifecycle_end = date.format("%Y-%m-%d").to_string();

        let orgs = db::schema::list_organizations_from_cache().await;
        let stream_types = [
            StreamType::Logs,
            StreamType::Metrics,
            StreamType::Traces,
            StreamType::EnrichmentTables,
            StreamType::Metadata,
            StreamType::Index,
        ];
        for org_id in orgs {
            // get the working node for the organization
            let (_, node) = db::compact::organization::get_offset(&org_id, "retention").await;
            if !node.is_empty()
                && LOCAL_NODE_UUID.ne(&node)
                && get_node_by_uuid(&node).await.is_some()
            {
                continue;
            }

            // before start processing, set current node to lock the organization
            let lock_key = format!("/compact/organization/{org_id}");
            let locker = dist_lock::lock(&lock_key, 0).await?;
            // check the working node for the organization again, maybe other node locked it
            // first
            let (_, node) = db::compact::organization::get_offset(&org_id, "retention").await;
            if !node.is_empty()
                && LOCAL_NODE_UUID.ne(&node)
                && get_node_by_uuid(&node).await.is_some()
            {
                dist_lock::unlock(&locker).await?;
                continue;
            }
            let ret = if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
                db::compact::organization::set_offset(
                    &org_id,
                    "retention",
                    0,
                    Some(&LOCAL_NODE_UUID.clone()),
                )
                .await
            } else {
                Ok(())
            };
            // already bind to this node, we can unlock now
            dist_lock::unlock(&locker).await?;
            drop(locker);
            ret?;

            for stream_type in stream_types {
                let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
                for stream_name in streams {
                    let schema = infra::schema::get(&org_id, &stream_name, stream_type).await?;
                    let stream = super::stream::stream_res(&stream_name, stream_type, schema, None);
                    let stream_data_retention_end = if stream.settings.data_retention > 0 {
                        let date =
                            now - Duration::try_days(stream.settings.data_retention).unwrap();
                        date.format("%Y-%m-%d").to_string()
                    } else {
                        data_lifecycle_end.clone()
                    };
                    if let Err(e) = retention::delete_by_stream(
                        &stream_data_retention_end,
                        &org_id,
                        stream_type,
                        &stream_name,
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
            retention::delete_all(org_id, stream_type, stream_name).await
        } else {
            let date_range = retention.split(',').collect::<Vec<&str>>();
            retention::delete_by_date(
                org_id,
                stream_type,
                stream_name,
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
pub async fn run_merge(
    worker_tx: mpsc::Sender<(merge::MergeSender, merge::MergeBatch)>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.file_move_thread_num));
    let orgs = db::schema::list_organizations_from_cache().await;
    let stream_types = [
        StreamType::Logs,
        StreamType::Metrics,
        StreamType::Traces,
        StreamType::EnrichmentTables,
        StreamType::Metadata,
        StreamType::Index,
    ];
    for org_id in orgs {
        // check backlist
        if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id)
        {
            continue;
        }
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
            let mut tasks = Vec::with_capacity(streams.len());
            for stream_name in streams {
                let Some(node) =
                    get_node_from_consistent_hash(&stream_name, &Role::Compactor).await
                else {
                    continue; // no compactor node
                };
                if LOCAL_NODE_UUID.ne(&node) {
                    // Check if this node holds the stream
                    if let Some((offset, _)) = db::compact::files::get_offset_from_cache(
                        &org_id,
                        stream_type,
                        &stream_name,
                    )
                    .await
                    {
                        // release the stream
                        db::compact::files::set_offset(
                            &org_id,
                            stream_type,
                            &stream_name,
                            offset,
                            None,
                        )
                        .await?;
                    }
                    continue; // not this node
                }

                // check if we are allowed to merge or just skip
                if db::compact::retention::is_deleting_stream(
                    &org_id,
                    stream_type,
                    &stream_name,
                    None,
                ) {
                    log::warn!(
                        "[COMPACTOR] the stream [{}/{}/{}] is deleting, just skip",
                        &org_id,
                        stream_type,
                        &stream_name,
                    );
                    continue;
                }

                let org_id = org_id.clone();
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let worker_tx = worker_tx.clone();
                let task = tokio::task::spawn(async move {
                    if let Err(e) =
                        merge::merge_by_stream(worker_tx, &org_id, stream_type, &stream_name).await
                    {
                        log::error!(
                            "[COMPACTOR] merge_by_stream [{}/{}/{}] error: {}",
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
    if !cfg.common.meta_store_external {
        let last_file_list_offset = db::compact::file_list::get_offset().await?;
        if let Err(e) = file_list::run(last_file_list_offset).await {
            log::error!("[COMPACTOR] merge file list error: {}", e);
        }
    }

    Ok(())
}

/// compactor delay delete files run steps:
/// 1. get pending deleted files from file_list_deleted table, created_at > 2 hours
/// 2. delete files from storage
pub async fn run_delay_deletion() -> Result<(), anyhow::Error> {
    let now = Utc::now();
    let time_max =
        now - Duration::try_hours(get_config().compact.delete_files_delay_hours).unwrap();
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
    let orgs = db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        // get the working node for the organization
        let (_, node) = db::compact::organization::get_offset(&org_id, "file_list_deleted").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            continue;
        }

        // before start processing, set current node to lock the organization
        let lock_key = format!("/compact/organization/{org_id}");
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node for the organization again, maybe other node locked it
        // first
        let (offset, node) =
            db::compact::organization::get_offset(&org_id, "file_list_deleted").await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            continue;
        }
        let ret = if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
            db::compact::organization::set_offset(
                &org_id,
                "file_list_deleted",
                offset,
                Some(&LOCAL_NODE_UUID.clone()),
            )
            .await
        } else {
            Ok(())
        };
        // already bind to this node, we can unlock now
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;

        let batch_size = 10000;
        loop {
            match file_list_deleted::delete(&org_id, offset, time_max, batch_size).await {
                Ok(affected) => {
                    if affected == 0 {
                        break;
                    }
                    log::debug!("[COMPACTOR] deleted from file_list_deleted {affected} files");
                }
                Err(e) => {
                    log::error!("[COMPACTOR] delete files error: {}", e);
                    break;
                }
            };
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
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
