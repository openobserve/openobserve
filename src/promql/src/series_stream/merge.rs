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

//! The hash-sorted producer: partition plans over hash-sorted scans, and the per-partition source
//! that merges a partition's ordered chains one series at a time.

use std::{hash::Hasher, sync::Arc};

use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        plan::generate_plan_string,
        promql::{
            BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, NAME_LABEL,
            VALUE_LABEL,
            value::{EvalContext, Labels, Sample},
        },
    },
    utils::hash::gxhash,
};
use datafusion::{
    arrow::{
        array::{AsArray, RecordBatch},
        datatypes::{DataType, Float64Type, Int64Type, Schema, UInt64Type},
    },
    error::{DataFusionError, Result},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_plan::{
        ExecutionPlan, execute_stream, execute_stream_partitioned,
        expressions::Column,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
    prelude::{DataFrame, SessionContext, col, lit},
};
use futures::TryStreamExt;
use hashbrown::HashSet;
use promql_parser::{label::Matchers, parser::LabelModifier};

use super::SeriesStream;
use crate::{
    functions::KEEP_METRIC_NAME_FUNC,
    series_loader::label_interner::{LabelColumn, LabelInterner},
    utils::{apply_matchers, apply_time_window, batch_run_len},
};

/// The selector being scanned; `offset` is the `offset` modifier in microseconds.
pub(crate) struct StreamingSelector<'a> {
    pub table_name: &'a str,
    pub matchers: &'a Matchers,
    pub offset: i64,
}

/// One partition's series stream; every chain holds one run per series, so the minimum head hash is
/// the next series.
pub(crate) struct MergeSeriesStream {
    cursors: Vec<ChainCursor>,
    group_cols: Arc<Vec<String>>,
    /// One interner per group column, so the emitted series share label allocations.
    interners: Vec<LabelInterner>,
    offset: i64,
    /// Hash of the series `advance` yielded, until `consume` takes it.
    current: Option<u64>,
    samples: Vec<Sample>,
}

impl MergeSeriesStream {
    /// One source per partition over the selector's hash-sorted table, projected to the sample
    /// columns plus `label_cols`; `None` when the layout cannot stream in order.
    pub(crate) async fn execute_partitioned(
        ctx: &SessionContext,
        schema: &Schema,
        selector: &StreamingSelector<'_>,
        label_cols: Vec<String>,
        lookback: i64,
        eval_ctx: &EvalContext,
    ) -> Result<Option<Vec<impl Future<Output = Result<MergeSeriesStream>> + Send + 'static + use<>>>>
    {
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
                .map(|streams| MergeSeriesStream::start(streams, label_cols.clone(), offset))
                .collect(),
        ))
    }

    pub(crate) async fn start(
        streams: Vec<SendableRecordBatchStream>,
        group_cols: Arc<Vec<String>>,
        offset: i64,
    ) -> Result<Self> {
        let mut cursors = Vec::with_capacity(streams.len());
        for stream in streams {
            cursors.push(ChainCursor::start(stream).await?);
        }
        let interners = group_cols
            .iter()
            .map(|name| LabelInterner::new(name.clone()))
            .collect();
        Ok(Self {
            cursors,
            group_cols,
            interners,
            offset,
            current: None,
            samples: Vec::new(),
        })
    }

    /// The head batch and row of the first chain holding the current series.
    fn head(&self) -> (&RecordBatch, usize) {
        let hash = self.current.expect("a series is current");
        let cursor = self
            .cursors
            .iter()
            .find(|cursor| cursor.head_hash() == Some(hash))
            .expect("the minimum head hash has a contributing chain");
        let batch = cursor.batch.as_ref().expect("head_hash implies a batch");
        (batch, cursor.row)
    }

    fn label_columns<'a>(&self, batch: &'a RecordBatch) -> Result<Vec<LabelColumn<'a>>> {
        self.group_cols
            .iter()
            .map(|name| {
                LabelColumn::try_from_array(batch[name.as_str()].as_ref()).ok_or_else(|| {
                    DataFusionError::Execution(format!(
                        "label column {name} is not Utf8 or Utf8View"
                    ))
                })
            })
            .collect()
    }
}

impl SeriesStream for MergeSeriesStream {
    async fn advance(&mut self) -> Result<Option<u64>> {
        let Some(hash) = self.cursors.iter().filter_map(ChainCursor::head_hash).min() else {
            self.current = None;
            return Ok(None);
        };
        self.current = Some(hash);
        let (batch, row) = self.head();
        let cols = self.label_columns(batch)?;
        let mut hasher = gxhash::new_hasher();
        for (values, name) in cols.iter().zip(self.group_cols.iter()) {
            if !values.is_null(row) {
                hasher.write(name.as_bytes());
                hasher.write(values.value(row).as_bytes());
            }
        }
        Ok(Some(hasher.finish()))
    }

    fn labels(&mut self) -> Labels {
        let (batch, row) = self.head();
        let batch = batch.clone();
        let cols = self
            .label_columns(&batch)
            .expect("advance validated the group columns");
        cols.iter()
            .zip(self.interners.iter_mut())
            .filter(|(values, _)| !values.is_null(row))
            .map(|(values, interner)| interner.intern(values.value(row)))
            .collect()
    }

    async fn consume(&mut self) -> Result<&[Sample]> {
        let hash = self.current.take().expect("advance yielded a series");
        self.samples.clear();
        for cursor in &mut self.cursors {
            if cursor.head_hash() == Some(hash) {
                cursor
                    .consume_run(hash, self.offset, &mut self.samples)
                    .await?;
            }
        }
        // classic parity: chains interleave in time, so restore per-series order
        self.samples.sort_unstable_by_key(|sample| sample.timestamp);
        Ok(&self.samples)
    }
}

/// One hash-ordered chain of non-overlapping files; a series is a single run per chain.
struct ChainCursor {
    stream: SendableRecordBatchStream,
    batch: Option<RecordBatch>,
    row: usize,
}

impl ChainCursor {
    async fn start(stream: SendableRecordBatchStream) -> Result<Self> {
        let mut cursor = Self {
            stream,
            batch: None,
            row: 0,
        };
        cursor.next_batch().await?;
        Ok(cursor)
    }

    fn head_hash(&self) -> Option<u64> {
        let batch = self.batch.as_ref()?;
        Some(batch[HASH_LABEL].as_primitive::<UInt64Type>().values()[self.row])
    }

    async fn next_batch(&mut self) -> Result<()> {
        self.row = 0;
        loop {
            match self.stream.try_next().await? {
                Some(batch) if batch.num_rows() == 0 => continue,
                batch => {
                    self.batch = batch;
                    return Ok(());
                }
            }
        }
    }

    /// Appends this chain's samples of series `hash`, following the run across
    /// batch boundaries until the hash changes or the chain ends.
    async fn consume_run(
        &mut self,
        hash: u64,
        offset: i64,
        samples: &mut Vec<Sample>,
    ) -> Result<()> {
        while let Some(batch) = &self.batch {
            let hashes = batch[HASH_LABEL].as_primitive::<UInt64Type>().values();
            if hashes[self.row] != hash {
                return Ok(());
            }
            let run_len = batch_run_len(hashes, self.row);
            let times = batch[TIMESTAMP_COL_NAME]
                .as_primitive::<Int64Type>()
                .values();
            let values = batch[VALUE_LABEL].as_primitive::<Float64Type>().values();
            samples.extend(
                times[self.row..self.row + run_len]
                    .iter()
                    .zip(&values[self.row..self.row + run_len])
                    .map(|(&timestamp, &value)| Sample::new(timestamp + offset, value)),
            );
            self.row += run_len;
            if self.row < hashes.len() {
                return Ok(());
            }
            self.next_batch().await?;
        }
        Ok(())
    }
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

    use config::meta::promql::value::{Label, RangeValue, TimeWindow, Value};
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, StringArray, UInt64Array},
            datatypes::Field,
        },
        datasource::MemTable,
        logical_expr::SortExpr,
        physical_plan::empty::EmptyExec,
        prelude::SessionConfig,
    };
    use hashbrown::HashMap;
    use itertools::Itertools;
    use promql_parser::label::Labels as ModifierLabels;

    use super::*;
    use crate::{
        functions::{self, RangeFunc},
        micros,
        series_stream::matrix::group_sources,
        streaming_eval::{FusedAggOp, RangeExpr, aggregate, eval_range, test_support::*},
    };

    fn arrow_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("instance", DataType::Utf8, true),
            Field::new("path", DataType::Utf8, true),
        ]))
    }

    /// (hash, seconds offset, value, instance, path)
    type Row = (u64, i64, f64, Option<&'static str>, Option<&'static str>);

    /// The test series: counters, a counter reset, a late-only series, and a
    /// series with a null label, spread over the full hash space.
    fn test_rows() -> Vec<Row> {
        let dense = [10, 50, 70, 110, 130, 170];
        let series = |hash, values: [f64; 6], instance, path| {
            dense
                .into_iter()
                .zip(values)
                .map(move |(ts, value)| (hash, ts, value, instance, path))
        };
        let mut rows: Vec<Row> = series(
            100,
            [0.1, 40.7, 45.2, 85.9, 90.4, 130.8],
            Some("a"),
            Some("/one"),
        )
        .chain(series(
            200,
            [0.3, 80.1, 90.6, 170.2, 180.9, 260.5],
            Some("b"),
            Some("/one"),
        ))
        // counter reset (25.1 -> 3.4) crossing the partition split below
        .chain(series(
            5,
            [0.2, 20.4, 25.1, 3.4, 50.3, 70.9],
            Some("c"),
            Some("/two"),
        ))
        .collect();
        // samples only in the last window
        rows.push((u64::MAX - 3, 130, 7.5, Some("z"), Some("/two")));
        rows.push((u64::MAX - 3, 170, 11.25, Some("z"), Some("/two")));
        // null instance label
        rows.push((42, 50, 1.0, None, Some("/two")));
        rows.push((42, 110, 3.0, None, Some("/two")));
        rows
    }

    fn rows_to_batch(mut rows: Vec<Row>) -> RecordBatch {
        rows.sort_by_key(|row| (row.0, row.1));
        RecordBatch::try_new(
            arrow_schema(),
            vec![
                Arc::new(Int64Array::from_iter_values(
                    rows.iter().map(|row| BASE + row.1 * SECOND),
                )),
                Arc::new(UInt64Array::from_iter_values(rows.iter().map(|row| row.0))),
                Arc::new(Float64Array::from_iter_values(rows.iter().map(|row| row.2))),
                Arc::new(StringArray::from(
                    rows.iter().map(|row| row.3).collect::<Vec<_>>(),
                )),
                Arc::new(StringArray::from(
                    rows.iter().map(|row| row.4).collect::<Vec<_>>(),
                )),
            ],
        )
        .unwrap()
    }

    /// Two overlapping sorted "files": every series with more than one sample
    /// is split across both, so only the ordered merge sees it whole.
    fn sorted_partitions() -> Vec<Vec<RecordBatch>> {
        let (even, odd): (Vec<Row>, Vec<Row>) =
            test_rows()
                .into_iter()
                .enumerate()
                .partition_map(|(index, row)| {
                    if index.is_multiple_of(2) {
                        itertools::Either::Left(row)
                    } else {
                        itertools::Either::Right(row)
                    }
                });
        vec![vec![rows_to_batch(even)], vec![rows_to_batch(odd)]]
    }

    fn session_ctx() -> SessionContext {
        let mut config = SessionConfig::new().with_target_partitions(3);
        config.options_mut().optimizer.prefer_existing_sort = true;
        SessionContext::new_with_config(config)
    }

    fn register_sorted_table(ctx: &SessionContext) {
        let sort_order: Vec<SortExpr> = vec![
            col(HASH_LABEL).sort(true, false),
            col(TIMESTAMP_COL_NAME).sort(true, false),
        ];
        let table = MemTable::try_new(arrow_schema(), sorted_partitions())
            .unwrap()
            .with_sort_order(vec![sort_order]);
        ctx.register_table(format!("m{HASH_SORTED_TABLE_SUFFIX}"), Arc::new(table))
            .unwrap();
    }

    /// The same data as a materialized matrix for the reference evaluator.
    fn reference_matrix(range: Duration) -> Vec<RangeValue> {
        let mut by_hash: HashMap<u64, RangeValue> = HashMap::new();
        for (hash, ts, value, instance, path) in test_rows() {
            let entry = by_hash.entry(hash).or_insert_with(|| RangeValue {
                labels: [("instance", instance), ("path", path)]
                    .into_iter()
                    .filter_map(|(name, value)| Some(Arc::new(Label::new(name, value?))))
                    .collect(),
                samples: vec![],
                exemplars: None,
                time_window: Some(TimeWindow::new(range)),
            });
            entry.samples.push(Sample::new(BASE + ts * SECOND, value));
        }
        let mut matrix: Vec<RangeValue> = by_hash.into_values().collect();
        for series in &mut matrix {
            series
                .samples
                .sort_unstable_by_key(|sample| sample.timestamp);
        }
        matrix
    }

    /// The sorted table's merge sources, projected to `label_cols`; `None` when it cannot stream.
    async fn merge_sources(
        ctx: &SessionContext,
        label_cols: Vec<String>,
        range: Duration,
    ) -> Option<Vec<impl Future<Output = Result<MergeSeriesStream>> + Send + 'static>> {
        let selector = StreamingSelector {
            table_name: "m",
            matchers: &Matchers::empty(),
            offset: 0,
        };
        MergeSeriesStream::execute_partitioned(
            ctx,
            &arrow_schema(),
            &selector,
            label_cols,
            micros(range),
            &eval_ctx(),
        )
        .await
        .unwrap()
    }

    /// The aggregate over the sorted table's merge sources; `None` when it cannot stream.
    async fn run_streaming(
        ctx: &SessionContext,
        modifier: &Option<LabelModifier>,
        func_name: &str,
        op: FusedAggOp,
        range: Duration,
    ) -> Option<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let label_cols = group_label_columns(modifier, &arrow_schema(), func_name)?;
        let sources = merge_sources(ctx, label_cols, range).await?;
        let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
        Some(aggregate(sources, op, eval).await.unwrap().0)
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

    #[tokio::test]
    async fn test_streaming_matches_fused_for_all_pairs() {
        let ctx = session_ctx();
        register_sorted_table(&ctx);
        let range = Duration::from_secs(60);

        let agg_cases = [
            FusedAggOp::Avg,
            FusedAggOp::Count,
            FusedAggOp::Group,
            FusedAggOp::Max,
            FusedAggOp::Min,
            FusedAggOp::Stddev,
            FusedAggOp::Stdvar,
            FusedAggOp::Sum,
        ];
        let func_cases = ["rate", "increase", "sum_over_time", "last_over_time"];
        let modifiers = [
            None,
            by(&["path"]),
            by(&["instance", "path"]),
            by(&["nope"]),
        ];

        for op in agg_cases {
            for func_name in func_cases {
                for modifier in &modifiers {
                    let func: Arc<dyn RangeFunc> =
                        Arc::from(functions::fusable_range_func(func_name).unwrap());
                    let (sources, range) =
                        group_sources(Value::Matrix(reference_matrix(range)), modifier, func_name)
                            .unwrap()
                            .unwrap();
                    let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
                    let expected = aggregate(sources, op, eval).await.unwrap().0;

                    let actual = run_streaming(&ctx, modifier, func_name, op, range)
                        .await
                        .expect("streaming path must not fall back on the sorted table");

                    assert_matrix_close(
                        canonical_matrix(expected),
                        canonical_matrix(actual),
                        &format!(
                            "streaming {}({func_name}) (modifier: {modifier:?})",
                            op.name()
                        ),
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_range_series_matches_eval_range_for_all_funcs() {
        let ctx = session_ctx();
        register_sorted_table(&ctx);
        let range = Duration::from_secs(60);
        let eval_ctx = eval_ctx();
        let all_labels = HashSet::new();
        let func_cases = [
            "avg_over_time",
            "changes",
            "count_over_time",
            "delta",
            "deriv",
            "idelta",
            "increase",
            "irate",
            "last_over_time",
            "max_over_time",
            "min_over_time",
            "rate",
            "resets",
            "stddev_over_time",
            "stdvar_over_time",
            "sum_over_time",
        ];
        for func_name in func_cases {
            let func: Arc<dyn RangeFunc> =
                Arc::from(functions::fusable_range_func(func_name).unwrap());
            let expected = functions::eval_range(
                Value::Matrix(reference_matrix(range)),
                func.clone(),
                &eval_ctx,
            )
            .unwrap();
            let label_cols = series_label_columns(&arrow_schema(), &all_labels, func_name);
            let sources = merge_sources(&ctx, label_cols, range)
                .await
                .expect("the sorted table streams");
            let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx));
            let (actual, _) = eval_range(sources, eval).await.unwrap();
            assert_matrix_close(
                canonical_matrix(expected),
                canonical_matrix(Value::Matrix(actual)),
                &format!("streaming {func_name}()"),
            );
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
}
