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

use std::{cmp::Ordering, collections::BinaryHeap, sync::Arc};

use config::meta::promql::value::{Labels, RangeValue, Sample, signature};
use hashbrown::HashMap;

use super::{Accumulate, AggFunc};
use crate::scalar_param::ScalarParam;

/// `limitk` / `limit_ratio`: series picked by a hash of their label set, the same at every step.
#[derive(Clone)]
pub(crate) enum Limit {
    K(ScalarParam),
    Ratio(ScalarParam),
}

impl AggFunc for Limit {
    type Accumulator = LimitAccumulator;

    fn name(&self) -> &'static str {
        match self {
            Self::K(_) => "limitk",
            Self::Ratio(_) => "limit_ratio",
        }
    }

    fn build(&self, slots: usize) -> Self::Accumulator {
        LimitAccumulator {
            limit: self.clone(),
            picked: (0..slots).map(|_| BinaryHeap::new()).collect(),
        }
    }
}

/// The series picked at each evaluation slot.
pub(crate) struct LimitAccumulator {
    limit: Limit,
    picked: Vec<BinaryHeap<Picked>>,
}

impl LimitAccumulator {
    fn offer(&mut self, slot: usize, entry: Picked) {
        let heap = &mut self.picked[slot];
        match &self.limit {
            // among the series present at this slot, the k with the smallest hashes
            Limit::K(k) => {
                if heap.len() < k.at_slot(slot) as usize {
                    heap.push(entry);
                } else if heap
                    .peek()
                    .is_some_and(|largest| entry.signature < largest.signature)
                {
                    heap.pop();
                    heap.push(entry);
                }
            }
            Limit::Ratio(ratio) => {
                if ratio_keeps(ratio.at_slot(slot), entry.signature) {
                    heap.push(entry);
                }
            }
        }
    }
}

impl Accumulate for LimitAccumulator {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        labels: impl FnOnce() -> Labels,
    ) {
        let mut labels = Some(labels);
        let mut identity: Option<(Arc<Labels>, u64)> = None;
        for (slot, value) in values {
            let (labels, signature) = identity.get_or_insert_with(|| {
                let labels = labels.take().expect("labels are read once")();
                let signature = signature(&labels);
                (Arc::new(labels), signature)
            });
            self.offer(
                slot,
                Picked {
                    signature: *signature,
                    labels: Arc::clone(labels),
                    value,
                },
            );
        }
    }

    fn merge(&mut self, other: Self) {
        for (slot, heap) in other.picked.into_iter().enumerate() {
            for entry in heap {
                self.offer(slot, entry);
            }
        }
    }

    fn evaluate(self, _group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        // one series is one shared label set, and slots come in order, so its samples ascend
        let mut series: HashMap<*const Labels, (Arc<Labels>, Vec<Sample>)> = HashMap::new();
        for (slot, heap) in self.picked.into_iter().enumerate() {
            for entry in heap {
                series
                    .entry(Arc::as_ptr(&entry.labels))
                    .or_insert_with(|| (entry.labels, Vec::new()))
                    .1
                    .push(Sample::new(timestamps[slot], entry.value));
            }
        }
        series
            .into_values()
            .map(|(labels, samples)| RangeValue {
                labels: Arc::try_unwrap(labels).unwrap_or_else(|shared| (*shared).clone()),
                samples,
                exemplars: None,
                time_window: None,
            })
            .collect()
    }
}

/// One series' value at a slot; a heap of them keeps the largest hash on top.
struct Picked {
    signature: u64,
    labels: Arc<Labels>,
    value: f64,
}

impl PartialEq for Picked {
    fn eq(&self, other: &Self) -> bool {
        self.signature == other.signature
    }
}

impl Eq for Picked {}

impl PartialOrd for Picked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Picked {
    fn cmp(&self, other: &Self) -> Ordering {
        self.signature.cmp(&other.signature)
    }
}

/// Whether `limit_ratio` keeps a hash: below `r` on `[0, 1)`, or at least `1 + r` for a negative
/// `r`.
fn ratio_keeps(ratio: f64, signature: u64) -> bool {
    let ratio = ratio.clamp(-1.0, 1.0);
    let position = (signature >> 11) as f64 / (1u64 << 53) as f64;
    if ratio > 0.0 {
        position < ratio
    } else if ratio < 0.0 {
        position >= 1.0 + ratio
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ratio_keeps_complements_and_extremes() {
        for signature in [0, 1, u64::MAX / 3, u64::MAX / 2, u64::MAX - 1, u64::MAX] {
            assert!(ratio_keeps(1.0, signature));
            assert!(ratio_keeps(-1.0, signature));
            assert!(ratio_keeps(5.0, signature));
            assert!(!ratio_keeps(0.0, signature));
            for ratio in [0.25, 0.5, 0.75] {
                assert_ne!(
                    ratio_keeps(ratio, signature),
                    ratio_keeps(ratio - 1.0, signature),
                    "{ratio}, {signature}"
                );
            }
        }
    }

    #[test]
    fn test_limitk_merge_matches_a_single_fold() {
        let series = |i: u64| -> Labels {
            vec![Arc::new(config::meta::promql::value::Label::new(
                "i",
                &i.to_string(),
            ))]
        };
        let limit = Limit::K(ScalarParam::Const(3.0));
        let mut single = limit.build(1);
        let mut left = limit.build(1);
        let mut right = limit.build(1);
        for i in 0..10 {
            single.push_series(std::iter::once((0, i as f64)), || series(i));
            let half = if i % 2 == 0 { &mut left } else { &mut right };
            half.push_series(std::iter::once((0, i as f64)), || series(i));
        }
        left.merge(right);
        let picked = |acc: LimitAccumulator| {
            let mut values: Vec<_> = acc
                .evaluate(Labels::default(), &[0])
                .into_iter()
                .map(|s| s.samples[0].value)
                .collect();
            values.sort_by(f64::total_cmp);
            values
        };
        assert_eq!(picked(single), picked(left));
    }
}
