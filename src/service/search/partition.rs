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

use std::cmp::max;

use config::meta::sql::OrderBy;

use crate::service::search::cache::streaming_aggs::generate_record_batch_interval;

/// Generates partitions for search queries
pub struct PartitionGenerator {
    /// Minimum step size in microseconds (usually based on histogram interval)
    min_step: i64,
    /// Duration of mini partition in seconds
    mini_partition_duration_secs: u64,
    /// Whether the request is for histogram
    is_histogram: bool,
}

impl PartitionGenerator {
    /// Create a new PartitionGenerator
    pub fn new(min_step: i64, mini_partition_duration_secs: u64, is_histogram: bool) -> Self {
        Self {
            min_step,
            mini_partition_duration_secs,
            is_histogram,
        }
    }

    /// Generate partitions for a time range
    ///
    /// # Arguments
    /// * `start_time` - Start time in microseconds
    /// * `end_time` - End time in microseconds
    /// * `step` - Regular partition step size in microseconds
    ///
    /// # Returns
    /// Vector of [start, end] time ranges in microseconds, in DESC order
    pub fn generate_partitions(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
        is_streaming_aggregate: bool,
    ) -> Vec<[i64; 2]> {
        if self.is_histogram {
            self.generate_partitions_aligned_with_histogram_interval(
                start_time, end_time, step, order_by,
            )
        } else if is_streaming_aggregate {
            self.generate_partitions_with_streaming_aggregate_partition_window(
                start_time, end_time, order_by,
            )
        } else {
            self.generate_partitions_with_mini_partition(start_time, end_time, step, order_by)
        }
    }

    /// Generate partitions with a mini partition for faster initial results
    ///
    /// # Arguments
    /// * `start_time` - Start time in microseconds
    /// * `end_time` - End time in microseconds
    /// * `step` - Regular partition step size in microseconds
    ///
    /// # Returns
    /// Vector of [start, end] time ranges in microseconds, in DESC order
    fn generate_partitions_with_mini_partition(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        let mut partitions = Vec::new();

        // Create a single mini partition for faster initial results
        let mini_partition_size_microseconds =
            std::cmp::min(self.mini_partition_duration_secs * 1_000_000, step as u64) as i64;

        log::info!(
            "mini_partition_size_microseconds: {}, step: {}, end_time: {}, start_time: {}",
            mini_partition_size_microseconds,
            step,
            end_time,
            start_time
        );

        // Different behavior based on order
        if order_by == OrderBy::Desc {
            // For DESC order, mini partition at the end time
            let mut end = end_time;

            // Handle mini partition if it's smaller than the total range
            if mini_partition_size_microseconds < (end_time - start_time) {
                let start = std::cmp::max(end - mini_partition_size_microseconds, start_time);
                partitions.push([start, end]);
                end = start;
            }

            // Calculate remaining time range
            while end > start_time {
                let start = std::cmp::max(end - step, start_time);
                partitions.push([start, end]);
                end = start;
            }
        } else {
            // For ASC order, mini partition at the start time
            let mut start = start_time;

            // Handle mini partition if it's smaller than the total range
            if mini_partition_size_microseconds < (end_time - start_time) {
                let end = std::cmp::min(start + mini_partition_size_microseconds, end_time);
                partitions.push([start, end]);
                start = end;
            }

            // Calculate remaining time range
            while start < end_time {
                let end = std::cmp::min(start + step, end_time);
                partitions.push([start, end]);
                start = end;
            }
        }

        // Handle edge case of empty partitions
        if partitions.is_empty() {
            partitions.push([start_time, end_time]);
        }

        partitions
    }

    /// Generate partitions using the old logic
    /// This method implements the original partition generation strategy
    fn generate_partitions_aligned_with_histogram_interval(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        // Generate partitions by DESC order
        let mut partitions = Vec::new();
        let mut end = end_time;
        let mut last_partition_step = end % self.min_step;
        let duration = end_time - start_time;

        while end > start_time {
            let mut start = max(end - step, start_time);
            if last_partition_step > 0 && duration > self.min_step {
                // Handle alignment for the first partition
                partitions.push([end - last_partition_step, end]);
                start -= last_partition_step;
                end -= last_partition_step;
            } else {
                start = max(start - last_partition_step, start_time);
            }
            partitions.push([start, end]);
            end = start;
            last_partition_step = 0;
        }

        // Handle edge case of empty partitions
        if partitions.is_empty() {
            partitions.push([start_time, end_time]);
        }

        // We need to reverse partitions if query is ASC order
        if order_by == OrderBy::Asc {
            partitions.reverse();
        }

        partitions
    }

    fn generate_partitions_with_streaming_aggregate_partition_window(
        &self,
        start_time: i64,
        end_time: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        // Generate partitions by DESC order
        let interval = generate_record_batch_interval(start_time, end_time);
        let interval_micros = interval.get_interval_microseconds();
        let mut end_window = end_time - (end_time % interval_micros);

        let mut partitions = Vec::new();

        // Only add the first partition if it's not empty (end_time != end_window_hour)
        if end_time != end_window {
            partitions.push([end_window, end_time]);
        }

        while end_window > start_time {
            let start = std::cmp::max(end_window - interval_micros, start_time);
            partitions.push([start, end_window]);
            end_window = start;
        }

        if order_by == OrderBy::Asc {
            partitions.reverse();
        }

        partitions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_generator_with_histogram_alignment_desc_order() {
        // Test case: 10:02 - 10:17 with 5-minute histogram interval
        let start_time = 1617267720000000; // 10:02
        let end_time = 1617268620000000; // 10:17
        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Desc, false);

        // Expected partitions:
        // Partition 1: 10:15 - 10:17
        // Partition 2: 10:10 - 10:15
        // Partition 3: 10:05 - 10:10
        // Partition 4: 10:02 - 10:05

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS (DESC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
            let start_mins = (start - 1617267600000000) / 60000000; // Minutes since 10:00
            let end_mins = (end - 1617267600000000) / 60000000;
            println!(
                "Partition {}: 10:{:02} - 10:{:02} ({} - {})",
                i + 1,
                start_mins,
                end_mins,
                start,
                end
            );
        }

        // Verify histogram alignment
        for [start, end] in &partitions {
            if *start != start_time && *end != end_time {
                assert_eq!(
                    *start % min_step,
                    0,
                    "Partition start should align with histogram interval"
                );
            }
        }
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_asc_order() {
        // Test case: 10:02 - 10:17 with 5-minute histogram interval
        let start_time = 1617267720000000; // 10:02
        let end_time = 1617268620000000; // 10:17
        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Asc, false);

        // Expected partitions for ASC order:
        // Partition 1: 10:02 - 10:05
        // Partition 2: 10:05 - 10:10
        // Partition 3: 10:10 - 10:15
        // Partition 4: 10:15 - 10:17

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS (ASC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
            let start_mins = (start - 1617267600000000) / 60000000; // Minutes since 10:00
            let end_mins = (end - 1617267600000000) / 60000000;
            println!(
                "Partition {}: 10:{:02} - 10:{:02} ({} - {})",
                i + 1,
                start_mins,
                end_mins,
                start,
                end
            );
        }

        // Verify histogram alignment and ASC order
        assert_eq!(
            partitions.first().unwrap()[0],
            start_time,
            "First partition should start at start_time"
        );
        assert_eq!(
            partitions.last().unwrap()[1],
            end_time,
            "Last partition should end at end_time"
        );

        // Verify histogram alignment
        for [start, end] in &partitions {
            if *start != start_time && *end != end_time {
                assert_eq!(
                    *start % min_step,
                    0,
                    "Partition start should align with histogram interval"
                );
            }
        }

        // Verify the partitions are in ascending order
        let mut prev_end = start_time;
        for [start, end] in &partitions {
            assert_eq!(*start, prev_end, "Partitions should be contiguous");
            assert!(*end > *start, "End time should be greater than start time");
            prev_end = *end;
        }
    }

    #[test]
    fn test_partition_generator_without_histogram_alignment_mini_partition() {
        // Test case: 10:02 - 10:17 with the same parameters as the histogram test
        let start_time = 1617267720000000; // 10:02
        let end_time = 1617268620000000; // 10:17
        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            false, // is_histogram = false
        );
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Desc, false);

        // Expected partitions:
        // 1. 10:16 - 10:17 (mini partition)
        // 2. 10:11 - 10:16
        // 3. 10:06 - 10:11
        // 4. 10:02 - 10:06

        // Print the actual partitions for debugging
        println!("NON-HISTOGRAM PARTITIONS (DESC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
            let start_mins = (start - 1617267600000000) / 60000000; // Minutes since 10:00
            let end_mins = (end - 1617267600000000) / 60000000;
            println!(
                "Partition {}: 10:{:02} - 10:{:02} ({} - {})",
                i + 1,
                start_mins,
                end_mins,
                start,
                end
            );
        }

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);

        // Verify mini partition is at the end (DESC order)
        let mini_partition = &partitions[0];
        let mini_partition_duration = mini_partition[1] - mini_partition[0];
        assert!(
            mini_partition_duration <= (mini_partition_duration_secs * 1_000_000) as i64,
            "Mini partition size should not exceed the configured duration"
        );
        assert_eq!(
            mini_partition[1], end_time,
            "Mini partition should end at end_time"
        );
    }

    #[test]
    fn test_partition_generator_asc_order_with_mini_partition() {
        // Test case: 10:02 - 10:17 with 5-minute intervals
        let start_time = 1617267720000000; // 10:02
        let end_time = 1617268620000000; // 10:17
        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            false, // is_histogram = false
        );
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Asc, false);

        // Expected partitions with ASC order:
        // 1. 10:02 - 10:03 (mini partition)
        // 2. 10:03 - 10:08
        // 3. 10:08 - 10:13
        // 4. 10:13 - 10:17

        // Print the actual partitions for debugging
        println!("NON-HISTOGRAM PARTITIONS (ASC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
            let start_mins = (start - 1617267600000000) / 60000000; // Minutes since 10:00
            let end_mins = (end - 1617267600000000) / 60000000;
            println!(
                "Partition {}: 10:{:02} - 10:{:02} ({} - {})",
                i + 1,
                start_mins,
                end_mins,
                start,
                end
            );
        }

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);

        // Verify mini partition is at the start (ASC order)
        let mini_partition = &partitions[0];
        let mini_partition_duration = mini_partition[1] - mini_partition[0];
        assert!(
            mini_partition_duration <= (mini_partition_duration_secs * 1_000_000) as i64,
            "Mini partition size should not exceed the configured duration"
        );
        assert_eq!(
            mini_partition[0], start_time,
            "Mini partition should start at start_time"
        );
    }

    #[test]
    fn test_partition_generator_with_streaming_aggregate_partition_window() {
        let start_time: i64 = 1748513700000 * 1_000; // 10:15
        let end_time: i64 = 1748528100000 * 1_000; // 14:15

        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(min_step, mini_partition_duration_secs, false);
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Desc, true);

        let mut expected_partitions = vec![
            [1748527200000000, 1748528100000000], // 14:00 - 14:15
            [1748523600000000, 1748527200000000], // 13:00 - 14:00
            [1748520000000000, 1748523600000000], // 12:00 - 13:00
            [1748516400000000, 1748520000000000], // 11:00 - 12:00
            [1748513700000000, 1748516400000000], // 10:15 - 11:00
        ];
        assert_eq!(partitions, expected_partitions);

        let partitions_asc =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Asc, true);
        expected_partitions.reverse();
        assert_eq!(partitions_asc, expected_partitions);
    }

    #[test]
    fn test_partition_generator_with_streaming_aggregate_aligned_boundary() {
        // Test case where end_time is exactly aligned to window boundary
        // This should not create empty partitions
        let start_time: i64 = 1748966400000000; // Aligned to hour
        let end_time: i64 = 1749153600000000; // Aligned to hour (52 hours later)

        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(min_step, mini_partition_duration_secs, false);
        let step = 300000000; // 5 minutes

        let partitions =
            generator.generate_partitions(start_time, end_time, step, OrderBy::Desc, true);

        // Verify no empty partitions exist
        for [start, end] in &partitions {
            assert!(
                *end > *start,
                "Partition [{}, {}] should not be empty",
                start,
                end
            );
        }

        // Verify full coverage
        assert_eq!(
            partitions.last().unwrap()[0],
            start_time,
            "First partition should start at start_time"
        );
        assert_eq!(
            partitions.first().unwrap()[1],
            end_time,
            "Last partition should end at end_time"
        );

        // Verify partitions are contiguous
        for i in 1..partitions.len() {
            assert_eq!(
                partitions[i][1],
                partitions[i - 1][0],
                "Partitions should be contiguous"
            );
        }
    }
}
