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

//! Aggregation dispatch over the fused and generic evaluators.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::*;
use datafusion::error::{DataFusionError, Result};
use infra::errors::ErrorCodes;
use promql_parser::parser::{
    Call, Expr as PromExpr, LabelModifier, MatrixSelector, VectorSelector, token,
};

use super::Engine;
use crate::{
    aggregations::{self, AggOp},
    functions, series_stream, streaming_eval,
};

/// A recognized fused shape: `agg(range_func(...))`, or `agg(instant_selector)` read as
/// `last_over_time` over the lookback window.
struct FusedAggShape<'a> {
    func: Arc<dyn functions::RangeFunc>,
    /// The range function's argument to materialize; `None` for the instant shape, which has
    /// no range function and stays generic when it cannot stream.
    range_arg: Option<&'a PromExpr>,
    /// The plain selector under the shape, when it can be planned as ordered partition streams;
    /// a `None` range is the instant lookback.
    selector: Option<(&'a VectorSelector, Option<Duration>)>,
}

impl Engine {
    pub(super) async fn aggregate_exprs(
        &mut self,
        op: &token::TokenType,
        expr: &PromExpr,
        param: &Option<Box<PromExpr>>,
        modifier: &Option<LabelModifier>,
    ) -> Result<Value> {
        let param = match param {
            Some(param) => Some(self.exec_expr(param).await?),
            None => None,
        };
        let eval_ctx = self.eval_ctx.clone();
        match op.id() {
            token::T_QUANTILE => {
                let Some(Value::Float(value)) = param else {
                    return Err(DataFusionError::Plan(
                        "[quantile] param must be a number".to_string(),
                    ));
                };
                let input = self.exec_expr(expr).await?;
                aggregations::quantile(value, input, &eval_ctx)
            }
            token::T_COUNT_VALUES => {
                let Some(Value::String(label_name)) = param else {
                    return Err(DataFusionError::Plan(
                        "[count_values] param must be a string".to_string(),
                    ));
                };
                let input = self.exec_expr(expr).await?;
                aggregations::count_values(&label_name, modifier, input, &eval_ctx)
            }
            _ => {
                let agg_op = AggOp::new(op, param)?;
                if let Some(value) = self.fused_agg(agg_op, expr, modifier).await? {
                    return Ok(value);
                }
                let input = self.exec_expr(expr).await?;
                agg_op.eval_aggregate(modifier, input, &eval_ctx)
            }
        }
    }

    /// The aggregation folded with its range function when the shape allows it; `None` leaves
    /// it to the generic fold.
    async fn fused_agg(
        &mut self,
        agg_op: AggOp,
        expr: &PromExpr,
        modifier: &Option<LabelModifier>,
    ) -> Result<Option<Value>> {
        let Some(shape) = fused_agg_shape(expr) else {
            return Ok(None);
        };
        if let Some((selector, range)) = shape.selector {
            let range = range.unwrap_or_else(|| self.ctx.lookback());
            if let Some(value) = self
                .try_streaming_fused_agg(selector, range, modifier, shape.func.clone(), agg_op)
                .await?
            {
                return Ok(Some(value));
            }
        }
        let Some(range_arg) = shape.range_arg else {
            return Ok(None);
        };
        let range_input = self.exec_expr(range_arg).await?;
        self.materialized_fused_agg(modifier, range_input, shape.func, agg_op)
            .await
            .map(Some)
    }

    /// The fused fold over an already-materialized matrix, bounded by the query timeout.
    pub(super) async fn materialized_fused_agg(
        &self,
        modifier: &Option<LabelModifier>,
        data: Value,
        func: Arc<dyn functions::RangeFunc>,
        op: AggOp,
    ) -> Result<Value> {
        let Some((sources, range)) = series_stream::matrix::group_sources(
            data,
            modifier,
            func.name(),
            op.needs_series_labels(),
        )?
        else {
            return Ok(Value::None);
        };
        let eval = Arc::new(streaming_eval::RangeExpr::new(func, range, &self.eval_ctx));
        let timeout = Duration::from_secs(self.ctx.query_ctx.timeout);
        let (value, _) =
            tokio::time::timeout(timeout, streaming_eval::aggregate(sources, op, eval))
                .await
                .map_err(|_| {
                    DataFusionError::from(ErrorCodes::SearchTimeout(
                        "[PromQL] fused agg timeout".to_string(),
                    ))
                })??;
        Ok(value)
    }
}

/// The shapes the fused fold recognizes, every operator alike behind the fused-fold flag.
fn fused_agg_shape(expr: &PromExpr) -> Option<FusedAggShape<'_>> {
    if !config::get_config()
        .search
        .feature_metrics_fused_agg_enabled
    {
        return None;
    }
    match expr {
        PromExpr::Call(Call { func, args }) => {
            let [range_arg] = args.args.as_slice() else {
                return None;
            };
            let range_arg: &PromExpr = range_arg;
            let range_func = functions::fusable_range_func(func.name)?;
            let selector = match range_arg {
                PromExpr::MatrixSelector(MatrixSelector { vs, range }) => Some((vs, Some(*range))),
                _ => None,
            };
            Some(FusedAggShape {
                func: Arc::from(range_func),
                range_arg: Some(range_arg),
                selector,
            })
        }
        // an instant selector picks the last sample in the lookback window and keeps the metric
        // name, which is exactly last_over_time
        PromExpr::VectorSelector(selector) => Some(FusedAggShape {
            func: functions::instant_lookback_func(),
            range_arg: None,
            selector: Some((selector, None)),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser::{AggregateExpr, parse};

    use super::*;

    #[tokio::test]
    async fn test_numeric_aggregation_dispatch() {
        use crate::{engine::tests::*, exec::PromqlContext};

        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        for (name, param) in [("topk", "1"), ("bottomk", "1"), ("quantile", "0.5")] {
            let mut expr = parse(&format!("{name}({param}, vector(5))")).unwrap();
            let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
                panic!("expected matrix for {name}");
            };
            assert_eq!(series.len(), 1);
            assert_eq!(series[0].samples[0].value, 5.0);

            let PromExpr::Aggregate(aggregate) = &mut expr else {
                unreachable!();
            };
            aggregate.param = Some(Box::new(parse(r#""invalid""#).unwrap()));
            let result = engine.exec_expr(&expr).await;
            assert!(
                matches!(result, Err(DataFusionError::Plan(message)) if message == format!("[{name}] param must be a number"))
            );
        }
    }

    /// A k that is not a literal is evaluated after the input and builds the same operator.
    #[tokio::test]
    async fn test_non_literal_k_evaluates_generically() {
        use crate::{engine::tests::*, exec::PromqlContext};

        let mut engine = Engine::new(
            "test",
            Arc::new(PromqlContext::new(
                create_test_query_ctx("test", "test_org", 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        for query in ["topk(2 - 1, vector(5))", "bottomk(1 + 0, vector(5))"] {
            let expr = parse(query).unwrap();
            let Value::Matrix(series) = engine.exec_expr(&expr).await.unwrap() else {
                panic!("expected matrix for {query}");
            };
            assert_eq!(series.len(), 1, "{query}");
            assert_eq!(series[0].samples[0].value, 5.0, "{query}");
        }
    }

    fn shape(query: &str) -> Option<(String, bool, Option<Option<Duration>>)> {
        let PromExpr::Aggregate(AggregateExpr { expr, .. }) = parse(query).unwrap() else {
            panic!("{query} is not an aggregation");
        };
        fused_agg_shape(&expr).map(|shape| {
            (
                shape.func.name().to_string(),
                shape.range_arg.is_some(),
                shape.selector.map(|(_, range)| range),
            )
        })
    }

    #[test]
    fn test_fused_agg_shape_recognizes_range_and_instant_selectors() {
        assert_eq!(
            shape("sum(rate(m[5m]))"),
            Some((
                "rate".to_string(),
                true,
                Some(Some(Duration::from_secs(300)))
            ))
        );
        // a range function over a non-selector materializes but cannot stream
        assert_eq!(
            shape("sum(rate((m)[5m:1m]))"),
            Some(("rate".to_string(), true, None))
        );
        assert_eq!(
            shape("sum by(instance) (m{job=\"a\"} offset 1m)"),
            Some(("last_over_time".to_string(), false, Some(None)))
        );
        assert_eq!(shape("sum(abs(m))"), None);
    }

    #[test]
    fn test_fused_agg_shape_ignores_the_parameter() {
        assert_eq!(
            shape("topk(3, rate(m[5m]))"),
            Some((
                "rate".to_string(),
                true,
                Some(Some(Duration::from_secs(300)))
            ))
        );
        assert_eq!(
            shape("bottomk by(instance) (2, m{job=\"a\"} offset 1m)"),
            Some(("last_over_time".to_string(), false, Some(None)))
        );
        assert_eq!(
            shape("topk(scalar(m), m)"),
            Some(("last_over_time".to_string(), false, Some(None)))
        );
        assert_eq!(shape("topk(3, abs(m))"), None);
    }
}
