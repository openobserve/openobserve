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

//! Streams that deliver a query's series one at a time, so a consumer can
//! evaluate and drop each series without materializing the full set: one over
//! a hash-sorted scan and sliced WAL rows, one over an already-materialized
//! matrix, behind the same contract.

pub(crate) mod hash_sorted;
pub(crate) mod matrix;
pub(crate) mod plan;
pub(crate) mod wal;

use config::meta::promql::value::{Labels, Sample};
use datafusion::error::Result;

/// One partition's series delivered whole: `advance` yields the group signature, then
/// `labels`/`consume` read the current one.
pub(crate) trait SeriesStream: Send {
    fn advance(&mut self) -> impl Future<Output = Result<Option<u64>>> + Send;
    /// The projected labels of the current series; valid only before `consume`.
    fn labels(&mut self) -> Labels;
    /// Time-ordered samples of the current series.
    fn consume(&mut self) -> impl Future<Output = Result<&[Sample]>> + Send;
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::{
        TIMESTAMP_COL_NAME,
        meta::promql::{
            HASH_LABEL, HASH_SORTED_TABLE_SUFFIX, VALUE_LABEL,
            value::{Label, RangeValue, Sample, TimeWindow, Value},
        },
    };
    use datafusion::{
        arrow::{
            array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
            datatypes::{DataType, Field, Schema},
        },
        datasource::MemTable,
        error::Result,
        logical_expr::SortExpr,
        prelude::{SessionConfig, SessionContext, col},
    };
    use hashbrown::HashMap;
    use itertools::Itertools;
    use promql_parser::{label::Matchers, parser::LabelModifier};

    use super::{
        hash_sorted::HashSortedSeriesStream,
        plan::{StreamingInputs, StreamingSelector, execute_partitioned, group_label_columns},
    };
    use crate::{
        functions::{self, RangeFunc},
        micros,
        streaming_eval::{
            FusedAggOp, RangeExpr, aggregate,
            tests::{BASE, SECOND, eval_ctx},
        },
    };

    /// (hash, seconds offset, value, instance, path)
    type Row = (u64, i64, f64, Option<&'static str>, Option<&'static str>);

    pub(super) fn arrow_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("instance", DataType::Utf8, true),
            Field::new("path", DataType::Utf8, true),
        ]))
    }

    /// The test series: counters, a counter reset, a late-only series, and a
    /// series with a null label, spread over the full hash space.
    pub(super) fn test_rows() -> Vec<Row> {
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

    pub(super) fn rows_to_batch(mut rows: Vec<Row>) -> RecordBatch {
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
    pub(super) fn sorted_partitions() -> Vec<Vec<RecordBatch>> {
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

    pub(super) fn session_ctx() -> SessionContext {
        let mut config = SessionConfig::new().with_target_partitions(3);
        config.options_mut().optimizer.prefer_existing_sort = true;
        SessionContext::new_with_config(config)
    }

    pub(super) fn register_sorted_table(ctx: &SessionContext) {
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
    pub(super) fn reference_matrix(range: Duration) -> Vec<RangeValue> {
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

    /// The inputs' streams, projected to `label_cols`; `None` when they cannot stream.
    pub(super) async fn input_sources(
        inputs: &StreamingInputs<'_>,
        label_cols: Vec<String>,
        range: Duration,
    ) -> Option<Vec<impl Future<Output = Result<HashSortedSeriesStream>> + Send + 'static + use<>>>
    {
        let selector = StreamingSelector {
            table_name: "m",
            matchers: &Matchers::empty(),
            offset: 0,
        };
        execute_partitioned(inputs, &selector, label_cols, micros(range), &eval_ctx())
            .await
            .unwrap()
    }

    /// The sorted table's streams, projected to `label_cols`; `None` when it cannot stream.
    pub(super) async fn sorted_table_sources(
        ctx: &SessionContext,
        label_cols: Vec<String>,
        range: Duration,
    ) -> Option<Vec<impl Future<Output = Result<HashSortedSeriesStream>> + Send + 'static + use<>>>
    {
        let schema = arrow_schema();
        let inputs = StreamingInputs {
            storage: Some(ctx),
            wal: None,
            schema: &schema,
            partitions: 3,
        };
        input_sources(&inputs, label_cols, range).await
    }

    /// The aggregate over the inputs' streams; `None` when they cannot stream.
    pub(super) async fn run_streaming_inputs(
        inputs: &StreamingInputs<'_>,
        modifier: &Option<LabelModifier>,
        func_name: &str,
        op: FusedAggOp,
        range: Duration,
    ) -> Option<Value> {
        let func: Arc<dyn RangeFunc> = Arc::from(functions::fusable_range_func(func_name).unwrap());
        let label_cols = group_label_columns(modifier, inputs.schema, func_name)?;
        let sources = input_sources(inputs, label_cols, range).await?;
        let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
        Some(aggregate(sources, op, eval).await.unwrap().0)
    }

    /// The aggregate over the sorted table's streams; `None` when it cannot stream.
    pub(super) async fn run_streaming(
        ctx: &SessionContext,
        modifier: &Option<LabelModifier>,
        func_name: &str,
        op: FusedAggOp,
        range: Duration,
    ) -> Option<Value> {
        let schema = arrow_schema();
        let inputs = StreamingInputs {
            storage: Some(ctx),
            wal: None,
            schema: &schema,
            partitions: 3,
        };
        run_streaming_inputs(&inputs, modifier, func_name, op, range).await
    }
}
