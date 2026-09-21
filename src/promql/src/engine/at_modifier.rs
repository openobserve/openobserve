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

use std::sync::Arc;

use config::meta::promql::value::{EvalContext, Sample, Value};
use datafusion::error::Result;
use promql_parser::parser::Expr as PromExpr;

use super::Engine;
use crate::{
    ast::at_modifier::{Pin, pin, rebase_at},
    exec::PromqlContext,
};

impl Engine {
    /// Evaluates a step-invariant expression once, as an instant query at `at`, for every step.
    pub(super) async fn exec_pinned(&mut self, expr: &PromExpr, at: i64) -> Result<Value> {
        let value = self.exec_at(expr, at).await?;
        Ok(repeat_on_steps(value, &self.eval_ctx.timestamps()))
    }

    /// The root `m[5m] @ T` of an instant query answers with its raw samples, which have no step.
    pub(super) async fn exec_root_range_selector(
        &mut self,
        expr: &PromExpr,
    ) -> Result<Option<Value>> {
        let mut root = expr;
        while let PromExpr::Paren(paren) = root {
            root = &paren.expr;
        }
        if !self.eval_ctx.is_instant() || !matches!(root, PromExpr::MatrixSelector(_)) {
            return Ok(None);
        }
        match pin(root)? {
            Pin::At(at) => self.exec_at(root, at).await.map(Some),
            _ => Ok(None),
        }
    }

    pub(super) async fn exec_at(&mut self, expr: &PromExpr, at: i64) -> Result<Value> {
        let mut expr = expr.clone();
        rebase_at(&mut expr, at);
        let pinned_ctx = Arc::new(PromqlContext {
            start: at,
            end: at,
            ..(*self.ctx).clone()
        });
        let pinned_eval_ctx = EvalContext::new(at, at, self.eval_ctx.step, self.trace_id.clone());
        let ctx = std::mem::replace(&mut self.ctx, pinned_ctx);
        let eval_ctx = std::mem::replace(&mut self.eval_ctx, pinned_eval_ctx);
        // the rebase left no `@` behind
        let has_at_modifier = std::mem::replace(&mut self.has_at_modifier, false);
        let value = self.exec_expr(&expr).await;
        self.ctx = ctx;
        self.eval_ctx = eval_ctx;
        self.has_at_modifier = has_at_modifier;
        value
    }
}

fn repeat_on_steps(value: Value, timestamps: &[i64]) -> Value {
    let Value::Matrix(series) = value else {
        return value;
    };
    let series = series.into_iter().filter_map(|mut series| {
        let value = series.samples.last()?.value;
        series.samples = timestamps
            .iter()
            .map(|&timestamp| Sample::new(timestamp, value))
            .collect();
        Some(series)
    });
    Value::Matrix(series.collect())
}
