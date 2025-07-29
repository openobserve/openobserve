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
        add_mini_partition: bool,
    ) -> Vec<[i64; 2]> {
        if self.is_histogram {
            self.generate_partitions_aligned_with_histogram_interval(
                start_time,
                end_time,
                step,
                order_by,
                add_mini_partition,
            )
        } else {
            self.generate_partitions_with_mini_partition(start_time, end_time, step, order_by)
        }
    }

    /// Calculate mini partition size in microseconds
    fn calculate_mini_partition_size(&self, step: i64) -> i64 {
        std::cmp::min(self.mini_partition_duration_secs * 1_000_000, step as u64) as i64
    }

    /// Create a mini partition based on order
    fn create_mini_partition(
        &self,
        start_time: i64,
        end_time: i64,
        mini_partition_size: i64,
        order_by: OrderBy,
    ) -> Option<[i64; 2]> {
        let duration = end_time - start_time;
        if mini_partition_size >= duration {
            return None;
        }

        let mini_partition = match order_by {
            OrderBy::Desc => {
                // For DESC order, mini partition at the end time
                let mini_start = std::cmp::max(end_time - mini_partition_size, start_time);
                [mini_start, end_time]
            }
            OrderBy::Asc => {
                // For ASC order, mini partition at the start time
                let mini_end = std::cmp::min(start_time + mini_partition_size, end_time);
                [start_time, mini_end]
            }
        };

        Some(mini_partition)
    }

    /// Generate regular partitions without histogram alignment
    fn generate_regular_partitions(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        let mut partitions = Vec::new();

        match order_by {
            OrderBy::Desc => {
                let mut end = end_time;
                while end > start_time {
                    let start = std::cmp::max(end - step, start_time);
                    partitions.push([start, end]);
                    end = start;
                }
            }
            OrderBy::Asc => {
                let mut start = start_time;
                while start < end_time {
                    let end = std::cmp::min(start + step, end_time);
                    partitions.push([start, end]);
                    start = end;
                }
            }
        }

        partitions
    }

    /// Generate histogram-aligned partitions
    fn generate_histogram_aligned_partitions(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        let mut partitions = Vec::new();
        let duration = end_time - start_time;

        // Generate partitions by DESC order first, then reverse if needed
        let mut end = end_time;
        let mut last_partition_step = end % self.min_step;

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

        // We need to reverse partitions if query is ASC order
        if order_by == OrderBy::Asc {
            partitions.reverse();
        }

        partitions
    }

    /// Generate histogram-aligned partitions with mini partition
    fn generate_histogram_aligned_partitions_with_mini(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
        mini_partition_size: i64,
    ) -> Vec<[i64; 2]> {
        let mut partitions = Vec::new();

        // Add mini partition
        if let Some(mini_partition) =
            self.create_mini_partition(start_time, end_time, mini_partition_size, order_by)
        {
            partitions.push(mini_partition);

            // Generate remaining partitions with histogram alignment
            match order_by {
                OrderBy::Desc => {
                    let remaining_start = mini_partition[0];
                    let remaining_partitions = self.generate_histogram_aligned_partitions(
                        start_time,
                        remaining_start,
                        step,
                        OrderBy::Desc,
                    );
                    partitions.extend(remaining_partitions);
                }
                OrderBy::Asc => {
                    let remaining_end = mini_partition[1];
                    let remaining_partitions = self.generate_histogram_aligned_partitions(
                        remaining_end,
                        end_time,
                        step,
                        OrderBy::Asc,
                    );
                    partitions.extend(remaining_partitions);
                }
            }
        } else {
            // Fall back to regular histogram alignment if mini partition can't be created
            partitions =
                self.generate_histogram_aligned_partitions(start_time, end_time, step, order_by);
        }

        partitions
    }

    /// Handle edge case of empty partitions
    fn handle_empty_partitions(
        &self,
        partitions: &mut Vec<[i64; 2]>,
        start_time: i64,
        end_time: i64,
    ) {
        if partitions.is_empty() {
            partitions.push([start_time, end_time]);
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
        let mini_partition_size = self.calculate_mini_partition_size(step);

        log::debug!(
            "mini_partition_size_microseconds: {}, step: {}, end_time: {}, start_time: {}",
            mini_partition_size,
            step,
            end_time,
            start_time
        );

        // Add mini partition if possible
        if let Some(mini_partition) =
            self.create_mini_partition(start_time, end_time, mini_partition_size, order_by)
        {
            partitions.push(mini_partition);

            // Generate remaining partitions
            match order_by {
                OrderBy::Desc => {
                    let remaining_start = mini_partition[0];
                    let remaining_partitions = self.generate_regular_partitions(
                        start_time,
                        remaining_start,
                        step,
                        OrderBy::Desc,
                    );
                    partitions.extend(remaining_partitions);
                }
                OrderBy::Asc => {
                    let remaining_end = mini_partition[1];
                    let remaining_partitions = self.generate_regular_partitions(
                        remaining_end,
                        end_time,
                        step,
                        OrderBy::Asc,
                    );
                    partitions.extend(remaining_partitions);
                }
            }
        } else {
            // Fall back to regular partitions if mini partition can't be created
            partitions = self.generate_regular_partitions(start_time, end_time, step, order_by);
        }

        self.handle_empty_partitions(&mut partitions, start_time, end_time);
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
        add_mini_partition: bool,
    ) -> Vec<[i64; 2]> {
        let mini_partition_size = self.calculate_mini_partition_size(step);

        let mut partitions = if add_mini_partition {
            self.generate_histogram_aligned_partitions_with_mini(
                start_time,
                end_time,
                step,
                order_by,
                mini_partition_size,
            )
        } else {
            self.generate_histogram_aligned_partitions(start_time, end_time, step, order_by)
        };

        self.handle_empty_partitions(&mut partitions, start_time, end_time);
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
            generator.generate_partitions(start_time, end_time, step, OrderBy::Desc, true);

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
            generator.generate_partitions(start_time, end_time, step, OrderBy::Asc, true);

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

    // Actual start
    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_order_by_desc() {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 30 minutes in microseconds

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false, // add_mini_partition = false
        );

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
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
            println!("Partition {}: {} - {}", i + 1, start, end);
        }

        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // Number of partitions: 24
        // Partition 1: 2025-07-29 21:30:00 - 2025-07-29 22:00:00
        // Partition 2: 2025-07-29 21:00:00 - 2025-07-29 21:30:00
        // Partition 3: 2025-07-29 20:30:00 - 2025-07-29 21:00:00
        // Partition 4: 2025-07-29 20:00:00 - 2025-07-29 20:30:00
        // Partition 5: 2025-07-29 19:30:00 - 2025-07-29 20:00:00
        // Partition 6: 2025-07-29 19:00:00 - 2025-07-29 19:30:00
        // Partition 7: 2025-07-29 18:30:00 - 2025-07-29 19:00:00
        // Partition 8: 2025-07-29 18:00:00 - 2025-07-29 18:30:00
        // Partition 9: 2025-07-29 17:30:00 - 2025-07-29 18:00:00
        // Partition 10: 2025-07-29 17:00:00 - 2025-07-29 17:30:00
        // Partition 11: 2025-07-29 16:30:00 - 2025-07-29 17:00:00
        // Partition 12: 2025-07-29 16:00:00 - 2025-07-29 16:30:00
        // Partition 13: 2025-07-29 15:30:00 - 2025-07-29 16:00:00
        // Partition 14: 2025-07-29 15:00:00 - 2025-07-29 15:30:00
        // Partition 15: 2025-07-29 14:30:00 - 2025-07-29 15:00:00
        // Partition 16: 2025-07-29 14:00:00 - 2025-07-29 14:30:00
        // Partition 17: 2025-07-29 13:30:00 - 2025-07-29 14:00:00
        // Partition 18: 2025-07-29 13:00:00 - 2025-07-29 13:30:00
        // Partition 19: 2025-07-29 12:30:00 - 2025-07-29 13:00:00
        // Partition 20: 2025-07-29 12:00:00 - 2025-07-29 12:30:00
        // Partition 21: 2025-07-29 11:30:00 - 2025-07-29 12:00:00
        // Partition 22: 2025-07-29 11:00:00 - 2025-07-29 11:30:00
        // Partition 23: 2025-07-29 10:30:00 - 2025-07-29 11:00:00
        // Partition 24: 2025-07-29 10:00:00 - 2025-07-29 10:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_and_mini_partition_order_by_desc() {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 30 minutes in microseconds

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            true, // add_mini_partition = false
        );

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
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
            println!("Partition {}: {} - {}", i + 1, start, end);
        }

        // HISTOGRAM PARTITIONS WITH MINI PARTITION (DESC):
        // Number of partitions: 25
        // Partition 1: 2025-07-29 21:59:00 - 2025-07-29 22:00:00
        // Partition 2: 2025-07-29 21:30:00 - 2025-07-29 21:59:00
        // Partition 3: 2025-07-29 21:00:00 - 2025-07-29 21:30:00
        // Partition 4: 2025-07-29 20:30:00 - 2025-07-29 21:00:00
        // Partition 5: 2025-07-29 20:00:00 - 2025-07-29 20:30:00
        // Partition 6: 2025-07-29 19:30:00 - 2025-07-29 20:00:00
        // Partition 7: 2025-07-29 19:00:00 - 2025-07-29 19:30:00
        // Partition 8: 2025-07-29 18:30:00 - 2025-07-29 19:00:00
        // Partition 9: 2025-07-29 18:00:00 - 2025-07-29 18:30:00
        // Partition 10: 2025-07-29 17:30:00 - 2025-07-29 18:00:00
        // Partition 11: 2025-07-29 17:00:00 - 2025-07-29 17:30:00
        // Partition 12: 2025-07-29 16:30:00 - 2025-07-29 17:00:00
        // Partition 13: 2025-07-29 16:00:00 - 2025-07-29 16:30:00
        // Partition 14: 2025-07-29 15:30:00 - 2025-07-29 16:00:00
        // Partition 15: 2025-07-29 15:00:00 - 2025-07-29 15:30:00
        // Partition 16: 2025-07-29 14:30:00 - 2025-07-29 15:00:00
        // Partition 17: 2025-07-29 14:00:00 - 2025-07-29 14:30:00
        // Partition 18: 2025-07-29 13:30:00 - 2025-07-29 14:00:00
        // Partition 19: 2025-07-29 13:00:00 - 2025-07-29 13:30:00
        // Partition 20: 2025-07-29 12:30:00 - 2025-07-29 13:00:00
        // Partition 21: 2025-07-29 12:00:00 - 2025-07-29 12:30:00
        // Partition 22: 2025-07-29 11:30:00 - 2025-07-29 12:00:00
        // Partition 23: 2025-07-29 11:00:00 - 2025-07-29 11:30:00
        // Partition 24: 2025-07-29 10:30:00 - 2025-07-29 11:00:00
        // Partition 25: 2025-07-29 10:00:00 - 2025-07-29 10:30:00

        // Verify full coverage of time range
        assert_eq!(partitions.last().unwrap()[0], start_time);
        assert_eq!(partitions.first().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_no_mini_partition_order_by_asc() {
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 30 minutes in microseconds

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false, // add_mini_partition = false
        );

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
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
            println!("Partition {}: {} - {}", i + 1, start, end);
        }

        // HISTOGRAM PARTITIONS NO MINI PARTITION (ASC):
        // Number of partitions: 24
        // Partition 1: 2025-07-29 10:00:00 - 2025-07-29 10:30:00
        // Partition 2: 2025-07-29 10:30:00 - 2025-07-29 11:00:00
        // Partition 3: 2025-07-29 11:00:00 - 2025-07-29 11:30:00
        // Partition 4: 2025-07-29 11:30:00 - 2025-07-29 12:00:00
        // Partition 5: 2025-07-29 12:00:00 - 2025-07-29 12:30:00
        // Partition 6: 2025-07-29 12:30:00 - 2025-07-29 13:00:00
        // Partition 7: 2025-07-29 13:00:00 - 2025-07-29 13:30:00
        // Partition 8: 2025-07-29 13:30:00 - 2025-07-29 14:00:00
        // Partition 9: 2025-07-29 14:00:00 - 2025-07-29 14:30:00
        // Partition 10: 2025-07-29 14:30:00 - 2025-07-29 15:00:00
        // Partition 11: 2025-07-29 15:00:00 - 2025-07-29 15:30:00
        // Partition 12: 2025-07-29 15:30:00 - 2025-07-29 16:00:00
        // Partition 13: 2025-07-29 16:00:00 - 2025-07-29 16:30:00
        // Partition 14: 2025-07-29 16:30:00 - 2025-07-29 17:00:00
        // Partition 15: 2025-07-29 17:00:00 - 2025-07-29 17:30:00
        // Partition 16: 2025-07-29 17:30:00 - 2025-07-29 18:00:00
        // Partition 17: 2025-07-29 18:00:00 - 2025-07-29 18:30:00
        // Partition 18: 2025-07-29 18:30:00 - 2025-07-29 19:00:00
        // Partition 19: 2025-07-29 19:00:00 - 2025-07-29 19:30:00
        // Partition 20: 2025-07-29 19:30:00 - 2025-07-29 20:00:00
        // Partition 21: 2025-07-29 20:00:00 - 2025-07-29 20:30:00
        // Partition 22: 2025-07-29 20:30:00 - 2025-07-29 21:00:00
        // Partition 23: 2025-07-29 21:00:00 - 2025-07-29 21:30:00
        // Partition 24: 2025-07-29 21:30:00 - 2025-07-29 22:00:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }

    #[test]
    fn test_partition_generator_with_histogram_alignment_mini_partition_order_by_asc() {
        // Test case: 10:02 - 10:17 with 5-minute histogram interval and mini partition
        let start_time = 1753763400000000; // Tuesday, July 29, 2025 at 10:00:00 AM GMT+5:30
        let end_time = 1753806600000000; // Tuesday, July 29, 2025 at 10:00:00 PM GMT+5:30
        let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 30 minutes in microseconds

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            true, // add_mini_partition = true
        );

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):");
        println!("Number of partitions: {}", partitions.len());
        for (i, [start, end]) in partitions.iter().enumerate() {
            // Convert to human-readable time for debugging
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
            println!("Partition {}: {} - {}", i + 1, start, end);
        }

        // HISTOGRAM PARTITIONS NO MINI PARTITION (DESC):
        // Number of partitions: 25
        // Partition 1: 2025-07-29 10:00:00 - 2025-07-29 10:01:00
        // Partition 2: 2025-07-29 10:01:00 - 2025-07-29 10:30:00
        // Partition 3: 2025-07-29 10:30:00 - 2025-07-29 11:00:00
        // Partition 4: 2025-07-29 11:00:00 - 2025-07-29 11:30:00
        // Partition 5: 2025-07-29 11:30:00 - 2025-07-29 12:00:00
        // Partition 6: 2025-07-29 12:00:00 - 2025-07-29 12:30:00
        // Partition 7: 2025-07-29 12:30:00 - 2025-07-29 13:00:00
        // Partition 8: 2025-07-29 13:00:00 - 2025-07-29 13:30:00
        // Partition 9: 2025-07-29 13:30:00 - 2025-07-29 14:00:00
        // Partition 10: 2025-07-29 14:00:00 - 2025-07-29 14:30:00
        // Partition 11: 2025-07-29 14:30:00 - 2025-07-29 15:00:00
        // Partition 12: 2025-07-29 15:00:00 - 2025-07-29 15:30:00
        // Partition 13: 2025-07-29 15:30:00 - 2025-07-29 16:00:00
        // Partition 14: 2025-07-29 16:00:00 - 2025-07-29 16:30:00
        // Partition 15: 2025-07-29 16:30:00 - 2025-07-29 17:00:00
        // Partition 16: 2025-07-29 17:00:00 - 2025-07-29 17:30:00
        // Partition 17: 2025-07-29 17:30:00 - 2025-07-29 18:00:00
        // Partition 18: 2025-07-29 18:00:00 - 2025-07-29 18:30:00
        // Partition 19: 2025-07-29 18:30:00 - 2025-07-29 19:00:00
        // Partition 20: 2025-07-29 19:00:00 - 2025-07-29 19:30:00
        // Partition 21: 2025-07-29 19:30:00 - 2025-07-29 20:00:00
        // Partition 22: 2025-07-29 20:00:00 - 2025-07-29 20:30:00
        // Partition 23: 2025-07-29 20:30:00 - 2025-07-29 21:00:00
        // Partition 24: 2025-07-29 21:00:00 - 2025-07-29 21:30:00
        // Partition 25: 2025-07-29 21:30:00 - 2025-07-29 22:00:00

        // Verify full coverage of time range
        assert_eq!(partitions.first().unwrap()[0], start_time);
        assert_eq!(partitions.last().unwrap()[1], end_time);
    }
}
