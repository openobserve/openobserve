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

use std::sync::Arc;

use config::meta::promql::value::*;
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{Call, Expr as PromExpr, LabelModifier, token};

use super::Engine;
use crate::{aggregations, functions, fused};

/// A recognized `agg(range_func(...))` expression, the shape the fused evaluators accept.
struct FusedAggShape<'a> {
    op: fused::FusedAggOp,
    func: Arc<dyn functions::RangeFunc>,
    range_arg: &'a PromExpr,
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
            // only a plain matrix selector can be planned as ordered shard streams
            if let PromExpr::MatrixSelector(matrix_selector) = shape.range_arg {
                return self
                    .fused_agg_over_selector(matrix_selector, modifier, shape.func, shape.op)
                    .await;
            }
            let range_input = self.exec_expr(shape.range_arg).await?;
            return fused::matrix::fused_agg(
                modifier,
                range_input,
                shape.func,
                shape.op,
                &self.eval_ctx,
                self.ctx.query_ctx.timeout,
            )
            .await;
        }

        let input = self.exec_expr(expr).await?;

        let eval_ctx = self.eval_ctx.clone();

        Ok(match op.id() {
            token::T_SUM => aggregations::sum(modifier, input, &eval_ctx)?,
            token::T_AVG => aggregations::avg(modifier, input, &eval_ctx)?,
            token::T_COUNT => aggregations::count(modifier, input, &eval_ctx)?,
            token::T_MIN => aggregations::min(modifier, input, &eval_ctx)?,
            token::T_MAX => aggregations::max(modifier, input, &eval_ctx)?,
            token::T_GROUP => aggregations::group(modifier, input, &eval_ctx)?,
            token::T_STDDEV => aggregations::stddev(modifier, input, &eval_ctx)?,
            token::T_STDVAR => aggregations::stdvar(modifier, input, &eval_ctx)?,
            token::T_TOPK => {
                let param_expr = param.clone().unwrap();
                let k_value = self.exec_expr(&param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[topk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::topk(k, modifier, input, &eval_ctx)?
            }
            token::T_BOTTOMK => {
                let param_expr = param.clone().unwrap();
                let k_value = self.exec_expr(&param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[bottomk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::bottomk(k, modifier, input, &eval_ctx)?
            }
            token::T_COUNT_VALUES => {
                let param_expr = param.clone().unwrap();
                let label_name = self.exec_expr(&param_expr).await?;
                let label_name_str = match label_name {
                    Value::String(s) => s,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[count_values] param must be a string".to_string(),
                        ));
                    }
                };
                aggregations::count_values(&label_name_str, modifier, input, &eval_ctx)?
            }
            token::T_QUANTILE => {
                let param_expr = param.clone().unwrap();
                let qtile_value = self.exec_expr(&param_expr).await?;
                let qtile = match qtile_value {
                    Value::Float(f) => f,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[quantile] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::quantile(qtile, input, &eval_ctx)?
            }
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Aggregate: {op:?}"
                )));
            }
        })
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
    let PromExpr::Call(Call { func, args }) = expr else {
        return None;
    };
    let [range_arg] = args.args.as_slice() else {
        return None;
    };
    let range_func = functions::fusable_range_func(func.name)?;
    Some(FusedAggShape {
        op: agg_op,
        func: Arc::from(range_func),
        range_arg,
    })
}
