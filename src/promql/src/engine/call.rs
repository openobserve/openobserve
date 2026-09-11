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
use crate::functions::{self, Func, RangeFunc, SingleArgFunc};

impl Engine {
    pub(super) async fn call_expr(
        &mut self,
        func: &Function,
        args: &FunctionArgs,
    ) -> Result<Value> {
        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        // TODO: check this implementation
        if func_name == Func::Time {
            self.ensure_args_len(args, 0, "Invalid args passed to the function")?;
            return Ok(Value::Float((self.eval_ctx.start / 1_000_000) as f64));
        }

        let start = std::time::Instant::now();
        let result = if let Some(range_func) = func_name.range_func() {
            // a range function over a plain matrix selector streams its series one at a time
            if let [arg] = args.args.as_slice()
                && let PromExpr::MatrixSelector(MatrixSelector { vs, range }) = arg.as_ref()
            {
                let range_func: Arc<dyn RangeFunc> = Arc::from(range_func);
                if let Some(value) = self
                    .try_streaming_range_func(vs, *range, Arc::clone(&range_func))
                    .await?
                {
                    return Ok(value);
                }
                let input = self.call_expr_arg(args, 0).await?;
                functions::eval_range(input, range_func, &self.eval_ctx)?
            } else {
                let input = self.call_expr_arg(args, 0).await?;
                functions::eval_range(input, range_func, &self.eval_ctx)?
            }
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
                let min_f = self.call_scalar_arg(args, 1, err).await?;
                let max_f = self.call_scalar_arg(args, 2, err).await?;

                if min_f > max_f {
                    return Ok(Value::Matrix(vec![]));
                }
                functions::clamp(input, min_f, max_f)?
            }
            Func::ClampMax => {
                let err = "Invalid args, expected clamp(v instant-vector, max scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let max_f = self.call_scalar_arg(args, 1, err).await?;

                functions::clamp(input, f64::MIN, max_f)?
            }
            Func::ClampMin => {
                let err = "Invalid args, expected clamp(v instant-vector, min scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let min_f = self.call_scalar_arg(args, 1, err).await?;

                functions::clamp(input, min_f, f64::MAX)?
            }
            Func::HistogramQuantile => {
                let err = "Invalid args, expected histogram_quantile(phi scalar, b instant-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi_f = self.call_scalar_arg(args, 0, err).await?;
                let input = self.call_expr_arg(args, 1).await?;

                functions::histogram_quantile(phi_f, input, &self.eval_ctx)?
            }
            Func::HoltWinters => {
                let err =
                    "Invalid args, expected holt_winters(v range-vector, sf scalar, tf scalar)";
                self.ensure_args_len(args, 3, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let scaling_factor = self.call_scalar_arg(args, 1, err).await?;
                let trend_factor = self.call_scalar_arg(args, 2, err).await?;

                functions::holt_winters(input, scaling_factor, trend_factor, &self.eval_ctx)?
            }
            Func::LabelJoin => {
                let err = "Invalid args, expected label_join(v instant-vector, dst string, sep string, src_1 string, src_2 string, ...)";
                if args.len() < 3 {
                    return Err(DataFusionError::NotImplemented(err.into()));
                }
                let input = self.call_expr_arg(args, 0).await?;
                let dst_label = self
                    .call_string_arg(args, 1, "Invalid destination label found")
                    .await?;
                let separator = self
                    .call_string_arg(args, 2, "Invalid separator label found")
                    .await?;
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
                let dst_label = self
                    .call_string_arg(args, 1, "Invalid destination label found")
                    .await?;
                let replacement = self
                    .call_string_arg(args, 2, "Invalid replacement string found")
                    .await?;
                let src_label = self
                    .call_string_arg(args, 3, "Invalid source label string found")
                    .await?;
                let regex = self
                    .call_string_arg(args, 4, "Invalid regex string found")
                    .await?;

                functions::label_replace(input, &dst_label, &replacement, &src_label, &regex)?
            }
            Func::PredictLinear => {
                let err = "Invalid args, expected predict_linear(v range-vector, t scalar)";
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let prediction_steps_f = self.call_scalar_arg(args, 1, err).await?;

                functions::predict_linear(input, prediction_steps_f, &self.eval_ctx)?
            }
            Func::QuantileOverTime => {
                let err = "Invalid args, expected quantile_over_time(scalar, range-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi_quantile_f = self.call_scalar_arg(args, 0, err).await?;
                let input = self.call_expr_arg(args, 1).await?;

                functions::quantile_over_time(phi_quantile_f, input, &self.eval_ctx)?
            }
            Func::Round => {
                let err = "Invalid args, expected round(v instant-vector, to_nearest=1 scalar)";
                let input = self.call_expr_arg(args, 0).await?;
                let to_nearest = match args.len() {
                    1 => 1.0,
                    2 => self.call_scalar_arg(args, 1, err).await?,
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
        let single_arg_func = func_name.single_arg_func();
        let input = if matches!(single_arg_func, Some(SingleArgFunc::Date(_))) {
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

        single_arg_func
            .ok_or_else(|| {
                DataFusionError::Internal(format!(
                    "{func_name:?} must be evaluated before builtin dispatch"
                ))
            })?
            .eval(input, &self.eval_ctx)
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

    async fn call_scalar_arg(
        &mut self,
        args: &FunctionArgs,
        index: usize,
        err: &str,
    ) -> Result<f64> {
        match self.call_expr_arg(args, index).await? {
            Value::Float(value) => Ok(value),
            _ => Err(DataFusionError::NotImplemented(err.into())),
        }
    }

    async fn call_string_arg(
        &mut self,
        args: &FunctionArgs,
        index: usize,
        err: &str,
    ) -> Result<String> {
        self.call_expr_arg(args, index)
            .await?
            .get_string()
            .ok_or_else(|| DataFusionError::NotImplemented(err.into()))
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

    #[tokio::test]
    async fn test_single_arg_dispatch_preserves_argument_handling() {
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
        let args = FunctionArgs {
            args: ["vector(-5)", "m"]
                .into_iter()
                .map(|expr| Box::new(promql_parser::parser::parse(expr).unwrap()))
                .collect(),
        };
        let Value::Matrix(series) = engine.call_builtin(Func::Abs, &args).await.unwrap() else {
            panic!("expected absolute values");
        };
        assert_eq!(series[0].samples[0].value, 5.0);
        for func in [
            Func::DayOfMonth,
            Func::DayOfWeek,
            Func::DayOfYear,
            Func::DaysInMonth,
            Func::Hour,
            Func::Minute,
            Func::Month,
            Func::Year,
        ] {
            assert!(matches!(
                engine.call_builtin(func, &args).await,
                Err(DataFusionError::NotImplemented(message))
                    if message == "Invalid args passed to the function"
            ));
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(matches!(
            engine.call_builtin(Func::Abs, &FunctionArgs { args: vec![] }).await,
            Err(DataFusionError::NotImplemented(message)) if message == "Missing argument 0"
        ));
    }

    #[test]
    fn test_ensure_args_len() {
        let engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        for expected in [0, 2, 3, 5] {
            for actual in 0..=6 {
                let args = FunctionArgs {
                    args: (0..actual)
                        .map(|_| Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })))
                        .collect(),
                };
                let result = engine.ensure_args_len(&args, expected, "test error");
                if actual == expected {
                    assert!(result.is_ok());
                } else {
                    assert!(
                        matches!(result, Err(DataFusionError::NotImplemented(message)) if message == "test error")
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_label_join_missing_arguments() {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        for (expressions, expected) in [
            (
                vec!["vector(5)", r#""dst""#],
                "Invalid args, expected label_join(v instant-vector, dst string, sep string, src_1 string, src_2 string, ...)",
            ),
            (
                vec!["vector(5)", r#""dst""#, r#"",""#],
                "source labels can not be empty or invalid",
            ),
        ] {
            let args = FunctionArgs {
                args: expressions
                    .into_iter()
                    .map(|expr| Box::new(promql_parser::parser::parse(expr).unwrap()))
                    .collect(),
            };
            let result = engine.call_builtin(Func::LabelJoin, &args).await;
            assert!(
                matches!(result, Err(DataFusionError::NotImplemented(message)) if message == expected)
            );
        }
    }

    #[tokio::test]
    async fn test_typed_arguments() {
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
                Box::new(promql_parser::parser::parse("42").unwrap()),
                Box::new(promql_parser::parser::parse(r#""text""#).unwrap()),
            ],
        };
        assert_eq!(
            engine
                .call_scalar_arg(&args, 0, "scalar error")
                .await
                .unwrap(),
            42.0
        );
        assert_eq!(
            engine
                .call_string_arg(&args, 1, "string error")
                .await
                .unwrap(),
            "text"
        );
        for (result, expected) in [
            (
                engine
                    .call_scalar_arg(&args, 1, "scalar error")
                    .await
                    .map(|_| ()),
                "scalar error",
            ),
            (
                engine
                    .call_string_arg(&args, 0, "string error")
                    .await
                    .map(|_| ()),
                "string error",
            ),
            (
                engine
                    .call_scalar_arg(&args, 2, "scalar error")
                    .await
                    .map(|_| ()),
                "Missing argument 2",
            ),
            (
                engine
                    .call_string_arg(&args, 2, "string error")
                    .await
                    .map(|_| ()),
                "Missing argument 2",
            ),
        ] {
            assert!(
                matches!(result, Err(DataFusionError::NotImplemented(message)) if message == expected)
            );
        }
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
