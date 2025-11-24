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

use crate::service::promql::aggregations::{Accumulate, AggFunc};

/// Aggregates Matrix input for range queries
pub fn sum(param: &Option<LabelModifier>, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum() started",
        eval_ctx.trace_id
    );

    let result = super::eval_aggregate(param, data, Sum, eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct Sum;

impl AggFunc for Sum {
    fn name(&self) -> &'static str {
        "sum"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(SumAccumulate::new())
    }
}

pub struct SumAccumulate {
    sum: HashMap<i64, f64>,
}

impl SumAccumulate {
    fn new() -> Self {
        SumAccumulate {
            sum: HashMap::new(),
        }
    }
}

impl Accumulate for SumAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let entry = self.sum.entry(sample.timestamp).or_insert(0.0);
        *entry += sample.value;
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.sum
            .into_iter()
            .map(|(timestamp, value)| Sample::new(timestamp, value))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample, Value};
    use promql_parser::parser::LabelModifier;

    use super::*;

    #[test]
    fn test_sum_range_function() {
        // Create test matrix data with multiple series and timestamps
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels3 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "prometheus")),
        ];

        // Create matrix with 3 series across 3 timestamps
        let ts1 = 1000;
        let ts2 = 2000;
        let ts3 = 3000;

        let matrix = vec![
            RangeValue {
                labels: labels1.clone(),
                samples: vec![
                    Sample::new(ts1, 10.0),
                    Sample::new(ts2, 20.0),
                    Sample::new(ts3, 30.0),
                ],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels2.clone(),
                samples: vec![
                    Sample::new(ts1, 5.0),
                    Sample::new(ts2, 15.0),
                    Sample::new(ts3, 25.0),
                ],
                exemplars: None,
                time_window: None,
            },
            RangeValue {
                labels: labels3.clone(),
                samples: vec![
                    Sample::new(ts1, 2.0),
                    Sample::new(ts2, 4.0),
                    Sample::new(ts3, 6.0),
                ],
                exemplars: None,
                time_window: None,
            },
        ];

        // EvalContext with start=1000, end=3000, step=1000 will generate [1000, 2000, 3000]
        // Formula: nr_steps = (end - start) / step + 1 = (3000 - 1000) / 1000 + 1 = 3
        let eval_ctx = EvalContext::new(ts1, ts3 + 1, 1000, "test".to_string());

        // Test 1: sum without label grouping (all series summed together)
        let result = sum(&None, Value::Matrix(matrix.clone()), &eval_ctx).unwrap();

        match result {
            Value::Matrix(result_matrix) => {
                assert_eq!(result_matrix.len(), 1); // One aggregated series
                let series = &result_matrix[0];
                assert!(series.labels.is_empty()); // No labels when grouping all together
                assert_eq!(series.samples.len(), 3); // 3 timestamps
                assert_eq!(series.samples[0].timestamp, ts1);
                assert_eq!(series.samples[0].value, 17.0); // 10 + 5 + 2
                assert_eq!(series.samples[1].timestamp, ts2);
                assert_eq!(series.samples[1].value, 39.0); // 20 + 15 + 4
                assert_eq!(series.samples[2].timestamp, ts3);
                assert_eq!(series.samples[2].value, 61.0); // 30 + 25 + 6
            }
            _ => panic!("Expected Matrix result"),
        }

        // Test 2: sum by job label (group by job)
        let param = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["job".to_string()],
        }));
        let result = sum(&param, Value::Matrix(matrix.clone()), &eval_ctx).unwrap();

        match result {
            Value::Matrix(result_matrix) => {
                assert_eq!(result_matrix.len(), 2); // Two groups: node_exporter and prometheus

                // Find the groups
                let node_exporter_series = result_matrix
                    .iter()
                    .find(|s| {
                        s.labels
                            .iter()
                            .any(|l| l.name == "job" && l.value == "node_exporter")
                    })
                    .expect("Should have node_exporter group");

                let prometheus_series = result_matrix
                    .iter()
                    .find(|s| {
                        s.labels
                            .iter()
                            .any(|l| l.name == "job" && l.value == "prometheus")
                    })
                    .expect("Should have prometheus group");

                // Verify node_exporter group (server1 + server2)
                assert_eq!(node_exporter_series.samples.len(), 3);
                assert_eq!(node_exporter_series.samples[0].value, 15.0); // 10 + 5
                assert_eq!(node_exporter_series.samples[1].value, 35.0); // 20 + 15
                assert_eq!(node_exporter_series.samples[2].value, 55.0); // 30 + 25

                // Verify prometheus group (server1 only)
                assert_eq!(prometheus_series.samples.len(), 3);
                assert_eq!(prometheus_series.samples[0].value, 2.0);
                assert_eq!(prometheus_series.samples[1].value, 4.0);
                assert_eq!(prometheus_series.samples[2].value, 6.0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
