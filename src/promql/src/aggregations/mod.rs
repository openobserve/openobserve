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

use std::{collections::HashMap, hash::Hasher, sync::Arc};

use config::{
    meta::promql::{
        NAME_LABEL,
        value::{EvalContext, Label, Labels, RangeValue, Sample, Value},
    },
    utils::hash::gxhash,
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{LabelModifier, token};
use rayon::prelude::*;

mod avg;
mod count;
mod count_values;
mod dispersion;
mod extrema;
mod group;
mod max;
mod min;
mod quantile;
mod rank;
mod stddev;
mod stdvar;
mod sum;

pub(crate) use avg::Avg;
pub(crate) use count::Count;
pub(crate) use count_values::count_values;
pub(crate) use group::Group;
pub(crate) use max::Max;
pub(crate) use min::Min;
pub(crate) use quantile::quantile;
pub(crate) use rank::Rank;
pub(crate) use stddev::Stddev;
pub(crate) use stdvar::Stdvar;
pub(crate) use sum::{Sum, SumState};

/// Series per parallel partial-aggregation chunk when a single group is large.
const AGG_PARALLEL_CHUNK: usize = 32768;

/// Trait for PromQL aggregation operators.
///
/// One implementation per operator (`sum`, `avg`, `min`, `max`, `count`, `group`, `stddev`,
/// `stdvar`, `quantile`, `topk`/`bottomk`) shared by both evaluation paths: the generic path
/// folds a materialized matrix through it in [`eval_aggregate`], and the streaming path folds
/// each hash partition of a series stream through it in `streaming_eval::aggregate`. The
/// operator carries only its parameter (k, φ), if any; all per-group state lives in the
/// [`Accumulate`] it builds, so a query holds one accumulator per label group (and per
/// partition on the streaming path) and merges them.
///
/// # Examples
///
/// ```ignore
/// #[derive(Clone, Copy)]
/// struct Sum;
///
/// impl AggFunc for Sum {
///     type Accumulator = SumAccumulate;
///
///     fn name(&self) -> &'static str {
///         "sum"
///     }
///
///     fn build(&self, slots: usize) -> Self::Accumulator {
///         SumAccumulate::with_slots(slots)
///     }
/// }
/// ```
pub trait AggFunc: Sync {
    type Accumulator: Accumulate;

    /// Returns the operator name as it appears in PromQL and in the timing logs (e.g. "sum").
    fn name(&self) -> &'static str;

    /// Creates a fresh accumulator with one empty state per evaluation slot.
    ///
    /// `slots` is the number of evaluation timestamps of the query (`(end - start) / step + 1`,
    /// or 1 for an instant query). Every call returns an independent accumulator, so groups
    /// and partitions can be folded in parallel and combined with [`Accumulate::merge`].
    fn build(&self, slots: usize) -> Self::Accumulator;

    /// Whether a huge group may be split into parallel chunks whose partial accumulators are
    /// combined with [`Accumulate::merge`].
    ///
    /// Value-buffering accumulators (`quantile`, `stddev`, `stdvar`) opt out: each reduction
    /// level re-copies every buffered sample, costing `O(N log P)` copying and extra transient
    /// memory versus the sequential append. Partition merging on the streaming path is not
    /// affected by this flag.
    fn mergeable(&self) -> bool {
        true
    }
}

/// Trait for the per-group state of an aggregation.
///
/// An accumulator is created by [`AggFunc::build`] for one label group and holds one state
/// per evaluation slot, where slot `i` is the `i`-th timestamp of the evaluation grid
/// `start + i * step`. Values arrive one series at a time, already assigned to their slot: the
/// generic path maps a sample's timestamp onto the grid, the streaming path evaluates the range
/// function per slot. Keying by slot instead of by timestamp keeps the state a plain `Vec` on
/// both paths.
///
/// The typical lifecycle is:
/// 1. `AggFunc::build(slots)` for each label group (and each partition on the streaming path)
/// 2. `push_series(values, labels)` for every series that belongs to the group
/// 3. `merge(other)` to fold the partial accumulators of the same group together
/// 4. `evaluate(group_labels, timestamps)` to produce the output series
///
/// # Examples
///
/// ```ignore
/// let mut acc = Sum.build(timestamps.len());
/// for series in matrix {
///     acc.push_series(series.values(), || series.labels.clone());
/// }
/// let series: Vec<RangeValue> = acc.evaluate(group_labels, &timestamps);
/// ```
pub trait Accumulate: Send + Sync + Sized {
    /// Adds one series' values, `(slot, value)` in ascending slot order, to the slots' states.
    ///
    /// `labels` produces the series' own labels; it is called at most once, and only by an
    /// accumulator whose output keeps the series' own labels (`topk`, `bottomk`) for a series
    /// that may make it into the output. The scalar aggregations never call it, so a fold over
    /// a million series materializes no per-series labels.
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        labels: impl FnOnce() -> Labels,
    );

    /// Folds another accumulator of the same group into this one, as if all of its values had
    /// been pushed here after this accumulator's own.
    ///
    /// This is how a large group aggregated in parallel chunks, and the per-partition folds of
    /// the streaming path, are combined. Both accumulators must have been built with the same
    /// number of slots.
    ///
    /// Floating-point caveat: if a partial sum overflows to ±Inf, merging opposite infinities
    /// yields NaN where a sequential fold may yield ±Inf. Summing such inputs is inherently
    /// order-dependent (sequentially, `MAX, -MAX, MAX, -MAX` gives 0 while
    /// `MAX, MAX, -MAX, -MAX` gives +Inf), so no chunking-independent result exists; NaN at
    /// least signals the Inf - Inf cancellation.
    fn merge(&mut self, other: Self);

    /// Consumes the accumulator and produces the output series of the group.
    ///
    /// `group_labels` are the labels the group was keyed by (`by(...)` / `without(...)`
    /// projection) and `timestamps` is the evaluation grid, indexed by slot. A scalar
    /// aggregation returns exactly one series under `group_labels` with one sample per slot
    /// that produced a value, in slot order; the caller decides what to do with an empty one.
    /// An aggregation that selects input series returns one series per selected input, under
    /// that input's own labels. No output carries a time window.
    fn evaluate(self, group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue>;
}

/// The aggregation operators that fold through the shared accumulators, with their parameter.
///
/// This is the single table from a parser token to an operator: the generic path dispatches
/// through [`AggOp::eval_aggregate`] and the streaming path through `streaming_eval::aggregate`,
/// each matching once into the monomorphized fold for the chosen [`AggFunc`]. Operators that
/// are not listed here (`quantile`, `count_values`) are evaluated by their own functions.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AggOp {
    Avg,
    Bottomk(usize),
    Count,
    Group,
    Max,
    Min,
    Stddev,
    Stdvar,
    Sum,
    Topk(usize),
}

impl AggOp {
    /// The operator of a token with its evaluated parameter; the error of an unsupported
    /// operator or of a k that is not a number.
    pub(crate) fn new(op: &token::TokenType, param: Option<Value>) -> Result<Self> {
        let k = |name: &str| match param {
            Some(Value::Float(value)) => Ok(value as usize),
            _ => Err(DataFusionError::Plan(format!(
                "[{name}] param must be a number"
            ))),
        };
        Ok(match op.id() {
            token::T_AVG => Self::Avg,
            token::T_BOTTOMK => Self::Bottomk(k("bottomk")?),
            token::T_COUNT => Self::Count,
            token::T_GROUP => Self::Group,
            token::T_MAX => Self::Max,
            token::T_MIN => Self::Min,
            token::T_STDDEV => Self::Stddev,
            token::T_STDVAR => Self::Stdvar,
            token::T_SUM => Self::Sum,
            token::T_TOPK => Self::Topk(k("topk")?),
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Aggregate: {op:?}"
                )));
            }
        })
    }

    /// Whether the output keeps the input series' own labels, so a source must carry every
    /// label of a series rather than its group projection.
    pub(crate) fn needs_series_labels(&self) -> bool {
        matches!(self, Self::Topk(_) | Self::Bottomk(_))
    }

    /// The generic fold over a materialized matrix.
    pub(crate) fn eval_aggregate(
        self,
        modifier: &Option<LabelModifier>,
        data: Value,
        eval_ctx: &EvalContext,
    ) -> Result<Value> {
        match self {
            Self::Avg => eval_aggregate(modifier, data, Avg, eval_ctx),
            Self::Bottomk(k) => eval_aggregate(modifier, data, Rank::new(k, true), eval_ctx),
            Self::Count => eval_aggregate(modifier, data, Count, eval_ctx),
            Self::Group => eval_aggregate(modifier, data, Group, eval_ctx),
            Self::Max => eval_aggregate(modifier, data, Max, eval_ctx),
            Self::Min => eval_aggregate(modifier, data, Min, eval_ctx),
            Self::Stddev => eval_aggregate(modifier, data, Stddev, eval_ctx),
            Self::Stdvar => eval_aggregate(modifier, data, Stdvar, eval_ctx),
            Self::Sum => eval_aggregate(modifier, data, Sum, eval_ctx),
            Self::Topk(k) => eval_aggregate(modifier, data, Rank::new(k, false), eval_ctx),
        }
    }
}

/// The evaluation grid `start + i * step` a sample timestamp maps onto.
struct EvalGrid {
    start: i64,
    step: i64,
    slots: usize,
    instant: bool,
}

impl EvalGrid {
    fn new(eval_ctx: &EvalContext, slots: usize) -> Self {
        Self {
            start: eval_ctx.start,
            step: eval_ctx.step,
            slots,
            instant: eval_ctx.is_instant(),
        }
    }

    /// The slot of a timestamp on the grid; off-grid timestamps have none.
    fn slot(&self, timestamp: i64) -> Option<usize> {
        if self.instant {
            return (timestamp == self.start).then_some(0);
        }
        let offset = timestamp.checked_sub(self.start)?;
        if offset % self.step != 0 {
            return None;
        }
        usize::try_from(offset / self.step)
            .ok()
            .filter(|&slot| slot < self.slots)
    }
}

/// One series under the group labels, kept when empty because the generic path emits every group.
pub(crate) fn group_series(group_labels: Labels, samples: Vec<Sample>) -> Vec<RangeValue> {
    vec![RangeValue {
        labels: group_labels,
        samples,
        exemplars: None,
        time_window: None,
    }]
}

/// Projects a series' labels onto the grouping set of the label modifier
/// (`by(...)` keeps them, `without(...)` drops them, none drops all).
pub(crate) fn projected_labels(modifier: &Option<LabelModifier>, labels: &Labels) -> Labels {
    projected_label_refs(modifier, labels).cloned().collect()
}

/// Compute the signature of the projected labels without cloning the label
/// vector and retaining it first. Label order and filtering exactly match
/// [`projected_labels`], so the grouping key is unchanged.
fn projected_labels_signature(modifier: &Option<LabelModifier>, labels: &Labels) -> u64 {
    let mut hasher = gxhash::new_hasher();
    for label in projected_label_refs(modifier, labels) {
        hasher.write(label.name.as_bytes());
        hasher.write(label.value.as_bytes());
    }
    hasher.finish()
}

fn projected_label_refs<'a>(
    modifier: &'a Option<LabelModifier>,
    labels: &'a Labels,
) -> impl Iterator<Item = &'a Arc<Label>> {
    let labels = if modifier.is_none() {
        &labels[..0]
    } else {
        labels.as_slice()
    };
    labels.iter().filter(move |label| match modifier {
        Some(LabelModifier::Include(include)) => include.labels.contains(&label.name),
        Some(LabelModifier::Exclude(exclude)) => {
            !exclude.labels.contains(&label.name) && label.name != NAME_LABEL
        }
        None => false,
    })
}

/// Groups series indices by their label signatures based on the label modifier
pub(crate) fn group_series_by_labels(
    matrix: &[RangeValue],
    modifier: &Option<LabelModifier>,
) -> HashMap<u64, Vec<usize>> {
    // the signature computation clones and filters every series' labels;
    // fan it out
    let hashes: Vec<u64> = matrix
        .par_iter()
        .map(|series| projected_labels_signature(modifier, &series.labels))
        .collect();

    let mut groups: HashMap<u64, Vec<usize>> = HashMap::with_capacity(matrix.len());
    for (idx, hash) in hashes.into_iter().enumerate() {
        groups.entry(hash).or_default().push(idx);
    }

    groups
}

/// Processes Matrix input for range queries using the AggFunc trait pattern
pub(crate) fn eval_aggregate<F>(
    param: &Option<LabelModifier>,
    data: Value,
    func: F,
    eval_ctx: &EvalContext,
) -> Result<Value>
where
    F: AggFunc,
{
    let func_name = func.name();
    let trace_id = &eval_ctx.trace_id;
    log::info!("[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) started");

    // Handle Matrix input for range queries
    let matrix = match data {
        Value::Matrix(m) => {
            log::info!(
                "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) started with {} series",
                m.len()
            );
            m
        }
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "[{func_name}] function only accept vector or matrix values"
            )));
        }
    };

    if matrix.is_empty() {
        return Ok(Value::None);
    }

    let timestamps = eval_ctx.timestamps();
    let grid = EvalGrid::new(eval_ctx, timestamps.len());
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) processing {} time points",
        timestamps.len()
    );

    // Step 1: Group series indices by their projected label signature
    let start1 = std::time::Instant::now();
    let groups = group_series_by_labels(&matrix, param);

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) grouped {} series into {} groups in {:?}",
        matrix.len(),
        groups.len(),
        start1.elapsed()
    );

    // Step 2: Process each group in parallel
    // For each group, aggregate all samples across timestamps
    let start3 = std::time::Instant::now();
    let results: Vec<RangeValue> = groups
        .par_iter()
        .flat_map_iter(|(_, series_indices)| {
            // Get the labels for this group (from the first series in the group)
            let labels = projected_labels(param, &matrix[series_indices[0]].labels);

            let accumulate_chunk = |chunk: &[usize]| {
                let mut acc = func.build(timestamps.len());
                for &series_idx in chunk {
                    let series = &matrix[series_idx];
                    acc.push_series(
                        series.samples.iter().filter_map(|sample| {
                            grid.slot(sample.timestamp).map(|slot| (slot, sample.value))
                        }),
                        || series.labels.clone(),
                    );
                }
                acc
            };

            // A huge group (e.g. `sum(...)` without a modifier puts every
            // series in one group) would otherwise aggregate on one thread;
            // fold it in parallel chunks and merge the partials.
            let acc = if func.mergeable() && series_indices.len() >= 2 * AGG_PARALLEL_CHUNK {
                series_indices
                    .par_chunks(AGG_PARALLEL_CHUNK)
                    .map(accumulate_chunk)
                    .reduce(
                        || func.build(timestamps.len()),
                        |mut a, b| {
                            a.merge(b);
                            a
                        },
                    )
            } else {
                accumulate_chunk(series_indices)
            };

            acc.evaluate(labels, &timestamps)
        })
        .collect();

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) parallel aggregation took: {:?}, produced {} series",
        start3.elapsed(),
        results.len()
    );

    // Dropping millions of per-series allocations single-threaded can cost
    // ~1s at high cardinality; free them on the rayon pool instead.
    let start4 = std::time::Instant::now();
    matrix.into_par_iter().for_each(drop);
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) parallel drop took: {:?}",
        start4.elapsed()
    );

    // a scalar aggregation emits every group; one that selects series may emit nothing
    if results.is_empty() {
        return Ok(Value::None);
    }
    Ok(Value::Matrix(results))
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::LabelsExt;

    use super::*;

    // Test data helpers
    fn create_test_labels() -> Labels {
        vec![
            Arc::new(Label::new("instance", "localhost:9090")),
            Arc::new(Label::new("job", "prometheus")),
            Arc::new(Label::new("__name__", "http_requests_total")),
        ]
    }

    fn labels_to_include(
        include_labels: &[String],
        mut actual_labels: Vec<Arc<Label>>,
    ) -> Vec<Arc<Label>> {
        actual_labels.retain(|label| include_labels.contains(&label.name));
        actual_labels
    }

    fn labels_to_exclude(
        exclude_labels: &[String],
        mut actual_labels: Vec<Arc<Label>>,
    ) -> Vec<Arc<Label>> {
        actual_labels
            .retain(|label| !exclude_labels.contains(&label.name) && label.name != NAME_LABEL);
        actual_labels
    }

    #[test]
    fn test_labels_to_include() {
        let actual_labels = create_test_labels();
        let include_labels = vec!["instance".to_string(), "job".to_string()];

        let result = labels_to_include(&include_labels, actual_labels.clone());

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|l| l.name == "instance"));
        assert!(result.iter().any(|l| l.name == "job"));
        assert!(!result.iter().any(|l| l.name == "__name__"));
    }

    /// One value of a label-less series, for the scalar accumulators that never read labels.
    fn push<A: Accumulate>(acc: &mut A, slot: usize, value: f64) {
        acc.push_series(std::iter::once((slot, value)), Labels::default);
    }

    /// The samples of the lone series a scalar accumulator evaluates to.
    fn samples_of<A: Accumulate>(acc: A, timestamps: &[i64]) -> Vec<Sample> {
        let mut series = acc.evaluate(Labels::default(), timestamps);
        assert_eq!(series.len(), 1);
        series.pop().unwrap().samples
    }

    /// Pushes `(slot, value)` pairs sequentially, and again split into every possible
    /// contiguous chunking merged in order; every fold must produce the same bits.
    fn assert_chunkings_match<F: AggFunc>(func: F, slots: usize, points: &[(usize, f64)]) {
        let timestamps: Vec<i64> = (1..=slots as i64).collect();
        let mut sequential = func.build(slots);
        for &(slot, value) in points {
            push(&mut sequential, slot, value);
        }
        let expected = samples_of(sequential, &timestamps);
        for split in 0..=points.len() {
            for second_split in split..=points.len() {
                let mut merged = func.build(slots);
                for chunk in [
                    &points[..split],
                    &points[split..second_split],
                    &points[second_split..],
                ] {
                    let mut partial = func.build(slots);
                    for &(slot, value) in chunk {
                        push(&mut partial, slot, value);
                    }
                    merged.merge(partial);
                }
                let actual = samples_of(merged, &timestamps);
                assert_eq!(expected.len(), actual.len(), "{}", func.name());
                for (e, a) in expected.iter().zip(&actual) {
                    assert_eq!(e.timestamp, a.timestamp, "{}", func.name());
                    assert_eq!(e.value.to_bits(), a.value.to_bits(), "{}", func.name());
                }
            }
        }
    }

    #[test]
    fn test_every_accumulator_merges_like_the_sequential_fold() {
        // Integer values keep float addition exact regardless of order.
        let points = [
            (0, 3.0),
            (1, 5.0),
            (0, 7.0),
            (1, 11.0),
            (2, 2.0),
            (0, 4.0),
            (2, -6.0),
        ];
        let mut reversed = points;
        reversed.reverse();
        for points in [&points[..], &reversed[..]] {
            assert_chunkings_match(Sum, 4, points);
            assert_chunkings_match(Avg, 4, points);
            assert_chunkings_match(Count, 4, points);
            assert_chunkings_match(Min, 4, points);
            assert_chunkings_match(Max, 4, points);
            assert_chunkings_match(Group, 4, points);
        }
        // The buffering accumulators merge by appending, so only the chunking may vary.
        assert_chunkings_match(Stddev, 4, &points);
        assert_chunkings_match(Stdvar, 4, &points);
        assert_chunkings_match(quantile::Quantile::new(0.5), 4, &points);
        assert!(samples_of(Sum.build(0), &[]).is_empty());
    }

    #[test]
    fn test_scalar_accumulators_agree_on_slot_and_order() {
        fn check<F: AggFunc>(func: F, expected: &[(i64, f64)]) {
            let mut acc = func.build(3);
            for (slot, value) in [(2, 4.0), (0, 1.0), (2, 2.0), (0, 3.0)] {
                push(&mut acc, slot, value);
            }
            let group = vec![Arc::new(Label::new("job", "api"))];
            let mut series = acc.evaluate(group.clone(), &[10, 20, 30]);
            assert_eq!(series.len(), 1, "{}", func.name());
            let series = series.pop().unwrap();
            assert_eq!(series.labels, group, "{}", func.name());
            assert!(series.time_window.is_none() && series.exemplars.is_none());
            let actual: Vec<(i64, f64)> = series
                .samples
                .iter()
                .map(|s| (s.timestamp, s.value))
                .collect();
            assert_eq!(actual, expected, "{}", func.name());
        }
        check(Sum, &[(10, 4.0), (30, 6.0)]);
        check(Avg, &[(10, 2.0), (30, 3.0)]);
        check(Count, &[(10, 2.0), (30, 2.0)]);
        check(Min, &[(10, 1.0), (30, 2.0)]);
        check(Max, &[(10, 3.0), (30, 4.0)]);
        check(Group, &[(10, 1.0), (30, 1.0)]);
        check(Stdvar, &[(10, 1.0), (30, 1.0)]);
        check(Stddev, &[(10, 1.0), (30, 1.0)]);
        check(quantile::Quantile::new(1.0), &[(10, 3.0), (30, 4.0)]);
    }

    #[test]
    fn test_extrema_merge_preserves_nan_and_signed_zero_behavior() {
        fn check(func: impl AggFunc, initial: f64) {
            for (values, expected) in [
                (vec![f64::NAN], initial),
                (vec![f64::NAN, 7.0, f64::NAN], 7.0),
                (vec![-0.0, 0.0], -0.0),
                (vec![0.0, -0.0], 0.0),
            ] {
                let mut sequential = func.build(1);
                let mut merged = func.build(1);
                for value in values {
                    push(&mut sequential, 0, value);
                    let mut partial = func.build(1);
                    push(&mut partial, 0, value);
                    merged.merge(partial);
                }
                for samples in [samples_of(sequential, &[1]), samples_of(merged, &[1])] {
                    assert_eq!(samples.len(), 1);
                    assert_eq!(samples[0].timestamp, 1);
                    assert_eq!(
                        samples[0].value.to_bits(),
                        expected.to_bits(),
                        "{}",
                        func.name()
                    );
                }
            }
        }
        check(Min, f64::INFINITY);
        check(Max, f64::NEG_INFINITY);
    }

    #[test]
    fn test_statistics_with_partial_merges() {
        fn check<F: AggFunc>(func: F, values: &[f64], expected: f64) {
            for merge in [false, true] {
                let mut accumulator = func.build(2);
                for &value in values {
                    if merge {
                        let mut partial = func.build(2);
                        push(&mut partial, 0, value);
                        accumulator.merge(partial);
                    } else {
                        push(&mut accumulator, 0, value);
                    }
                }
                let samples = samples_of(accumulator, &[1, 2]);
                assert_eq!(samples.len(), 1);
                assert!(
                    samples[0].value == expected
                        || (samples[0].value.is_nan() && expected.is_nan()),
                    "{}, {values:?}, merge={merge}",
                    func.name()
                );
            }
        }
        for (values, avg, variance) in [
            (vec![1.0, 2.0, 3.0], 2.0, 2.0 / 3.0),
            (vec![1e308, 1e308], f64::INFINITY, f64::INFINITY),
            (vec![f64::INFINITY, f64::INFINITY], f64::INFINITY, f64::NAN),
            (vec![f64::INFINITY, f64::NEG_INFINITY], f64::NAN, f64::NAN),
            (vec![f64::NAN, 1.0], f64::NAN, f64::NAN),
        ] {
            check(Avg, &values, avg);
            check(Stdvar, &values, variance);
            check(Stddev, &values, variance.sqrt());
        }
    }

    #[test]
    fn test_agg_op_new_keeps_the_generic_errors() {
        let op = |id| token::TokenType::new(id);
        assert!(matches!(
            AggOp::new(&op(token::T_SUM), None),
            Ok(AggOp::Sum)
        ));
        assert!(matches!(
            AggOp::new(&op(token::T_AVG), None),
            Ok(AggOp::Avg)
        ));
        assert!(matches!(
            AggOp::new(&op(token::T_TOPK), Some(Value::Float(3.7))),
            Ok(AggOp::Topk(3))
        ));
        assert!(matches!(
            AggOp::new(&op(token::T_BOTTOMK), Some(Value::Float(1.0))),
            Ok(AggOp::Bottomk(1))
        ));
        assert!(matches!(
            AggOp::new(&op(token::T_TOPK), Some(Value::Float(-1.0))),
            Ok(AggOp::Topk(0))
        ));
        for (id, message) in [
            (token::T_TOPK, "[topk] param must be a number"),
            (token::T_BOTTOMK, "[bottomk] param must be a number"),
        ] {
            for param in [None, Some(Value::None), Some(Value::String("k".into()))] {
                let result = AggOp::new(&op(id), param);
                assert!(
                    matches!(&result, Err(DataFusionError::Plan(m)) if m == message),
                    "{result:?}"
                );
            }
        }
        for id in [token::T_QUANTILE, token::T_COUNT_VALUES, token::T_ADD] {
            let unsupported = op(id);
            assert!(matches!(
                AggOp::new(&unsupported, Some(Value::Float(0.5))),
                Err(DataFusionError::NotImplemented(m)) if m == format!("Unsupported Aggregate: {unsupported:?}")
            ));
        }
    }

    #[test]
    fn test_agg_op_series_labels() {
        for op in [AggOp::Topk(1), AggOp::Bottomk(1)] {
            assert!(op.needs_series_labels());
        }
        for op in [
            AggOp::Avg,
            AggOp::Count,
            AggOp::Group,
            AggOp::Max,
            AggOp::Min,
            AggOp::Stddev,
            AggOp::Stdvar,
            AggOp::Sum,
        ] {
            assert!(!op.needs_series_labels());
        }
    }

    /// An aggregation that selects series returns `None` rather than an empty matrix when
    /// nothing ranks.
    #[test]
    fn test_eval_aggregate_selecting_nothing_is_none() {
        let eval_ctx = EvalContext::new(1000, 3000, 1000, "test".to_string());
        let matrix = vec![RangeValue::new(
            vec![Arc::new(Label::new("job", "a"))],
            [Sample::new(1000, 1.0)],
        )];
        assert!(matches!(
            AggOp::Topk(0).eval_aggregate(&None, Value::Matrix(matrix.clone()), &eval_ctx),
            Ok(Value::None)
        ));
        let off_grid = vec![RangeValue::new(
            vec![Arc::new(Label::new("job", "a"))],
            [Sample::new(1500, 1.0)],
        )];
        assert!(matches!(
            AggOp::Topk(2).eval_aggregate(&None, Value::Matrix(off_grid), &eval_ctx),
            Ok(Value::None)
        ));
        assert!(matches!(
            AggOp::Topk(2).eval_aggregate(&None, Value::Matrix(vec![]), &eval_ctx),
            Ok(Value::None)
        ));
        let Value::Matrix(result) = AggOp::Topk(2)
            .eval_aggregate(&None, Value::Matrix(matrix), &eval_ctx)
            .unwrap()
        else {
            panic!("expected a matrix");
        };
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_eval_grid_maps_only_grid_timestamps() {
        let range = EvalGrid::new(&EvalContext::new(1000, 3000, 1000, "t".into()), 3);
        assert_eq!(range.slot(1000), Some(0));
        assert_eq!(range.slot(2000), Some(1));
        assert_eq!(range.slot(3000), Some(2));
        assert_eq!(range.slot(4000), None);
        assert_eq!(range.slot(0), None);
        assert_eq!(range.slot(1500), None);
        assert_eq!(range.slot(i64::MIN), None);
        let instant = EvalGrid::new(&EvalContext::new(1000, 1000, 0, "t".into()), 1);
        assert_eq!(instant.slot(1000), Some(0));
        assert_eq!(instant.slot(2000), None);
    }

    #[test]
    fn test_eval_aggregate_keeps_off_grid_group_and_sorts_by_slot() {
        let matrix = vec![
            RangeValue::new(
                vec![Arc::new(Label::new("job", "a"))],
                [
                    Sample::new(3000, 3.0),
                    Sample::new(1000, 1.0),
                    Sample::new(1500, 9.0),
                ],
            ),
            RangeValue::new(
                vec![Arc::new(Label::new("job", "b"))],
                [Sample::new(500, 9.0)],
            ),
        ];
        let eval_ctx = EvalContext::new(1000, 3000, 1000, "test".to_string());
        let param = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["job".to_string()],
        }));
        let Value::Matrix(mut result) =
            eval_aggregate(&param, Value::Matrix(matrix), Sum, &eval_ctx).unwrap()
        else {
            panic!("expected matrix");
        };
        result.sort_by(|x, y| x.labels[0].value.cmp(&y.labels[0].value));
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0]
                .samples
                .iter()
                .map(|s| (s.timestamp, s.value))
                .collect::<Vec<_>>(),
            [(1000, 1.0), (3000, 3.0)]
        );
        assert!(result[1].samples.is_empty());
    }

    /// Runs `eval_aggregate` over a single group large enough to take the
    /// parallel chunked path and returns the lone aggregated value.
    fn eval_chunked_single_group<F: AggFunc>(values: &[f64], func: F) -> f64 {
        assert!(values.len() >= 2 * AGG_PARALLEL_CHUNK);
        let ts = 1000;
        let matrix: Vec<RangeValue> = values
            .iter()
            .map(|&v| RangeValue {
                labels: Labels::default(),
                samples: vec![Sample::new(ts, v)],
                exemplars: None,
                time_window: None,
            })
            .collect();
        let eval_ctx = EvalContext::new(ts, ts + 1, 1, "test".to_string());
        match eval_aggregate(&None, Value::Matrix(matrix), func, &eval_ctx).unwrap() {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                m[0].samples
                    .iter()
                    .find(|s| s.timestamp == ts)
                    .expect("sample at eval timestamp")
                    .value
            }
            _ => panic!("Expected Matrix"),
        }
    }

    #[test]
    fn test_eval_aggregate_chunked_sum_avg_numerically_safe() {
        // Catastrophic cancellation across chunk boundaries: a naive chunked
        // merge collapses `1e16 ... -1e16 ... 1.0` to 0.0 because the lone
        // 1.0 is rounded away inside the second chunk's partial sum. The
        // Kahan-compensated state must preserve it, matching the sequential
        // fold.
        let n = 2 * AGG_PARALLEL_CHUNK + 1;
        let mut values = vec![0.0; n];
        values[0] = 1e16;
        values[AGG_PARALLEL_CHUNK + 100] = -1e16;
        values[AGG_PARALLEL_CHUNK + 200] = 1.0;

        assert_eq!(eval_chunked_single_group(&values, Sum), 1.0);
        assert_eq!(eval_chunked_single_group(&values, Avg), 1.0 / n as f64);

        // An infinite partial sum must stay +Inf through the merge instead of
        // degrading to NaN via `Inf - Inf` in the compensation term.
        let mut values = vec![1.0; n];
        values[0] = f64::INFINITY;
        assert_eq!(eval_chunked_single_group(&values, Sum), f64::INFINITY);

        // Residuals surviving in the compensation term must themselves be
        // merged with compensation: a plain `c + other_c` add rounds them
        // away before the main sums cancel. Four chunks whose partials are
        // (1e32, 2), (-2e16, 0), (-1e32, 1e16), (1e16 - 4, 0); the exact sum
        // is -2 and only compensated merging of both components keeps it.
        let n = 4 * AGG_PARALLEL_CHUNK;
        let mut values = vec![0.0; n];
        values[0] = 2.0;
        values[1] = 1e32;
        values[AGG_PARALLEL_CHUNK] = -1e16;
        values[AGG_PARALLEL_CHUNK + 1] = -1e16;
        values[2 * AGG_PARALLEL_CHUNK] = -1e32;
        values[2 * AGG_PARALLEL_CHUNK + 1] = 1e16;
        values[3 * AGG_PARALLEL_CHUNK] = 1e16;
        values[3 * AGG_PARALLEL_CHUNK + 1] = -4.0;

        assert_eq!(eval_chunked_single_group(&values, Sum), -2.0);
        assert_eq!(eval_chunked_single_group(&values, Avg), -2.0 / n as f64);
    }

    #[test]
    fn test_labels_to_exclude_removes_name_label() {
        let actual_labels = create_test_labels();
        let exclude_labels = vec!["instance".to_string()];

        let result = labels_to_exclude(&exclude_labels, actual_labels.clone());

        // Should not contain __name__ label (which is NAME_LABEL)
        assert!(!result.iter().any(|l| l.name == "__name__"));
    }

    #[test]
    fn test_labels_to_include_empty_include_list() {
        let actual_labels = create_test_labels();
        let result = labels_to_include(&[], actual_labels);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_labels_to_exclude_empty_exclude_list() {
        let actual_labels = create_test_labels();
        let result = labels_to_exclude(&[], actual_labels);
        // NAME_LABEL (__name__) is always excluded
        assert!(!result.iter().any(|l| l.name == "__name__"));
        assert!(result.iter().any(|l| l.name == "instance"));
        assert!(result.iter().any(|l| l.name == "job"));
    }

    #[test]
    fn test_projected_labels_signature_matches_materialized_projection() {
        use promql_parser::label::Labels as ParserLabels;

        let labels = vec![
            Arc::new(Label::new("__name__", "requests_total")),
            Arc::new(Label::new("env", "prod")),
            Arc::new(Label::new("job", "api")),
            Arc::new(Label::new("zone", "east")),
        ];
        let modifiers = vec![
            None,
            Some(LabelModifier::Include(ParserLabels { labels: vec![] })),
            Some(LabelModifier::Include(ParserLabels {
                labels: vec!["job".to_string(), "missing".to_string()],
            })),
            Some(LabelModifier::Exclude(ParserLabels { labels: vec![] })),
            Some(LabelModifier::Exclude(ParserLabels {
                labels: vec!["env".to_string(), "missing".to_string()],
            })),
        ];

        for modifier in modifiers {
            let expected = match &modifier {
                Some(LabelModifier::Include(include)) => {
                    labels_to_include(&include.labels, labels.clone())
                }
                Some(LabelModifier::Exclude(exclude)) => {
                    labels_to_exclude(&exclude.labels, labels.clone())
                }
                None => vec![],
            };
            assert_eq!(projected_labels(&modifier, &labels), expected);
            assert_eq!(
                projected_labels_signature(&modifier, &labels),
                expected.signature()
            );
        }
    }

    #[test]
    fn test_group_series_by_labels_none_modifier() {
        use std::time::Duration;

        use config::meta::promql::value::TimeWindow;

        let labels1 = vec![Arc::new(Label::new("job", "a"))];
        let labels2 = vec![Arc::new(Label::new("job", "b"))];
        let matrix = vec![
            RangeValue {
                labels: labels1,
                samples: vec![Sample::new(1000, 1.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    range: Duration::from_secs(1),
                    offset: Duration::ZERO,
                }),
            },
            RangeValue {
                labels: labels2,
                samples: vec![Sample::new(1000, 2.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    range: Duration::from_secs(1),
                    offset: Duration::ZERO,
                }),
            },
        ];

        // None modifier → all labels stripped → all series get same empty-labels hash
        let groups = group_series_by_labels(&matrix, &None);
        assert_eq!(groups.len(), 1);
        let indices = groups.values().next().unwrap();
        assert_eq!(indices.len(), 2);
    }

    #[test]
    fn test_group_series_by_labels_include_modifier() {
        use std::time::Duration;

        use config::meta::promql::value::TimeWindow;
        use promql_parser::label::Labels as ParserLabels;

        let labels_a = vec![
            Arc::new(Label::new("job", "api")),
            Arc::new(Label::new("env", "prod")),
        ];
        let labels_b = vec![
            Arc::new(Label::new("job", "api")),
            Arc::new(Label::new("env", "staging")),
        ];
        let matrix = vec![
            RangeValue {
                labels: labels_a,
                samples: vec![Sample::new(1000, 1.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    range: Duration::from_secs(1),
                    offset: Duration::ZERO,
                }),
            },
            RangeValue {
                labels: labels_b,
                samples: vec![Sample::new(1000, 2.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    range: Duration::from_secs(1),
                    offset: Duration::ZERO,
                }),
            },
        ];

        // Include only "job" → both series have same "job=api" → 1 group
        let modifier = Some(LabelModifier::Include(ParserLabels {
            labels: vec!["job".to_string()],
        }));
        let groups = group_series_by_labels(&matrix, &modifier);
        assert_eq!(groups.len(), 1);
    }
}
