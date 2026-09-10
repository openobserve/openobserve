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

/// What a query reads beyond its evaluation range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SelectorWindow {
    /// The farthest read after an evaluation timestamp: the largest negative offset.
    pub ahead: Duration,
    /// A subquery evaluates its inner expression inside the evaluated range only.
    pub subquery: bool,
}

impl SelectorWindow {
    fn merge(self, other: Self) -> Self {
        Self {
            ahead: self.ahead.max(other.ahead),
            subquery: self.subquery || other.subquery,
        }
    }
}

pub fn selector_window(expr: &Expr) -> SelectorWindow {
    match expr {
        Expr::VectorSelector(vs) => SelectorWindow {
            ahead: negative_offset(&vs.offset),
            subquery: false,
        },
        Expr::MatrixSelector(ms) => SelectorWindow {
            ahead: negative_offset(&ms.vs.offset),
            subquery: false,
        },
        Expr::Subquery(sq) => SelectorWindow {
            ahead: selector_window(&sq.expr).ahead + negative_offset(&sq.offset),
            subquery: true,
        },
        Expr::Aggregate(agg) => {
            let param = agg
                .param
                .as_deref()
                .map_or_else(Default::default, selector_window);
            selector_window(&agg.expr).merge(param)
        }
        Expr::Unary(unary) => selector_window(&unary.expr),
        Expr::Paren(paren) => selector_window(&paren.expr),
        Expr::Binary(binary) => selector_window(&binary.lhs).merge(selector_window(&binary.rhs)),
        Expr::Call(call) => call
            .args
            .args
            .iter()
            .map(|arg| selector_window(arg))
            .fold(SelectorWindow::default(), SelectorWindow::merge),
        Expr::NumberLiteral(_) | Expr::StringLiteral(_) | Expr::Extension(_) => {
            SelectorWindow::default()
        }
    }
}

fn negative_offset(offset: &Option<Offset>) -> Duration {
    match offset {
        Some(Offset::Neg(offset)) => *offset,
        _ => Duration::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    fn window(query: &str) -> SelectorWindow {
        selector_window(&parser::parse(query).unwrap())
    }

    fn minutes(m: u64) -> Duration {
        Duration::from_secs(60 * m)
    }

    #[test]
    fn test_selector_window_reads_ahead_on_negative_offsets() {
        let none = SelectorWindow::default();
        assert_eq!(window("up"), none);
        assert_eq!(window("rate(x[1h] offset 30m)"), none);
        assert_eq!(window("sum(rate(a[5m])) / sum(rate(b[1h]))"), none);
        assert_eq!(window("1 + 2"), none);
        assert_eq!(
            window("up offset -10m"),
            SelectorWindow {
                ahead: minutes(10),
                subquery: false
            }
        );
        assert_eq!(
            window("topk(3, rate(a[5m] offset -3m)) + rate(b[1h] offset 2m)"),
            SelectorWindow {
                ahead: minutes(3),
                subquery: false
            }
        );
    }

    #[test]
    fn test_selector_window_flags_subqueries() {
        assert_eq!(
            window("max_over_time(rate(a[5m])[1h:1m])"),
            SelectorWindow {
                ahead: Duration::ZERO,
                subquery: true
            }
        );
        assert_eq!(
            window("sum(a) + max_over_time(b[1h:1m] offset -5m)"),
            SelectorWindow {
                ahead: minutes(5),
                subquery: true
            }
        );
    }
}
