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
    #[allow(clippy::too_many_arguments)]
    pub fn generate_partitions(
        &self,
        start_time: i64,
        end_time: i64,
        step: i64,
        order_by: OrderBy,
        _is_streaming_aggregate: bool,
        _streaming_interval_micros: i64,
        add_mini_partition: bool,
    ) -> Vec<[i64; 2]> {
        #[cfg(feature = "enterprise")]
        if _is_streaming_aggregate {
            return self.generate_partitions_with_streaming_aggregate_partition_window(
                start_time,
                end_time,
                _streaming_interval_micros,
                order_by,
            );
        }

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
            "mini_partition_size_microseconds: {mini_partition_size}, step: {step}, end_time: {end_time}, start_time: {start_time}"
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

    #[cfg(feature = "enterprise")]
    fn generate_partitions_with_streaming_aggregate_partition_window(
        &self,
        start_time: i64,
        end_time: i64,
        interval_micros: i64,
        order_by: OrderBy,
    ) -> Vec<[i64; 2]> {
        // Generate partitions by DESC order
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
            // If the step is greater than the duration, handle the alignment for the boundary
            // partition
            if last_partition_step > 0 && duration > self.min_step {
                // Handle alignment for the first partition
                partitions.push([end - last_partition_step, end]);
                start -= last_partition_step;
                end -= last_partition_step;
            } else {
                start = max(start - last_partition_step, start_time);
            }
            // Ensure the start time is not less than the start time of the query
            start = max(start, start_time);
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 43200000000; // 12 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            false, // add_mini_partition = false
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            false, // add_mini_partition = false
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
        // let min_step_seconds = 1800; // 30 minutes in seconds
        let min_step_seconds = 3600; // 60 minutes in seconds
        let min_step = min_step_seconds * 1_000_000; // 30 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        // let step = min_step; // 30 minutes in microseconds
        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            false, // add_mini_partition = false
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            false, // add_mini_partition = false
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        // let step = 39600000000; // 11 hours in microseconds
        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            false, // add_mini_partition = false
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            false, // add_mini_partition = false
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 5 minutes in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            false, // add_mini_partition = false
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            false, // add_mini_partition = false
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = min_step; // 5 minutes in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            true, // add_mini_partition = true
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            true, // add_mini_partition = true
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 43200000000; // 12 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            true, // add_mini_partition = true
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            true, // add_mini_partition = true
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 14400000000; // 4 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            true, // add_mini_partition = true
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            true, // add_mini_partition = true
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 86400000000; // 24 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            true, // add_mini_partition = true
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            true, // add_mini_partition = true
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
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(
            min_step,
            mini_partition_duration_secs,
            true, // is_histogram = true
        );
        let step = 72000000000; // 24 hours in microseconds

        // Test Descending
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            false,
            0,
            true, // add_mini_partition = true
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
        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            false,
            0,
            true, // add_mini_partition = true
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

#[cfg(test)]
#[cfg(feature = "enterprise")]
mod enterprise_tests {
    use super::*;

    #[test]
    fn test_partition_generator_with_streaming_aggregate_partition_window() {
        let start_time: i64 = 1748513700000 * 1_000; // 10:15
        let end_time: i64 = 1748528100000 * 1_000; // 14:15

        let min_step = 300000000; // 5 minutes in microseconds
        let mini_partition_duration_secs = 60;

        let generator = PartitionGenerator::new(min_step, mini_partition_duration_secs, false);
        let step = 300000000; // 5 minutes

        let interval = 3600000000;

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            true,
            interval,
            false,
        );

        let mut expected_partitions = vec![
            [1748527200000000, 1748528100000000], // 14:00 - 14:15
            [1748523600000000, 1748527200000000], // 13:00 - 14:00
            [1748520000000000, 1748523600000000], // 12:00 - 13:00
            [1748516400000000, 1748520000000000], // 11:00 - 12:00
            [1748513700000000, 1748516400000000], // 10:15 - 11:00
        ];
        assert_eq!(partitions, expected_partitions);

        let partitions_asc = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            true,
            interval,
            false,
        );
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

        let interval = 3600000000;

        let partitions = generator.generate_partitions(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            true,
            interval,
            false,
        );

        // Verify no empty partitions exist
        for [start, end] in &partitions {
            assert!(
                *end > *start,
                "Partition [{start}, {end}] should not be empty"
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
