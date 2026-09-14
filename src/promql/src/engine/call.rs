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

//! PromQL function-call dispatch and argument helpers. Touches only
//! `eval_ctx` besides recursing through `exec_expr`.

use std::{str::FromStr, sync::Arc};

use config::meta::promql::value::*;
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{Expr as PromExpr, Function, FunctionArgs, MatrixSelector};

use super::Engine;
use crate::functions::{self, Func};

impl Engine {
    pub(super) async fn call_expr(
        &mut self,
        func: &Function,
        args: &FunctionArgs,
    ) -> Result<Value> {
        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        // a range function over a plain matrix selector streams its series one at a time
        if let Some(range_func) = func_name.range_func()
            && let [arg] = args.args.as_slice()
            && let PromExpr::MatrixSelector(MatrixSelector { vs, range }) = arg.as_ref()
            && let Some(value) = self
                .try_streaming_range_func(vs, *range, Arc::from(range_func))
                .await?
        {
            return Ok(value);
        }

        if func_name == Func::Time {
            self.ensure_args_len(args, 0, "Invalid args passed to the function")?;
            // TODO: check this implementation
            return Ok(Value::Float((self.eval_ctx.start / 1_000_000) as f64));
        }

        let start = std::time::Instant::now();
        let result = if let Some(range_func) = func_name.range_func() {
            let input = self.call_expr_arg(args, 0).await?;
            functions::eval_range(input, range_func, &self.eval_ctx)?
        } else {
            self.call_builtin(func_name, args).await?
        };
        log::info!(
            "[trace_id: {}] [PromQL Timing] call_expr({}) execution took: {:?}",
            self.trace_id,
            func.name,
            start.elapsed()
        );
        Ok(result)
    }

    async fn call_builtin(&mut self, func_name: Func, args: &FunctionArgs) -> Result<Value> {
        Ok(match func_name {
            Func::Clamp => {
                let err = "Invalid args, expected clamp(v instant-vector, min scalar, max scalar)";
                self.ensure_args_len(args, 3, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let min = self.call_expr_arg(args, 1).await?;
                let min_f = self.parse_f64_else_err(&min, err)?;
                let max = self.call_expr_arg(args, 2).await?;
                let max_f = self.parse_f64_else_err(&max, err)?;

                if min_f > max_f {
                    return Ok(Value::Matrix(vec![]));
                }
                functions::clamp(input, min_f, max_f)?
            }
            Func::ClampMax => {
                let err = "Invalid args, expected clamp(v instant-vector, max scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let max = self.call_expr_arg(args, 1).await?;
                let max_f = self.parse_f64_else_err(&max, err)?;

                functions::clamp(input, f64::MIN, max_f)?
            }
            Func::ClampMin => {
                let err = "Invalid args, expected clamp(v instant-vector, min scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let min = self.call_expr_arg(args, 1).await?;
                let min_f = self.parse_f64_else_err(&min, err)?;

                functions::clamp(input, min_f, f64::MAX)?
            }
            Func::HistogramQuantile => {
                let err = "Invalid args, expected histogram_quantile(phi scalar, b instant-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi = self.call_expr_arg(args, 0).await?;
                let phi_f = self.parse_f64_else_err(&phi, err)?;
                let input = self.call_expr_arg(args, 1).await?;

                functions::histogram_quantile(phi_f, input, &self.eval_ctx)?
            }
            Func::HoltWinters => {
                let err =
                    "Invalid args, expected holt_winters(v range-vector, sf scalar, tf scalar)";
                self.ensure_args_len(args, 3, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let sf = self.call_expr_arg(args, 1).await?;
                let scaling_factor = self.parse_f64_else_err(&sf, err)?;
                let tf = self.call_expr_arg(args, 2).await?;
                let trend_factor = self.parse_f64_else_err(&tf, err)?;

                functions::holt_winters(input, scaling_factor, trend_factor, &self.eval_ctx)?
            }
            Func::LabelJoin => {
                let err = "Invalid args, expected label_join(v instant-vector, dst string, sep string, src_1 string, src_2 string, ...)";
                self.ensure_ge_three_args(args, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let dst_label = self.call_expr_arg(args, 1).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid destination label found".into()),
                )?;
                let separator = self.call_expr_arg(args, 2).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid separator label found".into()),
                )?;
                let mut source_labels = vec![];
                for each_src in args.args[3..].iter() {
                    if let Value::String(label) = self.exec_expr(each_src).await.unwrap() {
                        source_labels.push(label);
                    };
                }
                if source_labels.is_empty() {
                    return Err(DataFusionError::NotImplemented(
                        "source labels can not be empty or invalid".into(),
                    ));
                }
                functions::label_join(input, &dst_label, &separator, source_labels)?
            }
            Func::LabelReplace => {
                let err = "Invalid args, expected label_replace(v instant-vector, dst_label string, replacement string, src_label string, regex string)";
                self.ensure_args_len(args, 5, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let dst_label = self.call_expr_arg(args, 1).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid destination label found".into()),
                )?;
                let replacement = self.call_expr_arg(args, 2).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid replacement string found".into()),
                )?;
                let src_label = self.call_expr_arg(args, 3).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid source label string found".into()),
                )?;
                let regex = self.call_expr_arg(args, 4).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid regex string found".into()),
                )?;

                functions::label_replace(input, &dst_label, &replacement, &src_label, &regex)?
            }
            Func::PredictLinear => {
                let err = "Invalid args, expected predict_linear(v range-vector, t scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let prediction_steps = self.call_expr_arg(args, 1).await?;
                let prediction_steps_f = self.parse_f64_else_err(&prediction_steps, err)?;

                functions::predict_linear(input, prediction_steps_f, &self.eval_ctx)?
            }
            Func::QuantileOverTime => {
                let err = "Invalid args, expected quantile_over_time(scalar, range-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi_quantile = self.call_expr_arg(args, 0).await?;
                let phi_quantile_f = self.parse_f64_else_err(&phi_quantile, err)?;
                let input = self.call_expr_arg(args, 1).await?;

                functions::quantile_over_time(phi_quantile_f, input, &self.eval_ctx)?
            }
            Func::Round => {
                let err = "Invalid args, expected round(v instant-vector, to_nearest=1 scalar)";
                let input = self.call_expr_arg(args, 0).await?;
                let to_nearest = match args.len() {
                    1 => 1.0,
                    2 => {
                        let to_nearest = self.call_expr_arg(args, 1).await?;
                        self.parse_f64_else_err(&to_nearest, err)?
                    }
                    _ => return Err(DataFusionError::NotImplemented(err.into())),
                };

                functions::round(input, to_nearest)?
            }
            Func::HistogramCount
            | Func::HistogramFraction
            | Func::HistogramSum
            | Func::Sort
            | Func::SortDesc => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            _ => self.call_single_arg_builtin(func_name, args).await?,
        })
    }

    async fn call_single_arg_builtin(
        &mut self,
        func_name: Func,
        args: &FunctionArgs,
    ) -> Result<Value> {
        let input = if matches!(
            func_name,
            Func::DayOfMonth
                | Func::DayOfWeek
                | Func::DayOfYear
                | Func::DaysInMonth
                | Func::Hour
                | Func::Minute
                | Func::Month
                | Func::Year
        ) {
            match args.len() {
                0 => Value::Matrix(vec![RangeValue {
                    labels: Labels::default(),
                    samples: self
                        .eval_ctx
                        .timestamps()
                        .into_iter()
                        .map(|ts| Sample::new(ts, ts as f64))
                        .collect(),
                    exemplars: None,
                    time_window: None,
                }]),
                1 => self.call_expr_arg(args, 0).await?,
                _ => {
                    return Err(DataFusionError::NotImplemented(
                        "Invalid args passed to the function".into(),
                    ));
                }
            }
        } else {
            self.call_expr_arg(args, 0).await?
        };

        Ok(match func_name {
            Func::Abs => functions::abs(input)?,
            Func::Absent => functions::absent(input, &self.eval_ctx)?,
            Func::AbsentOverTime => functions::absent_over_time(input, &self.eval_ctx)?,
            Func::Ceil => functions::ceil(input)?,
            Func::DayOfMonth => functions::day_of_month(input)?,
            Func::DayOfWeek => functions::day_of_week(input)?,
            Func::DayOfYear => functions::day_of_year(input)?,
            Func::DaysInMonth => functions::days_in_month(input)?,
            Func::Exp => functions::exp(input)?,
            Func::Floor => functions::floor(input)?,
            Func::Hour => functions::hour(input)?,
            Func::Ln => functions::ln(input)?,
            Func::Log10 => functions::log10(input)?,
            Func::Log2 => functions::log2(input)?,
            Func::Minute => functions::minute(input)?,
            Func::Month => functions::month(input)?,
            Func::Scalar => functions::scalar(input, &self.eval_ctx)?,
            Func::Sgn => functions::sgn(input)?,
            Func::Sqrt => functions::sqrt(input)?,
            Func::Timestamp => functions::timestamp(input)?,
            Func::Vector => functions::vector(input, &self.eval_ctx)?,
            Func::Year => functions::year(input)?,
            _ => {
                return Err(DataFusionError::Internal(format!(
                    "{func_name:?} must be evaluated before builtin dispatch"
                )));
            }
        })
    }

    async fn call_expr_arg(&mut self, args: &FunctionArgs, index: usize) -> Result<Value> {
        let arg = args
            .args
            .get(index)
            .ok_or_else(|| DataFusionError::NotImplemented(format!("Missing argument {index}")))?;
        self.exec_expr(arg).await
    }

    fn ensure_args_len(&self, args: &FunctionArgs, count: usize, err: &str) -> Result<()> {
        if args.len() != count {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn ensure_ge_three_args(&self, args: &FunctionArgs, err: &str) -> Result<()> {
        if args.len() < 3 {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn parse_f64_else_err<T: Into<String>>(&self, value: &Value, err: T) -> Result<f64> {
        match value {
            Value::Float(f) => Ok(*f),
            _ => Err(DataFusionError::NotImplemented(err.into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use promql_parser::parser::{FunctionArgs, NumberLiteral};

    use super::*;
    use crate::{engine::tests::*, exec::PromqlContext};

    struct CountingProvider(Arc<std::sync::atomic::AtomicUsize>);

    #[async_trait::async_trait]
    impl crate::TableProvider for CountingProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _matchers: promql_parser::label::Matchers,
            _label_selector: hashbrown::HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> Result<
            Vec<(
                datafusion::prelude::SessionContext,
                Arc<datafusion::arrow::datatypes::Schema>,
                config::meta::search::ScanStats,
                bool,
            )>,
        > {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn test_quantile_over_time_reads_range_argument_once() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                CountingProvider(calls.clone()),
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let expr = promql_parser::parser::parse("quantile_over_time(0.95, m[5m])").unwrap();
        let value = engine.exec_expr(&expr).await.unwrap();
        assert!(matches!(value, Value::None));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_clamp_reads_scalar_argument_once() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                CountingProvider(calls.clone()),
                vec![],
            )),
            EvalContext::new(1_000_000, 1_000_000, 1_000_000, "test".into()),
        );
        let expr =
            promql_parser::parser::parse("clamp_min(vector(5), scalar(m) > bool 0)").unwrap();
        let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
            panic!("expected clamped matrix");
        };
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].samples[0].value, 5.0);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_call_dispatch_preserves_values() {
        let eval_ctx = EvalContext::new(1_000_000, 1_000_000, 1_000_000, "test".into());
        for (query, expected) in [
            ("time()", 1.0),
            ("day_of_month()", 12.0),
            ("day_of_month(vector(1000000))", 12.0),
            ("clamp(vector(5), 1, 3)", 3.0),
            ("clamp_min(vector(5), 7)", 7.0),
            ("clamp_max(vector(5), 3)", 3.0),
            ("round(vector(2.5))", 3.0),
            ("round(vector(-2.5))", -2.0),
            ("round(vector(2.6), 0.5)", 2.5),
            ("round(vector(12.5), 5)", 15.0),
            ("3 < vector(5)", 5.0),
            ("3 < bool vector(5)", 1.0),
            ("7 < bool vector(5)", 0.0),
            ("quantile_over_time(0.5, vector(5)[1m:1s])", 5.0),
            ("predict_linear(vector(5)[1m:1s], 10)", 5.0),
            (r#"label_join(vector(5), "dst", ",", "src")"#, 5.0),
            (
                r#"label_replace(vector(5), "dst", "$1", "src", "(.*)")"#,
                5.0,
            ),
        ] {
            let mut engine = Engine::new(
                "test",
                Arc::new(PromqlContext::new(
                    create_test_query_ctx("test", "test_org", 30),
                    SimpleMockProvider,
                    vec![],
                )),
                eval_ctx.clone(),
            );
            let expr = promql_parser::parser::parse(query).unwrap();
            match engine.exec_expr(&expr).await.unwrap() {
                Value::Float(value) => assert_eq!(value, expected, "{query}"),
                Value::Matrix(series) => {
                    assert_eq!(series.len(), 1, "{query}");
                    assert_eq!(series[0].samples.len(), 1, "{query}");
                    assert_eq!(series[0].samples[0].value, expected, "{query}");
                }
                value => panic!("unexpected result for {query}: {value:?}"),
            }
        }
    }

    #[test]
    fn test_ensure_two_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
            ],
        };
        let result = engine.ensure_args_len(&args, 2, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_args_len(&args, 2, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_three_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
            ],
        };
        let result = engine.ensure_args_len(&args, 3, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_args_len(&args, 3, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_ge_three_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
            ],
        };
        let result = engine.ensure_ge_three_args(&args, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
            ],
        };
        let result = engine.ensure_ge_three_args(&args, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_five_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 4.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 5.0 })),
            ],
        };
        let result = engine.ensure_args_len(&args, 5, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_args_len(&args, 5, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_f64_else_err() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let value = Value::Float(42.0);
        let result = engine.parse_f64_else_err(&value, "test error");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42.0);

        let value = Value::String("not a float".to_string());
        let result = engine.parse_f64_else_err(&value, "test error");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_call_expr_first_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 42.0,
            }))],
        };
        let result = engine.call_expr_arg(&args, 0).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_second_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_arg(&args, 1).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_third_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_arg(&args, 2).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_fourth_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 30.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_arg(&args, 3).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_fifth_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 30.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 40.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_arg(&args, 4).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }
}
