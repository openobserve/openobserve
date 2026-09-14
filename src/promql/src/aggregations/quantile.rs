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

use config::meta::promql::value::{Labels, RangeValue, Sample};

use crate::{
    aggregations::{Accumulate, AggFunc, group_series},
    common::quantile_in_place,
};

#[derive(Clone, Copy)]
pub struct Quantile {
    qtile: f64,
}

pub struct QuantileAccumulate {
    qtile: f64,
    values: Vec<Vec<f64>>,
}

impl Quantile {
    pub(crate) fn new(qtile: f64) -> Self {
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
            qtile: self.qtile,
            values: vec![Vec::new(); slots],
        }
    }

    // Repeated merging would copy every buffered sample at each reduction level.
    fn mergeable(&self) -> bool {
        false
    }
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
                quantile_in_place(&mut values, self.qtile)
                    .map(|quantile_val| Sample::new(timestamps[slot], quantile_val))
            })
            .collect();
        group_series(group_labels, samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantile_parameters_groups_sparse_slots_and_merges() {
        use std::sync::Arc;

        use config::meta::promql::value::{EvalContext, Label, Value};

        use crate::{
            aggregations::AggOp,
            streaming_eval::tests::{by, without},
        };

        let ctx = EvalContext::new(10, 30, 10, "test".into());
        for q in [0.0, 0.5, 1.0, -1.0, 2.0, f64::NAN] {
            for empty in [
                Value::None,
                Value::Matrix(vec![]),
                Value::Matrix(vec![RangeValue::new(vec![], [])]),
            ] {
                assert!(matches!(
                    AggOp::Quantile(q)
                        .eval_aggregate(&None, empty, &ctx)
                        .unwrap(),
                    Value::None
                ));
            }
            let func = Quantile::new(q);
            let mut acc = func.build(3);
            for value in [1.0, 3.0] {
                let mut partial = func.build(3);
                partial.push_series([(0, value), (2, value)].into_iter(), || {
                    panic!("labels must stay lazy")
                });
                acc.merge(partial);
            }
            let output = acc.evaluate(vec![], &[10, 20, 30]);
            let expected = if q < 0.0 {
                f64::NEG_INFINITY
            } else if q > 1.0 {
                f64::INFINITY
            } else {
                1.0 + 2.0 * q
            };
            assert_eq!(output[0].samples.len(), 2);
            for sample in &output[0].samples {
                assert!(sample.value == expected || (sample.value.is_nan() && expected.is_nan()));
            }
        }
        let matrix = Value::Matrix(
            [("a", 1.0), ("a", 3.0), ("b", 8.0)]
                .into_iter()
                .map(|(job, value)| {
                    RangeValue::new(
                        vec![Arc::new(Label::new("job", job))],
                        [Sample::new(10, value)],
                    )
                })
                .collect(),
        );
        for modifier in [by(&["job"]), without(&["instance"])] {
            let Value::Matrix(mut output) = AggOp::Quantile(0.5)
                .eval_aggregate(&modifier, matrix.clone(), &ctx)
                .unwrap()
            else {
                panic!("expected matrix")
            };
            output.sort_by(|a, b| a.labels[0].value.cmp(&b.labels[0].value));
            assert_eq!(output.len(), 2);
            assert_eq!(output[0].samples[0].value, 2.0);
            assert_eq!(output[1].samples[0].value, 8.0);
        }
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
