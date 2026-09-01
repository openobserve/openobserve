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
//! metrics files: each hash band merges its hash-ordered file chains one
//! series at a time; a series is folded into its group accumulator and
//! dropped, so the sample matrix is never materialized.

mod fold;
mod plan;

use std::{sync::Arc, time::Duration};

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        EXEMPLARS_LABEL, HASH_LABEL, NAME_LABEL, STREAMING_AGG_TABLE_SUFFIX, VALUE_LABEL,
        value::{EvalContext, Value},
    },
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    error::Result,
    prelude::SessionContext,
};
use promql_parser::{label::Matchers, parser::LabelModifier};

use self::{
    fold::{FoldParams, merge_folds, run_bands},
    plan::build_band_inputs,
};
use crate::{
    functions::{KEEP_METRIC_NAME_FUNC, RangeFunc},
    fused::FusedAggOp,
    load_series::apply_time_window,
    utils::apply_matchers,
};

/// Load-window and matcher parameters of one selector scan, with the window
/// already shifted for any `offset` modifier.
pub(crate) struct StreamingSelector<'a> {
    pub table_name: &'a str,
    pub matchers: &'a Matchers,
    pub start: i64,
    pub end: i64,
    pub step: i64,
    pub lookback: i64,
    pub offset: i64,
}

/// The `agg(range_func(...))` pair being evaluated.
pub(crate) struct FusedShape {
    pub op: FusedAggOp,
    pub func: Arc<dyn RangeFunc>,
    pub range: Duration,
}

/// Runs the fused aggregation as parallel per-hash-band ordered streams.
/// Returns `None` when the layout or query shape rules the streaming plan out
/// (no ordered table, non-UInt64 hashes, `without` grouping, a plan that would
/// need an actual sort); the caller then falls back to the materializing path.
pub(crate) async fn streaming_fused_agg(
    ctx: &SessionContext,
    schema: &Schema,
    selector: StreamingSelector<'_>,
    shape: FusedShape,
    modifier: &Option<LabelModifier>,
    eval_ctx: &EvalContext,
    timeout: u64,
) -> Result<Option<Value>> {
    let start_time = std::time::Instant::now();
    let trace_id = eval_ctx.trace_id.clone();

    if schema
        .field_with_name(HASH_LABEL)
        .is_ok_and(|field| field.data_type() != &DataType::UInt64)
    {
        return Ok(None);
    }
    let Some(group_cols) = group_label_columns(modifier, schema, shape.func.name()) else {
        return Ok(None);
    };
    let sorted_table = format!("{}{STREAMING_AGG_TABLE_SUFFIX}", selector.table_name);
    let Ok(df) = ctx.table(sorted_table.as_str()).await else {
        return Ok(None);
    };

    let df = apply_time_window(
        df,
        selector.start,
        selector.end,
        selector.step,
        selector.lookback,
    )?;
    let df = apply_matchers(df, selector.matchers)?;

    let mut columns = vec![TIMESTAMP_COL_NAME, HASH_LABEL, VALUE_LABEL];
    columns.extend(group_cols.iter().map(String::as_str));

    let bands = ctx.state().config().target_partitions();
    let Some((band_inputs, band0_plan)) =
        build_band_inputs(&df, &columns, bands, &trace_id).await?
    else {
        return Ok(None);
    };

    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming fused {}({}) started with {bands} bands",
        shape.op.name(),
        shape.func.name(),
    );
    let params = Arc::new(FoldParams {
        op: shape.op,
        func: shape.func.clone(),
        counter_kind: shape.func.counter_extrapolation(),
        range: shape.range,
        offset: selector.offset,
        eval_ctx: eval_ctx.clone(),
        timestamps: eval_ctx.timestamps(),
        group_cols,
    });
    let folds = run_bands(band_inputs, params.clone(), timeout).await?;

    if config::get_config().common.print_key_sql {
        log::info!(
            "[trace_id: {trace_id}] [PromQL] streaming band 0 metrics:\n{}",
            datafusion::physical_plan::display::DisplayableExecutionPlan::with_metrics(
                band0_plan.as_ref()
            )
            .indent(true)
        );
    }
    let series_count: usize = folds.iter().map(|(_, series)| series).sum();
    let value = merge_folds(
        folds.into_iter().map(|(groups, _)| groups).collect(),
        &params.timestamps,
    );
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming fused {}({}) completed in {:?}, folded {series_count} series into {} series",
        shape.op.name(),
        shape.func.name(),
        start_time.elapsed(),
        match &value {
            Value::Matrix(matrix) => matrix.len(),
            _ => 0,
        },
    );
    Ok(Some(value))
}

/// Columns the aggregation groups by, sorted for a stable label order.
/// `None` when the grouping cannot be resolved to a column set (`without`).
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
    use config::meta::promql::value::{Label, RangeValue, Sample, TimeWindow};
    use datafusion::{
        arrow::array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
        datasource::MemTable,
        logical_expr::SortExpr,
        prelude::{SessionConfig, col},
    };
    use hashbrown::HashMap;
    use itertools::Itertools;
    use promql_parser::label::Labels as ModifierLabels;

    use super::*;
    use crate::{functions, fused::eval::fused_range_agg};

    type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, u64)>);

    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_000 * SECOND;

    fn eval_ctx() -> EvalContext {
        EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        )
    }

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
        ctx.register_table(format!("m{STREAMING_AGG_TABLE_SUFFIX}"), Arc::new(table))
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

    fn canonical_matrix(value: Value) -> Vec<CanonicalSeries> {
        let matrix = match value {
            Value::Matrix(matrix) => matrix,
            Value::None => return vec![],
            value => panic!("expected matrix or none, got {}", value.get_type()),
        };
        let mut canonical = matrix
            .into_iter()
            .map(|series| {
                let mut labels = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect::<Vec<_>>();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>();
                (labels, samples)
            })
            .collect::<Vec<_>>();
        canonical.sort_by(|a, b| a.0.cmp(&b.0));
        canonical
    }

    /// Labels and timestamps must match exactly; values may drift in the last
    /// bits because streaming folds series in hash order, not matrix order.
    fn assert_matrix_close(
        expected: Vec<CanonicalSeries>,
        actual: Vec<CanonicalSeries>,
        context: &str,
    ) {
        assert_eq!(expected.len(), actual.len(), "{context}: series count");
        for (expected, actual) in expected.iter().zip(&actual) {
            assert_eq!(expected.0, actual.0, "{context}: labels");
            assert_eq!(expected.1.len(), actual.1.len(), "{context}: sample count");
            for (&(expected_ts, expected_bits), &(actual_ts, actual_bits)) in
                expected.1.iter().zip(&actual.1)
            {
                assert_eq!(expected_ts, actual_ts, "{context}: timestamps");
                if expected_bits == actual_bits {
                    continue;
                }
                let expected_value = f64::from_bits(expected_bits);
                let actual_value = f64::from_bits(actual_bits);
                assert!(
                    expected_value.is_finite() && actual_value.is_finite(),
                    "{context}: non-finite values must match exactly"
                );
                let tolerance = expected_value.abs().max(actual_value.abs()) * 1e-12;
                assert!(
                    (expected_value - actual_value).abs() <= tolerance,
                    "{context}: {expected_value} vs {actual_value}"
                );
            }
        }
    }

    fn by(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Include(ModifierLabels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
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
        streaming_fused_agg(
            ctx,
            &arrow_schema(),
            StreamingSelector {
                table_name: "m",
                matchers: &Matchers::empty(),
                start: eval_ctx.start,
                end: eval_ctx.end,
                step: eval_ctx.step,
                lookback: crate::micros(range),
                offset: 0,
            },
            FusedShape { op, func, range },
            modifier,
            &eval_ctx,
            10,
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
        let eval_ctx = eval_ctx();

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
                    let func = functions::fusable_range_func(func_name).unwrap();
                    let expected = fused_range_agg(
                        modifier,
                        Value::Matrix(reference_matrix(range)),
                        func.as_ref(),
                        op,
                        &eval_ctx,
                    )
                    .unwrap();

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
        ctx.register_table(format!("m{STREAMING_AGG_TABLE_SUFFIX}"), Arc::new(table))
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
