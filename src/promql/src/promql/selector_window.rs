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

/// What a query reads around each evaluation timestamp.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SelectorWindow {
    /// The farthest read before the timestamp: widest range or lookback plus positive offset.
    pub back: Duration,
    /// The farthest read after the timestamp: the largest negative offset.
    pub ahead: Duration,
    /// A subquery evaluates its inner expression inside the evaluated range only.
    pub subquery: bool,
}

impl SelectorWindow {
    fn merge(self, other: Self) -> Self {
        Self {
            back: self.back.max(other.back),
            ahead: self.ahead.max(other.ahead),
            subquery: self.subquery || other.subquery,
        }
    }
}

pub fn selector_window(expr: &Expr) -> SelectorWindow {
    match expr {
        Expr::VectorSelector(vs) => offset_window(DEFAULT_LOOKBACK, &vs.offset),
        Expr::MatrixSelector(ms) => offset_window(ms.range, &ms.vs.offset),
        Expr::Subquery(sq) => {
            let inner = selector_window(&sq.expr);
            let own = offset_window(sq.range, &sq.offset);
            SelectorWindow {
                back: inner.back + own.back,
                ahead: inner.ahead + own.ahead,
                subquery: true,
            }
        }
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

fn offset_window(range: Duration, offset: &Option<Offset>) -> SelectorWindow {
    match offset {
        Some(Offset::Pos(offset)) => SelectorWindow {
            back: range + *offset,
            ..Default::default()
        },
        Some(Offset::Neg(offset)) => SelectorWindow {
            back: range,
            ahead: *offset,
            ..Default::default()
        },
        None => SelectorWindow {
            back: range,
            ..Default::default()
        },
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

    fn plain(back: Duration) -> SelectorWindow {
        SelectorWindow {
            back,
            ..Default::default()
        }
    }

    #[test]
    fn test_selector_window() {
        assert_eq!(window("up"), plain(minutes(5)));
        assert_eq!(window("up offset 10m"), plain(minutes(15)));
        assert_eq!(window("rate(x[1m])"), plain(minutes(1)));
        assert_eq!(window("rate(x[1h] offset 30m)"), plain(minutes(90)));
        assert_eq!(
            window("sum(rate(a[5m])) / sum(rate(b[1h]))"),
            plain(minutes(60))
        );
        assert_eq!(window("topk(3, rate(a[15m]))"), plain(minutes(15)));
        assert_eq!(window("1 + 2"), SelectorWindow::default());
    }

    #[test]
    fn test_selector_window_reads_ahead_on_negative_offsets() {
        assert_eq!(
            window("up offset -10m"),
            SelectorWindow {
                back: minutes(5),
                ahead: minutes(10),
                subquery: false
            }
        );
        assert_eq!(
            window("rate(a[5m] offset -3m) + rate(b[1h] offset 2m)"),
            SelectorWindow {
                back: minutes(62),
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
                back: minutes(65),
                ahead: Duration::ZERO,
                subquery: true
            }
        );
        assert_eq!(
            window("sum(a) + max_over_time(b[1h:1m] offset -5m)"),
            SelectorWindow {
                back: minutes(65),
                ahead: minutes(5),
                subquery: true
            }
        );
    }
}
