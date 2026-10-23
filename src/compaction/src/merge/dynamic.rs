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

//! Dynamic merge: what the 00:00 job of a closed day does with one partition of that day.

use config::meta::stream::{FileKey, MergeStrategy};
use search::datafusion::merge::MergeMode;

use super::{
    metrics::ideal_file_count,
    plan::{BatchLimits, PlannedBatch, size_bounded_groups, split_legacy_metrics},
};

/// A merge must at least halve the file count, so a merged day is not merged again.
const DAY_MERGE_FACTOR: usize = 2;
/// Extra files tolerated on top of the factor before the day is merged.
const DAY_MERGE_SLACK: usize = 4;
/// Position of the hour directory in `files/{org}/{type}/{stream}/YYYY/MM/DD/HH/...`.
const HOUR_SEGMENT: usize = 7;

/// What the dynamic merge job does with one partition of its day.
pub(super) enum DayPlan {
    /// The day holds many more files than its size needs: these batches go to `DD/00`.
    Merge(Vec<PlannedBatch>),
    /// The day stays; its hour-00 files still get their hourly merge.
    Hour00(Vec<FileKey>),
}

/// `prefix` with its hour directory replaced by `00`, where a merged day is written.
pub(super) fn day_prefix(prefix: &str) -> String {
    prefix
        .split('/')
        .enumerate()
        .map(|(i, segment)| if i == HOUR_SEGMENT { "00" } else { segment })
        .collect::<Vec<_>>()
        .join("/")
}

pub(super) fn plan_day(files: Vec<FileKey>, mode: &MergeMode, limits: &BatchLimits<'_>) -> DayPlan {
    if !should_merge_day(&files, limits.max_file_size) {
        return DayPlan::Hour00(hour00_files(files, mode, limits));
    }
    let (mode_files, legacy_files) = split_legacy_metrics(files, mode);
    let mut batches: Vec<PlannedBatch> = time_ordered_groups(legacy_files, limits)
        .into_iter()
        .map(|group| (group, MergeMode::Classic))
        .collect();
    if mode.merges_whole_batch() {
        // series stay together: one batch in (hash, timestamp) order, split by size on output
        if !mode_files.is_empty() {
            batches.push((mode_files, mode.clone()));
        }
    } else {
        batches.extend(
            time_ordered_groups(mode_files, limits)
                .into_iter()
                .map(|group| (group, mode.clone())),
        );
    }
    DayPlan::Merge(batches)
}

fn should_merge_day(files: &[FileKey], max_file_size: usize) -> bool {
    files.len() > DAY_MERGE_FACTOR * ideal_file_count(files, max_file_size) + DAY_MERGE_SLACK
}

/// The files an hourly merge of hour 00 would have queried.
fn hour00_files(
    mut files: Vec<FileKey>,
    mode: &MergeMode,
    limits: &BatchLimits<'_>,
) -> Vec<FileKey> {
    let max_original_size = if mode.merges_whole_batch() {
        i64::MAX
    } else {
        limits.merge_max_original_size
    };
    files.retain(|f| {
        f.key.split('/').nth(HOUR_SEGMENT) == Some("00")
            && f.meta.original_size <= max_original_size
    });
    files
}

/// Size-bounded groups in time order, so each output covers a contiguous range of the day.
fn time_ordered_groups(mut files: Vec<FileKey>, limits: &BatchLimits<'_>) -> Vec<Vec<FileKey>> {
    files.retain(|f| f.meta.original_size <= limits.merge_max_original_size);
    files.sort_by_key(|f| f.meta.min_ts);
    // the file_size strategy stops at the first oversized file; a day is cut in time order
    let limits = BatchLimits {
        strategy: &MergeStrategy::FileTime,
        ..*limits
    };
    size_bounded_groups(&files, &limits)
}

#[cfg(test)]
mod tests {
    use config::{meta::stream::FileMeta, utils::time::hour_micros};

    use super::*;

    const MB: i64 = 1024 * 1024;
    const GB: i64 = 1024 * MB;

    fn limits(strategy: &MergeStrategy) -> BatchLimits<'_> {
        BatchLimits {
            strategy,
            max_file_size: (2 * GB) as usize,
            max_group_files: 10000,
            is_incremental: false,
            merge_max_original_size: 2 * GB * 95 / 100,
        }
    }

    fn file(stream_type: &str, hour: i64, name: &str, original_size: i64) -> FileKey {
        let mut key = FileKey::from_file_name(&format!(
            "files/o/{stream_type}/s/2026/09/30/{hour:02}/{name}.parquet"
        ));
        key.meta = FileMeta {
            min_ts: hour_micros(hour),
            max_ts: hour_micros(hour + 1) - 1,
            records: 100,
            original_size,
            ..Default::default()
        };
        key
    }

    /// One file per hour of `hour_size`.
    fn day(stream_type: &str, name: &str, hour_size: i64) -> Vec<FileKey> {
        (0..24)
            .map(|hour| file(stream_type, hour, &format!("{name}{hour}"), hour_size))
            .collect()
    }

    fn merged(plan: DayPlan) -> Vec<PlannedBatch> {
        match plan {
            DayPlan::Merge(batches) => batches,
            DayPlan::Hour00(_) => panic!("the day was not merged"),
        }
    }

    fn hour00(plan: DayPlan) -> Vec<FileKey> {
        match plan {
            DayPlan::Hour00(files) => files,
            DayPlan::Merge(_) => panic!("the day was merged"),
        }
    }

    #[test]
    fn test_day_prefix_replaces_only_the_hour() {
        assert_eq!(
            day_prefix("files/o/logs/s/2026/09/30/17"),
            "files/o/logs/s/2026/09/30/00"
        );
        assert_eq!(
            day_prefix("files/o/logs/s/2026/09/30/17/k8s_namespace=prod/host=a"),
            "files/o/logs/s/2026/09/30/00/k8s_namespace=prod/host=a"
        );
    }

    /// The design's table: one file per hour against the default 2 GB target.
    #[test]
    fn test_should_merge_day_follows_the_data_volume() {
        let max_file_size = (2 * GB) as usize;
        for (hour_size, merge) in [
            (73 * 1024, true),
            (100 * MB, true),
            (300 * MB, true),
            (500 * MB, true),
            (GB, false),
        ] {
            let files = day("logs", "f", hour_size);
            assert_eq!(
                should_merge_day(&files, max_file_size),
                merge,
                "{hour_size}"
            );
        }
        // many small files in a day satisfy the same inequality
        let mut fragmented = day("logs", "a", GB);
        fragmented.extend(day("logs", "b", GB / 64));
        fragmented.extend(day("logs", "c", GB / 64));
        assert!(should_merge_day(&fragmented, max_file_size));
    }

    #[test]
    fn test_plan_day_logs_outputs_cover_contiguous_time_ranges() {
        let strategy = MergeStrategy::FileSize;
        let limits = limits(&strategy);
        // 7.2 GB in shuffled order: size-bounded groups of 6 hours each
        let mut files = day("logs", "f", 300 * MB);
        files.reverse();
        files.swap(3, 17);
        let batches = merged(plan_day(files, &MergeMode::Classic, &limits));
        assert_eq!(batches.len(), 4);
        let ranges: Vec<(i64, i64)> = batches
            .iter()
            .map(|(files, _)| {
                (
                    files.iter().map(|f| f.meta.min_ts).min().unwrap(),
                    files.iter().map(|f| f.meta.max_ts).max().unwrap(),
                )
            })
            .collect();
        assert!(ranges.windows(2).all(|w| w[0].1 < w[1].0), "{ranges:?}");
        assert!(batches.iter().all(|(files, _)| files.len() == 6));
    }

    /// Running the job again on the merged day does nothing: the policy is idempotent.
    #[test]
    fn test_plan_day_second_run_leaves_a_merged_day_alone() {
        let strategy = MergeStrategy::FileTime;
        let limits = limits(&strategy);
        let batches = merged(plan_day(
            day("logs", "f", 300 * MB),
            &MergeMode::Classic,
            &limits,
        ));
        // each batch becomes one file in DD/00 that spans the batch's hours
        let outputs: Vec<FileKey> = batches
            .iter()
            .enumerate()
            .map(|(i, (files, _))| {
                let mut out = file("logs", 0, &format!("merged{i}"), 0);
                out.meta.min_ts = files.iter().map(|f| f.meta.min_ts).min().unwrap();
                out.meta.max_ts = files.iter().map(|f| f.meta.max_ts).max().unwrap();
                out.meta.original_size = files.iter().map(|f| f.meta.original_size).sum();
                out
            })
            .collect();
        let left = hour00(plan_day(outputs, &MergeMode::Classic, &limits));
        assert_eq!(left.len(), 4);
    }

    #[test]
    fn test_plan_day_skip_keeps_only_the_hour_00_merge_candidates() {
        let strategy = MergeStrategy::FileTime;
        let limits = limits(&strategy);
        // a large stream, plus late data and a full-size file in hour 00
        let mut files = day("logs", "f", GB);
        files.push(file("logs", 0, "late", MB));
        files.push(file("logs", 0, "full", 2 * GB));
        files.push(file("logs", 5, "late", MB));
        let files = hour00(plan_day(files, &MergeMode::Classic, &limits));
        let names: Vec<&str> = files
            .iter()
            .map(|f| f.key.rsplit('/').next().unwrap())
            .collect();
        assert_eq!(names, vec!["f0.parquet", "late.parquet"]);
    }

    /// Indexed metrics keep every series in one batch; legacy files never join it.
    #[test]
    fn test_plan_day_metrics_indexed_is_one_whole_batch() {
        let strategy = MergeStrategy::FileTime;
        let limits = limits(&strategy);
        let mut files = day("metrics", "indexed-v1-", 100 * MB);
        files.push(file("metrics", 3, "legacy-a", MB));
        files.push(file("metrics", 9, "legacy-b", MB));
        let batches = merged(plan_day(files, &MergeMode::MetricsIndexed, &limits));
        assert_eq!(batches.len(), 2);
        let (legacy, indexed): (Vec<_>, Vec<_>) = batches
            .iter()
            .partition(|(_, mode)| matches!(mode, MergeMode::Classic));
        assert_eq!(legacy[0].0.len(), 2);
        assert_eq!(indexed[0].0.len(), 24);
        assert!(matches!(indexed[0].1, MergeMode::MetricsIndexed));
    }
}
