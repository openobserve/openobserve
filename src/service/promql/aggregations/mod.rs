// Copyright 2025 OpenObserve Inc.
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

use std::{collections::HashMap, sync::Arc};

use config::meta::promql::{
    NAME_LABEL,
    value::{EvalContext, Label, Labels, LabelsExt, RangeValue, Sample, Value},
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
pub trait Accumulate: Sync {
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

/// Groups series indices by their label signatures based on the label modifier
pub(crate) fn group_series_by_labels(
    matrix: &[RangeValue],
    modifier: &Option<LabelModifier>,
) -> HashMap<u64, Vec<usize>> {
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::with_capacity(matrix.len());

    for (idx, series) in matrix.iter().enumerate() {
        let grouped_labels = match modifier {
            Some(LabelModifier::Include(labels)) => {
                labels_to_include(&labels.labels, series.labels.clone())
            }
            Some(LabelModifier::Exclude(labels)) => {
                labels_to_exclude(&labels.labels, series.labels.clone())
            }
            None => Labels::default(),
        };
        let hash = grouped_labels.signature();
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

    // Step 1: Compute label hash for each series once based on param
    // This avoids recomputing the hash for every timestamp
    let start1 = std::time::Instant::now();
    let series_label_hashes: Vec<(u64, Labels)> = matrix
        .iter()
        .map(|rv| {
            let grouped_labels = match param {
                Some(LabelModifier::Include(labels)) => {
                    labels_to_include(&labels.labels, rv.labels.clone())
                }
                Some(LabelModifier::Exclude(labels)) => {
                    labels_to_exclude(&labels.labels, rv.labels.clone())
                }
                None => Labels::default(),
            };
            let hash = grouped_labels.signature();
            (hash, grouped_labels)
        })
        .collect();

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) computed label hashes in {:?}",
        start1.elapsed()
    );

    // Step 2: Group series indices by their label hash
    // Build index: label_hash -> Vec<series_idx>
    let start2 = std::time::Instant::now();
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for (series_idx, (hash, _)) in series_label_hashes.iter().enumerate() {
        groups.entry(*hash).or_default().push(series_idx);
    }

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] eval_aggregate({func_name}) built {} groups in {:?}",
        groups.len(),
        start2.elapsed()
    );

    // Step 3: Process each group in parallel
    // For each group, aggregate all samples across timestamps
    let start3 = std::time::Instant::now();
    let results: Vec<RangeValue> = groups
        .par_iter()
        .map(|(_, series_indices)| {
            // Get the labels for this group (from the first series in the group)
            let labels = series_label_hashes[series_indices[0]].1.clone();

            let mut acc = func.build();
            // Aggregate samples from all series in this group
            for &series_idx in series_indices {
                for sample in &matrix[series_idx].samples {
                    // Only include timestamps that are in eval_timestamps
                    if eval_timestamps.contains(&sample.timestamp) {
                        acc.accumulate(sample);
                    }
                }
            }

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

    Ok(Value::Matrix(results))
}

#[cfg(test)]
mod tests {
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
    fn test_labels_to_exclude_removes_name_label() {
        let actual_labels = create_test_labels();
        let exclude_labels = vec!["instance".to_string()];

        let result = labels_to_exclude(&exclude_labels, actual_labels.clone());

        // Should not contain __name__ label (which is NAME_LABEL)
        assert!(!result.iter().any(|l| l.name == "__name__"));
    }
}
