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
mod at_modifier;
mod call;
mod columns;
mod selector;
mod streaming;
use std::sync::Arc;

use async_recursion::async_recursion;
use config::meta::promql::value::*;
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashSet;
use promql_parser::parser::{
    AggregateExpr, Call, Expr as PromExpr, MatrixSelector, NumberLiteral, ParenExpr, StringLiteral,
    UnaryExpr, value::ValueType,
};

use crate::{
    ast::{
        at_modifier::{Pin, pin, uses_at},
        label_usage::labels_dropped_at_root,
    },
    binary,
    exec::PromqlContext,
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
    /// Whether the expression may still carry an `@`; `exec_expr` skips the pin check without one.
    has_at_modifier: bool,
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
            has_at_modifier: true,
            trace_id: trace_id.to_string(),
        }
    }

    pub async fn exec(&mut self, prom_expr: &PromExpr) -> Result<(Value, Option<String>)> {
        self.extract_columns_from_prom_expr(prom_expr)?;
        if self.disable_label_selector {
            self.label_selector.clear();
        }
        self.skip_labels = !self.ctx.query_ctx.query_exemplars
            && !self.ctx.query_ctx.query_data
            && labels_dropped_at_root(prom_expr);
        self.has_at_modifier = uses_at(prom_expr);
        let value = match self.exec_root_range_selector(prom_expr).await? {
            Some(value) => value,
            None => self.exec_expr(prom_expr).await?,
        };
        Ok((value, self.result_type.clone()))
    }

    #[async_recursion]
    pub async fn exec_expr(&mut self, prom_expr: &PromExpr) -> Result<Value> {
        // a range vector has no value to repeat, the call around it is what gets pinned
        if self.has_at_modifier
            && let Pin::At(at) = pin(prom_expr)?
            && prom_expr.value_type() != ValueType::Matrix
        {
            return self.exec_pinned(prom_expr, at).await;
        }
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
                    Value::Matrix(mut matrix) => {
                        for range in &mut matrix {
                            range.labels = std::mem::take(&mut range.labels).without_metric_name();
                            for sample in &mut range.samples {
                                sample.value = -sample.value;
                            }
                        }
                        Value::Matrix(matrix)
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

                let lhs = scalar_operand(lhs, &expr.lhs, &self.eval_ctx);
                let rhs = scalar_operand(rhs, &expr.rhs, &self.eval_ctx);
                let lhs_scalar = expr.lhs.value_type() == ValueType::Scalar;
                let rhs_scalar = expr.rhs.value_type() == ValueType::Scalar;
                match (lhs, rhs) {
                    (Value::Float(left), Value::Float(right)) => {
                        let value =
                            binary::scalar_binary_operations(token, left, right, return_bool, op)?;
                        Value::Float(value)
                    }
                    // a range-query scalar is one label-less series that label matching would drop
                    (Value::Matrix(left), Value::Matrix(right))
                        if rhs_scalar && !lhs_scalar && right.len() == 1 =>
                    {
                        binary::vector_step_scalar_bin_op(expr, left, &right[0].samples, false)?
                    }
                    (Value::Matrix(left), Value::Matrix(right))
                        if lhs_scalar && !rhs_scalar && left.len() == 1 =>
                    {
                        binary::vector_step_scalar_bin_op(expr, right, &left[0].samples, true)?
                    }
                    (Value::Matrix(left), Value::Matrix(right)) => {
                        binary::vector_bin_op(expr, left, right)?
                    }
                    (Value::Matrix(left), Value::Float(right)) => {
                        binary::vector_scalar_bin_op(expr, left, right, false)?
                    }
                    (Value::Float(left), Value::Matrix(right)) => {
                        binary::vector_scalar_bin_op(expr, right, left, true)?
                    }
                    // a set operator keeps the other side when one side has no series at all
                    (Value::None, Value::Matrix(right)) if expr.op.is_set_operator() => {
                        binary::vector_bin_op(expr, vec![], right)?
                    }
                    (Value::Matrix(left), Value::None) if expr.op.is_set_operator() => {
                        binary::vector_bin_op(expr, left, vec![])?
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
                    Value::Matrix(mut vs) => {
                        // For matrix type, update the time_window range
                        for rv in &mut vs {
                            // Update time_window with new range
                            rv.time_window = Some(TimeWindow::new(range));
                        }
                        vs
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
                let data = match self.try_streaming_instant_selector(vs).await? {
                    Some(data) => data,
                    None => {
                        let vs = selector::plain_selector(vs, "VectorSelector")?;
                        self.eval_vector_selector(&vs, None).await?
                    }
                };
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::MatrixSelector(MatrixSelector { vs, range }) => {
                let vs = selector::plain_selector(vs, "MatrixSelector")?;
                let data = self.eval_matrix_selector(&vs, *range, None).await?;
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

/// Folds a scalar-typed instant operand back into a scalar without broadcasting range samples.
fn scalar_operand(value: Value, expr: &PromExpr, eval_ctx: &EvalContext) -> Value {
    // a one-sample vector is not a scalar: it keeps its labels for matching
    match value {
        Value::Matrix(m)
            if eval_ctx.is_instant()
                && expr.value_type() == ValueType::Scalar
                && m.len() == 1
                && m[0].samples.len() == 1 =>
        {
            Value::Float(m[0].samples[0].value)
        }
        other => other,
    }
}

/// A range-query scalar with one value on every step, folded for a parameter that takes one value.
fn uniform_scalar(value: Value) -> Value {
    match value {
        Value::Matrix(series)
            if series.len() == 1
                && series[0].samples.first().is_some_and(|first| {
                    series[0]
                        .samples
                        .iter()
                        .all(|sample| sample.value.to_bits() == first.value.to_bits())
                }) =>
        {
            Value::Float(series[0].samples[0].value)
        }
        other => other,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{sync::Arc, time::Duration};

    use promql_parser::{
        label::{MatchOp, Matchers},
        parser::{
            AggregateExpr, BinaryExpr, Call, Extension, Function, FunctionArgs, MatrixSelector,
            NumberLiteral, Offset, ParenExpr, StringLiteral, SubqueryExpr, UnaryExpr,
            VectorSelector, token, value::ValueType,
        },
    };

    use super::*;
    use crate::exec::PromqlContext;

    // Test extension struct for testing
    #[derive(Debug)]
    pub(crate) struct TestExtension;

    impl promql_parser::parser::ast::ExtensionExpr for TestExtension {
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn name(&self) -> &str {
            "test_extension"
        }

        fn value_type(&self) -> ValueType {
            ValueType::String
        }

        fn children(&self) -> &[promql_parser::parser::Expr] {
            &[]
        }
    }

    pub(crate) fn range_value(timestamp: i64, value: f64) -> RangeValue {
        RangeValue {
            labels: vec![],
            samples: vec![Sample::new(timestamp, value)],
            exemplars: None,
            time_window: None,
        }
    }

    // Helper function to create test token types
    pub(crate) fn create_test_token() -> token::TokenType {
        token::TokenType::new(token::T_ADD)
    }

    // Helper function to create test QueryContext
    pub(crate) fn create_test_query_ctx(
        trace_id: &str,
        org_id: &str,
        timeout: u64,
    ) -> Arc<QueryContext> {
        Arc::new(QueryContext {
            trace_id: trace_id.to_string(),
            org_id: org_id.to_string(),
            query_exemplars: false,
            query_data: false,
            need_wal: false,
            use_cache: false,
            timeout,
            search_event_type: None,
            regions: vec![],
            clusters: vec![],
            is_super_cluster: false,
            search_event_context: None,
        })
    }

    // Helper function to create test EvalContext
    pub(crate) fn create_test_eval_ctx() -> EvalContext {
        EvalContext::new(
            1640995200000000i64,
            1640995200000000i64,
            0,
            "test_trace".to_string(),
        )
    }

    // Simple mock provider that implements the required trait
    pub(crate) struct SimpleMockProvider;

    #[async_trait::async_trait]
    impl crate::TableProvider for SimpleMockProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _machers: promql_parser::label::Matchers,
            _label_selector: HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> datafusion::error::Result<
            Vec<(
                datafusion::prelude::SessionContext,
                std::sync::Arc<datafusion::arrow::datatypes::Schema>,
                config::meta::search::ScanStats,
                bool,
            )>,
        > {
            Ok(vec![])
        }
    }

    /// Mock provider that records the matchers the engine hands to storage.
    pub(crate) struct MatcherCapturingProvider {
        pub(crate) captured: Arc<std::sync::Mutex<Option<Matchers>>>,
    }

    #[async_trait::async_trait]
    impl crate::TableProvider for MatcherCapturingProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            matchers: promql_parser::label::Matchers,
            _label_selector: HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> datafusion::error::Result<
            Vec<(
                datafusion::prelude::SessionContext,
                std::sync::Arc<datafusion::arrow::datatypes::Schema>,
                config::meta::search::ScanStats,
                bool,
            )>,
        > {
            *self.captured.lock().unwrap() = Some(matchers);
            Ok(vec![])
        }
    }

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
    async fn test_unary_matrix_preserves_timestamps_and_special_values() {
        let ctx = EvalContext::new(1_000_000, 3_000_000, 1_000_000, "test".into());
        for (input, expected) in [
            ("0", -0.0_f64),
            ("7", -7.0),
            ("Inf", f64::NEG_INFINITY),
            ("NaN", f64::NAN),
        ] {
            let mut engine = Engine::new(
                "test",
                Arc::new(PromqlContext::new(
                    create_test_query_ctx("test", "test_org", 30),
                    SimpleMockProvider,
                    vec![],
                )),
                ctx.clone(),
            );
            let query = format!(
                r#"-label_replace(label_replace(vector({input}), "job", "api", "", ""), "__name__", "m", "", "")"#
            );
            let expr = promql_parser::parser::parse(&query).unwrap();
            let Value::Matrix(matrix) = engine.exec_expr(&expr).await.unwrap() else {
                panic!("expected matrix");
            };
            assert_eq!(matrix.len(), 1);
            assert_eq!(matrix[0].labels.len(), 1);
            assert_eq!(matrix[0].labels[0].name, "job");
            assert_eq!(matrix[0].labels[0].value, "api");
            assert_eq!(matrix[0].samples.len(), 3);
            for (sample, timestamp) in matrix[0].samples.iter().zip(ctx.timestamps()) {
                assert_eq!(sample.timestamp, timestamp);
                if expected.is_nan() {
                    assert!(sample.value.is_nan());
                } else {
                    assert_eq!(sample.value.to_bits(), expected.to_bits());
                }
            }
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

    /// Evaluates `query` on the empty mock provider over `steps` one-minute steps.
    async fn eval_on_empty(query: &str, steps: i64) -> Result<Value> {
        let trace_id = "test_trace";
        let ctx = Arc::new(PromqlContext::new(
            create_test_query_ctx(trace_id, "test_org", 30),
            SimpleMockProvider,
            vec![],
        ));
        let start = 1640995200000000i64;
        let eval_ctx = EvalContext::new(
            start,
            start + (steps - 1) * 60000000,
            60000000,
            trace_id.to_string(),
        );
        let expr = promql_parser::parser::parse(query).unwrap();
        Engine::new(trace_id, ctx, eval_ctx).exec_expr(&expr).await
    }

    fn matrix(value: Value) -> Vec<RangeValue> {
        match value {
            Value::Matrix(series) => series,
            other => panic!("expected a matrix, got {:?}", other.get_type()),
        }
    }

    #[tokio::test]
    async fn test_set_operators_keep_the_other_side_when_one_is_empty() {
        // `up` has no data on the mock provider, so the fallback vector must come through
        for steps in [1, 3] {
            let series = matrix(eval_on_empty("up or vector(0)", steps).await.unwrap());
            assert_eq!(series.len(), 1, "{steps} steps");
            assert_eq!(series[0].samples.len(), steps as usize);
            assert!(series[0].samples.iter().all(|s| s.value == 0.0));
        }
        let series = matrix(eval_on_empty("vector(0) unless up", 3).await.unwrap());
        assert_eq!(series.len(), 1);
        assert!(matrix(eval_on_empty("vector(0) and up", 3).await.unwrap()).is_empty());

        // a right side filtered down to one sample must stay a vector for the set operator
        let sparse = r#"vector(0) or label_replace(timestamp(vector(1)) >= 1640995320, "source", "sparse", "", "")"#;
        let series = matrix(eval_on_empty(sparse, 3).await.unwrap());
        assert_eq!(series.len(), 2);
        assert_eq!(series.iter().map(|s| s.samples.len()).sum::<usize>(), 4);
    }

    fn single_value(value: Value) -> f64 {
        match value {
            Value::Float(f) => f,
            Value::Matrix(series) if series.len() == 1 && series[0].samples.len() == 1 => {
                series[0].samples[0].value
            }
            other => panic!("expected one value, got {:?}", other.get_type()),
        }
    }

    #[tokio::test]
    async fn test_scalar_typed_operands_fold_on_either_side() {
        // a one-sample vector keeps label matching: the sum exists at that one step only
        let series = matrix(
            eval_on_empty("vector(1) + (timestamp(vector(1)) >= 1640995320)", 3)
                .await
                .unwrap(),
        );
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].samples.len(), 1);
        assert_eq!(series[0].samples[0].value, 1640995321.0);

        // a scalar-typed side folds whichever side it is on, even against a labelled vector
        let labelled = r#"label_replace(vector(2), "job", "x", "", "")"#;
        for query in [
            "vector(1) + scalar(vector(2))".to_string(),
            format!("scalar(vector(1)) + {labelled}"),
            format!("sum(scalar(vector(1)) + {labelled})"),
            format!("{labelled} + scalar(vector(1))"),
            "scalar(vector(1)) + scalar(vector(2))".to_string(),
        ] {
            let value = eval_on_empty(&query, 1).await.unwrap();
            assert_eq!(single_value(value), 3.0, "{query}");
        }
    }

    #[tokio::test]
    async fn test_sparse_scalar_operands_preserve_timestamps() {
        for (filter, timestamp) in [
            ("== 1640995200", 1640995200000000),
            (">= 1640995320", 1640995320000000),
        ] {
            let sparse = format!("scalar(timestamp(vector(1)) {filter})");
            for query in [
                format!("{sparse} + vector(1)"),
                format!("vector(1) + {sparse}"),
            ] {
                let series = matrix(eval_on_empty(&query, 3).await.unwrap());
                assert_eq!(series.len(), 1, "{query}");
                // a scalar holds a value at every step, so a rejected step is NaN, not absent
                assert_eq!(series[0].samples.len(), 3, "{query}");
                let matched: Vec<_> = series[0]
                    .samples
                    .iter()
                    .filter(|sample| !sample.value.is_nan())
                    .collect();
                assert_eq!(matched.len(), 1, "{query}");
                assert_eq!(matched[0].timestamp, timestamp, "{query}");
                assert_eq!(
                    matched[0].value,
                    timestamp as f64 / 1_000_000.0 + 1.0,
                    "{query}"
                );
            }
        }
    }

    #[tokio::test]
    async fn test_constant_operands_preserve_range_steps() {
        for query in [
            "vector(2) + 1",
            "1 + vector(2)",
            "scalar(vector(1)) + vector(2)",
            "vector(2) + scalar(vector(1))",
        ] {
            let series = matrix(eval_on_empty(query, 3).await.unwrap());
            assert_eq!(series.len(), 1, "{query}");
            let samples = &series[0].samples;
            assert_eq!(samples.len(), 3, "{query}");
            for (index, sample) in samples.iter().enumerate() {
                assert_eq!(
                    sample.timestamp,
                    1640995200000000 + index as i64 * 60000000,
                    "{query}"
                );
                assert_eq!(sample.value, 3.0, "{query}");
            }
        }
    }

    #[tokio::test]
    async fn test_range_scalar_operand_broadcasts_to_labelled_series() {
        let labelled = r#"label_replace(vector(6), "job", "x", "", "")"#;
        for (query, expected) in [
            (format!("{labelled} / scalar(vector(3))"), 2.0),
            (format!("scalar(vector(3)) / {labelled}"), 0.5),
            (format!("{labelled} > scalar(vector(3))"), 6.0),
            (format!("scalar(vector(3)) < {labelled}"), 6.0),
        ] {
            let series = matrix(eval_on_empty(&query, 3).await.unwrap());
            assert_eq!(series.len(), 1, "{query}");
            assert_eq!(series[0].labels.len(), 1, "{query}");
            assert_eq!(series[0].labels[0].value, "x", "{query}");
            let values: Vec<f64> = series[0].samples.iter().map(|s| s.value).collect();
            assert_eq!(values, vec![expected; 3], "{query}");
        }
    }

    #[tokio::test]
    async fn test_time_follows_each_range_step() {
        let labelled = r#"label_replace(vector(1), "job", "x", "", "")"#;
        for query in [
            "time()".to_string(),
            "vector(time())".to_string(),
            "-(-time())".to_string(),
            "time() + vector(0)".to_string(),
            "scalar(vector(0)) + time()".to_string(),
            format!("{labelled} * time()"),
            "clamp_max(vector(1e10), time())".to_string(),
            "clamp_min(vector(0), time())".to_string(),
            "round(time() + vector(0.4))".to_string(),
        ] {
            let series = matrix(eval_on_empty(&query, 3).await.unwrap());
            assert_eq!(series.len(), 1, "{query}");
            let samples: Vec<(i64, f64)> = series[0]
                .samples
                .iter()
                .map(|s| (s.timestamp, s.value))
                .collect();
            assert_eq!(
                samples,
                vec![
                    (1640995200000000, 1640995200.0),
                    (1640995260000000, 1640995260.0),
                    (1640995320000000, 1640995320.0),
                ],
                "{query}"
            );
        }
        let series = matrix(
            eval_on_empty("time() - timestamp(vector(1))", 3)
                .await
                .unwrap(),
        );
        assert_eq!(series[0].samples.len(), 3);
        assert!(series[0].samples.iter().all(|s| s.value == 0.0));
    }

    #[tokio::test]
    async fn test_step_scalar_function_arguments() {
        // max is -60, 0 and 60 on the three steps; Prometheus drops the step where it is below min
        let series = matrix(
            eval_on_empty("clamp(vector(5), 0, time() - 1640995260)", 3)
                .await
                .unwrap(),
        );
        let samples: Vec<(i64, f64)> = series[0]
            .samples
            .iter()
            .map(|s| (s.timestamp, s.value))
            .collect();
        assert_eq!(
            samples,
            vec![(1640995260000000, 0.0), (1640995320000000, 5.0)]
        );

        let series = matrix(
            eval_on_empty("round(vector(7), time() - 1640995195)", 3)
                .await
                .unwrap(),
        );
        let values: Vec<f64> = series[0].samples.iter().map(|s| s.value).collect();
        assert_eq!(values, vec![5.0, 0.0, 0.0]);
    }

    #[tokio::test]
    async fn test_single_valued_parameters_take_a_step_invariant_scalar() {
        let series = matrix(
            eval_on_empty("topk(scalar(vector(1)), vector(1))", 3)
                .await
                .unwrap(),
        );
        assert_eq!(series[0].samples.len(), 3);
        for query in [
            "topk(time(), vector(1))",
            "quantile(time(), vector(1))",
            "quantile_over_time(time(), vector(1)[1m:1m])",
        ] {
            assert!(eval_on_empty(query, 3).await.is_err(), "{query}");
        }
    }

    #[tokio::test]
    async fn test_time_folds_to_scalar_in_instant_query() {
        for (query, expected) in [("time()", 1640995200.0), ("time() - 60", 1640995140.0)] {
            match eval_on_empty(query, 1).await.unwrap() {
                Value::Float(value) => assert_eq!(value, expected, "{query}"),
                other => panic!("expected a scalar for {query}, got {:?}", other.get_type()),
            }
        }
        let value = eval_on_empty("vector(time()) - timestamp(vector(1))", 1)
            .await
            .unwrap();
        assert_eq!(single_value(value), 0.0);
    }

    #[test]
    fn test_scalar_operand_keeps_single_step_range_timestamp() {
        let eval_ctx = EvalContext::new(1_000_000, 1_500_000, 1_000_000, "test".into());
        assert_eq!(eval_ctx.timestamps(), vec![1_000_000]);
        let expr = promql_parser::parser::parse("scalar(vector(1))").unwrap();
        let value = Value::Matrix(vec![RangeValue {
            samples: vec![Sample::new(1_000_000, 1.0)],
            ..Default::default()
        }]);
        let series = matrix(scalar_operand(value, &expr, &eval_ctx));
        assert_eq!(series[0].samples[0].timestamp, 1_000_000);
        assert_eq!(series[0].samples[0].value, 1.0);
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
