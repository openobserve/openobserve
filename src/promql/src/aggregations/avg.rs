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

use crate::{
    aggregations::{Accumulate, AggFunc},
    common::kahan_sum_increment,
};

pub struct Avg;

impl AggFunc for Avg {
    fn name(&self) -> &'static str {
        "avg"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(AvgAccumulate::new())
    }
}

#[derive(Clone, Default)]
pub(crate) struct AvgState {
    sum: f64,
    compensation: f64,
    count: usize,
}

pub struct AvgAccumulate {
    states: HashMap<i64, AvgState>,
}

impl AvgState {
    pub(crate) fn push(&mut self, value: f64) {
        (self.sum, self.compensation) = kahan_sum_increment(value, self.sum, self.compensation);
        self.count += 1;
    }

    pub(crate) fn merge(&mut self, other: Self) {
        if other.count == 0 {
            return;
        }
        // Fold the other partial's sum and compensation in as two
        // separate compensated increments: a plain `c + other_c` add
        // rounds residuals away before the main sums get to cancel.
        (self.sum, self.compensation) = kahan_sum_increment(other.sum, self.sum, self.compensation);
        (self.sum, self.compensation) =
            kahan_sum_increment(other.compensation, self.sum, self.compensation);
        self.count += other.count;
    }

    pub(crate) fn value(&self) -> Option<f64> {
        (self.count > 0).then(|| (self.sum + self.compensation) / self.count as f64)
    }
}

impl AvgAccumulate {
    fn new() -> Self {
        Self {
            states: HashMap::new(),
        }
    }
}

impl Accumulate for AvgAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        self.states
            .entry(sample.timestamp)
            .or_default()
            .push(sample.value);
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        for (timestamp, other) in other.states {
            self.states.entry(timestamp).or_default().merge(other);
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.states
            .into_iter()
            .filter_map(|(timestamp, state)| {
                state.value().map(|value| Sample::new(timestamp, value))
            })
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
    fn test_avg_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::None, Avg, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_avg_invalid_input_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::Float(1.0), Avg, &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_avg_empty_matrix_returns_none() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = eval_aggregate(&None, Value::Matrix(vec![]), Avg, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_avg_range_function() {
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
                labels: labels1.clone(),
                samples: vec![Sample::new(timestamp, 20.0)],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![Sample::new(timestamp, 30.0)],
                exemplars: None,
                time_window: None,
            },
        ]);

        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());

        // Test avg without label grouping - all samples should be averaged together
        let result = eval_aggregate(&None, data.clone(), Avg, &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 1);
                let series = &matrix[0];
                // All samples are grouped together when no label modifier is provided
                assert_eq!(series.samples[0].value, 20.0); // (10 + 20 + 30) / 3
                assert_eq!(series.samples[0].timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(series.labels.is_empty());
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
