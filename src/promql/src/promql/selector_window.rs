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

use std::time::Duration;

use promql_parser::parser::{Expr, Offset};

use crate::DEFAULT_LOOKBACK;

/// How far before an evaluation timestamp the query reads: the widest selector range or
/// lookback plus its positive offset, with subqueries nesting their inner window.
pub fn max_selector_window(expr: &Expr) -> Duration {
    match expr {
        Expr::VectorSelector(vs) => DEFAULT_LOOKBACK + positive_offset(&vs.offset),
        Expr::MatrixSelector(ms) => ms.range + positive_offset(&ms.vs.offset),
        Expr::Subquery(sq) => {
            max_selector_window(&sq.expr) + sq.range + positive_offset(&sq.offset)
        }
        Expr::Aggregate(agg) => {
            let param = agg
                .param
                .as_deref()
                .map_or(Duration::ZERO, max_selector_window);
            max_selector_window(&agg.expr).max(param)
        }
        Expr::Unary(unary) => max_selector_window(&unary.expr),
        Expr::Paren(paren) => max_selector_window(&paren.expr),
        Expr::Binary(binary) => {
            max_selector_window(&binary.lhs).max(max_selector_window(&binary.rhs))
        }
        Expr::Call(call) => call
            .args
            .args
            .iter()
            .map(|arg| max_selector_window(arg))
            .max()
            .unwrap_or(Duration::ZERO),
        Expr::NumberLiteral(_) | Expr::StringLiteral(_) | Expr::Extension(_) => Duration::ZERO,
    }
}

fn positive_offset(offset: &Option<Offset>) -> Duration {
    match offset {
        Some(Offset::Pos(offset)) => *offset,
        _ => Duration::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    fn window(query: &str) -> Duration {
        max_selector_window(&parser::parse(query).unwrap())
    }

    #[test]
    fn test_max_selector_window() {
        let minutes = |m: u64| Duration::from_secs(60 * m);
        assert_eq!(window("up"), minutes(5));
        assert_eq!(window("up offset 10m"), minutes(15));
        assert_eq!(window("up offset -10m"), minutes(5));
        assert_eq!(window("rate(x[1m])"), minutes(1));
        assert_eq!(window("rate(x[1h] offset 30m)"), minutes(90));
        assert_eq!(window("sum(rate(a[5m])) / sum(rate(b[1h]))"), minutes(60));
        assert_eq!(window("topk(3, rate(a[15m]))"), minutes(15));
        assert_eq!(window("max_over_time(rate(a[5m])[1h:1m])"), minutes(65));
        assert_eq!(window("1 + 2"), Duration::ZERO);
    }
}
