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

use config::meta::promql::value::{EvalContext, Value};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;

/// Aggregates Matrix input for range queries
/// For each timestamp, selects the bottom K series by value
pub fn bottomk(
    k: usize,
    modifier: &Option<LabelModifier>,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    super::topk::eval_topk(k, modifier, data, eval_ctx, true)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample, Value};

    use super::*;

    #[test]
    fn test_bottomk_range_function() {
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
                samples: vec![Sample::new(timestamp, 15.3)], // Highest value
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![Sample::new(timestamp, 8.2)], // Lowest value
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels3.clone(),
                samples: vec![Sample::new(timestamp, 12.1)], // Middle value
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test bottomk(2) without label grouping - should return 2 lowest values
        let result = bottomk(2, &None, data.clone(), &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 2);
                // Should return the 2 lowest values: 8.2 and 12.1
                let mut values: Vec<f64> = matrix.iter().map(|s| s.samples[0].value).collect();
                values.sort_by(|a, b| a.partial_cmp(b).unwrap()); // Sort ascending
                assert_eq!(values[0], 8.2); // Lowest
                assert_eq!(values[1], 12.1); // Second lowest

                // All samples should have the same timestamp
                for series in &matrix {
                    assert_eq!(series.samples[0].timestamp, timestamp);
                }
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_bottomk_range_empty_input() {
        let timestamp = 1640995200;

        // Create empty data
        let data = Value::Matrix(vec![]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test bottomk(2) with empty input
        let result = bottomk(2, &None, data, &eval_ctx).unwrap();

        match result {
            Value::None => {
                // Should return None for empty input
            }
            _ => panic!("Expected None result for empty input"),
        }
    }

    #[test]
    fn test_bottomk_range_k_zero() {
        let timestamp = 1640995200;

        let labels = vec![Arc::new(Label::new("instance", "server1"))];

        let data = Value::Matrix(vec![RangeValue {
            labels: labels.clone(),
            samples: vec![Sample::new(timestamp, 10.5)],
            exemplars: None,
            time_window: None,
        }]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test bottomk(0) - should return None
        let result = bottomk(0, &None, data, &eval_ctx).unwrap();

        match result {
            Value::None => {
                // Should return None when k=0
            }
            _ => panic!("Expected None result when k=0"),
        }
    }

    #[test]
    fn test_bottomk_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = bottomk(2, &None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_bottomk_invalid_input_type_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = bottomk(2, &None, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }
}
