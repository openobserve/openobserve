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

use ahash::{HashMap, HashMapExt};
use config::meta::promql::value::{
    EvalContext, Label, Labels, LabelsExt, RangeValue, Sample, Value,
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::service::promql::aggregations::{labels_to_exclude, labels_to_include};

/// Aggregates Matrix input for range queries
/// count_values creates a new label with the metric value as the label value
pub fn count_values(
    label_name: &str,
    modifier: &Option<LabelModifier>,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();
    let func_name = "count_values";
    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) started",
        eval_ctx.trace_id,
    );

    // Validate label name
    if !Label::is_valid_label_name(label_name) {
        return Err(DataFusionError::Plan(format!(
            "[{func_name}] invalid label name: {label_name}"
        )));
    }

    // Handle Matrix input for range queries
    let matrix = match data {
        Value::Matrix(m) => m,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{func_name}] function only accept vector or matrix values"
            )));
        }
    };

    if matrix.is_empty() {
        return Ok(Value::None);
    }

    // Use the eval timestamps from the context to ensure consistent alignment
    let eval_timestamps = eval_ctx.timestamps();
    let eval_timestamps: hashbrown::HashSet<i64> = eval_timestamps.iter().cloned().collect();

    if eval_timestamps.is_empty() {
        return Ok(Value::None);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) processing {} time points",
        eval_ctx.trace_id,
        eval_timestamps.len()
    );

    // For each eval timestamp, aggregate across all series
    // Parallelize processing using query_thread_num
    let cfg = config::get_config();
    let thread_num = cfg.limit.query_thread_num;
    let chunk_size = (eval_timestamps.len() / thread_num).max(1);
    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) using {} threads with chunk_size {}",
        eval_ctx.trace_id,
        thread_num,
        chunk_size
    );

    // Step 1: Compute label hash for each series once based on param
    // This avoids recomputing the hash for every timestamp
    let start1 = std::time::Instant::now();
    let series_label_hashes: Vec<(u64, Labels)> = matrix
        .iter()
        .map(|rv| {
            let grouped_labels = match modifier {
                Some(LabelModifier::Include(labels)) => {
                    labels_to_include(&labels.labels, rv.labels.clone())
                }
                Some(LabelModifier::Exclude(labels)) => {
                    labels_to_exclude(&labels.labels, rv.labels.clone())
                }
                None => Labels::default(),
            };
            let hash = grouped_labels.signature();
            (hash, grouped_labels)
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) computed label hashes in {:?}",
        eval_ctx.trace_id,
        start1.elapsed()
    );

    let start2 = std::time::Instant::now();

    // Step 2: Group series indices by their label hash
    // Build index: label_hash -> Vec<series_idx>
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for (series_idx, (hash, _)) in series_label_hashes.iter().enumerate() {
        groups.entry(*hash).or_default().push(series_idx);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) built {} groups in {:?}",
        eval_ctx.trace_id,
        groups.len(),
        start2.elapsed()
    );

    let start3 = std::time::Instant::now();

    // Step 3: Process each group in parallel
    // For each group, count unique sample values at each timestamp
    // Result structure: HashMap<value_string, HashMap<timestamp, count>>
    let results: Vec<Vec<(Labels, Vec<Sample>)>> = groups
        .par_iter()
        .map(|(_, series_indices)| {
            // Get the base labels for this group (from the first series in the group)
            let base_labels = series_label_hashes[series_indices[0]].1.clone();

            // For each timestamp, track unique sample values and their counts
            // Structure: HashMap<timestamp, HashMap<value_string, count>>
            let mut timestamp_value_counts: HashMap<i64, HashMap<String, usize>> = HashMap::new();

            // Aggregate samples from all series in this group
            for &series_idx in series_indices {
                for sample in &matrix[series_idx].samples {
                    // Only include timestamps that are in eval_timestamps
                    if eval_timestamps.contains(&sample.timestamp) {
                        // Convert the sample value to a string for counting
                        let value_str = sample.value.to_string();
                        timestamp_value_counts
                            .entry(sample.timestamp)
                            .or_default()
                            .entry(value_str)
                            .and_modify(|count| *count += 1)
                            .or_insert(1);
                    }
                }
            }

            // Convert the nested HashMap to a flat structure: Vec<(value_string, Vec<Sample>)>
            // First, collect all unique values seen across all timestamps
            let mut unique_values: hashbrown::HashSet<String> = hashbrown::HashSet::new();
            for value_map in timestamp_value_counts.values() {
                for value_str in value_map.keys() {
                    unique_values.insert(value_str.clone());
                }
            }

            // For each unique value, create a series with the count at each timestamp
            let mut value_series: Vec<(Labels, Vec<Sample>)> = Vec::new();
            for value_str in unique_values {
                // Create labels with the new label_name
                let mut labels = base_labels.clone();
                labels.push(Arc::new(Label::new(label_name, &value_str)));
                labels.sort();

                // Create samples for this value across all timestamps
                let mut samples: Vec<Sample> = Vec::new();
                for (&timestamp, value_map) in &timestamp_value_counts {
                    if let Some(&count) = value_map.get(&value_str) {
                        samples.push(Sample::new(timestamp, count as f64));
                    }
                }

                // Sort by timestamp to maintain order
                samples.sort_by_key(|s| s.timestamp);

                if !samples.is_empty() {
                    value_series.push((labels, samples));
                }
            }

            value_series
        })
        .collect();

    // Flatten the nested Vec
    let results: Vec<(Labels, Vec<Sample>)> = results.into_iter().flatten().collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) parallel aggregation took: {:?}",
        eval_ctx.trace_id,
        start3.elapsed()
    );

    if results.is_empty() {
        return Ok(Value::None);
    }

    let result_matrix: Vec<RangeValue> = results
        .into_iter()
        .map(|(labels, samples)| RangeValue {
            labels,
            samples,
            exemplars: None,
            time_window: None,
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_aggregate({func_name}) completed in {:?}, produced {} series",
        eval_ctx.trace_id,
        start.elapsed(),
        result_matrix.len()
    );
    Ok(Value::Matrix(result_matrix))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample, Value};

    use super::*;

    #[test]
    fn test_count_values_range_function() {
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

        let data = Value::Matrix(vec![
            RangeValue {
                labels: labels1.clone(),
                samples: vec![Sample::new(timestamp, 10.0)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![Sample::new(timestamp, 10.0)], // Same value
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels1.clone(),
                samples: vec![Sample::new(timestamp, 20.0)],
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test count_values without label grouping
        let result = count_values("value", &None, data.clone(), &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 2); // Two unique values: 10.0 and 20.0

                // Check that we have the correct value labels and counts
                for series in &matrix {
                    let value_label = series.labels.iter().find(|l| l.name == "value");
                    assert!(value_label.is_some());

                    let value_str = value_label.unwrap().value.as_str();
                    if value_str == "10" {
                        assert_eq!(series.samples[0].value, 2.0); // Count of 10.0 is 2
                    } else if value_str == "20" {
                        assert_eq!(series.samples[0].value, 1.0); // Count of 20.0 is 1
                    } else {
                        panic!("Unexpected value label: {value_str}");
                    }

                    assert_eq!(series.samples[0].timestamp, timestamp);
                }
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_count_values_range_invalid_label_name() {
        let timestamp = 1640995200;

        let labels = vec![Arc::new(Label::new("instance", "server1"))];

        let data = Value::Matrix(vec![RangeValue {
            labels: labels.clone(),
            samples: vec![Sample::new(timestamp, 10.5)],
            exemplars: None,
            time_window: None,
        }]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test count_values with invalid label name
        let result = count_values("invalid-label-name!", &None, data, &eval_ctx);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("invalid"));
    }

    #[test]
    fn test_count_values_range_empty_input() {
        let timestamp = 1640995200;

        // Create empty data
        let data = Value::Matrix(vec![]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test count_values with empty input
        let result = count_values("value", &None, data, &eval_ctx).unwrap();

        match result {
            Value::None => {
                // Should return None for empty input
            }
            _ => panic!("Expected None result for empty input"),
        }
    }

    #[test]
    fn test_count_values_multiple_timestamps() {
        let timestamp1 = 1640995200; // 2022-01-01 00:00:00 UTC
        let timestamp2 = 1640995260; // 2022-01-01 00:01:00 UTC
        let timestamp3 = 1640995320; // 2022-01-01 00:02:00 UTC

        // Create test data with multiple timestamps
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let data = Value::Matrix(vec![
            RangeValue {
                labels: labels1.clone(),
                samples: vec![
                    Sample::new(timestamp1, 10.0),
                    Sample::new(timestamp2, 20.0),
                    Sample::new(timestamp3, 10.0),
                ],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![
                    Sample::new(timestamp1, 10.0),
                    Sample::new(timestamp2, 10.0),
                    Sample::new(timestamp3, 30.0),
                ],
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp1, timestamp3 + 1, 60, "test".to_string());

        // Test count_values without label grouping
        let result = count_values("metric_value", &None, data.clone(), &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                // Should have 3 series: one for each unique value (10, 20, 30)
                assert_eq!(matrix.len(), 3);

                // Verify each series
                for series in &matrix {
                    let value_label = series
                        .labels
                        .iter()
                        .find(|l| l.name == "metric_value")
                        .expect("Should have metric_value label");

                    match value_label.value.as_str() {
                        "10" => {
                            // Value 10 appears at timestamp1 (2 times), timestamp2 (1 time),
                            // timestamp3 (1 time)
                            assert_eq!(series.samples.len(), 3);
                            assert_eq!(series.samples[0].timestamp, timestamp1);
                            assert_eq!(series.samples[0].value, 2.0);
                            assert_eq!(series.samples[1].timestamp, timestamp2);
                            assert_eq!(series.samples[1].value, 1.0);
                            assert_eq!(series.samples[2].timestamp, timestamp3);
                            assert_eq!(series.samples[2].value, 1.0);
                        }
                        "20" => {
                            // Value 20 appears at timestamp2 (1 time)
                            assert_eq!(series.samples.len(), 1);
                            assert_eq!(series.samples[0].timestamp, timestamp2);
                            assert_eq!(series.samples[0].value, 1.0);
                        }
                        "30" => {
                            // Value 30 appears at timestamp3 (1 time)
                            assert_eq!(series.samples.len(), 1);
                            assert_eq!(series.samples[0].timestamp, timestamp3);
                            assert_eq!(series.samples[0].value, 1.0);
                        }
                        _ => panic!("Unexpected value label: {}", value_label.value),
                    }
                }
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
