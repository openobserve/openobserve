// Copyright 2026 OpenObserve Inc.
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

use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use config::{
    COMPACT_OLD_DATA_STREAM_SET,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::{CompactionJobType, Role},
        stream::{PartitionTimeLevel, StreamType},
    },
    utils::time::{day_micros, hour_micros, now_micros, second_micros},
};
use infra::{
    cluster::get_node_from_consistent_hash,
    file_list as infra_file_list,
    schema::{get_partition_time_level, get_settings, get_stream_setting_dynamic_merge},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::downsampling::get_matching_downsampling_rules;
use tokio::sync::mpsc;

mod bloom;
pub mod deleted;
pub mod dump;
pub mod flatten;
pub mod incremental;
pub mod merge;
pub mod retention;
pub mod stats;
pub mod worker;

/// Generate day-granularity retention delete jobs from the stream retention settings.
pub async fn run_generate_retention_job() -> Result<(), anyhow::Error> {
    retention::generate_jobs().await
}

/// Execute the pending delete jobs, both retention jobs and whole-stream deletions.
pub async fn run_retention() -> Result<(), anyhow::Error> {
    let jobs = db::compact::retention::list().await?;
    for job in jobs {
        let columns = job.split('/').collect::<Vec<&str>>();
        let org_id = columns[0];
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2];
        let retention = columns[3];

        // here we use job to get the compactor node, so that we can use different compactor for
        // different job of same stream
        let Some(node_name) = get_node_from_consistent_hash(&job, &Role::Compactor, None).await
        else {
            continue; // no compactor node
        };
        if LOCAL_NODE.name.ne(&node_name) {
            continue; // not this node
        }

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
            .map_err(|e| {
                log::error!(
                    "[COMPACTOR] delete: delete [{org_id}/{stream_type}/{stream_name}] error: {e}"
                );
                e
            })
        };

        if let Err(e) = ret {
            log::error!(
                "[COMPACTOR] delete: delete [{org_id}/{stream_type}/{stream_name}] error: {e}"
            );
        }
    }

    Ok(())
}

/// Generate job for compactor
pub async fn run_generate_job(job_type: CompactionJobType) -> Result<(), anyhow::Error> {
    let grouped = db::schema::list_all_streams_grouped().await;
    for (org_id, stream_types) in grouped {
        // check backlist
        if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id)
        {
            continue;
        }
        for (stream_type, streams) in stream_types {
            for stream_name in streams {
                let Some(node_name) =
                    get_node_from_consistent_hash(&stream_name, &Role::Compactor, None).await
                else {
                    continue; // no compactor node
                };
                if LOCAL_NODE.name.ne(&node_name) {
                    // This needs to be done in the case when there is a new node in the cluster
                    // This will change the node that holds the stream
                    // In case this node holds the stream, we release it for the designated node
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
                        org_id,
                        stream_type,
                        stream_name,
                    );
                    continue;
                }
                // a stream created before over-long keys were rejected can never record a job
                if infra_file_list::stream_key_violation(&org_id, stream_type, &stream_name)
                    .is_some()
                {
                    continue;
                }

                match job_type {
                    CompactionJobType::Current => {
                        if let Err(e) =
                            merge::generate_job_by_stream(&org_id, stream_type, &stream_name).await
                        {
                            log::error!(
                                "[COMPACTOR] generate_job_by_stream [{org_id}/{stream_type}/{stream_name}] error: {e}"
                            );
                        }
                    }
                    CompactionJobType::Historical => {
                        if !COMPACT_OLD_DATA_STREAM_SET.is_empty()
                            && !COMPACT_OLD_DATA_STREAM_SET.contains(&stream_name)
                        {
                            continue;
                        }
                        if let Err(e) = merge::generate_old_data_job_by_stream(
                            &org_id,
                            stream_type,
                            &stream_name,
                        )
                        .await
                        {
                            log::error!(
                                "[COMPACTOR] generate_old_data_job_by_stream [{org_id}/{stream_type}/{stream_name}] error: {e}"
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Generate downsampling job for Metrics
#[cfg(feature = "enterprise")]
pub async fn run_generate_downsampling_job() -> Result<(), anyhow::Error> {
    let grouped = db::schema::list_all_streams_grouped().await;
    for (org_id, mut stream_types) in grouped {
        // check backlist
        if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id)
        {
            continue;
        }
        let stream_type = StreamType::Metrics;
        let streams = stream_types.remove(&stream_type).unwrap_or_default();
        for stream_name in streams {
            let Some(node_name) =
                get_node_from_consistent_hash(&stream_name, &Role::Compactor, None).await
            else {
                continue; // no compactor node
            };
            let downsampling_rules = get_matching_downsampling_rules(&stream_name);
            for rule in downsampling_rules {
                if LOCAL_NODE.name.ne(&node_name) {
                    // Check if this node holds the stream
                    if let Some((offset, _)) = db::compact::downsampling::get_offset_from_cache(
                        &org_id,
                        stream_type,
                        &stream_name,
                        (rule.offset, rule.step),
                    )
                    .await
                    {
                        // release the stream
                        db::compact::downsampling::set_offset(
                            &org_id,
                            stream_type,
                            &stream_name,
                            (rule.offset, rule.step),
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
                        "[DOWNSAMPLING] the stream [{org_id}/{stream_type}/{stream_name}] is deleting, just skip",
                    );
                    continue;
                }
                if infra_file_list::stream_key_violation(&org_id, stream_type, &stream_name)
                    .is_some()
                {
                    continue;
                }

                if let Err(e) = merge::generate_downsampling_job_by_stream_and_rule(
                    &org_id,
                    stream_type,
                    &stream_name,
                    (rule.offset, rule.step),
                )
                .await
                {
                    log::error!(
                        "[DOWNSAMPLING] generate_downsampling_job_by_stream_and_rule [{org_id}/{stream_type}/{stream_name}] rule: {rule:?} error: {e}"
                    );
                }
            }
        }
    }

    Ok(())
}

/// compactor merging
pub async fn run_merge(job_tx: mpsc::Sender<worker::MergeJob>) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let jobs = infra_file_list::get_pending_jobs(
        &LOCAL_NODE.uuid,
        cfg.compact.batch_size,
        cfg.compact.fast_mode,
    )
    .await?;
    if jobs.is_empty() {
        return Ok(());
    }

    let now = config::utils::time::now();
    let data_lifecycle_end = now - Duration::try_days(cfg.compact.data_retention_days).unwrap();

    // if the stream partition_time_level is daily we only allow one compactor
    let mut need_release_ids = Vec::new();
    let mut need_done_ids = Vec::new();
    let mut merge_jobs = Vec::with_capacity(jobs.len());
    for job in jobs {
        if job.offsets == 0 {
            log::error!("[COMPACTOR] merge job offset error: {}", job.offsets);
            continue;
        }
        let columns = job.stream.split('/').collect::<Vec<&str>>();
        assert_eq!(columns.len(), 3);
        let org_id = columns[0].to_string();
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2].to_string();
        let stream_settings = get_settings(&org_id, &stream_name, stream_type)
            .await
            .unwrap_or_default();
        let partition_time_level = get_partition_time_level(stream_type);
        // to avoid compacting conflict with retention, need check the data retention time
        let stream_data_retention_end = if stream_settings.data_retention > 0 {
            now - Duration::try_days(stream_settings.data_retention).unwrap()
        } else {
            data_lifecycle_end
        };
        if job.offsets <= stream_data_retention_end.timestamp_micros() {
            need_done_ids.push(job.id); // the data will be deleted by retention, just skip
            continue;
        }
        // check if we are allowed to merge or just skip
        if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
            need_done_ids.push(job.id); // the data will be deleted by retention, just skip
            continue;
        }
        let dynamic_merge =
            get_stream_setting_dynamic_merge(stream_type, &Some(stream_settings.as_ref()));
        // the day's merge job reads every hour of the day: the day's other jobs go first
        if is_dynamic_day_job(job.offsets, dynamic_merge)
            && day_jobs_unfinished(&org_id, stream_type, &stream_name, job.offsets).await
        {
            need_release_ids.push(job.id);
            continue;
        }
        // and while it runs, an old-data job must not rewrite an hour under it
        if is_dynamic_hour_job(job.offsets, dynamic_merge)
            && day_job_running(&org_id, stream_type, &stream_name, job.offsets).await
        {
            need_release_ids.push(job.id);
            continue;
        }
        if partition_time_level == PartitionTimeLevel::Daily {
            // check if this stream need process by this node
            let Some(node_name) =
                get_node_from_consistent_hash(&stream_name, &Role::Compactor, None).await
            else {
                continue; // no compactor node
            };
            if LOCAL_NODE.name.ne(&node_name) {
                need_release_ids.push(job.id); // not this node
                continue;
            }

            // check if already running a job for this stream
            if db::compact::stream::is_running(&job.stream) {
                need_release_ids.push(job.id); // another job is running
                continue;
            } else {
                db::compact::stream::set_running(&job.stream);
            }
        }
        // collect the merge jobs
        merge_jobs.push(worker::MergeJob {
            org_id,
            stream_type,
            stream_name,
            job_id: job.id,
            offset: job.offsets,
        });
    }

    if !need_release_ids.is_empty() {
        // release those jobs
        if let Err(e) = infra_file_list::set_job_pending(&need_release_ids, 0, None).await {
            log::error!("[COMPACTOR] set_job_pending failed: {e}");
        }
    }

    if !need_done_ids.is_empty() {
        // set those jobs to done
        if let Err(e) = infra_file_list::set_job_done(&need_done_ids).await {
            log::error!("[COMPACTOR] set_job_done failed: {e}");
        }
    }

    // create a thread to keep updating the job status
    //
    // Update job status (updated_at) to prevent pickup by another node
    // convert job_timeout from secs to micros, and check 1/4 of job_timeout
    // why 1/4 of job_run_timeout?
    // because the timeout is for the entire job, we need to update the job status
    // before it timeout, using 1/2 might still risk a timeout, so we use 1/4 for safety
    let ttl = std::cmp::max(60, cfg.compact.job_run_timeout / 4) as u64;
    let job_ids = merge_jobs.iter().map(|job| job.job_id).collect::<Vec<_>>();
    let (_tx, mut rx) = mpsc::channel::<()>(1);
    tokio::task::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                _ = rx.recv() => {
                    log::debug!("[COMPACTOR] update_running_jobs done");
                    return;
                }
            }
            if let Err(e) = infra_file_list::update_running_jobs(&job_ids).await {
                log::error!("[COMPACTOR] update_job_status failed: {e}");
            }
        }
    });

    for job in merge_jobs {
        if let Err(e) = job_tx.send(job.clone()).await {
            log::error!(
                "[COMPACTOR] send merge job to worker failed [{}/{}/{}] error: {e}",
                job.org_id,
                job.stream_type,
                job.stream_name,
            );
        }
    }

    Ok(())
}

/// compactor delay delete files run steps:
/// 1. get pending deleted files from file_list_deleted table, created_at > configured delay
/// 2. delete files from storage
pub async fn run_delay_deletion() -> Result<(), anyhow::Error> {
    let now = Utc::now();
    let time_max =
        now - Duration::try_minutes(get_config().compact.delete_files_delay_minutes).unwrap();
    let time_max = Utc
        .with_ymd_and_hms(
            time_max.year(),
            time_max.month(),
            time_max.day(),
            time_max.hour(),
            time_max.minute(),
            0,
        )
        .unwrap();
    let time_max = time_max.timestamp_micros();
    let orgs = db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        loop {
            match deleted::delete(&org_id, time_max).await {
                Ok(affected) => {
                    if affected == 0 {
                        break;
                    }
                    log::debug!("[COMPACTOR] deleted from file_list_deleted {affected} files");
                }
                Err(e) => {
                    log::error!("[COMPACTOR] delete files error: {e}");
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
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await?;
    }

    Ok(())
}

/// Whether a job of the day past its 00:00 is pending or running; a failed lookup counts as one.
async fn day_jobs_unfinished(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    day_start: i64,
) -> bool {
    let range = (day_start + 1, day_start + day_micros(1) - 1);
    match infra_file_list::has_unfinished_jobs(org_id, stream_type, stream_name, range).await {
        Ok(unfinished) => unfinished,
        Err(e) => {
            log::error!(
                "[COMPACTOR] has_unfinished_jobs [{org_id}/{stream_type}/{stream_name}] failed: {e}"
            );
            true
        }
    }
}

/// Whether the 00:00 job of the hour's day is running; a failed lookup counts as running.
async fn day_job_running(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    offset: i64,
) -> bool {
    let day_start = offset - offset % day_micros(1);
    match infra_file_list::is_job_running(org_id, stream_type, stream_name, day_start).await {
        Ok(running) => running,
        Err(e) => {
            log::error!(
                "[COMPACTOR] is_job_running [{org_id}/{stream_type}/{stream_name}] failed: {e}"
            );
            true
        }
    }
}

/// The 00:00 job of an enabled stream's closed day: the one that merges the day into `DD/00`.
pub(crate) fn is_dynamic_day_job(offset: i64, dynamic_merge: bool) -> bool {
    dynamic_merge && offset % day_micros(1) == 0 && is_past_day(offset)
}

/// An hour job of an enabled stream's closed day: only old data enqueues one.
pub(crate) fn is_dynamic_hour_job(offset: i64, dynamic_merge: bool) -> bool {
    dynamic_merge && offset % day_micros(1) != 0 && is_past_day(offset)
}

/// A day is closed once its last hour is past: no hour of it can receive files any more.
pub(crate) fn is_past_day(offset: i64) -> bool {
    let day = day_micros(1);
    is_past_hour(offset - offset % day + day - 1)
}

pub(crate) fn is_past_hour(offset: i64) -> bool {
    let now = now_micros();
    let hour = hour_micros(1);
    let offset_hour_end = offset - offset % hour + hour;
    now - offset_hour_end > second_micros(get_config().limit.max_file_retention_time as i64) * 3
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The day's merge job waits for the day's other jobs, never for its own row or a done one.
    #[tokio::test]
    async fn test_day_jobs_unfinished_sees_only_the_day_past_its_00_job() {
        infra_file_list::create_table().await.unwrap();
        // the sqlite file outlives a test run
        let stream = &format!("day_jobs_{}", config::ider::generate());
        let day = day_micros(20_000);
        let unfinished = || day_jobs_unfinished("o", StreamType::Logs, stream, day);

        infra_file_list::add_job("o", StreamType::Logs, stream, day)
            .await
            .unwrap();
        infra_file_list::add_job("o", StreamType::Logs, stream, day + day_micros(1))
            .await
            .unwrap();
        assert!(!unfinished().await);

        let hour23 = infra_file_list::add_job("o", StreamType::Logs, stream, day + hour_micros(23))
            .await
            .unwrap();
        assert!(unfinished().await);
        infra_file_list::set_job_done(&[hour23]).await.unwrap();
        assert!(!unfinished().await);
    }

    /// Of a closed day only 00:00 is the day job; the other hours are its hour jobs.
    #[test]
    fn test_dynamic_day_and_hour_jobs_split_a_closed_day() {
        let day = day_micros(20_000);
        let hour15 = day + hour_micros(15);
        assert!(is_dynamic_day_job(day, true));
        assert!(!is_dynamic_hour_job(day, true));
        assert!(is_dynamic_hour_job(hour15, true));
        assert!(!is_dynamic_day_job(hour15, true));
        assert!(!is_dynamic_hour_job(hour15, false));
        // an open day has neither
        let open = now_micros() + hour_micros(1);
        assert!(!is_dynamic_day_job(open, true));
        assert!(!is_dynamic_hour_job(open, true));
    }
}
