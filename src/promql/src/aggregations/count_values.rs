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

use config::meta::promql::value::{Labels, LabelsExt, RangeValue, Sample};
use hashbrown::HashMap;

use super::{Accumulate, AggFunc};

#[derive(Clone)]
pub(crate) struct CountValues {
    label: String,
}

impl CountValues {
    pub(crate) fn new(label: String) -> Self {
        Self { label }
    }
}

impl AggFunc for CountValues {
    type Accumulator = CountValuesAccumulate;

    fn name(&self) -> &'static str {
        "count_values"
    }

    fn build(&self, slots: usize) -> Self::Accumulator {
        CountValuesAccumulate {
            label: self.label.clone(),
            counts: vec![HashMap::new(); slots],
        }
    }
}

/// Per slot, the count of each distinct value keyed by its bits; formatting waits for `evaluate`.
pub(crate) struct CountValuesAccumulate {
    label: String,
    counts: Vec<HashMap<u64, u64>>,
}

impl Accumulate for CountValuesAccumulate {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        _labels: impl FnOnce() -> Labels,
    ) {
        for (slot, value) in values {
            *self.counts[slot].entry(value_key(value)).or_insert(0) += 1;
        }
    }

    fn merge(&mut self, other: Self) {
        for (counts, other) in self.counts.iter_mut().zip(other.counts) {
            for (key, count) in other {
                *counts.entry(key).or_insert(0) += count;
            }
        }
    }

    fn evaluate(self, group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        let group_labels = group_labels.without_label(&self.label);
        let mut samples: HashMap<u64, Vec<Sample>> = HashMap::new();
        for (slot, counts) in self.counts.into_iter().enumerate() {
            for (key, count) in counts {
                samples
                    .entry(key)
                    .or_default()
                    .push(Sample::new(timestamps[slot], count as f64));
            }
        }
        samples
            .into_iter()
            .map(|(key, samples)| {
                let mut labels = group_labels.clone();
                labels.set(&self.label, &label_value(key));
                labels.sort();
                RangeValue::new(labels, samples)
            })
            .collect()
    }
}

// Every NaN payload formats as "NaN", so they must share one key; other bit patterns format apart.
fn value_key(value: f64) -> u64 {
    if value.is_nan() {
        f64::NAN.to_bits()
    } else {
        value.to_bits()
    }
}

fn label_value(key: u64) -> String {
    let value = f64::from_bits(key);
    if value == f64::INFINITY {
        "+Inf".into()
    } else if value == f64::NEG_INFINITY {
        "-Inf".into()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{EvalContext, Label, Value};
    use promql_parser::parser::{LabelModifier, token};

    use super::*;
    use crate::{
        aggregations::AggOp,
        streaming_eval::tests::{by, without},
    };

    #[test]
    fn test_count_values_orders_samples_by_slot_after_merge() {
        let func = CountValues::new("v".into());
        let mut acc = func.build(30_000);
        let mut partial = func.build(30_000);
        acc.push_series([(0, 7.0), (29_999, 7.0)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        partial.push_series([(29_999, 7.0)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        acc.merge(partial);
        let timestamps: Vec<_> = (0..30_000).collect();
        let output = acc.evaluate(vec![], &timestamps);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].labels, vec![Arc::new(Label::new("v", "7"))]);
        assert_eq!(
            output[0]
                .samples
                .iter()
                .map(|sample| (sample.timestamp, sample.value))
                .collect::<Vec<_>>(),
            vec![(0, 1.0), (29_999, 2.0)]
        );
    }

    #[test]
    fn test_count_values_excluded_destination_counts_every_value() {
        let ctx = EvalContext::new(10, 30, 10, "test".into());
        let labels = vec![Arc::new(Label::new("job", "api"))];
        let input = Value::Matrix(vec![
            RangeValue::new(
                labels.clone(),
                [Sample::new(10, f64::INFINITY), Sample::new(30, f64::NAN)],
            ),
            RangeValue::new(labels.clone(), [Sample::new(30, f64::NEG_INFINITY)]),
        ]);
        let Value::Matrix(output) = AggOp::CountValues("v".into())
            .eval_aggregate(&without(&["v"]), input, &ctx)
            .unwrap()
        else {
            panic!("expected matrix")
        };
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].labels, labels);
        assert_eq!(
            output[0]
                .samples
                .iter()
                .map(|sample| (sample.timestamp, sample.value))
                .collect::<Vec<_>>(),
            vec![(10, 1.0), (30, 2.0)]
        );

        let empty = Value::Matrix(vec![RangeValue::new(labels, [])]);
        assert!(matches!(
            AggOp::CountValues("v".into())
                .eval_aggregate(&without(&["v"]), empty, &ctx)
                .unwrap(),
            Value::None
        ));
    }

    #[test]
    fn test_count_values_sparse_special_values_and_merges() {
        let func = CountValues::new("v".into());
        let mut sequential = func.build(3);
        let mut merged = func.build(3);
        for (slot, value) in [
            (0, 0.0),
            (0, -0.0),
            (0, f64::NAN),
            (0, f64::from_bits(0x7ff8000000000001)),
            (2, f64::INFINITY),
            (2, f64::NEG_INFINITY),
            (2, 0.0),
        ] {
            sequential.push_series(std::iter::once((slot, value)), || {
                panic!("labels must stay lazy")
            });
            let mut partial = func.build(3);
            partial.push_series(std::iter::once((slot, value)), || {
                panic!("labels must stay lazy")
            });
            merged.merge(partial);
        }
        for acc in [sequential, merged] {
            let output = acc.evaluate(vec![Arc::new(Label::new("v", "old"))], &[10, 20, 30]);
            let actual: HashMap<_, _> = output
                .into_iter()
                .map(|series| {
                    assert_eq!(series.labels.len(), 1);
                    (
                        series.labels[0].value.clone(),
                        series
                            .samples
                            .into_iter()
                            .map(|s| (s.timestamp, s.value))
                            .collect::<Vec<_>>(),
                    )
                })
                .collect();
            assert_eq!(actual.len(), 5);
            assert_eq!(actual["0"], vec![(10, 1.0), (30, 1.0)]);
            assert_eq!(actual["-0"], vec![(10, 1.0)]);
            assert_eq!(actual["NaN"], vec![(10, 2.0)]);
            assert_eq!(actual["+Inf"], vec![(30, 1.0)]);
            assert_eq!(actual["-Inf"], vec![(30, 1.0)]);
        }
        assert!(func.build(3).evaluate(vec![], &[10, 20, 30]).is_empty());
    }

    #[test]
    fn test_count_values_replaces_destination_before_grouping() {
        let ctx = EvalContext::new(10, 10, 0, "test".into());
        let input = Value::Matrix(
            [("old_a", 1.0), ("old_b", 1.0), ("old_a", 2.0)]
                .into_iter()
                .map(|(label, value)| {
                    RangeValue::new(
                        vec![
                            Arc::new(Label::new("v", label)),
                            Arc::new(Label::new("job", "api")),
                        ],
                        [Sample::new(10, value)],
                    )
                })
                .collect(),
        );
        for modifier in [
            None,
            by(&["v"]),
            by(&["job", "v"]),
            without(&["job"]),
            without(&["v"]),
        ] {
            let Value::Matrix(output) = AggOp::CountValues("v".into())
                .eval_aggregate(&modifier, input.clone(), &ctx)
                .unwrap()
            else {
                panic!("expected matrix")
            };
            if matches!(&modifier, Some(LabelModifier::Exclude(labels)) if labels.labels.contains(&"v".into()))
            {
                assert_eq!(output.len(), 1);
                assert_eq!(output[0].samples[0].value, 3.0);
                assert_eq!(output[0].labels, vec![Arc::new(Label::new("job", "api"))]);
            } else {
                assert_eq!(output.len(), 2);
                for series in output {
                    let labels: Vec<_> = series.labels.iter().filter(|l| l.name == "v").collect();
                    assert_eq!(labels.len(), 1);
                    assert_eq!(
                        series.samples[0].value,
                        if labels[0].value == "1" { 2.0 } else { 1.0 }
                    );
                }
            }
        }
    }

    #[test]
    fn test_count_values_parameter_and_empty_input() {
        let token = token::TokenType::new(token::T_COUNT_VALUES);
        for param in [
            None,
            Some(Value::Float(1.0)),
            Some(Value::String("".into())),
            Some(Value::String("bad-name".into())),
        ] {
            assert!(AggOp::new(&token, param).is_err());
        }
        let ctx = EvalContext::new(10, 10, 0, "test".into());
        for data in [Value::None, Value::Matrix(vec![])] {
            assert!(matches!(
                AggOp::CountValues("v".into())
                    .eval_aggregate(&None, data, &ctx)
                    .unwrap(),
                Value::None
            ));
        }
    }
}
