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

use config::meta::sql::OrderBy;

/// Generate partitions with a mini partition for faster initial results
pub(super) fn generate_partitions_with_mini_partition(
    start_time: i64,
    end_time: i64,
    step: i64,
    order_by: OrderBy,
    mini_partition_duration_secs: u64,
) -> Vec<[i64; 2]> {
    let mut partitions = Vec::new();
    let mini_partition_size =
        std::cmp::min(mini_partition_duration_secs * 1_000_000, step as u64) as i64;

    log::debug!(
        "mini_partition_size_microseconds: {mini_partition_size}, step: {step}, end_time: {end_time}, start_time: {start_time}"
    );

    // Add mini partition if possible
    if let Some(mini_partition) =
        create_mini_partition(start_time, end_time, mini_partition_size, order_by)
    {
        partitions.push(mini_partition);

        // Generate remaining partitions
        match order_by {
            OrderBy::Desc => {
                let remaining_start = mini_partition[0];
                let remaining_partitions =
                    generate_regular_partitions(start_time, remaining_start, step, OrderBy::Desc);
                partitions.extend(remaining_partitions);
            }
            OrderBy::Asc => {
                let remaining_end = mini_partition[1];
                let remaining_partitions =
                    generate_regular_partitions(remaining_end, end_time, step, OrderBy::Asc);
                partitions.extend(remaining_partitions);
            }
        }
    } else {
        // Fall back to regular partitions if mini partition can't be created
        partitions = generate_regular_partitions(start_time, end_time, step, order_by);
    }

    if partitions.is_empty() {
        partitions.push([start_time, end_time]);
    }
    partitions
}

/// Create a mini partition based on order
fn create_mini_partition(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_partitions_with_mini_partition_desc_and_asc() {
        // 30-minute window, 10-minute step, 60-second mini partition.
        let start_time: i64 = 0;
        let end_time: i64 = 1_800_000_000; // 30 minutes in microseconds

        let mini_partition_duration_secs = 60;
        let step = 600_000_000; // 10 minutes in microseconds

        let partitions = generate_partitions_with_mini_partition(
            start_time,
            end_time,
            step,
            OrderBy::Desc,
            mini_partition_duration_secs,
        );

        let mut expected_partitions = vec![
            [1_740_000_000, 1_800_000_000], // mini: last 60s
            [1_140_000_000, 1_740_000_000], // 10 min
            [540_000_000, 1_140_000_000],   // 10 min
            [0, 540_000_000],               // 9 min (clamped to start_time)
        ];
        assert_eq!(partitions, expected_partitions);

        let partitions_asc = generate_partitions_with_mini_partition(
            start_time,
            end_time,
            step,
            OrderBy::Asc,
            mini_partition_duration_secs,
        );

        expected_partitions = vec![
            [0, 60_000_000],                // mini: first 60s
            [60_000_000, 660_000_000],      // 10 min
            [660_000_000, 1_260_000_000],   // 10 min
            [1_260_000_000, 1_800_000_000], // 9 min (clamped to end_time)
        ];
        assert_eq!(partitions_asc, expected_partitions);
    }

    #[test]
    fn test_generate_partitions_with_mini_partition_contiguous_coverage() {
        // start_time and end_time aligned to the step boundary should still produce
        // contiguous, non-empty partitions with full coverage.
        let start_time: i64 = 1_748_966_400_000_000;
        let end_time: i64 = 1_749_153_600_000_000; // 52 hours later

        let mini_partition_duration_secs = 60;
        let step = 300_000_000; // 5 minutes

        for order_by in [OrderBy::Desc, OrderBy::Asc] {
            let partitions = generate_partitions_with_mini_partition(
                start_time,
                end_time,
                step,
                order_by,
                mini_partition_duration_secs,
            );

            for [start, end] in &partitions {
                assert!(
                    *end > *start,
                    "Partition [{start}, {end}] should not be empty"
                );
            }

            let (first_start, last_end) = match order_by {
                OrderBy::Desc => (
                    partitions.last().unwrap()[0],
                    partitions.first().unwrap()[1],
                ),
                OrderBy::Asc => (
                    partitions.first().unwrap()[0],
                    partitions.last().unwrap()[1],
                ),
            };
            assert_eq!(
                first_start, start_time,
                "Partitions should start at start_time"
            );
            assert_eq!(last_end, end_time, "Partitions should end at end_time");

            for i in 1..partitions.len() {
                let (prev_adjacent, curr_adjacent) = match order_by {
                    OrderBy::Desc => (partitions[i - 1][0], partitions[i][1]),
                    OrderBy::Asc => (partitions[i - 1][1], partitions[i][0]),
                };
                assert_eq!(
                    prev_adjacent, curr_adjacent,
                    "Partitions should be contiguous"
                );
            }
        }
    }
}
