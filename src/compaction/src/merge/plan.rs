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

//! Turns one partition's files into merge batches: size-bounded groups, and
//! for metrics the split that keeps legacy files out of hash-ordered merges.

use config::meta::stream::{FileKey, MergeStrategy};
use metrics_index::MetricsFileLayout;
use search::datafusion::merge::MergeMode;

use super::metrics::{MetricsIndexMergeScope, metrics_index_merge_scope};

/// One planned merge: the files and the mode they merge in.
type PlannedBatch = (Vec<FileKey>, MergeMode);

/// The size rules one merge round batches files under.
pub(super) struct BatchLimits<'a> {
    pub strategy: &'a MergeStrategy,
    pub max_file_size: usize,
    pub max_group_files: usize,
    /// The hour is still open: an unfilled trailing group waits for more files.
    pub is_incremental: bool,
    /// The classic merge query's cap: larger files are at their target size.
    pub merge_max_original_size: i64,
}

/// Splits a partition's files into merge batches: the legacy metrics files
/// keep their classic size-bounded merges, everything else merges in `mode`.
pub(super) fn plan_batches(
    files: Vec<FileKey>,
    mode: &MergeMode,
    limits: &BatchLimits<'_>,
    stream: &str,
) -> Vec<PlannedBatch> {
    let (mode_files, mut legacy_files) = split_legacy_metrics(files, mode);
    // a whole-hour query lists every file; the classic merge never rewrites the full-sized ones
    legacy_files.retain(|f| f.meta.original_size <= limits.merge_max_original_size);
    let mut batches: Vec<PlannedBatch> = size_bounded_groups(&legacy_files, limits)
        .into_iter()
        .map(|group| (group, MergeMode::Classic))
        .collect();

    let mode_files = indexed_hour_scope(mode_files, mode, limits.max_file_size, stream);
    if mode.merges_whole_batch() {
        if !mode_files.is_empty() {
            batches.push((mode_files, mode.clone()));
        }
    } else {
        batches.extend(
            size_bounded_groups(&mode_files, limits)
                .into_iter()
                .map(|group| (group, mode.clone())),
        );
    }
    batches
}

/// Legacy metrics files never join a hash-ordered batch: sorting them would
/// be a full sort of the hour. Returns `(files for the mode, legacy files)`.
fn split_legacy_metrics(files: Vec<FileKey>, mode: &MergeMode) -> (Vec<FileKey>, Vec<FileKey>) {
    if mode.metrics_file_layout().is_none() {
        return (files, Vec::new());
    }
    files
        .into_iter()
        .partition(|f| MetricsFileLayout::of(&f.key).is_some())
}

/// What a closed indexed metrics hour merges, see [`MetricsIndexMergeScope`].
fn indexed_hour_scope(
    mut files: Vec<FileKey>,
    mode: &MergeMode,
    max_file_size: usize,
    stream: &str,
) -> Vec<FileKey> {
    if !mode.is_metrics_indexed() {
        return files;
    }
    match metrics_index_merge_scope(&files, max_file_size) {
        MetricsIndexMergeScope::Skip => Vec::new(),
        MetricsIndexMergeScope::LateFilesOnly => {
            files.retain(|f| MetricsFileLayout::of(&f.key) != Some(MetricsFileLayout::Indexed));
            log::debug!(
                "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed late merge of {} files, indexed files untouched",
                files.len()
            );
            files
        }
        MetricsIndexMergeScope::WholeHour => {
            log::debug!(
                "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed fragmentation cap hit, full rewrite of {} files",
                files.len()
            );
            files
        }
    }
}

/// Size-bounded merge groups in the planner's file order.
fn size_bounded_groups(files: &[FileKey], limits: &BatchLimits<'_>) -> Vec<Vec<FileKey>> {
    let max_file_size = limits.max_file_size as i64;
    let max_group_files = limits.max_group_files;
    let mut groups = Vec::new();
    let mut new_file_list: Vec<FileKey> = Vec::new();
    let mut new_file_size = 0;
    for file in files {
        if new_file_size + file.meta.original_size > max_file_size
            || (max_group_files > 0 && new_file_list.len() >= max_group_files)
        {
            if new_file_list.len() <= 1 {
                if *limits.strategy == MergeStrategy::FileSize {
                    break;
                }
                new_file_list.clear();
                new_file_size = file.meta.original_size;
                new_file_list.push(file.clone());
                continue; // replace previous file with current file
            }
            groups.push(std::mem::take(&mut new_file_list));
            new_file_size = 0;
        }
        new_file_size += file.meta.original_size;
        new_file_list.push(file.clone());
    }
    // The trailing batch is always below max_file_size (the loop flushes a group
    // only when adding the next file would exceed it). In incremental mode we do
    // NOT seal this remainder: more files will arrive in the still-open hour, and
    // sealing now would force re-merging it later (write amplification). Carry it
    // to the next round; the scheduled hour-end pass seals whatever is left.
    if new_file_list.len() > 1 && !limits.is_incremental {
        groups.push(new_file_list);
    }
    groups
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn create_file_key(key: &str, min_ts: i64, max_ts: i64, original_size: i64) -> FileKey {
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
                flattened: false,
                bloom_ver: 0,
            },
            deleted: false,
            selection: None,
            row_group_size: None,
        }
    }

    fn limits(
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
        }
    }

    fn metrics_file(name: &str, size: i64) -> FileKey {
        create_file_key(
            &format!("files/default/metrics/m/2026/08/18/10/{name}"),
            10,
            20,
            size,
        )
    }

    fn names(files: &[FileKey]) -> Vec<&str> {
        files
            .iter()
            .map(|f| f.key.rsplit('/').next().unwrap())
            .collect()
    }

    /// A closed hour with legacy and hash-ordered files: the legacy files get
    /// their classic size-bounded merge, the hash files one indexed batch, and
    /// no batch mixes the layouts (that would sort the whole hour).
    #[test]
    fn test_plan_batches_keeps_legacy_metrics_out_of_the_indexed_merge() {
        let files = vec![
            metrics_file("1.parquet", 300),
            metrics_file("hash-sorted-v1-2.parquet", 300),
            metrics_file("3.parquet", 300),
            metrics_file("hash-sorted-v1-4.parquet", 300),
        ];
        let batches = plan_batches(
            files,
            &MergeMode::MetricsIndexed,
            &limits(&MergeStrategy::FileSize, 0, false),
            "test",
        );
        assert_eq!(batches.len(), 2, "{batches:?}");
        let (legacy, mode) = &batches[0];
        assert!(matches!(mode, MergeMode::Classic), "{mode}");
        assert_eq!(names(legacy), ["1.parquet", "3.parquet"]);
        let (hash, mode) = &batches[1];
        assert!(matches!(mode, MergeMode::MetricsIndexed), "{mode}");
        assert_eq!(
            names(hash),
            ["hash-sorted-v1-2.parquet", "hash-sorted-v1-4.parquet"]
        );
    }

    /// In the still-open hour the legacy files keep the incremental rules:
    /// a full group is sealed, the remainder waits, and the hash files never
    /// join it.
    #[test]
    fn test_plan_batches_incremental_legacy_group_seals_only_full_groups() {
        let mut files: Vec<FileKey> = (1..=4)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        files.push(metrics_file("hash-sorted-v1-5.parquet", 300));
        files.push(metrics_file("hash-sorted-v1-6.parquet", 300));
        let batches = plan_batches(
            files,
            &MergeMode::MetricsHashSorted,
            &limits(&MergeStrategy::FileTime, 0, true),
            "test",
        );
        assert_eq!(batches.len(), 1, "{batches:?}");
        let (legacy, mode) = &batches[0];
        assert!(matches!(mode, MergeMode::Classic), "{mode}");
        assert_eq!(names(legacy), ["1.parquet", "2.parquet", "3.parquet"]);
    }

    /// The whole-hour listing includes legacy files the classic query caps
    /// away; they stay untouched instead of being rewritten with a small file.
    #[test]
    fn test_plan_batches_legacy_files_at_target_size_are_left_alone() {
        let files = vec![
            metrics_file("1.parquet", 960),
            metrics_file("2.parquet", 10),
            metrics_file("hash-sorted-v1-3.parquet", 300),
        ];
        let batches = plan_batches(
            files,
            &MergeMode::MetricsIndexed,
            &limits(&MergeStrategy::FileTime, 0, false),
            "test",
        );
        assert_eq!(batches.len(), 1, "{batches:?}");
        assert!(matches!(batches[0].1, MergeMode::MetricsIndexed));
        assert_eq!(names(&batches[0].0), ["hash-sorted-v1-3.parquet"]);
    }

    #[test]
    fn test_plan_batches_all_indexed_hour_is_skipped() {
        let files = vec![
            metrics_file("indexed-v1-1.parquet", 300),
            metrics_file("indexed-v1-2.parquet", 300),
            metrics_file("7.parquet", 300),
            metrics_file("8.parquet", 300),
        ];
        let batches = plan_batches(
            files,
            &MergeMode::MetricsIndexed,
            &limits(&MergeStrategy::FileSize, 0, false),
            "test",
        );
        // the indexed files are left alone; the legacy pair still merges classic
        assert_eq!(batches.len(), 1, "{batches:?}");
        assert!(matches!(batches[0].1, MergeMode::Classic));
        assert_eq!(names(&batches[0].0), ["7.parquet", "8.parquet"]);
    }

    #[test]
    fn test_size_bounded_groups_seal_rules() {
        let files: Vec<FileKey> = (1..=5)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        // closed hour: [1,2,3] sealed by size, the [4,5] remainder sealed too
        let closed = size_bounded_groups(&files, &limits(&MergeStrategy::FileTime, 0, false));
        assert_eq!(closed.len(), 2);
        assert_eq!(names(&closed[1]), ["4.parquet", "5.parquet"]);
        // open hour: the remainder waits for more files
        let open = size_bounded_groups(&files, &limits(&MergeStrategy::FileTime, 0, true));
        assert_eq!(open.len(), 1);
        // a group cap seals every two files
        let capped = size_bounded_groups(&files, &limits(&MergeStrategy::FileTime, 2, false));
        assert_eq!(capped.len(), 2);
    }
}
