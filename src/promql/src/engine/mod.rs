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

mod aggregate;
mod call;
mod columns;
mod selector;
#[cfg(test)]
mod test_util;

use std::sync::Arc;

use async_recursion::async_recursion;
use config::meta::promql::value::*;
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashSet;
use promql_parser::parser::{
    AggregateExpr, Call, Expr as PromExpr, MatrixSelector, NumberLiteral, ParenExpr, StringLiteral,
    UnaryExpr,
};

use crate::{
    binaries,
    exec::PromqlContext,
    promql::{label_usage::labels_dropped_at_root, rewrite::remove_filter_all},
};

pub struct Engine {
    trace_id: String,
    /// PromQL evaluation context
    ctx: Arc<PromqlContext>,
    /// Evaluation context for promql queries
    eval_ctx: EvalContext,
    /// Only select columns with certain labels
    label_selector: HashSet<String>,
    /// If true, skip column pruning and load all label columns. Set when the
    /// expression contains label-creating functions (`label_replace`,
    /// `label_join`) whose output labels don't exist in the source schema and
    /// whose source labels may not be in the aggregation grouping set.
    disable_label_selector: bool,
    /// If true, the query provably discards all labels (e.g.
    /// `sum(rate(m[5m]))` without a modifier), so series labels are never
    /// loaded at all.
    skip_labels: bool,
    /// The result type of the query
    result_type: Option<String>,
}

impl Engine {
    pub fn new(trace_id: &str, ctx: Arc<PromqlContext>, eval_ctx: EvalContext) -> Self {
        Self {
            ctx,
            eval_ctx,
            label_selector: HashSet::new(),
            disable_label_selector: false,
            skip_labels: false,
            result_type: None,
            trace_id: trace_id.to_string(),
        }
    }

    /// Create a new engine with evaluation context for range queries
    /// This is now an alias for `new()` since eval_ctx is always required
    pub fn new_with_context(
        trace_id: &str,
        ctx: Arc<PromqlContext>,
        eval_ctx: EvalContext,
    ) -> Self {
        Self::new(trace_id, ctx, eval_ctx)
    }

    pub async fn exec(&mut self, prom_expr: &PromExpr) -> Result<(Value, Option<String>)> {
        self.extract_columns_from_prom_expr(prom_expr)?;
        if self.disable_label_selector {
            self.label_selector.clear();
        }
        self.skip_labels = !self.ctx.query_ctx.query_exemplars
            && !self.ctx.query_ctx.query_data
            && labels_dropped_at_root(prom_expr);
        let value = self.exec_expr(prom_expr).await?;
        Ok((value, self.result_type.clone()))
    }

    #[async_recursion]
    pub async fn exec_expr(&mut self, prom_expr: &PromExpr) -> Result<Value> {
        Ok(match &prom_expr {
            PromExpr::Aggregate(AggregateExpr {
                op,
                expr,
                param,
                modifier,
            }) => self.aggregate_exprs(op, expr, param, modifier).await?,

            PromExpr::Unary(UnaryExpr { expr }) => {
                let val = self.exec_expr(expr).await?;
                match val {
                    Value::Matrix(m) => {
                        let out = m
                            .into_iter()
                            .map(|mut range| RangeValue {
                                labels: std::mem::take(&mut range.labels).without_metric_name(),
                                samples: range
                                    .samples
                                    .into_iter()
                                    .map(|s| Sample {
                                        timestamp: s.timestamp,
                                        value: -s.value,
                                    })
                                    .collect(),
                                exemplars: range.exemplars,
                                time_window: range.time_window,
                            })
                            .collect();
                        Value::Matrix(out)
                    }
                    Value::Float(f) => Value::Float(-f),
                    _ => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "Unsupported Unary: {expr:?}"
                        )));
                    }
                }
            }
            PromExpr::Binary(expr) => {
                let lhs = self.exec_expr(&expr.lhs).await?;
                let rhs = self.exec_expr(&expr.rhs).await?;
                let token = expr.op.id();
                let return_bool = expr.return_bool();
                let op = expr.op.is_comparison_operator();

                // This is a very special case, as we treat the float also a
                // `Value::Matrix(vec![element])` therefore, better convert it
                // back to its representation.
                let rhs = match rhs {
                    Value::Matrix(m) if m.len() == 1 && m[0].samples.len() == 1 => {
                        Value::Float(m[0].samples[0].value)
                    }
                    _ => rhs,
                };
                match (lhs, rhs) {
                    (Value::Float(left), Value::Float(right)) => {
                        let value = binaries::scalar_binary_operations(
                            token,
                            left,
                            right,
                            return_bool,
                            op,
                        )?;
                        Value::Float(value)
                    }
                    (Value::Matrix(left), Value::Matrix(right)) => {
                        binaries::vector_bin_op(expr, left, right)?
                    }
                    (Value::Matrix(left), Value::Float(right)) => {
                        binaries::vector_scalar_bin_op(expr, left, right, false).await?
                    }
                    (Value::Float(left), Value::Matrix(right)) => {
                        binaries::vector_scalar_bin_op(expr, right, left, true).await?
                    }
                    (Value::None, Value::None) => Value::None,
                    _ => {
                        log::debug!(
                            "[trace_id: {}] [PromExpr::Binary] either lhs or rhs matrix is found to be empty",
                            self.trace_id
                        );
                        Value::Matrix(vec![])
                    }
                }
            }
            PromExpr::Paren(ParenExpr { expr }) => self.exec_expr(expr).await?,
            PromExpr::Subquery(expr) => {
                let val = self.exec_expr(&expr.expr).await?;
                let range = expr.range;
                let matrix = match val {
                    Value::Matrix(vs) => {
                        // For matrix type, update the time_window range
                        vs.into_iter()
                            .map(|mut rv| {
                                // Update time_window with new range
                                rv.time_window = Some(TimeWindow::new(range));
                                rv
                            })
                            .collect()
                    }
                    v => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "Unsupported subquery, the return value should have been a matrix but got {:?}",
                            v.get_type()
                        )));
                    }
                };

                Value::Matrix(matrix)
            }
            PromExpr::NumberLiteral(NumberLiteral { val }) => Value::Float(*val),
            PromExpr::StringLiteral(StringLiteral { val }) => Value::String(val.clone()),
            PromExpr::VectorSelector(vs) => {
                let mut vs = vs.clone();
                remove_filter_all(&mut vs);
                if !vs.matchers.or_matchers.is_empty() {
                    return Err(DataFusionError::Plan(
                        "VectorSelector: or_matchers is not supported".into(),
                    ));
                }
                if vs.at.is_some() {
                    return Err(DataFusionError::NotImplemented(
                        "VectorSelector: @ modifier is not supported".into(),
                    ));
                }
                let data = self.eval_vector_selector(&vs).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::MatrixSelector(MatrixSelector { vs, range }) => {
                let mut vs = vs.clone();
                remove_filter_all(&mut vs);
                if !vs.matchers.or_matchers.is_empty() {
                    return Err(DataFusionError::Plan(
                        "MatrixSelector: or_matchers is not supported".into(),
                    ));
                }
                if vs.at.is_some() {
                    return Err(DataFusionError::NotImplemented(
                        "MatrixSelector: @ modifier is not supported".into(),
                    ));
                }
                let data = self.eval_matrix_selector(&vs, *range).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::Call(Call { func, args }) => self.call_expr(func, args).await?,
            PromExpr::Extension(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Extension: {expr:?}"
                )));
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use promql_parser::{
        label::{MatchOp, Matchers},
        parser::{
            AggregateExpr, BinaryExpr, Call, Extension, Function, FunctionArgs, MatrixSelector,
            NumberLiteral, Offset, ParenExpr, StringLiteral, SubqueryExpr, UnaryExpr,
            VectorSelector, value::ValueType,
        },
    };

    use super::*;
    use crate::{engine::test_util::*, exec::PromqlContext};

    #[test]
    fn test_engine_new() {
        // Test basic engine creation with a simple mock
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

        assert_eq!(engine.trace_id, trace_id.to_string());
        assert!(engine.label_selector.is_empty());
        assert!(engine.result_type.is_none());
    }

    /// The `@` modifier PARSES (the fork supports the syntax) but nothing in the
    /// engine ever reads `vs.at` — every selector is evaluated at the step's own
    /// timestamp. So before this guard, `foo @ 1600000000` did not pin anything:
    /// it silently returned UNPINNED results, and the user got a plausible wrong
    /// number with no error. An unsupported feature must fail loudly; returning
    /// the wrong data quietly is the worst outcome in a metrics engine.
    ///
    /// Rejected at both selector arms — a range selector carries its own `at`
    /// (`foo[5m] @ end()`), and a subquery recurses through `exec_expr`, so a
    /// nested `@` lands on one of these two.
    #[tokio::test]
    async fn test_exec_expr_rejects_at_modifier() {
        let trace_id = "test_trace";
        let org_id = "test_org";

        // (query, what it exercises)
        let cases = [
            ("foo @ 1600000000", "instant selector, absolute @"),
            ("foo @ start()", "instant selector, @ start()"),
            ("foo @ end()", "instant selector, @ end()"),
            ("rate(foo[5m] @ 1600000000)", "range selector inside a call"),
            ("sum_over_time(foo[5m] @ end())", "range selector, @ end()"),
        ];

        for (query, what) in cases {
            let mut engine = Engine::new(
                trace_id,
                Arc::new(PromqlContext::new(
                    create_test_query_ctx(trace_id, org_id, 30),
                    SimpleMockProvider,
                    vec![],
                )),
                create_test_eval_ctx(),
            );

            let expr = promql_parser::parser::parse(query)
                .unwrap_or_else(|e| panic!("{what}: `{query}` should parse: {e}"));
            let err = engine.exec_expr(&expr).await.err().unwrap_or_else(|| {
                panic!("{what}: `{query}` must be rejected, not silently ignored")
            });

            assert!(
                err.to_string().contains("@ modifier is not supported"),
                "{what}: `{query}` should fail with the @-modifier error, got: {err}",
            );
        }
    }

    /// The guard must not fire on a query that merely LOOKS adjacent — `offset`
    /// is genuinely implemented and must keep working.
    #[tokio::test]
    async fn test_exec_expr_allows_offset_without_at_modifier() {
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

        let expr = promql_parser::parser::parse("foo offset 5m").expect("should parse");
        let err = engine.exec_expr(&expr).await.err();

        // The mock provider returns no data, so this may or may not error — what
        // matters is that it is never the @-modifier rejection.
        if let Some(err) = err {
            assert!(
                !err.to_string().contains("@ modifier"),
                "offset must not be caught by the @-modifier guard, got: {err}",
            );
        }
    }

    #[tokio::test]
    async fn test_exec_expr_number_literal() {
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

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_string_literal() {
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

        let expr = PromExpr::StringLiteral(StringLiteral {
            val: "test".to_string(),
        });
        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::String(val)) = result {
            assert_eq!(val, "test");
        } else {
            panic!("Expected Value::String");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_paren() {
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

        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Paren(ParenExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_unary_float() {
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

        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Unary(UnaryExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, -42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_unary_vector() {
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

        let sample = Sample::new(1640995200000000i64, 42.0);
        let instant = InstantValue {
            labels: vec![Arc::new(Label::new("env", "prod"))],
            sample,
        };
        let _vector = Value::Vector(vec![instant]);
        let vector_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let expr = PromExpr::Unary(UnaryExpr {
            expr: Box::new(vector_expr),
        });

        let result = engine.exec_expr(&expr).await;
        // This will fail because Extension is not implemented, but we're testing the unary logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_binary_float_float() {
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

        let lhs = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let rhs = PromExpr::NumberLiteral(NumberLiteral { val: 10.0 });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier: None,
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 52.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_binary_none_none() {
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

        let lhs = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });
        let rhs = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier: None,
        });

        let result = engine.exec_expr(&expr).await;
        // This will fail because Extension is not implemented, but we're testing the binary logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_subquery() {
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

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(expr),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // Subquery with float input should fail because subquery expects matrix input
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported subquery")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_with_offset() {
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

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let offset = Some(Offset::Pos(Duration::from_secs(60)));
        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(expr),
            range: Duration::from_secs(300),
            offset,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // Subquery with float input should fail because subquery expects matrix input
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported subquery")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_vector() {
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

        let sample = Sample::new(1640995200000000i64, 42.0);
        let _instant = InstantValue {
            labels: vec![Arc::new(Label::new("env", "prod"))],
            sample,
        };
        let vector = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(vector),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // This will fail because Extension is not implemented, but we're testing the subquery logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_float() {
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

        let float_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(float_expr),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // This will fail because Extension is not implemented, but we're testing the subquery logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_aggregate() {
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

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(expr),
            param: None,
            modifier: None,
        });

        let result = engine.exec_expr(&aggregate_expr).await;
        // This will fail because aggregate_exprs is not fully implemented, but we're testing the
        // aggregate logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_call() {
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

        let args = FunctionArgs { args: vec![] };
        let func = Function {
            name: "time",
            arg_types: vec![],
            variadic: false,
            return_type: ValueType::Scalar,
        };
        let expr = PromExpr::Call(Call { func, args });

        let result = engine.exec_expr(&expr).await;
        // This will fail because call_expr is not fully implemented, but we're testing the call
        // logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec_expr_extension() {
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

        let extension_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let result = engine.exec_expr(&extension_expr).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported Extension")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_vector_selector() {
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

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let expr = PromExpr::VectorSelector(selector);

        let result = engine.exec_expr(&expr).await;
        // This will fail because the mock provider doesn't have real data, but we're testing the
        // vector selector logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec_expr_matrix_selector() {
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

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let matrix_selector = MatrixSelector {
            vs: selector,
            range: Duration::from_secs(300),
        };

        let expr = PromExpr::MatrixSelector(matrix_selector);

        let result = engine.exec_expr(&expr).await;
        // This will fail because the mock provider doesn't have real data, but we're testing the
        // matrix selector logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec() {
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

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let result = engine.exec(&expr).await;
        assert!(result.is_ok());

        let (value, result_type) = result.unwrap();
        assert!(matches!(value, Value::Float(42.0)));
        assert!(result_type.is_none());
    }
}
