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

use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;

use crate::{
    aggregations::{Accumulate, AggFunc, group_series},
    common::quantile_in_place,
    scalar_param::ScalarParam,
};

pub(crate) fn quantile(
    qtile: ScalarParam,
    modifier: &Option<LabelModifier>,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] quantile_range({qtile:?}) started",
        eval_ctx.trace_id,
    );

    let result = super::eval_aggregate(
        modifier,
        data,
        Quantile {
            qtile: qtile.clone(),
        },
        eval_ctx,
    );
    log::info!(
        "[trace_id: {}] [PromQL Timing] quantile_range({qtile:?}) execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub(crate) struct Quantile {
    qtile: ScalarParam,
}

#[cfg(test)]
impl Quantile {
    pub(super) fn new(qtile: ScalarParam) -> Self {
        Self { qtile }
    }
}

impl AggFunc for Quantile {
    type Accumulator = QuantileAccumulate;

    fn name(&self) -> &'static str {
        "quantile"
    }

    fn build(&self, slots: usize) -> Self::Accumulator {
        QuantileAccumulate {
            qtile: self.qtile.clone(),
            values: vec![Vec::new(); slots],
        }
    }

    // Buffers every sample; merging partials would re-copy them at each reduction level.
    fn mergeable(&self) -> bool {
        false
    }
}

pub(crate) struct QuantileAccumulate {
    qtile: ScalarParam,
    values: Vec<Vec<f64>>,
}

impl QuantileAccumulate {
    fn push(&mut self, slot: usize, value: f64) {
        self.values[slot].push(value);
    }
}

impl Accumulate for QuantileAccumulate {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        _labels: impl FnOnce() -> Labels,
    ) {
        for (slot, value) in values {
            self.push(slot, value);
        }
    }

    fn merge(&mut self, other: Self) {
        for (values, other) in self.values.iter_mut().zip(other.values) {
            values.extend(other);
        }
    }

    fn evaluate(self, group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        let samples = self
            .values
            .into_iter()
            .enumerate()
            .filter_map(|(slot, mut values)| {
                if values.is_empty() {
                    return None;
                }
                quantile_in_place(&mut values, self.qtile.at_slot(slot))
                    .map(|quantile_val| Sample::new(timestamps[slot], quantile_val))
            })
            .collect();
        group_series(group_labels, samples)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::Label;
    use promql_parser::label::Labels as ParserLabels;

    use super::*;

    #[test]
    fn test_quantile_groups_by_modifier() {
        let ts = 1000;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let matrix = || {
            Value::Matrix(vec![
                RangeValue {
                    labels: vec![
                        Arc::new(Label::new("x", "a")),
                        Arc::new(Label::new("instance", "s1")),
                    ],
                    samples: vec![Sample::new(ts, 10.0)],
                    exemplars: None,
                    time_window: None,
                },
                RangeValue {
                    labels: vec![
                        Arc::new(Label::new("x", "a")),
                        Arc::new(Label::new("instance", "s2")),
                    ],
                    samples: vec![Sample::new(ts, 20.0)],
                    exemplars: None,
                    time_window: None,
                },
                RangeValue {
                    labels: vec![
                        Arc::new(Label::new("x", "b")),
                        Arc::new(Label::new("instance", "s3")),
                    ],
                    samples: vec![Sample::new(ts, 30.0)],
                    exemplars: None,
                    time_window: None,
                },
            ])
        };
        let by_x = Some(LabelModifier::Include(ParserLabels {
            labels: vec!["x".to_string()],
        }));
        let Value::Matrix(mut result) =
            quantile(ScalarParam::Const(0.5), &by_x, matrix(), &eval_ctx).unwrap()
        else {
            panic!("expected matrix");
        };
        result.sort_by(|a, b| a.labels[0].value.cmp(&b.labels[0].value));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].labels.len(), 1);
        assert_eq!(result[0].labels[0].name, "x");
        assert_eq!(result[0].labels[0].value, "a");
        assert_eq!(result[0].samples[0].value, 15.0);
        assert_eq!(result[1].labels[0].value, "b");
        assert_eq!(result[1].samples[0].value, 30.0);

        let without_instance = Some(LabelModifier::Exclude(ParserLabels {
            labels: vec!["instance".to_string()],
        }));
        let Value::Matrix(mut result) = quantile(
            ScalarParam::Const(1.0),
            &without_instance,
            matrix(),
            &eval_ctx,
        )
        .unwrap() else {
            panic!("expected matrix");
        };
        result.sort_by(|a, b| a.labels[0].value.cmp(&b.labels[0].value));
        assert_eq!(result.len(), 2);
        assert!(result[0].labels.iter().all(|l| l.name != "instance"));
        assert_eq!(result[0].labels[0].value, "a");
        assert_eq!(result[0].samples[0].value, 20.0);
        assert_eq!(result[1].samples[0].value, 30.0);
    }

    #[test]
    fn test_quantile_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(ScalarParam::Const(0.5), &None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_quantile_invalid_input_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(ScalarParam::Const(0.5), &None, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_quantile_out_of_range_phi_is_per_group() {
        let ts = 1000;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let matrix = || {
            Value::Matrix(vec![
                RangeValue {
                    labels: vec![Arc::new(Label::new("x", "a"))],
                    samples: vec![Sample::new(ts, 10.0)],
                    exemplars: None,
                    time_window: None,
                },
                RangeValue {
                    labels: vec![Arc::new(Label::new("x", "a"))],
                    samples: vec![Sample::new(ts, 20.0)],
                    exemplars: None,
                    time_window: None,
                },
                RangeValue {
                    labels: vec![Arc::new(Label::new("x", "b"))],
                    samples: vec![Sample::new(ts, 30.0)],
                    exemplars: None,
                    time_window: None,
                },
            ])
        };
        let by_x = Some(LabelModifier::Include(ParserLabels {
            labels: vec!["x".to_string()],
        }));
        for (phi, check) in [
            (1.5, f64::INFINITY),
            (-0.1, f64::NEG_INFINITY),
            (f64::NAN, f64::NAN),
        ] {
            let Value::Matrix(mut result) =
                quantile(ScalarParam::Const(phi), &by_x, matrix(), &eval_ctx).unwrap()
            else {
                panic!("expected matrix for phi {phi}");
            };
            result.sort_by(|a, b| a.labels[0].value.cmp(&b.labels[0].value));
            assert_eq!(result.len(), 2, "phi {phi}");
            assert_eq!(result[0].labels[0].value, "a", "phi {phi}");
            assert_eq!(result[1].labels[0].value, "b", "phi {phi}");
            for series in &result {
                assert_eq!(series.samples.len(), 1, "phi {phi}");
                if check.is_nan() {
                    assert!(series.samples[0].value.is_nan(), "phi {phi}");
                } else {
                    assert_eq!(series.samples[0].value, check, "phi {phi}");
                }
            }
        }
        let result = quantile(ScalarParam::Const(1.5), &None, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_quantile_calculation() {
        // Test the core quantile calculation logic
        let mut values = vec![10.0, 20.0, 30.0];
        let qtile = 0.5; // 50th percentile

        let quantile_value = quantile_in_place(&mut values, qtile).unwrap();
        assert_eq!(quantile_value, 20.0); // 50th percentile should be 20.0
    }

    #[test]
    fn test_quantile_edge_cases() {
        // Test edge cases for quantile calculation
        let mut values = vec![10.0, 20.0, 30.0];

        // 0th percentile (minimum)
        let min_value = quantile_in_place(&mut values, 0.0).unwrap();
        assert_eq!(min_value, 10.0);

        // 100th percentile (maximum)
        let max_value = quantile_in_place(&mut values, 1.0).unwrap();
        assert_eq!(max_value, 30.0);
    }
}
