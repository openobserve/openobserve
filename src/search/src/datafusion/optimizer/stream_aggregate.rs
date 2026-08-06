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

use std::sync::Arc;

use config::meta::search::Interval;
use datafusion::{
    common::{
        DataFusionError, Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan,
        aggregates::{AggregateExec, AggregateMode},
    },
};
use parking_lot::Mutex;

use crate::{
    cache::streaming_agg::{CacheEntry, StreamingAggsPartitionStrategy},
    datafusion::{
        distributed_plan::streaming_aggs_exec::{self, exec::StreamingAggsExec},
        optimizer::physical_optimizer::utils::get_final_aggregate_plan,
    },
};

/// Scores a cache file based on its interval and usefulness for the partition
/// Returns 0 if file should be excluded (interval < target_interval or no overlap)
/// Higher score = better file
fn score_cache_file(
    streaming_id: &str,
    file: &CacheEntry,
    partition_start: i64,
    partition_end: i64,
    target_interval: Interval,
) -> i64 {
    // Filter out files with interval < target_interval
    if file.interval.get_interval_microseconds() < target_interval.get_interval_microseconds() {
        log::debug!(
            "[streaming_id: {}] Excluding cache file {} (interval: {:?}) - smaller than target interval: {:?}",
            streaming_id,
            file.file_path,
            file.interval,
            target_interval
        );
        return 0; // Exclude smaller interval files
    }

    // Calculate overlap with partition
    let overlap_start = file.start_time.max(partition_start);
    let overlap_end = file.end_time.min(partition_end);
    let overlap_duration = (overlap_end - overlap_start).max(0);

    if overlap_duration <= 0 {
        return 0; // No overlap
    }

    // Prefer longer intervals (weight by interval duration)
    let interval_weight = file.interval.get_interval_microseconds();

    // Calculate usefulness percentage (how much of the file is actually needed)
    // Similar to ResultCacheSelectionStrategy::Both
    let file_duration = file.end_time - file.start_time;
    let usefulness = if file_duration > 0 {
        (overlap_duration * 100) / file_duration
    } else {
        0
    };

    // Combined score: interval weight * usefulness percentage
    // This prioritizes files with longer intervals that have good overlap
    let score = (interval_weight / 1_000_000) * usefulness; // Normalize to prevent overflow

    log::debug!(
        "[streaming_id: {}] Scoring cache file {}: interval={:?}, overlap={}μs, usefulness={}%, score={}",
        streaming_id,
        file.file_path,
        file.interval,
        overlap_duration,
        usefulness,
        score
    );

    score
}

/// Checks if a time range [start, end] is fully covered by existing ranges
fn is_fully_covered(covered: &[(i64, i64)], start: i64, end: i64) -> bool {
    for (c_start, c_end) in covered {
        if *c_start <= start && *c_end >= end {
            return true; // Fully covered
        }
    }
    false
}

/// Merges overlapping time ranges to simplify coverage tracking
fn merge_ranges(ranges: &mut Vec<(i64, i64)>) {
    if ranges.len() <= 1 {
        return;
    }
    ranges.sort_by_key(|r| r.0);
    let mut merged = vec![ranges[0]];
    for &(start, end) in &ranges[1..] {
        let last_idx = merged.len() - 1;
        if start <= merged[last_idx].1 {
            // Overlapping, merge
            merged[last_idx].1 = merged[last_idx].1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    *ranges = merged;
}

/// Checks if entire time range [start, end] is fully covered by existing ranges
fn is_range_fully_covered(covered: &[(i64, i64)], start: i64, end: i64) -> bool {
    // Merge ranges first to get consolidated coverage
    let mut ranges = covered.to_vec();
    merge_ranges(&mut ranges);

    // Check if any single merged range covers [start, end]
    ranges.iter().any(|(s, e)| *s <= start && *e >= end)
}

/// Helper function to select files from a list and track coverage
/// Returns selected file paths and updates covered_ranges
fn select_from_files(
    streaming_id: &str,
    files: Vec<CacheEntry>,
    partition_start: i64,
    partition_end: i64,
    min_interval: Interval,
    covered_ranges: &mut Vec<(i64, i64)>,
) -> Vec<String> {
    let mut selected_files = Vec::new();

    // Score and sort files
    let mut scored_files: Vec<(CacheEntry, i64)> = files
        .into_iter()
        .map(|f| {
            let score = if min_interval == Interval::Zero
                || f.interval.get_interval_microseconds()
                    >= min_interval.get_interval_microseconds()
            {
                score_cache_file(
                    streaming_id,
                    &f,
                    partition_start,
                    partition_end,
                    min_interval,
                )
            } else {
                0
            };
            (f, score)
        })
        .filter(|(_, score)| *score > 0)
        .collect();

    // Sort by score (descending) - best files first
    scored_files.sort_by_key(|k| std::cmp::Reverse(k.1));

    // Greedy selection: pick files that cover uncovered time ranges
    for (file, score) in scored_files {
        let file_start = file.start_time.max(partition_start);
        let file_end = file.end_time.min(partition_end);

        // Check if this file covers any uncovered time
        if !is_fully_covered(covered_ranges, file_start, file_end) {
            log::debug!(
                "[streaming_id: {}] Selected cache file {} (score={}, interval={:?}) covering [{}, {}]",
                streaming_id,
                file.file_path,
                score,
                file.interval,
                file_start,
                file_end
            );
            selected_files.push(file.file_path.clone());
            covered_ranges.push((file_start, file_end));
            // Merge overlapping ranges to simplify future checks
            merge_ranges(covered_ranges);
        } else {
            log::debug!(
                "[streaming_id: {}] Skipped cache file {} (score={}, interval={:?}) - time range [{}, {}] already covered",
                streaming_id,
                file.file_path,
                score,
                file.interval,
                file_start,
                file_end
            );
        }
    }

    selected_files
}

/// Selects optimal cache files eliminating overlaps and preferring longer intervals
/// Uses a TWO-PASS greedy algorithm:
/// Pass 1: Prefer files with target_interval or larger (eliminates overlaps with smaller intervals)
/// Pass 2: Fill remaining gaps with smaller interval files (maximizes cache usage)
fn select_optimal_cache_files(
    streaming_id: &str,
    cache_files: Vec<CacheEntry>,
    partition_start: i64,
    partition_end: i64,
    target_interval: Interval,
) -> Vec<String> {
    if cache_files.is_empty() {
        return vec![];
    }

    let total_files = cache_files.len();

    // Partition files into preferred (>= target interval) and smaller (< target interval)
    let (preferred_files, smaller_files): (Vec<_>, Vec<_>) =
        cache_files.into_iter().partition(|f| {
            f.interval.get_interval_microseconds() >= target_interval.get_interval_microseconds()
        });

    log::debug!(
        "[streaming_id: {}] Cache file distribution for partition [{}, {}]: target_interval={:?}, preferred={}, smaller={}",
        streaming_id,
        partition_start,
        partition_end,
        target_interval,
        preferred_files.len(),
        smaller_files.len()
    );

    let mut selected_files = Vec::new();
    let mut covered_ranges: Vec<(i64, i64)> = Vec::new();

    // PASS 1: Select from preferred files (target interval or larger)
    if !preferred_files.is_empty() {
        log::debug!(
            "[streaming_id: {}] Pass 1: Selecting from {} preferred files (interval >= {:?})",
            streaming_id,
            preferred_files.len(),
            target_interval
        );

        let pass1_result = select_from_files(
            streaming_id,
            preferred_files,
            partition_start,
            partition_end,
            target_interval,
            &mut covered_ranges,
        );

        selected_files.extend(pass1_result.iter().cloned());

        log::debug!(
            "[streaming_id: {}] Pass 1 complete: selected {} files, coverage: {:?}",
            streaming_id,
            pass1_result.len(),
            covered_ranges
        );
    }

    // PASS 2: Fill gaps with smaller interval files if needed
    if !smaller_files.is_empty() {
        // Check if entire range is covered
        if !is_range_fully_covered(&covered_ranges, partition_start, partition_end) {
            log::info!(
                "[streaming_id: {}] Pass 2: Gaps exist in coverage - attempting to fill with {} smaller interval files",
                streaming_id,
                smaller_files.len()
            );

            let pass2_result = select_from_files(
                streaming_id,
                smaller_files,
                partition_start,
                partition_end,
                Interval::Zero, // Accept any interval for gap filling
                &mut covered_ranges,
            );

            if !pass2_result.is_empty() {
                log::info!(
                    "[streaming_id: {}] Pass 2 complete: filled gaps with {} smaller interval files",
                    streaming_id,
                    pass2_result.len()
                );
                selected_files.extend(pass2_result);
            } else {
                log::debug!(
                    "[streaming_id: {streaming_id}] Pass 2: No additional files needed to fill gaps"
                );
            }
        } else {
            log::debug!(
                "[streaming_id: {streaming_id}] Pass 2 skipped: Entire range [{partition_start}, {partition_end}] already covered by preferred files"
            );
        }
    }

    let coverage_status = if is_range_fully_covered(&covered_ranges, partition_start, partition_end)
    {
        "FULLY COVERED"
    } else {
        "PARTIAL COVERAGE"
    };

    log::info!(
        "[streaming_id: {}] Selected {} optimal cache files from {} total (eliminated overlaps, {} coverage) for partition [{}, {}]",
        streaming_id,
        selected_files.len(),
        total_files,
        coverage_status,
        partition_start,
        partition_end
    );

    selected_files
}

/// Checks if a partition [start_time, end_time] is fully cached based on the partition strategy
fn check_partition_cached_from_strategy(
    strategy: &StreamingAggsPartitionStrategy,
    start_time: i64,
    end_time: i64,
) -> bool {
    match strategy {
        StreamingAggsPartitionStrategy::FullyCached { .. } => {
            // All partitions are cached
            true
        }
        StreamingAggsPartitionStrategy::Hybrid {
            cached_partitions, ..
        } => {
            // Check if this partition is within any cached partition
            // A partition is cached if it's fully contained within a cached range
            cached_partitions
                .iter()
                .any(|cp| cp.start_time <= start_time && cp.end_time >= end_time)
        }
        StreamingAggsPartitionStrategy::NoCacheAvailable { .. } => {
            // No cache available
            false
        }
    }
}

/// Loads cache file paths from the partition strategy into GLOBAL_CACHE
/// This ensures that cached_files will be available when StreamingAggsExec executes
/// Uses optimal selection to eliminate overlapping files and prefer longer intervals
fn load_cache_files_from_strategy(
    streaming_id: &str,
    strategy: &StreamingAggsPartitionStrategy,
    start_time: i64,
    end_time: i64,
) {
    let cache_files: Vec<String> = match strategy {
        StreamingAggsPartitionStrategy::FullyCached { cache_files } => {
            // For fully cached queries, determine target interval from the cache files
            // Use the maximum interval found in the cache files as the target
            let target_interval = cache_files
                .iter()
                .map(|cf| cf.interval)
                .max_by_key(|interval| interval.get_interval_microseconds())
                .unwrap_or(Interval::Zero);

            log::debug!(
                "[streaming_id: {streaming_id}] FullyCached query: using target_interval={target_interval:?}"
            );

            // Select optimal files eliminating overlaps
            select_optimal_cache_files(
                streaming_id,
                cache_files.clone(),
                start_time,
                end_time,
                target_interval,
            )
        }
        StreamingAggsPartitionStrategy::Hybrid {
            cached_partitions, ..
        } => {
            // Find the cached partition(s) that cover this time range
            let matching_partitions: Vec<_> = cached_partitions
                .iter()
                .filter(|cp| cp.start_time <= start_time && cp.end_time >= end_time)
                .collect();

            if matching_partitions.is_empty() {
                log::debug!(
                    "[streaming_id: {streaming_id}] No matching cached partitions for time_range=[{start_time}, {end_time}]"
                );
                vec![]
            } else {
                // Use the interval from the matching cached partition as target
                // If multiple partitions match, use the maximum interval
                let target_interval = matching_partitions
                    .iter()
                    .map(|cp| cp.interval)
                    .max_by_key(|interval| interval.get_interval_microseconds())
                    .unwrap_or(Interval::Zero);

                log::debug!(
                    "[streaming_id: {streaming_id}] Hybrid query: found {} matching partitions, target_interval={:?}",
                    matching_partitions.len(),
                    target_interval
                );

                // Collect all cache files from matching partitions
                let all_cache_files: Vec<CacheEntry> = matching_partitions
                    .iter()
                    .flat_map(|cp| cp.cache_files.iter().cloned())
                    .collect();

                // Select optimal files eliminating overlaps
                select_optimal_cache_files(
                    streaming_id,
                    all_cache_files,
                    start_time,
                    end_time,
                    target_interval,
                )
            }
        }
        StreamingAggsPartitionStrategy::NoCacheAvailable { .. } => {
            // No cache files to load
            vec![]
        }
    };

    // Load each cache file path into GLOBAL_CACHE
    let num_files = cache_files.len();

    // Log all selected cache files before loading
    if !cache_files.is_empty() {
        log::debug!(
            "[streaming_id: {streaming_id}] Selected {num_files} OPTIMAL cache files (overlaps eliminated) for time_range=[{start_time}, {end_time}]: {cache_files:?}"
        );
    } else {
        log::warn!(
            "[streaming_id: {streaming_id}] No cache files selected for time_range=[{start_time}, {end_time}] - may need to execute query"
        );
    }

    for file_path in cache_files {
        streaming_aggs_exec::GLOBAL_CACHE.insert(streaming_id.to_string(), file_path.clone());
        log::debug!(
            "[streaming_id: {streaming_id}] Loaded cache file into GLOBAL_CACHE: {file_path}"
        );
    }

    log::info!(
        "[streaming_id: {streaming_id}] Loaded {num_files} cache files from partition strategy for time_range=[{start_time}, {end_time}]",
    );
}

#[derive(Debug)]
pub struct StreamingAggsRule {
    id: String,
    start_time: i64,
    end_time: i64,
    is_complete_cache_hit: Arc<Mutex<bool>>,
    overwrite_cache: bool,
}

impl StreamingAggsRule {
    pub fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        is_complete_cache_hit: Arc<Mutex<bool>>,
        overwrite_cache: bool,
    ) -> Self {
        Self {
            id,
            start_time,
            end_time,
            is_complete_cache_hit,
            overwrite_cache,
        }
    }
}

impl PhysicalOptimizerRule for StreamingAggsRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let Some(final_agg_plan) = get_final_aggregate_plan(Arc::clone(&plan)) else {
            return Ok(plan);
        };

        let mut rewriter = StreamingAggsRewriter::new(
            self.id.clone(),
            self.start_time,
            self.end_time,
            config.execution.target_partitions,
            Arc::new(final_agg_plan),
            Arc::clone(&self.is_complete_cache_hit),
            self.overwrite_cache,
        )?;
        let plan = plan.rewrite(&mut rewriter)?.data;

        Ok(plan)
    }

    fn name(&self) -> &str {
        "StreamAggregateRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

pub(crate) struct StreamingAggsRewriter {
    id: String,
    start_time: i64,
    end_time: i64,
    target_partitions: usize,
    pub is_complete_cache_hit: Arc<Mutex<bool>>,
    pub(crate) final_agg_plan: Arc<AggregateExec>,
    overwrite_cache: bool,
}

impl StreamingAggsRewriter {
    pub(crate) fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        target_partitions: usize,
        final_agg_plan: Arc<AggregateExec>,
        is_complete_cache_hit: Arc<Mutex<bool>>,
        overwrite_cache: bool,
    ) -> Result<Self> {
        let ret = Self {
            id: id.clone(),
            start_time,
            end_time,
            target_partitions,
            is_complete_cache_hit,
            final_agg_plan,
            overwrite_cache,
        };

        // Check if this partition is fully cached using partition strategy
        let streaming_item = streaming_aggs_exec::GLOBAL_CACHE.id_cache.get(&id);
        let Some(item) = streaming_item else {
            // didn't find cache for the streaming_id, skip loading cache
            return Err(DataFusionError::Plan(format!(
                "streaming aggregation cache not found with id: {id}"
            )));
        };

        // Use partition strategy to determine if this partition is fully cached
        let is_fully_cached = if let Some(strategy) = item.get_partition_strategy() {
            let is_cached = check_partition_cached_from_strategy(&strategy, start_time, end_time);

            // If cached, load the cache file paths into GLOBAL_CACHE for later retrieval
            if is_cached {
                load_cache_files_from_strategy(&id, &strategy, start_time, end_time);
            }

            is_cached
        } else {
            // No partition strategy available, assume not cached
            false
        };

        if is_fully_cached {
            // Get all cached files currently in GLOBAL_CACHE for this streaming_id
            let cached_files = streaming_aggs_exec::GLOBAL_CACHE
                .get(&id)
                .unwrap_or_default();
            log::info!(
                "[streaming_id {id}] StreamingAggsRewriter: partition fully cached, time_range=[{start_time}, {end_time}], cached_files_count={}",
                cached_files.len(),
            );
            *ret.is_complete_cache_hit.lock() = true;
        } else {
            log::info!(
                "[streaming_id {id}] StreamingAggsRewriter: partition NOT fully cached (will execute query), time_range=[{start_time}, {end_time}]"
            );
        }

        Ok(ret)
    }
}

impl TreeNodeRewriter for StreamingAggsRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if (node.name() == "RemoteScanExec"
            && node.children().len() == 1
            && node.children().first().unwrap().name() == "AggregateExec")
            || is_single_node_aggregate(&node)
        {
            // get all cached files for the streaming_id(first partition -> current partition)
            let cached_files = streaming_aggs_exec::GLOBAL_CACHE
                .get(&self.id)
                .unwrap_or_default();

            log::info!(
                "[streaming_id {}] StreamingAggsRewriter: cache_strategy={}, cached_batches={}",
                self.id,
                if *self.is_complete_cache_hit.lock() {
                    "complete_hit"
                } else {
                    "miss"
                },
                cached_files.len()
            );

            let plan = Arc::new(StreamingAggsExec::new(
                self.id.clone(),
                self.start_time,
                self.end_time,
                cached_files,
                node,
                self.target_partitions,
                *self.is_complete_cache_hit.lock(),
                self.final_agg_plan.clone(),
                self.overwrite_cache,
            )) as _;

            return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

fn is_single_node_aggregate(node: &Arc<dyn ExecutionPlan>) -> bool {
    config::get_config()
        .common
        .feature_single_node_optimize_enabled
        && config::cluster::LOCAL_NODE.is_single_node()
        && node
            .downcast_ref::<AggregateExec>()
            .is_some_and(|agg| agg.mode() == &AggregateMode::Partial)
}

#[cfg(test)]
mod tests {
    use config::meta::search::Interval;

    use super::*;
    use crate::cache::streaming_agg::CacheEntry;

    #[test]
    fn test_score_cache_file_excludes_smaller_intervals() {
        let file = CacheEntry {
            file_path: "test_30min.arrow".to_string(),
            start_time: 1000,
            end_time: 2000,
            interval: Interval::ThirtyMinutes,
        };

        // Should exclude file with 30min interval when target is 60min
        let score = score_cache_file("test_streaming_id", &file, 1000, 2000, Interval::OneHour);
        assert_eq!(score, 0, "Should exclude files with smaller interval");
    }

    #[test]
    fn test_score_cache_file_accepts_matching_interval() {
        let file = CacheEntry {
            file_path: "test_60min.arrow".to_string(),
            start_time: 1000,
            end_time: 3_600_000_000 + 1000, // 1 hour later
            interval: Interval::OneHour,
        };

        let score = score_cache_file(
            "test_streaming_id",
            &file,
            1000,
            3_600_000_000 + 1000,
            Interval::OneHour,
        );
        assert!(score > 0, "Should accept files with matching interval");
    }

    #[test]
    fn test_score_cache_file_prefers_longer_intervals() {
        let file_30min = CacheEntry {
            file_path: "test_30min.arrow".to_string(),
            start_time: 1000,
            end_time: 1_800_000_000 + 1000,
            interval: Interval::ThirtyMinutes,
        };

        let file_60min = CacheEntry {
            file_path: "test_60min.arrow".to_string(),
            start_time: 1000,
            end_time: 3_600_000_000 + 1000,
            interval: Interval::OneHour,
        };

        let score_30 = score_cache_file(
            "test_streaming_id",
            &file_30min,
            1000,
            3_600_000_000 + 1000,
            Interval::ThirtyMinutes,
        );
        let score_60 = score_cache_file(
            "test_streaming_id",
            &file_60min,
            1000,
            3_600_000_000 + 1000,
            Interval::ThirtyMinutes,
        );

        assert!(score_60 > score_30, "Should prefer longer interval files");
    }

    #[test]
    fn test_is_fully_covered() {
        let covered = vec![(1000, 2000), (3000, 4000)];

        // Fully covered range
        assert!(is_fully_covered(&covered, 1200, 1800));

        // Not covered range
        assert!(!is_fully_covered(&covered, 2500, 2800));

        // Partially covered range
        assert!(!is_fully_covered(&covered, 1500, 2500));
    }

    #[test]
    fn test_merge_ranges() {
        let mut ranges = vec![(1000, 2000), (1500, 2500), (3000, 4000)];
        merge_ranges(&mut ranges);

        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0], (1000, 2500));
        assert_eq!(ranges[1], (3000, 4000));
    }

    #[test]
    fn test_select_optimal_cache_files_eliminates_overlaps() {
        // Scenario: 30min and 60min files covering same time range
        let files = vec![
            CacheEntry {
                file_path: "1764153000000000_1764154800000000.arrow".to_string(), /* 10:30-11:00
                                                                                   * (30min) */
                start_time: 1764153000000000,
                end_time: 1764154800000000,
                interval: Interval::ThirtyMinutes,
            },
            CacheEntry {
                file_path: "1764154800000000_1764156600000000.arrow".to_string(), /* 11:00-11:30
                                                                                   * (30min) */
                start_time: 1764154800000000,
                end_time: 1764156600000000,
                interval: Interval::ThirtyMinutes,
            },
            CacheEntry {
                file_path: "1764154800000000_1764158400000000.arrow".to_string(), /* 11:00-12:00
                                                                                   * (60min) */
                start_time: 1764154800000000,
                end_time: 1764158400000000,
                interval: Interval::OneHour,
            },
        ];

        // Query for 10:30-12:00 with target interval 60min
        let selected = select_optimal_cache_files(
            "test_streaming_id",
            files,
            1764153000000000,
            1764158400000000,
            Interval::OneHour,
        );

        // Should select 2 files: 60min file (11:00-12:00) and 30min file for gap (10:30-11:00)
        // The 30min file 11:00-11:30 should NOT be selected because 60min file covers it
        assert_eq!(
            selected.len(),
            2,
            "Should select 60min file + 30min for gap"
        );
        assert!(
            selected
                .iter()
                .any(|f| f.contains("1764154800000000_1764158400000000")),
            "Should select the 60min interval file (11:00-12:00)"
        );
        assert!(
            selected
                .iter()
                .any(|f| f.contains("1764153000000000_1764154800000000")),
            "Should select the 30min file for gap (10:30-11:00)"
        );
        assert!(
            !selected
                .iter()
                .any(|f| f.contains("1764154800000000_1764156600000000")),
            "Should NOT select the 30min file (11:00-11:30) that overlaps with 60min file"
        );
    }

    #[test]
    fn test_select_optimal_cache_files_no_overlap_selection() {
        // Scenario: Multiple 60min files with no overlaps
        let files = vec![
            CacheEntry {
                file_path: "1764158400000000_1764162000000000.arrow".to_string(), // 12:00-13:00
                start_time: 1764158400000000,
                end_time: 1764162000000000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "1764162000000000_1764165600000000.arrow".to_string(), // 13:00-14:00
                start_time: 1764162000000000,
                end_time: 1764165600000000,
                interval: Interval::OneHour,
            },
            CacheEntry {
                file_path: "1764165600000000_1764169200000000.arrow".to_string(), // 14:00-15:00
                start_time: 1764165600000000,
                end_time: 1764169200000000,
                interval: Interval::OneHour,
            },
        ];

        // Query for 12:00-15:00 with target interval 60min
        let selected = select_optimal_cache_files(
            "test_streaming_id",
            files,
            1764158400000000,
            1764169200000000,
            Interval::OneHour,
        );

        // Should select all three files as they don't overlap
        assert_eq!(selected.len(), 3, "Should select all non-overlapping files");
    }

    #[test]
    fn test_select_optimal_cache_files_empty_input() {
        let files = vec![];
        let selected = select_optimal_cache_files(
            "test_streaming_id",
            files,
            1764153000000000,
            1764158400000000,
            Interval::OneHour,
        );

        assert_eq!(selected.len(), 0, "Should return empty for empty input");
    }

    #[test]
    fn test_two_pass_selection_fills_gaps_with_smaller_intervals() {
        // Scenario: Query needs 60min intervals, but has a gap that only 30min files can fill
        // This tests the two-pass algorithm
        let files = vec![
            // Gap: 10:30-11:00 - only covered by 30min file
            CacheEntry {
                file_path: "1764153000000000_1764154800000000.arrow".to_string(), /* 10:30-11:00
                                                                                   * (30min) */
                start_time: 1764153000000000,
                end_time: 1764154800000000,
                interval: Interval::ThirtyMinutes,
            },
            // Main coverage: 11:00-12:00 - covered by 60min file
            CacheEntry {
                file_path: "1764154800000000_1764158400000000.arrow".to_string(), /* 11:00-12:00
                                                                                   * (60min) */
                start_time: 1764154800000000,
                end_time: 1764158400000000,
                interval: Interval::OneHour,
            },
        ];

        // Query for 10:30-12:00 with target interval 60min
        let selected = select_optimal_cache_files(
            "test_streaming_id",
            files,
            1764153000000000,
            1764158400000000,
            Interval::OneHour,
        );

        // Should select BOTH files:
        // Pass 1: Select 60min file (11:00-12:00)
        // Pass 2: Fill gap with 30min file (10:30-11:00)
        assert_eq!(
            selected.len(),
            2,
            "Should select both files to cover full range"
        );
        assert!(
            selected
                .iter()
                .any(|f| f.contains("1764154800000000_1764158400000000")),
            "Should include 60min file"
        );
        assert!(
            selected
                .iter()
                .any(|f| f.contains("1764153000000000_1764154800000000")),
            "Should include 30min file to fill gap"
        );
    }

    #[test]
    fn test_two_pass_selection_prefers_longer_intervals_when_overlapping() {
        // Scenario: Both 30min and 60min files cover the same range
        // Should prefer 60min (Pass 1) and skip 30min files
        let files = vec![
            CacheEntry {
                file_path: "1764154800000000_1764156600000000.arrow".to_string(), /* 11:00-11:30
                                                                                   * (30min) */
                start_time: 1764154800000000,
                end_time: 1764156600000000,
                interval: Interval::ThirtyMinutes,
            },
            CacheEntry {
                file_path: "1764156600000000_1764158400000000.arrow".to_string(), /* 11:30-12:00
                                                                                   * (30min) */
                start_time: 1764156600000000,
                end_time: 1764158400000000,
                interval: Interval::ThirtyMinutes,
            },
            CacheEntry {
                file_path: "1764154800000000_1764158400000000.arrow".to_string(), /* 11:00-12:00
                                                                                   * (60min) */
                start_time: 1764154800000000,
                end_time: 1764158400000000,
                interval: Interval::OneHour,
            },
        ];

        // Query for 11:00-12:00 with target interval 60min
        let selected = select_optimal_cache_files(
            "test_streaming_id",
            files,
            1764154800000000,
            1764158400000000,
            Interval::OneHour,
        );

        // Should ONLY select the 60min file (Pass 1 covers everything, Pass 2 skipped)
        assert_eq!(selected.len(), 1, "Should only select the 60min file");
        assert!(
            selected[0].contains("1764154800000000_1764158400000000"),
            "Should select the 60min interval file"
        );
    }

    #[test]
    fn test_is_range_fully_covered() {
        let covered = vec![(1000, 2000), (2000, 3000)]; // Adjacent ranges

        // Should be fully covered after merging
        assert!(is_range_fully_covered(&covered, 1000, 3000));

        // Partial overlap - not fully covered
        assert!(!is_range_fully_covered(&covered, 500, 1500));

        // Gap in coverage
        let covered_with_gap = vec![(1000, 2000), (3000, 4000)];
        assert!(!is_range_fully_covered(&covered_with_gap, 1000, 4000));
    }
}
