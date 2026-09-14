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

use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use config::meta::promql::value::{Label, Labels, LabelsExt, RangeValue, Sample};

use super::{Accumulate, AggFunc, Count, count::CountAccumulate};

#[derive(Clone)]
pub(crate) struct CountValues {
    label: Option<String>,
}

pub(crate) enum CountValuesAccumulate {
    Values {
        label: String,
        counts: BTreeMap<usize, HashMap<String, usize>>,
    },
    Count(CountAccumulate),
}

impl CountValues {
    pub(crate) fn new(label: Option<String>) -> Self {
        Self { label }
    }
}

impl AggFunc for CountValues {
    type Accumulator = CountValuesAccumulate;

    fn name(&self) -> &'static str {
        "count_values"
    }

    fn build(&self, slots: usize) -> Self::Accumulator {
        match &self.label {
            Some(label) => CountValuesAccumulate::Values {
                label: label.clone(),
                counts: BTreeMap::new(),
            },
            None => CountValuesAccumulate::Count(Count.build(slots)),
        }
    }
}

impl Accumulate for CountValuesAccumulate {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        labels: impl FnOnce() -> Labels,
    ) {
        match self {
            Self::Count(count) => count.push_series(values, labels),
            Self::Values { counts, .. } => {
                for (slot, value) in values {
                    let value = if value == f64::INFINITY {
                        "+Inf".into()
                    } else if value == f64::NEG_INFINITY {
                        "-Inf".into()
                    } else {
                        value.to_string()
                    };
                    *counts.entry(slot).or_default().entry(value).or_default() += 1;
                }
            }
        }
    }

    fn merge(&mut self, other: Self) {
        match (self, other) {
            (Self::Count(count), Self::Count(other)) => count.merge(other),
            (Self::Values { counts, .. }, Self::Values { counts: other, .. }) => {
                for (slot, other) in other {
                    let counts = counts.entry(slot).or_default();
                    for (value, count) in other {
                        *counts.entry(value).or_default() += count;
                    }
                }
            }
            _ => unreachable!("cannot merge different count_values modes"),
        }
    }

    fn evaluate(self, mut group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        let (label, counts) = match self {
            Self::Count(count) => {
                return count
                    .evaluate(group_labels, timestamps)
                    .into_iter()
                    .filter(|series| !series.samples.is_empty())
                    .collect();
            }
            Self::Values { label, counts } => (label, counts),
        };
        group_labels.retain(|existing| existing.name != label);
        let mut samples: HashMap<String, Vec<Sample>> = HashMap::new();
        for (slot, counts) in counts {
            for (value, count) in counts {
                samples
                    .entry(value)
                    .or_default()
                    .push(Sample::new(timestamps[slot], count as f64));
            }
        }
        samples
            .into_iter()
            .map(|(value, samples)| {
                let mut labels = group_labels.clone();
                labels.push(Arc::new(Label::new(&label, &value)));
                labels.sort();
                RangeValue::new(labels, samples)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{EvalContext, Value};
    use promql_parser::parser::{LabelModifier, token};

    use super::*;
    use crate::{
        aggregations::AggOp,
        streaming_eval::tests::{by, without},
    };

    #[test]
    fn test_count_values_sparse_slots_stay_sparse_and_ordered_after_merge() {
        let func = CountValues::new(Some("v".into()));
        let mut acc = func.build(30_000);
        let mut partial = func.build(30_000);
        acc.push_series([(29_999, 7.0), (0, 7.0)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        partial.push_series([(29_999, 7.0)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        acc.merge(partial);
        let CountValuesAccumulate::Values { counts, .. } = &acc else {
            panic!("expected value counts")
        };
        assert_eq!(counts.len(), 2);
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
    fn test_count_values_excluded_destination_counts_and_omits_empty_groups() {
        let func = CountValues::new(None);
        let labels = vec![Arc::new(Label::new("job", "api"))];
        assert!(
            func.build(3)
                .evaluate(labels.clone(), &[10, 20, 30])
                .is_empty()
        );
        let mut acc = func.build(3);
        let mut partial = func.build(3);
        acc.push_series([(2, f64::NAN), (0, f64::INFINITY)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        partial.push_series([(2, f64::NEG_INFINITY)].into_iter(), || {
            panic!("labels must stay lazy")
        });
        acc.merge(partial);
        let output = acc.evaluate(labels.clone(), &[10, 20, 30]);
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

        let ctx = EvalContext::new(10, 30, 10, "test".into());
        let empty = Value::Matrix(vec![RangeValue::new(labels, [])]);
        assert!(matches!(
            AggOp::CountValues(Some("v".into()))
                .eval_aggregate(&without(&["v"]), empty, &ctx)
                .unwrap(),
            Value::None
        ));
    }

    #[test]
    fn test_count_values_sparse_special_values_and_merges() {
        let func = CountValues::new(Some("v".into()));
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
            let Value::Matrix(output) = AggOp::CountValues(Some("v".into()))
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
                AggOp::CountValues(Some("v".into()))
                    .eval_aggregate(&None, data, &ctx)
                    .unwrap(),
                Value::None
            ));
        }
    }
}
