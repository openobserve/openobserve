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

use std::{cmp::Ordering, collections::BinaryHeap};

use config::{
    meta::promql::value::{EvalContext, RangeValue, Value, signature},
    utils::sort::sort_float,
};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;
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

    let eval_timestamps = eval_ctx.timestamps();

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

/// A series' value at one evaluation slot; the heap keeps the k best and its top is the worst
/// of them, so a better arrival pops it. Ties go to the lower label signature, which is stable
/// across runs where the load order of the series is not.
#[derive(PartialEq)]
struct Ranked {
    value: f64,
    signature: u64,
    idx: usize,
    is_bottom: bool,
}

impl Eq for Ranked {}

impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> Ordering {
        // greater = worse: keep NaN below every number, as sort_float orders them
        let by_value = if self.is_bottom {
            sort_float(&self.value, &other.value)
        } else {
            sort_float(&other.value, &self.value)
        };
        by_value.then_with(|| self.signature.cmp(&other.signature))
    }
}

/// For each evaluation timestamp keeps the top/bottom k series of the group in a bounded heap,
/// so memory is `slots × k` instead of a copy of every sample; the output keeps each series
/// with only the timestamps where it ranked.
pub(super) fn select_topk_series(
    matrix: &[RangeValue],
    series_indices: &[usize],
    k: usize,
    eval_timestamps: &[i64],
    is_bottom: bool,
) -> Vec<RangeValue> {
    if series_indices.is_empty() || k == 0 {
        return Vec::new();
    }

    let mut heaps: Vec<BinaryHeap<Ranked>> = (0..eval_timestamps.len())
        .map(|_| BinaryHeap::new())
        .collect();
    for &idx in series_indices {
        let signature = signature(&matrix[idx].labels);
        for sample in &matrix[idx].samples {
            let Ok(slot) = eval_timestamps.binary_search(&sample.timestamp) else {
                continue;
            };
            let entry = Ranked {
                value: sample.value,
                signature,
                idx,
                is_bottom,
            };
            let heap = &mut heaps[slot];
            if heap.len() < k {
                heap.push(entry);
            } else if heap.peek().is_some_and(|worst| entry < *worst) {
                heap.pop();
                heap.push(entry);
            }
        }
    }

    // slots are visited in order, so every series' winning slots come out ascending
    let mut winning_slots: HashMap<usize, Vec<usize>> = HashMap::new();
    for (slot, heap) in heaps.into_iter().enumerate() {
        for entry in heap {
            winning_slots.entry(entry.idx).or_default().push(slot);
        }
    }

    let mut result = Vec::with_capacity(winning_slots.len());
    for &series_idx in series_indices {
        let Some(slots) = winning_slots.get(&series_idx) else {
            continue;
        };
        let series = &matrix[series_idx];
        let mut slots = slots.iter().map(|&slot| eval_timestamps[slot]).peekable();
        let mut filtered_samples = Vec::with_capacity(slots.len());
        for sample in &series.samples {
            while slots.peek().is_some_and(|&ts| ts < sample.timestamp) {
                slots.next();
            }
            if slots.peek() == Some(&sample.timestamp) {
                filtered_samples.push(*sample);
                slots.next();
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

    #[test]
    fn test_topk_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = topk(2, &None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_topk_invalid_input_type_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = topk(2, &None, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_select_topk_empty_series_indices() {
        let timestamp = 1640995200;
        let matrix = vec![RangeValue {
            labels: vec![Arc::new(Label::new("k", "v"))],
            samples: vec![Sample::new(timestamp, 1.0)],
            exemplars: None,
            time_window: None,
        }];
        let result = select_topk_series(&matrix, &[], 2, &[timestamp], false);
        assert!(result.is_empty());
    }

    /// The bounded heaps pick exactly what a full per-slot sort by (value, signature) picks,
    /// with NaN ranking below every number and ties going to the lower label signature.
    #[test]
    fn test_select_topk_bounded_heap_matches_full_ranking() {
        let ts: Vec<i64> = (0..4).map(|i| 1_000 + i * 10).collect();
        let series = |name: &str, values: [f64; 4]| RangeValue {
            labels: vec![Arc::new(Label::new("s", name))],
            samples: ts
                .iter()
                .zip(values)
                .map(|(&t, v)| Sample::new(t, v))
                .collect(),
            exemplars: None,
            time_window: None,
        };
        let matrix = vec![
            series("a", [5.0, 1.0, f64::NAN, 2.0]),
            series("b", [5.0, 2.0, 1.0, 2.0]),
            series("c", [4.0, 3.0, 2.0, 2.0]),
            series("d", [1.0, 4.0, 3.0, 9.0]),
        ];
        let name = |s: &RangeValue| s.labels[0].value.clone();
        let full_sort = |is_bottom: bool| -> Vec<(String, Vec<i64>)> {
            let mut picked: HashMap<String, Vec<i64>> = HashMap::new();
            for &t in &ts {
                let mut candidates: Vec<(f64, u64, String)> = matrix
                    .iter()
                    .filter_map(|s| {
                        let sample = s.samples.iter().find(|x| x.timestamp == t)?;
                        Some((sample.value, signature(&s.labels), name(s)))
                    })
                    .collect();
                candidates.sort_by(|x, y| {
                    let by_value = if is_bottom {
                        sort_float(&x.0, &y.0)
                    } else {
                        sort_float(&y.0, &x.0)
                    };
                    by_value.then_with(|| x.1.cmp(&y.1))
                });
                for (_, _, n) in candidates.into_iter().take(2) {
                    picked.entry(n).or_default().push(t);
                }
            }
            let mut rows: Vec<_> = picked.into_iter().collect();
            rows.sort();
            rows
        };
        let heaps = |is_bottom: bool| -> Vec<(String, Vec<i64>)> {
            let mut rows: Vec<_> = select_topk_series(&matrix, &[0, 1, 2, 3], 2, &ts, is_bottom)
                .iter()
                .map(|s| (name(s), s.samples.iter().map(|x| x.timestamp).collect()))
                .collect();
            rows.sort();
            rows
        };
        assert_eq!(heaps(false), full_sort(false));
        assert_eq!(heaps(true), full_sort(true));
        // the NaN never wins a top slot and always wins a bottom slot it competes in
        let a_top = &heaps(false)
            .iter()
            .find(|(n, _)| n == "a")
            .map(|(_, t)| t.clone());
        assert!(!a_top.as_ref().is_some_and(|t| t.contains(&1_020)));
        let a_bottom = heaps(true)
            .iter()
            .find(|(n, _)| n == "a")
            .map(|(_, t)| t.clone());
        assert!(a_bottom.is_some_and(|t| t.contains(&1_020)));
    }

    #[test]
    fn test_select_topk_all_fit_within_k() {
        // len == k: all values should be included
        let timestamp = 1640995200;
        let matrix = vec![
            RangeValue {
                labels: vec![Arc::new(Label::new("i", "1"))],
                samples: vec![Sample::new(timestamp, 5.0)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: vec![Arc::new(Label::new("i", "2"))],
                samples: vec![Sample::new(timestamp, 3.0)],
                exemplars: None,
                time_window: None,
            },
        ];
        let result = select_topk_series(&matrix, &[0, 1], 5, &[timestamp], false);
        assert_eq!(result.len(), 2);
    }
}
