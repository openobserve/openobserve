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

use arrow_schema::{DataType, IntervalUnit};
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRewriter},
    },
    config::ConfigOptions,
    error::DataFusionError,
    functions::datetime::{
        date_bin::DateBinFunc,
        to_timestamp::{ToTimestampFunc, ToTimestampMicrosFunc},
    },
    logical_expr::{Expr, LogicalPlan, ScalarUDF, cast, expr::ScalarFunction},
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder, utils::NamePreserver},
    scalar::ScalarValue,
};

use crate::service::search::{
    datafusion::udf::histogram_udf::HISTOGRAM_UDF_NAME,
    sql::visitor::histogram_interval::generate_histogram_interval,
};

/// Optimization rule that rewrite histogram to date_bin()
#[derive(Default, Debug)]
pub struct RewriteHistogram {
    start_time: i64,
    end_time: i64,
    histogram_interval: i64,
}

impl RewriteHistogram {
    #[allow(missing_docs)]
    pub fn new(start_time: i64, end_time: i64, histogram_interval: i64) -> Self {
        Self {
            start_time,
            end_time,
            histogram_interval,
        }
    }
}

impl OptimizerRule for RewriteHistogram {
    fn name(&self) -> &str {
        "rewrite_histogram"
    }

    fn apply_order(&self) -> Option<ApplyOrder> {
        Some(ApplyOrder::BottomUp)
    }

    fn supports_rewrite(&self) -> bool {
        true
    }

    fn rewrite(
        &self,
        plan: LogicalPlan,
        config: &dyn OptimizerConfig,
    ) -> Result<Transformed<LogicalPlan>> {
        if plan
            .expressions()
            .iter()
            .any(|expr| expr.exists(|expr| Ok(is_histogram(expr))).unwrap())
        {
            let mut expr_rewriter = HistogramToDatebin::new(
                self.start_time,
                self.end_time,
                self.histogram_interval,
                config.options(),
            );

            let name_preserver = NamePreserver::new(&plan);
            plan.map_expressions(|expr| {
                let original_name = name_preserver.save(&expr);
                expr.rewrite(&mut expr_rewriter)
                    .map(|transformed| transformed.update_data(|e| original_name.restore(e)))
            })
        } else {
            Ok(Transformed::no(plan))
        }
    }
}

fn is_histogram(expr: &Expr) -> bool {
    matches!(expr, Expr::ScalarFunction(ScalarFunction { func, .. }) if func.name() == HISTOGRAM_UDF_NAME)
}

// Rewriter for histogram() to date_bin()
#[derive(Debug, Clone)]
pub struct HistogramToDatebin {
    start_time: i64,
    end_time: i64,
    histogram_interval: i64,
    options: Arc<ConfigOptions>,
}

impl HistogramToDatebin {
    pub fn new(
        start_time: i64,
        end_time: i64,
        histogram_interval: i64,
        options: Arc<ConfigOptions>,
    ) -> Self {
        Self {
            start_time,
            end_time,
            histogram_interval,
            options,
        }
    }
}

impl TreeNodeRewriter for HistogramToDatebin {
    type Node = Expr;

    fn f_up(&mut self, expr: Expr) -> Result<Transformed<Expr>, DataFusionError> {
        match &expr {
            Expr::ScalarFunction(ScalarFunction { func, args }) => {
                let name = func.name();
                if name == HISTOGRAM_UDF_NAME {
                    let new_func = Arc::new(ScalarUDF::from(DateBinFunc::new()));
                    // construct interval
                    let arg1 = if args.len() == 1 {
                        let interval = if self.histogram_interval > 0 {
                            format!("{} second", self.histogram_interval)
                        } else {
                            generate_histogram_interval(Some((self.start_time, self.end_time)))
                                .to_string()
                        };
                        cast(
                            Expr::Literal(ScalarValue::from(interval), None),
                            DataType::Interval(IntervalUnit::MonthDayNano),
                        )
                    } else if args.len() == 2 {
                        if let Expr::Literal(ScalarValue::Utf8(_), _) = &args[1] {
                            cast(
                                args[1].clone(),
                                DataType::Interval(IntervalUnit::MonthDayNano),
                            )
                        } else {
                            return Err(DataFusionError::Internal(format!(
                                "Unexpected argument type in histogram function: {:?}",
                                args[1]
                            )));
                        }
                    } else {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument len in histogram function: {:?}",
                            args.len()
                        )));
                    };
                    // construct expression
                    let arg2 = Expr::ScalarFunction(ScalarFunction {
                        func: Arc::new(ScalarUDF::from(ToTimestampMicrosFunc::new_with_config(
                            &self.options,
                        ))),
                        args: vec![args[0].clone()],
                    });
                    // construct optional origin-timestamp
                    let arg3 = Expr::ScalarFunction(ScalarFunction {
                        func: Arc::new(ScalarUDF::from(ToTimestampFunc::new_with_config(
                            &self.options,
                        ))),
                        args: vec![Expr::Literal(
                            ScalarValue::from("2001-01-01T00:00:00"),
                            None,
                        )],
                    });
                    return Ok(Transformed::yes(Expr::ScalarFunction(ScalarFunction {
                        func: new_func,
                        args: vec![arg1, arg2, arg3],
                    })));
                }
                Ok(Transformed::no(expr))
            }
            _ => Ok(Transformed::no(expr)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, StringArray};
    use arrow_schema::DataType;
    use datafusion::{
        arrow::{
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        assert_batches_eq,
        datasource::MemTable,
        prelude::SessionContext,
    };

    use crate::service::search::datafusion::{
        optimizer::logical_optimizer::rewrite_histogram::RewriteHistogram, udf::histogram_udf,
    };

    #[tokio::test]
    async fn test_rewrite_histogram_interval() {
        let sqls = [
            (
                "select histogram(_timestamp) from t",
                vec![
                    "+-------------------------+",
                    "| histogram(t._timestamp) |",
                    "+-------------------------+",
                    "| 1970-01-01T00:00:00     |",
                    "| 1970-01-01T00:00:00     |",
                    "| 1970-01-01T00:00:00     |",
                    "| 1970-01-01T00:00:00     |",
                    "| 1970-01-01T00:00:00     |",
                    "+-------------------------+",
                ],
            ),
            (
                "select histogram(_timestamp, '30 second') from t",
                vec![
                    "+-------------------------------------------+",
                    "| histogram(t._timestamp,Utf8(\"30 second\")) |",
                    "+-------------------------------------------+",
                    "| 1970-01-01T00:00:00                       |",
                    "| 1970-01-01T00:00:00                       |",
                    "| 1970-01-01T00:00:00                       |",
                    "| 1970-01-01T00:00:00                       |",
                    "| 1970-01-01T00:00:00                       |",
                    "+-------------------------------------------+",
                ],
            ),
        ];

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3, 4, 5])),
                Arc::new(StringArray::from(vec![
                    "open",
                    "observe",
                    "openobserve",
                    "o2",
                    "oo",
                ])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());
        ctx.add_optimizer_rule(Arc::new(RewriteHistogram::new(0, 5, 0)));

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }
}
