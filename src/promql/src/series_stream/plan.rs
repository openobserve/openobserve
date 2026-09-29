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
            BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, MetricsBlockScan,
            NAME_LABEL, VALUE_LABEL, value::EvalContext,
        },
    },
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    error::{DataFusionError, Result},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_plan::{
        ExecutionPlan, execute_stream_partitioned,
        expressions::Column,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
    prelude::{DataFrame, SessionContext, col, lit},
};
use futures::future::BoxFuture;
use hashbrown::HashSet;
use promql_parser::{label::Matchers, parser::LabelModifier};
use tokio::task::JoinSet;

use super::{SeriesSource, blocks, hash_sorted::HashSortedSeriesStream};
use crate::{
    aggregations::AggOp,
    functions::KEEP_METRIC_NAME_FUNC,
    utils::{apply_matchers, apply_time_window},
};

type SourceFuture = BoxFuture<'static, Result<SeriesSource>>;

/// The selector being scanned; `offset` is the `offset` modifier in microseconds.
pub(crate) struct StreamingSelector<'a> {
    pub table_name: &'a str,
    pub matchers: &'a Matchers,
    pub offset: i64,
}

/// The label columns a stream reads: `group` keys the series it yields, `series` is what its
/// labels carry. The same set for a scalar aggregation; a ranking keys by the `by()` columns
/// but carries every label column.
pub(crate) struct LabelColumns {
    pub group: Vec<String>,
    pub series: Vec<String>,
}

impl LabelColumns {
    /// Series keyed and labelled by the same columns.
    pub(crate) fn grouped(cols: Vec<String>) -> Self {
        Self {
            group: cols.clone(),
            series: cols,
        }
    }

    /// The columns an aggregation reads: keyed by the `by()` columns, carrying every label
    /// column when the output keeps the series' own labels; `None` when the modifier cannot be
    /// keyed by columns.
    pub(crate) fn for_op(
        op: &AggOp,
        modifier: &Option<LabelModifier>,
        schema: &Schema,
        label_selector: &HashSet<String>,
        func_name: &str,
    ) -> Option<Self> {
        let group = group_label_columns(modifier, schema, func_name)?;
        Some(if op.needs_series_labels() {
            Self {
                group,
                series: series_label_columns(schema, label_selector, func_name),
            }
        } else {
            Self::grouped(group)
        })
    }
}

struct PlannedPartition {
    plan: Arc<dyn ExecutionPlan>,
    task_ctx: Arc<TaskContext>,
}

pub(crate) async fn execute_partitioned(
    ctx: &SessionContext,
    schema: &Schema,
    selector: &StreamingSelector<'_>,
    label_cols: LabelColumns,
    lookback: i64,
    eval_ctx: &EvalContext,
) -> Result<Option<Vec<SourceFuture>>> {
    if schema
        .field_with_name(HASH_LABEL)
        .is_ok_and(|field| field.data_type() != &DataType::UInt64)
    {
        return Ok(None);
    }
    let label_cols = Arc::new(label_cols);
    let partitions = ctx.state().config().target_partitions();
    if let Some(scan) = ctx.state().config().get_extension::<MetricsBlockScan>()
        && scan.table_name == selector.table_name
        && blocks::query_window(eval_ctx, selector.offset, lookback).is_some()
    {
        let intervals = hash_partitions(partitions).collect::<Vec<_>>();
        let prepared = blocks::prepare(
            &scan,
            selector.matchers,
            Arc::clone(&label_cols),
            &intervals,
            selector.offset,
            lookback,
            eval_ctx,
        )
        .await
        .map_err(|error| DataFusionError::External(error.into()))?;
        return Ok(Some(
            prepared
                .into_iter()
                .map(|partition| {
                    Box::pin(async move {
                        Ok(SeriesSource::Block(blocks::BlockSeriesStream::new(
                            partition,
                        )))
                    }) as SourceFuture
                })
                .collect(),
        ));
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
    for name in label_cols.group.iter().chain(&label_cols.series) {
        if !columns.contains(&name.as_str()) {
            columns.push(name);
        }
    }
    let Some(partition_inputs) =
        build_partition_inputs(&df, &columns, partitions, &eval_ctx.trace_id).await?
    else {
        return Ok(None);
    };
    let offset = selector.offset;
    Ok(Some(
        partition_inputs
            .into_iter()
            .map(|streams| {
                let columns = Arc::clone(&label_cols);
                Box::pin(async move {
                    HashSortedSeriesStream::start(streams, columns, offset)
                        .await
                        .map(SeriesSource::DataFusion)
                }) as SourceFuture
            })
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
                && (name != NAME_LABEL || func_name == KEEP_METRIC_NAME_FUNC)
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
                && (name != NAME_LABEL || func_name == KEEP_METRIC_NAME_FUNC)
        })
        .collect();
    cols.sort();
    cols
}

async fn build_partition_inputs(
    df: &DataFrame,
    columns: &[&str],
    partitions: usize,
    trace_id: &str,
) -> Result<Option<Vec<Vec<SendableRecordBatchStream>>>> {
    let (mut state, logical_plan) = df.clone().into_parts();
    // Outer hash shards provide parallelism; keep each shard's ordered scan chains intact.
    state
        .config_mut()
        .options_mut()
        .optimizer
        .repartition_file_scans = false;
    let df = DataFrame::new(state, logical_plan);
    let columns: Arc<[String]> = columns.iter().map(|name| (*name).to_string()).collect();
    let plans = hash_partitions(partitions).map(|(lo, hi)| {
        let df = df.clone();
        let columns = Arc::clone(&columns);
        async move {
            let columns: Vec<_> = columns.iter().map(String::as_str).collect();
            let partition_df = df
                .filter(
                    col(HASH_LABEL)
                        .gt_eq(lit(lo))
                        .and(col(HASH_LABEL).lt_eq(lit(hi))),
                )?
                .select_columns(&columns)?
                // Planning-only: proves the input chains hash-ordered; the series stream merges them.
                .sort(vec![col(HASH_LABEL).sort(true, false)])?;
            let task_ctx = Arc::new(partition_df.task_ctx());
            let plan = partition_df.create_physical_plan().await?;
            Ok(PlannedPartition { plan, task_ctx })
        }
    });
    let plans = collect_plans(plans, partitions).await?;
    execute_planned_partitions(plans, trace_id)
}

async fn collect_plans<T, F>(
    plans: impl IntoIterator<Item = F>,
    concurrency: usize,
) -> Result<Vec<T>>
where
    T: Send + 'static,
    F: Future<Output = Result<T>> + Send + 'static,
{
    let mut plans = plans.into_iter().enumerate();
    let mut results = Vec::new();
    let mut tasks = JoinSet::new();
    for _ in 0..concurrency.max(1) {
        let Some((index, plan)) = plans.next() else {
            break;
        };
        results.push(None);
        tasks.spawn(async move { (index, plan.await) });
    }
    while let Some(joined) = tasks.join_next().await {
        let result = match joined {
            Ok((index, plan)) => plan.map(|plan| (index, plan)),
            Err(error) => Err(DataFusionError::Execution(format!(
                "shard planning task failed: {error}"
            ))),
        };
        match result {
            Ok((index, plan)) => results[index] = Some(plan),
            Err(error) => {
                tasks.shutdown().await;
                return Err(error);
            }
        }
        if let Some((index, plan)) = plans.next() {
            results.push(None);
            tasks.spawn(async move { (index, plan.await) });
        }
    }
    Ok(results
        .into_iter()
        .map(|plan| plan.expect("every dispatched plan joined"))
        .collect())
}

fn execute_planned_partitions(
    plans: Vec<PlannedPartition>,
    trace_id: &str,
) -> Result<Option<Vec<Vec<SendableRecordBatchStream>>>> {
    let mut inputs = Vec::with_capacity(plans.len());
    for (partition, PlannedPartition { plan, task_ctx }) in plans.into_iter().enumerate() {
        if partition == 0 && config::get_config().common.print_key_sql {
            log::info!("{}", generate_plan_string(trace_id, plan.as_ref()));
        }
        let Some(input) = ordered_partition_input(&plan) else {
            log::info!(
                "[trace_id: {trace_id}] [PromQL] streaming fused agg fallback: partition {partition} plan cannot stream in order:\n{}",
                generate_plan_string(trace_id, plan.as_ref())
            );
            return Ok(None);
        };
        inputs.push((input, task_ctx));
    }
    inputs
        .into_iter()
        .map(|(plan, task_ctx)| execute_stream_partitioned(plan, task_ctx))
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

/// Uniform partition of the u64 hash space into `count` inclusive ranges.
fn hash_partitions(count: usize) -> impl Iterator<Item = (u64, u64)> {
    let count = count.max(1) as u128;
    let span = (u64::MAX as u128) + 1;
    (0..count).map(move |partition| {
        let lo = (span * partition / count) as u64;
        let hi = (span * (partition + 1) / count - 1) as u64;
        (lo, hi)
    })
}

fn ordered_partition_input(plan: &Arc<dyn ExecutionPlan>) -> Option<Arc<dyn ExecutionPlan>> {
    if plan_contains_sort(plan) {
        return None;
    }
    if plan.properties().output_partitioning().partition_count() == 0 {
        return Some(Arc::clone(plan));
    }
    if let Some(merge) = plan.downcast_ref::<SortPreservingMergeExec>() {
        return Some(merge.input().clone());
    }
    if plan.properties().output_partitioning().partition_count() == 1 && hash_ordered(plan) {
        return Some(Arc::clone(plan));
    }
    None
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
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::Duration,
    };

    use datafusion::{
        arrow::{
            array::{AsArray, Float64Array, Int64Array, RecordBatch, UInt64Array},
            datatypes::{Field, Float64Type, Int64Type, UInt64Type},
        },
        common::tree_node::TreeNodeRecursion,
        datasource::MemTable,
        physical_expr::{LexOrdering, PhysicalExpr, PhysicalSortExpr},
        physical_plan::{DisplayAs, DisplayFormatType, PlanProperties, empty::EmptyExec},
        prelude::SessionConfig,
    };
    use futures::{
        FutureExt, TryStreamExt,
        future::{BoxFuture, pending},
    };
    use promql_parser::label::Labels as ModifierLabels;
    use tokio::sync::{Barrier, Notify, Semaphore, oneshot};

    use super::{super::tests::*, *};
    use crate::{aggregations::AggOp, streaming_eval::tests::by};

    struct DroppedPlan(Option<oneshot::Sender<()>>);

    impl Drop for DroppedPlan {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    #[derive(Debug)]
    struct CountingExec {
        input: Arc<dyn ExecutionPlan>,
        executions: Arc<AtomicUsize>,
    }

    impl DisplayAs for CountingExec {
        fn fmt_as(&self, _: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "CountingExec")
        }
    }

    impl ExecutionPlan for CountingExec {
        fn name(&self) -> &str {
            "CountingExec"
        }
        fn properties(&self) -> &Arc<PlanProperties> {
            self.input.properties()
        }
        fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
            vec![&self.input]
        }
        fn apply_expressions(
            &self,
            _: &mut dyn FnMut(&Arc<dyn PhysicalExpr>) -> Result<TreeNodeRecursion>,
        ) -> Result<TreeNodeRecursion> {
            Ok(TreeNodeRecursion::Continue)
        }
        fn with_new_children(
            self: Arc<Self>,
            mut children: Vec<Arc<dyn ExecutionPlan>>,
        ) -> Result<Arc<dyn ExecutionPlan>> {
            assert_eq!(children.len(), 1);
            Ok(Arc::new(Self {
                input: children.remove(0),
                executions: Arc::clone(&self.executions),
            }))
        }
        fn execute(
            &self,
            partition: usize,
            ctx: Arc<TaskContext>,
        ) -> Result<SendableRecordBatchStream> {
            self.executions.fetch_add(1, Ordering::SeqCst);
            self.input.execute(partition, ctx)
        }
    }

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
        let streams = execute_planned_partitions(
            vec![PlannedPartition {
                plan,
                task_ctx: Arc::new(TaskContext::default()),
            }],
            "empty_shard",
        )
        .unwrap()
        .unwrap();
        assert_eq!(streams.len(), 1);
        assert!(streams[0].is_empty());
    }

    #[test]
    fn test_hash_shards_cover_the_full_space_contiguously() {
        for count in [1, 3, 7, 16] {
            let partitions: Vec<_> = hash_partitions(count).collect();
            assert_eq!(partitions.len(), count);
            assert_eq!(partitions[0].0, 0);
            assert_eq!(partitions[count - 1].1, u64::MAX);
            for pair in partitions.windows(2) {
                assert_eq!(pair[0].1.wrapping_add(1), pair[1].0);
            }
        }
    }

    #[tokio::test]
    async fn test_hash_shards_preserve_scan_chains_and_session_config() {
        let partitions = 8;
        let rows_per_batch = 64;
        let mut config = SessionConfig::new()
            .with_target_partitions(partitions)
            .with_batch_size(32)
            .with_repartition_file_scans(true);
        config
            .options_mut()
            .optimizer
            .enable_round_robin_repartition = false;
        config.options_mut().optimizer.prefer_existing_sort = true;
        let ctx = SessionContext::new_with_config(config);
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]));
        let expected: Vec<_> = hash_partitions(partitions)
            .flat_map(|(lo, _)| {
                (0..rows_per_batch).map(move |row| (lo + row / 2, (row % 2) as i64, row as f64))
            })
            .collect();
        let batches = expected
            .chunks(rows_per_batch as usize)
            .map(|rows| {
                RecordBatch::try_new(
                    schema.clone(),
                    vec![
                        Arc::new(UInt64Array::from_iter_values(rows.iter().map(|row| row.0))),
                        Arc::new(Int64Array::from_iter_values(rows.iter().map(|row| row.1))),
                        Arc::new(Float64Array::from_iter_values(rows.iter().map(|row| row.2))),
                    ],
                )
                .unwrap()
            })
            .collect();
        let table = MemTable::try_new(schema, vec![batches])
            .unwrap()
            .with_sort_order(vec![vec![
                col(HASH_LABEL).sort(true, false),
                col(TIMESTAMP_COL_NAME).sort(true, false),
            ]]);
        ctx.register_table("sorted", Arc::new(table)).unwrap();
        let df = ctx.table("sorted").await.unwrap();
        let inputs = build_partition_inputs(
            &df,
            &[HASH_LABEL, TIMESTAMP_COL_NAME, VALUE_LABEL],
            partitions,
            "preserve_shard_chains",
        )
        .await
        .expect("hash shard planning must succeed")
        .expect("hash shards must preserve the declared input ordering");
        assert_eq!(inputs.len(), partitions);
        let mut actual = Vec::new();
        for (streams, (lo, hi)) in inputs.into_iter().zip(hash_partitions(partitions)) {
            assert_eq!(streams.len(), 1, "each shard must keep the one input chain");
            let mut previous = None;
            for mut stream in streams {
                while let Some(batch) = stream.try_next().await.unwrap() {
                    let hashes = batch[HASH_LABEL].as_primitive::<UInt64Type>();
                    let timestamps = batch[TIMESTAMP_COL_NAME].as_primitive::<Int64Type>();
                    let values = batch[VALUE_LABEL].as_primitive::<Float64Type>();
                    for row in 0..batch.num_rows() {
                        let key = (hashes.value(row), timestamps.value(row));
                        assert!((lo..=hi).contains(&key.0));
                        assert!(previous.is_none_or(|previous| previous <= key));
                        previous = Some(key);
                        actual.push((key.0, key.1, values.value(row)));
                    }
                }
            }
        }
        assert_eq!(actual, expected);
        assert!(
            ctx.state()
                .config()
                .options()
                .optimizer
                .repartition_file_scans
        );
        assert!(
            df.into_parts()
                .0
                .config()
                .options()
                .optimizer
                .repartition_file_scans
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_parallel_plans_preserve_shard_order_with_bounded_dispatch() {
        let release_first = Arc::new(Notify::new());
        let finished_second = Arc::new(Notify::new());
        let plans = (0..3).map(|index| {
            let release_first = Arc::clone(&release_first);
            let finished_second = Arc::clone(&finished_second);
            async move {
                match index {
                    0 => release_first.notified().await,
                    1 => finished_second.notify_one(),
                    _ => {
                        finished_second.notified().await;
                        release_first.notify_one();
                    }
                }
                Ok(index)
            }
        });
        assert_eq!(collect_plans(plans, 2).await.unwrap(), vec![0, 1, 2]);
        let empty = std::iter::empty::<BoxFuture<'static, Result<usize>>>();
        assert!(collect_plans(empty, 2).await.unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_parallel_plans_do_not_construct_beyond_dispatch_limit() {
        let started = Arc::new(Semaphore::new(0));
        let dispatched = Arc::new(AtomicUsize::new(0));
        let (senders, receivers): (Vec<_>, Vec<_>) =
            (0..6).map(|_| oneshot::channel::<()>()).unzip();
        let plans = receivers.into_iter().enumerate().map({
            let started = Arc::clone(&started);
            let dispatched = Arc::clone(&dispatched);
            move |(index, receiver)| {
                dispatched.fetch_add(1, Ordering::SeqCst);
                let started = Arc::clone(&started);
                async move {
                    started.add_permits(1);
                    receiver.await.unwrap();
                    Ok(index)
                }
            }
        });
        let task = tokio::spawn(collect_plans(plans, 2));
        let mut senders = senders.into_iter();
        for batch in 1..=3 {
            tokio::time::timeout(Duration::from_secs(5), started.acquire_many(2))
                .await
                .unwrap()
                .unwrap()
                .forget();
            assert_eq!(dispatched.load(Ordering::SeqCst), batch * 2);
            for _ in 0..2 {
                senders.next().unwrap().send(()).unwrap();
            }
        }
        assert_eq!(task.await.unwrap().unwrap(), vec![0, 1, 2, 3, 4, 5]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_parallel_plan_error_and_panic_drain_other_tasks() {
        for panic in [false, true] {
            let barrier = Arc::new(Barrier::new(2));
            let (dropped, mut observed_drop) = oneshot::channel();
            let blocked_barrier = Arc::clone(&barrier);
            let blocked = async move {
                let _guard = DroppedPlan(Some(dropped));
                blocked_barrier.wait().await;
                pending::<Result<usize>>().await
            }
            .boxed();
            let failure = async move {
                barrier.wait().await;
                assert!(!panic, "test planner panic");
                Err(DataFusionError::Execution("test planner error".into()))
            }
            .boxed();
            let error = collect_plans(vec![blocked, failure], 2).await.unwrap_err();
            assert!(error.to_string().contains(if panic {
                "test planner panic"
            } else {
                "test planner error"
            }));
            observed_drop
                .try_recv()
                .expect("other task dropped before error returned");
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_cancelling_parallel_planning_aborts_owned_tasks() {
        let (started, observe_start) = oneshot::channel();
        let (dropped, observe_drop) = oneshot::channel();
        let plan = async move {
            let _guard = DroppedPlan(Some(dropped));
            started.send(()).unwrap();
            pending::<Result<usize>>().await
        };
        let task = tokio::spawn(collect_plans([plan], 1));
        observe_start.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::timeout(Duration::from_secs(5), observe_drop)
            .await
            .unwrap()
            .expect("cancelled planning task must release its guard");
    }

    #[tokio::test]
    async fn test_all_plans_validate_before_any_shard_executes() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            HASH_LABEL,
            DataType::UInt64,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(UInt64Array::from(vec![1u64]))],
        )
        .unwrap();
        let table = MemTable::try_new(schema, vec![vec![batch]])
            .unwrap()
            .with_sort_order(vec![vec![col(HASH_LABEL).sort(true, false)]]);
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(1));
        ctx.register_table("ordered", Arc::new(table)).unwrap();
        let df = ctx.table("ordered").await.unwrap();
        let executions = Arc::new(AtomicUsize::new(0));
        let input: Arc<dyn ExecutionPlan> = Arc::new(CountingExec {
            input: df.create_physical_plan().await.unwrap(),
            executions: Arc::clone(&executions),
        });
        assert!(hash_ordered(&input));
        let task_ctx = Arc::new(df.task_ctx());
        let ordering = LexOrdering::new(vec![PhysicalSortExpr::new(
            Arc::new(Column::new(HASH_LABEL, 0)),
            Default::default(),
        )])
        .unwrap();
        let needs_sort: Arc<dyn ExecutionPlan> = Arc::new(SortExec::new(ordering, input.clone()));
        let rejected = execute_planned_partitions(
            vec![
                PlannedPartition {
                    plan: input.clone(),
                    task_ctx: task_ctx.clone(),
                },
                PlannedPartition {
                    plan: needs_sort,
                    task_ctx: task_ctx.clone(),
                },
            ],
            "late_invalid_shard",
        )
        .unwrap();
        assert!(rejected.is_none());
        assert_eq!(executions.load(Ordering::SeqCst), 0);
        let accepted = execute_planned_partitions(
            vec![
                PlannedPartition {
                    plan: input.clone(),
                    task_ctx: task_ctx.clone(),
                },
                PlannedPartition {
                    plan: input,
                    task_ctx,
                },
            ],
            "all_valid_shards",
        )
        .unwrap()
        .unwrap();
        assert_eq!(accepted.len(), 2);
        assert_eq!(executions.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_streaming_falls_back_without_sorted_table() {
        let ctx = session_ctx();
        let table = MemTable::try_new(arrow_schema(), sorted_partitions()).unwrap();
        ctx.register_table("m", Arc::new(table)).unwrap();

        let result = run_streaming(&ctx, &None, "rate", AggOp::Sum, Duration::from_secs(60)).await;
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

        let result = run_streaming(&ctx, &None, "rate", AggOp::Sum, Duration::from_secs(60)).await;
        assert!(result.is_none());
    }
}
