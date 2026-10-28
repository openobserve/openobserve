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
    micros,
    utils::offset_micros,
};

impl Engine {
    /// Evaluates a step-invariant expression once, as an instant query at `at`, for every step.
    pub(super) async fn exec_pinned(&mut self, expr: &PromExpr, at: i64) -> Result<Value> {
        let value = self.exec_at(expr, at).await?;
        Ok(repeat_on_steps(value, &self.eval_ctx.timestamps()))
    }

    /// The root `m[5m]` of an instant query answers with the raw samples in `(t - 5m, t]`.
    pub(super) async fn exec_root_range_selector(
        &mut self,
        expr: &PromExpr,
    ) -> Result<Option<Value>> {
        let mut root = expr;
        while let PromExpr::Paren(paren) = root {
            root = &paren.expr;
        }
        let PromExpr::MatrixSelector(selector) = root else {
            return Ok(None);
        };
        if !self.eval_ctx.is_instant() {
            return Ok(None);
        }
        let (value, eval_ts) = match pin(root)? {
            Pin::At(at) => (self.exec_at(root, at).await?, at),
            _ => (self.exec_expr(root).await?, self.eval_ctx.end),
        };
        let window_start = eval_ts - micros(selector.range);
        Ok(Some(raw_window_samples(
            value,
            window_start,
            offset_micros(&selector.vs.offset),
        )))
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

/// Drops the loaded samples at or before `window_start` and undoes the offset's time shift.
fn raw_window_samples(value: Value, window_start: i64, offset: i64) -> Value {
    let Value::Matrix(mut matrix) = value else {
        return value;
    };
    matrix.retain_mut(|series| {
        let loaded = series.samples.len();
        series
            .samples
            .retain(|sample| sample.timestamp > window_start);
        for sample in &mut series.samples {
            sample.timestamp -= offset;
        }
        // an exemplar query reads the exemplars, which ride on series whose samples it ignores
        let has_exemplars = series.exemplars.as_ref().is_some_and(|e| !e.is_empty());
        loaded == 0 || !series.samples.is_empty() || has_exemplars
    });
    if matrix.is_empty() {
        Value::None
    } else {
        Value::Matrix(matrix)
    }
}
