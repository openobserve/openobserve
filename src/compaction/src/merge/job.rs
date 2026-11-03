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

use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::stream::{PartitionTimeLevel, StreamType},
    utils::time::{HourFormat, day_micros, get_ymdh_from_micros, hour_micros},
};
use infra::{
    cluster::get_node_by_uuid,
    dist_lock, file_list as infra_file_list,
    schema::{
        get_dynamic_merge, get_partition_time_level, get_stream_setting_dynamic_merge,
        unwrap_stream_created_at,
    },
};

use super::dynamic::merged_by_day;

/// What the merge job at `offset` covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum JobScope {
    /// The stream's own partition: an hour, or the day for daily-partitioned types.
    Partition(PartitionTimeLevel),
    /// The whole day, downsampled; the output stays in the hour directories unless merged by day.
    DownsampledDay,
    /// The whole day under the dynamic merge policy; merged output goes to `DD/00`.
    DynamicDay,
}

impl JobScope {
    /// A merged day holds one file set, so a downsample over it must not split by hour.
    pub(super) fn groups_by_day(self, dynamic_day: bool) -> bool {
        match self {
            Self::DynamicDay => true,
            Self::DownsampledDay => dynamic_day,
            Self::Partition(_) => false,
        }
    }

    pub(super) fn time_level(self) -> PartitionTimeLevel {
        match self {
            Self::Partition(level) => level,
            Self::DownsampledDay | Self::DynamicDay => PartitionTimeLevel::Daily,
        }
    }
}

/// Last microsecond of the range a merge job at `offset` covers: the hour of
/// `offset`, or the whole day for daily-partitioned streams. No file of the
/// job can be newer, so "is the range old enough" is decided against this.
pub(super) fn job_range_end(offset: i64, partition_time_level: PartitionTimeLevel) -> i64 {
    let offset = offset - offset % hour_micros(1);
    if partition_time_level == PartitionTimeLevel::Daily {
        offset - offset % day_micros(1) + day_micros(1) - 1
    } else {
        offset + hour_micros(1) - 1
    }
}

/// Only a 00:00 job widens to its day: downsampled if `has_rule(day end)`, else by `dynamic_day`.
pub(super) fn job_scope(
    stream_type: StreamType,
    offset: i64,
    finalize: bool,
    dynamic_day: bool,
    has_rule: impl Fn(i64) -> bool,
) -> JobScope {
    let partition = JobScope::Partition(get_partition_time_level(stream_type));
    if offset % day_micros(1) != 0 {
        return partition;
    }
    if finalize
        && stream_type == StreamType::Metrics
        && has_rule(job_range_end(offset, PartitionTimeLevel::Daily))
    {
        return JobScope::DownsampledDay;
    }
    if dynamic_day {
        JobScope::DynamicDay
    } else {
        partition
    }
}

/// Generate merging job by stream
/// 1. get offset from db
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_job_by_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    // get last compacted offset
    let (mut offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!("/compact/merge/{org_id}/{stream_type}/{stream_name}");
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::files::set_offset(
            org_id,
            stream_type,
            stream_name,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    // get schema
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_created = unwrap_stream_created_at(&schema).unwrap_or_default();
    if offset == 0 && stream_created > 0 {
        offset = stream_created
    } else if offset == 0 {
        return Ok(()); // no data
    }

    // format to hour with zero minutes, seconds
    let offset = offset - offset % hour_micros(1);
    if !crate::is_past_hour(offset) {
        return Ok(()); // the time is future, just wait
    }

    log::debug!(
        "[COMPACTOR] generate_job_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    // generate merging job
    if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
        return Err(anyhow::anyhow!(
            "[COMPACTOR] add file_list_jobs failed: {e}"
        ));
    }
    // here, not in the merge: a merge of an hour without files returns before it could re-arm
    if let Some(day_offset) = dynamic_merge_offset(offset)
        && get_dynamic_merge(org_id, stream_name, stream_type).await
        && let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, day_offset).await
    {
        return Err(anyhow::anyhow!(
            "[COMPACTOR] add file_list_jobs for dynamic merge failed: {e}"
        ));
    }

    // write new offset
    let offset = offset + hour_micros(1);
    db::compact::files::set_offset(
        org_id,
        stream_type,
        stream_name,
        offset,
        Some(&LOCAL_NODE.uuid.clone()),
    )
    .await?;

    Ok(())
}

/// Generate merging job by stream
/// 1. get old data by hour
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_old_data_job_by_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    // get last compacted offset
    let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!("/compact/merge/{org_id}/{stream_type}/{stream_name}");
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::files::set_offset(
            org_id,
            stream_type,
            stream_name,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    if offset == 0 {
        return Ok(()); // no data
    }

    let cfg = get_config();
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    let mut stream_data_retention_days = cfg.compact.data_retention_days;
    if stream_settings.data_retention > 0 {
        stream_data_retention_days = stream_settings.data_retention;
    }
    if stream_data_retention_days > cfg.compact.old_data_max_days {
        stream_data_retention_days = cfg.compact.old_data_max_days;
    }
    if stream_data_retention_days == 0 {
        return Ok(()); // no need to check old data
    }

    // get old data by hour, `offset - cfg.compact.old_data_min_hours hours` as old data
    let end_time = offset - hour_micros(cfg.compact.old_data_min_hours);
    let start_time = end_time
        - Duration::try_days(stream_data_retention_days)
            .unwrap()
            .num_microseconds()
            .unwrap();
    let hours = infra_file_list::query_old_data_hours(
        org_id,
        stream_type,
        stream_name,
        (start_time, end_time - 1),
    )
    .await?;

    // generate merging job
    let dynamic_merge =
        get_stream_setting_dynamic_merge(stream_type, &Some(stream_settings.as_ref()));
    let mut merged_days = HashMap::new();
    let mut offsets = BTreeSet::new();
    for hour in hours {
        let column = hour.split('/').collect::<Vec<_>>();
        if column.len() != 4 {
            return Err(anyhow::anyhow!(
                "Unexpected hour format in {hour}, Expected format YYYY/MM/DD/HH",
            ));
        }
        let offset = DateTime::parse_from_rfc3339(&format!(
            "{}-{}-{}T{}:00:00Z",
            column[0], column[1], column[2], column[3]
        ))?
        .with_timezone(&Utc);
        let mut offset = offset.timestamp_micros();
        if dynamic_merge {
            offset =
                merged_day_job_offset(org_id, stream_type, stream_name, offset, &mut merged_days)
                    .await?;
        }
        log::debug!(
            "[COMPACTOR] generate_old_data_job_by_stream [{org_id}/{stream_type}/{stream_name}] hours: {hour}, offset: {offset}"
        );
        offsets.insert(offset);
    }
    for offset in offsets {
        if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
            return Err(anyhow::anyhow!(
                "[COMPACTOR] add file_list_jobs for old data failed: {e}"
            ));
        }
    }

    Ok(())
}

/// Generate downsampling job by stream and rule
/// 1. get offset from db
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_downsampling_job_by_stream_and_rule(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    rule: (i64, i64), // offset, step
) -> Result<(), anyhow::Error> {
    assert!(stream_type == StreamType::Metrics);
    // get last compacted offset
    let (mut offset, node) =
        db::compact::downsampling::get_offset(org_id, stream_type, stream_name, rule).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!(
            "/compact/downsampling/{org_id}/{stream_type}/{stream_name}/{}/{}",
            rule.0, rule.1
        );
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) =
            db::compact::downsampling::get_offset(org_id, stream_type, stream_name, rule).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::downsampling::set_offset(
            org_id,
            stream_type,
            stream_name,
            rule,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    // get schema
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_created = unwrap_stream_created_at(&schema).unwrap_or_default();
    if offset == 0 {
        offset = stream_created
    }
    if offset == 0 {
        return Ok(()); // no data
    }
    // only a 00:00 job covers the whole day, see job_scope
    let offset = offset - offset % day_micros(1);

    let cfg = get_config();
    // check offset
    let time_now: DateTime<Utc> = Utc::now();
    let time_now_day = Utc
        .with_ymd_and_hms(time_now.year(), time_now.month(), time_now.day(), 0, 0, 0)
        .unwrap()
        .timestamp_micros();
    // must wait for at least 3 * max_file_retention_time + 1 day
    // -- first period: the last hour local file upload to storage, write file list
    // -- second period, the last hour file list upload to storage
    // -- third period, we can do the merge, so, at least 3 times of
    // -- 1 day, downsampling is in day level
    // max_file_retention_time
    // enqueued before the whole day passes the rule offset, the job runs as a plain merge
    let job_end_ts = job_range_end(offset, PartitionTimeLevel::Daily);
    if offset >= time_now_day
        || time_now.timestamp_micros() - offset
            <= Duration::try_seconds(cfg.limit.max_file_retention_time as i64)
                .unwrap()
                .num_microseconds()
                .unwrap()
                * 3
                + day_micros(1)
        || time_now.timestamp_micros() - rule.0 * 1_000_000 < job_end_ts
    {
        return Ok(()); // the time is future, just wait
    }

    log::debug!(
        "[DOWNSAMPLING] generate_downsampling_job_by_stream_and_rule [{org_id}/{stream_type}/{stream_name}] rule: {rule:?}, offset: {offset}"
    );

    // generate downsampling job
    if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
        return Err(anyhow::anyhow!(
            "[DOWNSAMPLING] add file_list_jobs failed: {e}"
        ));
    }

    // write new offset
    let offset = offset + day_micros(1);
    // format to day with zero hour, minutes, seconds
    let offset = offset - offset % day_micros(1);
    db::compact::downsampling::set_offset(
        org_id,
        stream_type,
        stream_name,
        rule,
        offset,
        Some(&LOCAL_NODE.uuid.clone()),
    )
    .await?;

    Ok(())
}

/// The 00:00 job to re-arm along with the job for `offset`: at hour 00 the day before is closed.
fn dynamic_merge_offset(offset: i64) -> Option<i64> {
    (offset % day_micros(1) == 0).then(|| offset - day_micros(1))
}

/// An old hour of a closed day merged by day re-arms the day's 00:00 job: its files go to `DD/00`.
async fn merged_day_job_offset(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    offset: i64,
    merged_days: &mut HashMap<i64, bool>,
) -> Result<i64, anyhow::Error> {
    let day = offset - offset % day_micros(1);
    if offset == day || !crate::is_past_day(offset) {
        return Ok(offset);
    }
    let merged = match merged_days.get(&day) {
        Some(merged) => *merged,
        None => {
            let hour00 = get_ymdh_from_micros(day, HourFormat::Zero);
            let files = infra_file_list::query_for_merge(
                org_id,
                stream_type,
                stream_name,
                (hour00.clone(), hour00),
                i64::MAX,
            )
            .await?;
            *merged_days.entry(day).or_insert(merged_by_day(&files))
        }
    };
    Ok(if merged { day } else { offset })
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta};

    use super::*;

    #[test]
    fn test_job_range_end_hourly_and_daily() {
        // 2026-08-18 10:10:00 UTC
        let offset = Utc
            .with_ymd_and_hms(2026, 8, 18, 10, 10, 0)
            .unwrap()
            .timestamp_micros();
        assert_eq!(
            job_range_end(offset, PartitionTimeLevel::Hourly),
            Utc.with_ymd_and_hms(2026, 8, 18, 11, 0, 0)
                .unwrap()
                .timestamp_micros()
                - 1
        );
        assert_eq!(
            job_range_end(offset, PartitionTimeLevel::Daily),
            Utc.with_ymd_and_hms(2026, 8, 19, 0, 0, 0)
                .unwrap()
                .timestamp_micros()
                - 1
        );
    }

    fn day_start() -> i64 {
        Utc.with_ymd_and_hms(2026, 8, 18, 0, 0, 0)
            .unwrap()
            .timestamp_micros()
    }

    #[test]
    fn test_job_scope_downsampled_day_only_for_a_matching_rule() {
        let day = day_start();
        let day_end = day + day_micros(1) - 1;
        let metrics = StreamType::Metrics;
        let hourly = JobScope::Partition(PartitionTimeLevel::Hourly);

        // the rule is asked about the end of the day, not of hour 00
        let scope = job_scope(metrics, day, true, false, |max_ts| max_ts == day_end);
        assert_eq!(scope, JobScope::DownsampledDay);
        assert_eq!(scope.time_level(), PartitionTimeLevel::Daily);

        // no rule for the day end: the plain hour-00 merge stays hourly
        assert_eq!(job_scope(metrics, day, true, false, |_| false), hourly);
        // other hours, open hours and other stream types never widen
        let hour5 = day + hour_micros(5);
        assert_eq!(job_scope(metrics, hour5, true, false, |_| true), hourly);
        assert_eq!(job_scope(metrics, day, false, false, |_| true), hourly);
        assert_eq!(
            job_scope(StreamType::Logs, day, true, false, |_| true),
            hourly
        );
    }

    /// The 00:00 job is the dynamic merge job only for an enabled stream's closed day.
    #[test]
    fn test_job_scope_dynamic_day() {
        let day = day_start();
        let hourly = JobScope::Partition(PartitionTimeLevel::Hourly);
        let logs = StreamType::Logs;
        assert_eq!(
            job_scope(logs, day, true, true, |_| false),
            JobScope::DynamicDay
        );
        // not enabled, or the day is still open
        assert_eq!(job_scope(logs, day, true, false, |_| false), hourly);
        // a downsampling rule takes the day first
        let scope = job_scope(StreamType::Metrics, day, true, true, |_| true);
        assert_eq!(scope, JobScope::DownsampledDay);
    }

    /// A downsample splits by hour unless the day is dynamically merged.
    #[test]
    fn test_groups_by_day_follows_the_dynamic_day() {
        assert!(JobScope::DynamicDay.groups_by_day(true));
        assert!(JobScope::DownsampledDay.groups_by_day(true));
        assert!(!JobScope::DownsampledDay.groups_by_day(false));
        assert!(!JobScope::Partition(PartitionTimeLevel::Hourly).groups_by_day(true));
    }

    #[test]
    fn test_dynamic_merge_offset_rearms_the_day_before_at_hour_00() {
        let day = day_start();
        assert_eq!(dynamic_merge_offset(day), Some(day - day_micros(1)));
        assert_eq!(dynamic_merge_offset(day + hour_micros(1)), None);
    }

    /// An old hour of a day merged by day re-arms the day's 00:00 job instead of its own.
    #[tokio::test]
    async fn test_merged_day_job_offset_follows_the_files_of_hour_00() {
        infra_file_list::create_table().await.unwrap();
        // the sqlite file outlives a test run
        let stream = &format!("merged_day_{}", config::ider::generate());
        let day = day_start();
        let hour15 = day + hour_micros(15);
        let hour00_file = |name: &str, max_ts: i64| {
            FileKey::new(
                0,
                "default".to_string(),
                format!("files/old/logs/{stream}/2026/08/18/00/{name}.parquet"),
                FileMeta {
                    min_ts: day + 1,
                    max_ts,
                    records: 1,
                    original_size: 1,
                    compressed_size: 1,
                    ..Default::default()
                },
                false,
            )
        };
        let offset = |offset: i64| async move {
            merged_day_job_offset("old", StreamType::Logs, stream, offset, &mut HashMap::new())
                .await
                .unwrap()
        };

        // an hourly file of hour 00 does not make a merged day
        let hourly = hour00_file("hourly", day + hour_micros(1) - 2);
        infra_file_list::batch_add(&[hourly]).await.unwrap();
        assert_eq!(offset(hour15).await, hour15);

        let merged = hour00_file("merged", day + hour_micros(24) - 2);
        infra_file_list::batch_add(&[merged]).await.unwrap();
        assert_eq!(offset(hour15).await, day);
        assert_eq!(offset(day).await, day);
    }
}
