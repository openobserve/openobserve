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

//! Pre-scan of the query AST that collects the grouping labels into `label_selector`.

use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{
    AggregateExpr, BinModifier, BinaryExpr, Call, Expr as PromExpr, LabelModifier, ParenExpr,
    UnaryExpr,
};

use super::Engine;

impl Engine {
    /// Recursively filters the necessary columns needed for before executing the given PromQL
    /// expression.
    pub fn extract_columns_from_prom_expr(&mut self, prom_expr: &PromExpr) -> Result<()> {
        match prom_expr {
            PromExpr::Aggregate(AggregateExpr {
                op: _,
                expr,
                param,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(expr)?;
                if let Some(expr) = param {
                    self.extract_columns_from_prom_expr(expr)?;
                }
                self.extract_columns_from_modifier(modifier);
                Ok(())
            }
            PromExpr::Unary(UnaryExpr { expr }) | PromExpr::Paren(ParenExpr { expr }) => {
                self.extract_columns_from_prom_expr(expr)
            }
            PromExpr::Binary(BinaryExpr {
                op: _,
                lhs,
                rhs,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(lhs)?;
                self.extract_columns_from_prom_expr(rhs)?;
                if let Some(BinModifier { matching, .. }) = modifier {
                    self.extract_columns_from_modifier(matching);
                }
                Ok(())
            }
            PromExpr::Subquery(expr) => self.extract_columns_from_prom_expr(&expr.expr),
            PromExpr::Call(Call { func: _, args }) => {
                for expr in &args.args {
                    let _ = self.extract_columns_from_prom_expr(expr);
                }
                Ok(())
            }
            PromExpr::Extension(expr) => Err(DataFusionError::NotImplemented(format!(
                "Unsupported Extension: {expr:?}",
            ))),
            _ => Ok(()),
        }
    }

    /// Help function to extract columns from [LabelModifier].
    /// For promql:
    ///     sum(irate(zo_incoming_requests{namespace="ziox"}[5m])) by (exported_endpoint)
    /// we need to extract the columns `exported_endpoint` from the modifier. Because
    /// the result will be grouped by `exported_endpoint`, and don't consider other labesl.
    fn extract_columns_from_modifier(&mut self, modifier: &Option<LabelModifier>) {
        if let Some(LabelModifier::Include(labels)) = modifier {
            self.label_selector.extend(labels.labels.iter().cloned());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::value::{EvalContext, LabelsExt, Value};
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
        assert!(engine.label_selector.contains("env"));
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
        let mut expr = PromExpr::Call(Call { func, args });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
        let PromExpr::Call(call) = &mut expr else {
            unreachable!();
        };
        call.args.args.insert(
            0,
            Box::new(PromExpr::Extension(Extension {
                expr: Arc::new(TestExtension),
            })),
        );
        call.args.args.push(Box::new(
            promql_parser::parser::parse("sum by (job) (m)").unwrap(),
        ));
        assert!(engine.extract_columns_from_prom_expr(&expr).is_ok());
        assert!(engine.label_selector.contains("job"));
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

        engine.extract_columns_from_modifier(&None);
        // Should not change label_selector
        assert!(engine.label_selector.is_empty());
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

        engine.extract_columns_from_modifier(&modifier);
        // Should add labels to label_selector
        assert!(!engine.label_selector.is_empty());
        assert!(engine.label_selector.contains("env"));
        assert!(engine.label_selector.contains("service"));
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

        engine.extract_columns_from_modifier(&modifier);
        // Should not change label_selector for exclude
        assert!(engine.label_selector.is_empty());
    }

    const T0: i64 = 1_640_995_200_000_000;

    /// Serves `m{job="api"}` on instances `a` = 100 and `b` = 200, sampled every minute.
    struct TwoInstanceProvider(datafusion::prelude::SessionContext);

    #[async_trait::async_trait]
    impl crate::TableProvider for TwoInstanceProvider {
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
            Ok(vec![crate::ScanContext::table(
                self.0.clone(),
                two_instance_schema(),
                config::meta::search::ScanStats::default(),
                true,
            )])
        }
    }

    fn two_instance_schema() -> Arc<datafusion::arrow::datatypes::Schema> {
        use config::meta::promql::{HASH_LABEL, NAME_LABEL, VALUE_LABEL};
        use datafusion::arrow::datatypes::{DataType, Field, Schema};
        Arc::new(Schema::new(vec![
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("job", DataType::Utf8, true),
            Field::new("instance", DataType::Utf8, true),
            Field::new(NAME_LABEL, DataType::Utf8, true),
        ]))
    }

    fn two_instance_provider() -> TwoInstanceProvider {
        use datafusion::arrow::array::{
            Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array,
        };
        let rows: Vec<(i64, u64, &str, f64)> = (0..5)
            .flat_map(|minute| {
                let ts = T0 - minute * 60_000_000;
                [(ts, 1, "a", 100.0), (ts, 2, "b", 200.0)]
            })
            .collect();
        let batch = RecordBatch::try_new(
            two_instance_schema(),
            vec![
                Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.0))),
                Arc::new(UInt64Array::from_iter_values(rows.iter().map(|r| r.1))),
                Arc::new(Float64Array::from_iter_values(rows.iter().map(|r| r.3))),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|_| "api"))),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.2))),
                Arc::new(StringArray::from_iter_values(rows.iter().map(|_| "m"))),
            ],
        )
        .unwrap();
        let table =
            datafusion::datasource::MemTable::try_new(two_instance_schema(), vec![vec![batch]])
                .unwrap();
        let ctx = datafusion::prelude::SessionContext::new();
        ctx.register_table("m", Arc::new(table)).unwrap();
        TwoInstanceProvider(ctx)
    }

    #[tokio::test]
    async fn test_binary_inside_grouping_keeps_series_apart() {
        let cases = [
            ("sum by (job) (m / 2)", 150.0),
            ("sum by (job) (m * 60)", 18000.0),
            ("max by (job) (m - 1)", 199.0),
            ("sum by (job) (m + m)", 600.0),
            ("sum by (job) (abs(m))", 300.0),
            ("sum by (job) (ceil(max_over_time(m[5m])))", 300.0),
        ];
        for (query, expected) in cases {
            let trace_id = "test_trace";
            let mut ctx = PromqlContext::new(
                create_test_query_ctx(trace_id, "test_org", 30),
                two_instance_provider(),
                vec![],
            );
            ctx.start = T0;
            ctx.end = T0;
            let eval_ctx = EvalContext::new(T0, T0, 0, trace_id.to_string());
            let mut engine = Engine::new(trace_id, Arc::new(ctx), eval_ctx);
            let expr = promql_parser::parser::parse(query).unwrap();
            let (value, _) = engine
                .exec(&expr)
                .await
                .unwrap_or_else(|err| panic!("{query}: {err}"));
            let Value::Matrix(series) = value else {
                panic!("{query}: expected a matrix");
            };
            assert_eq!(series.len(), 1, "{query}");
            assert_eq!(series[0].labels.get_value("job"), "api", "{query}");
            assert_eq!(series[0].samples.len(), 1, "{query}");
            assert_eq!(series[0].samples[0].value, expected, "{query}");
        }
    }
}
