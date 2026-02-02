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

use config::meta::stream::FileKey;

pub async fn file_list(
    mode: &str,
    stream: &str,
    hour: &str,
    group_size: &str,
) -> Result<(), anyhow::Error> {
    let parts = stream.splitn(3, '/').collect::<Vec<&str>>();
    let org = parts[0];
    let stream_type = parts[1];
    let stream_name = parts[2];

    println!("Testing group stream files:");
    println!("stream: {stream}");
    println!("date hour: {hour}");
    println!("strategy: {mode}");
    println!("group size: {group_size}gb");

    let file_list = crate::service::file_list::query_for_merge(
        org,
        stream_type.into(),
        stream_name,
        hour,
        hour,
    )
    .await?;
    println!("get files: {}", file_list.len());

    let group_size = group_size.parse::<i64>().unwrap_or(5) * 1024 * 1024 * 1024;
    let mode = mode.trim().to_lowercase();
    let groups = match mode.as_str() {
        "file_size" => group_by_file_size(file_list, group_size),
        "file_time" => group_by_file_time(file_list, group_size),
        "time_range" => group_by_time_range(file_list, group_size),
        _ => {
            return Err(anyhow::anyhow!("unsupported mode: {mode}"));
        }
    };
    println!("groups: {}", groups.len());
    Ok(())
}

fn group_by_file_size(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    file_list.sort_by_key(|f| f.meta.original_size);
    let mut groups = Vec::with_capacity(file_list.len());
    let mut current_group = Vec::with_capacity(file_list.len());
    let mut current_size = 0;
    for file in file_list {
        if !current_group.is_empty() && current_size + file.meta.original_size > group_size {
            groups.push(current_group);
            current_group = Vec::new();
            current_size = 0;
        }
        current_size += file.meta.original_size;
        current_group.push(file);
    }
    if !current_group.is_empty() {
        groups.push(current_group);
    }
    groups
}

fn group_by_file_time(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups = Vec::with_capacity(file_list.len());
    let mut current_group = Vec::with_capacity(file_list.len());
    let mut current_size = 0;
    for file in file_list {
        if !current_group.is_empty() && current_size + file.meta.original_size > group_size {
            groups.push(current_group);
            current_group = Vec::new();
            current_size = 0;
        }
        current_size += file.meta.original_size;
        current_group.push(file);
    }
    if !current_group.is_empty() {
        groups.push(current_group);
    }
    groups
}

fn group_by_time_range(mut file_list: Vec<FileKey>, group_size: i64) -> Vec<Vec<FileKey>> {
    // first group file by non-overlapping
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups: Vec<Vec<FileKey>> = Vec::new();
    for file in file_list {
        let mut inserted = None;
        for (i, group) in groups.iter().enumerate() {
            if group
                .last()
                .is_some_and(|f| file.meta.min_ts >= f.meta.max_ts)
            {
                inserted = Some(i);
                break;
            }
        }
        if let Some(i) = inserted {
            groups[i].push(file);
        } else {
            groups.push(vec![file]);
        }
    }
    // then sort each group by file size
    let mut new_groups = Vec::with_capacity(groups.len());
    for group in groups {
        new_groups.extend(group_by_file_time(group, group_size));
    }
    new_groups
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta};

    use super::*;

    fn create_test_file_key(id: i64, size: i64, min_ts: i64, max_ts: i64) -> FileKey {
        FileKey {
            id,
            account: "test_account".to_string(),
            key: format!("file_{id}.parquet"),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: size / 100, // Approximate records based on size
                original_size: size,
                compressed_size: size / 2,
                index_size: size / 10,
                flattened: false,
            },
            deleted: false,
            segment_ids: None,
        }
    }

    #[test]
    fn test_group_by_file_size_strategy() {
        // Test grouping files by size with various scenarios
        let test_cases = [
            // Small files that should be grouped together
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 2000, 3000),
                    create_test_file_key(3, 3072, 3000, 4000),
                ],
                8192, // 8KB group size
                vec![vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 2000, 3000),
                    create_test_file_key(3, 3072, 3000, 4000),
                ]],
            ),
            // Files that should be split into multiple groups
            (
                vec![
                    create_test_file_key(1, 5000, 1000, 2000),
                    create_test_file_key(2, 6000, 2000, 3000),
                    create_test_file_key(3, 7000, 3000, 4000),
                    create_test_file_key(4, 8000, 4000, 5000),
                ],
                10000, // 10KB group size
                vec![
                    vec![create_test_file_key(1, 5000, 1000, 2000)],
                    vec![create_test_file_key(2, 6000, 2000, 3000)],
                    vec![create_test_file_key(3, 7000, 3000, 4000)],
                    vec![create_test_file_key(4, 8000, 4000, 5000)],
                ],
            ),
            // Empty file list
            (vec![], 1024, vec![]),
            // Single file
            (
                vec![create_test_file_key(1, 1024, 1000, 2000)],
                1024,
                vec![vec![create_test_file_key(1, 1024, 1000, 2000)]],
            ),
        ];

        for (input_files, group_size, expected_groups) in test_cases {
            let result = group_by_file_size(input_files, group_size);
            assert_eq!(result.len(), expected_groups.len());

            for (result_group, expected_group) in result.iter().zip(expected_groups.iter()) {
                assert_eq!(result_group.len(), expected_group.len());
                for (result_file, expected_file) in result_group.iter().zip(expected_group.iter()) {
                    assert_eq!(result_file.id, expected_file.id);
                    assert_eq!(
                        result_file.meta.original_size,
                        expected_file.meta.original_size
                    );
                }
            }
        }
    }

    #[test]
    fn test_group_by_file_time_strategy() {
        // Test grouping files by time with various scenarios
        let test_cases = [
            // Files with different timestamps that should be grouped by size
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 5000, 6000),
                    create_test_file_key(3, 3072, 2000, 3000),
                ],
                8192, // 8KB group size
                vec![vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(3, 3072, 2000, 3000),
                    create_test_file_key(2, 2048, 5000, 6000),
                ]],
            ),
            // Files that should be split due to size limit
            (
                vec![
                    create_test_file_key(1, 5000, 1000, 2000),
                    create_test_file_key(2, 6000, 2000, 3000),
                    create_test_file_key(3, 7000, 3000, 4000),
                ],
                10000, // 10KB group size
                vec![
                    vec![create_test_file_key(1, 5000, 1000, 2000)],
                    vec![create_test_file_key(2, 6000, 2000, 3000)],
                    vec![create_test_file_key(3, 7000, 3000, 4000)],
                ],
            ),
            // Files with same timestamp but different sizes
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 1000, 2000),
                    create_test_file_key(3, 3072, 1000, 2000),
                ],
                4096, // 4KB group size
                vec![
                    vec![
                        create_test_file_key(1, 1024, 1000, 2000),
                        create_test_file_key(2, 2048, 1000, 2000),
                    ],
                    vec![create_test_file_key(3, 3072, 1000, 2000)],
                ],
            ),
        ];

        for (input_files, group_size, expected_groups) in test_cases {
            let result = group_by_file_time(input_files, group_size);
            assert_eq!(result.len(), expected_groups.len());

            // Verify that files are sorted by min_ts within each group
            for group in &result {
                for window in group.windows(2) {
                    assert!(window[0].meta.min_ts <= window[1].meta.min_ts);
                }
            }
        }
    }

    #[test]
    fn test_group_by_time_range_strategy() {
        // Test grouping files by time range with non-overlapping logic
        let test_cases = [
            // Non-overlapping files that should be in separate groups initially
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 3000, 4000),
                    create_test_file_key(3, 3072, 5000, 6000),
                ],
                8192, // 8KB group size
                vec![vec![
                    create_test_file_key(1, 1024, 1000, 2000),
                    create_test_file_key(2, 2048, 3000, 4000),
                    create_test_file_key(3, 3072, 5000, 6000),
                ]],
            ),
            // Overlapping files that should be in separate groups
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 3000),
                    create_test_file_key(2, 2048, 2000, 4000), // Overlaps with file 1
                    create_test_file_key(3, 3072, 5000, 7000),
                ],
                8192, // 8KB group size
                vec![
                    vec![
                        create_test_file_key(1, 1024, 1000, 3000),
                        create_test_file_key(3, 3072, 5000, 7000),
                    ],
                    vec![create_test_file_key(2, 2048, 2000, 4000)],
                ],
            ),
        ];

        for (input_files, group_size, expected_groups) in test_cases {
            let result = group_by_time_range(input_files, group_size);
            assert_eq!(result.len(), expected_groups.len());

            // Verify that files in each group don't overlap in time
            for group in &result {
                for i in 0..group.len() {
                    for j in (i + 1)..group.len() {
                        let file1 = &group[i];
                        let file2 = &group[j];
                        // Files should not overlap: file1.max_ts <= file2.min_ts OR file2.max_ts <=
                        // file1.min_ts
                        assert!(
                            file1.meta.max_ts <= file2.meta.min_ts
                                || file2.meta.max_ts <= file1.meta.min_ts,
                            "Files {} and {} overlap in time",
                            file1.id,
                            file2.id
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_edge_cases_and_boundaries() {
        // Test edge cases and boundary values
        let edge_cases = [
            // Zero size files
            (
                vec![
                    create_test_file_key(1, 0, 1000, 2000),
                    create_test_file_key(2, 0, 2000, 3000),
                ],
                1024,
            ),
            // Very large files
            (
                vec![
                    create_test_file_key(1, i64::MAX / 2, 1000, 2000),
                    create_test_file_key(2, i64::MAX / 2, 2000, 3000),
                ],
                i64::MAX,
            ),
            // Files with same timestamp
            (
                vec![
                    create_test_file_key(1, 1024, 1000, 1000),
                    create_test_file_key(2, 2048, 1000, 1000),
                ],
                4096,
            ),
            // Files with negative timestamps
            (
                vec![
                    create_test_file_key(1, 1024, -1000, -500),
                    create_test_file_key(2, 2048, -2000, -1000),
                ],
                4096,
            ),
            // Empty group size
            (vec![create_test_file_key(1, 1024, 1000, 2000)], 0),
        ];

        for (files, group_size) in edge_cases {
            // Test that all grouping strategies handle edge cases without panicking
            let _size_result = group_by_file_size(files.clone(), group_size);
            let _time_result = group_by_file_time(files.clone(), group_size);
            let _range_result = group_by_time_range(files.clone(), group_size);
        }
    }
}
