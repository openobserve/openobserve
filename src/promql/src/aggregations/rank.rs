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

use config::{
    meta::promql::value::{Labels, RangeValue, Sample, signature},
    utils::sort::sort_float,
};
use hashbrown::HashMap;

use super::{Accumulate, AggFunc};

/// `topk` / `bottomk`: the k best series of a group at each evaluation slot.
#[derive(Clone, Copy)]
pub(crate) struct Rank {
    k: usize,
    is_bottom: bool,
}

impl Rank {
    pub(crate) fn new(k: usize, is_bottom: bool) -> Self {
        Self { k, is_bottom }
    }
}

impl AggFunc for Rank {
    type Accumulator = RankAccumulator;

    fn name(&self) -> &'static str {
        if self.is_bottom { "bottomk" } else { "topk" }
    }

    fn build(&self, slots: usize) -> Self::Accumulator {
        RankAccumulator {
            k: self.k,
            is_bottom: self.is_bottom,
            heaps: (0..slots).map(|_| BinaryHeap::new()).collect(),
        }
    }
}

/// One bounded heap per slot: memory is `slots × k` whatever the series count.
pub(crate) struct RankAccumulator {
    k: usize,
    is_bottom: bool,
    heaps: Vec<BinaryHeap<Ranked>>,
}

impl RankAccumulator {
    /// Whether an arrival beats the worst of a full heap; an empty heap with room admits all,
    /// and the signature is asked for only when the values tie.
    fn admits(&self, slot: usize, value: f64, signature: impl FnOnce() -> u64) -> bool {
        let heap = &self.heaps[slot];
        if heap.len() < self.k {
            return true;
        }
        heap.peek().is_some_and(
            |worst| match rank_values(self.is_bottom, value, worst.value) {
                Ordering::Less => true,
                Ordering::Equal => signature() < worst.signature,
                Ordering::Greater => false,
            },
        )
    }

    fn offer(&mut self, slot: usize, entry: Ranked) {
        if self.admits(slot, entry.value, || entry.signature) {
            self.insert(slot, entry);
        }
    }

    fn insert(&mut self, slot: usize, entry: Ranked) {
        let heap = &mut self.heaps[slot];
        if heap.len() == self.k {
            heap.pop();
        }
        heap.push(entry);
    }
}

impl Accumulate for RankAccumulator {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        labels: impl FnOnce() -> Labels,
    ) {
        // the labels are read only for an entry that enters a heap or ties with its worst
        let mut identity = SeriesIdentity::new(labels);
        for (slot, value) in values {
            if !self.admits(slot, value, || identity.get().1) {
                continue;
            }
            let (labels, signature) = identity.get();
            self.insert(
                slot,
                Ranked {
                    value,
                    signature: *signature,
                    labels: Arc::clone(labels),
                    is_bottom: self.is_bottom,
                },
            );
        }
    }

    fn merge(&mut self, other: Self) {
        for (slot, heap) in other.heaps.into_iter().enumerate() {
            for entry in heap.into_sorted_vec() {
                self.offer(slot, entry);
            }
        }
    }

    fn evaluate(self, _group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        // one series is one shared label set, and slots come in order, so its samples ascend
        let mut winners: HashMap<*const Labels, (Arc<Labels>, Vec<Sample>)> = HashMap::new();
        for (slot, heap) in self.heaps.into_iter().enumerate() {
            for entry in heap.into_sorted_vec() {
                winners
                    .entry(Arc::as_ptr(&entry.labels))
                    .or_insert_with(|| (entry.labels, Vec::new()))
                    .1
                    .push(Sample::new(timestamps[slot], entry.value));
            }
        }
        winners
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

/// One series' labels and their signature, read from the source once, on first use.
struct SeriesIdentity<L> {
    labels: Option<L>,
    memo: Option<(Arc<Labels>, u64)>,
}

impl<L: FnOnce() -> Labels> SeriesIdentity<L> {
    fn new(labels: L) -> Self {
        Self {
            labels: Some(labels),
            memo: None,
        }
    }

    fn get(&mut self) -> &(Arc<Labels>, u64) {
        self.memo.get_or_insert_with(|| {
            let labels = self.labels.take().expect("labels are read once")();
            let signature = signature(&labels);
            (Arc::new(labels), signature)
        })
    }
}

/// A series' value at one evaluation slot; the heap keeps the k best and its top is the worst
/// of them, so a better arrival pops it. Ties go to the lower label signature, which is stable
/// across runs where the load order of the series is not.
struct Ranked {
    value: f64,
    signature: u64,
    labels: Arc<Labels>,
    is_bottom: bool,
}

impl Ranked {
    fn key(&self) -> (f64, u64) {
        (self.value, self.signature)
    }
}

impl PartialEq for Ranked {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Ranked {}

impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> Ordering {
        rank_cmp(self.is_bottom, self.key(), other.key())
    }
}

/// Less is better; greater = worse keeps NaN below every number, as `sort_float` orders them.
fn rank_cmp(is_bottom: bool, left: (f64, u64), right: (f64, u64)) -> Ordering {
    rank_values(is_bottom, left.0, right.0).then_with(|| left.1.cmp(&right.1))
}

fn rank_values(is_bottom: bool, left: f64, right: f64) -> Ordering {
    if is_bottom {
        sort_float(&left, &right)
    } else {
        sort_float(&right, &left)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{EvalContext, Label, TimeWindow, Value};

    use super::*;
    use crate::aggregations::eval_aggregate;

    fn series(name: &str, values: &[(i64, f64)]) -> RangeValue {
        RangeValue {
            labels: vec![Arc::new(Label::new("s", name))],
            samples: values.iter().map(|&(t, v)| Sample::new(t, v)).collect(),
            exemplars: None,
            time_window: Some(TimeWindow::new(std::time::Duration::from_secs(60))),
        }
    }

    /// (series label, timestamps) per output series, sorted.
    fn rows(value: Value) -> Vec<(String, Vec<(i64, f64)>)> {
        let Value::Matrix(matrix) = value else {
            return vec![];
        };
        let mut rows: Vec<_> = matrix
            .iter()
            .map(|s| {
                (
                    s.labels[0].value.clone(),
                    s.samples.iter().map(|x| (x.timestamp, x.value)).collect(),
                )
            })
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        rows
    }

    #[test]
    fn test_topk_keeps_the_highest_values_under_the_series_labels() {
        let ts = 1_640_995_200;
        let matrix = vec![
            series("one", &[(ts, 10.5)]),
            series("two", &[(ts, 15.3)]),
            series("three", &[(ts, 8.2)]),
        ];
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let Value::Matrix(result) = eval_aggregate(
            &None,
            Value::Matrix(matrix.clone()),
            Rank::new(2, false),
            &eval_ctx,
        )
        .unwrap() else {
            panic!("expected a matrix");
        };
        assert_eq!(result.len(), 2);
        let mut values: Vec<f64> = result.iter().map(|s| s.samples[0].value).collect();
        values.sort_by(|a, b| b.partial_cmp(a).unwrap());
        assert_eq!(values, [15.3, 10.5]);
        assert!(result.iter().all(|s| s.samples[0].timestamp == ts));
        assert!(
            result
                .iter()
                .all(|s| s.time_window.is_none() && s.exemplars.is_none())
        );

        let Value::Matrix(result) =
            eval_aggregate(&None, Value::Matrix(matrix), Rank::new(2, true), &eval_ctx).unwrap()
        else {
            panic!("expected a matrix");
        };
        let mut values: Vec<f64> = result.iter().map(|s| s.samples[0].value).collect();
        values.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(values, [8.2, 10.5]);
    }

    #[test]
    fn test_rank_none_empty_k_zero_and_invalid_input() {
        let ts = 1_640_995_200;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        for func in [Rank::new(2, false), Rank::new(2, true)] {
            assert!(matches!(
                eval_aggregate(&None, Value::None, func, &eval_ctx),
                Ok(Value::None)
            ));
            assert!(matches!(
                eval_aggregate(&None, Value::Matrix(vec![]), func, &eval_ctx),
                Ok(Value::None)
            ));
            assert!(eval_aggregate(&None, Value::Float(1.0), func, &eval_ctx).is_err());
        }
        let data = Value::Matrix(vec![series("one", &[(ts, 10.5)])]);
        assert!(matches!(
            eval_aggregate(&None, data.clone(), Rank::new(0, false), &eval_ctx),
            Ok(Value::None)
        ));
        assert!(matches!(
            eval_aggregate(&None, data, Rank::new(0, true), &eval_ctx),
            Ok(Value::None)
        ));
        assert!(
            Rank::new(0, false)
                .build(3)
                .evaluate(vec![], &[1, 2, 3])
                .is_empty()
        );
    }

    /// The bounded heaps pick exactly what a full per-slot sort by (value, signature) picks,
    /// with NaN ranking below every number and ties going to the lower label signature.
    #[test]
    fn test_rank_bounded_heap_matches_full_ranking() {
        let ts: Vec<i64> = (0..4).map(|i| 1_000 + i * 10).collect();
        let zip = |values: [f64; 4]| ts.iter().copied().zip(values).collect::<Vec<_>>();
        let matrix = vec![
            series("a", &zip([5.0, 1.0, f64::NAN, 2.0])),
            series("b", &zip([5.0, 2.0, 1.0, 2.0])),
            series("c", &zip([4.0, 3.0, 2.0, 2.0])),
            series("d", &zip([1.0, 4.0, 3.0, 9.0])),
        ];
        let eval_ctx = EvalContext::new(1_000, 1_030, 10, "test".to_string());
        let full_sort = |is_bottom: bool| -> Vec<(String, Vec<(i64, f64)>)> {
            let mut picked: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
            for &t in &ts {
                let mut candidates: Vec<(f64, u64, String)> = matrix
                    .iter()
                    .filter_map(|s| {
                        let sample = s.samples.iter().find(|x| x.timestamp == t)?;
                        Some((
                            sample.value,
                            signature(&s.labels),
                            s.labels[0].value.clone(),
                        ))
                    })
                    .collect();
                candidates.sort_by(|x, y| rank_cmp(is_bottom, (x.0, x.1), (y.0, y.1)));
                for (v, _, n) in candidates.into_iter().take(2) {
                    picked.entry(n).or_default().push((t, v));
                }
            }
            let mut rows: Vec<_> = picked.into_iter().collect();
            rows.sort_by(|a, b| a.0.cmp(&b.0));
            rows
        };
        for is_bottom in [false, true] {
            let actual = rows(
                eval_aggregate(
                    &None,
                    Value::Matrix(matrix.clone()),
                    Rank::new(2, is_bottom),
                    &eval_ctx,
                )
                .unwrap(),
            );
            let expected = full_sort(is_bottom);
            assert_eq!(actual.len(), expected.len(), "bottom={is_bottom}");
            for (a, e) in actual.iter().zip(&expected) {
                assert_eq!(a.0, e.0);
                assert_eq!(a.1.len(), e.1.len());
                for (x, y) in a.1.iter().zip(&e.1) {
                    assert_eq!(x.0, y.0);
                    assert_eq!(x.1.to_bits(), y.1.to_bits());
                }
            }
            // the NaN never wins a top slot and always wins a bottom slot it competes in
            let a_slots: Vec<i64> = actual
                .iter()
                .find(|(n, _)| n == "a")
                .map(|(_, t)| t.iter().map(|x| x.0).collect())
                .unwrap_or_default();
            assert_eq!(a_slots.contains(&1_020), is_bottom);
        }
    }

    #[test]
    fn test_rank_all_fit_within_k_and_ties_go_to_the_lower_signature() {
        let ts = 1_640_995_200;
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        let matrix = vec![series("1", &[(ts, 5.0)]), series("2", &[(ts, 3.0)])];
        let Value::Matrix(result) =
            eval_aggregate(&None, Value::Matrix(matrix), Rank::new(5, false), &eval_ctx).unwrap()
        else {
            panic!("expected a matrix");
        };
        assert_eq!(result.len(), 2);

        let tied = vec![series("x", &[(ts, 1.0)]), series("y", &[(ts, 1.0)])];
        let lowest = tied
            .iter()
            .min_by_key(|s| signature(&s.labels))
            .map(|s| s.labels[0].value.clone())
            .unwrap();
        for is_bottom in [false, true] {
            let actual = rows(
                eval_aggregate(
                    &None,
                    Value::Matrix(tied.clone()),
                    Rank::new(1, is_bottom),
                    &eval_ctx,
                )
                .unwrap(),
            );
            assert_eq!(actual.len(), 1);
            assert_eq!(actual[0].0, lowest);
        }
    }

    /// Two series with the same labels are two winners, as the generic ranking keyed by series
    /// index produced.
    #[test]
    fn test_rank_keeps_duplicate_label_sets_apart() {
        let eval_ctx = EvalContext::new(1_000, 1_010, 10, "test".to_string());
        let matrix = vec![
            series("dup", &[(1_000, 9.0), (1_010, 1.0)]),
            series("dup", &[(1_000, 1.0), (1_010, 9.0)]),
        ];
        let Value::Matrix(result) =
            eval_aggregate(&None, Value::Matrix(matrix), Rank::new(1, false), &eval_ctx).unwrap()
        else {
            panic!("expected a matrix");
        };
        assert_eq!(result.len(), 2);
        assert!(
            result
                .iter()
                .all(|s| s.samples.len() == 1 && s.samples[0].value == 9.0)
        );
    }

    /// Every chunking of the series, merged in order, ranks exactly like the sequential fold;
    /// a series is pushed whole, so the chunks split series, not values.
    #[test]
    fn test_rank_merges_like_the_sequential_fold() {
        let series: Vec<(Labels, Vec<(usize, f64)>)> = [
            vec![(0, 3.0), (2, 4.0)],
            vec![(1, 5.0), (0, -6.0)],
            vec![(0, 7.0), (1, 5.0)],
            vec![(2, f64::NAN)],
            vec![(0, 7.0), (2, 2.0)],
            vec![(1, 5.0), (2, 4.0)],
        ]
        .into_iter()
        .enumerate()
        .map(|(i, points)| (vec![Arc::new(Label::new("s", &i.to_string()))], points))
        .collect();
        let timestamps = [10, 20, 30];
        for k in [0, 1, 2, 3, 10] {
            for is_bottom in [false, true] {
                let func = Rank::new(k, is_bottom);
                let fold = |series: &[(Labels, Vec<(usize, f64)>)]| {
                    let mut acc = func.build(3);
                    for (labels, points) in series {
                        acc.push_series(points.iter().copied(), || labels.clone());
                    }
                    acc
                };
                let expected = rows(Value::Matrix(fold(&series).evaluate(vec![], &timestamps)));
                for split in 0..=series.len() {
                    for second in split..=series.len() {
                        let mut merged = func.build(3);
                        for chunk in [&series[..split], &series[split..second], &series[second..]] {
                            merged.merge(fold(chunk));
                        }
                        let actual = rows(Value::Matrix(merged.evaluate(vec![], &timestamps)));
                        assert_eq!(expected.len(), actual.len(), "k={k} bottom={is_bottom}");
                        for (e, a) in expected.iter().zip(&actual) {
                            assert_eq!(e.0, a.0, "k={k} bottom={is_bottom}");
                            assert_eq!(e.1.len(), a.1.len(), "k={k} bottom={is_bottom}");
                            for (x, y) in e.1.iter().zip(&a.1) {
                                assert_eq!(x.0, y.0);
                                assert_eq!(x.1.to_bits(), y.1.to_bits());
                            }
                        }
                    }
                }
            }
        }
    }
}
