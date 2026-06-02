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

use arrow_schema::{DataType, IntervalUnit};
use config::utils::time::parse_timezone_to_offset_at;
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
    logical_expr::{
        BinaryExpr, Expr, LogicalPlan, Operator, ScalarUDF, cast, expr::ScalarFunction,
    },
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
    /// Request-level default fixed-offset timezone applied to histogram() buckets
    /// that don't carry their own 3rd timezone argument.
    timezone: Option<String>,
}

impl RewriteHistogram {
    #[allow(missing_docs)]
    pub fn new(
        start_time: i64,
        end_time: i64,
        histogram_interval: i64,
        timezone: Option<String>,
    ) -> Self {
        Self {
            start_time,
            end_time,
            histogram_interval,
            timezone,
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
                self.timezone.clone(),
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

/// Resolve the optional timezone argument of `histogram()` into an offset in
/// microseconds east of UTC, evaluated at `reference_micros`.
///
/// `None`, `"UTC"`, and `""` all map to `0`. A fixed offset such as `"+08:00"` /
/// `"-05:30"`, or an IANA name such as `"America/Los_Angeles"`, maps to its signed
/// offset (for a named zone, the offset in effect at `reference_micros`). Anything we
/// cannot parse returns an error rather than panicking, since the value comes from
/// user-supplied SQL / request input.
fn histogram_timezone_offset_micros(
    timezone: Option<&str>,
    reference_micros: i64,
) -> Result<i64, DataFusionError> {
    let offset_secs = match timezone {
        None => 0,
        Some(tz) => parse_timezone_to_offset_at(tz, reference_micros).ok_or_else(|| {
            DataFusionError::Plan(format!(
                "Invalid timezone in histogram(): '{tz}'. Expected a fixed offset like '+08:00' / '-05:00', 'UTC', or an IANA name like 'America/Los_Angeles'."
            ))
        })?,
    };
    Ok(offset_secs * 1_000_000)
}

// Rewriter for histogram() to date_bin()
#[derive(Debug, Clone)]
pub struct HistogramToDatebin {
    start_time: i64,
    end_time: i64,
    histogram_interval: i64,
    timezone: Option<String>,
    options: Arc<ConfigOptions>,
}

impl HistogramToDatebin {
    pub fn new(
        start_time: i64,
        end_time: i64,
        histogram_interval: i64,
        timezone: Option<String>,
        options: Arc<ConfigOptions>,
    ) -> Self {
        Self {
            start_time,
            end_time,
            histogram_interval,
            timezone,
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
                    if args.is_empty() || args.len() > 3 {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument len in histogram function: {:?}",
                            args.len()
                        )));
                    }
                    let new_func = Arc::new(ScalarUDF::from(DateBinFunc::new()));
                    // construct interval (date_bin arg #1)
                    let arg1 = if args.len() == 1 {
                        let interval = if self.histogram_interval > 0 {
                            format!("{} second", self.histogram_interval)
                        } else {
                            generate_histogram_interval((self.start_time, self.end_time))
                                .to_string()
                        };
                        cast(
                            Expr::Literal(ScalarValue::from(interval), None),
                            DataType::Interval(IntervalUnit::MonthDayNano),
                        )
                    } else if let Expr::Literal(ScalarValue::Utf8(_), _) = &args[1] {
                        // args.len() == 2 or 3; the interval is always the 2nd argument
                        cast(
                            args[1].clone(),
                            DataType::Interval(IntervalUnit::MonthDayNano),
                        )
                    } else {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument type in histogram function: {:?}",
                            args[1]
                        )));
                    };
                    // Resolve the timezone into a microsecond offset. An explicit 3rd
                    // histogram argument wins; otherwise fall back to the request-level
                    // default timezone (None => UTC). Named (IANA) zones are resolved to
                    // their offset at the query's most-recent edge.
                    let reference_micros = if self.end_time > 0 {
                        self.end_time
                    } else {
                        self.start_time
                    };
                    let offset_micros = match args.get(2) {
                        Some(Expr::Literal(ScalarValue::Utf8(tz), _)) => {
                            histogram_timezone_offset_micros(tz.as_deref(), reference_micros)?
                        }
                        Some(other) => {
                            return Err(DataFusionError::Internal(format!(
                                "Unexpected timezone argument type in histogram function: {other:?}"
                            )));
                        }
                        None => histogram_timezone_offset_micros(
                            self.timezone.as_deref(),
                            reference_micros,
                        )?,
                    };
                    // construct source timestamp (date_bin arg #2). When a timezone is
                    // given we shift the source (microseconds) by its offset so the
                    // buckets — and the returned values — are expressed in local
                    // wall-clock time rather than UTC.
                    let source = if offset_micros != 0 {
                        Expr::BinaryExpr(BinaryExpr::new(
                            Box::new(args[0].clone()),
                            Operator::Plus,
                            Box::new(Expr::Literal(ScalarValue::Int64(Some(offset_micros)), None)),
                        ))
                    } else {
                        args[0].clone()
                    };
                    let arg2 = Expr::ScalarFunction(ScalarFunction {
                        func: Arc::new(ScalarUDF::from(ToTimestampMicrosFunc::new_with_config(
                            &self.options,
                        ))),
                        args: vec![source],
                    });
                    // construct origin timestamp (date_bin arg #3). The origin stays at
                    // UTC midnight; the source carries the timezone shift instead.
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
        optimizer::OptimizerRule,
        prelude::SessionContext,
    };

    use crate::service::search::datafusion::{
        optimizer::logical_optimizer::rewrite_histogram::RewriteHistogram, udf::histogram_udf,
    };

    #[test]
    fn test_rewrite_histogram_rule_name() {
        let rule = RewriteHistogram::new(0, 1000, 60, None);
        assert_eq!(rule.name(), "rewrite_histogram");
    }

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
        ctx.add_optimizer_rule(Arc::new(RewriteHistogram::new(0, 5, 0, None)));

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[test]
    fn test_histogram_timezone_offset_micros() {
        // 2024-01-01T00:00:00Z reference instant
        let r = 1_704_067_200_000_000;
        // no timezone / UTC / empty => no shift
        assert_eq!(super::histogram_timezone_offset_micros(None, r).unwrap(), 0);
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("UTC"), r).unwrap(),
            0
        );
        assert_eq!(
            super::histogram_timezone_offset_micros(Some(""), r).unwrap(),
            0
        );
        // fixed offsets => signed microseconds east of UTC
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("+08:00"), r).unwrap(),
            8 * 3600 * 1_000_000
        );
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("-05:00"), r).unwrap(),
            -5 * 3600 * 1_000_000
        );
        // fractional offset (e.g. IST +05:30)
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("+05:30"), r).unwrap(),
            (5 * 3600 + 30 * 60) * 1_000_000
        );
        // IANA names are now supported -> resolved to their offset at the reference
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("Asia/Shanghai"), r).unwrap(),
            8 * 3600 * 1_000_000
        );
        // America/Los_Angeles is PST (-8h) on 2024-01-01
        assert_eq!(
            super::histogram_timezone_offset_micros(Some("America/Los_Angeles"), r).unwrap(),
            -8 * 3600 * 1_000_000
        );
        // genuinely invalid input still errors (not a panic)
        assert!(super::histogram_timezone_offset_micros(Some("Not/AZone"), r).is_err());
    }

    /// Run a single-row, single-column histogram query and return the bucket value
    /// in microseconds.
    async fn run_histogram_micros(ctx: &SessionContext, sql: &str) -> i64 {
        use datafusion::arrow::array::TimestampMicrosecondArray;
        let data = ctx.sql(sql).await.unwrap().collect().await.unwrap();
        data[0]
            .column(0)
            .as_any()
            .downcast_ref::<TimestampMicrosecondArray>()
            .expect("histogram output should be Timestamp(Microsecond)")
            .value(0)
    }

    fn histogram_test_ctx(ts: i64, timezone: Option<&str>) -> SessionContext {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![ts])),
                Arc::new(StringArray::from(vec!["openobserve"])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());
        ctx.add_optimizer_rule(Arc::new(RewriteHistogram::new(
            0,
            ts,
            0,
            timezone.map(|s| s.to_string()),
        )));
        ctx
    }

    // Microsecond timestamps used by the timezone tests.
    const TS_2024_01_01T18: i64 = 1_704_132_000_000_000; // 2024-01-01T18:00:00Z
    const D_2024_01_01: i64 = 1_704_067_200_000_000; // 2024-01-01T00:00:00 (wall clock)
    const D_2024_01_02: i64 = 1_704_153_600_000_000; // 2024-01-02T00:00:00 (wall clock)
    const HOUR_US: i64 = 3600 * 1_000_000;

    #[tokio::test]
    async fn test_rewrite_histogram_timezone_daily() {
        // Source instant 2024-01-01T18:00:00Z. With a timezone the returned bucket is
        // expressed in *local wall-clock* time, not as a UTC instant.
        let ctx = histogram_test_ctx(TS_2024_01_01T18, None);

        // UTC: 18:00Z is in the UTC day 2024-01-01 -> 2024-01-01T00:00:00
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 day') from t").await,
            D_2024_01_01,
        );
        // +08:00: local time is 2024-01-02T02:00:00 -> day bucket 2024-01-02T00:00:00
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', '+08:00') from t"
            )
            .await,
            D_2024_01_02,
        );
        // +05:30: local time is 2024-01-01T23:30:00 -> still day bucket 2024-01-01T00:00:00
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', '+05:30') from t"
            )
            .await,
            D_2024_01_01,
        );
    }

    #[tokio::test]
    async fn test_rewrite_histogram_timezone_hourly() {
        // Source instant 2024-01-01T18:00:00Z.
        let ctx = histogram_test_ctx(TS_2024_01_01T18, None);

        // UTC: top of the hour at 18:00Z
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 hour') from t").await,
            TS_2024_01_01T18,
        );
        // +08:00: local time 2024-01-02T02:00:00, already on the hour -> 02:00 local
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 hour', '+08:00') from t"
            )
            .await,
            D_2024_01_02 + 2 * HOUR_US, // 2024-01-02T02:00:00
        );
        // +05:30 (IST): local time 2024-01-01T23:30:00 -> floors to the local hour 23:00.
        // (23:30 is the converted instant; the hourly bucket rounds down to 23:00.)
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 hour', '+05:30') from t"
            )
            .await,
            D_2024_01_01 + 23 * HOUR_US, // 2024-01-01T23:00:00
        );
    }

    #[tokio::test]
    async fn test_rewrite_histogram_request_timezone() {
        // Method 2: a request-level timezone applies to histogram() calls that have no
        // explicit 3rd argument. Source instant 2024-01-01T18:00:00Z, request +08:00.
        let ctx = histogram_test_ctx(TS_2024_01_01T18, Some("+08:00"));

        // daily, no 3rd arg -> request tz used -> local day 2024-01-02
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 day') from t").await,
            D_2024_01_02,
        );
        // hourly, no 3rd arg -> 2024-01-02T02:00:00 local
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 hour') from t").await,
            D_2024_01_02 + 2 * HOUR_US,
        );
    }

    #[tokio::test]
    async fn test_rewrite_histogram_arg_overrides_request_timezone() {
        // Precedence: an explicit 3rd argument wins over the request timezone (+08:00).
        let ctx = histogram_test_ctx(TS_2024_01_01T18, Some("+08:00"));

        // explicit '+05:30' overrides request '+08:00' -> daily local 2024-01-01
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', '+05:30') from t"
            )
            .await,
            D_2024_01_01,
        );
        // explicit 'UTC' forces UTC, overriding request '+08:00' -> UTC day 2024-01-01
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 day', 'UTC') from t").await,
            D_2024_01_01,
        );
        // explicit '+08:00' matches the request -> 2024-01-02
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', '+08:00') from t"
            )
            .await,
            D_2024_01_02,
        );
    }

    #[tokio::test]
    async fn test_rewrite_histogram_named_timezone() {
        // America/Los_Angeles on 2024-01-01 is PST (-08:00). Source 18:00Z -> local 10:00.
        let ctx = histogram_test_ctx(TS_2024_01_01T18, Some("America/Los_Angeles"));

        // daily -> local 2024-01-01T00:00:00
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', 'America/Los_Angeles') from t"
            )
            .await,
            D_2024_01_01,
        );
        // hourly -> local 2024-01-01T10:00:00
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 hour', 'America/Los_Angeles') from t"
            )
            .await,
            D_2024_01_01 + 10 * HOUR_US,
        );
        // named zone also works as the request-level default (Method 2, no 3rd arg)
        assert_eq!(
            run_histogram_micros(&ctx, "select histogram(_timestamp, '1 day') from t").await,
            D_2024_01_01,
        );
    }

    #[tokio::test]
    async fn test_rewrite_histogram_named_timezone_dst() {
        // Same zone, different season: the offset is taken at the query's reference
        // instant (end_time). 2024-07-01T18:00:00Z -> LA is PDT (-07:00) -> local 11:00.
        const TS_2024_07_01T18: i64 = 1_719_856_800_000_000;
        const D_2024_07_01: i64 = 1_719_792_000_000_000; // 2024-07-01T00:00:00 wall clock
        let ctx = histogram_test_ctx(TS_2024_07_01T18, Some("America/Los_Angeles"));

        // daily -> local 2024-07-01T00:00:00 (PDT, not PST)
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 day', 'America/Los_Angeles') from t"
            )
            .await,
            D_2024_07_01,
        );
        // hourly -> local 2024-07-01T11:00:00
        assert_eq!(
            run_histogram_micros(
                &ctx,
                "select histogram(_timestamp, '1 hour', 'America/Los_Angeles') from t"
            )
            .await,
            D_2024_07_01 + 11 * HOUR_US,
        );
    }

    #[test]
    fn test_rewrite_histogram_new_stores_fields() {
        use datafusion::optimizer::OptimizerRule;
        let rule = RewriteHistogram::new(100, 200, 50, None);
        assert_eq!(rule.name(), "rewrite_histogram");
        assert_eq!(
            rule.apply_order(),
            Some(datafusion::optimizer::optimizer::ApplyOrder::BottomUp)
        );
    }

    #[test]
    fn test_histogram_to_datebin_new_stores_fields() {
        use datafusion::config::ConfigOptions;
        let options = Arc::new(ConfigOptions::default());
        let rewriter = super::HistogramToDatebin::new(0, 1000, 60, None, options);
        let _ = rewriter;
    }
}
