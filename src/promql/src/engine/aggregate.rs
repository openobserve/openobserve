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
    aggregations::{self, Avg, Count, Group, Max, Min, Stddev, Stdvar, Sum, eval_aggregate},
    functions, fused,
};

/// A recognized fused shape: `agg(range_func(...))`, or `agg(instant_selector)` read as
/// `last_over_time` over the lookback window.
struct FusedAggShape<'a> {
    op: fused::FusedAggOp,
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
        // fused shapes fold the range function into the aggregation; others stay generic
        if let Some(shape) = fused_agg_shape(op, expr) {
            if let Some((selector, range)) = shape.selector {
                let range = range.unwrap_or_else(|| self.ctx.lookback());
                if let Some(value) = self
                    .try_streaming_fused_agg(
                        selector,
                        range,
                        modifier,
                        shape.func.clone(),
                        shape.op,
                    )
                    .await?
                {
                    return Ok(value);
                }
            }
            if let Some(range_arg) = shape.range_arg {
                let range_input = self.exec_expr(range_arg).await?;
                return self
                    .materialized_fused_agg(modifier, range_input, shape.func, shape.op)
                    .await;
            }
        }

        let input = self.exec_expr(expr).await?;

        let eval_ctx = self.eval_ctx.clone();

        match op.id() {
            token::T_SUM => eval_aggregate(modifier, input, Sum, &eval_ctx),
            token::T_AVG => eval_aggregate(modifier, input, Avg, &eval_ctx),
            token::T_COUNT => eval_aggregate(modifier, input, Count, &eval_ctx),
            token::T_MIN => eval_aggregate(modifier, input, Min, &eval_ctx),
            token::T_MAX => eval_aggregate(modifier, input, Max, &eval_ctx),
            token::T_GROUP => eval_aggregate(modifier, input, Group, &eval_ctx),
            token::T_STDDEV => eval_aggregate(modifier, input, Stddev, &eval_ctx),
            token::T_STDVAR => eval_aggregate(modifier, input, Stdvar, &eval_ctx),
            token::T_TOPK => {
                let param_expr = param.as_ref().unwrap();
                let k_value = self.exec_expr(param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[topk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::topk(k, modifier, input, &eval_ctx)
            }
            token::T_BOTTOMK => {
                let param_expr = param.as_ref().unwrap();
                let k_value = self.exec_expr(param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[bottomk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::bottomk(k, modifier, input, &eval_ctx)
            }
            token::T_COUNT_VALUES => {
                let param_expr = param.as_ref().unwrap();
                let label_name = self.exec_expr(param_expr).await?;
                let label_name_str = match label_name {
                    Value::String(s) => s,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[count_values] param must be a string".to_string(),
                        ));
                    }
                };
                aggregations::count_values(&label_name_str, modifier, input, &eval_ctx)
            }
            token::T_QUANTILE => {
                let param_expr = param.as_ref().unwrap();
                let qtile_value = self.exec_expr(param_expr).await?;
                let qtile = match qtile_value {
                    Value::Float(f) => f,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[quantile] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::quantile(qtile, input, &eval_ctx)
            }
            _ => Err(DataFusionError::NotImplemented(format!(
                "Unsupported Aggregate: {op:?}"
            ))),
        }
    }

    /// The fused fold over an already-materialized matrix, bounded by the query timeout.
    pub(super) async fn materialized_fused_agg(
        &self,
        modifier: &Option<LabelModifier>,
        data: Value,
        func: Arc<dyn functions::RangeFunc>,
        op: fused::FusedAggOp,
    ) -> Result<Value> {
        let Some((sources, range)) =
            fused::materialized::group_sources(data, modifier, func.name())?
        else {
            return Ok(Value::None);
        };
        let eval = Arc::new(fused::RangeExpr::new(func, range, &self.eval_ctx));
        let timeout = Duration::from_secs(self.ctx.query_ctx.timeout);
        let (value, _) = tokio::time::timeout(timeout, fused::aggregate(sources, op, eval))
            .await
            .map_err(|_| {
                DataFusionError::from(ErrorCodes::SearchTimeout(
                    "[PromQL] fused agg timeout".to_string(),
                ))
            })??;
        Ok(value)
    }
}

fn fused_agg_shape<'a>(op: &token::TokenType, expr: &'a PromExpr) -> Option<FusedAggShape<'a>> {
    if !config::get_config()
        .search
        .feature_metrics_fused_agg_enabled
    {
        return None;
    }
    let agg_op = fused::FusedAggOp::from_token(op.id())?;
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
                op: agg_op,
                func: Arc::from(range_func),
                range_arg: Some(range_arg),
                selector,
            })
        }
        // an instant selector picks the last sample in the lookback window and keeps the metric
        // name, which is exactly last_over_time
        PromExpr::VectorSelector(selector) => Some(FusedAggShape {
            op: agg_op,
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

    fn shape(query: &str) -> Option<(String, bool, Option<Option<Duration>>)> {
        let PromExpr::Aggregate(AggregateExpr { op, expr, .. }) = parse(query).unwrap() else {
            panic!("{query} is not an aggregation");
        };
        fused_agg_shape(&op, &expr).map(|shape| {
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
        assert_eq!(shape("topk(3, rate(m[5m]))"), None);
    }
}
