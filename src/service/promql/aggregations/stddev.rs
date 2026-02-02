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

use config::meta::promql::value::{EvalContext, Sample, Value};
use datafusion::error::Result;
use hashbrown::HashMap;
use promql_parser::parser::LabelModifier;

use crate::service::promql::{
    aggregations::{Accumulate, AggFunc},
    common::std_deviation2,
};

pub fn stddev(param: &Option<LabelModifier>, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] stddev() started",
        eval_ctx.trace_id,
    );

    let result = super::eval_aggregate(param, data, Stddev, eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] stddev() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct Stddev;

impl AggFunc for Stddev {
    fn name(&self) -> &'static str {
        "stddev"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(StddevAccumulate::new())
    }
}

pub struct StddevAccumulate {
    // Store all values per timestamp for std deviation calculation
    values: HashMap<i64, Vec<f64>>,
}

impl StddevAccumulate {
    fn new() -> Self {
        StddevAccumulate {
            values: HashMap::new(),
        }
    }
}

impl Accumulate for StddevAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let entry = self.values.entry(sample.timestamp).or_default();
        entry.push(sample.value);
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.values
            .into_iter()
            .filter_map(|(timestamp, values)| {
                if values.is_empty() {
                    return None;
                }
                // Calculate mean
                let sum: f64 = values.iter().sum();
                let count = values.len() as i64;
                let mean = sum / count as f64;

                // Calculate standard deviation
                std_deviation2(&values, mean, count).map(|stddev| Sample::new(timestamp, stddev))
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
    fn test_stddev_range_function() {
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

        // Test stddev without label grouping - should return standard deviation
        let result = stddev(&None, data.clone(), &eval_ctx).unwrap();

        match result {
            Value::Matrix(matrix) => {
                assert_eq!(matrix.len(), 1);
                let series = &matrix[0];
                // All samples are grouped together when no label modifier is provided
                // Standard deviation of [10.0, 20.0, 30.0] should be approximately 8.165
                assert!((series.samples[0].value - 8.165).abs() < 0.01);
                assert_eq!(series.samples[0].timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(series.labels.is_empty());
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
