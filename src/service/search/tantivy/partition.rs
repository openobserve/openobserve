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

use config::meta::{inverted_index::IndexOptimizeMode, stream::FileKey};

// partition the tantivy files by time range
// the return file groups should execute one by one
pub(super) fn partition_tantivy_files(
    index_parquet_files: Vec<FileKey>,
    idx_optimize_mode: &Option<IndexOptimizeMode>,
    target_partitions: usize,
) -> (Vec<Vec<FileKey>>, usize) {
    let (file_groups, limit, ascend) = if let Some(IndexOptimizeMode::SimpleSelect(limit, ascend)) =
        idx_optimize_mode
        && *limit > 0
    {
        let file_groups = group_files_by_time_range(index_parquet_files, target_partitions);
        (file_groups, *limit, *ascend)
    } else {
        // splite the filter groups by target partitions
        let file_groups = into_chunks(index_parquet_files, target_partitions);
        (file_groups, 0, false)
    };

    if limit == 0 {
        (file_groups, limit)
    } else {
        (regroup_tantivy_files(file_groups, ascend), limit)
    }
}

// regroup the tantivy for better performance
// after [`partition_tantivy_files`] we get multiple groups that order by time range desc and each
// group's time range not overlap, when execute the tantivy search, we get the last file in each
// group and do the tantivy search.
// so in this function, we recursive collect the last file in each group
fn regroup_tantivy_files(file_groups: Vec<Vec<FileKey>>, ascend: bool) -> Vec<Vec<FileKey>> {
    let group_num = file_groups.len();
    let max_group_len = file_groups.iter().map(|g| g.len()).max().unwrap_or(0);
    let mut new_file_groups: Vec<Vec<FileKey>> = vec![Vec::new(); max_group_len];

    let mut file_groups: Vec<_> = file_groups
        .into_iter()
        .map(|mut group| {
            if !ascend {
                group.reverse();
            }
            group.into_iter()
        })
        .collect();

    for new_group in new_file_groups.iter_mut().take(max_group_len) {
        for file_group in file_groups.iter_mut().take(group_num) {
            if let Some(file) = file_group.next() {
                new_group.push(file)
            }
        }
    }

    new_file_groups
}

fn into_chunks<T>(mut v: Vec<T>, chunk_size: usize) -> Vec<Vec<T>> {
    let mut chunks = Vec::new();
    while !v.is_empty() {
        let take = if v.len() >= chunk_size {
            chunk_size
        } else {
            v.len()
        };
        let chunk: Vec<T> = v.drain(..take).collect();
        chunks.push(chunk);
    }
    chunks
}

// Group files by time range.
// Use file.meta min_ts/max_ts to keep each group's files sorted and non-overlapping.
fn group_files_by_time_range(mut files: Vec<FileKey>, partition_num: usize) -> Vec<Vec<FileKey>> {
    if files.is_empty() {
        return vec![];
    }

    let partition_num = partition_num.max(1);

    // Sort files by min_ts in ascending order, matching DataFusion's
    // split_groups_by_statistics_with_target_partitions strategy.
    files.sort_unstable_by(|a, b| {
        a.meta
            .min_ts
            .cmp(&b.meta.min_ts)
            .then_with(|| a.meta.max_ts.cmp(&b.meta.max_ts))
    });

    let mut file_groups_indices: Vec<Vec<FileKey>> = vec![vec![]; partition_num];
    for file in files {
        if let Some(group) = file_groups_indices
            .iter_mut()
            .filter(|group| {
                group.is_empty()
                    || file.meta.min_ts
                        > group
                            .last()
                            .expect("groups should not be empty after is_empty check")
                            .meta
                            .max_ts
            })
            .min_by_key(|group| group.len())
        {
            group.push(file);
        } else {
            file_groups_indices.push(vec![file]);
        }
    }

    file_groups_indices.retain(|group| !group.is_empty());
    file_groups_indices
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn create_file_key(min_ts: i64, max_ts: i64) -> FileKey {
        FileKey {
            key: format!("file_{min_ts}_{max_ts}"),
            meta: FileMeta {
                min_ts,
                max_ts,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn assert_groups_are_sorted_and_non_overlapping(groups: &[Vec<FileKey>]) {
        for group in groups {
            for files in group.windows(2) {
                assert!(
                    files[0].meta.min_ts <= files[1].meta.min_ts,
                    "files should be sorted by min_ts within each group"
                );
                assert!(
                    files[0].meta.max_ts < files[1].meta.min_ts,
                    "files should not overlap within each group"
                );
            }
        }
    }

    fn group_keys(groups: &[Vec<FileKey>]) -> Vec<Vec<String>> {
        groups
            .iter()
            .map(|group| group.iter().map(|file| file.key.clone()).collect())
            .collect()
    }

    #[test]
    fn test_group_files_by_time_range() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
        ];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);
        assert_eq!(groups.len(), 3);
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_with_overlap() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(5, 15),
            create_file_key(11, 20),
            create_file_key(18, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
        ];
        let partition_num = 2;
        let groups = group_files_by_time_range(files, partition_num);
        assert!(groups.len() >= 2);
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_with_less_partitions() {
        let files = vec![create_file_key(1, 10), create_file_key(11, 20)];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);
        assert_eq!(groups.len(), 2);
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_sorts_unsorted_input_by_min_ts() {
        let files = vec![
            create_file_key(31, 40),
            create_file_key(1, 10),
            create_file_key(21, 30),
            create_file_key(11, 20),
        ];

        let groups = group_files_by_time_range(files, 2);

        assert_eq!(
            group_keys(&groups),
            vec![
                vec!["file_1_10".to_string(), "file_21_30".to_string()],
                vec!["file_11_20".to_string(), "file_31_40".to_string()],
            ]
        );
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_balances_smallest_eligible_group() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
            create_file_key(41, 50),
            create_file_key(51, 60),
            create_file_key(61, 70),
        ];

        let groups = group_files_by_time_range(files, 3);
        let group_sizes = groups.iter().map(Vec::len).collect::<Vec<_>>();

        assert_eq!(group_sizes, vec![3, 2, 2]);
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_adds_groups_when_all_targets_overlap() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(2, 11),
            create_file_key(3, 12),
        ];

        let groups = group_files_by_time_range(files, 2);

        assert_eq!(groups.len(), 3);
        assert!(groups.iter().all(|group| group.len() == 1));
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_requires_strictly_non_overlapping_ranges() {
        let files = vec![create_file_key(1, 10), create_file_key(10, 20)];

        let groups = group_files_by_time_range(files, 1);

        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|group| group.len() == 1));
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_regroup_tantivy_files_basic() {
        let file_groups = vec![
            vec![create_file_key(1, 10), create_file_key(11, 20)],
            vec![create_file_key(21, 30), create_file_key(31, 40)],
        ];
        let result = regroup_tantivy_files(file_groups, false);

        // Should have 2 groups (max length of input groups)
        assert_eq!(result.len(), 2);

        // First group should contain the last file from each input group
        assert_eq!(result[0].len(), 2);
        assert_eq!(result[0][0].key, "file_11_20"); // Last file from first group
        assert_eq!(result[0][1].key, "file_31_40"); // Last file from second group

        // Second group should contain the first file from each input group
        assert_eq!(result[1].len(), 2);
        assert_eq!(result[1][0].key, "file_1_10"); // First file from first group
        assert_eq!(result[1][1].key, "file_21_30"); // First file from second group
    }

    #[test]
    fn test_regroup_tantivy_files_uneven_groups() {
        let file_groups = vec![
            vec![
                create_file_key(1, 10),
                create_file_key(11, 20),
                create_file_key(21, 30),
            ],
            vec![create_file_key(31, 40)],
        ];
        let result = regroup_tantivy_files(file_groups, false);

        // Should have 3 groups (max length of input groups)
        assert_eq!(result.len(), 3);

        // First group should contain the last file from each input group
        assert_eq!(result[0].len(), 2);
        assert_eq!(result[0][0].key, "file_21_30"); // Last file from first group
        assert_eq!(result[0][1].key, "file_31_40"); // Last file from second group

        // Second group should contain the middle file from first group, none from second
        assert_eq!(result[1].len(), 1);
        assert_eq!(result[1][0].key, "file_11_20"); // Middle file from first group

        // Third group should contain the first file from first group, none from second
        assert_eq!(result[2].len(), 1);
        assert_eq!(result[2][0].key, "file_1_10"); // First file from first group
    }

    #[test]
    fn test_regroup_tantivy_files_empty_groups() {
        let file_groups: Vec<Vec<FileKey>> = vec![];
        let result = regroup_tantivy_files(file_groups, false);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_regroup_tantivy_files_single_group() {
        let file_groups = vec![vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
        ]];
        let result = regroup_tantivy_files(file_groups, false);

        // Should have 3 groups (length of the single input group)
        assert_eq!(result.len(), 3);

        // Each group should contain one file
        assert_eq!(result[0].len(), 1);
        assert_eq!(result[0][0].key, "file_21_30"); // Last file

        assert_eq!(result[1].len(), 1);
        assert_eq!(result[1][0].key, "file_11_20"); // Middle file

        assert_eq!(result[2].len(), 1);
        assert_eq!(result[2][0].key, "file_1_10"); // First file
    }

    #[test]
    fn test_into_chunks_basic() {
        let v = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let chunks = into_chunks(v, 3);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], vec![1, 2, 3]);
        assert_eq!(chunks[1], vec![4, 5, 6]);
        assert_eq!(chunks[2], vec![7, 8]);
    }

    #[test]
    fn test_into_chunks_exact_divisible() {
        let v = vec![1, 2, 3, 4, 5, 6];
        let chunks = into_chunks(v, 2);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], vec![1, 2]);
        assert_eq!(chunks[1], vec![3, 4]);
        assert_eq!(chunks[2], vec![5, 6]);
    }

    #[test]
    fn test_into_chunks_empty_vector() {
        let v: Vec<i32> = vec![];
        let chunks = into_chunks(v, 3);

        assert_eq!(chunks.len(), 0);
    }

    #[test]
    fn test_into_chunks_chunk_size_larger_than_vector() {
        let v = vec![1, 2];
        let chunks = into_chunks(v, 5);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], vec![1, 2]);
    }

    #[test]
    fn test_group_files_by_time_range_single_file() {
        let files = vec![create_file_key(1, 10)];
        let partition_num = 3;
        let groups = group_files_by_time_range(files, partition_num);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 1);
        assert_eq!(groups[0][0].key, "file_1_10");
    }

    #[test]
    fn test_group_files_by_time_range_empty() {
        let groups = group_files_by_time_range(vec![], 3);
        assert!(groups.is_empty());
    }

    #[test]
    fn test_group_files_by_time_range_zero_partitions() {
        let files = vec![create_file_key(1, 10), create_file_key(11, 20)];
        let groups = group_files_by_time_range(files, 0);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_group_files_by_time_range_no_overlap_many_partitions() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
        ];
        let partition_num = 10; // More partitions than files
        let groups = group_files_by_time_range(files, partition_num);

        // Should only keep non-empty target partitions.
        assert_eq!(groups.len(), 3);
        for group in &groups {
            assert_eq!(group.len(), 1); // Each file should be in its own group
        }
        assert_groups_are_sorted_and_non_overlapping(&groups);
    }

    #[test]
    fn test_regroup_tantivy_files_many_single_element_groups() {
        let file_groups = vec![
            vec![create_file_key(1, 10)],
            vec![create_file_key(11, 20)],
            vec![create_file_key(21, 30)],
        ];
        let result = regroup_tantivy_files(file_groups, false);

        assert_eq!(result.len(), 1); // Max group length is 1
        assert_eq!(result[0].len(), 3); // Should contain all files
        assert_eq!(result[0][0].key, "file_1_10");
        assert_eq!(result[0][1].key, "file_11_20");
        assert_eq!(result[0][2].key, "file_21_30");
    }

    #[test]
    fn test_regroup_tantivy_files_ascend() {
        // Same input as test_regroup_tantivy_files_basic, but with ascend=true.
        // Without the reverse, each group stays in ascending order, so the
        // interleaved output groups contain oldest files first.
        let file_groups = vec![
            vec![create_file_key(1, 10), create_file_key(11, 20)],
            vec![create_file_key(21, 30), create_file_key(31, 40)],
        ];
        let result = regroup_tantivy_files(file_groups, true);

        assert_eq!(result.len(), 2);

        // First group should contain the first (oldest) file from each input group
        assert_eq!(result[0].len(), 2);
        assert_eq!(result[0][0].key, "file_1_10");
        assert_eq!(result[0][1].key, "file_21_30");

        // Second group should contain the last (newest) file from each input group
        assert_eq!(result[1].len(), 2);
        assert_eq!(result[1][0].key, "file_11_20");
        assert_eq!(result[1][1].key, "file_31_40");
    }

    #[test]
    fn test_partition_tantivy_files_simple_select_with_limit() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
        ];
        let idx_optimize_mode =
            Some(config::meta::inverted_index::IndexOptimizeMode::SimpleSelect(100, false));
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 100);
        assert!(!file_groups.is_empty());
    }

    #[test]
    fn test_partition_tantivy_files_simple_select_no_limit() {
        let files = vec![create_file_key(1, 10), create_file_key(11, 20)];
        let idx_optimize_mode =
            Some(config::meta::inverted_index::IndexOptimizeMode::SimpleSelect(0, false));
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 0);
        assert_eq!(file_groups.len(), 1);
    }

    #[test]
    fn test_partition_tantivy_files_other_mode() {
        let files = vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(21, 30),
            create_file_key(31, 40),
        ];
        let idx_optimize_mode = Some(config::meta::inverted_index::IndexOptimizeMode::SimpleCount);
        let target_partitions = 2;

        let (file_groups, limit) =
            partition_tantivy_files(files, &idx_optimize_mode, target_partitions);
        assert_eq!(limit, 0);
        assert!(file_groups.len() <= 2);
    }
}
