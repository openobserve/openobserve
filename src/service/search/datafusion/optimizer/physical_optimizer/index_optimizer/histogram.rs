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

use std::sync::Arc;

use config::{TIMESTAMP_COL_NAME, meta::inverted_index::IndexOptimizeMode};
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_expr::ScalarFunctionExpr,
    physical_plan::{
        ExecutionPlan, PhysicalExpr, aggregates::AggregateExec, expressions::Literal,
        projection::ProjectionExec,
    },
    scalar::ScalarValue,
};

use crate::service::search::datafusion::optimizer::physical_optimizer::{
    index_optimizer::utils::is_complex_plan, utils::get_column_name,
};

#[rustfmt::skip]
/// SimpleHistogram(i64, u64, usize): select histogram(_timestamp, '1m') as ts, count(*) as cnt from table where match_all() group by ts;
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
pub(crate) fn is_simple_histogram(plan: Arc<dyn ExecutionPlan>, time_range: (i64, i64)) -> Option<IndexOptimizeMode> {
    let mut visitor = SimpleHistogramVisitor::new(time_range);
    let _ = plan.visit(&mut visitor);
    if let Some((min_value, bucket_width, num_buckets)) = visitor.simple_histogram {
        Some(IndexOptimizeMode::SimpleHistogram(
            min_value,
            bucket_width,
            num_buckets,
        ))
    } else {
        None
    }
}

struct SimpleHistogramVisitor {
    time_range: (i64, i64),
    pub simple_histogram: Option<(i64, u64, usize)>,
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
        if let Some(aggregate) = node.as_any().downcast_ref::<AggregateExec>() {
            // Check if the AggregateExec matches SimpleHistogram pattern
            if aggregate.group_expr().expr().len() == 1
                && aggregate.aggr_expr().len() == 1
                && aggregate.aggr_expr()[0].name() == "count(Int64(1))"
            {
                // Check group by field
                if let Some((group_expr, _)) = aggregate.group_expr().expr().first()
                    && let Some(func) = get_data_bin(group_expr)
                    && func.args().len() == 3
                    && is_timestamp_column(&func.args()[1])
                // check second argument is _timestamp
                {
                    let args = func.args();
                    if let Some(histogram_interval) = get_histogram_interval(&args[0]) {
                        let (start_time, end_time) = self.time_range;
                        // round the bucket edges to even start
                        let rounding_by = histogram_interval as i64;
                        let min_value = start_time - start_time % rounding_by;
                        let max_value = end_time;
                        let num_buckets = ((max_value - min_value) as f64
                            / histogram_interval as f64)
                            .ceil() as usize;
                        self.simple_histogram = Some((min_value, histogram_interval, num_buckets));
                        return Ok(TreeNodeRecursion::Continue);
                    }
                }
            }
            // If AggregateExec doesn't match SimpleHistogram pattern, stop visiting
            self.simple_histogram = None;
            return Ok(TreeNodeRecursion::Stop);
        } else if let Some(projection) = node.as_any().downcast_ref::<ProjectionExec>() {
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

fn get_data_bin(expr: &Arc<dyn PhysicalExpr>) -> Option<&ScalarFunctionExpr> {
    if let Some(func) = expr.as_any().downcast_ref::<ScalarFunctionExpr>()
        && func.fun().name().to_lowercase() == "date_bin"
    {
        Some(func)
    } else {
        None
    }
}

// unit: microseconds
fn get_histogram_interval(expr: &Arc<dyn PhysicalExpr>) -> Option<u64> {
    let interval = expr.as_any().downcast_ref::<Literal>()?.value();
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

fn is_timestamp_column(expr: &Arc<dyn PhysicalExpr>) -> bool {
    if let Some(func) = expr.as_any().downcast_ref::<ScalarFunctionExpr>() {
        let column_name = get_column_name(&func.args()[0]);
        column_name == TIMESTAMP_COL_NAME
    } else {
        false
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
    use crate::service::search::datafusion::{
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
                )),
            ),
            (
                "SELECT name, histogram(_timestamp) as ts, count(*) as cnt from t group by name, ts",
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
}
