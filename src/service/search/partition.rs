use std::cmp::max;

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
    pub fn generate_partitions(&self, start_time: i64, end_time: i64, step: i64) -> Vec<[i64; 2]> {
        if self.is_histogram {
            // Use the old partition logic for histogram queries
            return self
                .generate_partitions_aligned_with_histogram_interval(start_time, end_time, step);
        } else {
            // For non-histogram queries, generate partitions with mini partition for faster initial
            // results
            return self.generate_partitions_with_mini_partition(start_time, end_time, step);
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
    ) -> Vec<[i64; 2]> {
        // Generate partitions by DESC order
        let mut partitions = Vec::new();
        let mut end = end_time;

        // Create a single mini partition for faster initial results
        let mini_partition_size_microseconds =
            std::cmp::min(self.mini_partition_duration_secs * 1_000_000, step as u64) as i64;

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

        partitions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_generator_with_histogram_alignment_without_mini_partition() {
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

        let partitions = generator.generate_partitions(start_time, end_time, step);

        // Expected partitions:
        // Partition 1: 10:15 - 10:17
        // Partition 2: 10:10 - 10:15
        // Partition 3: 10:05 - 10:10
        // Partition 4: 10:02 - 10:05

        // Print the actual partitions for debugging
        println!("HISTOGRAM PARTITIONS:");
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

        let partitions = generator.generate_partitions(start_time, end_time, step);

        // Expected partitions:
        // 1. 10:16 - 10:17 (mini partition)
        // 2. 10:11 - 10:16
        // 3. 10:06 - 10:11
        // 4. 10:02 - 10:06

        // Print the actual partitions for debugging
        println!("NON-HISTOGRAM PARTITIONS:");
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
    }
}
