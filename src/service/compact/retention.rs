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

use std::{collections::HashMap, path::PathBuf};

use chrono::{DateTime, Duration, TimeZone, Utc};
use config::{
    cluster::LOCAL_NODE,
    get_config, is_local_disk_storage,
    meta::stream::{
        FileKey, FileListBookKeepMode, FileListDeleted, PartitionTimeLevel, StreamType, TimeRange,
    },
    utils::time::{BASE_TIME, day_micros, get_ymdh_from_micros, hour_micros},
};
use infra::{
    cluster::get_node_by_uuid, file_list as infra_file_list,
    table::compactor_manual_jobs::Status as CompactorManualJobStatus,
};
use itertools::Itertools;

use crate::service::{db, file_list, file_list_dump::generate_dump_stream_name};

/// This function will split the original time range based on the exclude range
/// It expects a mutable reference to a Vec which will be populated with the split time ranges
/// The limit for the red day retention period considered is extended_data_retention_days +
/// data_retention_days.
/// The original time range will change as per the exclude range. There are two cases which can
/// occur
/// 1. The exclude range is completely inside the original time range
///   - in this case the original time range will be updated to the last split range
/// 2. The exclude range is partially inside the original time range
///   - in this case the original time range will be updated to an empty range
///
/// Returns the number of jobs created
fn generate_time_ranges_for_deletion(
    extended_retention_ranges: Vec<TimeRange>,
    original_time_range: TimeRange,
    last_retained_time: i64,
) -> Vec<TimeRange> {
    // first we flatten out the overlapping red days
    let extended_retention_ranges_iter =
        TimeRange::flatten_overlapping_ranges(extended_retention_ranges).into_iter();

    log::debug!(
        "[COMPACTOR] populate_time_ranges_for_deletion exclude_range: {}, original_time_range: {}",
        extended_retention_ranges_iter.clone().join(", "),
        original_time_range.clone()
    );

    let filtered_extended_ranges = extended_retention_ranges_iter
        // filter out the ranges which are out of scope and mutate the ranges which are partially
        // inside the original time range
        .filter_map(|range| {
            if range.start > original_time_range.end {
                None
            } else if range.end > original_time_range.end {
                Some(TimeRange::new(
                    range.start,
                    original_time_range.end,
                ))
            } else {
                Some(range)
            }
        })
        // filter out the ranges which are older than the last retained time
        .filter_map(|range| {
            if range.end < last_retained_time {
                None
            } else if range.start < last_retained_time {
                Some(TimeRange::new(
                    last_retained_time,
                    range.end,
                ))
            } else {
                Some(range)
            }
        })
        // sort the ranges by start time
        .sorted_by(|x, x1| x.start.cmp(&x1.start))
        .collect::<Vec<TimeRange>>();

    let mut time_ranges_for_deletion = vec![];
    let mut last_split_range_opt = Some(original_time_range);

    for mut extended_range in filtered_extended_ranges {
        if let Some(ref last_split_range) = last_split_range_opt {
            if extended_range.end + hour_micros(24) != last_split_range.end {
                extended_range.end += hour_micros(24); // add one day to make it exclusive
            }
            match last_split_range.split_by_range(&extended_range) {
                Ok((Some(left), Some(right))) => {
                    time_ranges_for_deletion.push(left);
                    last_split_range_opt = Some(right);
                }
                Ok((None, Some(right))) => {
                    last_split_range_opt = Some(right);
                }
                Ok((Some(left), None)) => {
                    time_ranges_for_deletion.push(left);
                    last_split_range_opt = None;
                    break;
                }
                Ok((None, None)) => {
                    last_split_range_opt = None;
                    break;
                }
                Err(_) => {
                    // if the split fails then we can skip the range
                    continue;
                }
            }
        } else {
            break;
        }
    }

    if let Some(range) = last_split_range_opt {
        time_ranges_for_deletion.push(range);
    }

    log::debug!(
        "[COMPACTOR] populate_time_ranges_for_deletion time_ranges_for_deletion: {}",
        time_ranges_for_deletion.iter().join(", ")
    );

    time_ranges_for_deletion
}

/// Generate delete jobs for the stream based on the stream settings
pub async fn generate_retention_job(
    lifecycle_end: &DateTime<Utc>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    extended_retentions: &[TimeRange],
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // get min date from file_list
    let min_date = infra::file_list::get_min_date(org_id, stream_type, stream_name, None).await?;
    let min_date = if !cfg.compact.file_list_dump_enabled {
        min_date
    } else {
        // get min date from dump stream
        let dump_stream_name = generate_dump_stream_name(stream_type, stream_name);
        let dump_min_date =
            infra::file_list::get_min_date(org_id, StreamType::Filelist, &dump_stream_name, None)
                .await?;
        if min_date.is_empty() {
            dump_min_date
        } else if dump_min_date.is_empty() {
            min_date
        } else if min_date > dump_min_date {
            dump_min_date
        } else {
            min_date
        }
    };

    if min_date.is_empty() {
        return Ok(()); // no data, just skip
    }
    let min_date = format!("{min_date}/00/00+0000");
    let created_at =
        DateTime::parse_from_str(&min_date, "%Y/%m/%d/%H/%M/%S%z")?.with_timezone(&Utc);
    if created_at.ge(lifecycle_end) {
        return Ok(()); // created_at is after lifecycle end, just skip
    }

    // last extended retention time
    let last_retained_time = (*lifecycle_end
        - Duration::try_days(get_config().compact.extended_data_retention_days).unwrap())
    .timestamp_micros();
    // time range of deletion
    let original_deletion_time_range = TimeRange::new(
        created_at.timestamp_micros(),
        lifecycle_end.timestamp_micros(),
    );

    let final_deletion_time_ranges = if extended_retentions.is_empty() {
        vec![original_deletion_time_range]
    } else {
        let ranges = generate_time_ranges_for_deletion(
            extended_retentions.to_vec(),
            original_deletion_time_range,
            last_retained_time,
        );
        log::debug!(
            "[COMPACTOR] extended_retentions: {}, final_deletion_time_ranges: {}",
            extended_retentions.iter().join(", "),
            ranges.iter().join(", ")
        );
        ranges
    };

    let created_at_micros = created_at.timestamp_micros();
    for time_range in final_deletion_time_ranges {
        // check the min_date again in this range because of the extended retention days
        let mut start = if time_range.start <= created_at_micros {
            created_at_micros
        } else {
            // check the min_date again maybe there is no data in this range
            let start_date = get_ymdh_from_micros(time_range.start);
            let end_date = get_ymdh_from_micros(time_range.end);
            let min_date = infra::file_list::get_min_date(
                org_id,
                stream_type,
                stream_name,
                Some((start_date.clone(), end_date.clone())),
            )
            .await?;
            if min_date.is_empty() {
                continue; // no data, just skip
            }
            let min_date = format!("{min_date}/00/00+0000");
            let created_at =
                DateTime::parse_from_str(&min_date, "%Y/%m/%d/%H/%M/%S%z")?.with_timezone(&Utc);
            created_at.timestamp_micros()
        };
        // generate jobs by date
        while start < time_range.end {
            let time_range_start = Utc
                .timestamp_nanos(start * 1000)
                .format("%Y-%m-%d")
                .to_string();
            start += day_micros(1); // increase one day
            let time_range_end = Utc
                .timestamp_nanos(start * 1000)
                .format("%Y-%m-%d")
                .to_string();
            if time_range_start >= time_range_end {
                continue;
            }

            let (_key, created) = db::compact::retention::delete_stream(
                org_id,
                stream_type,
                stream_name,
                Some((time_range_start.as_str(), time_range_end.as_str())),
            )
            .await?;
            if created {
                log::info!(
                    "[COMPACTOR] generate_retention_job: generated job for {org_id}/{stream_type}/{stream_name}/{time_range_start},{time_range_end}",
                );
            }
        }
    }

    Ok(())
}

pub async fn delete_all(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let node = db::compact::retention::get_stream(org_id, stream_type, stream_name, None).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        log::warn!("[COMPACTOR] stream {org_id}/{stream_type}/{stream_name} is deleting by {node}");
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the stream
    db::compact::retention::process_stream(
        org_id,
        stream_type,
        stream_name,
        None,
        &LOCAL_NODE.uuid.clone(),
    )
    .await?;

    let start_time = BASE_TIME.timestamp_micros();
    let end_time = Utc::now().timestamp_micros();

    let cfg = get_config();
    if is_local_disk_storage() {
        let data_dir = format!(
            "{}files/{org_id}/{stream_type}/{stream_name}",
            cfg.common.data_stream_dir
        );
        let path = std::path::Path::new(&data_dir);
        if path.exists() {
            tokio::fs::remove_dir_all(path).await?;
        }
        log::info!("deleted all files: {path:?}");
    }

    // delete from file list
    delete_from_file_list(org_id, stream_type, stream_name, (start_time, end_time)).await?;
    super::dump::delete_all(org_id, stream_type, stream_name).await?;
    log::info!("deleted file list for: {org_id}/{stream_type}/{stream_name}/all");

    // mark delete done
    db::compact::retention::delete_stream_done(org_id, stream_type, stream_name, None).await?;
    log::info!("deleted stream all: {org_id}/{stream_type}/{stream_name}");

    Ok(())
}

pub async fn delete_by_date(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: (&str, &str),
) -> Result<(), anyhow::Error> {
    let node =
        db::compact::retention::get_stream(org_id, stream_type, stream_name, Some(date_range))
            .await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        log::warn!(
            "[COMPACTOR] stream {org_id}/{stream_type}/{stream_name}/{date_range:?} is deleting by {node}"
        );
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the stream
    db::compact::retention::process_stream(
        org_id,
        stream_type,
        stream_name,
        Some(date_range),
        &LOCAL_NODE.uuid.clone(),
    )
    .await?;
    // same date, just mark delete done
    if date_range.0 == date_range.1 {
        // mark delete done
        return handle_delete_by_date_done(org_id, stream_type, stream_name, date_range).await;
    }

    let is_hourly = date_range.0.ends_with("00Z") || date_range.1.ends_with("00Z");
    let mut date_start = if is_hourly {
        DateTime::parse_from_rfc3339(date_range.0)?.with_timezone(&Utc)
    } else {
        DateTime::parse_from_rfc3339(&format!("{}T00:00:00Z", date_range.0))?.with_timezone(&Utc)
    };
    // Hack for 1970-01-01
    if date_range.0.starts_with("1970-01-01") {
        date_start += Duration::try_milliseconds(1).unwrap();
    }
    let date_end = if is_hourly {
        DateTime::parse_from_rfc3339(date_range.1)?.with_timezone(&Utc)
    } else {
        DateTime::parse_from_rfc3339(&format!("{}T00:00:00Z", date_range.1))?.with_timezone(&Utc)
    };
    let time_range = {
        (
            date_start.timestamp_micros(),
            date_end.timestamp_micros() - 1,
        )
    };

    if is_local_disk_storage() {
        let dirs_to_delete =
            generate_local_dirs(org_id, stream_type, stream_name, date_start, date_end);
        // Delete all collected directories in parallel
        let mut delete_tasks = vec![];
        for dir in dirs_to_delete {
            log::info!(
                "[COMPACTOR] stream {org_id}/{stream_type}/{stream_name} delete dir: {dir:?}"
            );
            delete_tasks.push(tokio::fs::remove_dir_all(dir));
        }
        futures::future::try_join_all(delete_tasks).await?;
    }

    // delete from file list
    log::info!(
        "[COMPACTOR] delete_by_date: delete_from_file_list {}/{}/{}, date_range: [{}, {}]",
        org_id,
        stream_type,
        stream_name,
        get_ymdh_from_micros(time_range.0),
        get_ymdh_from_micros(time_range.1),
    );
    delete_from_file_list(org_id, stream_type, stream_name, time_range)
        .await
        .map_err(|e| {
            log::error!("[COMPACTOR] delete_by_date delete_from_file_list failed: {e}");
            e
        })?;
    super::dump::delete_by_time_range(org_id, stream_type, stream_name, time_range, is_hourly)
        .await
        .map_err(|e| {
            log::error!("[COMPACTOR] delete_by_date delete_file_list_dump failed: {e}");
            e
        })?;

    // archive old schema versions
    let mut schema_versions =
        infra::schema::get_versions(org_id, stream_name, stream_type, Some(time_range)).await?;
    // pop last version, it's the current version
    schema_versions.pop();
    for schema in schema_versions {
        let start_dt: i64 = match schema.metadata().get("start_dt") {
            Some(v) => v.parse().unwrap_or_default(),
            None => 0,
        };
        if start_dt == 0 {
            continue;
        }
        infra::schema::history::create(org_id, stream_type, stream_name, start_dt, schema).await?;
        infra::schema::delete(org_id, stream_type, stream_name, Some(start_dt)).await?;
    }

    // update stream stats retention time
    let stats_data_range = ("".to_string(), super::stats::get_yesterday_boundary());
    if let Err(e) = super::stats::update_stats_from_file_list_for_stream(
        org_id,
        stream_type,
        stream_name,
        stats_data_range,
        false,
    )
    .await
    {
        log::error!("[COMPACTOR] delete_by_date update stats failed: {e}");
        return Err(e);
    }

    // mark delete done
    handle_delete_by_date_done(org_id, stream_type, stream_name, date_range).await
}

pub async fn delete_from_file_list(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: (i64, i64),
) -> Result<(), anyhow::Error> {
    let task_id = tokio::task::try_id()
        .map(|id| id.to_string())
        .unwrap_or_else(|| rand::random::<u64>().to_string());
    let fake_trace_id = format!(
        "delete_from_file_list-{}-{}-{}",
        task_id, time_range.0, time_range.1
    );
    let files = file_list::query(
        &fake_trace_id,
        org_id,
        stream_type,
        stream_name,
        PartitionTimeLevel::Unset,
        time_range.0,
        time_range.1,
    )
    .await?;
    if files.is_empty() {
        return Ok(());
    }

    let mut hours_files: HashMap<String, Vec<FileKey>> = HashMap::with_capacity(24);
    for mut file in files {
        let columns: Vec<_> = file.key.split('/').collect();
        let hour_key = format!(
            "{}/{}/{}/{}",
            columns[4], columns[5], columns[6], columns[7]
        );
        let entry = hours_files.entry(hour_key).or_default();
        file.deleted = true;
        entry.push(file);
    }
    // generate a new array and sort by key
    let mut hours_files = hours_files.into_iter().collect::<Vec<_>>();
    hours_files.sort_by(|(k1, _), (k2, _)| k1.cmp(k2));

    // write file list to storage
    write_file_list(org_id, hours_files).await?;

    Ok(())
}

// write file list to db, all the files should be deleted
async fn write_file_list(
    org_id: &str,
    hours_files: Vec<(String, Vec<FileKey>)>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    for (_, events) in hours_files {
        // set to db, retry 5 times
        let mut success = false;
        let created_at = Utc::now().timestamp_micros();
        for _ in 0..5 {
            // only store the file_list into history, don't delete files
            if cfg
                .compact
                .file_list_deleted_mode
                .eq(&FileListBookKeepMode::History.to_string())
            {
                let events = events
                    .iter()
                    .map(|v| FileKey {
                        deleted: false,
                        ..v.clone()
                    })
                    .collect::<Vec<_>>();
                if let Err(e) = infra_file_list::batch_add_history(&events).await {
                    log::error!("[COMPACTOR] file_list batch_add_history failed: {}", e);
                    return Err(e.into());
                }
            }
            // delete from file_list table
            if let Err(e) = infra_file_list::batch_process(&events).await {
                log::error!("[COMPACTOR] batch_delete to db failed, retrying: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
            // store to file_list_deleted table, pending delete
            if cfg
                .compact
                .file_list_deleted_mode
                .eq(&FileListBookKeepMode::Deleted.to_string())
            {
                let del_items = events
                    .iter()
                    .map(|v| FileListDeleted {
                        id: 0,
                        account: v.account.clone(),
                        file: v.key.clone(),
                        index_file: v.meta.index_size > 0,
                        flattened: v.meta.flattened,
                    })
                    .collect::<Vec<_>>();
                if let Err(e) =
                    infra_file_list::batch_add_deleted(org_id, created_at, &del_items).await
                {
                    log::error!("[COMPACTOR] batch_add_deleted to db failed, retrying: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            }
            success = true;
            break;
        }
        if !success {
            return Err(anyhow::anyhow!("[COMPACTOR] batch_write to db failed"));
        }
    }
    Ok(())
}

fn generate_local_dirs(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    mut date_start: DateTime<Utc>,
    date_end: DateTime<Utc>,
) -> Vec<PathBuf> {
    let cfg = get_config();
    let mut dirs_to_delete = Vec::new();
    while date_start < date_end {
        let day_dir = format!(
            "{}files/{org_id}/{stream_type}/{stream_name}/{}",
            cfg.common.data_stream_dir,
            date_start.format("%Y/%m/%d")
        );
        let day_path = std::path::Path::new(&day_dir);
        if day_path.exists() {
            dirs_to_delete.push(day_path.to_path_buf());
        }
        // index data
        let day_dir = format!(
            "{}files/{org_id}/index/{stream_name}_{stream_type}/{}",
            cfg.common.data_stream_dir,
            date_start.format("%Y/%m/%d")
        );
        let day_path = std::path::Path::new(&day_dir);
        if day_path.exists() {
            dirs_to_delete.push(day_path.to_path_buf());
        }
        date_start += Duration::days(1); // Move to the next day
    }

    dirs_to_delete
}

// helper to mark delete done and update job status
async fn handle_delete_by_date_done(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: (&str, &str),
) -> Result<(), anyhow::Error> {
    // mark delete done
    db::compact::retention::delete_stream_done(org_id, stream_type, stream_name, Some(date_range))
        .await
        .map_err(|e| {
            log::error!("[COMPACTOR] delete_by_date mark delete done failed: {e}");
            e
        })?;

    // Check if the key is also present in the `compactor_manual_jobs` table
    // If it is, mark the job as completed
    let mut jobs = db::compact::compactor_manual_jobs::list_jobs_by_key(
        org_id,
        stream_type,
        stream_name,
        Some(date_range),
    )
    .await;

    jobs.iter_mut().for_each(|job| {
        job.status = CompactorManualJobStatus::Completed;
        job.ended_at = Utc::now().timestamp_micros();
    });

    // Note: Manual job operations are isolated - any errors are logged and ignored
    // to prevent them from affecting the main compactor retention job
    let _ = db::compact::compactor_manual_jobs::bulk_update_jobs(jobs)
        .await
        .map_err(|e| {
            log::error!("[COMPACTOR] delete_by_date bulk update manual job failed: {e}");
            e
        });

    Ok(())
}

#[cfg(test)]
mod tests {
    use itertools::Itertools;

    use super::*;

    #[tokio::test]
    async fn test_generate_retention_job() {
        infra_file_list::create_table().await.unwrap();
        let org_id = "test";
        let stream_name = "test";
        let stream_type = config::meta::stream::StreamType::Logs;
        let lifecycle_end = DateTime::parse_from_rfc3339("2023-01-01T00:00:00Z")
            .unwrap()
            .to_utc();
        let res =
            generate_retention_job(&lifecycle_end, org_id, stream_type, stream_name, &[]).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_delete_all() {
        infra_file_list::create_table().await.unwrap();
        let org_id = "test";
        let stream_name = "test";
        let stream_type = config::meta::stream::StreamType::Logs;
        let res = delete_all(org_id, stream_type, stream_name).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_populate_time_ranges() {
        let now = Utc::now();
        let exclude_range = TimeRange::new(
            (now - Duration::try_days(2).unwrap()).timestamp_micros(),
            (now - Duration::try_days(1).unwrap()).timestamp_micros(),
        );
        let original_time_range = TimeRange::new(
            (now - Duration::try_days(2).unwrap()).timestamp_micros(),
            now.timestamp_micros(),
        );
        let last_retained_time = (now - Duration::try_days(5).unwrap()).timestamp_micros();
        println!("original time range : {original_time_range}");
        println!("red day time range : {exclude_range}");
        let time_ranges_to_delete = generate_time_ranges_for_deletion(
            vec![exclude_range],
            original_time_range.clone(),
            last_retained_time,
        );
        assert_eq!(time_ranges_to_delete.len(), 1);
        println!(
            "res time ranges : {}",
            time_ranges_to_delete.iter().join(", ")
        );
    }

    #[tokio::test]
    async fn test_populate_time_ranges_contains() {
        let now = Utc::now();
        let original_time_range = TimeRange::new(
            (now - Duration::try_days(15).unwrap()).timestamp_micros(),
            now.timestamp_micros(),
        );
        let exclude_range = TimeRange::new(
            (now - Duration::try_days(3).unwrap()).timestamp_micros(),
            (now - Duration::try_days(2).unwrap()).timestamp_micros(),
        );
        let last_retained_time = (now - Duration::try_days(5).unwrap()).timestamp_micros();
        println!("original time range : {original_time_range}");
        println!("red day time range : {exclude_range}");
        let res_time_ranges = generate_time_ranges_for_deletion(
            vec![exclude_range],
            original_time_range.clone(),
            last_retained_time,
        );
        assert_eq!(res_time_ranges.len(), 2);
        println!("res time ranges : {}", res_time_ranges.iter().join(", "));
        assert!(res_time_ranges[0].intersects(&original_time_range));
    }

    #[tokio::test]
    async fn test_populate_time_ranges_intersecting_ext_ret_days() {
        let now = Utc::now();
        let exclude_range_1 = TimeRange::new(
            (now - Duration::try_days(20).unwrap()).timestamp_micros(),
            (now - Duration::try_days(10).unwrap()).timestamp_micros(),
        );
        let exclude_range_2 = TimeRange::new(
            (now - Duration::try_days(15).unwrap()).timestamp_micros(),
            (now - Duration::try_days(5).unwrap()).timestamp_micros(),
        );

        let time_range =
            TimeRange::flatten_overlapping_ranges(vec![exclude_range_1, exclude_range_2]);

        assert_eq!(time_range.len(), 1);
    }

    #[tokio::test]
    async fn test_populate_time_ranges_out_of_last_retained_period() {
        let now = Utc::now();
        let exclude_ranges = vec![
            TimeRange::new(
                (now - Duration::try_days(20).unwrap()).timestamp_micros(),
                (now - Duration::try_days(10).unwrap()).timestamp_micros(),
            ),
            TimeRange::new(
                (now - Duration::try_days(8).unwrap()).timestamp_micros(),
                (now - Duration::try_days(5).unwrap()).timestamp_micros(),
            ),
        ];

        let original_time_range = TimeRange::new(
            (now - Duration::try_days(30).unwrap()).timestamp_micros(),
            now.timestamp_micros(),
        );
        let last_retained_time = (now - Duration::try_days(5).unwrap()).timestamp_micros();
        let res_time_ranges = generate_time_ranges_for_deletion(
            exclude_ranges,
            original_time_range.clone(),
            last_retained_time,
        );

        println!("original time range : {original_time_range}");
        println!("res time ranges : {}", res_time_ranges.iter().join(", "));
        assert_eq!(res_time_ranges.len(), 2);
    }
}
