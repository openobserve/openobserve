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

use std::sync::Arc;

use config::{TIMESTAMP_COL_NAME, meta::inverted_index::IndexOptimizeMode};
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    logical_expr::Operator,
    physical_expr::ScalarFunctionExpr,
    physical_plan::{
        ExecutionPlan, PhysicalExpr,
        aggregates::AggregateExec,
        expressions::{BinaryExpr, Literal},
        projection::ProjectionExec,
    },
    scalar::ScalarValue,
};
use hashbrown::HashSet;

use crate::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan,
    utils::{get_column_name, is_column, is_count_rows_aggregate},
};

/// 2001-01-01T00:00:00Z in microseconds: the origin `rewrite_histogram` passes to `date_bin`.
const DATE_BIN_ORIGIN_MICROS: i64 = 978_307_200_000_000;

#[rustfmt::skip]
/// SimpleHistogram(i64, u64, usize, i64): select histogram(_timestamp, '1m') as ts, count(*) as cnt from table where match_all() group by ts;
/// histogram() with a timezone rewrites to date_bin over `_timestamp@0 + offset`; the
/// extracted mode then carries the offset and its bucket edges live in local wall-clock space.
/// condition: group by histogram(_timestamp), only count(*)
/// example plan:
/// ProjectionExec: expr=[histogram(default._timestamp)@0 as histogram(default._timestamp), count(Int64(1))@1 as cnt]
///   AggregateExec: mode=FinalPartitioned, gby=[histogram(default._timestamp)@0 as histogram(default._timestamp)], aggr=[count(Int64(1))]
///     CoalesceBatchesExec: target_batch_size=8192
///       RepartitionExec: partitioning=Hash([histogram(default._timestamp)@0], 12), input_partitions=12
///         AggregateExec: mode=Partial, gby=[date_bin(IntervalMonthDayNano { months: 0, days: 0, nanoseconds: 86400000000000 }, to_timestamp_micros(_timestamp@0), 978307200000000000) as histogram(default._timestamp)], aggr=[count(Int64(1))]
///           CoalesceBatchesExec: target_batch_size=8192
///             FilterExec: _timestamp@0 >= 17296550822151 AND _timestamp@0 < 172965508891538700
///               CooperativeExec
///                 NewEmptyExec: name="default", projection=["_timestamp"],
pub fn is_simple_histogram(plan: Arc<dyn ExecutionPlan>, time_range: (i64, i64)) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleHistogramVisitor::new(time_range);
    let _ = plan.visit(&mut visitor);
    if let Some((min_value, bucket_width, num_buckets, ts_offset)) = visitor.simple_histogram {
        Some(IndexOptimizeMode::SimpleHistogram(
            min_value,
            bucket_width,
            num_buckets,
            ts_offset,
        ))
    } else {
        None
    }
}

struct SimpleHistogramVisitor {
    time_range: (i64, i64),
    pub simple_histogram: Option<(i64, u64, usize, i64)>,
}

impl SimpleHistogramVisitor {
    pub fn new(time_range: (i64, i64)) -> Self {
        Self {
            simple_histogram: None,
            time_range,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleHistogramVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(aggregate) = node.downcast_ref::<AggregateExec>() {
            // Check if the AggregateExec matches SimpleHistogram pattern
            if aggregate.group_expr().expr().len() == 1
                && aggregate.aggr_expr().len() == 1
                && is_count_rows_aggregate(&aggregate.aggr_expr()[0])
            {
                // Check group by field
                if let Some((group_expr, _)) = aggregate.group_expr().expr().first()
                    && let Some(func) = get_data_bin(group_expr)
                    && func.args().len() == 3
                    // check second argument is _timestamp (with an optional timezone shift)
                    && let Some(ts_offset) = get_timestamp_offset(&func.args()[1])
                {
                    let args = func.args();
                    if let Some(histogram_interval) = get_histogram_interval(&args[0]) {
                        let (start_time, end_time) = self.time_range;
                        // round the bucket edges to even start
                        let rounding_by = histogram_interval as i64;
                        let min_value = align_to_date_bin_origin(start_time, rounding_by);
                        let max_value = end_time;
                        let num_buckets = ((max_value - min_value) as f64
                            / histogram_interval as f64)
                            .ceil() as usize;
                        self.simple_histogram =
                            Some((min_value, histogram_interval, num_buckets, ts_offset));
                        return Ok(TreeNodeRecursion::Continue);
                    }
                }
            }
            // If AggregateExec doesn't match SimpleHistogram pattern, stop visiting
            self.simple_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.downcast_ref::<ProjectionExec>() {
            // Check ProjectionExec for the structure: [histogram(_timestamp), count(*)]
            let exprs = projection.expr();
            if exprs.len() == 2 {
                // First expression should be the histogram(_timestamp), second should be count(*)
                // We'll validate this in the AggregateExec
                return Ok(TreeNodeRecursion::Continue);
            }
            // If projection doesn't have exactly 2 expressions, stop visiting
            self.simple_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if is_complex_plan(node) {
            // If encounter complex plan, stop visiting
            self.simple_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

/// Floor `ts` onto the same bucket grid `date_bin` uses, so the tantivy fast path and the
/// unoptimized plan agree at intervals that do not divide the origin (7m, 11m, 5h, ...).
fn align_to_date_bin_origin(ts: i64, interval: i64) -> i64 {
    if interval <= 0 {
        return ts;
    }
    // rem_euclid is always non-negative, so this floors rather than truncating toward zero
    ts.checked_sub(DATE_BIN_ORIGIN_MICROS)
        .map(|delta| delta - delta.rem_euclid(interval))
        .and_then(|floored| floored.checked_add(DATE_BIN_ORIGIN_MICROS))
        .unwrap_or(ts)
}

fn get_data_bin(expr: &Arc<dyn PhysicalExpr>) -> Option<&ScalarFunctionExpr> {
    if let Some(func) = expr.downcast_ref::<ScalarFunctionExpr>()
        && func.fun().name().to_lowercase() == "date_bin"
    {
        Some(func)
    } else {
        None
    }
}

// unit: microseconds
fn get_histogram_interval(expr: &Arc<dyn PhysicalExpr>) -> Option<u64> {
    let interval = expr.downcast_ref::<Literal>()?.value();
    match interval {
        ScalarValue::IntervalMonthDayNano(Some(interval)) => {
            // convert interval to nanoseconds
            let microseconds = interval.nanoseconds / 1_000
                + interval.days as i64 * 24 * 60 * 60 * 1_000_000
                + interval.months as i64 * 30 * 24 * 60 * 60 * 1_000_000;
            Some(microseconds as u64)
        }
        _ => None,
    }
}

/// Returns the fixed timezone offset (µs east of UTC) carried by the date_bin source
/// expression: `to_timestamp_micros(_timestamp)` yields 0 and
/// `to_timestamp_micros(_timestamp + offset)` — the shape histogram() with a timezone
/// rewrites to — yields the offset. None when the source is not the timestamp column.
fn get_timestamp_offset(expr: &Arc<dyn PhysicalExpr>) -> Option<i64> {
    let func = expr.downcast_ref::<ScalarFunctionExpr>()?;
    let arg = func.args().first()?;
    if get_column_name(arg) == TIMESTAMP_COL_NAME {
        return Some(0);
    }
    let bin = arg.downcast_ref::<BinaryExpr>()?;
    if *bin.op() != Operator::Plus || get_column_name(bin.left()) != TIMESTAMP_COL_NAME {
        return None;
    }
    match bin.right().downcast_ref::<Literal>()?.value() {
        ScalarValue::Int64(Some(ts_offset)) => Some(*ts_offset),
        _ => None,
    }
}

#[rustfmt::skip]
/// SimpleMultiHistogram(i64, i64, u64, i64, String):
/// histogram() with a timezone rewrites to date_bin over `_timestamp@0 + offset`; the
/// extracted mode then carries the offset and its bucket edges live in local wall-clock space.
/// select histogram(_timestamp) as ts, level as zo_sql_breakdown, count(*) as cnt
///   from table where match_all() group by ts, zo_sql_breakdown;
/// condition: group by histogram(_timestamp) AND a secondary index field, only count(*)
/// example plan:
/// ProjectionExec: expr=[histogram(_timestamp)@0 as ts, level@1 as level, count(Int64(1))@2 as cnt]
///   AggregateExec: mode=FinalPartitioned, gby=[histogram(_timestamp)@0 as ts, level@1 as level], aggr=[count(Int64(1))]
///     CoalesceBatchesExec: target_batch_size=8192
///       RepartitionExec: partitioning=Hash([histogram(_timestamp)@0, level@1], 12), input_partitions=12
///         AggregateExec: mode=Partial, gby=[date_bin(...) as ts, level@1 as level], aggr=[count(Int64(1))]
///           ...
pub fn is_simple_multi_histogram(
    plan: Arc<dyn ExecutionPlan>,
    time_range: (i64, i64),
    index_fields: HashSet<String>,
) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleMultiHistogramVisitor::new(time_range, index_fields);
    let _ = plan.visit(&mut visitor);
    if let Some((min_value, max_value, bucket_width, ts_offset, breakdown_field)) =
        visitor.simple_multi_histogram
    {
        Some(IndexOptimizeMode::SimpleMultiHistogram(
            min_value,
            max_value,
            bucket_width,
            ts_offset,
            breakdown_field,
        ))
    } else {
        None
    }
}

struct SimpleMultiHistogramVisitor {
    time_range: (i64, i64),
    index_fields: HashSet<String>,
    pub simple_multi_histogram: Option<(i64, i64, u64, i64, String)>,
}

impl SimpleMultiHistogramVisitor {
    pub fn new(time_range: (i64, i64), index_fields: HashSet<String>) -> Self {
        Self {
            simple_multi_histogram: None,
            time_range,
            index_fields,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for SimpleMultiHistogramVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_down(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        if let Some(aggregate) = node.downcast_ref::<AggregateExec>() {
            // Exactly 2 group-by expressions (histogram + breakdown) and 1 aggregate (count(*))
            if aggregate.group_expr().expr().len() == 2
                && aggregate.aggr_expr().len() == 1
                && is_count_rows_aggregate(&aggregate.aggr_expr()[0])
            {
                let groups = aggregate.group_expr().expr();
                // One must be date_bin (histogram), the other must be an index field column
                let date_bin_idx = groups
                    .iter()
                    .position(|(expr, _)| get_data_bin(expr).is_some());
                let col_idx = groups.iter().position(|(expr, _)| is_column(expr));

                if let (Some(db_idx), Some(c_idx)) = (date_bin_idx, col_idx)
                    && db_idx != c_idx
                {
                    let (col_expr, _) = &groups[c_idx];
                    let column_name = get_column_name(col_expr);
                    if self.index_fields.contains(column_name) {
                        // Extract histogram parameters from the date_bin expression
                        let func = get_data_bin(&groups[db_idx].0).unwrap();
                        if func.args().len() == 3
                            && let Some(ts_offset) = get_timestamp_offset(&func.args()[1])
                        {
                            let args = func.args();
                            if let Some(histogram_interval) = get_histogram_interval(&args[0]) {
                                let (start_time, end_time) = self.time_range;
                                let rounding_by = histogram_interval as i64;
                                let min_value = align_to_date_bin_origin(start_time, rounding_by);
                                let max_value = end_time;
                                self.simple_multi_histogram = Some((
                                    min_value,
                                    max_value,
                                    histogram_interval,
                                    ts_offset,
                                    column_name.to_string(),
                                ));
                                return Ok(TreeNodeRecursion::Continue);
                            }
                        }
                    }
                }
            }
            // If AggregateExec doesn't match, stop visiting
            self.simple_multi_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.downcast_ref::<ProjectionExec>() {
            // Projection should have 3 expressions: timestamp, breakdown, count
            let exprs = projection.expr();
            if exprs.len() == 3 {
                return Ok(TreeNodeRecursion::Continue);
            }
            self.simple_multi_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if is_complex_plan(node) {
            self.simple_multi_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::Result,
        execution::{SessionStateBuilder, runtime_env::RuntimeEnvBuilder},
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::datafusion::{
        optimizer::{
            logical_optimizer::rewrite_histogram::RewriteHistogram,
            physical_optimizer::index_optimizer::utils::tests::get_partial_aggregate_plan,
        },
        table_provider::empty_table::NewEmptyTable,
        udf::histogram_udf,
    };

    #[tokio::test]
    async fn test_is_simple_histogram() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let start_time = 1757401694060000;
        let end_time = 1757402594060000;
        let histogram_interval = 60; // 60s
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(RewriteHistogram::new(
                start_time,
                end_time,
                histogram_interval,
                None,
            )))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema);
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());

        let cases = vec![
            (
                "SELECT histogram(_timestamp) as ts, count(*) as cnt from t group by ts",
                Some(IndexOptimizeMode::SimpleHistogram(
                    1757401680000000,
                    60000000,
                    16,
                    0,
                )),
            ),
            // an explicit timezone shifts the bucket edges into local wall-clock
            // space and the extracted mode carries the offset (issue #12564)
            (
                "SELECT histogram(_timestamp, '1 minute', '+08:00') as ts, count(*) as cnt from t group by ts",
                Some(IndexOptimizeMode::SimpleHistogram(
                    1757401680000000,
                    60000000,
                    16,
                    28800000000,
                )),
            ),
            (
                "SELECT histogram(_timestamp) as ts, count(_timestamp) as cnt from t group by ts",
                Some(IndexOptimizeMode::SimpleHistogram(
                    1757401680000000,
                    60000000,
                    16,
                    0,
                )),
            ),
            (
                "SELECT name, histogram(_timestamp) as ts, count(*) as cnt from t group by name, ts",
                None,
            ),
            (
                "SELECT histogram(_timestamp) as ts, count(name) as cnt from t group by ts",
                None,
            ),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await?;
            let physical_plan = ctx.state().create_physical_plan(&plan).await?;

            let partial_aggregate_plan =
                Arc::new(get_partial_aggregate_plan(physical_plan).unwrap()) as _;
            assert_eq!(
                expected,
                is_simple_histogram(partial_aggregate_plan, (start_time, end_time))
            );
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_is_simple_multi_histogram() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("level", DataType::Utf8, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let start_time = 1757401694060000;
        let end_time = 1757402594060000;
        let histogram_interval = 60; // 60s
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(RewriteHistogram::new(
                start_time,
                end_time,
                histogram_interval,
                None,
            )))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema);
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());

        let index_fields = HashSet::from(["level".to_string()]);

        let cases = vec![
            (
                "SELECT histogram(_timestamp) as ts, level, count(*) as cnt from t group by ts, level",
                Some(IndexOptimizeMode::SimpleMultiHistogram(
                    1757401680000000,
                    1757402594060000,
                    60000000,
                    0,
                    "level".to_string(),
                )),
            ),
            // an explicit timezone shifts the bucket edges into local wall-clock
            // space and the extracted mode carries the offset (issue #12564)
            (
                "SELECT histogram(_timestamp, '1 minute', '-05:30') as ts, level, count(*) as cnt from t group by ts, level",
                Some(IndexOptimizeMode::SimpleMultiHistogram(
                    1757401680000000,
                    1757402594060000,
                    60000000,
                    -19800000000,
                    "level".to_string(),
                )),
            ),
            (
                "SELECT histogram(_timestamp) as ts, level, count(_timestamp) as cnt from t group by ts, level",
                Some(IndexOptimizeMode::SimpleMultiHistogram(
                    1757401680000000,
                    1757402594060000,
                    60000000,
                    0,
                    "level".to_string(),
                )),
            ),
            // level not in index_fields
            (
                "SELECT histogram(_timestamp) as ts, name, count(*) as cnt from t group by ts, name",
                None,
            ),
            // count over non-timestamp field is not equivalent to count(*)
            (
                "SELECT histogram(_timestamp) as ts, level, count(name) as cnt from t group by ts, level",
                None,
            ),
            // single group by (no breakdown) - should not match multi histogram
            (
                "SELECT histogram(_timestamp) as ts, count(*) as cnt from t group by ts",
                None,
            ),
        ];

        for (sql, expected) in cases {
            let plan = ctx.state().create_logical_plan(sql).await?;
            let physical_plan = ctx.state().create_physical_plan(&plan).await?;

            let partial_aggregate_plan =
                Arc::new(get_partial_aggregate_plan(physical_plan).unwrap()) as _;
            assert_eq!(
                expected,
                is_simple_multi_histogram(
                    partial_aggregate_plan,
                    (start_time, end_time),
                    index_fields.clone(),
                ),
                "Failed for SQL: {sql}"
            );
        }

        Ok(())
    }

    #[test]
    fn test_simple_histogram_visitor_initial_state() {
        let visitor = SimpleHistogramVisitor::new((1000, 2000));
        assert!(visitor.simple_histogram.is_none());
        assert_eq!(visitor.time_range, (1000, 2000));
    }

    #[test]
    fn test_simple_histogram_visitor_zero_time_range() {
        let visitor = SimpleHistogramVisitor::new((0, 0));
        assert!(visitor.simple_histogram.is_none());
        assert_eq!(visitor.time_range, (0, 0));
    }

    #[test]
    fn test_simple_histogram_visitor_negative_time_range() {
        let visitor = SimpleHistogramVisitor::new((-1000, -500));
        assert_eq!(visitor.time_range, (-1000, -500));
    }

    #[test]
    fn test_simple_multi_histogram_visitor_initial_state() {
        let visitor =
            SimpleMultiHistogramVisitor::new((1000, 2000), HashSet::from(["level".to_string()]));
        assert!(visitor.simple_multi_histogram.is_none());
        assert_eq!(visitor.time_range, (1000, 2000));
        assert_eq!(visitor.index_fields.len(), 1);
    }

    #[test]
    fn test_simple_multi_histogram_visitor_empty_index_fields() {
        let visitor = SimpleMultiHistogramVisitor::new((1000, 2000), HashSet::new());
        assert!(visitor.simple_multi_histogram.is_none());
        assert!(visitor.index_fields.is_empty());
    }

    /// The epoch-floored expression this file used before the fix, kept so the tests below can
    /// state exactly where the two grids agree and where they diverge.
    fn epoch_floor(ts: i64, interval: i64) -> i64 {
        ts - ts % interval
    }

    const MIN: i64 = 60 * 1_000_000;
    const HOUR: i64 = 60 * MIN;

    /// The 15 intervals that divide 978,307,200 s, where the two grids must stay identical.
    const DIVIDING_INTERVALS: [i64; 15] = [
        MIN,
        5 * MIN,
        10 * MIN,
        15 * MIN,
        20 * MIN,
        30 * MIN,
        45 * MIN,
        HOUR,
        2 * HOUR,
        3 * HOUR,
        4 * HOUR,
        6 * HOUR,
        8 * HOUR,
        12 * HOUR,
        24 * HOUR,
    ];

    /// Real timestamps, all at or after the epoch, where the fix must change nothing.
    const SAMPLE_TIMESTAMPS: [i64; 5] = [
        1_757_401_694_060_000,
        1_700_000_000_000_000,
        978_307_200_000_000,
        978_307_200_000_001,
        0,
    ];

    #[test]
    fn origin_alignment_is_a_no_op_at_every_dividing_interval() {
        for interval in DIVIDING_INTERVALS {
            assert_eq!(
                DATE_BIN_ORIGIN_MICROS % interval,
                0,
                "interval {interval}us was listed as dividing but does not divide the origin"
            );
            for ts in SAMPLE_TIMESTAMPS {
                assert_eq!(
                    align_to_date_bin_origin(ts, interval),
                    epoch_floor(ts, interval),
                    "origin alignment changed an existing bucket edge at ts={ts}, \
                     interval={interval}us"
                );
            }
        }
    }

    #[test]
    fn origin_alignment_differs_from_the_epoch_floor_at_non_dividing_intervals() {
        let ts = 1_757_401_694_060_000;
        for (interval, expected_skew) in [
            (7 * MIN, 6 * MIN),
            (11 * MIN, 7 * MIN),
            (5 * HOUR, 2 * HOUR),
        ] {
            assert_ne!(
                DATE_BIN_ORIGIN_MICROS % interval,
                0,
                "interval {interval}us was listed as non-dividing but divides the origin"
            );
            let aligned = align_to_date_bin_origin(ts, interval);
            assert_ne!(
                aligned,
                epoch_floor(ts, interval),
                "the epoch floor and the origin floor must disagree at interval={interval}us"
            );
            assert_eq!(
                (aligned - epoch_floor(ts, interval)).rem_euclid(interval),
                expected_skew,
                "unexpected grid skew at interval={interval}us"
            );
        }
    }

    #[test]
    fn origin_alignment_matches_date_bin_at_non_dividing_intervals() {
        // the reference date_bin floor, independent of the implementation under test
        let date_bin = |ts: i64, interval: i64| {
            let delta = ts - DATE_BIN_ORIGIN_MICROS;
            DATE_BIN_ORIGIN_MICROS + (delta - delta.rem_euclid(interval))
        };
        for interval in [7 * MIN, 11 * MIN, 5 * HOUR] {
            for ts in SAMPLE_TIMESTAMPS {
                assert_eq!(
                    align_to_date_bin_origin(ts, interval),
                    date_bin(ts, interval),
                    "fast path disagrees with date_bin at ts={ts}, interval={interval}us"
                );
            }
        }
    }

    #[test]
    fn origin_alignment_floors_below_the_origin_instead_of_truncating() {
        // `%` truncates toward zero, so a pre-2001 timestamp would round up without rem_euclid
        let interval = 7 * MIN;
        let ts = DATE_BIN_ORIGIN_MICROS - 1;
        let aligned = align_to_date_bin_origin(ts, interval);
        assert!(
            aligned <= ts,
            "alignment must never move a timestamp forward"
        );
        assert_eq!(aligned, DATE_BIN_ORIGIN_MICROS - interval);
    }

    #[test]
    fn origin_alignment_fixes_the_epoch_floor_rounding_pre_epoch_timestamps_up() {
        let interval = MIN;
        let ts = -1_000_000_000_000;
        assert!(
            epoch_floor(ts, interval) > ts,
            "if `%` ever floored, this test has stopped meaning anything"
        );
        assert!(
            align_to_date_bin_origin(ts, interval) < ts,
            "a pre-epoch timestamp must floor down, not truncate toward zero"
        );
    }

    #[test]
    fn origin_alignment_never_overflows_or_moves_forward() {
        for interval in [MIN, 7 * MIN, 5 * HOUR] {
            for ts in [i64::MIN, i64::MIN + 1, i64::MAX, i64::MAX - 1, 0] {
                let aligned = align_to_date_bin_origin(ts, interval);
                assert!(
                    aligned <= ts,
                    "alignment moved ts={ts} forward at interval={interval}us"
                );
            }
        }
        assert_eq!(align_to_date_bin_origin(12_345, 0), 12_345);
        assert_eq!(align_to_date_bin_origin(12_345, -1), 12_345);
    }
}
