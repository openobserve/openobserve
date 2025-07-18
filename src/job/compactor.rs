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

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{cluster::CompactionJobType, stream::ALL_STREAM_TYPES},
    metrics,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;
use tokio::sync::mpsc;

use crate::{common::infra::cluster::get_node_by_uuid, service::compact};

const ENRICHMENT_TABLE_MERGE_LOCK_KEY: &str = "/compact/enrichment_table";

pub async fn run() -> Result<(), anyhow::Error> {
    if !LOCAL_NODE.is_compactor() {
        return Ok(());
    }

    let cfg = get_config();
    if !cfg.compact.enabled {
        return Ok(());
    }
    log::info!("[COMPACTOR::JOB] Compactor is enabled");

    let mut worker = compact::worker::MergeWorker::new(cfg.limit.file_merge_thread_num);
    if let Err(e) = worker.run() {
        log::error!("[COMPACTOR::JOB] start merge worker error: {e}");
    }

    let mut scheduler =
        compact::worker::JobScheduler::new(cfg.limit.file_merge_thread_num, worker.tx());
    if let Err(e) = scheduler.run() {
        log::error!("[COMPACTOR::JOB] start merge job scheduler error: {e}");
    }

    tokio::task::spawn(async move { run_generate_job().await });
    tokio::task::spawn(async move { run_generate_old_data_job().await });
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(async move { run_generate_downsampling_job().await });
    tokio::task::spawn(async move { run_merge(scheduler.tx()).await });
    tokio::task::spawn(async move { run_retention().await });
    tokio::task::spawn(async move { run_delay_deletion().await });
    tokio::task::spawn(async move { run_sync_to_db().await });
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(async move { run_downsampling_sync_to_db().await });
    tokio::task::spawn(async move { run_check_running_jobs().await });
    tokio::task::spawn(async move { run_clean_done_jobs().await });
    tokio::task::spawn(async move { run_compactor_pending_jobs_metric().await });
    tokio::task::spawn(async move { run_enrichment_table_merge().await });

    Ok(())
}

/// Report compactor pending jobs as prometheus metric
async fn run_compactor_pending_jobs_metric() -> Result<(), anyhow::Error> {
    let interval = get_config().compact.pending_jobs_metric_interval;

    log::info!("[COMPACTOR::JOB] start run_compactor_pending_jobs_metric job");

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;

        log::debug!("[COMPACTOR::JOB] Running compactor pending jobs to report metric");
        let job_status = match infra::file_list::get_pending_jobs_count().await {
            Ok(status) => status,
            Err(e) => {
                log::error!("[COMPACTOR::JOB] run compactor pending jobs metric error: {e}");
                continue;
            }
        };

        // reset all metrics
        let orgs = crate::service::db::schema::list_organizations_from_cache().await;
        for org in orgs {
            for stream_type in ALL_STREAM_TYPES {
                if metrics::COMPACT_PENDING_JOBS
                    .with_label_values(&[org.as_str(), stream_type.as_str()])
                    .get()
                    > 0
                {
                    metrics::COMPACT_PENDING_JOBS
                        .with_label_values(&[org.as_str(), stream_type.as_str()])
                        .set(0);
                }
            }
        }

        // set new metrics
        for (org, inner_map) in job_status {
            for (stream_type, counter) in inner_map {
                metrics::COMPACT_PENDING_JOBS
                    .with_label_values(&[org.as_str(), stream_type.as_str()])
                    .set(counter);
            }
        }
    }
}

/// Generate merging jobs
async fn run_generate_job() -> Result<(), anyhow::Error> {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.interval,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running generate merge job");
        if let Err(e) = compact::run_generate_job(CompactionJobType::Current).await {
            log::error!("[COMPACTOR::JOB] run generate merge job error: {e}");
        }
    }
}

/// Generate merging jobs for old data
async fn run_generate_old_data_job() -> Result<(), anyhow::Error> {
    loop {
        // run every 1 hour at least
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.old_data_interval + 1,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running generate merge job for old data");
        if let Err(e) = compact::run_generate_job(CompactionJobType::Historical).await {
            log::error!("[COMPACTOR::JOB] run generate merge job for old data error: {e}");
        }
    }
}

/// Generate downsampling job for compactor
#[cfg(feature = "enterprise")]
async fn run_generate_downsampling_job() -> Result<(), anyhow::Error> {
    if get_o2_config()
        .downsampling
        .metrics_downsampling_rules
        .is_empty()
    {
        return Ok(());
    }
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_o2_config().downsampling.downsampling_interval,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running generate downsampling job");
        if let Err(e) = compact::run_generate_downsampling_job().await {
            log::error!("[COMPACTOR::JOB] run generate downsampling job error: {e}");
        }
    }
}

/// Merge small files
async fn run_merge(tx: mpsc::Sender<compact::worker::MergeJob>) -> Result<(), anyhow::Error> {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.interval + 2,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running data merge");
        if let Err(e) = compact::run_merge(tx.clone()).await {
            log::error!("[COMPACTOR::JOB] run data merge error: {e}");
        }
    }
}

/// Deletion for data retention
async fn run_retention() -> Result<(), anyhow::Error> {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.interval + 3,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running data retention");
        if let Err(e) = compact::run_retention().await {
            log::error!("[COMPACTOR::JOB] run data retention error: {e}");
        }
    }
}

/// Delete files based on the file_file_deleted in the database
async fn run_delay_deletion() -> Result<(), anyhow::Error> {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.interval + 4,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running data delay deletion");
        if let Err(e) = compact::run_delay_deletion().await {
            log::error!("[COMPACTOR::JOB] run data delay deletion error: {e}");
        }
    }
}

async fn run_sync_to_db() -> Result<(), anyhow::Error> {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.sync_to_db_interval,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running sync cached compact offset to db");
        if let Err(e) = crate::service::db::compact::files::sync_cache_to_db().await {
            log::error!("[COMPACTOR::JOB] run sync cached compact offset to db error: {e}");
        }
    }
}

#[cfg(feature = "enterprise")]
async fn run_downsampling_sync_to_db() -> Result<(), anyhow::Error> {
    if get_o2_config()
        .downsampling
        .metrics_downsampling_rules
        .is_empty()
    {
        return Ok(());
    }
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.sync_to_db_interval,
        ))
        .await;
        log::debug!("[COMPACTOR::JOB] Running sync cached downsampling offset to db");
        if let Err(e) = crate::service::db::compact::downsampling::sync_cache_to_db().await {
            log::error!("[COMPACTOR::JOB] run sync cached downsampling offset to db error: {e}");
        }
    }
}

async fn run_check_running_jobs() -> Result<(), anyhow::Error> {
    loop {
        let time = get_config().compact.job_run_timeout;
        log::debug!("[COMPACTOR::JOB] Running check running jobs");
        let updated_at = config::utils::time::now_micros() - (time * 1000 * 1000);
        if let Err(e) = infra::file_list::check_running_jobs(updated_at).await {
            log::error!("[COMPACTOR::JOB] run check running jobs error: {e}");
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(time as u64)).await;
    }
}

async fn run_clean_done_jobs() -> Result<(), anyhow::Error> {
    loop {
        let time = get_config().compact.job_clean_wait_time;
        log::debug!("[COMPACTOR::JOB] Running clean done jobs");
        let updated_at = config::utils::time::now_micros() - (time * 1000 * 1000);
        if let Err(e) = infra::file_list::clean_done_jobs(updated_at).await {
            log::error!("[COMPACTOR::JOB] run clean done jobs error: {e}");
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(time as u64)).await;
    }
}

async fn run_enrichment_table_merge() -> Result<(), anyhow::Error> {
    log::info!("[COMPACTOR::JOB] Running enrichment table merge");
    let db = infra::db::get_db().await;
    let Ok(locker) = infra::dist_lock::lock(ENRICHMENT_TABLE_MERGE_LOCK_KEY, 0).await else {
        log::error!("[COMPACTOR::JOB] Failed to acquire lock for enrichment table merge");
        return Ok(());
    };
    let node_id = db
        .get(ENRICHMENT_TABLE_MERGE_LOCK_KEY)
        .await
        .unwrap_or_default();
    let node_id = String::from_utf8_lossy(&node_id);
    if !node_id.is_empty()
        && LOCAL_NODE.uuid.ne(&node_id)
        && get_node_by_uuid(&node_id).await.is_some()
    {
        // Unlock and return
        if let Err(e) = infra::dist_lock::unlock(&locker).await {
            log::error!("[COMPACTOR::JOB] Failed to release lock for enrichment table merge: {e}");
        }
        return Ok(());
    }

    log::debug!("[COMPACTOR::JOB] No node is merging enrichment table");
    // This node is the first node to merge enrichment table
    if let Err(e) = db
        .put(
            ENRICHMENT_TABLE_MERGE_LOCK_KEY,
            LOCAL_NODE.uuid.clone().into(),
            false,
            None,
        )
        .await
    {
        log::error!("[COMPACTOR::JOB] Failed to put lock for enrichment table merge: {e}");
        if let Err(e) = infra::dist_lock::unlock(&locker).await {
            log::error!("[COMPACTOR::JOB] Failed to release lock for enrichment table merge: {e}");
        }
        return Ok(());
    }

    if let Err(e) = infra::dist_lock::unlock(&locker).await {
        log::error!("[COMPACTOR::JOB] Failed to release lock for enrichment table merge: {e}");
    }
    let handle = tokio::task::spawn(async move {
        if let Err(e) = crate::service::enrichment::storage::remote::run_merge_job().await {
            log::error!("[COMPACTOR::JOB] run enrichment table merge error: {e}");
        }
    });
    handle.await.unwrap();
    Ok(())
}
