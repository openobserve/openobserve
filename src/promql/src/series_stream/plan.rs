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

//! Planning over a selector's hash-sorted table: the label columns to project, and one set of
//! hash-ordered input streams per partition for the hash-sorted stream to consume.

use std::sync::Arc;

use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        plan::generate_plan_string,
        promql::{
            BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, NAME_LABEL,
            VALUE_LABEL, value::EvalContext,
        },
    },
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    error::Result,
    execution::{SendableRecordBatchStream, TaskContext},
    physical_plan::{
        ExecutionPlan, execute_stream, execute_stream_partitioned,
        expressions::Column,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
    prelude::{DataFrame, SessionContext, col, lit},
};
use hashbrown::HashSet;
use promql_parser::{label::Matchers, parser::LabelModifier};

use super::hash_sorted::HashSortedSeriesStream;
use crate::{
    functions::KEEP_METRIC_NAME_FUNC,
    utils::{apply_matchers, apply_time_window},
};

/// The selector being scanned; `offset` is the `offset` modifier in microseconds.
pub(crate) struct StreamingSelector<'a> {
    pub table_name: &'a str,
    pub matchers: &'a Matchers,
    pub offset: i64,
}

/// One hash-sorted stream per partition over the selector's hash-sorted table, projected to the
/// sample columns plus `label_cols`; `None` when the layout cannot stream in order.
pub(crate) async fn execute_partitioned(
    ctx: &SessionContext,
    schema: &Schema,
    selector: &StreamingSelector<'_>,
    label_cols: Vec<String>,
    lookback: i64,
    eval_ctx: &EvalContext,
) -> Result<
    Option<Vec<impl Future<Output = Result<HashSortedSeriesStream>> + Send + 'static + use<>>>,
> {
    if schema
        .field_with_name(HASH_LABEL)
        .is_ok_and(|field| field.data_type() != &DataType::UInt64)
    {
        return Ok(None);
    }
    let sorted_table = format!("{}{HASH_SORTED_TABLE_SUFFIX}", selector.table_name);
    let Ok(df) = ctx.table(sorted_table.as_str()).await else {
        return Ok(None);
    };
    let df = apply_time_window(
        df,
        eval_ctx.start - selector.offset,
        eval_ctx.end - selector.offset,
        eval_ctx.step,
        lookback,
    )?;
    let df = apply_matchers(df, selector.matchers)?;
    let mut columns = vec![TIMESTAMP_COL_NAME, HASH_LABEL, VALUE_LABEL];
    columns.extend(label_cols.iter().map(String::as_str));
    let partitions = ctx.state().config().target_partitions();
    let Some(partition_inputs) =
        build_partition_inputs(&df, &columns, partitions, &eval_ctx.trace_id).await?
    else {
        return Ok(None);
    };
    let label_cols = Arc::new(label_cols);
    let offset = selector.offset;
    Ok(Some(
        partition_inputs
            .into_iter()
            .map(|streams| HashSortedSeriesStream::start(streams, label_cols.clone(), offset))
            .collect(),
    ))
}

/// The `by()` columns in a stable order; `None` for `without()`, which needs the full label set.
pub(crate) fn group_label_columns(
    modifier: &Option<LabelModifier>,
    schema: &Schema,
    func_name: &str,
) -> Option<Vec<String>> {
    let include = match modifier {
        None => return Some(vec![]),
        Some(LabelModifier::Include(labels)) => &labels.labels,
        Some(LabelModifier::Exclude(_)) => return None,
    };
    let mut cols: Vec<String> = include
        .iter()
        .filter(|name| {
            let name = name.as_str();
            name != TIMESTAMP_COL_NAME
                && name != HASH_LABEL
                && name != VALUE_LABEL
                && name != EXEMPLARS_LABEL
                // range functions strip the metric name before aggregation
                && (name != NAME_LABEL || KEEP_METRIC_NAME_FUNC.contains(func_name))
                && schema.field_with_name(name).is_ok()
        })
        .cloned()
        .collect();
    cols.sort();
    cols.dedup();
    Some(cols)
}

/// The label columns an emitted series carries, in the sorted order the materializing loader
/// uses: string columns other than the hash and exemplars, narrowed by the label selector
/// (which always keeps `le`), without the metric name unless the function keeps it.
pub(crate) fn series_label_columns(
    schema: &Schema,
    label_selector: &HashSet<String>,
    func_name: &str,
) -> Vec<String> {
    let mut cols: Vec<String> = schema
        .fields()
        .iter()
        .filter(|field| matches!(field.data_type(), DataType::Utf8 | DataType::Utf8View))
        .map(|field| field.name().clone())
        .filter(|name| {
            name != HASH_LABEL
                && name != EXEMPLARS_LABEL
                && (label_selector.is_empty()
                    || label_selector.contains(name)
                    || name == BUCKET_LABEL)
                && (name != NAME_LABEL || KEEP_METRIC_NAME_FUNC.contains(func_name))
        })
        .collect();
    cols.sort();
    cols
}

/// Every partition's ordered input streams; `None` (logged) means a partition's plan cannot stream
/// in order.
async fn build_partition_inputs(
    df: &DataFrame,
    columns: &[&str],
    partitions: usize,
    trace_id: &str,
) -> Result<Option<Vec<Vec<SendableRecordBatchStream>>>> {
    let mut partition_inputs = Vec::with_capacity(partitions);
    for (partition, (lo, hi)) in hash_partitions(partitions).into_iter().enumerate() {
        let partition_df = df
            .clone()
            .filter(
                col(HASH_LABEL)
                    .gt_eq(lit(lo))
                    .and(col(HASH_LABEL).lt_eq(lit(hi))),
            )?
            .select_columns(columns)?
            // planning-only: proves the scan partitions hash-ordered; the partition stream merges, not the SPM
            .sort(vec![col(HASH_LABEL).sort(true, false)])?;
        let task_ctx = Arc::new(partition_df.task_ctx());
        let plan = partition_df.create_physical_plan().await?;

        // the partitions only differ in their hash interval, so one plan speaks for all
        if partition == 0 && config::get_config().common.print_key_sql {
            log::info!("{}", generate_plan_string(trace_id, plan.as_ref()));
        }

        let Some(streams) = partition_streams(plan.clone(), task_ctx)? else {
            log::info!(
                "[trace_id: {trace_id}] [PromQL] streaming fused agg fallback: partition {partition} plan cannot stream in order:\n{}",
                generate_plan_string(trace_id, plan.as_ref())
            );
            return Ok(None);
        };
        partition_inputs.push(streams);
    }
    Ok(Some(partition_inputs))
}

/// Uniform partition of the u64 hash space into `count` inclusive ranges.
fn hash_partitions(count: usize) -> Vec<(u64, u64)> {
    let count = count.max(1) as u128;
    let span = (u64::MAX as u128) + 1;
    (0..count)
        .map(|partition| {
            let lo = (span * partition / count) as u64;
            let hi = (span * (partition + 1) / count - 1) as u64;
            (lo, hi)
        })
        .collect()
}

/// The merge node's own child partitions, so the row-level merge itself is never executed.
fn partition_streams(
    plan: Arc<dyn ExecutionPlan>,
    task_ctx: Arc<TaskContext>,
) -> Result<Option<Vec<SendableRecordBatchStream>>> {
    if plan_contains_sort(&plan) {
        return Ok(None);
    }
    // a partition whose pruning dropped every file scans nothing: zero chains
    if plan.properties().output_partitioning().partition_count() == 0 {
        return Ok(Some(vec![]));
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
    use std::time::Duration;

    use datafusion::{
        arrow::datatypes::Field, datasource::MemTable, physical_plan::empty::EmptyExec,
    };
    use promql_parser::label::Labels as ModifierLabels;

    use super::{super::tests::*, *};
    use crate::streaming_eval::{FusedAggOp, tests::by};

    #[test]
    fn test_group_label_columns_resolution() {
        let schema = arrow_schema();
        assert_eq!(group_label_columns(&None, &schema, "rate"), Some(vec![]));
        assert_eq!(
            group_label_columns(&by(&["path", "instance", "path"]), &schema, "rate"),
            Some(vec!["instance".to_string(), "path".to_string()])
        );
        // absent columns group like an absent label: no column to read
        assert_eq!(
            group_label_columns(&by(&["nope", HASH_LABEL, VALUE_LABEL]), &schema, "rate"),
            Some(vec![])
        );
        // rate strips the metric name; last_over_time keeps it (not in schema here)
        assert_eq!(
            group_label_columns(&by(&[NAME_LABEL]), &schema, "rate"),
            Some(vec![])
        );
        let without = Some(LabelModifier::Exclude(ModifierLabels {
            labels: vec!["instance".to_string()],
        }));
        assert_eq!(group_label_columns(&without, &schema, "rate"), None);
    }

    #[test]
    fn test_series_label_columns_follow_the_loader() {
        let schema = Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("path", DataType::Utf8View, true),
            Field::new(NAME_LABEL, DataType::Utf8, true),
            Field::new(BUCKET_LABEL, DataType::Utf8, true),
            Field::new("instance", DataType::Utf8, true),
            Field::new(EXEMPLARS_LABEL, DataType::Utf8, true),
        ]);
        let all = HashSet::new();
        assert_eq!(
            series_label_columns(&schema, &all, "rate"),
            ["instance", "le", "path"]
        );
        // last_over_time keeps the metric name, like an offset would
        assert_eq!(
            series_label_columns(&schema, &all, "last_over_time"),
            [NAME_LABEL, "instance", "le", "path"]
        );
        let selected: HashSet<String> = ["path".to_string()].into_iter().collect();
        assert_eq!(
            series_label_columns(&schema, &selected, "rate"),
            ["le", "path"]
        );
    }

    #[test]
    fn test_shard_streams_empty_scan_yields_zero_chains() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            HASH_LABEL,
            DataType::UInt64,
            false,
        )]));
        let plan = Arc::new(EmptyExec::new(schema).with_partitions(0));
        let streams = partition_streams(plan, Arc::new(TaskContext::default())).unwrap();
        assert_eq!(streams.map(|streams| streams.len()), Some(0));
    }

    #[test]
    fn test_hash_shards_cover_the_full_space_contiguously() {
        for count in [1, 3, 7, 16] {
            let partitions = hash_partitions(count);
            assert_eq!(partitions.len(), count);
            assert_eq!(partitions[0].0, 0);
            assert_eq!(partitions[count - 1].1, u64::MAX);
            for pair in partitions.windows(2) {
                assert_eq!(pair[0].1.wrapping_add(1), pair[1].0);
            }
        }
    }

    #[tokio::test]
    async fn test_streaming_falls_back_without_sorted_table() {
        let ctx = session_ctx();
        let table = MemTable::try_new(arrow_schema(), sorted_partitions()).unwrap();
        ctx.register_table("m", Arc::new(table)).unwrap();

        let result = run_streaming(
            &ctx,
            &None,
            "rate",
            FusedAggOp::Sum,
            Duration::from_secs(60),
        )
        .await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_streaming_falls_back_when_ordering_is_not_declared() {
        let ctx = session_ctx();
        // same data registered under the sorted name but without the ordering
        // declaration: the plan needs a real sort, so the gate must reject it
        let table = MemTable::try_new(arrow_schema(), sorted_partitions()).unwrap();
        ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
            .unwrap();

        let result = run_streaming(
            &ctx,
            &None,
            "rate",
            FusedAggOp::Sum,
            Duration::from_secs(60),
        )
        .await;
        assert!(result.is_none());
    }
}
