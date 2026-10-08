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
use promql_parser::parser::{
    Expr as PromExpr, Function, FunctionArgs, MatrixSelector, value::ValueType,
};

use super::{Engine, selector::SelectorOutput};
use crate::{
    ast::{
        at_modifier::{Pin, pin},
        timestamp_selector::timestamp_selector,
    },
    functions::{self, Func, RangeFunc, SingleArgFunc},
    scalar_param::ScalarParam,
};

impl Engine {
    pub(super) async fn call_expr(
        &mut self,
        func: &Function,
        args: &FunctionArgs,
    ) -> Result<Value> {
        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        if func_name == Func::Time {
            self.ensure_args_len(args, 0, "Invalid args passed to the function")?;
            return Ok(functions::time(&self.eval_ctx));
        }
        if func_name == Func::Pi {
            self.ensure_args_len(args, 0, "Invalid args passed to the function")?;
            return Ok(Value::Float(std::f64::consts::PI));
        }
        if let Some(vs) = timestamp_selector(func, args) {
            return self
                .exec_vector_selector(vs, SelectorOutput::SampleTimestamp)
                .await;
        }

        let start = std::time::Instant::now();
        let result = if let Some(range_func) = func_name.range_func() {
            let returns_sample_time = range_func.returns_sample_time();
            // a range function over a plain matrix selector streams its series one at a time
            let value = if let [arg] = args.args.as_slice()
                && let PromExpr::MatrixSelector(MatrixSelector { vs, range }) = arg.as_ref()
            {
                let range_func: Arc<dyn RangeFunc> = Arc::from(range_func);
                if let Some(value) = self
                    .try_streaming_range_func(vs, *range, Arc::clone(&range_func))
                    .await?
                {
                    value
                } else {
                    let input = self.call_expr_arg(args, 0).await?;
                    functions::eval_range(input, range_func, &self.eval_ctx)?
                }
            } else {
                let input = self.call_expr_arg(args, 0).await?;
                functions::eval_range(input, range_func, &self.eval_ctx)?
            };
            match args.args.first() {
                Some(arg) if returns_sample_time => {
                    functions::stored_sample_times(value, functions::sample_time_offset(arg))
                }
                _ => value,
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
        match func_name {
            Func::Absent | Func::AbsentOverTime => {
                self.ensure_args_len(args, 1, "Invalid args, expected one argument")?;
                let labels = functions::absent_labels(&args.args[0]);
                let input = self.call_expr_arg(args, 0).await?;
                if func_name == Func::Absent {
                    functions::absent(input, labels, &self.eval_ctx)
                } else {
                    functions::absent_over_time(input, labels, &self.eval_ctx)
                }
            }
            Func::Clamp => {
                let err = "Invalid args, expected clamp(v instant-vector, min scalar, max scalar)";
                self.ensure_args_len(args, 3, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let min = self.call_scalar_arg(args, 1, err).await?;
                let max = self.call_scalar_arg(args, 2, err).await?;

                functions::clamp(input, &min, &max)
            }
            Func::ClampMax | Func::ClampMin => {
                let is_max = func_name == Func::ClampMax;
                let err = if is_max {
                    "Invalid args, expected clamp(v instant-vector, max scalar)"
                } else {
                    "Invalid args, expected clamp(v instant-vector, min scalar)"
                };
                self.ensure_args_len(args, 2, err)?;
                let input = self.call_expr_arg(args, 0).await?;
                let bound = self.call_scalar_arg(args, 1, err).await?;
                let (min, max) = if is_max {
                    (ScalarParam::Const(f64::NEG_INFINITY), bound)
                } else {
                    (bound, ScalarParam::Const(f64::INFINITY))
                };

                functions::clamp(input, &min, &max)
            }
            Func::HistogramQuantile => {
                let err = "Invalid args, expected histogram_quantile(phi scalar, b instant-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi = self.call_scalar_arg(args, 0, err).await?;
                let input = self.call_expr_arg(args, 1).await?;

                functions::histogram_quantile(&phi, input, &self.eval_ctx)
            }
            Func::HistogramFraction => {
                let err = "Invalid args, expected histogram_fraction(lower scalar, upper scalar, b instant-vector)";
                self.ensure_args_len(args, 3, err)?;
                let lower = self.call_scalar_arg(args, 0, err).await?;
                let upper = self.call_scalar_arg(args, 1, err).await?;
                let input = self.call_expr_arg(args, 2).await?;

                functions::histogram_fraction(&lower, &upper, input, &self.eval_ctx)
            }
            Func::HistogramQuantiles => {
                let err = "Invalid args, expected histogram_quantiles(b instant-vector, label string, phi scalar, ...)";
                let quantiles = args.len().saturating_sub(2);
                if quantiles == 0 {
                    return Err(DataFusionError::NotImplemented(err.into()));
                }
                let input = self.call_expr_arg(args, 0).await?;
                let label = self.call_string_arg(args, 1, err).await?;
                let mut phis = Vec::with_capacity(quantiles);
                for index in 2..args.len() {
                    phis.push(self.call_scalar_arg(args, index, err).await?);
                }

                functions::histogram_quantiles(input, &label, &phis, &self.eval_ctx)
            }
            Func::HoltWinters => {
                let err =
                    "Invalid args, expected holt_winters(v range-vector, sf scalar, tf scalar)";
                self.ensure_args_len(args, 3, err)?;
                let (input, pinned) = self.call_range_arg(args, 0).await?;
                let scaling_factor = self.call_scalar_arg(args, 1, err).await?;
                let trend_factor = self.call_scalar_arg(args, 2, err).await?;

                functions::holt_winters(input, scaling_factor, trend_factor, &self.eval_ctx, pinned)
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
                let mut source_labels = Vec::with_capacity(args.len().saturating_sub(3));
                for index in 3..args.len() {
                    source_labels.push(
                        self.call_string_arg(args, index, "Invalid source label found")
                            .await?,
                    );
                }
                functions::label_join(input, &dst_label, &separator, source_labels)
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

                functions::label_replace(input, &dst_label, &replacement, &src_label, &regex)
            }
            Func::MaxOf | Func::MinOf => {
                let name: &'static str = func_name.into();
                let err = format!("Invalid args, expected {name}(a scalar, b scalar)");
                self.ensure_args_len(args, 2, &err)?;
                let a = self.call_scalar_arg(args, 0, &err).await?;
                let b = self.call_scalar_arg(args, 1, &err).await?;

                Ok(functions::min_max_of(
                    &a,
                    &b,
                    func_name == Func::MaxOf,
                    &self.eval_ctx,
                ))
            }
            Func::PredictLinear => {
                let err = "Invalid args, expected predict_linear(v range-vector, t scalar)";
                self.ensure_args_len(args, 2, err)?;
                let (input, pinned) = self.call_range_arg(args, 0).await?;
                let duration = self.call_scalar_arg(args, 1, err).await?;

                functions::predict_linear(input, duration, &self.eval_ctx, pinned)
            }
            Func::QuantileOverTime => {
                let err = "Invalid args, expected quantile_over_time(scalar, range-vector)";
                self.ensure_args_len(args, 2, err)?;
                let phi = self.call_scalar_arg(args, 0, err).await?;
                let (input, pinned) = self.call_range_arg(args, 1).await?;

                functions::quantile_over_time(phi, input, &self.eval_ctx, pinned)
            }
            Func::Round => {
                let err = "Invalid args, expected round(v instant-vector, to_nearest=1 scalar)";
                let input = self.call_expr_arg(args, 0).await?;
                let to_nearest = match args.len() {
                    1 => ScalarParam::Const(1.0),
                    2 => self.call_scalar_arg(args, 1, err).await?,
                    _ => return Err(DataFusionError::NotImplemented(err.into())),
                };

                functions::round(input, &to_nearest)
            }
            Func::Sort | Func::SortDesc => {
                let err = "Invalid args, expected sort(v instant-vector)";
                self.ensure_args_len(args, 1, err)?;
                let input = self.call_expr_arg(args, 0).await?;

                functions::sort(input, func_name == Func::SortDesc, &self.eval_ctx)
            }
            // the query's result is ordered after evaluation, and only by a top-level call
            Func::SortByLabel | Func::SortByLabelDesc => {
                if args.len() < 2 {
                    return Err(DataFusionError::NotImplemented(
                        "Invalid args, expected sort_by_label(v instant-vector, label string, ...)"
                            .into(),
                    ));
                }
                self.call_expr_arg(args, 0).await
            }
            Func::HistogramAvg
            | Func::HistogramCount
            | Func::HistogramStddev
            | Func::HistogramStdvar
            | Func::HistogramSum => Err(DataFusionError::NotImplemented(
                functions::native_histogram_guidance(func_name.into()),
            )),
            _ => self.call_single_arg_builtin(func_name, args).await,
        }
    }

    async fn call_single_arg_builtin(
        &mut self,
        func_name: Func,
        args: &FunctionArgs,
    ) -> Result<Value> {
        let single_arg_func = func_name.single_arg_func();
        let input = match (&single_arg_func, args.len()) {
            (Some(SingleArgFunc::Date(_)), 0) => Value::Matrix(vec![RangeValue {
                labels: Labels::default(),
                samples: self
                    .eval_ctx
                    .timestamps()
                    .into_iter()
                    // Prometheus truncates toward zero (`enh.Ts/1000`): a step at -0.5 s reads as second 0
                    .map(|ts| Sample::new(ts, (ts / 1_000_000) as f64))
                    .collect(),
                exemplars: None,
                time_window: None,
            }]),
            (Some(SingleArgFunc::Date(_)), 2..) => {
                return Err(DataFusionError::NotImplemented(
                    "Invalid args passed to the function".into(),
                ));
            }
            _ => self.call_expr_arg(args, 0).await?,
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

    /// A range argument and the instant an `@` pins its window to, which every step then reads.
    async fn call_range_arg(
        &mut self,
        args: &FunctionArgs,
        index: usize,
    ) -> Result<(Value, Option<i64>)> {
        let arg = args
            .args
            .get(index)
            .ok_or_else(|| DataFusionError::NotImplemented(format!("Missing argument {index}")))?;
        if self.has_at_modifier
            && arg.value_type() == ValueType::Matrix
            && let Pin::At(at) = pin(arg)?
        {
            return Ok((self.exec_at(arg, at).await?, Some(at)));
        }
        Ok((self.exec_expr(arg).await?, None))
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
    ) -> Result<ScalarParam> {
        let value = self.call_expr_arg(args, index).await?;
        ScalarParam::from_value(value, &self.eval_ctx)
            .ok_or_else(|| DataFusionError::NotImplemented(err.into()))
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
    use std::{collections::BTreeMap, sync::Arc};

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
            _streaming: bool,
        ) -> Result<Vec<crate::ScanContext>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn newly_parsed_functions_without_execution_support_return_errors() {
        for query in ["info(m)", "integral(m[5m])"] {
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
            let expr = crate::parse(query).unwrap();
            let error = engine.exec_expr(&expr).await.unwrap_err();
            assert!(
                matches!(error, DataFusionError::NotImplemented(_)),
                "{query}: {error}"
            );
            assert!(error.to_string().contains("Unsupported function"));
            assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
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
        let expr = crate::parse("quantile_over_time(0.95, m[5m])").unwrap();
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
        let expr = crate::parse("clamp_min(vector(5), scalar(m) > bool 0)").unwrap();
        let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
            panic!("expected clamped matrix");
        };
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].samples[0].value, 5.0);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_default_date_truncates_toward_zero() {
        let eval_ctx = EvalContext::new(-500_000, -500_000, 0, "test".into());
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            eval_ctx,
        );
        for query in ["year()", "year(vector(time()))"] {
            let expr = crate::parse(query).unwrap();
            let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
                panic!("expected a matrix for {query}");
            };
            assert_eq!(series[0].samples[0].value, 1970.0, "{query}");
        }
    }

    #[tokio::test]
    async fn test_call_dispatch_preserves_values() {
        let eval_ctx = EvalContext::new(1_000_000, 1_000_000, 1_000_000, "test".into());
        for (query, expected) in [
            ("time()", 1.0),
            ("day_of_month()", 1.0),
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
            let expr = crate::parse(query).unwrap();
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
                .map(|expr| Box::new(crate::parse(expr).unwrap()))
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

    #[tokio::test]
    async fn test_min_of_and_max_of_name_themselves_in_arity_errors() {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        for (func, name) in [(Func::MinOf, "min_of("), (Func::MaxOf, "max_of(")] {
            let err = engine
                .call_builtin(func, &args)
                .await
                .unwrap_err()
                .to_string();
            assert!(err.contains(name), "{err}");
        }
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
                vec!["vector(5)", r#""dst""#, r#"",""#, "5"],
                "Invalid source label found",
            ),
        ] {
            let args = FunctionArgs {
                args: expressions
                    .into_iter()
                    .map(|expr| Box::new(crate::parse(expr).unwrap()))
                    .collect(),
            };
            let result = engine.call_builtin(Func::LabelJoin, &args).await;
            assert!(
                matches!(result, Err(DataFusionError::NotImplemented(message)) if message == expected)
            );
        }
    }

    #[tokio::test]
    async fn test_label_join_without_source_labels() {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let query = r#"label_join(label_replace(vector(1), "dst", "old", "", ""), "dst", ",")"#;
        let expr = crate::parse(query).unwrap();
        let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
            panic!("expected matrix");
        };
        assert_eq!(series.len(), 1);
        assert!(series[0].labels.is_empty());
    }

    #[tokio::test]
    async fn test_label_replace_copies_value_like_prometheus() {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let query = r#"label_replace(label_replace(label_replace(vector(1), "instance", "a", "", ""), "__name__", "mem_usage", "", ""), "host", "$1", "instance", "(.*)")"#;
        let expr = crate::parse(query).unwrap();
        let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
            panic!("expected matrix");
        };
        assert_eq!(series.len(), 1);
        let labels: Vec<_> = series[0]
            .labels
            .iter()
            .map(|label| (label.name.as_str(), label.value.as_str()))
            .collect();
        assert_eq!(
            labels,
            vec![("__name__", "mem_usage"), ("host", "a"), ("instance", "a")]
        );
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
                Box::new(crate::parse("42").unwrap()),
                Box::new(crate::parse(r#""text""#).unwrap()),
            ],
        };
        assert_eq!(
            engine
                .call_scalar_arg(&args, 0, "scalar error")
                .await
                .unwrap(),
            ScalarParam::Const(42.0)
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

    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_640_995_200;

    async fn eval_at(query: &str, eval_ctx: EvalContext) -> Value {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            eval_ctx,
        );
        let expr = crate::parse(query).unwrap();
        engine
            .exec_expr(&expr)
            .await
            .unwrap_or_else(|err| panic!("{query}: {err}"))
    }

    /// Three steps a minute apart from `BASE` seconds.
    fn range_ctx() -> EvalContext {
        EvalContext::new(
            BASE * SECOND,
            (BASE + 120) * SECOND,
            60 * SECOND,
            "test".into(),
        )
    }

    /// (labels, timestamp) -> value bits of every sample.
    fn samples(value: Value) -> BTreeMap<(String, i64), u64> {
        let Value::Matrix(matrix) = value else {
            return BTreeMap::new();
        };
        let mut samples = BTreeMap::new();
        for series in matrix {
            let labels: Vec<_> = series
                .labels
                .iter()
                .map(|label| format!("{}={}", label.name, label.value))
                .collect();
            for sample in series.samples {
                let key = (labels.join(","), sample.timestamp);
                assert!(samples.insert(key, sample.value.to_bits()).is_none());
            }
        }
        samples
    }

    fn step_values(value: Value) -> Vec<(i64, f64)> {
        samples(value)
            .into_iter()
            .map(|((_, timestamp), bits)| (timestamp, f64::from_bits(bits)))
            .collect()
    }

    #[tokio::test]
    async fn double_exponential_smoothing_matches_holt_winters() {
        let squares = format!("vector((time() - {BASE}) ^ 2)[3m:1m]");
        for query in [
            format!("holt_winters({squares}, 0.5, 0.3)"),
            format!("holt_winters({squares}, 0.2 + 0.3 * ((time() - {BASE}) / 60), 0.3)"),
        ] {
            let alias = query.replace("holt_winters", "double_exponential_smoothing");
            for eval_ctx in [
                EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into()),
                range_ctx(),
            ] {
                let expected = samples(eval_at(&query, eval_ctx.clone()).await);
                assert!(!expected.is_empty(), "{query}");
                assert_eq!(
                    samples(eval_at(&alias, eval_ctx).await),
                    expected,
                    "{alias}"
                );
            }
        }
    }

    #[tokio::test]
    async fn test_time_is_the_evaluation_time_at_every_step() {
        let instant = 1_500_250 * 1_000;
        let eval_ctx = EvalContext::new(instant, instant, 0, "test".into());
        assert!(matches!(eval_at("time()", eval_ctx).await, Value::Float(t) if t == 1500.25));

        // a sub-second start keeps its milliseconds on every step
        let start = BASE * SECOND + 500_000;
        let eval_ctx = EvalContext::new(start, start + 120 * SECOND, 60 * SECOND, "test".into());
        let expected: Vec<_> = (0..3)
            .map(|i| {
                let timestamp = start + i * 60 * SECOND;
                (timestamp, timestamp as f64 / 1e6)
            })
            .collect();
        for query in ["time()", "vector(time())"] {
            assert_eq!(
                step_values(eval_at(query, eval_ctx.clone()).await),
                expected,
                "{query}"
            );
        }

        // subquery steps are aligned to multiples of their own step, so the last one is on the
        // minute
        let on_the_minute: Vec<_> = expected
            .iter()
            .map(|&(timestamp, seconds)| (timestamp, seconds.floor()))
            .collect();
        assert_eq!(
            step_values(eval_at("max_over_time(vector(time())[10m:1m])", eval_ctx).await),
            on_the_minute
        );
    }

    #[tokio::test]
    async fn test_time_minus_timestamp_is_zero_in_every_context() {
        let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
        for (eval_ctx, steps) in [(instant, 1), (range_ctx(), 3)] {
            for query in [
                "time() - timestamp(vector(1))",
                "timestamp(vector(1)) - time()",
                "max_over_time(vector(time())[10m:1m]) - time()",
            ] {
                let values = step_values(eval_at(query, eval_ctx.clone()).await);
                assert_eq!(values.len(), steps, "{query}");
                assert!(values.iter().all(|(_, value)| *value == 0.0), "{query}");
            }
        }
    }

    #[tokio::test]
    async fn test_detail_forecast_is_finite_and_follows_a_line() {
        let query = "predict_linear(holt_winters(vector(time())[10m:1m], 0.3, 0.1)[1h:1m], 60)";
        let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
        let values = step_values(eval_at(query, instant).await);
        assert_eq!(values.len(), 1, "{values:?}");
        assert!(values[0].1.is_finite(), "{values:?}");

        let line = format!("(vector(10 + 0.5 * (time() - {BASE})))");
        let expected = 10.0 + 0.5 * 900.0;
        for input in [
            format!("{line}[1h:1m]"),
            format!("holt_winters({line}[10m:1m], 0.3, 0.1)[1h:1m]"),
        ] {
            let query = format!("predict_linear({input}, 900)");
            let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
            let values = step_values(eval_at(&query, instant).await);
            let got = values[0].1;
            assert!((got - expected).abs() <= expected * 0.01, "{query}: {got}");
        }
    }

    /// Must match `buildForecastAlertPromql` in web/src/utils/alerts/forecastAlert.ts, at `W` = 2d.
    fn forecast_days(u: &str, threshold: f64, rises: bool) -> String {
        let (crossed, towards) = if rises { (">=", ">") } else { ("<=", "<") };
        format!(
            "(({u}) {crossed} {threshold}) * 0 or clamp_min(ceil(({threshold} - ({u})) / (deriv(({u})[2d:15m]) {towards} 0) / 8640 - 1e-6) / 10, 0) or (({u}) * 0 + 36500)"
        )
    }

    #[tokio::test]
    async fn test_forecast_alert_query_gives_days_until_the_threshold() {
        let gauge = |at_t: f64, per_day: f64| {
            format!("vector({at_t} + {per_day} * (time() - {BASE}) / 86400)")
        };
        let cases = [
            (gauge(0.85, 0.01), 5.0),
            (gauge(0.9 - 0.0704, 0.01), 7.1),
            (gauge(0.9 - 0.0696, 0.01), 7.0),
            (gauge(0.95, 0.01), 0.0),
            (gauge(0.95, 0.0), 0.0),
            (gauge(0.5, 0.0), 36500.0),
            (gauge(0.5, -0.01), 36500.0),
            (
                format!("(vector(0.5) and on () (vector(time()) == {BASE}))"),
                36500.0,
            ),
        ];
        let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
        let mut wrong = Vec::new();
        for (u, expected) in cases {
            let query = forecast_days(&u, 0.9, true);
            let values = step_values(eval_at(&query, instant.clone()).await);
            if values != vec![(BASE * SECOND, expected)] {
                wrong.push(format!("{u}: {values:?}, expected {expected}"));
            }
        }

        let falling = forecast_days(&gauge(0.15, -0.01), 0.1, false);
        let values = step_values(eval_at(&falling, instant.clone()).await);
        if values != vec![(BASE * SECOND, 5.0)] {
            wrong.push(format!("falls to: {values:?}, expected 5"));
        }

        let zero_size = forecast_days("vector(1) / vector(0)", 0.9, true);
        let values = step_values(eval_at(&zero_size, instant).await);
        if values.iter().any(|(_, value)| value.is_finite()) {
            wrong.push(format!(
                "zero-size filesystem: {values:?}, expected no finite value"
            ));
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    /// A parameter that differs at every step answers each step as that step's constant would.
    #[tokio::test]
    async fn test_per_step_parameters_match_the_constant_at_each_step() {
        let series = format!(
            r#"(label_replace(vector(time() - {BASE}), "s", "a", "", "") or label_replace(vector(2 * (time() - {BASE})), "s", "b", "", "") or label_replace(vector(10), "s", "c", "", ""))"#
        );
        let buckets = r#"(label_replace(vector(50), "le", "1", "", "") or label_replace(vector(100), "le", "2", "", "") or label_replace(vector(100), "le", "+Inf", "", ""))"#;
        let squares = format!("vector((time() - {BASE}) ^ 2)[3m:1m]");
        let cases = [
            // the lower bound passes the upper one on the last step, which clamp answers empty
            (format!("clamp({series}, {{p}}, 100)"), 0.0, 70.0),
            (format!("clamp_min({series}, {{p}})"), 5.0, 50.0),
            (format!("clamp_max({series}, {{p}})"), 5.0, 50.0),
            (format!("round({series}, {{p}})"), 7.0, 30.0),
            (format!("topk({{p}}, {series})"), 0.0, 1.0),
            (format!("bottomk({{p}}, {series})"), 1.0, 1.0),
            (format!("limitk({{p}}, {series})"), 1.0, 1.0),
            (format!("limit_ratio({{p}}, {series})"), -1.0, 1.0),
            (format!("quantile({{p}}, {series})"), 0.0, 0.5),
            (format!("histogram_quantile({{p}}, {buckets})"), 0.1, 0.4),
            (format!("histogram_fraction(0, {{p}}, {buckets})"), 0.5, 0.5),
            ("vector(min_of({p}, 5))".to_string(), 3.0, 2.0),
            ("vector(max_of(5, {p}))".to_string(), 3.0, 2.0),
            (format!("histogram_fraction({{p}}, 2, {buckets})"), 0.5, 0.5),
            (
                format!(r#"histogram_quantiles({buckets}, "q", {{p}})"#),
                0.1,
                0.4,
            ),
            (
                format!(r#"histogram_quantiles({buckets}, "q", 0.5, {{p}})"#),
                0.1,
                0.3,
            ),
            (
                "quantile_over_time({p}, vector(time())[3m:1m])".to_string(),
                0.0,
                0.5,
            ),
            (
                "predict_linear(vector(time())[3m:1m], {p})".to_string(),
                60.0,
                60.0,
            ),
            (format!("holt_winters({squares}, {{p}}, 0.5)"), 0.2, 0.3),
            (format!("holt_winters({squares}, 0.5, {{p}})"), 0.2, 0.3),
        ];
        for (template, base, slope) in cases {
            let per_step = template.replace(
                "{p}",
                &format!("({base} + {slope} * ((time() - {BASE}) / 60))"),
            );
            let actual = samples(eval_at(&per_step, range_ctx()).await);
            let mut expected = BTreeMap::new();
            for step in 0..3 {
                let constant = template.replace("{p}", &(base + slope * step as f64).to_string());
                let timestamp = (BASE + step * 60) * SECOND;
                expected.extend(
                    samples(eval_at(&constant, range_ctx()).await)
                        .into_iter()
                        .filter(|((_, sample_ts), _)| *sample_ts == timestamp),
                );
            }
            assert!(!expected.is_empty(), "{per_step}");
            assert_eq!(actual, expected, "{per_step}");
        }
    }

    /// `trig{l="x"} 10`, `trig{l="y"} 20` and `trig{l="NaN"} NaN`, as upstream's trig tests load.
    fn trig_input(shift: f64) -> String {
        [("x", "10"), ("y", "20"), ("NaN", "NaN")]
            .iter()
            .map(|(l, v)| {
                format!(
                    r#"label_replace(label_replace(vector({v} - {shift}), "l", "{l}", "", ""), "__name__", "trig", "", "")"#
                )
            })
            .collect::<Vec<_>>()
            .join(" or ")
    }

    /// `l` label -> (labels without `l`, value), for one instant.
    fn by_l(value: Value) -> BTreeMap<String, (Vec<String>, f64)> {
        let Value::Matrix(matrix) = value else {
            panic!("expected a matrix, got {value:?}");
        };
        matrix
            .into_iter()
            .map(|series| {
                let other = series
                    .labels
                    .iter()
                    .filter(|label| label.name != "l")
                    .map(|label| label.name.clone())
                    .collect();
                (
                    series.labels.get_value("l"),
                    (other, series.samples[0].value),
                )
            })
            .collect()
    }

    /// Cases from upstream `promql/promqltest/testdata/trig_functions.test`.
    #[tokio::test]
    async fn test_trig_functions_match_upstream_and_drop_the_name() {
        let nan = f64::NAN;
        let cases = [
            ("sin", 0.0, [-0.5440211108893699, 0.9129452507276277]),
            ("cos", 0.0, [-0.8390715290764524, 0.40808206181339196]),
            ("tan", 0.0, [0.6483608274590867, 2.2371609442247427]),
            ("asin", 10.1, [-0.10016742116155944, nan]),
            ("acos", 10.1, [1.670963747956456, nan]),
            ("atan", 0.0, [1.4711276743037345, 1.5208379310729538]),
            ("sinh", 0.0, [11013.232920103324, 2.4258259770489514e+08]),
            ("cosh", 0.0, [11013.232920103324, 2.4258259770489514e+08]),
            ("tanh", 0.0, [0.9999999958776927, 1.0]),
            ("asinh", 0.0, [2.99822295029797, 3.6895038689889055]),
            ("acosh", 0.0, [2.993222846126381, 3.6882538673612966]),
            ("atanh", 10.1, [-0.10033534773107522, nan]),
            ("rad", 0.0, [0.17453292519943295, 0.3490658503988659]),
            ("rad", 10.0, [0.0, 0.17453292519943295]),
            ("rad", 20.0, [-0.17453292519943295, 0.0]),
            ("deg", 0.0, [572.9577951308232, 1145.9155902616465]),
            ("deg", 10.0, [0.0, 572.9577951308232]),
            ("deg", 20.0, [-572.9577951308232, 0.0]),
        ];
        let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
        for (func, shift, [x, y]) in cases {
            let query = format!("{func}({})", trig_input(shift));
            let actual = by_l(eval_at(&query, instant.clone()).await);
            assert_eq!(actual.len(), 3, "{query}");
            for (l, expected) in [("x", x), ("y", y), ("NaN", nan)] {
                let (labels, value) = &actual[l];
                assert!(labels.is_empty(), "{func} kept {labels:?}");
                if expected.is_nan() {
                    assert!(value.is_nan(), "{func}({l} - {shift}): {value}");
                } else if func == "deg" || func == "rad" {
                    assert_eq!(value.to_bits(), expected.to_bits(), "{func}({l} - {shift})");
                } else {
                    // promqltest's own tolerance; Go's sinh and cosh differ from libm past it
                    let tolerance = expected.abs() * 1e-6;
                    assert!(
                        (value - expected).abs() <= tolerance,
                        "{func}({l}): {value}"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_pi_is_a_scalar() {
        let instant = EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into());
        assert!(matches!(
            eval_at("pi()", instant).await,
            Value::Float(pi) if pi.to_string() == "3.141592653589793"
        ));
        let values = step_values(eval_at("vector(pi())", range_ctx()).await);
        assert_eq!(values.len(), 3);
        assert!(values.iter().all(|(_, v)| *v == std::f64::consts::PI));
    }

    async fn eval_err(query: &str, eval_ctx: EvalContext) -> String {
        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            eval_ctx,
        );
        let expr = promql_parser::parser::parse(query).unwrap();
        match engine.exec_expr(&expr).await {
            Ok(value) => panic!("{query} evaluated to {value:?}"),
            Err(err) => err.to_string(),
        }
    }

    /// A classic histogram: one `le` series per `(bound, count)`, all labelled `g="<group>"`.
    fn classic(group: &str, buckets: &[(&str, f64)]) -> String {
        buckets
            .iter()
            .map(|(le, count)| {
                format!(
                    r#"label_replace(label_replace(label_replace(vector({count}), "le", "{le}", "", ""), "g", "{group}", "", ""), "__name__", "h_bucket", "", "")"#
                )
            })
            .collect::<Vec<_>>()
            .join(" or ")
    }

    fn instant() -> EvalContext {
        EvalContext::new(BASE * SECOND, BASE * SECOND, 0, "test".into())
    }

    /// `g` label -> value, for one instant.
    async fn by_group(query: &str) -> BTreeMap<String, f64> {
        let Value::Matrix(matrix) = eval_at(query, instant()).await else {
            panic!("expected a matrix for {query}");
        };
        matrix
            .into_iter()
            .map(|series| {
                assert!(series.labels.get_value("__name__").is_empty(), "{query}");
                (series.labels.get_value("g"), series.samples[0].value)
            })
            .collect()
    }

    #[tokio::test]
    async fn test_histogram_fraction_over_classic_buckets() {
        let h = classic(
            "a",
            &[("0.1", 10.0), ("0.5", 30.0), ("1", 45.0), ("+Inf", 50.0)],
        );
        let fraction = |lo: &str, hi: &str| format!("histogram_fraction({lo}, {hi}, {h})");
        assert_eq!(by_group(&fraction("0", "0.5")).await["a"], 30.0 / 50.0);
        assert_eq!(by_group(&fraction("-Inf", "0.5")).await["a"], 30.0 / 50.0);
        // (0.5, 1] holds 15, and 0.75 is halfway through it
        assert_eq!(by_group(&fraction("0", "0.75")).await["a"], 37.5 / 50.0);
        assert_eq!(by_group(&fraction("1", "+Inf")).await["a"], 5.0 / 50.0);
        assert_eq!(by_group(&fraction("0.5", "0.5")).await["a"], 0.0);
        assert_eq!(by_group(&fraction("0.6", "0.2")).await["a"], 0.0);
        assert!(by_group(&fraction("NaN", "1")).await["a"].is_nan());

        let no_inf = classic("b", &[("0.1", 10.0), ("0.5", 30.0)]);
        assert!(by_group(&format!("histogram_fraction(0, 0.5, {no_inf})")).await["b"].is_nan());
        let empty = classic("c", &[("0.1", 0.0), ("+Inf", 0.0)]);
        assert!(by_group(&format!("histogram_fraction(0, 0.5, {empty})")).await["c"].is_nan());
    }

    /// Cases from upstream `histograms.test`.
    #[tokio::test]
    async fn test_histogram_fraction_matches_upstream() {
        let h2 = classic(
            "h2",
            &[
                ("0", 0.0),
                ("2", 10.0),
                ("4", 20.0),
                ("6", 30.0),
                ("+Inf", 30.0),
            ],
        );
        let positive = classic(
            "positive",
            &[("1", 1.0), ("2", 3.0), ("3", 6.0), ("+Inf", 100.0)],
        );
        let negative = classic(
            "negative",
            &[("-3", 10.0), ("-2", 12.0), ("-1", 15.0), ("+Inf", 100.0)],
        );
        for (lo, hi, h, expected) in [
            ("0", "4", &h2, 0.6666666666666666),
            ("0", "6", &h2, 1.0),
            ("0", "3.5", &h2, 0.5833333333333334),
            ("0", "1.5", &positive, 0.02),
            ("-4", "-2", &negative, 0.02),
            ("-Inf", "-1.5", &negative, 0.135),
            ("-Inf", "+Inf", &negative, 1.0),
        ] {
            let query = format!("histogram_fraction({lo}, {hi}, {h})");
            let values = by_group(&query).await;
            let actual = *values.values().next().unwrap();
            assert!((actual - expected).abs() < 1e-12, "{lo}..{hi}: {actual}");
        }
    }

    #[tokio::test]
    async fn test_histogram_quantiles_labels_each_quantile() {
        let h = format!(
            "{} or {}",
            classic("a", &[("1", 5.0), ("2", 10.0), ("+Inf", 10.0)]),
            classic("b", &[("1", 2.0), ("2", 4.0), ("+Inf", 8.0)]),
        );
        let Value::Matrix(matrix) = eval_at(
            &format!(r#"histogram_quantiles({h}, "q", 0.5, 0.9)"#),
            instant(),
        )
        .await
        else {
            panic!("expected a matrix");
        };
        let mut actual: Vec<_> = matrix
            .iter()
            .map(|s| {
                let labels: Vec<_> = s
                    .labels
                    .iter()
                    .map(|l| format!("{}={}", l.name, l.value))
                    .collect();
                (labels.join(","), s.samples[0].value)
            })
            .collect();
        actual.sort_by(|a, b| a.0.cmp(&b.0));
        let mut expected = Vec::new();
        for phi in ["0.5", "0.9"] {
            for (group, value) in by_group(&format!("histogram_quantile({phi}, {h})")).await {
                expected.push((format!("g={group},q={phi}"), value));
            }
        }
        expected.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(actual.len(), 4);
        assert_eq!(actual, expected);

        let Value::Matrix(matrix) = eval_at(
            &format!(r#"histogram_quantiles({h}, "q", 0, 1)"#),
            instant(),
        )
        .await
        else {
            panic!("expected a matrix");
        };
        let mut quantiles: Vec<_> = matrix.iter().map(|s| s.labels.get_value("q")).collect();
        quantiles.sort();
        assert_eq!(quantiles, ["0.0", "0.0", "1.0", "1.0"]);
    }

    #[tokio::test]
    async fn test_histogram_quantiles_rejects_what_upstream_rejects() {
        let h = classic("a", &[("1", 5.0), ("+Inf", 10.0)]);
        // the parser stops at ten quantiles, as upstream
        let phis = ["0.5"; 11].join(", ");
        let eleven = format!(r#"histogram_quantiles({h}, "q", {phis})"#);
        assert!(promql_parser::parser::parse(&eleven).is_err());
        for (query, message) in [
            (
                format!(r#"histogram_quantiles({h}, "q", 0.5, 0.5)"#),
                "0.5 is given twice",
            ),
            (
                r#"histogram_quantiles(vector(0), "q", 0.5, 0.5)"#.to_string(),
                "0.5 is given twice",
            ),
            (
                format!(r#"histogram_quantiles({h}, "g", 0.5)"#),
                r#""g" already"#,
            ),
        ] {
            let err = eval_err(&query, instant()).await;
            assert!(err.contains("histogram_quantiles"), "{query}: {err}");
            assert!(err.contains(message), "{query}: {err}");
        }
    }

    #[tokio::test]
    async fn test_native_histogram_functions_explain_themselves_without_reading_series() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        for (func, hint) in [
            ("histogram_count", "_count"),
            ("histogram_sum", "_sum"),
            ("histogram_avg", "_sum"),
            ("histogram_stddev", "no classic"),
            ("histogram_stdvar", "no classic"),
        ] {
            let mut engine = Engine::new(
                "test",
                Arc::new(PromqlContext::new(
                    create_test_query_ctx("test", "test_org", 30),
                    CountingProvider(calls.clone()),
                    vec![],
                )),
                instant(),
            );
            let expr = promql_parser::parser::parse(&format!("{func}(rate(x[10m]))")).unwrap();
            let err = engine.exec_expr(&expr).await.unwrap_err().to_string();
            assert!(err.contains(func), "{err}");
            assert!(err.contains("native histograms"), "{err}");
            assert!(err.contains(hint), "{err}");
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    /// Cases from upstream `functions.test`.
    #[tokio::test]
    async fn test_min_of_and_max_of() {
        for (query, expected) in [
            ("min_of(3, 5)", 3.0),
            ("min_of(5, 3)", 3.0),
            ("max_of(3, 5)", 5.0),
            ("max_of(5, 3)", 5.0),
            ("min_of(4, 4)", 4.0),
            ("max_of(4, 4)", 4.0),
            ("min_of(-2, -5)", -5.0),
            ("max_of(-2, -5)", -2.0),
            ("min_of(0, 1)", 0.0),
            ("max_of(0, 1)", 1.0),
            ("min_of(NaN, 3)", f64::NAN),
            ("min_of(3, NaN)", f64::NAN),
            ("max_of(NaN, 3)", f64::NAN),
            ("max_of(3, NaN)", f64::NAN),
        ] {
            let Value::Float(actual) = eval_at(query, instant()).await else {
                panic!("{query} is not a scalar");
            };
            assert_eq!(actual.is_nan(), expected.is_nan(), "{query}");
            if !expected.is_nan() {
                assert_eq!(actual, expected, "{query}");
            }
        }
    }
}
