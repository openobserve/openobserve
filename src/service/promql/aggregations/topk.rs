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

use config::{
    meta::promql::value::{EvalContext, RangeValue, Value},
    utils::sort::sort_float,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::{HashMap, HashSet};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

/// Aggregates Matrix input for range queries
/// For each timestamp, selects the top K series by value
pub fn topk(
    k: usize,
    modifier: &Option<LabelModifier>,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();
    let matrix = match data {
        Value::Matrix(m) => m,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "[topk] function only accept matrix values".to_string(),
            ));
        }
    };

    if matrix.is_empty() || k == 0 {
        return Ok(Value::None);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] topk(k={k}) started with {} series and {} timestamps",
        eval_ctx.trace_id,
        matrix.len(),
        eval_ctx.timestamps().len()
    );

    // For topk, we select the top k series at each timestamp
    // We need to preserve the original series structure
    let eval_timestamps: HashSet<i64> = eval_ctx.timestamps().iter().cloned().collect();

    // Group series by label modifier
    let grouped_series = super::group_series_by_labels(&matrix, modifier);

    // Process each group
    let result: Vec<RangeValue> = grouped_series
        .par_iter()
        .flat_map(|(_, series_indices)| {
            // For each timestamp, select top k series from this group
            select_topk_series(&matrix, series_indices, k, &eval_timestamps, false)
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] topk(k={k}) completed in {:?}, produced {} series",
        eval_ctx.trace_id,
        start.elapsed(),
        result.len()
    );

    if result.is_empty() {
        Ok(Value::None)
    } else {
        Ok(Value::Matrix(result))
    }
}

// For topk/bottomk, we keep the original series but only include timestamps
// where they are in the top/bottom k
pub(super) fn select_topk_series(
    matrix: &[RangeValue],
    series_indices: &[usize],
    k: usize,
    eval_timestamps: &HashSet<i64>,
    is_bottom: bool,
) -> Vec<RangeValue> {
    if series_indices.is_empty() || k == 0 {
        return Vec::new();
    }

    // Pre-build timestamp index: timestamp -> Vec<(series_idx, value)>
    let mut timestamp_index: HashMap<i64, Vec<(usize, f64)>> =
        HashMap::with_capacity(eval_timestamps.len());

    for &idx in series_indices {
        for sample in &matrix[idx].samples {
            if eval_timestamps.contains(&sample.timestamp) {
                timestamp_index
                    .entry(sample.timestamp)
                    .or_default()
                    .push((idx, sample.value));
            }
        }
    }

    // Use partial sorting (select_nth_unstable) to find top-k efficiently
    // This is O(N) average case instead of O(N log N) for full sort
    let mut topk_per_timestamp: HashMap<i64, HashSet<usize>> =
        HashMap::with_capacity(timestamp_index.len());

    for (timestamp, mut values) in timestamp_index {
        let len = values.len();

        if len <= k {
            // All values are in top-k
            topk_per_timestamp.insert(timestamp, values.iter().map(|(idx, _)| *idx).collect());
        } else {
            // Use partial sorting to find top k elements
            // select_nth_unstable is O(n) average, partitions around the k-th element
            let k_index = k.saturating_sub(1);
            values.select_nth_unstable_by(k_index, |(_, a), (_, b)| {
                if is_bottom {
                    sort_float(a, b)
                } else {
                    sort_float(b, a)
                }
            });

            // Take the first k elements (now partitioned)
            let topk_indices: HashSet<usize> = values[..k].iter().map(|(idx, _)| *idx).collect();
            topk_per_timestamp.insert(timestamp, topk_indices);
        }
    }

    // Build result efficiently by iterating through series once
    // and checking which of their samples are in top-k
    let mut result = Vec::with_capacity(series_indices.len().min(k * eval_timestamps.len()));

    for &series_idx in series_indices {
        let series = &matrix[series_idx];

        // Use with_capacity since we know samples won't exceed series.samples.len()
        let mut filtered_samples =
            Vec::with_capacity(series.samples.len().min(eval_timestamps.len()));

        for sample in &series.samples {
            // O(1) lookup to check if this timestamp has top-k data
            // and if this series is in the top k for that timestamp
            if let Some(topk_indices) = topk_per_timestamp.get(&sample.timestamp)
                && topk_indices.contains(&series_idx)
            {
                filtered_samples.push(*sample);
            }
        }

        if !filtered_samples.is_empty() {
            result.push(RangeValue {
                labels: series.labels.clone(),
                samples: filtered_samples,
                exemplars: series.exemplars.clone(),
                time_window: series.time_window.clone(),
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample, Value};

    use super::*;

    #[test]
    fn test_topk_range_function() {
        let timestamp = 1640995200; // 2022-01-01 00:00:00 UTC

        // Create test data with multiple samples as Matrix (range query format)
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels3 = vec![
            Arc::new(Label::new("instance", "server3")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let data = Value::Matrix(vec![
            RangeValue {
                labels: labels1.clone(),
                samples: vec![Sample::new(timestamp, 10.5)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![Sample::new(timestamp, 15.3)], // Highest value
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels3.clone(),
                samples: vec![Sample::new(timestamp, 8.2)], // Lowest value
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test topk(2) without label grouping - should return 2 highest values
        let result = topk(2, &None, data.clone(), &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 2);
                // Should return the 2 highest values: 15.3 and 10.5
                let mut values: Vec<f64> = matrix.iter().map(|s| s.samples[0].value).collect();
                values.sort_by(|a, b| b.partial_cmp(a).unwrap()); // Sort descending
                assert_eq!(values[0], 15.3); // Highest
                assert_eq!(values[1], 10.5); // Second highest

                // All samples should have the same timestamp
                for series in &matrix {
                    assert_eq!(series.samples[0].timestamp, timestamp);
                }
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_topk_range_empty_input() {
        let timestamp = 1640995200;

        // Create empty data
        let data = Value::Matrix(vec![]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test topk(2) with empty input
        let result = topk(2, &None, data, &eval_ctx).unwrap();

        match result {
            Value::None => {
                // Should return None for empty input
            }
            _ => panic!("Expected None result for empty input"),
        }
    }

    #[test]
    fn test_topk_range_k_zero() {
        let timestamp = 1640995200;

        let labels = vec![Arc::new(Label::new("instance", "server1"))];

        let data = Value::Matrix(vec![RangeValue {
            labels: labels.clone(),
            samples: vec![Sample::new(timestamp, 10.5)],
            exemplars: None,
            time_window: None,
        }]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test topk(0) - should return None
        let result = topk(0, &None, data, &eval_ctx).unwrap();

        match result {
            Value::None => {
                // Should return None when k=0
            }
            _ => panic!("Expected None result when k=0"),
        }
    }
}
