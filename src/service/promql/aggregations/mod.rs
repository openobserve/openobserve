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

use config::meta::promql::NAME_LABEL;
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::service::promql::value::{
    EvalContext, Label, Labels, LabelsExt, RangeValue, Sample, Value,
};

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

pub(crate) use avg::avg_range;
pub(crate) use bottomk::bottomk_range;
pub(crate) use count::count_range;
pub(crate) use count_values::count_values_range;
pub(crate) use group::group_range;
pub(crate) use max::max_range;
pub(crate) use min::min_range;
pub(crate) use quantile::quantile_range;
pub(crate) use stddev::stddev_range;
pub(crate) use stdvar::stdvar_range;
pub(crate) use sum::sum_range;
pub(crate) use topk::topk_range;

pub trait AggFunc: Sync {
    fn name(&self) -> &'static str;
    fn build(&self) -> Box<dyn Accumulate>;
}

pub trait Accumulate: Sync {
    fn accumulate(&mut self, sample: &Sample);

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
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();

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
pub(crate) fn eval_arithmetic_range<F>(
    param: &Option<LabelModifier>,
    data: Value,
    func: F,
    eval_ctx: &EvalContext,
) -> Result<Value>
where
    F: AggFunc,
{
    let start = std::time::Instant::now();
    let func_name = func.name();
    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) started",
        eval_ctx.trace_id,
    );

    // Handle Matrix input for range queries
    let matrix = match data {
        Value::Matrix(m) => m,
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
    let eval_timestamps: ahash::HashSet<i64> = eval_timestamps.iter().cloned().collect();

    if eval_timestamps.is_empty() {
        return Ok(Value::None);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) processing {} time points",
        eval_ctx.trace_id,
        eval_timestamps.len()
    );

    // For each eval timestamp, aggregate across all series
    // Parallelize processing using query_thread_num
    let cfg = config::get_config();
    let thread_num = cfg.limit.query_thread_num;
    let chunk_size = (eval_timestamps.len() / thread_num).max(1);
    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) using {} threads with chunk_size {}",
        eval_ctx.trace_id,
        thread_num,
        chunk_size
    );

    let start1 = std::time::Instant::now();

    // Step 1: Compute label hash for each series once based on param
    // This avoids recomputing the hash for every timestamp
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
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) computed label hashes in {:?}",
        eval_ctx.trace_id,
        start1.elapsed()
    );

    let start2 = std::time::Instant::now();

    // Step 2: Group series indices by their label hash
    // Build index: label_hash -> Vec<series_idx>
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for (series_idx, (hash, _)) in series_label_hashes.iter().enumerate() {
        groups.entry(*hash).or_default().push(series_idx);
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) built {} groups in {:?}",
        eval_ctx.trace_id,
        groups.len(),
        start2.elapsed()
    );

    let start3 = std::time::Instant::now();

    // Step 3: Process each group in parallel
    // For each group, aggregate all samples across timestamps
    let results: Vec<(u64, Labels, Vec<Sample>)> = groups
        .par_iter()
        .map(|(hash, series_indices)| {
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

            (*hash, labels, samples)
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) parallel aggregation took: {:?}",
        eval_ctx.trace_id,
        start3.elapsed()
    );

    let start4 = std::time::Instant::now();

    // Step 4: Convert results to final format
    let mut result_by_labels: HashMap<u64, (Labels, Vec<Sample>)> = HashMap::new();
    for (hash, labels, samples) in results {
        if !samples.is_empty() {
            result_by_labels.insert(hash, (labels, samples));
        }
    }

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) final conversion took: {:?}",
        eval_ctx.trace_id,
        start4.elapsed()
    );

    if result_by_labels.is_empty() {
        return Ok(Value::None);
    }

    let result_matrix: Vec<RangeValue> = result_by_labels
        .into_values()
        .map(|(labels, samples)| RangeValue {
            labels,
            samples,
            exemplars: None,
            time_window: None,
        })
        .collect();

    log::info!(
        "[trace_id: {}] [PromQL Timing] eval_arithmetic_range({func_name}) completed in {:?}, produced {} series",
        eval_ctx.trace_id,
        start.elapsed(),
        result_matrix.len()
    );
    Ok(Value::Matrix(result_matrix))
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
