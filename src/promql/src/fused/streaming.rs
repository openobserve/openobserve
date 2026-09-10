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

//! Streaming evaluation of `agg(range_func(selector))` over hash-sorted
//! metrics files: each hash partition merges its hash-ordered file chains one
//! series at a time through the shared fused fold, so the sample matrix is
//! never materialized.

use std::{sync::Arc, time::Duration};

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        EXEMPLARS_LABEL, HASH_LABEL, NAME_LABEL, VALUE_LABEL,
        value::{EvalContext, Value},
    },
};
use datafusion::{arrow::datatypes::Schema, error::Result, prelude::SessionContext};
use promql_parser::parser::LabelModifier;

use super::range_expr::RangeExpr;
use crate::{
    functions::{KEEP_METRIC_NAME_FUNC, RangeFunc},
    fused::{self, FusedAggOp},
    micros,
    series_stream::merge::{MergeSeriesStream, StreamingSelector},
};

/// The `agg(range_func(...))` pair being evaluated.
pub(crate) struct FusedShape {
    pub op: FusedAggOp,
    pub func: Arc<dyn RangeFunc>,
    pub range: Duration,
}

/// Folds from per-partition ordered streams; `None` when the layout or shape cannot stream. The
/// caller bounds it: dropping the future aborts the partition folds.
pub(crate) async fn aggregate(
    ctx: &SessionContext,
    schema: &Schema,
    selector: StreamingSelector<'_>,
    shape: FusedShape,
    modifier: &Option<LabelModifier>,
    eval_ctx: &EvalContext,
) -> Result<Option<Value>> {
    let Some(group_cols) = group_label_columns(modifier, schema, shape.func.name()) else {
        return Ok(None);
    };
    let lookback = micros(shape.range);
    let Some(sources) = MergeSeriesStream::execute_partitioned(
        ctx, schema, &selector, group_cols, lookback, eval_ctx,
    )
    .await?
    else {
        return Ok(None);
    };
    let eval = Arc::new(RangeExpr::new(shape.func.clone(), shape.range, eval_ctx));
    let (value, _) = fused::aggregate(sources, shape.op, eval).await?;
    Ok(Some(value))
}

/// The `by()` columns in a stable order; `None` for `without()`, which needs the full label set.
fn group_label_columns(
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

#[cfg(test)]
mod tests {
    use config::meta::promql::{
        HASH_SORTED_TABLE_SUFFIX,
        value::{Label, RangeValue, Sample, TimeWindow},
    };
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
            datatypes::DataType,
        },
        datasource::MemTable,
        logical_expr::SortExpr,
        prelude::{SessionConfig, col},
    };
    use hashbrown::{HashMap, HashSet};
    use itertools::Itertools;
    use promql_parser::label::{Labels as ModifierLabels, Matchers};

    use super::{
        super::{eval_range::eval_range, materialized, test_support::*},
        *,
    };
    use crate::{functions, series_stream::merge::series_label_columns};

    fn arrow_schema() -> Arc<Schema> {
        use datafusion::arrow::datatypes::Field;
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

    async fn run_streaming(
        ctx: &SessionContext,
        modifier: &Option<LabelModifier>,
        func_name: &str,
        op: FusedAggOp,
        range: Duration,
    ) -> Option<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let eval_ctx = eval_ctx();
        aggregate(
            ctx,
            &arrow_schema(),
            StreamingSelector {
                table_name: "m",
                matchers: &Matchers::empty(),
                offset: 0,
            },
            FusedShape { op, func, range },
            modifier,
            &eval_ctx,
        )
        .await
        .unwrap()
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
                    let (sources, range) = materialized::group_sources(
                        Value::Matrix(reference_matrix(range)),
                        modifier,
                        func_name,
                    )
                    .unwrap()
                    .unwrap();
                    let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
                    let expected = fused::aggregate(sources, op, eval).await.unwrap().0;

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
            let selector = StreamingSelector {
                table_name: "m",
                matchers: &Matchers::empty(),
                offset: 0,
            };
            let label_cols = series_label_columns(&arrow_schema(), &all_labels, func_name);
            let sources = MergeSeriesStream::execute_partitioned(
                &ctx,
                &arrow_schema(),
                &selector,
                label_cols,
                micros(range),
                &eval_ctx,
            )
            .await
            .unwrap()
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
}
