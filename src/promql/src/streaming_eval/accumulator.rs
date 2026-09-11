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
use promql_parser::parser::token::{self, TokenId};

use crate::{
    aggregations::{AvgState, SumState},
    common::{std_deviation, std_variance},
};

/// Aggregations the fused path can fold through dense per-timestamp state.
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

    pub(crate) fn name(self) -> &'static str {
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

/// Dense per-timestamp aggregation state for one output group.
///
/// Each variant mirrors its [`crate::aggregations::Accumulate`] counterpart
/// exactly, so the same accumulation order yields bit-for-bit identical results.
pub(super) enum FusedAccumulator {
    Avg {
        states: Vec<AvgState>,
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
        sums: Vec<SumState>,
        present: Vec<bool>,
    },
}

impl FusedAccumulator {
    pub(super) fn new(op: FusedAggOp, slots: usize) -> Self {
        match op {
            FusedAggOp::Avg => Self::Avg {
                states: vec![AvgState::default(); slots],
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
                sums: vec![SumState::default(); slots],
                present: vec![false; slots],
            },
        }
    }

    pub(super) fn push(&mut self, slot: usize, value: f64) {
        match self {
            Self::Avg { states } => states[slot].push(value),
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
                sums[slot].push(value);
                present[slot] = true;
            }
        }
    }

    /// Folds `other` in as if its series had been pushed after this chunk's own.
    /// Bit-equal to the sequential fold except the Kahan `Sum`/`Avg`, which stay
    /// deterministic for a fixed chunk size.
    pub(super) fn merge(&mut self, other: Self) {
        match (self, other) {
            (Self::Avg { states }, Self::Avg { states: other }) => {
                for (state, other) in states.iter_mut().zip(other) {
                    state.merge(other);
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
                    sums[slot].merge(other_sums[slot]);
                    present[slot] = true;
                }
            }
            _ => unreachable!("merge of mismatched fused accumulator variants"),
        }
    }

    pub(super) fn into_samples(self, timestamps: &[i64]) -> Vec<Sample> {
        match self {
            Self::Avg { states } => states
                .into_iter()
                .enumerate()
                .filter_map(|(slot, state)| {
                    state
                        .value()
                        .map(|value| Sample::new(timestamps[slot], value))
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
            Self::Max {
                maxes: values,
                present,
            }
            | Self::Min {
                mins: values,
                present,
            } => values
                .into_iter()
                .zip(present)
                .enumerate()
                .filter(|(_, (_, present))| *present)
                .map(|(slot, (value, _))| Sample::new(timestamps[slot], value))
                .collect(),
            Self::Stddev { values } => dispersion_samples(values, timestamps, std_deviation),
            Self::Stdvar { values } => dispersion_samples(values, timestamps, std_variance),
            Self::Sum { sums, present } => sums
                .into_iter()
                .zip(present)
                .enumerate()
                .filter(|(_, (_, present))| *present)
                .map(|(slot, (sum, _))| Sample::new(timestamps[slot], sum.value()))
                .collect(),
        }
    }
}

fn dispersion_samples(
    values: Vec<Vec<f64>>,
    timestamps: &[i64],
    dispersion: fn(&[f64]) -> Option<f64>,
) -> Vec<Sample> {
    values
        .into_iter()
        .enumerate()
        .filter_map(|(slot, values)| {
            let timestamp = timestamps[slot];
            dispersion(&values).map(|value| Sample::new(timestamp, value))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_statistics_with_partial_merges() {
        for (values, avg, variance) in [
            (vec![1.0, 2.0, 3.0], 2.0, 2.0 / 3.0),
            (vec![1e308, 1e308], f64::INFINITY, f64::INFINITY),
            (vec![f64::INFINITY, f64::INFINITY], f64::INFINITY, f64::NAN),
            (vec![f64::INFINITY, f64::NEG_INFINITY], f64::NAN, f64::NAN),
            (vec![f64::NAN, 1.0], f64::NAN, f64::NAN),
        ] {
            for (op, expected) in [
                (FusedAggOp::Avg, avg),
                (FusedAggOp::Stdvar, variance),
                (FusedAggOp::Stddev, variance.sqrt()),
            ] {
                for merge in [false, true] {
                    let mut accumulator = FusedAccumulator::new(op, 2);
                    for &value in &values {
                        if merge {
                            let mut partial = FusedAccumulator::new(op, 2);
                            partial.push(0, value);
                            accumulator.merge(partial);
                        } else {
                            accumulator.push(0, value);
                        }
                    }
                    let samples = accumulator.into_samples(&[1, 2]);
                    assert_eq!(samples.len(), 1);
                    assert!(
                        samples[0].value == expected
                            || (samples[0].value.is_nan() && expected.is_nan()),
                        "{op:?}, {values:?}, merge={merge}"
                    );
                }
            }
        }
    }

    #[test]
    fn test_fused_agg_op_token_coverage() {
        assert!(FusedAggOp::from_token(token::T_SUM).is_some());
        assert!(FusedAggOp::from_token(token::T_AVG).is_some());
        assert!(FusedAggOp::from_token(token::T_TOPK).is_none());
        assert!(FusedAggOp::from_token(token::T_QUANTILE).is_none());
        assert!(FusedAggOp::from_token(token::T_COUNT_VALUES).is_none());
    }
}
