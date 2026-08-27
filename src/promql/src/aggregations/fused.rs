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

use config::meta::promql::{
    NAME_LABEL,
    value::{EvalContext, RangeValue, Sample, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{
    LabelModifier,
    token::{self, TokenId},
};
use rayon::prelude::*;

use crate::{
    aggregations::{group_series_by_labels, projected_labels},
    common::{kahan_sum_increment, std_deviation2, std_variance2},
    functions::{KEEP_METRIC_NAME_FUNC, RangeFunc, advance_sample_window},
    micros,
};

/// Series per parallel fold chunk inside one large group. Fused per-series
/// work includes the range-function window evaluation, so chunks are much
/// smaller than the generic path's accumulate-only [`super::AGG_PARALLEL_CHUNK`].
const FUSED_PARALLEL_CHUNK: usize = 2048;

/// Aggregations that can fold range-function output incrementally through one
/// dense per-timestamp state per output group.
#[derive(Clone, Copy, Debug)]
pub(crate) enum FusedAggOp {
    Avg,
    Count,
    Group,
    Max,
    Min,
    Stddev,
    Stdvar,
    Sum,
}

/// Dense per-timestamp aggregation state for one output group, indexed by the
/// evaluation-timestamp slot.
///
/// Each variant mirrors the matching [`super::Accumulate`] implementation
/// exactly (Kahan sums, min/max comparison direction and infinity seeds,
/// two-pass stddev), so for the same accumulation order the fused result is
/// bit-for-bit identical to the generic evaluator's.
enum FusedAccumulator {
    Avg {
        sums: Vec<(f64, f64)>,
        counts: Vec<u64>,
    },
    Count {
        counts: Vec<u64>,
    },
    Group {
        present: Vec<bool>,
    },
    Max {
        maxes: Vec<f64>,
        present: Vec<bool>,
    },
    Min {
        mins: Vec<f64>,
        present: Vec<bool>,
    },
    Stddev {
        values: Vec<Vec<f64>>,
    },
    Stdvar {
        values: Vec<Vec<f64>>,
    },
    Sum {
        sums: Vec<(f64, f64)>,
        present: Vec<bool>,
    },
}

impl FusedAggOp {
    pub(crate) fn from_token(id: TokenId) -> Option<Self> {
        match id {
            token::T_AVG => Some(Self::Avg),
            token::T_COUNT => Some(Self::Count),
            token::T_GROUP => Some(Self::Group),
            token::T_MAX => Some(Self::Max),
            token::T_MIN => Some(Self::Min),
            token::T_STDDEV => Some(Self::Stddev),
            token::T_STDVAR => Some(Self::Stdvar),
            token::T_SUM => Some(Self::Sum),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Avg => "avg",
            Self::Count => "count",
            Self::Group => "group",
            Self::Max => "max",
            Self::Min => "min",
            Self::Stddev => "stddev",
            Self::Stdvar => "stdvar",
            Self::Sum => "sum",
        }
    }
}

impl FusedAccumulator {
    fn new(op: FusedAggOp, slots: usize) -> Self {
        match op {
            FusedAggOp::Avg => Self::Avg {
                sums: vec![(0.0, 0.0); slots],
                counts: vec![0; slots],
            },
            FusedAggOp::Count => Self::Count {
                counts: vec![0; slots],
            },
            FusedAggOp::Group => Self::Group {
                present: vec![false; slots],
            },
            FusedAggOp::Max => Self::Max {
                maxes: vec![f64::NEG_INFINITY; slots],
                present: vec![false; slots],
            },
            FusedAggOp::Min => Self::Min {
                mins: vec![f64::INFINITY; slots],
                present: vec![false; slots],
            },
            FusedAggOp::Stddev => Self::Stddev {
                values: vec![Vec::new(); slots],
            },
            FusedAggOp::Stdvar => Self::Stdvar {
                values: vec![Vec::new(); slots],
            },
            FusedAggOp::Sum => Self::Sum {
                sums: vec![(0.0, 0.0); slots],
                present: vec![false; slots],
            },
        }
    }

    fn push(&mut self, slot: usize, value: f64) {
        match self {
            Self::Avg { sums, counts } => {
                let (sum, c) = &mut sums[slot];
                (*sum, *c) = kahan_sum_increment(value, *sum, *c);
                counts[slot] += 1;
            }
            Self::Count { counts } => counts[slot] += 1,
            Self::Group { present } => present[slot] = true,
            Self::Max { maxes, present } => {
                if value > maxes[slot] {
                    maxes[slot] = value;
                }
                present[slot] = true;
            }
            Self::Min { mins, present } => {
                if value < mins[slot] {
                    mins[slot] = value;
                }
                present[slot] = true;
            }
            Self::Stddev { values } | Self::Stdvar { values } => values[slot].push(value),
            Self::Sum { sums, present } => {
                let (sum, c) = &mut sums[slot];
                (*sum, *c) = kahan_sum_increment(value, *sum, *c);
                present[slot] = true;
            }
        }
    }

    /// Folds `other` in as if its chunk's series had been pushed here, after
    /// this accumulator's own. Chunks are always merged in series order, so
    /// every variant except the Kahan-compensated `Sum`/`Avg` stays bit-equal
    /// to the sequential fold; those two stay deterministic for a fixed chunk
    /// size.
    fn merge(&mut self, other: Self) {
        match (self, other) {
            (
                Self::Avg { sums, counts },
                Self::Avg {
                    sums: other_sums,
                    counts: other_counts,
                },
            ) => {
                for (slot, other_count) in other_counts.into_iter().enumerate() {
                    if other_count == 0 {
                        continue;
                    }
                    let (other_sum, other_c) = other_sums[slot];
                    let (sum, c) = &mut sums[slot];
                    // Two separate compensated increments: a plain `c + other_c`
                    // add rounds residuals away before the main sums cancel.
                    (*sum, *c) = kahan_sum_increment(other_sum, *sum, *c);
                    (*sum, *c) = kahan_sum_increment(other_c, *sum, *c);
                    counts[slot] += other_count;
                }
            }
            (
                Self::Count { counts },
                Self::Count {
                    counts: other_counts,
                },
            ) => {
                for (slot, other_count) in other_counts.into_iter().enumerate() {
                    counts[slot] += other_count;
                }
            }
            (
                Self::Group { present },
                Self::Group {
                    present: other_present,
                },
            ) => {
                for (slot, other_present) in other_present.into_iter().enumerate() {
                    present[slot] |= other_present;
                }
            }
            (
                Self::Max { maxes, present },
                Self::Max {
                    maxes: other_maxes,
                    present: other_present,
                },
            ) => {
                for (slot, other_present) in other_present.into_iter().enumerate() {
                    if !other_present {
                        continue;
                    }
                    if other_maxes[slot] > maxes[slot] {
                        maxes[slot] = other_maxes[slot];
                    }
                    present[slot] = true;
                }
            }
            (
                Self::Min { mins, present },
                Self::Min {
                    mins: other_mins,
                    present: other_present,
                },
            ) => {
                for (slot, other_present) in other_present.into_iter().enumerate() {
                    if !other_present {
                        continue;
                    }
                    if other_mins[slot] < mins[slot] {
                        mins[slot] = other_mins[slot];
                    }
                    present[slot] = true;
                }
            }
            (
                Self::Stddev { values } | Self::Stdvar { values },
                Self::Stddev {
                    values: other_values,
                }
                | Self::Stdvar {
                    values: other_values,
                },
            ) => {
                for (slot, other_values) in other_values.into_iter().enumerate() {
                    values[slot].extend(other_values);
                }
            }
            (
                Self::Sum { sums, present },
                Self::Sum {
                    sums: other_sums,
                    present: other_present,
                },
            ) => {
                for (slot, other_present) in other_present.into_iter().enumerate() {
                    if !other_present {
                        continue;
                    }
                    let (other_sum, other_c) = other_sums[slot];
                    let (sum, c) = &mut sums[slot];
                    (*sum, *c) = kahan_sum_increment(other_sum, *sum, *c);
                    (*sum, *c) = kahan_sum_increment(other_c, *sum, *c);
                    present[slot] = true;
                }
            }
            _ => unreachable!("merge of mismatched fused accumulator variants"),
        }
    }

    fn into_samples(self, timestamps: &[i64]) -> Vec<Sample> {
        match self {
            Self::Avg { sums, counts } => sums
                .into_iter()
                .zip(counts)
                .enumerate()
                .filter(|(_, (_, count))| *count > 0)
                .map(|(slot, ((sum, c), count))| {
                    Sample::new(timestamps[slot], (sum + c) / count as f64)
                })
                .collect(),
            Self::Count { counts } => counts
                .into_iter()
                .enumerate()
                .filter(|(_, count)| *count > 0)
                .map(|(slot, count)| Sample::new(timestamps[slot], count as f64))
                .collect(),
            Self::Group { present } => present
                .into_iter()
                .enumerate()
                .filter(|(_, present)| *present)
                .map(|(slot, _)| Sample::new(timestamps[slot], 1.0))
                .collect(),
            Self::Max { maxes, present } => maxes
                .into_iter()
                .zip(present)
                .enumerate()
                .filter(|(_, (_, present))| *present)
                .map(|(slot, (max, _))| Sample::new(timestamps[slot], max))
                .collect(),
            Self::Min { mins, present } => mins
                .into_iter()
                .zip(present)
                .enumerate()
                .filter(|(_, (_, present))| *present)
                .map(|(slot, (min, _))| Sample::new(timestamps[slot], min))
                .collect(),
            Self::Stddev { values } => values
                .into_iter()
                .enumerate()
                .filter_map(|(slot, values)| {
                    dispersion_sample(&values, timestamps[slot], std_deviation2)
                })
                .collect(),
            Self::Stdvar { values } => values
                .into_iter()
                .enumerate()
                .filter_map(|(slot, values)| {
                    dispersion_sample(&values, timestamps[slot], std_variance2)
                })
                .collect(),
            Self::Sum { sums, present } => sums
                .into_iter()
                .zip(present)
                .enumerate()
                .filter(|(_, (_, present))| *present)
                .map(|(slot, ((sum, c), _))| Sample::new(timestamps[slot], sum + c))
                .collect(),
        }
    }
}

fn dispersion_sample(
    values: &[f64],
    timestamp: i64,
    dispersion: fn(&[f64], f64, i64) -> Option<f64>,
) -> Option<Sample> {
    if values.is_empty() {
        return None;
    }
    let sum: f64 = values.iter().sum();
    let count = values.len() as i64;
    let mean = sum / count as f64;
    dispersion(values, mean, count).map(|value| Sample::new(timestamp, value))
}

/// Evaluates a range function and folds its values straight into aggregation
/// groups.
///
/// The generic evaluator materializes one output `Sample` per input series and
/// evaluation timestamp, only for the parent aggregation to scan and discard
/// those samples immediately. This path keeps one dense per-timestamp state
/// per output group instead. The engine selects it only for the exact
/// `agg(range_func(...))` shape; every other expression tree stays on the
/// generic evaluator, which remains the correctness reference.
pub(crate) fn fused_range_agg(
    param: &Option<LabelModifier>,
    data: Value,
    func: &dyn RangeFunc,
    op: FusedAggOp,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let func_name = func.name();
    let mut matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(Value::None),
        value => {
            return Err(DataFusionError::Plan(format!(
                "fused {}({func_name}): matrix argument expected but got {}",
                op.name(),
                value.get_type()
            )));
        }
    };
    if matrix.is_empty() {
        return Ok(Value::None);
    }

    // The range function drops the metric name before the parent aggregation
    // sees the labels. Apply the same transformation before computing group
    // signatures, including the uncommon `sum by(__name__) (rate(...))` case.
    if !KEEP_METRIC_NAME_FUNC.contains(func_name) {
        matrix.par_iter_mut().for_each(|series| {
            series.labels.retain(|label| label.name != NAME_LABEL);
        });
    }

    let timestamps = eval_ctx.timestamps();
    let groups = group_series_by_labels(&matrix, param);

    let results = groups
        .par_iter()
        .filter_map(|(_, series_indices)| {
            let labels = projected_labels(param, &matrix[series_indices[0]].labels);
            // Fold a chunk of the group in series order, then timestamp order,
            // matching the generic path's accumulation order within the chunk.
            let fold_chunk = |chunk: &[usize]| {
                let mut acc = FusedAccumulator::new(op, timestamps.len());
                for &series_idx in chunk {
                    let metric = &matrix[series_idx];
                    let range = metric
                        .time_window
                        .as_ref()
                        .expect("range function input must have a time window")
                        .range;
                    let range_micros = micros(range);
                    let mut start_index = 0;
                    let mut end_index = 0;

                    for (slot, &eval_ts) in timestamps.iter().enumerate() {
                        let window_samples = advance_sample_window(
                            &metric.samples,
                            eval_ts - range_micros,
                            eval_ts,
                            &mut start_index,
                            &mut end_index,
                        );
                        if window_samples.is_empty() {
                            continue;
                        }
                        if let Some(value) = func.exec(window_samples, eval_ts, &range) {
                            acc.push(slot, value);
                        }
                    }
                }
                acc
            };

            // A huge group (e.g. `sum(rate(...))` without a modifier puts every
            // series in one group) would otherwise evaluate the range function
            // on one thread; fold it in parallel chunks and merge the partials
            // sequentially in chunk order so the result stays deterministic.
            let acc = if series_indices.len() >= 2 * FUSED_PARALLEL_CHUNK {
                let mut chunks = series_indices
                    .par_chunks(FUSED_PARALLEL_CHUNK)
                    .map(fold_chunk)
                    .collect::<Vec<_>>()
                    .into_iter();
                let mut acc = chunks.next().expect("group has at least one chunk");
                for chunk in chunks {
                    acc.merge(chunk);
                }
                acc
            } else {
                fold_chunk(series_indices)
            };

            let samples = acc.into_samples(&timestamps);
            // The generic range function drops series that produce no values,
            // which removes their groups from the aggregation input entirely.
            if samples.is_empty() {
                return None;
            }
            Some(RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            })
        })
        .collect::<Vec<_>>();

    // Dropping many per-series allocations single-threaded is slow at high
    // cardinality; free them on the rayon pool like the generic path does.
    matrix.into_par_iter().for_each(drop);
    if results.is_empty() {
        return Ok(Value::None);
    }
    Ok(Value::Matrix(results))
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::value::{Label, TimeWindow};

    use super::*;
    use crate::{aggregations, functions};

    type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, u64)>);
    type GenericAgg = fn(&Option<LabelModifier>, Value, &EvalContext) -> Result<Value>;
    type GenericRange = fn(Value, &EvalContext) -> Result<Value>;

    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_000 * SECOND;

    fn canonical_matrix(value: Value) -> Vec<CanonicalSeries> {
        let matrix = match value {
            Value::Matrix(matrix) => matrix,
            Value::None => return vec![],
            value => panic!("expected matrix or none, got {}", value.get_type()),
        };
        let mut canonical = matrix
            .into_iter()
            .map(|series| {
                let mut labels = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect::<Vec<_>>();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>();
                (labels, samples)
            })
            .collect::<Vec<_>>();
        canonical.sort_by(|a, b| a.0.cmp(&b.0));
        canonical
    }

    fn eval_ctx() -> EvalContext {
        EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        )
    }

    fn make_series(name: &str, instance: &str, path: &str, points: &[(i64, f64)]) -> RangeValue {
        RangeValue {
            labels: vec![
                Arc::new(Label::new("__name__", name)),
                Arc::new(Label::new("instance", instance)),
                Arc::new(Label::new("path", path)),
            ],
            samples: points
                .iter()
                .map(|&(timestamp, value)| Sample::new(BASE + timestamp * SECOND, value))
                .collect(),
            exemplars: None,
            time_window: Some(TimeWindow::new(Duration::from_secs(60))),
        }
    }

    fn test_matrix() -> Vec<RangeValue> {
        let dense = [10, 50, 70, 110, 130, 170];
        let zip = |values: [f64; 6]| dense.into_iter().zip(values).collect::<Vec<_>>();
        vec![
            make_series(
                "requests_total",
                "a",
                "/one",
                &zip([0.1, 40.7, 45.2, 85.9, 90.4, 130.8]),
            ),
            make_series(
                "requests_total",
                "b",
                "/one",
                &zip([0.3, 80.1, 90.6, 170.2, 180.9, 260.5]),
            ),
            make_series(
                "requests_total",
                "c",
                "/two",
                &zip([0.2, 20.4, 25.1, 45.8, 50.3, 70.9]),
            ),
            // Sparse series: samples exist only in the last evaluation window,
            // so earlier slots stay empty for this series.
            make_series("other_total", "a", "/two", &[(130, 7.5), (170, 11.25)]),
            // Every sample sits before the first window: the generic range
            // function drops this series, and with it the whole `/zzz` group.
            make_series("stale_total", "z", "/zzz", &[(-100, 1.0), (-50, 2.0)]),
        ]
    }

    fn by(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    fn without(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    #[test]
    fn test_fused_range_agg_matches_generic_for_all_pairs() {
        let agg_cases: [(FusedAggOp, GenericAgg); 8] = [
            (FusedAggOp::Avg, aggregations::avg),
            (FusedAggOp::Count, aggregations::count),
            (FusedAggOp::Group, aggregations::group),
            (FusedAggOp::Max, aggregations::max),
            (FusedAggOp::Min, aggregations::min),
            (FusedAggOp::Stddev, aggregations::stddev),
            (FusedAggOp::Stdvar, aggregations::stdvar),
            (FusedAggOp::Sum, aggregations::sum),
        ];
        let range_cases: [(&str, GenericRange); 16] = [
            ("avg_over_time", functions::avg_over_time),
            ("changes", functions::changes),
            ("count_over_time", functions::count_over_time),
            ("delta", functions::delta),
            ("deriv", functions::deriv),
            ("idelta", functions::idelta),
            ("increase", functions::increase),
            ("irate", functions::irate),
            ("last_over_time", functions::last_over_time),
            ("max_over_time", functions::max_over_time),
            ("min_over_time", functions::min_over_time),
            ("rate", functions::rate),
            ("resets", functions::resets),
            ("stddev_over_time", functions::stddev_over_time),
            ("stdvar_over_time", functions::stdvar_over_time),
            ("sum_over_time", functions::sum_over_time),
        ];
        let modifiers = [
            None,
            by(&["path"]),
            by(&["__name__"]),
            without(&["instance"]),
        ];

        let eval_ctx = eval_ctx();
        let matrix = test_matrix();
        for (op, generic_agg) in agg_cases {
            for (func_name, generic_range) in range_cases {
                for modifier in &modifiers {
                    let generic_input =
                        generic_range(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                    let expected = generic_agg(modifier, generic_input, &eval_ctx).unwrap();

                    let func = functions::fusable_range_func(func_name).unwrap();
                    let actual = fused_range_agg(
                        modifier,
                        Value::Matrix(matrix.clone()),
                        func.as_ref(),
                        op,
                        &eval_ctx,
                    )
                    .unwrap();

                    assert_eq!(
                        canonical_matrix(expected),
                        canonical_matrix(actual),
                        "fused {}({func_name}) diverged from generic (modifier: {modifier:?})",
                        op.name(),
                    );
                }
            }
        }
    }

    #[test]
    fn test_fused_chunked_large_group_matches_generic_and_is_deterministic() {
        let eval_ctx = eval_ctx();
        // Both the ungrouped fold and each `by(path)` group cross the parallel
        // chunk threshold. Integer-valued samples keep every float operation
        // exact, so chunk-merged results must equal the generic path's bits.
        let series_count = 2 * (2 * FUSED_PARALLEL_CHUNK) + 100;
        let matrix = (0..series_count)
            .map(|i| {
                let value = (i % 97) as f64;
                let path = if i % 2 == 0 { "/one" } else { "/two" };
                make_series(
                    "requests_total",
                    &format!("host-{i}"),
                    path,
                    &[10, 50, 70, 110, 130, 170]
                        .into_iter()
                        .enumerate()
                        .map(|(n, timestamp)| (timestamp, value + n as f64))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();

        let agg_cases: [(FusedAggOp, GenericAgg); 8] = [
            (FusedAggOp::Avg, aggregations::avg),
            (FusedAggOp::Count, aggregations::count),
            (FusedAggOp::Group, aggregations::group),
            (FusedAggOp::Max, aggregations::max),
            (FusedAggOp::Min, aggregations::min),
            (FusedAggOp::Stddev, aggregations::stddev),
            (FusedAggOp::Stdvar, aggregations::stdvar),
            (FusedAggOp::Sum, aggregations::sum),
        ];
        let func = functions::fusable_range_func("sum_over_time").unwrap();
        for (op, generic_agg) in agg_cases {
            for modifier in [None, by(&["path"])] {
                let generic_input =
                    functions::sum_over_time(Value::Matrix(matrix.clone()), &eval_ctx).unwrap();
                let expected = generic_agg(&modifier, generic_input, &eval_ctx).unwrap();
                let run = || {
                    fused_range_agg(
                        &modifier,
                        Value::Matrix(matrix.clone()),
                        func.as_ref(),
                        op,
                        &eval_ctx,
                    )
                    .unwrap()
                };
                let first = canonical_matrix(run());
                assert_eq!(
                    canonical_matrix(expected),
                    first,
                    "chunked fused {}(sum_over_time) diverged from generic (modifier: {modifier:?})",
                    op.name(),
                );
                assert_eq!(
                    first,
                    canonical_matrix(run()),
                    "chunked fused {}(sum_over_time) must be deterministic",
                    op.name(),
                );
            }
        }
    }

    #[test]
    fn test_fused_range_agg_none_and_invalid_input() {
        let eval_ctx = eval_ctx();
        let func = functions::fusable_range_func("rate").unwrap();
        let result = fused_range_agg(
            &None,
            Value::None,
            func.as_ref(),
            FusedAggOp::Sum,
            &eval_ctx,
        )
        .unwrap();
        assert!(matches!(result, Value::None));

        let result = fused_range_agg(
            &None,
            Value::Float(1.0),
            func.as_ref(),
            FusedAggOp::Sum,
            &eval_ctx,
        );
        assert!(result.is_err());

        let result = fused_range_agg(
            &None,
            Value::Matrix(vec![]),
            func.as_ref(),
            FusedAggOp::Sum,
            &eval_ctx,
        )
        .unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_fused_agg_op_token_coverage() {
        assert!(FusedAggOp::from_token(token::T_SUM).is_some());
        assert!(FusedAggOp::from_token(token::T_AVG).is_some());
        assert!(FusedAggOp::from_token(token::T_TOPK).is_none());
        assert!(FusedAggOp::from_token(token::T_QUANTILE).is_none());
        assert!(FusedAggOp::from_token(token::T_COUNT_VALUES).is_none());
    }

    #[test]
    fn test_fusable_range_func_whitelist() {
        assert!(functions::fusable_range_func("rate").is_some());
        assert!(functions::fusable_range_func("increase").is_some());
        assert!(functions::fusable_range_func("last_over_time").is_some());
        // Parameterized or special-semantics functions stay on the generic path.
        assert!(functions::fusable_range_func("quantile_over_time").is_none());
        assert!(functions::fusable_range_func("predict_linear").is_none());
        assert!(functions::fusable_range_func("holt_winters").is_none());
        assert!(functions::fusable_range_func("absent_over_time").is_none());
        assert!(functions::fusable_range_func("histogram_quantile").is_none());
    }
}
