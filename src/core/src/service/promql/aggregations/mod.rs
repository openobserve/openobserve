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
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

mod avg;
mod bottomk;
mod count;
mod count_values;
mod group;
mod max;
mod min;
mod quantile;
mod stddev;
mod stdvar;
mod sum;
mod topk;

pub(crate) use avg::avg;
pub(crate) use bottomk::bottomk;
pub(crate) use count::count;
pub(crate) use count_values::count_values;
pub(crate) use group::group;
pub(crate) use max::max;
pub(crate) use min::min;
pub(crate) use quantile::quantile;
pub(crate) use stddev::stddev;
pub(crate) use stdvar::stdvar;
pub(crate) use sum::sum;
pub(crate) use topk::topk;

/// Series per parallel partial-aggregation chunk when a single group is large.
const AGG_PARALLEL_CHUNK: usize = 32768;

/// Trait for PromQL aggregation functions.
///
/// This trait defines the interface for aggregation functions (e.g., sum, avg, max, min, topk)
/// used in PromQL query evaluation. Each aggregation function implements this trait to provide
/// its name and create accumulator instances for processing time series data.
///
/// # Examples
///
/// ```ignore
/// struct SumAgg;
///
/// impl AggFunc for SumAgg {
///     fn name(&self) -> &'static str {
///         "sum"
///     }
///
///     fn build(&self) -> Box<dyn Accumulate> {
///         Box::new(SumAccumulator::new())
///     }
/// }
/// ```
pub trait AggFunc: Sync {
    /// Returns the name of the aggregation function (e.g., "sum", "avg", "max").
    fn name(&self) -> &'static str;

    /// Creates a new accumulator instance for this aggregation function.
    ///
    /// Each call to `build()` should return a fresh accumulator that can independently
    /// collect and aggregate samples. This allows for parallel processing of multiple
    /// label groups.
    fn build(&self) -> Box<dyn Accumulate>;

    /// Whether a huge group may be split into parallel chunks whose partial
    /// accumulators are combined with [`Accumulate::merge`]. Value-buffering
    /// accumulators (quantile/stddev/stdvar) opt out: each reduction level
    /// re-copies every buffered sample, costing `O(N log P)` copying and extra
    /// transient memory versus the sequential append.
    fn mergeable(&self) -> bool {
        true
    }
}

/// Trait for accumulating and aggregating time series samples.
///
/// This trait defines the interface for accumulators that collect samples from one or more
/// time series and compute aggregated results. Accumulators are created by [`AggFunc::build()`]
/// and are used to process samples in a stateful manner.
///
/// The typical lifecycle is:
/// 1. Create accumulator via `AggFunc::build()`
/// 2. Call `accumulate()` for each sample to include in the aggregation
/// 3. Call `evaluate()` to compute and return the final aggregated samples
///
/// # Examples
///
/// ```ignore
/// let mut acc = sum_agg.build();
/// for sample in samples {
///     acc.accumulate(&sample);
/// }
/// let results = acc.evaluate();
/// ```
pub trait Accumulate: Send + Sync {
    /// Adds a sample to this accumulator.
    ///
    /// This method is called for each sample that should be included in the aggregation.
    /// The accumulator maintains internal state to track the accumulated values across
    /// all samples.
    ///
    /// # Parameters
    ///
    /// * `sample` - The sample to accumulate, containing a timestamp and value
    fn accumulate(&mut self, sample: &Sample);

    /// Folds another accumulator of the same type into this one, as if all of
    /// its samples had been accumulated here. Lets a large group be
    /// aggregated in parallel chunks whose partials are merged at the end.
    ///
    /// Floating-point caveat: if a partial sum overflows to ±Inf, merging
    /// opposite infinities yields NaN where a sequential fold may yield ±Inf.
    /// Summing such inputs is inherently order-dependent (sequentially,
    /// `MAX, -MAX, MAX, -MAX` gives 0 while `MAX, MAX, -MAX, -MAX` gives
    /// +Inf), so no chunking-independent result exists; NaN at least signals
    /// the Inf - Inf cancellation.
    ///
    /// # Panics
    ///
    /// Panics if `other` is a different accumulator type.
    fn merge(&mut self, other: Box<dyn Accumulate>);

    /// Upcast used by [`Self::merge`] implementations to downcast `other` to
    /// their own concrete type.
    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any>;

    /// Computes and returns the final aggregated results.
    ///
    /// This method consumes the accumulator (takes ownership via `Box<Self>`) and produces
    /// the final aggregated samples. The returned vector typically contains one sample per
    /// unique timestamp that was accumulated.
    ///
    /// # Returns
    ///
    /// A vector of samples representing the aggregated results
    fn evaluate(self: Box<Self>) -> Vec<Sample>;
}

pub fn labels_to_include(
    include_labels: &[String],
    mut actual_labels: Vec<Arc<Label>>,
) -> Vec<Arc<Label>> {
    actual_labels.retain(|label| include_labels.contains(&label.name));
    actual_labels
}

pub fn labels_to_exclude(
    exclude_labels: &[String],
    mut actual_labels: Vec<Arc<Label>>,
) -> Vec<Arc<Label>> {
    actual_labels.retain(|label| !exclude_labels.contains(&label.name) && label.name != NAME_LABEL);
    actual_labels
}

/// Projects a series' labels onto the grouping set of the label modifier
/// (`by(...)` keeps them, `without(...)` drops them, none drops all).
fn projected_labels(modifier: &Option<LabelModifier>, labels: &Labels) -> Labels {
    match modifier {
        Some(LabelModifier::Include(include)) => labels_to_include(&include.labels, labels.clone()),
        Some(LabelModifier::Exclude(exclude)) => labels_to_exclude(&exclude.labels, labels.clone()),
        None => Labels::default(),
    }
}

/// Compute the signature of the projected labels without cloning the label
/// vector and retaining it first. Label order and filtering exactly match
/// [`projected_labels`], so the grouping key is unchanged.
fn projected_labels_signature(modifier: &Option<LabelModifier>, labels: &Labels) -> u64 {
    let mut hasher = gxhash::new_hasher();
    for label in labels {
        let keep = match modifier {
            Some(LabelModifier::Include(include)) => include.labels.contains(&label.name),
            Some(LabelModifier::Exclude(exclude)) => {
                !exclude.labels.contains(&label.name) && label.name != NAME_LABEL
            }
            None => false,
        };
        if keep {
            hasher.write(label.name.as_bytes());
            hasher.write(label.value.as_bytes());
        }
    }
    hasher.finish()
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

    // Use the eval timestamps from the context to ensure consistent alignment
    let eval_timestamps = eval_ctx.timestamps();
    let eval_timestamps: hashbrown::HashSet<i64> = eval_timestamps.iter().cloned().collect();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) processing {} time points",
        eval_timestamps.len()
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
        .map(|(_, series_indices)| {
            // Get the labels for this group (from the first series in the group)
            let labels = projected_labels(param, &matrix[series_indices[0]].labels);

            let accumulate_chunk = |chunk: &[usize]| {
                let mut acc = func.build();
                for &series_idx in chunk {
                    for sample in &matrix[series_idx].samples {
                        // Only include timestamps that are in eval_timestamps
                        if eval_timestamps.contains(&sample.timestamp) {
                            acc.accumulate(sample);
                        }
                    }
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
                        || func.build(),
                        |mut a, b| {
                            a.merge(b);
                            a
                        },
                    )
            } else {
                accumulate_chunk(series_indices)
            };

            // Evaluate the aggregated results
            let mut samples = acc.evaluate();

            // Sort by timestamp to maintain order
            samples.sort_by_key(|s| s.timestamp);

            RangeValue {
                labels,
                samples,
                exemplars: None,
                time_window: None,
            }
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

    #[test]
    fn test_accumulate_merge_matches_sequential() {
        use super::{avg::Avg, count::Count, group::Group, max::Max, min::Min, sum::Sum};

        // Integer values keep float addition exact regardless of order.
        let part_a = [(1000, 3.0), (2000, 5.0), (1000, 7.0)];
        let part_b = [(2000, 11.0), (3000, 2.0), (1000, 4.0)];

        let funcs: Vec<Box<dyn AggFunc>> = vec![
            Box::new(Sum),
            Box::new(Count),
            Box::new(Min),
            Box::new(Max),
            Box::new(Avg),
            Box::new(Group),
        ];
        for func in funcs {
            let mut sequential = func.build();
            let mut acc_a = func.build();
            let mut acc_b = func.build();
            for &(ts, v) in part_a.iter() {
                sequential.accumulate(&Sample::new(ts, v));
                acc_a.accumulate(&Sample::new(ts, v));
            }
            for &(ts, v) in part_b.iter() {
                sequential.accumulate(&Sample::new(ts, v));
                acc_b.accumulate(&Sample::new(ts, v));
            }
            acc_a.merge(acc_b);

            let mut expected = sequential.evaluate();
            let mut merged = acc_a.evaluate();
            expected.sort_by_key(|s| s.timestamp);
            merged.sort_by_key(|s| s.timestamp);
            assert_eq!(expected.len(), merged.len(), "{}", func.name());
            for (e, m) in expected.iter().zip(merged.iter()) {
                assert_eq!(e.timestamp, m.timestamp, "{}", func.name());
                assert_eq!(e.value, m.value, "{}", func.name());
            }
        }
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
        use super::{avg::Avg, sum::Sum};

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
            assert_eq!(
                projected_labels_signature(&modifier, &labels),
                projected_labels(&modifier, &labels).signature()
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
