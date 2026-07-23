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

use std::cmp::max;

use config::meta::sql::OrderBy;

/// Generate partitions aligned with the histogram interval
pub(super) fn generate_partitions_aligned_with_histogram_interval(
    start_time: i64,
    end_time: i64,
    step: i64,
    order_by: OrderBy,
    min_step: i64,
) -> Vec<[i64; 2]> {
    let mut partitions =
        generate_histogram_aligned_partitions(start_time, end_time, step, order_by, min_step);

    if partitions.is_empty() {
        partitions.push([start_time, end_time]);
    }
    partitions
}

/// Generate histogram-aligned partitions
fn generate_histogram_aligned_partitions(
    start_time: i64,
    end_time: i64,
    step: i64,
    order_by: OrderBy,
    min_step: i64,
) -> Vec<[i64; 2]> {
    let mut partitions = Vec::new();
    let duration = end_time - start_time;

    // Handle the alignment for the first and last partition
    let mut new_end = end_time;
    let last_partition_step = end_time % min_step;
    if last_partition_step > 0 && duration > min_step {
        new_end = end_time - last_partition_step;
        partitions.push([new_end, end_time]);
    }
    let mut new_start = start_time;
    let last_partition_step = start_time % min_step;
    if last_partition_step > 0 && duration > min_step {
        new_start = start_time + min_step - last_partition_step;
        partitions.push([start_time, new_start]);
    }

    let mut end = new_end;
    while end > new_start {
        let start = max(end - step, new_start);
        partitions.push([start, end]);
        end = start;
    }

    // We need to reverse partitions if query is ASC order
    partitions.sort_by(|a, b| b[0].cmp(&a[0]));
    if order_by == OrderBy::Asc {
        partitions.reverse();
    }

    partitions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn print_partitions(title: &str, partitions: &[[i64; 2]]) {
        println!("{title}");
        for [start, end] in partitions.iter() {
            let start = chrono::DateTime::from_timestamp_micros(*start)
                .unwrap()
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            let end = chrono::DateTime::from_timestamp_micros(*end)
                .unwrap()
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            println!("{start} - {end}");
        }
    }

    // Actual start
    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_where_step_is_equal_to_query_duration()
     {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 43200000000; // 12 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // 2025-07-29 21:30:00 - 2025-07-29 22:00:00
        // 2025-07-29 10:00:00 - 2025-07-29 21:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions("HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):", &partitions);

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):
        // 2025-07-29 10:00:00 - 2025-07-29 21:30:00
        // 2025-07-29 21:30:00 - 2025-07-29 22:00:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_where_step_is_less_than_query_duration()
     {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // 2025-07-29 21:30:00 - 2025-07-29 22:00:00
        // 2025-07-29 17:30:00 - 2025-07-29 21:30:00
        // 2025-07-29 13:30:00 - 2025-07-29 17:30:00
        // 2025-07-29 10:00:00 - 2025-07-29 13:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions("HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):", &partitions);

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):
        // 2025-07-29 10:00:00 - 2025-07-29 13:30:00
        // 2025-07-29 13:30:00 - 2025-07-29 17:30:00
        // 2025-07-29 17:30:00 - 2025-07-29 21:30:00
        // 2025-07-29 21:30:00 - 2025-07-29 22:00:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_with_uneven_time_range()
    {
        let start_time = 1746074700000000; // Thursday, May 1, 2025 at 10:15:00 AM GMT+5:30
        let end_time = 1746117300000000; // Thursday, May 1, 2025 at 10:05:00 PM GMT+5:30
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:15:00 - 2025-05-01 22:05:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // 2025-05-01 21:30:00 - 2025-05-01 22:05:00
        // 2025-05-01 17:30:00 - 2025-05-01 21:30:00
        // 2025-05-01 13:30:00 - 2025-05-01 17:30:00
        // 2025-05-01 10:15:00 - 2025-05-01 13:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions("HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):", &partitions);
        // Input
        // 2025-05-01 10:15:00 - 2025-05-01 22:05:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):
        // 2025-05-01 10:15:00 - 2025-05-01 13:30:00
        // 2025-05-01 13:30:00 - 2025-05-01 17:30:00
        // 2025-05-01 17:30:00 - 2025-05-01 21:30:00
        // 2025-05-01 21:30:00 - 2025-05-01 22:05:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_with_uneven_time_range_2()
     {
        let start_time = 1746073920000000; // Thursday, May 1, 2025 at 10:02:00 AM GMT+5:30
        let end_time = 1746074820000000; // Thursday, May 1, 2025 at 10:17:00 AM GMT+5:30
        let min_step_seconds = 300; // 5 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 5 minutes in microseconds

        let step = min_step; // 5 minutes in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:02:00 - 2025-05-01 10:17:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // 2025-05-01 10:15:00 - 2025-05-01 10:17:00
        // 2025-05-01 10:10:00 - 2025-05-01 10:15:00
        // 2025-05-01 10:05:00 - 2025-05-01 10:10:00
        // 2025-05-01 10:02:00 - 2025-05-01 10:05:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions("HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):", &partitions);

        // Input
        // 2025-05-01 10:02:00 - 2025-05-01 10:17:00
        // HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):
        // 2025-05-01 10:02:00 - 2025-05-01 10:05:00
        // 2025-05-01 10:05:00 - 2025-05-01 10:10:00
        // 2025-05-01 10:10:00 - 2025-05-01 10:15:00
        // 2025-05-01 10:15:00 - 2025-05-01 10:17:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_mini_partition_with_uneven_time_range_2() {
        let start_time = 1746073920000000; // Thursday, May 1, 2025 at 10:02:00 AM GMT+5:30
        let end_time = 1746074820000000; // Thursday, May 1, 2025 at 10:17:00 AM GMT+5:30
        let min_step_seconds = 300; // 5 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 5 minutes in microseconds

        let step = min_step; // 5 minutes in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:02:00 - 2025-05-01 10:17:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):
        // 2025-05-01 10:16:00 - 2025-05-01 10:17:00
        // 2025-05-01 10:15:00 - 2025-05-01 10:16:00
        // 2025-05-01 10:10:00 - 2025-05-01 10:15:00
        // 2025-05-01 10:05:00 - 2025-05-01 10:10:00
        // 2025-05-01 10:02:00 - 2025-05-01 10:05:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:02:00 - 2025-05-01 10:17:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):
        // 2025-05-01 10:02:00 - 2025-05-01 10:03:00
        // 2025-05-01 10:03:00 - 2025-05-01 10:05:00
        // 2025-05-01 10:05:00 - 2025-05-01 10:10:00
        // 2025-05-01 10:10:00 - 2025-05-01 10:15:00
        // 2025-05-01 10:15:00 - 2025-05-01 10:17:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_and_mini_partition_with_step_equal_to_query_duration()
     {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 43200000000; // 12 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):
        // 2025-07-29 21:59:00 - 2025-07-29 22:00:00
        // 2025-07-29 10:00:00 - 2025-07-29 21:59:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):
        // 2025-07-29 10:00:00 - 2025-07-29 10:01:00
        // 2025-07-29 10:01:00 - 2025-07-29 22:00:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_and_mini_partition_with_step_less_than_query_duration()
     {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):
        // 2025-07-29 21:59:00 - 2025-07-29 22:00:00
        // 2025-07-29 21:30:00 - 2025-07-29 21:59:00
        // 2025-07-29 17:30:00 - 2025-07-29 21:30:00
        // 2025-07-29 13:30:00 - 2025-07-29 17:30:00
        // 2025-07-29 10:00:00 - 2025-07-29 13:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):",
            &partitions,
        );

        // Input
        // 2025-07-29 10:00:00 - 2025-07-29 22:00:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):
        // 2025-07-29 10:00:00 - 2025-07-29 10:01:00 - mini partition - Duplicates expected
        // 2025-07-29 10:01:00 - 2025-07-29 13:30:00 - boundary - Duplicates expected
        // 2025-07-29 13:30:00 - 2025-07-29 17:30:00 - 4hr -- Duplicates here
        // 2025-07-29 17:30:00 - 2025-07-29 21:30:00 - 4hr -- Duplicates here
        // 2025-07-29 21:30:00 - 2025-07-29 22:00:00 - boundary

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_and_mini_partition_with_step_greater_than_query_duration()
     {
        let start_time = 1746073920000000; // Thursday, May 1, 2025 at 10:02:00 AM GMT+5:30
        let end_time = 1746161220000000; // Friday, May 2, 2025 at 10:17:00 AM GMT+5:30
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 86400000000; // 24 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:02:00 - 2025-05-02 10:17:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):
        // 2025-05-02 10:16:00 - 2025-05-02 10:17:00
        // 2025-05-02 09:30:00 - 2025-05-02 10:16:00
        // 2025-05-01 10:02:00 - 2025-05-02 09:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):",
            &partitions,
        );

        // Input
        // 2025-05-01 10:02:00 - 2025-05-02 10:17:00
        // HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):
        // 2025-05-01 10:02:00 - 2025-05-01 10:03:00
        // 2025-05-01 10:03:00 - 2025-05-02 09:30:00
        // 2025-05-02 09:30:00 - 2025-05-02 10:17:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_and_mini_partition_with_step_greater_than_query_duration_bug()
     {
        let start_time = 1752568628000000; // Thursday, May 1, 2025 at 10:02:00 AM GMT+5:30
        let end_time = 1752741428000000; // Friday, May 2, 2025 at 10:17:00 AM GMT+5:30
        let min_step_seconds = 18000; // 300 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds

        let step = 72000000000; // 24 hours in microseconds

        // Test Descending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            min_step,
        );

        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):",
            &partitions,
        );

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Test Ascending
        let partitions = generate_partitions_aligned_with_histogram_interval(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            min_step,
        );

        println!("partitions: {partitions:#?}");
        print_partitions("Input", &[[start_time, end_time]]);
        print_partitions(
            "HISTOGRAM PARTITIONS WITH MINI PARTITION (ASC):",
            &partitions,
        );

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }
}
