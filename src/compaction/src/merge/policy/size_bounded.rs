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

//! The default rule: files merge in groups up to the size target, in the stream's plain mode.

use config::meta::stream::{FileKey, MergeStrategy};
use search::merge::MergeMode;

use super::{BatchLimits, PlannedBatch, RoundPlan};

/// Files already at the size target are left alone, so the window query skips them.
pub(super) const READS_WHOLE_WINDOW: bool = false;

pub(super) fn plan(files: &[FileKey], limits: &BatchLimits<'_>, mode: &MergeMode) -> RoundPlan {
    RoundPlan::new(batches(files, limits, mode))
}

/// Size-bounded groups of `files`, each merged in `mode`.
pub(super) fn batches(
    files: &[FileKey],
    limits: &BatchLimits<'_>,
    mode: &MergeMode,
) -> Vec<PlannedBatch> {
    size_bounded_groups(files, limits)
        .into_iter()
        .map(|group| within_size_target(group, limits.max_file_size as i64))
        // a group cut down to one file has nothing left to merge with
        .filter(|group| group.len() > 1)
        .map(|group| (group, mode.clone()))
        .collect()
}

/// The leading files of `group` whose original and compressed sizes both sum within the target.
fn within_size_target(group: Vec<FileKey>, max_file_size: i64) -> Vec<FileKey> {
    let mut original_size = 0;
    let mut compressed_size = 0;
    group
        .into_iter()
        .take_while(|file| {
            original_size += file.meta.original_size;
            compressed_size += file.meta.compressed_size;
            original_size <= max_file_size && compressed_size <= max_file_size
        })
        .collect()
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
    use super::{super::tests::*, *};

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

    #[test]
    fn test_batches_stop_at_the_compressed_size_target() {
        let mut files: Vec<FileKey> = (1..=3)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        for file in &mut files {
            file.meta.compressed_size = 450;
        }
        let limits = limits(&MergeStrategy::FileTime, 0, false);
        // 900 original bytes fit the 1000 target, 1350 compressed bytes do not
        let planned = batches(&files, &limits, &MergeMode::Classic);
        assert_eq!(planned.len(), 1);
        assert_eq!(names(&planned[0].0), ["1.parquet", "2.parquet"]);
        // a group cut down to one file is dropped
        files.truncate(2);
        files[1].meta.compressed_size = 600;
        assert!(batches(&files, &limits, &MergeMode::Classic).is_empty());
    }
}
