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

use std::{cmp::Reverse, collections::BTreeMap};

use config::meta::search::Interval;

use crate::datafusion::physical_plan::streaming_aggs_exec::files::STREAMING_AGGS_CACHE_DIR;

/// Time conversion constants
pub const MICROS_PER_SECOND: i64 = 1_000_000;
pub const MICROS_PER_MINUTE: i64 = 60 * MICROS_PER_SECOND;

/// Represents a single cache file entry with its metadata
#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    pub file_path: String,
    pub start_time: i64,
    pub end_time: i64,
    pub interval: Interval,
}

impl CacheEntry {
    /// Whether this entry can serve the given range: its whole state merges into the result,
    /// so a file that extends past either edge would add rows outside the window.
    pub fn is_within(&self, start: i64, end: i64, interval: Interval) -> bool {
        self.start_time >= start && self.end_time <= end && self.interval <= interval
    }
}

/// Represents a time range that is not covered by cache
#[derive(Debug, Clone, PartialEq)]
pub struct TimeRange {
    pub start_time: i64,
    pub end_time: i64,
}

impl TimeRange {
    pub fn new(start_time: i64, end_time: i64) -> Self {
        Self {
            start_time,
            end_time,
        }
    }
}

/// Result of cache discovery operation
#[derive(Debug, Clone)]
pub struct CacheDiscoveryResult {
    pub cached_ranges: Vec<CacheEntry>,
    pub uncached_ranges: Vec<TimeRange>,
    pub cache_coverage_ratio: f64,
}

impl CacheDiscoveryResult {
    pub fn new(
        cached_ranges: Vec<CacheEntry>,
        uncached_ranges: Vec<TimeRange>,
        cache_coverage_ratio: f64,
    ) -> Self {
        Self {
            cached_ranges,
            uncached_ranges,
            cache_coverage_ratio,
        }
    }

    /// Creates an empty discovery result (no cache available) for the given time range
    pub fn empty(start_time: i64, end_time: i64) -> Self {
        Self {
            cached_ranges: vec![],
            uncached_ranges: vec![TimeRange::new(start_time, end_time)],
            cache_coverage_ratio: 0.0,
        }
    }

    /// Returns true if the entire query range is cached
    pub fn is_fully_cached(&self) -> bool {
        self.uncached_ranges.is_empty() && self.cache_coverage_ratio >= 1.0
    }

    /// Returns true if no cache is available
    pub fn has_no_cache(&self) -> bool {
        self.cache_coverage_ratio == 0.0
    }

    fn from_entries(cache_entries: Vec<CacheEntry>, query_start: i64, query_end: i64) -> Self {
        let cache_entries = select_disjoint_cache_entries(cache_entries);
        let uncached_ranges = calculate_uncached_ranges(&cache_entries, query_start, query_end);
        let total_duration = query_end - query_start;
        let cached_duration = calculate_cached_duration(&cache_entries, query_start, query_end);
        let cache_coverage_ratio = if total_duration > 0 {
            cached_duration as f64 / total_duration as f64
        } else {
            0.0
        };

        Self::new(cache_entries, uncached_ranges, cache_coverage_ratio)
    }
}

/// Discovers existing cache files for a given query
///
/// # Arguments
/// * `cache_file_path` - The base cache file path (e.g., "org_id/stream_type/stream_name/hash")
/// * `query_start` - Query start time in microseconds
/// * `query_end` - Query end time in microseconds
/// * `query_interval` - The interval of the query
///
/// # Returns
/// * `Ok(CacheDiscoveryResult)` - Discovery result with cached and uncached ranges
/// * `Err(std::io::Error)` - If cache directory cannot be accessed
pub async fn discover_cache_for_query(
    cache_file_path: &str,
    query_start: i64,
    query_end: i64,
    query_interval: Interval,
) -> std::io::Result<CacheDiscoveryResult> {
    let cache_path = format!(
        "{}{}/{}",
        config::get_config().common.data_cache_dir,
        STREAMING_AGGS_CACHE_DIR,
        cache_file_path
    );

    // If cache directory doesn't exist, return empty result
    if !tokio::fs::try_exists(&cache_path).await.unwrap_or(false) {
        return Ok(CacheDiscoveryResult::new(
            vec![],
            vec![TimeRange::new(query_start, query_end)],
            0.0,
        ));
    }

    // Read all cache files in the directory asynchronously
    let mut read_dir = tokio::fs::read_dir(&cache_path).await?;
    let mut files = Vec::new();

    // Collect all directory entries
    while let Some(entry) = read_dir.next_entry().await? {
        files.push(entry);
    }

    let mut cache_entries = Vec::new();

    // Parse each cache file to extract metadata
    for file in files {
        let file_name = file.file_name();
        let file_name_str = match file_name.to_str() {
            Some(name) => name,
            None => continue,
        };

        // Skip temporary files
        if file_name_str.contains("_tmp") {
            continue;
        }

        // Parse the cache entry
        if let Some(entry) = parse_cache_file_name(cache_file_path, file_name_str)
            && entry.is_within(query_start, query_end, query_interval)
        {
            cache_entries.push(entry);
        }
    }

    Ok(CacheDiscoveryResult::from_entries(
        cache_entries,
        query_start,
        query_end,
    ))
}

fn select_disjoint_cache_entries(mut cache_entries: Vec<CacheEntry>) -> Vec<CacheEntry> {
    cache_entries.sort_unstable_by_key(|entry| {
        (
            Reverse(entry.interval.get_duration_minutes()),
            entry.start_time,
        )
    });

    let mut selected = BTreeMap::<i64, CacheEntry>::new();
    for entry in cache_entries {
        // With disjoint ranges, checking the last entry starting before this one's end suffices.
        if entry.start_time < entry.end_time
            && selected
                .range(..entry.end_time)
                .next_back()
                .is_none_or(|(_, existing)| existing.end_time <= entry.start_time)
        {
            selected.insert(entry.start_time, entry);
        }
    }
    selected.into_values().collect()
}

/// Parses a cache file name to extract cache entry metadata
fn parse_cache_file_name(cache_file_path: &str, file_name: &str) -> Option<CacheEntry> {
    // Remove file extension before parsing timestamps
    let name_without_ext = file_name
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(file_name);

    let parts: Vec<&str> = name_without_ext.split('_').collect();
    if parts.len() < 2 {
        return None;
    }

    let start_time = parts[0].parse::<i64>().ok()?;
    let end_time = parts[1].parse::<i64>().ok()?;

    // Calculate interval from the time range duration in the filename
    // The interval is inferred from the duration (end_time - start_time)
    let duration_micros = end_time - start_time;
    let interval = interval_from_duration_micros(duration_micros);

    // Build the full cache file path
    let full_cache_path = format!("{STREAMING_AGGS_CACHE_DIR}/{cache_file_path}/{file_name}",);

    Some(CacheEntry {
        file_path: full_cache_path,
        start_time,
        end_time,
        interval,
    })
}

/// Infers the interval enum from duration in microseconds
///
/// # Arguments
/// * `duration_micros` - Duration in microseconds (expected range: 5 min to 1 day)
///
/// # Returns
/// The corresponding `Interval` enum variant based on the duration in minutes
fn interval_from_duration_micros(duration_micros: i64) -> Interval {
    // Convert microseconds to minutes
    let duration_minutes = duration_micros / MICROS_PER_MINUTE;
    Interval::from(duration_minutes)
}

/// Calculates the uncached ranges (gaps) in the query time range
fn calculate_uncached_ranges(
    cache_entries: &[CacheEntry],
    query_start: i64,
    query_end: i64,
) -> Vec<TimeRange> {
    if cache_entries.is_empty() {
        return vec![TimeRange::new(query_start, query_end)];
    }

    let mut uncached_ranges = Vec::new();
    let mut current_time = query_start;

    for entry in cache_entries {
        // If there's a gap before this entry, add it as uncached
        if current_time < entry.start_time {
            uncached_ranges.push(TimeRange::new(
                current_time,
                entry.start_time.min(query_end),
            ));
        }

        // Move current time to the end of this cached entry
        current_time = current_time.max(entry.end_time);

        // If we've covered the entire query range, stop
        if current_time >= query_end {
            break;
        }
    }

    // If there's still time left after the last cache entry, add it as uncached
    if current_time < query_end {
        uncached_ranges.push(TimeRange::new(current_time, query_end));
    }

    uncached_ranges
}

/// Calculates the total cached duration within the query range
fn calculate_cached_duration(
    cache_entries: &[CacheEntry],
    query_start: i64,
    query_end: i64,
) -> i64 {
    let mut total_cached = 0i64;
    let mut last_covered_time = query_start;

    for entry in cache_entries {
        // Calculate the overlap between this cache entry and the query range
        let overlap_start = entry.start_time.max(last_covered_time);
        let overlap_end = entry.end_time.min(query_end);

        if overlap_start < overlap_end {
            total_cached += overlap_end - overlap_start;
            last_covered_time = overlap_end;
        }

        if last_covered_time >= query_end {
            break;
        }
    }

    total_cached
}

#[cfg(test)]
mod tests {
    use config::meta::{search::CardinalityLevel, sql::OrderBy};

    use super::*;
    use crate::datafusion::physical_plan::streaming_aggs_exec::partition::partition_optimizer::generate_optimal_partitions;

    #[test]
    fn test_overlapping_cache_files_produce_disjoint_partitions() {
        let hour = 60 * MICROS_PER_MINUTE;
        for (start_minute, crossing_file) in [(60, None), (105, Some((105, 135)))] {
            let cache_entries = (120..1440)
                .step_by(120)
                .map(|start| (start, start + 120))
                .chain((1380..1500).step_by(30).map(|start| (start, start + 30)))
                .chain(crossing_file)
                .map(|(start, end)| {
                    let start = start * MICROS_PER_MINUTE;
                    let end = end * MICROS_PER_MINUTE;
                    parse_cache_file_name("test", &format!("{start}_{end}.arrow")).unwrap()
                })
                .collect();
            let query_start = start_minute * MICROS_PER_MINUTE;
            let query_end = 25 * hour;
            let discovery =
                CacheDiscoveryResult::from_entries(cache_entries, query_start, query_end);
            let strategy = generate_optimal_partitions(
                discovery,
                query_start,
                query_end,
                CardinalityLevel::Low,
            );

            assert_eq!(
                strategy.to_time_partitions(OrderBy::Asc),
                vec![
                    [query_start, 2 * hour],
                    [2 * hour, 24 * hour],
                    [24 * hour, query_end]
                ],
                "query starting at minute {start_minute}"
            );
        }
    }

    #[test]
    fn test_cache_entry_is_within() {
        let interval = Interval::OneHour;
        let entry = CacheEntry {
            file_path: "test.arrow".to_string(),
            start_time: 1000,
            end_time: 2000,
            interval,
        };

        assert!(entry.is_within(1000, 2000, interval)); // Same range
        assert!(entry.is_within(500, 2500, interval)); // Completely encompassed by the query

        // The file's rows outside the query window would be merged into the result
        assert!(!entry.is_within(500, 1500, interval)); // Query ends inside the file
        assert!(!entry.is_within(1500, 2500, interval)); // Query starts inside the file
        assert!(!entry.is_within(1200, 1800, interval)); // Query inside the file

        assert!(!entry.is_within(0, 1000, interval)); // Ends exactly at start
        assert!(!entry.is_within(2000, 3000, interval)); // Starts exactly at end
        assert!(!entry.is_within(500, 2500, Interval::ThirtyMinutes)); // Coarser than the query
    }

    #[test]
    fn test_interval_from_minutes() {
        assert_eq!(Interval::from(0), Interval::Zero);
        assert_eq!(Interval::from(5), Interval::FiveMinutes);
        assert_eq!(Interval::from(10), Interval::TenMinutes);
        assert_eq!(Interval::from(30), Interval::ThirtyMinutes);
        assert_eq!(Interval::from(60), Interval::OneHour);
        assert_eq!(Interval::from(120), Interval::TwoHours);
        assert_eq!(Interval::from(360), Interval::SixHours);
        assert_eq!(Interval::from(720), Interval::TwelveHours);
        assert_eq!(Interval::from(1440), Interval::OneDay);
        assert_eq!(Interval::from(999), Interval::Zero); // Unknown interval
    }

    #[test]
    fn test_calculate_uncached_ranges_no_cache() {
        let cache_entries = vec![];
        let ranges = calculate_uncached_ranges(&cache_entries, 0, 10000);

        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start_time, 0);
        assert_eq!(ranges[0].end_time, 10000);
    }

    #[test]
    fn test_calculate_uncached_ranges_fully_cached() {
        let cache_entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 5000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 5000,
                end_time: 10000,
                interval: Interval::OneHour,
            },
        ];

        let ranges = calculate_uncached_ranges(&cache_entries, 0, 10000);
        assert_eq!(ranges.len(), 0); // No gaps
    }

    #[test]
    fn test_calculate_uncached_ranges_with_gaps() {
        let cache_entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 1000,
                end_time: 2000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 5000,
                end_time: 7000,
                interval: Interval::OneHour,
            },
        ];

        let ranges = calculate_uncached_ranges(&cache_entries, 0, 10000);

        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].start_time, 0);
        assert_eq!(ranges[0].end_time, 1000);
        assert_eq!(ranges[1].start_time, 2000);
        assert_eq!(ranges[1].end_time, 5000);
        assert_eq!(ranges[2].start_time, 7000);
        assert_eq!(ranges[2].end_time, 10000);
    }

    #[test]
    fn test_calculate_cached_duration_no_cache() {
        let cache_entries = vec![];
        let duration = calculate_cached_duration(&cache_entries, 0, 10000);
        assert_eq!(duration, 0);
    }

    #[test]
    fn test_calculate_cached_duration_fully_cached() {
        let cache_entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 5000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 5000,
                end_time: 10000,
                interval: Interval::OneHour,
            },
        ];

        let duration = calculate_cached_duration(&cache_entries, 0, 10000);
        assert_eq!(duration, 10000);
    }

    #[test]
    fn test_calculate_cached_duration_partial() {
        let cache_entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 1000,
                end_time: 4000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 6000,
                end_time: 9000,
                interval: Interval::OneHour,
            },
        ];

        let duration = calculate_cached_duration(&cache_entries, 0, 10000);
        assert_eq!(duration, 6000); // 3000 + 3000
    }

    #[test]
    fn test_calculate_cached_duration_overlapping() {
        // This tests the case where cache entries might overlap (shouldn't double count)
        let cache_entries = vec![
            CacheEntry {
                file_path: "test1.arrow".to_string(),
                start_time: 0,
                end_time: 6000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "test2.arrow".to_string(),
                start_time: 4000,
                end_time: 10000,
                interval: Interval::OneHour,
            },
        ];

        let duration = calculate_cached_duration(&cache_entries, 0, 10000);
        assert_eq!(duration, 10000); // Should cover 0-10000 without double counting
    }

    #[test]
    fn test_cache_discovery_result_states() {
        // Fully cached
        let result = CacheDiscoveryResult::new(vec![], vec![], 1.0);
        assert!(result.is_fully_cached());
        assert!(!result.has_no_cache());

        // Partial cache
        let result = CacheDiscoveryResult::new(vec![], vec![], 0.5);
        assert!(!result.is_fully_cached());
        assert!(!result.has_no_cache());

        // No cache
        let result = CacheDiscoveryResult::new(vec![], vec![], 0.0);
        assert!(!result.is_fully_cached());
        assert!(result.has_no_cache());
    }
}
