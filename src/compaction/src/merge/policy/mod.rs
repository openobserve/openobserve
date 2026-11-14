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

//! The merge rules: which rule a window follows is decided here, what a rule reads and how it
//! batches lives in its own file.

#[cfg(feature = "enterprise")]
mod downsampling;
mod metrics_closed_hour;
mod metrics_open_hour;
mod size_bounded;

use std::sync::Arc;

use arrow_schema::Schema;
use chrono::{TimeZone, Utc};
#[cfg(feature = "enterprise")]
use config::meta::promql::DownsamplingRule;
use config::{
    Config,
    meta::stream::{
        FileKey, MergeStrategy, PartitionTimeLevel, StreamParams, StreamSettings, StreamType,
    },
    utils::time::{hour_micros, now_micros},
};
use infra::schema::get_partition_time_level_at;
use metrics_index::{MetricsFileLayout, metrics_index_stream};
use search::merge::MergeMode;

use super::job::{job_range_end, scheduling_level};

/// One planned merge: the files and the mode they merge in.
pub(super) type PlannedBatch = (Vec<FileKey>, MergeMode);

/// The size rules one merge round batches files under.
pub(super) struct BatchLimits<'a> {
    pub strategy: &'a MergeStrategy,
    pub max_file_size: usize,
    pub max_group_files: usize,
    /// The hour is still open: an unfilled trailing group waits for more files.
    pub is_incremental: bool,
    /// The classic merge query's cap: larger files are at their target size.
    pub merge_max_original_size: i64,
    /// Most sorted inputs (merge groups) one metrics merge may open; 0 is no cap.
    pub max_merge_groups: usize,
}

impl<'a> BatchLimits<'a> {
    pub(super) fn from_config(
        cfg: &Config,
        strategy: &'a MergeStrategy,
        is_incremental: bool,
    ) -> Self {
        Self {
            strategy,
            max_file_size: cfg.compact.max_file_size,
            max_group_files: cfg.compact.max_group_files,
            is_incremental,
            merge_max_original_size: infra::file_list::merge_max_original_size(),
            max_merge_groups: cfg.compact.metrics_max_groups,
        }
    }
}

/// What one round merges in a partition of the window.
#[derive(Debug)]
pub(super) struct RoundPlan {
    pub batches: Vec<PlannedBatch>,
    /// These batches only prepare the window: it is planned again once they are committed.
    pub needs_another_round: bool,
}

impl RoundPlan {
    fn new(batches: Vec<PlannedBatch>) -> Self {
        Self {
            batches,
            needs_another_round: false,
        }
    }

    fn with_another_round(mut self) -> Self {
        self.needs_another_round = true;
        self
    }
}

#[derive(Debug)]
pub(super) struct MergePolicy {
    window: MergeWindow,
    rule: MergeRule,
}

impl MergePolicy {
    pub(super) fn resolve(
        stream: &StreamParams,
        schema: &Schema,
        settings: Option<&StreamSettings>,
        offset: i64,
    ) -> Self {
        let offset = offset - offset % hour_micros(1);
        let job_level = scheduling_level(stream.stream_type, settings, offset);
        let partition_level = get_partition_time_level_at(stream.stream_type, settings, offset);
        let now = now_micros();
        let is_incremental = is_incremental(
            job_range_end(offset, job_level),
            now,
            crate::settle_micros(),
        );
        let (read_level, rule) =
            MergeRule::select(stream, schema, offset, partition_level, is_incremental, now);
        let window = MergeWindow::new(stream, offset, job_level, read_level, is_incremental);
        Self { window, rule }
    }

    pub(super) async fn plan(
        &self,
        files: Vec<FileKey>,
        limits: &BatchLimits<'_>,
        schema: &Arc<Schema>,
    ) -> RoundPlan {
        let mut plan = match &self.rule {
            MergeRule::SizeBounded(mode) => size_bounded::plan(&files, limits, mode),
            MergeRule::MetricsOpenHour => metrics_open_hour::plan(files, limits),
            MergeRule::MetricsClosedHour => {
                metrics_closed_hour::plan(files, limits, schema, &self.window.stream()).await
            }
            #[cfg(feature = "enterprise")]
            MergeRule::Downsampling(rule) => downsampling::plan(files, rule),
        };
        plan.batches.retain(|(files, _)| !files.is_empty());
        plan
    }

    pub(super) fn window(&self) -> &MergeWindow {
        &self.window
    }

    pub(super) fn reads_whole_window(&self) -> bool {
        match &self.rule {
            MergeRule::SizeBounded(_) => size_bounded::READS_WHOLE_WINDOW,
            MergeRule::MetricsOpenHour => metrics_open_hour::READS_WHOLE_WINDOW,
            MergeRule::MetricsClosedHour => metrics_closed_hour::READS_WHOLE_WINDOW,
            #[cfg(feature = "enterprise")]
            MergeRule::Downsampling(_) => downsampling::READS_WHOLE_WINDOW,
        }
    }
}

#[derive(Debug)]
enum MergeRule {
    SizeBounded(MergeMode),
    MetricsOpenHour,
    MetricsClosedHour,
    #[cfg(feature = "enterprise")]
    Downsampling(DownsamplingRule),
}

impl MergeRule {
    fn select(
        stream: &StreamParams,
        schema: &Schema,
        _offset: i64,
        partition_level: PartitionTimeLevel,
        is_incremental: bool,
        _now: i64,
    ) -> (PartitionTimeLevel, Self) {
        #[cfg(feature = "enterprise")]
        if let Some(selection) =
            downsampling::select(stream, _offset, partition_level, is_incremental, _now)
        {
            return selection;
        }
        (
            partition_level,
            Self::for_stream(stream, schema, is_incremental),
        )
    }

    fn for_stream(stream: &StreamParams, schema: &Schema, is_incremental: bool) -> Self {
        if metrics_index_stream(stream.stream_type, schema) {
            return if is_incremental {
                Self::MetricsOpenHour
            } else {
                Self::MetricsClosedHour
            };
        }
        Self::SizeBounded(MergeMode::for_stream(
            stream.stream_type,
            &stream.stream_name,
        ))
    }
}

#[derive(Debug)]
pub(super) struct MergeWindow {
    pub(super) org_id: String,
    pub(super) stream_type: StreamType,
    pub(super) stream_name: String,
    pub(super) offset: i64,
    pub(super) job_end: i64,
    pub(super) is_incremental: bool,
    pub(super) merges_by_day: bool,
    pub(super) date_start: String,
    pub(super) date_end: String,
}

impl MergeWindow {
    pub(super) fn stream(&self) -> String {
        format!("{}/{}/{}", self.org_id, self.stream_type, self.stream_name)
    }

    fn new(
        stream: &StreamParams,
        offset: i64,
        job_level: PartitionTimeLevel,
        read_level: PartitionTimeLevel,
        is_incremental: bool,
    ) -> Self {
        let offset = offset - offset % hour_micros(1);
        let (date_start, date_end) = date_range(offset, read_level);
        Self {
            org_id: stream.org_id.to_string(),
            stream_type: stream.stream_type,
            stream_name: stream.stream_name.to_string(),
            offset,
            job_end: job_range_end(offset, job_level),
            is_incremental,
            // A wider read range must not combine hourly partitions into daily output.
            merges_by_day: job_level == PartitionTimeLevel::Daily,
            date_start,
            date_end,
        }
    }
}

fn date_range(offset: i64, level: PartitionTimeLevel) -> (String, String) {
    let offset_time = Utc.timestamp_nanos(offset * 1000);
    if level == PartitionTimeLevel::Daily {
        (
            offset_time.format("%Y/%m/%d/00").to_string(),
            offset_time.format("%Y/%m/%d/23").to_string(),
        )
    } else {
        (
            offset_time.format("%Y/%m/%d/%H").to_string(),
            offset_time.format("%Y/%m/%d/%H").to_string(),
        )
    }
}

fn is_incremental(job_end: i64, now: i64, settle_delay: i64) -> bool {
    let hour = hour_micros(1);
    let end = job_end - job_end % hour + hour;
    now - end <= settle_delay
}

/// Legacy metrics files never join a hash-ordered batch: sorting them would
/// be a full sort of the hour. Returns `(hash-ordered files, legacy files)`.
fn split_legacy_metrics(files: Vec<FileKey>) -> (Vec<FileKey>, Vec<FileKey>) {
    files
        .into_iter()
        .partition(|f| MetricsFileLayout::is_hash_ordered(&f.key))
}

/// The classic size-bounded merges the legacy files of a metrics-index hour keep.
fn legacy_batches(mut files: Vec<FileKey>, limits: &BatchLimits<'_>) -> Vec<PlannedBatch> {
    // a whole-hour query lists every file; the classic merge never rewrites the full-sized ones
    files.retain(|f| f.meta.original_size <= limits.merge_max_original_size);
    size_bounded::batches(&files, limits, &MergeMode::Classic)
}

/// `files` in chunks of at most `max_files` (0: one chunk); a lone trailing file is left out.
fn mergeable_chunks(files: Vec<FileKey>, max_files: usize) -> Vec<Vec<FileKey>> {
    if max_files == 0 {
        return vec![files];
    }
    // a lone trailing file has nothing to merge with and waits for the next round
    files
        .chunks(max_files)
        .filter(|chunk| chunk.len() > 1)
        .map(<[FileKey]>::to_vec)
        .collect()
}

#[cfg(test)]
mod tests {
    use config::{
        meta::stream::{FileMeta, PartitionTimeLevelChange},
        utils::time::day_micros,
    };

    use super::*;

    pub(super) fn create_file_key(
        key: &str,
        min_ts: i64,
        max_ts: i64,
        original_size: i64,
    ) -> FileKey {
        FileKey {
            id: 0,
            account: "test_account".to_string(),
            key: key.to_string(),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: 100,
                original_size,
                compressed_size: original_size / 2,
                index_size: 0,
                mindex_size: 0,
                flattened: false,
                bloom_ver: 0,
            },
            deleted: false,
            selection: None,
            row_group_size: None,
        }
    }

    pub(super) fn limits(
        strategy: &MergeStrategy,
        max_group_files: usize,
        is_incremental: bool,
    ) -> BatchLimits<'_> {
        BatchLimits {
            strategy,
            max_file_size: 1000,
            max_group_files,
            is_incremental,
            merge_max_original_size: 950,
            max_merge_groups: 100,
        }
    }

    pub(super) fn schema() -> Arc<Schema> {
        Arc::new(Schema::empty())
    }

    pub(super) fn metrics_file(name: &str, size: i64) -> FileKey {
        create_file_key(
            &format!("files/default/metrics/m/2026/08/18/10/{name}"),
            10,
            20,
            size,
        )
    }

    pub(super) fn names(files: &[FileKey]) -> Vec<&str> {
        files
            .iter()
            .map(|f| f.key.rsplit('/').next().unwrap())
            .collect()
    }

    pub(super) fn hash_file(name: &str, compressed_size: i64) -> FileKey {
        let mut file = metrics_file(name, compressed_size * 40);
        file.meta.compressed_size = compressed_size;
        file
    }

    pub(super) fn test_policy(rule: MergeRule) -> MergePolicy {
        MergePolicy {
            window: MergeWindow {
                org_id: "default".to_string(),
                stream_type: StreamType::Metrics,
                stream_name: "test".to_string(),
                offset: day(),
                job_end: day() + hour_micros(1) - 1,
                is_incremental: matches!(rule, MergeRule::MetricsOpenHour),
                merges_by_day: false,
                date_start: "2026/08/18/00".to_string(),
                date_end: "2026/08/18/00".to_string(),
            },
            rule,
        }
    }

    pub(super) fn day() -> i64 {
        Utc.with_ymd_and_hms(2026, 8, 18, 0, 0, 0)
            .unwrap()
            .timestamp_micros()
    }

    fn resolve_at(
        stream: &StreamParams,
        schema: &Schema,
        offset: i64,
        partition_level: PartitionTimeLevel,
        now: i64,
    ) -> MergePolicy {
        let job_level = if stream.stream_type.support_dynamic_partition() {
            partition_level
        } else {
            PartitionTimeLevel::Hourly
        };
        let is_incremental = is_incremental(job_range_end(offset, job_level), now, 10);
        let window = MergeWindow::new(stream, offset, job_level, partition_level, is_incremental);
        let rule = MergeRule::for_stream(stream, schema, is_incremental);
        MergePolicy { window, rule }
    }

    pub(super) fn indexed_schema() -> Schema {
        Schema::new(vec![arrow_schema::Field::new(
            config::meta::promql::HASH_LABEL,
            arrow_schema::DataType::UInt64,
            false,
        )])
    }

    #[test]
    fn test_resolve_policy_by_stream_and_window_state() {
        let plain = Schema::empty();
        let hashed = indexed_schema();
        let resolve = |stream_type, name, schema, closed| {
            resolve_at(
                &StreamParams::new("default", name, stream_type),
                schema,
                day(),
                PartitionTimeLevel::Hourly,
                day() + hour_micros(1) + 10 + i64::from(closed),
            )
        };
        assert!(matches!(
            resolve(StreamType::Traces, "app", &plain, true).rule,
            MergeRule::SizeBounded(MergeMode::Classic)
        ));
        assert!(matches!(
            resolve(StreamType::Filelist, "x", &plain, false).rule,
            MergeRule::SizeBounded(MergeMode::FileList)
        ));
        assert!(matches!(
            resolve(StreamType::Metrics, "cpu", &plain, true).rule,
            MergeRule::SizeBounded(MergeMode::Classic)
        ));
        assert!(matches!(
            resolve(StreamType::Metrics, "cpu", &hashed, false).rule,
            MergeRule::MetricsOpenHour
        ));
        assert!(matches!(
            resolve(StreamType::Metrics, "cpu", &hashed, true).rule,
            MergeRule::MetricsClosedHour
        ));
        assert!(!test_policy(MergeRule::SizeBounded(MergeMode::Classic)).reads_whole_window());
        assert!(test_policy(MergeRule::MetricsOpenHour).reads_whole_window());
        assert!(test_policy(MergeRule::MetricsClosedHour).reads_whole_window());
    }

    #[test]
    fn test_resolve_window_preserves_job_and_read_ranges() {
        let plain = Schema::empty();
        let hourly = PartitionTimeLevel::Hourly;
        let daily = PartitionTimeLevel::Daily;
        for (stream_type, job_level, read_level, offset, start, end) in [
            (
                StreamType::Logs,
                hourly,
                hourly,
                day() + hour_micros(10) + 123,
                "10",
                "10",
            ),
            (
                StreamType::Logs,
                daily,
                daily,
                day() + hour_micros(10) + 123,
                "00",
                "23",
            ),
            (StreamType::Metrics, hourly, hourly, day(), "00", "00"),
            (
                StreamType::Filelist,
                hourly,
                daily,
                day() + hour_micros(10),
                "00",
                "23",
            ),
            (
                StreamType::Metadata,
                hourly,
                PartitionTimeLevel::Unset,
                day() + hour_micros(5),
                "05",
                "05",
            ),
        ] {
            let policy = resolve_at(
                &StreamParams::new("default", "cpu", stream_type),
                &plain,
                offset,
                read_level,
                day() + day_micros(2),
            );
            let window = policy.window();
            let aligned = offset - offset % hour_micros(1);
            assert_eq!(window.offset, aligned);
            assert_eq!(window.job_end, job_range_end(aligned, job_level));
            assert_eq!(window.date_start, format!("2026/08/18/{start}"));
            assert_eq!(window.date_end, format!("2026/08/18/{end}"));
            assert_eq!(window.merges_by_day, job_level == daily);
            assert!(!window.is_incremental);
        }
    }

    #[test]
    fn test_resolve_settle_boundary_uses_the_scheduled_job_end() {
        let schema = indexed_schema();
        for job_level in [PartitionTimeLevel::Hourly, PartitionTimeLevel::Daily] {
            let job_end = job_range_end(day(), job_level);
            for (delta, incremental) in [(-1, true), (0, true), (1, false)] {
                let policy = resolve_at(
                    &StreamParams::new("default", "cpu", StreamType::Metrics),
                    &schema,
                    day(),
                    job_level,
                    job_end + 1 + 10 + delta,
                );
                assert_eq!(policy.window().is_incremental, incremental);
                assert_eq!(policy.window().job_end, job_end);
                assert_eq!(
                    matches!(policy.rule, MergeRule::MetricsOpenHour),
                    incremental
                );
                assert_eq!(
                    matches!(policy.rule, MergeRule::MetricsClosedHour),
                    !incremental
                );
            }
        }
    }

    #[test]
    fn test_resolve_uses_historical_partition_settings() {
        let plain = Schema::empty();
        let mut settings = StreamSettings::default();
        settings.partition_time_level.changes = vec![
            PartitionTimeLevelChange {
                since: day(),
                level: PartitionTimeLevel::Daily,
            },
            PartitionTimeLevelChange {
                since: day() + day_micros(1),
                level: PartitionTimeLevel::Hourly,
            },
        ];
        for (offset, expected_end, merges_by_day) in [
            (day() + hour_micros(5), "2026/08/18/23", true),
            (
                day() + day_micros(1) + hour_micros(5),
                "2026/08/19/05",
                false,
            ),
        ] {
            let policy = MergePolicy::resolve(
                &StreamParams::new("default", "test", StreamType::Logs),
                &plain,
                Some(&settings),
                offset,
            );
            assert_eq!(policy.window().date_end, expected_end);
            assert_eq!(policy.window().merges_by_day, merges_by_day);
            let level = if merges_by_day {
                PartitionTimeLevel::Daily
            } else {
                PartitionTimeLevel::Hourly
            };
            assert_eq!(policy.window().job_end, job_range_end(offset, level));
        }
        let policy = MergePolicy::resolve(
            &StreamParams::new("default", "test", StreamType::Filelist),
            &plain,
            Some(&settings),
            day() + hour_micros(5),
        );
        assert_eq!(policy.window().date_end, "2026/08/18/23");
        assert_eq!(policy.window().job_end, day() + hour_micros(6) - 1);
        assert!(!policy.window().merges_by_day);
    }
}
