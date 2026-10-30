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

use promql_parser::parser::{AtModifier, Expr, Offset, VectorSelector};

use crate::{ast::at_modifier::at_micros, micros, utils::offset_micros};

/// What a query reads beyond its evaluation range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SelectorWindow {
    /// The farthest read after an evaluation timestamp: the largest negative offset.
    pub ahead: Duration,
    /// The latest instant an `@` modifier reads, whatever range is evaluated.
    pub pinned: Option<i64>,
}

impl SelectorWindow {
    /// Whether evaluating up to `end` reads at or after `floor`.
    pub fn reaches(&self, end: i64, floor: i64) -> bool {
        end + micros(self.ahead) >= floor || self.pinned.is_some_and(|at| at >= floor)
    }

    fn merge(self, other: Self) -> Self {
        Self {
            ahead: self.ahead.max(other.ahead),
            pinned: self.pinned.max(other.pinned),
        }
    }
}

pub fn selector_window(expr: &Expr) -> SelectorWindow {
    match expr {
        Expr::VectorSelector(vs) => vector_selector_window(vs),
        Expr::MatrixSelector(ms) => vector_selector_window(&ms.vs),
        Expr::Subquery(sq) => {
            let inner = selector_window(&sq.expr);
            SelectorWindow {
                ahead: inner.ahead + negative_offset(&sq.offset),
                pinned: inner.pinned,
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

fn vector_selector_window(vs: &VectorSelector) -> SelectorWindow {
    SelectorWindow {
        ahead: negative_offset(&vs.offset),
        pinned: vs.at.as_ref().map(|at| pinned_read_end(at, &vs.offset)),
    }
}

fn pinned_read_end(at: &AtModifier, offset: &Option<Offset>) -> i64 {
    // an unresolved `start()` / `end()` is unknown here, so assume it reaches any floor
    at_micros(at).map_or(i64::MAX, |at| at - offset_micros(offset))
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
                pinned: None,
            }
        );
        assert_eq!(
            window("topk(3, rate(a[5m] offset -3m)) + rate(b[1h] offset 2m)"),
            SelectorWindow {
                ahead: minutes(3),
                pinned: None,
            }
        );
    }

    #[test]
    fn test_selector_window_tracks_the_latest_pinned_read() {
        let at = 1_600_000_000_000_000;
        let pinned = |query: &str| window(query).pinned;
        assert_eq!(pinned("a @ 1600000000"), Some(at));
        assert_eq!(pinned("a @ 1600000000 offset 1m"), Some(at - 60_000_000));
        assert_eq!(
            pinned("a and topk(5, rate(a[1h] @ 1600000000 offset -1m))"),
            Some(at + 60_000_000)
        );
        assert_eq!(
            pinned("max_over_time((a @ 1600000000)[1h:1m]) + a @ 1500000000"),
            Some(at)
        );
        assert_eq!(pinned("a @ end()"), Some(i64::MAX));
    }

    #[test]
    fn test_reaches_the_floor_through_the_range_or_a_pin() {
        let floor = 1_600_000_000_000_000;
        assert!(!window("a").reaches(floor - 1, floor));
        assert!(window("a").reaches(floor, floor));
        assert!(window("a offset -1m").reaches(floor - 60_000_000, floor));
        assert!(window("a @ 1600000000").reaches(0, floor));
        assert!(!window("a @ 1599999999").reaches(0, floor));
    }

    #[test]
    fn test_selector_window_reads_ahead_through_subqueries() {
        assert_eq!(
            window("max_over_time(rate(a[5m])[1h:1m])"),
            SelectorWindow::default()
        );
        assert_eq!(
            window("sum(a) + max_over_time(b[1h:1m] offset -5m)").ahead,
            minutes(5)
        );
        assert_eq!(
            window("max_over_time((b offset -2m)[1h:1m] offset -5m)").ahead,
            minutes(7)
        );
    }
}
