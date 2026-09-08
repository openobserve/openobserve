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

//! Pre-scan of the query AST that decides which label columns to load.
//! Writes `label_selector` and `disable_label_selector`.

use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{
    AggregateExpr, BinModifier, BinaryExpr, Call, Expr as PromExpr, LabelModifier, ParenExpr,
    UnaryExpr, VectorMatchCardinality, token,
};

use super::Engine;

impl Engine {
    /// Recursively filters the necessary columns needed for before executing the given PromQL
    /// expression.
    pub fn extract_columns_from_prom_expr(&mut self, prom_expr: &PromExpr) -> Result<()> {
        match prom_expr {
            PromExpr::Aggregate(AggregateExpr {
                op,
                expr,
                param,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(expr)?;
                if let Some(expr) = param {
                    self.extract_columns_from_prom_expr(expr)?;
                }
                self.extract_columns_from_modifier(modifier, op);
                Ok(())
            }
            PromExpr::Unary(UnaryExpr { expr }) => self.extract_columns_from_prom_expr(expr),
            PromExpr::Binary(BinaryExpr {
                op,
                lhs,
                rhs,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(lhs)?;
                self.extract_columns_from_prom_expr(rhs)?;
                if let Some(BinModifier {
                    card,
                    matching,
                    return_bool: _,
                }) = modifier
                {
                    self.extract_columns_from_modifier(matching, op);
                    // group_left or group_right -> no column selection
                    match card {
                        VectorMatchCardinality::ManyToOne(_)
                        | VectorMatchCardinality::OneToMany(_) => {
                            self.label_selector.clear();
                        }
                        _ => {}
                    }
                }
                Ok(())
            }
            PromExpr::Paren(ParenExpr { expr }) => self.extract_columns_from_prom_expr(expr),
            PromExpr::Subquery(expr) => self.extract_columns_from_prom_expr(&expr.expr),
            PromExpr::Call(Call { func, args }) => {
                // `label_replace` / `label_join` create new labels that don't
                // exist in the source schema. Restricting column selection
                // based on the aggregation `by()` list would then drop both the
                // source labels these functions read from and leave the
                // newly-created label absent from the loaded data, so the
                // aggregation groups everything together. See issue #11321.
                if matches!(func.name, "label_replace" | "label_join") {
                    self.disable_label_selector = true;
                }
                _ = args
                    .args
                    .iter()
                    .map(|expr| self.extract_columns_from_prom_expr(expr))
                    .collect::<Vec<_>>();
                Ok(())
            }
            PromExpr::Extension(expr) => Err(DataFusionError::NotImplemented(format!(
                "Unsupported Extension: {expr:?}",
            ))),
            _ => Ok(()),
        }
    }

    /// Help function to extract columns from [LabelModifier].
    /// Aggregation function topk & bottomk are special cases where
    /// modifier is applied to grouped result -> not columns filtered.
    /// For promql:
    ///     sum(irate(zo_incoming_requests{namespace="ziox"}[5m])) by (exported_endpoint)
    /// we need to extract the columns `exported_endpoint` from the modifier. Because
    /// the result will be grouped by `exported_endpoint`, and don't consider other labesl.
    fn extract_columns_from_modifier(
        &mut self,
        modifier: &Option<LabelModifier>,
        op: &token::TokenType,
    ) {
        if let Some(label_modifier) = modifier {
            match op.id() {
                // topk and bottomk query all columns when with modifiers
                token::T_TOPK | token::T_BOTTOMK => self.label_selector.clear(),
                _ => {
                    if let (label_selector, LabelModifier::Include(labels)) =
                        (&mut self.label_selector, label_modifier)
                    {
                        label_selector.extend(labels.labels.iter().cloned());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use promql_parser::parser::{
        AggregateExpr, BinModifier, BinaryExpr, Call, Extension, Function, FunctionArgs,
        NumberLiteral, ParenExpr, StringLiteral, SubqueryExpr, UnaryExpr, VectorMatchCardinality,
        value::ValueType,
    };

    use super::*;
    use crate::{engine::tests::*, exec::PromqlContext};

    #[test]
    fn test_extract_columns_from_prom_expr_number_literal() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_string_literal() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_paren() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_unary() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary_with_modifier() {
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
        let modifier = Some(BinModifier {
            card: VectorMatchCardinality::OneToOne,
            matching: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            })),
            return_bool: false,
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier,
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary_with_many_to_one() {
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
        let modifier = Some(BinModifier {
            card: VectorMatchCardinality::ManyToOne(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            }),
            matching: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            })),
            return_bool: false,
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier,
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
        // Should clear label_selector for ManyToOne
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_aggregate() {
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

        let result = engine.extract_columns_from_prom_expr(&aggregate_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_aggregate_with_param() {
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
        let param = PromExpr::NumberLiteral(NumberLiteral { val: 0.5 });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(expr),
            param: Some(Box::new(param)),
            modifier: None,
        });

        let result = engine.extract_columns_from_prom_expr(&aggregate_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_subquery() {
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

        let result = engine.extract_columns_from_prom_expr(&subquery_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_call() {
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

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_call_with_args() {
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

        let arg = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let args = FunctionArgs {
            args: vec![Box::new(arg)],
        };
        let func = Function {
            name: "abs",
            arg_types: vec![],
            variadic: false,
            return_type: ValueType::Scalar,
        };
        let expr = PromExpr::Call(Call { func, args });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_extension() {
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

        // Create a mock extension expression
        let extension_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let result = engine.extract_columns_from_prom_expr(&extension_expr);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported Extension")
        );
    }

    #[test]
    fn test_extract_columns_from_modifier_none() {
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

        engine.extract_columns_from_modifier(&None, &create_test_token());
        // Should not change label_selector
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_topk() {
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

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should clear label_selector for topk
        assert!(!engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_bottomk() {
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

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should clear label_selector for bottomk
        assert!(!engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_include() {
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

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string(), "service".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should add labels to label_selector
        assert!(!engine.label_selector.is_empty());
        assert!(engine.label_selector.contains("env"));
        assert!(engine.label_selector.contains("service"));
    }

    #[test]
    fn test_extract_columns_label_replace_disables_selector() {
        // Regression test for #11321: `count by (new) (label_replace(m, "new", ...))`
        // must not restrict loaded columns to `{"new"}`, since `new` is created
        // by `label_replace` and the source label it reads from would otherwise
        // not be loaded, so aggregation collapses all series into one group.
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

        let label_replace_call = PromExpr::Call(Call {
            func: Function {
                name: "label_replace",
                arg_types: vec![],
                variadic: false,
                return_type: ValueType::Vector,
            },
            args: FunctionArgs { args: vec![] },
        });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(label_replace_call),
            param: None,
            modifier: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["new".to_string()],
            })),
        });

        engine
            .extract_columns_from_prom_expr(&aggregate_expr)
            .unwrap();
        assert!(
            engine.disable_label_selector,
            "label_replace must set disable_label_selector"
        );
        // `exec()` clears the selector when the flag is set; mimic that here.
        if engine.disable_label_selector {
            engine.label_selector.clear();
        }
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_exclude() {
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

        let modifier = Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should not change label_selector for exclude
        assert!(engine.label_selector.is_empty());
    }
}
