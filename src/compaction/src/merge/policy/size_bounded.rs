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

use super::{BatchLimits, RoundPlan};

/// Files already at the size target are left alone, so the window query skips them.
pub(super) const READS_WHOLE_WINDOW: bool = false;

pub(super) fn plan(files: &[FileKey], limits: &BatchLimits, mode: &MergeMode) -> RoundPlan {
    RoundPlan::new(
        size_bounded_groups(files, limits)
            .into_iter()
            .map(|group| (group, mode.clone()))
            .collect(),
    )
}

/// Size-bounded merge groups in the planner's file order.
fn size_bounded_groups(files: &[FileKey], limits: &BatchLimits) -> Vec<Vec<FileKey>> {
    let max_file_size = limits.max_file_size as i64;
    let max_group_files = limits.max_group_files;
    let mut groups = Vec::new();
    let mut current_group: Vec<FileKey> = Vec::new();
    let mut original_size = 0;
    let mut compressed_size = 0;
    for file in files {
        let exceeds_original_size = original_size + file.meta.original_size > max_file_size;
        // FileSize order guarantees later files cannot form a smaller original-size pair.
        if exceeds_original_size
            && current_group.len() <= 1
            && limits.strategy == MergeStrategy::FileSize
        {
            break;
        }

        if exceeds_original_size
            || compressed_size + file.meta.compressed_size > max_file_size
            || (max_group_files > 0 && current_group.len() >= max_group_files)
        {
            if current_group.len() > 1 {
                groups.push(std::mem::take(&mut current_group));
            } else {
                current_group.clear();
            }
            original_size = 0;
            compressed_size = 0;
        }

        if file.meta.original_size > max_file_size || file.meta.compressed_size > max_file_size {
            continue;
        }

        original_size += file.meta.original_size;
        compressed_size += file.meta.compressed_size;
        current_group.push(file.clone());
    }

    // Open hours keep the remainder for later arrivals to avoid rewriting it repeatedly.
    if current_group.len() > 1 && !limits.is_incremental {
        groups.push(current_group);
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
    fn test_batches_continue_after_compressed_size_boundaries() {
        let mut files: Vec<FileKey> = (1..=6)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        for file in &mut files {
            file.meta.compressed_size = 450;
        }
        let expected = [
            vec!["1.parquet", "2.parquet"],
            vec!["3.parquet", "4.parquet"],
            vec!["5.parquet", "6.parquet"],
        ];
        for strategy in [
            MergeStrategy::FileTime,
            MergeStrategy::FileSize,
            MergeStrategy::TimeRange,
        ] {
            for incremental in [false, true] {
                let limits = limits(&strategy, 0, incremental);
                let planned = plan(&files, &limits, &MergeMode::Classic).batches;
                let actual: Vec<_> = planned.iter().map(|(files, _)| names(files)).collect();
                let count = if incremental { 2 } else { 3 };
                assert_eq!(
                    actual,
                    expected[..count],
                    "{strategy:?}, incremental={incremental}"
                );
            }
        }
    }

    #[test]
    fn test_batches_continue_after_unmergeable_compressed_files() {
        for (strategy, sizes, expected) in [
            (
                MergeStrategy::FileSize,
                vec![(100, 900), (200, 200), (300, 100)],
                vec![vec!["2.parquet", "3.parquet"]],
            ),
            (
                MergeStrategy::FileSize,
                vec![(100, 1200), (200, 100), (300, 100)],
                vec![vec!["2.parquet", "3.parquet"]],
            ),
            (
                MergeStrategy::FileTime,
                vec![(100, 100), (100, 100), (100, 1200), (100, 100), (100, 100)],
                vec![
                    vec!["1.parquet", "2.parquet"],
                    vec!["4.parquet", "5.parquet"],
                ],
            ),
            (
                MergeStrategy::TimeRange,
                vec![(100, 100), (100, 1200), (100, 100), (100, 100)],
                vec![vec!["3.parquet", "4.parquet"]],
            ),
        ] {
            let files: Vec<_> = sizes
                .iter()
                .enumerate()
                .map(|(i, &(original, compressed))| {
                    let mut file = metrics_file(&format!("{}.parquet", i + 1), original);
                    file.meta.compressed_size = compressed;
                    file
                })
                .collect();
            let limits = limits(&strategy, 0, false);
            let planned = plan(&files, &limits, &MergeMode::Classic).batches;
            let actual: Vec<_> = planned.iter().map(|(files, _)| names(files)).collect();
            assert_eq!(actual, expected, "{strategy:?}, sizes={sizes:?}");
            for (files, _) in planned {
                assert!(
                    files
                        .iter()
                        .map(|file| file.meta.original_size)
                        .sum::<i64>()
                        <= limits.max_file_size as i64
                );
                assert!(
                    files
                        .iter()
                        .map(|file| file.meta.compressed_size)
                        .sum::<i64>()
                        <= limits.max_file_size as i64
                );
            }
        }
    }

    #[test]
    fn test_batches_respect_the_compressed_size_target() {
        let mut files: Vec<FileKey> = (1..=3)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        for file in &mut files {
            file.meta.compressed_size = 450;
        }
        let limits = limits(&MergeStrategy::FileTime, 0, false);
        // 900 original bytes fit the 1000 target, 1350 compressed bytes do not
        let planned = plan(&files, &limits, &MergeMode::Classic).batches;
        assert_eq!(planned.len(), 1);
        assert_eq!(names(&planned[0].0), ["1.parquet", "2.parquet"]);
        // Neither singleton can form a merge within the compressed-size budget.
        files.truncate(2);
        files[1].meta.compressed_size = 600;
        assert!(
            plan(&files, &limits, &MergeMode::Classic)
                .batches
                .is_empty()
        );
    }
}
