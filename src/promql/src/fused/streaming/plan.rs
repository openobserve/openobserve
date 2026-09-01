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

//! Band plan construction: hash-space partitioning, ordered chain streams,
//! and the plan-shape gates that guard the streaming path.

use std::sync::Arc;

use config::meta::promql::HASH_LABEL;
use datafusion::{
    error::Result,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_plan::{
        ExecutionPlan, execute_stream, execute_stream_partitioned,
        expressions::Column,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
    prelude::{DataFrame, col, lit},
};

/// Uniform partition of the u64 hash space into `count` inclusive ranges.
pub(super) fn hash_bands(count: usize) -> Vec<(u64, u64)> {
    let count = count.max(1) as u128;
    let span = (u64::MAX as u128) + 1;
    (0..count)
        .map(|band| {
            let lo = (span * band / count) as u64;
            let hi = (span * (band + 1) / count - 1) as u64;
            (lo, hi)
        })
        .collect()
}

/// Builds every band's ordered input streams; `None` (with the offending band
/// logged) means some band's plan cannot stream in order.
pub(super) async fn build_band_inputs(
    df: &DataFrame,
    columns: &[&str],
    bands: usize,
    trace_id: &str,
) -> Result<Option<(Vec<Vec<SendableRecordBatchStream>>, Arc<dyn ExecutionPlan>)>> {
    let mut band_inputs = Vec::with_capacity(bands);
    let mut band0_plan = None;
    for (band, (lo, hi)) in hash_bands(bands).into_iter().enumerate() {
        let band_df = df
            .clone()
            .filter(
                col(HASH_LABEL)
                    .gt_eq(lit(lo))
                    .and(col(HASH_LABEL).lt_eq(lit(hi))),
            )?
            .select_columns(columns)?
            // planning-only: proves the scan partitions hash-ordered; fold_band merges, not the SPM
            .sort(vec![col(HASH_LABEL).sort(true, false)])?;
        let task_ctx = Arc::new(band_df.task_ctx());
        let plan = band_df.create_physical_plan().await?;
        let Some(streams) = band_streams(plan.clone(), task_ctx)? else {
            log::info!(
                "[trace_id: {trace_id}] [PromQL] streaming fused agg fallback: band {band} plan cannot stream in order"
            );
            return Ok(None);
        };
        band0_plan.get_or_insert(plan);
        band_inputs.push(streams);
    }
    let band0_plan = band0_plan.expect("target_partitions is at least one band");
    Ok(Some((band_inputs, band0_plan)))
}

/// The hash-ordered inputs a band folds from: the merge's own child
/// partitions, so the row-level merge node itself is never executed.
fn band_streams(
    plan: Arc<dyn ExecutionPlan>,
    task_ctx: Arc<TaskContext>,
) -> Result<Option<Vec<SendableRecordBatchStream>>> {
    if plan_contains_sort(&plan) {
        return Ok(None);
    }
    if let Some(merge) = plan.downcast_ref::<SortPreservingMergeExec>() {
        return Ok(Some(execute_stream_partitioned(
            merge.input().clone(),
            task_ctx,
        )?));
    }
    if plan.properties().output_partitioning().partition_count() == 1 && hash_ordered(&plan) {
        return Ok(Some(vec![execute_stream(plan, task_ctx)?]));
    }
    Ok(None)
}

fn plan_contains_sort(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.downcast_ref::<SortExec>().is_some()
        || plan
            .children()
            .iter()
            .any(|child| plan_contains_sort(child))
}

fn hash_ordered(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.properties().output_ordering().is_some_and(|ordering| {
        let sort = ordering.first();
        !sort.options.descending
            && sort
                .expr
                .downcast_ref::<Column>()
                .is_some_and(|column| column.name() == HASH_LABEL)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_bands_cover_the_full_space_contiguously() {
        for count in [1, 3, 7, 16] {
            let bands = hash_bands(count);
            assert_eq!(bands.len(), count);
            assert_eq!(bands[0].0, 0);
            assert_eq!(bands[count - 1].1, u64::MAX);
            for pair in bands.windows(2) {
                assert_eq!(pair[0].1.wrapping_add(1), pair[1].0);
            }
        }
    }
}
