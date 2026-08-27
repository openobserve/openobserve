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

use super::op::FusedAggOp;
use crate::common::{kahan_sum_increment, std_deviation2, std_variance2};

/// Dense per-timestamp aggregation state for one output group, indexed by the
/// evaluation-timestamp slot.
///
/// Each variant mirrors the matching [`crate::aggregations::Accumulate`]
/// implementation exactly (Kahan sums, min/max comparison direction and
/// infinity seeds, two-pass stddev), so for the same accumulation order the
/// fused result is bit-for-bit identical to the generic evaluator's.
pub(super) enum FusedAccumulator {
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

impl FusedAccumulator {
    pub(super) fn new(op: FusedAggOp, slots: usize) -> Self {
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

    pub(super) fn push(&mut self, slot: usize, value: f64) {
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
    pub(super) fn merge(&mut self, other: Self) {
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

    pub(super) fn into_samples(self, timestamps: &[i64]) -> Vec<Sample> {
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
