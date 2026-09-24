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

//! Subquery evaluation: the inner expression runs once, on the subquery's own step grid, over
//! every window the evaluated range reads.

use std::sync::Arc;

use config::meta::promql::value::{EvalContext, RangeValue, TimeWindow, Value};
use datafusion::error::{DataFusionError, Result};
use infra::errors::ErrorCodes;
use promql_parser::parser::{Expr as PromExpr, SubqueryExpr};
use rayon::iter::{IntoParallelRefMutIterator, ParallelIterator};

use super::Engine;
use crate::{DEFAULT_SUBQUERY_STEP, exec::PromqlContext, micros, utils::offset_micros};

impl Engine {
    /// A subquery as a range function reads it: its samples moved forward by its offset.
    pub(super) async fn exec_subquery(&mut self, sq: &SubqueryExpr) -> Result<Value> {
        let mut series = self.eval_subquery(sq).await?;
        let offset = offset_micros(&sq.offset);
        if offset != 0 {
            series.par_iter_mut().for_each(|series| {
                series
                    .samples
                    .iter_mut()
                    .for_each(|sample| sample.timestamp += offset);
            });
        }
        Ok(matrix_or_none(series))
    }

    /// The root subquery of an instant query answers with its samples at their own timestamps.
    pub(super) async fn exec_root_subquery(&mut self, expr: &PromExpr) -> Result<Option<Value>> {
        let mut root = expr;
        while let PromExpr::Paren(paren) = root {
            root = &paren.expr;
        }
        match root {
            PromExpr::Subquery(sq) if self.eval_ctx.is_instant() && sq.at.is_none() => {
                Ok(Some(matrix_or_none(self.eval_subquery(sq).await?)))
            }
            _ => Ok(None),
        }
    }

    async fn eval_subquery(&mut self, sq: &SubqueryExpr) -> Result<Vec<RangeValue>> {
        let (start, end, step) = subquery_grid(&self.eval_ctx, sq);
        if start > end {
            return Ok(vec![]);
        }
        let steps = (end - start) / step + 1;
        let max_points = config::get_config().limit.metrics_max_points_per_series as i64;
        if steps > max_points {
            return Err(ErrorCodes::InvalidParams(format!(
                "subquery evaluates {steps} steps per series, more than the {max_points} allowed by ZO_METRICS_MAX_POINTS_PER_SERIES; use a larger subquery step"
            ))
            .into());
        }

        let child_ctx = Arc::new(PromqlContext {
            start,
            end,
            interval: step,
            ..(*self.ctx).clone()
        });
        let child_eval_ctx = EvalContext::new(start, end, step, self.trace_id.clone());
        let ctx = std::mem::replace(&mut self.ctx, child_ctx);
        let eval_ctx = std::mem::replace(&mut self.eval_ctx, child_eval_ctx);
        let value = self.exec_expr(&sq.expr).await;
        self.ctx = ctx;
        self.eval_ctx = eval_ctx;

        let mut series = match value? {
            Value::Matrix(series) => series,
            Value::None => return Ok(vec![]),
            v => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported subquery, the return value should have been a matrix but got {:?}",
                    v.get_type()
                )));
            }
        };
        let window = TimeWindow::new(sq.range);
        series
            .iter_mut()
            .for_each(|series| series.time_window = Some(window.clone()));
        Ok(series)
    }
}

/// The subquery's `(start, end, step)` for the evaluated range, as Prometheus evaluates it.
fn subquery_grid(outer: &EvalContext, sq: &SubqueryExpr) -> (i64, i64, i64) {
    let step = micros(
        sq.step
            .filter(|step| !step.is_zero())
            .unwrap_or(DEFAULT_SUBQUERY_STEP),
    );
    let offset = offset_micros(&sq.offset);
    // the grid sits on absolute multiples of the step, so every range and worker sees the same one
    let first = outer.start - offset - micros(sq.range);
    let start = (first.div_euclid(step) + 1) * step;
    (start, outer.end - offset, step)
}

fn matrix_or_none(series: Vec<RangeValue>) -> Value {
    if series.is_empty() {
        Value::None
    } else {
        Value::Matrix(series)
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;
    use crate::engine::tests::*;

    const SECOND: i64 = 1_000_000;
    const MINUTE: i64 = 60 * SECOND;
    // 2022-01-01T00:00:00Z, on the minute but not on a 7 minute multiple
    const T: i64 = 1_640_995_200 * SECOND;

    fn engine(start: i64, end: i64, step: i64) -> Engine {
        let mut ctx = PromqlContext::new(
            create_test_query_ctx("test_trace", "test_org", 30),
            SimpleMockProvider,
            vec![],
        );
        ctx.start = start;
        ctx.end = end;
        ctx.interval = step;
        let eval_ctx = EvalContext::new(start, end, step, "test_trace".into());
        Engine::new("test_trace", Arc::new(ctx), eval_ctx)
    }

    async fn eval(query: &str, start: i64, end: i64, step: i64) -> Result<Value> {
        let expr = parser::parse(query).unwrap();
        engine(start, end, step)
            .exec(&expr)
            .await
            .map(|(value, _)| value)
    }

    async fn samples(query: &str, start: i64, end: i64, step: i64) -> Vec<(i64, f64)> {
        let Value::Matrix(series) = eval(query, start, end, step).await.unwrap() else {
            panic!("{query}: expected a matrix");
        };
        assert_eq!(series.len(), 1, "{query}");
        series[0]
            .samples
            .iter()
            .map(|sample| (sample.timestamp, sample.value))
            .collect()
    }

    fn grid(query: &str, start: i64, end: i64) -> (i64, i64, i64) {
        let PromExpr::Subquery(sq) = parser::parse(query).unwrap() else {
            panic!("{query}: expected a subquery");
        };
        subquery_grid(&EvalContext::new(start, end, MINUTE, "t".into()), &sq)
    }

    #[test]
    fn test_subquery_grid_aligns_to_absolute_step_multiples() {
        // the left edge of the window is open, so an aligned edge is not a step
        assert_eq!(grid("up[10m:1m]", T, T), (T - 9 * MINUTE, T, MINUTE));
        assert_eq!(
            grid("up[10m:1m]", T + 30 * SECOND, T + 90 * SECOND),
            (T - 9 * MINUTE, T + 90 * SECOND, MINUTE)
        );
        assert_eq!(
            grid("up[10m:1m] offset 5m", T, T),
            (T - 14 * MINUTE, T - 5 * MINUTE, MINUTE)
        );
        assert_eq!(
            grid("up[10m:1m] offset -5m", T, T),
            (T - 4 * MINUTE, T + 5 * MINUTE, MINUTE)
        );
        assert_eq!(grid("up[10m:7m]", T, T), (T - 3 * MINUTE, T, 7 * MINUTE));
        // an omitted step falls back to the default evaluation interval
        assert_eq!(
            grid("up[5m:]", T + SECOND, T + SECOND),
            (T - 4 * MINUTE, T + SECOND, MINUTE)
        );
        // a window shorter than the step may hold no step at all
        let (start, end, _) = grid("up[30s:1m]", T + 40 * SECOND, T + 40 * SECOND);
        assert!(start > end);
    }

    #[tokio::test]
    async fn test_instant_subquery_evaluates_every_inner_step() {
        for (query, expected) in [
            ("count_over_time(vector(1)[1m:1s])", 60.0),
            ("count_over_time(vector(1)[10m:1m])", 10.0),
            ("count_over_time(vector(1)[10m:])", 10.0),
            (
                "max_over_time(timestamp(vector(1))[10m:1m] offset 3m)",
                (T - 3 * MINUTE) as f64 / 1e6,
            ),
            (
                "min_over_time(timestamp(vector(1))[10m:1m])",
                (T - 9 * MINUTE) as f64 / 1e6,
            ),
            ("deriv(timestamp(vector(1))[10m:1m])", 1.0),
            ("predict_linear(vector(5)[1m:1s], 10)", 5.0),
            ("rate(timestamp(vector(1))[10m:1m])", 1.0),
            ("sum_over_time(vector(scalar(vector(2)))[10m:1m])", 20.0),
            // nested: each outer step holds a count of 6 inner steps
            (
                "sum_over_time(count_over_time(vector(1)[1m:10s])[5m:1m])",
                30.0,
            ),
        ] {
            assert_eq!(
                samples(query, T, T, MINUTE).await,
                vec![(T, expected)],
                "{query}"
            );
        }
    }

    #[tokio::test]
    async fn test_range_subquery_reads_before_the_first_step() {
        let end = T + 2 * MINUTE;
        let steps = |value: fn(i64) -> f64| -> Vec<(i64, f64)> {
            (0..3)
                .map(|i| T + i * MINUTE)
                .map(|t| (t, value(t)))
                .collect()
        };
        assert_eq!(
            samples("count_over_time(vector(1)[5m:1m])", T, end, MINUTE).await,
            steps(|_| 5.0)
        );
        assert_eq!(
            samples("count_over_time(vector(1)[5m:20s])", T, end, MINUTE).await,
            steps(|_| 15.0)
        );
        assert_eq!(
            samples(
                "min_over_time(timestamp(vector(1))[5m:1m] offset 1m)",
                T,
                end,
                MINUTE
            )
            .await,
            steps(|t| (t - 5 * MINUTE) as f64 / 1e6)
        );
        // an outer step off the subquery grid still windows the aligned inner steps
        let off_grid = T + 30 * SECOND;
        assert_eq!(
            samples(
                "max_over_time(timestamp(vector(1))[5m:1m])",
                off_grid,
                off_grid + MINUTE,
                MINUTE
            )
            .await,
            vec![
                (off_grid, T as f64 / 1e6),
                (off_grid + MINUTE, (T + MINUTE) as f64 / 1e6)
            ]
        );
    }

    #[tokio::test]
    async fn test_root_subquery_of_an_instant_query_keeps_inner_timestamps() {
        let inner = |from: i64| -> Vec<(i64, f64)> {
            (0..5)
                .map(|i| from + i * 2 * MINUTE)
                .map(|t| (t, t as f64 / 1e6))
                .collect()
        };
        assert_eq!(
            samples("timestamp(vector(1))[10m:2m]", T, T, MINUTE).await,
            inner(T - 8 * MINUTE)
        );
        assert_eq!(
            samples("(timestamp(vector(1))[10m:2m] offset 4m)", T, T, MINUTE).await,
            inner(T - 12 * MINUTE)
        );
    }

    #[tokio::test]
    async fn test_subquery_without_data_is_none() {
        for query in [
            "max_over_time(up[5m:1m])",
            "up[5m:1m]",
            "count_over_time(vector(1)[30s:1m])",
        ] {
            let value = eval(query, T + 40 * SECOND, T + 40 * SECOND, MINUTE)
                .await
                .unwrap();
            assert!(matches!(value, Value::None), "{query}: {value:?}");
        }
    }

    #[tokio::test]
    async fn test_subquery_step_count_is_bounded() {
        let max = config::get_config().limit.metrics_max_points_per_series as u64;
        let query = format!("count_over_time(vector(1)[{}s:1s])", max + 1);
        let err = eval(&query, T, T, MINUTE).await.unwrap_err().to_string();
        assert!(err.contains("ZO_METRICS_MAX_POINTS_PER_SERIES"), "{err}");
        let query = format!("count_over_time(vector(1)[{max}s:1s])");
        assert_eq!(samples(&query, T, T, MINUTE).await, vec![(T, max as f64)]);
    }
}
