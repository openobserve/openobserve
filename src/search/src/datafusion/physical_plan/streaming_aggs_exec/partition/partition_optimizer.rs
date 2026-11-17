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

use config::meta::{
    search::{CardinalityLevel, Interval, generate_aggregation_search_interval},
    sql::OrderBy,
};

use super::discovery::{CacheDiscoveryResult, CacheEntry, TimeRange};

/// Strategy for handling query partitions based on cache availability
#[derive(Debug, Clone)]
pub enum StreamingAggsPartitionStrategy {
    /// All data is available in cache - no query execution needed
    FullyCached { cache_files: Vec<CacheEntry> },
    /// Mix of cached and uncached data
    Hybrid {
        cached_partitions: Vec<CachedPartition>,
        uncached_partitions: Vec<UncachedPartition>,
    },
    /// No cache available - execute query normally
    NoCacheAvailable { partitions: Vec<UncachedPartition> },
}

impl StreamingAggsPartitionStrategy {
    /// Strategy Name
    pub fn strategy_name(&self) -> &str {
        match self {
            StreamingAggsPartitionStrategy::FullyCached { .. } => "FullyCached",
            StreamingAggsPartitionStrategy::Hybrid { .. } => "Hybrid",
            StreamingAggsPartitionStrategy::NoCacheAvailable { .. } => "NoCacheAvailable",
        }
    }

    /// Returns true if this strategy requires query execution
    pub fn requires_execution(&self) -> bool {
        match self {
            StreamingAggsPartitionStrategy::FullyCached { .. } => false,
            StreamingAggsPartitionStrategy::Hybrid { .. }
            | StreamingAggsPartitionStrategy::NoCacheAvailable { .. } => true,
        }
    }

    /// Returns the number of partitions that need to be executed
    pub fn execution_partition_count(&self) -> usize {
        match self {
            StreamingAggsPartitionStrategy::FullyCached { .. } => 0,
            StreamingAggsPartitionStrategy::Hybrid {
                uncached_partitions,
                ..
            } => uncached_partitions.len(),
            StreamingAggsPartitionStrategy::NoCacheAvailable { partitions } => partitions.len(),
        }
    }

    /// Converts the partition strategy into time range partitions [start, end]
    /// This is the format expected by the rest of the search system
    ///
    /// # Arguments
    /// * `order_by` - The sort order (Asc or Desc) for partitions
    ///
    /// # Returns
    /// Vector of [start_time, end_time] pairs in the requested order
    pub fn to_time_partitions(&self, order_by: OrderBy) -> Vec<[i64; 2]> {
        let mut partitions = Vec::new();

        match self {
            StreamingAggsPartitionStrategy::FullyCached { cache_files } => {
                // For fully cached queries, return a SINGLE partition covering the entire range
                // This avoids unnecessary iteration over individual cache files
                if !cache_files.is_empty() {
                    let min_start = cache_files.iter().map(|f| f.start_time).min().unwrap();
                    let max_end = cache_files.iter().map(|f| f.end_time).max().unwrap();
                    partitions.push([min_start, max_end]);
                }
            }
            StreamingAggsPartitionStrategy::Hybrid {
                cached_partitions,
                uncached_partitions,
            } => {
                // Add cached partitions
                for cached in cached_partitions {
                    partitions.push([cached.start_time, cached.end_time]);
                }

                // Add uncached partitions
                for uncached in uncached_partitions {
                    partitions.push([uncached.start_time, uncached.end_time]);
                }

                // Sort by start time to ensure chronological order
                partitions.sort_by_key(|p| p[0]);
            }
            StreamingAggsPartitionStrategy::NoCacheAvailable { partitions: p } => {
                for partition in p {
                    partitions.push([partition.start_time, partition.end_time]);
                }
            }
        }

        // Apply ordering
        if order_by == OrderBy::Desc {
            partitions.reverse();
        }

        partitions
    }
}

/// Represents a partition that is fully covered by cache
#[derive(Debug, Clone)]
pub struct CachedPartition {
    pub cache_files: Vec<CacheEntry>,
    pub start_time: i64,
    pub end_time: i64,
    pub interval: Interval,
}

impl CachedPartition {
    pub fn new(
        cache_files: Vec<CacheEntry>,
        start_time: i64,
        end_time: i64,
        interval: Interval,
    ) -> Self {
        Self {
            cache_files,
            start_time,
            end_time,
            interval,
        }
    }
}

/// Represents a partition that needs to be executed (not in cache)
#[derive(Debug, Clone)]
pub struct UncachedPartition {
    pub start_time: i64,
    pub end_time: i64,
}

impl UncachedPartition {
    pub fn new(start_time: i64, end_time: i64) -> Self {
        Self {
            start_time,
            end_time,
        }
    }
}

/// Generates optimal partition strategy based on cache discovery results
///
/// # Arguments
/// * `discovery_result` - Result from cache discovery
/// * `query_start` - Query start time in microseconds
/// * `query_end` - Query end time in microseconds
/// * `cardinality_level` - Cardinality level for determining cache intervals
///
/// # Returns
/// * `PartitionStrategy` - Optimal strategy for executing the query
pub fn generate_optimal_partitions(
    discovery_result: CacheDiscoveryResult,
    query_start: i64,
    query_end: i64,
    cardinality_level: CardinalityLevel,
) -> StreamingAggsPartitionStrategy {
    // Case 1: Fully cached - no execution needed
    if discovery_result.is_fully_cached() {
        return StreamingAggsPartitionStrategy::FullyCached {
            cache_files: discovery_result.cached_ranges,
        };
    }

    // Calculate the target interval for the entire query based on query duration
    let query_target_interval =
        generate_aggregation_search_interval(query_start, query_end, cardinality_level);

    // Case 2: No cache available - use standard ladder logic
    if discovery_result.has_no_cache() {
        let partitions =
            generate_uncached_partitions_from_range(query_start, query_end, query_target_interval);
        return StreamingAggsPartitionStrategy::NoCacheAvailable { partitions };
    }

    // Case 3: Hybrid - mix of cached and uncached
    let cached_partitions = group_cache_entries_into_partitions(discovery_result.cached_ranges);
    let uncached_partitions =
        generate_uncached_partitions(discovery_result.uncached_ranges, query_target_interval);

    StreamingAggsPartitionStrategy::Hybrid {
        cached_partitions,
        uncached_partitions,
    }
}

/// Groups consecutive cache entries with the same interval into cached partitions
///
/// # Preconditions
/// - `cache_entries` must be sorted by `start_time` (ascending)
/// - This is guaranteed by `discover_cache_for_query()` which sorts entries before returning
///
/// # Behavior
/// - Creates separate partitions when interval changes
/// - Creates separate partitions when there's a time gap between entries
/// - Assumes entries are non-overlapping (guaranteed by cache write logic)
fn group_cache_entries_into_partitions(cache_entries: Vec<CacheEntry>) -> Vec<CachedPartition> {
    if cache_entries.is_empty() {
        return vec![];
    }

    let mut partitions = Vec::new();
    let mut current_group: Vec<CacheEntry> = vec![];
    let mut current_interval = cache_entries[0].interval;

    for entry in cache_entries {
        // If the interval changes or there's a gap, create a new partition
        if entry.interval != current_interval
            || (!current_group.is_empty()
                && entry.start_time > current_group.last().unwrap().end_time)
        {
            if !current_group.is_empty() {
                let start_time = current_group.first().unwrap().start_time;
                let end_time = current_group.last().unwrap().end_time;
                partitions.push(CachedPartition::new(
                    current_group,
                    start_time,
                    end_time,
                    current_interval,
                ));
            }
            current_group = vec![entry.clone()];
            current_interval = entry.interval;
        } else {
            current_group.push(entry);
        }
    }

    // Don't forget the last group
    if !current_group.is_empty() {
        let start_time = current_group.first().unwrap().start_time;
        let end_time = current_group.last().unwrap().end_time;
        partitions.push(CachedPartition::new(
            current_group,
            start_time,
            end_time,
            current_interval,
        ));
    }

    partitions
}

/// Generates uncached partitions from time ranges using the query's target interval
fn generate_uncached_partitions(
    uncached_ranges: Vec<TimeRange>,
    target_interval: Interval,
) -> Vec<UncachedPartition> {
    let mut partitions = Vec::new();

    for range in uncached_ranges {
        let range_partitions = generate_uncached_partitions_from_range(
            range.start_time,
            range.end_time,
            target_interval,
        );
        partitions.extend(range_partitions);
    }

    partitions
}

/// Generates uncached partitions for a single time range using the specified target interval
fn generate_uncached_partitions_from_range(
    start_time: i64,
    end_time: i64,
    target_interval: Interval,
) -> Vec<UncachedPartition> {
    // Use the query's target interval (already calculated based on total query duration)
    // This ensures all uncached partitions use the same interval regardless of gap size

    // If interval is Zero, we don't cache (e.g., for Huge cardinality)
    if target_interval == Interval::Zero {
        return vec![UncachedPartition::new(start_time, end_time)];
    }

    let interval_micros = target_interval.get_interval_microseconds();
    let mut partitions = Vec::new();

    // Align start time to UTC boundary
    let aligned_start = align_time_to_interval(start_time, interval_micros, true);

    // If query starts before the first aligned boundary, create a non-aligned partition
    if start_time < aligned_start {
        partitions.push(UncachedPartition::new(
            start_time,
            aligned_start.min(end_time),
        ));
    }

    // Generate UTC-aligned partitions
    let mut current_time = aligned_start;
    while current_time < end_time {
        let partition_end = (current_time + interval_micros).min(end_time);

        partitions.push(UncachedPartition::new(current_time, partition_end));

        current_time = partition_end;
    }

    partitions
}

/// Aligns a timestamp to the nearest interval boundary
///
/// # Arguments
/// * `timestamp` - Timestamp in microseconds (assumed to be within reasonable bounds: year
///   1970-2200)
/// * `interval_micros` - Interval duration in microseconds (max: 1 day = 86,400,000,000)
/// * `round_up` - If true, rounds up to next boundary; if false, rounds down
///
/// # Safety
/// This function uses unchecked arithmetic. Integer overflow is not possible with realistic
/// timestamp values (years 1970-2200) and supported intervals (5min to 1day). The maximum
/// result is bounded by `timestamp + interval_micros`, which is well within i64::MAX for
/// any reasonable query timestamp.
fn align_time_to_interval(timestamp: i64, interval_micros: i64, round_up: bool) -> i64 {
    let remainder = timestamp % interval_micros;
    if remainder == 0 {
        timestamp
    } else if round_up {
        timestamp + (interval_micros - remainder)
    } else {
        timestamp - remainder
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_strategy_fully_cached() {
        let cache_files = vec![CacheEntry {
            file_path: "test.arrow".to_string(),
            start_time: 0,
            end_time: 1000,
            interval: Interval::OneHour,
        }];

        let strategy = StreamingAggsPartitionStrategy::FullyCached {
            cache_files: cache_files.clone(),
        };

        assert!(!strategy.requires_execution());
        assert_eq!(strategy.execution_partition_count(), 0);
    }

    #[test]
    fn test_partition_strategy_no_cache() {
        let partitions = vec![UncachedPartition::new(0, 1000)];

        let strategy = StreamingAggsPartitionStrategy::NoCacheAvailable {
            partitions: partitions.clone(),
        };

        assert!(strategy.requires_execution());
        assert_eq!(strategy.execution_partition_count(), 1);
    }

    #[test]
    fn test_partition_strategy_hybrid() {
        let cached = vec![CachedPartition::new(vec![], 0, 500, Interval::OneHour)];
        let uncached = vec![UncachedPartition::new(500, 1000)];

        let strategy = StreamingAggsPartitionStrategy::Hybrid {
            cached_partitions: cached.clone(),
            uncached_partitions: uncached.clone(),
        };

        assert!(strategy.requires_execution());
        assert_eq!(strategy.execution_partition_count(), 1);
    }

    #[test]
    fn test_align_time_to_interval() {
        let one_hour_micros = 3_600_000_000i64;

        // Already aligned
        assert_eq!(align_time_to_interval(0, one_hour_micros, true), 0);
        assert_eq!(align_time_to_interval(0, one_hour_micros, false), 0);
        assert_eq!(
            align_time_to_interval(one_hour_micros, one_hour_micros, true),
            one_hour_micros
        );

        // Not aligned - round up
        assert_eq!(
            align_time_to_interval(100, one_hour_micros, true),
            one_hour_micros
        );
        assert_eq!(
            align_time_to_interval(one_hour_micros + 100, one_hour_micros, true),
            one_hour_micros * 2
        );

        // Not aligned - round down
        assert_eq!(align_time_to_interval(100, one_hour_micros, false), 0);
        assert_eq!(
            align_time_to_interval(one_hour_micros + 100, one_hour_micros, false),
            one_hour_micros
        );
    }

    #[test]
    fn test_generate_uncached_partitions_from_range_zero_interval() {
        // For Zero interval, we don't partition
        let partitions = generate_uncached_partitions_from_range(0, 10000, Interval::Zero);

        assert_eq!(partitions.len(), 1);
        assert_eq!(partitions[0].start_time, 0);
        assert_eq!(partitions[0].end_time, 10000);
    }

    #[test]
    fn test_generate_uncached_partitions_from_range_aligned() {
        let five_min_micros = 300_000_000i64;

        // Query range that's perfectly aligned: 0 to 15 minutes (3 x 5-minute intervals)
        let partitions =
            generate_uncached_partitions_from_range(0, five_min_micros * 3, Interval::FiveMinutes);

        assert_eq!(partitions.len(), 3);

        for (i, partition) in partitions.iter().enumerate() {
            assert_eq!(partition.start_time, five_min_micros * i as i64);
            assert_eq!(partition.end_time, five_min_micros * (i as i64 + 1));
        }
    }

    #[test]
    fn test_generate_uncached_partitions_from_range_unaligned() {
        let five_min_micros = 300_000_000i64;

        // Query range that starts at a non-aligned time
        let start = 100_000; // 100ms offset
        let end = five_min_micros * 2 + 100_000; // 10min + 100ms

        let partitions = generate_uncached_partitions_from_range(start, end, Interval::FiveMinutes);

        // Should create: [100ms -> 5min], [5min -> 10min], [10min -> 10min+100ms]
        assert_eq!(partitions.len(), 3);

        // First partition: non-aligned start
        assert_eq!(partitions[0].start_time, start);
        assert_eq!(partitions[0].end_time, five_min_micros);

        // Middle partition: fully aligned
        assert_eq!(partitions[1].start_time, five_min_micros);
        assert_eq!(partitions[1].end_time, five_min_micros * 2);

        // Last partition: non-aligned end
        assert_eq!(partitions[2].start_time, five_min_micros * 2);
        assert_eq!(partitions[2].end_time, end);
    }

    #[test]
    fn test_group_cache_entries_same_interval() {
        let entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 1000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 1000,
                end_time: 2000,
                interval: Interval::OneHour,
            },
        ];

        let partitions = group_cache_entries_into_partitions(entries);

        assert_eq!(partitions.len(), 1);
        assert_eq!(partitions[0].start_time, 0);
        assert_eq!(partitions[0].end_time, 2000);
        assert_eq!(partitions[0].cache_files.len(), 2);
        assert_eq!(partitions[0].interval, Interval::OneHour);
    }

    #[test]
    fn test_group_cache_entries_different_intervals() {
        let entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 1000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 1000,
                end_time: 2000,
                interval: Interval::FiveMinutes,
            },
        ];

        let partitions = group_cache_entries_into_partitions(entries);

        assert_eq!(partitions.len(), 2);
        assert_eq!(partitions[0].interval, Interval::OneHour);
        assert_eq!(partitions[1].interval, Interval::FiveMinutes);
    }

    #[test]
    fn test_group_cache_entries_with_gap() {
        let entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 1000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 2000, // Gap between 1000 and 2000
                end_time: 3000,
                interval: Interval::OneHour,
            },
        ];

        let partitions = group_cache_entries_into_partitions(entries);

        assert_eq!(partitions.len(), 2);
        assert_eq!(partitions[0].cache_files.len(), 1);
        assert_eq!(partitions[1].cache_files.len(), 1);
    }

    #[test]
    fn test_generate_optimal_partitions_fully_cached() {
        let discovery = CacheDiscoveryResult::new(
            vec![CacheEntry {
                file_path: "test.arrow".to_string(),
                start_time: 0,
                end_time: 10000,
                interval: Interval::OneHour,
            }],
            vec![],
            1.0,
        );

        let strategy = generate_optimal_partitions(discovery, 0, 10000, CardinalityLevel::Low);

        match strategy {
            StreamingAggsPartitionStrategy::FullyCached { cache_files } => {
                assert_eq!(cache_files.len(), 1);
            }
            _ => panic!("Expected FullyCached strategy"),
        }
    }

    #[test]
    fn test_generate_optimal_partitions_no_cache() {
        let discovery = CacheDiscoveryResult::new(vec![], vec![TimeRange::new(0, 10000)], 0.0);

        let strategy = generate_optimal_partitions(discovery, 0, 10000, CardinalityLevel::Low);

        match strategy {
            StreamingAggsPartitionStrategy::NoCacheAvailable { partitions } => {
                assert!(!partitions.is_empty());
            }
            _ => panic!("Expected NoCacheAvailable strategy"),
        }
    }

    #[test]
    fn test_generate_optimal_partitions_hybrid() {
        let discovery = CacheDiscoveryResult::new(
            vec![CacheEntry {
                file_path: "test.arrow".to_string(),
                start_time: 0,
                end_time: 5000,
                interval: Interval::OneHour,
            }],
            vec![TimeRange::new(5000, 10000)],
            0.5,
        );

        let strategy = generate_optimal_partitions(discovery, 0, 10000, CardinalityLevel::Low);

        match strategy {
            StreamingAggsPartitionStrategy::Hybrid {
                cached_partitions,
                uncached_partitions,
            } => {
                assert_eq!(cached_partitions.len(), 1);
                assert!(!uncached_partitions.is_empty());
            }
            _ => panic!("Expected Hybrid strategy"),
        }
    }
}
