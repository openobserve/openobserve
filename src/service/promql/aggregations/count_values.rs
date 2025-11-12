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

use ahash::{HashMap, HashMapExt};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::service::promql::{
    aggregations::{labels_to_exclude, labels_to_include},
    value::{EvalContext, Label, Labels, LabelsExt, RangeValue, Sample, Value},
};

/// Aggregates Matrix input for range queries
/// count_values creates a new label with the metric value as the label value
pub fn count_values(
    label_name: &str,
    modifier: &Option<LabelModifier>,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();

    // Validate label name
    if !Label::is_valid_label_name(label_name) {
        return Err(DataFusionError::Plan(format!(
            "[count_values] label_name '{label_name}' is invalid. Check https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels",
        )));
    }

    let matrix = match data {
        Value::Matrix(m) => m,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "[count_values] function only accept matrix values".to_string(),
            ));
        }
    };

    if matrix.is_empty() {
        return Ok(Value::None);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] count_values(label_name={label_name}) started with {} series and {} timestamps",
        eval_ctx.trace_id,
        matrix.len(),
        eval_ctx.timestamps().len()
    );

    let eval_timestamps: ahash::HashSet<i64> = eval_ctx.timestamps().iter().cloned().collect();

    // For count_values, we need to:
    // 1. Group by the grouped labels (based on modifier)
    // 2. For each value, create a new label with the value as the label value
    // 3. Count occurrences of each value at each timestamp

    // Key: (timestamp, label_signature_with_value) -> count
    let mut counts: HashMap<(i64, u64), (Labels, usize)> = HashMap::new();

    for series in &matrix {
        for sample in &series.samples {
            if !eval_timestamps.contains(&sample.timestamp) {
                continue;
            }

            // Create the grouped labels based on modifier
            let mut grouped_labels = match modifier {
                Some(LabelModifier::Include(labels)) => {
                    let mut include_labels = labels.labels.clone();
                    include_labels.push(label_name.to_string());
                    labels_to_include(&include_labels, series.labels.clone())
                }
                Some(LabelModifier::Exclude(labels)) => {
                    let exclude_labels = labels.labels.clone();
                    // Don't exclude the new label we're creating
                    labels_to_exclude(&exclude_labels, series.labels.clone())
                }
                None => Labels::default(),
            };

            // Add the value as a label
            grouped_labels.set(label_name, &sample.value.to_string());

            let signature = grouped_labels.signature();
            let key = (sample.timestamp, signature);

            counts
                .entry(key)
                .or_insert_with(|| (grouped_labels.clone(), 0))
                .1 += 1;
        }
    }

    // Convert to RangeValue format
    // Group by label signature (without timestamp)
    let mut series_map: HashMap<u64, (Labels, Vec<Sample>)> = HashMap::new();

    for ((timestamp, signature), (labels, count)) in counts {
        let entry = series_map
            .entry(signature)
            .or_insert_with(|| (labels.clone(), Vec::new()));
        entry.1.push(Sample::new(timestamp, count as f64));
    }

    let result: Vec<RangeValue> = series_map
        .into_par_iter()
        .map(|(_, (labels, mut samples))| {
            samples.sort_by_key(|s| s.timestamp);
            RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            }
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] count_values(label_name={label_name}) completed in {:?}, produced {} series",
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::service::promql::value::{Label, RangeValue, Sample, Value};

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
                        panic!("Unexpected value label: {}", value_str);
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
}
