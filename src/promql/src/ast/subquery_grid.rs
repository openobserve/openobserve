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

use promql_parser::parser::{Expr, SubqueryExpr};

use crate::{DEFAULT_SUBQUERY_STEP, micros, utils::offset_micros};

/// The most steps any subquery evaluates per series when `expr` is evaluated over `[start, end]`.
pub fn max_subquery_steps(expr: &Expr, start: i64, end: i64) -> i64 {
    match expr {
        Expr::Subquery(sq) => {
            let (sq_start, sq_end, step) = subquery_grid(start, end, sq);
            if sq_start > sq_end {
                return 0;
            }
            let steps = (sq_end - sq_start) / step + 1;
            steps.max(max_subquery_steps(&sq.expr, sq_start, sq_end))
        }
        Expr::Aggregate(agg) => {
            let param = agg
                .param
                .as_deref()
                .map_or(0, |param| max_subquery_steps(param, start, end));
            max_subquery_steps(&agg.expr, start, end).max(param)
        }
        Expr::Unary(unary) => max_subquery_steps(&unary.expr, start, end),
        Expr::Paren(paren) => max_subquery_steps(&paren.expr, start, end),
        Expr::Binary(binary) => max_subquery_steps(&binary.lhs, start, end)
            .max(max_subquery_steps(&binary.rhs, start, end)),
        Expr::Call(call) => call
            .args
            .args
            .iter()
            .map(|arg| max_subquery_steps(arg, start, end))
            .max()
            .unwrap_or(0),
        Expr::VectorSelector(_)
        | Expr::MatrixSelector(_)
        | Expr::NumberLiteral(_)
        | Expr::StringLiteral(_)
        | Expr::Extension(_) => 0,
    }
}

/// The subquery's `(start, end, step)` for the evaluated range, as Prometheus evaluates it.
pub(crate) fn subquery_grid(start: i64, end: i64, sq: &SubqueryExpr) -> (i64, i64, i64) {
    let step = micros(
        sq.step
            .filter(|step| !step.is_zero())
            .unwrap_or(DEFAULT_SUBQUERY_STEP),
    );
    let offset = offset_micros(&sq.offset);
    // the grid sits on absolute multiples of the step, so every range and worker sees the same one
    let first = start - offset - micros(sq.range);
    let grid_start = (first.div_euclid(step) + 1) * step;
    (grid_start, end - offset, step)
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    const SECOND: i64 = 1_000_000;
    const MINUTE: i64 = 60 * SECOND;
    // 2022-01-01T00:00:00Z, on the minute but not on a 7 minute multiple
    const T: i64 = 1_640_995_200 * SECOND;

    fn grid(query: &str, start: i64, end: i64) -> (i64, i64, i64) {
        let Expr::Subquery(sq) = parser::parse(query).unwrap() else {
            panic!("{query}: expected a subquery");
        };
        subquery_grid(start, end, &sq)
    }

    fn steps(query: &str, start: i64, end: i64) -> i64 {
        max_subquery_steps(&parser::parse(query).unwrap(), start, end)
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

    #[test]
    fn test_max_subquery_steps_covers_the_whole_range() {
        assert_eq!(steps("rate(up[5m])", T, T + 60 * MINUTE), 0);
        assert_eq!(steps("max_over_time(up[10m:1m])", T, T), 10);
        assert_eq!(steps("max_over_time(up[10m:1m])", T, T + 60 * MINUTE), 70);
        assert_eq!(steps("max_over_time(up[10m:])", T, T + 60 * MINUTE), 70);
        assert_eq!(steps("up[30s:1m]", T + 40 * SECOND, T + 40 * SECOND), 0);
        // the largest subquery wins, wherever it sits
        assert_eq!(
            steps(
                "sum(max_over_time(a[10m:1m])) / topk(scalar(max_over_time(b[1h:1s])), c)",
                T,
                T
            ),
            3600
        );
    }

    #[test]
    fn test_max_subquery_steps_nests_on_the_parent_grid() {
        // the outer grid starts at T - 59m, so the inner one covers (T - 69m, T]
        assert_eq!(
            steps("max_over_time(rate(up[5m])[10m:1s])[1h:1m]", T, T),
            69 * 60
        );
        assert_eq!(
            steps(
                "sum_over_time(max_over_time(up[10m:1s])[1h:1m] offset 1h)",
                T,
                T + 60 * MINUTE
            ),
            129 * 60
        );
    }
}
