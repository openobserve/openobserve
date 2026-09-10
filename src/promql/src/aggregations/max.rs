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

use config::meta::promql::value::Sample;
use hashbrown::HashMap;

use crate::aggregations::{Accumulate, AggFunc};

pub struct Max;

impl AggFunc for Max {
    fn name(&self) -> &'static str {
        "max"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(MaxAccumulate::new())
    }
}

pub struct MaxAccumulate {
    max: HashMap<i64, f64>,
}

impl MaxAccumulate {
    fn new() -> Self {
        MaxAccumulate {
            max: HashMap::new(),
        }
    }
}

impl Accumulate for MaxAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let entry = self
            .max
            .entry(sample.timestamp)
            .or_insert(f64::NEG_INFINITY);
        if sample.value > *entry {
            *entry = sample.value;
        }
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        for (timestamp, value) in other.max {
            self.accumulate(&Sample::new(timestamp, value));
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.max
            .into_iter()
            .map(|(timestamp, value)| Sample::new(timestamp, value))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{EvalContext, Label, RangeValue, Sample, Value};

    use super::*;
    use crate::aggregations::eval_aggregate;

    #[test]
    fn test_max_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::None, Max, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_max_invalid_input_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::Float(1.0), Max, &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_max_empty_matrix_returns_none() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::Matrix(vec![]), Max, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_max_range_function() {
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
                samples: vec![Sample::new(timestamp, 10.5)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels1.clone(),
                samples: vec![Sample::new(timestamp, 15.3)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![Sample::new(timestamp, 8.2)],
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test max without label grouping - should return the maximum value
        let result = eval_aggregate(&None, data.clone(), Max, &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 1);
                let series = &matrix[0];
                // All samples are grouped together when no label modifier is provided
                assert_eq!(series.samples[0].value, 15.3); // Maximum of 10.5, 15.3, 8.2
                assert_eq!(series.samples[0].timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(series.labels.is_empty());
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
