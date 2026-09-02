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

/// Splits a partition's files into merge batches. Legacy metrics files never
/// join a hash-ordered batch: sorting them would be a full sort of the hour,
/// so they keep their classic size-bounded merges beside the hash group.
#[allow(clippy::too_many_arguments)]
pub(super) fn plan_batches(
    mut files: Vec<FileKey>,
    mode: &MergeMode,
    job_strategy: &MergeStrategy,
    max_file_size: usize,
    max_group_files: usize,
    is_incremental: bool,
    stream: &str,
) -> Vec<PlannedBatch> {
    let mut batches = Vec::new();
    if mode.metrics_file_layout().is_some() {
        let (hash_files, legacy_files): (Vec<_>, Vec<_>) = files
            .into_iter()
            .partition(|f| MetricsFileLayout::of(&f.key).is_some());
        files = hash_files;
        for group in size_bounded_groups(
            &legacy_files,
            job_strategy,
            max_file_size,
            max_group_files,
            is_incremental,
        ) {
            batches.push((group, MergeMode::Classic));
        }
    }
    // what a closed indexed metrics hour merges, see [`MetricsIndexMergeScope`]
    if mode.is_metrics_indexed() {
        match metrics_index_merge_scope(&files, max_file_size) {
            MetricsIndexMergeScope::Skip => files.clear(),
            MetricsIndexMergeScope::LateFilesOnly => {
                files.retain(|f| MetricsFileLayout::of(&f.key) != Some(MetricsFileLayout::Indexed));
                log::debug!(
                    "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed late merge of {} files, indexed files untouched",
                    files.len()
                );
            }
            MetricsIndexMergeScope::WholeHour => {
                log::debug!(
                    "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed fragmentation cap hit, full rewrite of {} files",
                    files.len()
                );
            }
        }
    }
    if mode.merges_whole_batch() {
        if !files.is_empty() {
            batches.push((files, mode.clone()));
        }
    } else {
        for group in size_bounded_groups(
            &files,
            job_strategy,
            max_file_size,
            max_group_files,
            is_incremental,
        ) {
            batches.push((group, mode.clone()));
        }
    }
    batches
}

/// Size-bounded merge groups in the planner's file order.
fn size_bounded_groups(
    files: &[FileKey],
    job_strategy: &MergeStrategy,
    max_file_size: usize,
    max_group_files: usize,
    is_incremental: bool,
) -> Vec<Vec<FileKey>> {
    let max_file_size = max_file_size as i64;
    let mut groups = Vec::new();
    let mut new_file_list: Vec<FileKey> = Vec::new();
    let mut new_file_size = 0;
    for file in files {
        if new_file_size + file.meta.original_size > max_file_size
            || (max_group_files > 0 && new_file_list.len() >= max_group_files)
        {
            if new_file_list.len() <= 1 {
                if *job_strategy == MergeStrategy::FileSize {
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
    if new_file_list.len() > 1 && !is_incremental {
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
            &MergeStrategy::FileSize,
            1000,
            0,
            false,
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
            &MergeStrategy::FileTime,
            1000,
            0,
            true,
            "test",
        );
        assert_eq!(batches.len(), 1, "{batches:?}");
        let (legacy, mode) = &batches[0];
        assert!(matches!(mode, MergeMode::Classic), "{mode}");
        assert_eq!(names(legacy), ["1.parquet", "2.parquet", "3.parquet"]);
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
            &MergeStrategy::FileSize,
            1000,
            0,
            false,
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
        let closed = size_bounded_groups(&files, &MergeStrategy::FileTime, 1000, 0, false);
        assert_eq!(closed.len(), 2);
        assert_eq!(names(&closed[1]), ["4.parquet", "5.parquet"]);
        // open hour: the remainder waits for more files
        let open = size_bounded_groups(&files, &MergeStrategy::FileTime, 1000, 0, true);
        assert_eq!(open.len(), 1);
        // a group cap seals every two files
        let capped = size_bounded_groups(&files, &MergeStrategy::FileTime, 1000, 2, false);
        assert_eq!(capped.len(), 2);
    }
}
