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

use config::meta::promql::value::{EvalContext, Sample, Value};
use datafusion::error::Result;
use hashbrown::HashMap;
use promql_parser::parser::LabelModifier;

use crate::{
    aggregations::{Accumulate, AggFunc},
    common::kahan_sum_increment,
};

pub fn avg(param: &Option<LabelModifier>, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] avg() started",
        eval_ctx.trace_id,
    );

    let result = super::eval_aggregate(param, data, Avg, eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] avg() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct Avg;

impl AggFunc for Avg {
    fn name(&self) -> &'static str {
        "avg"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(AvgAccumulate::new())
    }
}

pub struct AvgAccumulate {
    sum: HashMap<i64, (f64, f64)>,
    count: HashMap<i64, usize>,
}

impl AvgAccumulate {
    fn new() -> Self {
        AvgAccumulate {
            sum: HashMap::new(),
            count: HashMap::new(),
        }
    }
}

impl Accumulate for AvgAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let (sum, c) = self.sum.entry(sample.timestamp).or_insert((0.0, 0.0));
        (*sum, *c) = kahan_sum_increment(sample.value, *sum, *c);
        let count_entry = self.count.entry(sample.timestamp).or_insert(0);
        *count_entry += 1;
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        for (timestamp, (other_sum, other_c)) in other.sum {
            let (sum, c) = self.sum.entry(timestamp).or_insert((0.0, 0.0));
            // Fold the other partial's sum and compensation in as two
            // separate compensated increments: a plain `c + other_c` add
            // rounds residuals away before the main sums get to cancel.
            (*sum, *c) = kahan_sum_increment(other_sum, *sum, *c);
            (*sum, *c) = kahan_sum_increment(other_c, *sum, *c);
        }
        for (timestamp, count) in other.count {
            *self.count.entry(timestamp).or_insert(0) += count;
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.sum
            .into_iter()
            .filter_map(|(timestamp, (sum, c))| {
                self.count
                    .get(&timestamp)
                    .map(|&count| Sample::new(timestamp, (sum + c) / count as f64))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample, Value};

    use super::*;

    #[test]
    fn test_avg_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = avg(&None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_avg_invalid_input_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = avg(&None, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_avg_empty_matrix_returns_none() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = avg(&None, Value::Matrix(vec![]), &eval_ctx).unwrap();
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
        let result = avg(&None, data.clone(), &eval_ctx).unwrap();

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
