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

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{AtModifier, Expr};

/// Functions whose value follows the evaluation timestamp, so a pinned argument does not pin them.
const TIME_DEPENDENT_FUNCS: [&str; 11] = [
    "day_of_month",
    "day_of_week",
    "day_of_year",
    "days_in_month",
    "hour",
    "minute",
    "month",
    "predict_linear",
    "time",
    "timestamp",
    "year",
];

/// Whether an expression evaluates to the same value on every step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Pin {
    /// Reads no series, so it follows whatever it is combined with.
    Neutral,
    /// Every selector is pinned to this instant, in microseconds.
    At(i64),
    Varies,
}

impl Pin {
    fn merge(self, other: Self) -> Self {
        match (self, other) {
            (Pin::Neutral, pin) | (pin, Pin::Neutral) => pin,
            (Pin::At(a), Pin::At(b)) if a == b => Pin::At(a),
            _ => Pin::Varies,
        }
    }
}

/// Pins `@ start()` / `@ end()` to the whole query's bounds, which a worker never sees.
pub fn resolve_at_modifiers(expr: &mut Expr, start: i64, end: i64) -> bool {
    let mut changed = false;
    for_each_at(expr, &mut |at| {
        let micros = match at {
            Some(AtModifier::Start) => start,
            Some(AtModifier::End) => end,
            _ => return,
        };
        *at = Some(AtModifier::At(system_time(to_millis(micros))));
        changed = true;
    });
    changed
}

/// The pinned instant in microseconds, `None` while it is still `start()` / `end()`.
pub(crate) fn at_micros(at: &AtModifier) -> Option<i64> {
    let AtModifier::At(time) = at else {
        return None;
    };
    let micros = match time.duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_micros() as i64,
        Err(before) => -(before.duration().as_micros() as i64),
    };
    Some(to_millis(micros))
}

pub(crate) fn pin(expr: &Expr) -> Result<Pin> {
    Ok(match expr {
        Expr::VectorSelector(vs) => selector_pin(&vs.at)?,
        Expr::MatrixSelector(ms) => selector_pin(&ms.vs.at)?,
        Expr::Subquery(sq) if sq.at.is_some() => {
            return Err(DataFusionError::NotImplemented(
                "Subquery: @ modifier is not supported".to_string(),
            ));
        }
        // a subquery evaluates its inner expression on its own steps
        Expr::Subquery(_) | Expr::Extension(_) => Pin::Varies,
        Expr::NumberLiteral(_) | Expr::StringLiteral(_) => Pin::Neutral,
        Expr::Unary(unary) => pin(&unary.expr)?,
        Expr::Paren(paren) => pin(&paren.expr)?,
        Expr::Binary(binary) => pin(&binary.lhs)?.merge(pin(&binary.rhs)?),
        Expr::Aggregate(agg) => {
            let param = agg.param.as_deref().map_or(Ok(Pin::Neutral), pin)?;
            pin(&agg.expr)?.merge(param)
        }
        Expr::Call(call) if TIME_DEPENDENT_FUNCS.contains(&call.func.name) => Pin::Varies,
        Expr::Call(call) => {
            let mut merged = Pin::Neutral;
            for arg in &call.args.args {
                merged = merged.merge(pin(arg)?);
            }
            merged
        }
    })
}

pub(crate) fn strip_at(expr: &mut Expr) {
    for_each_at(expr, &mut |at| *at = None);
}

fn selector_pin(at: &Option<AtModifier>) -> Result<Pin> {
    match at {
        None => Ok(Pin::Varies),
        Some(at) => at_micros(at).map(Pin::At).ok_or_else(|| {
            DataFusionError::Plan(
                "@ start() / @ end() must be resolved before evaluation".to_string(),
            )
        }),
    }
}

fn for_each_at(expr: &mut Expr, f: &mut impl FnMut(&mut Option<AtModifier>)) {
    match expr {
        Expr::VectorSelector(vs) => f(&mut vs.at),
        Expr::MatrixSelector(ms) => f(&mut ms.vs.at),
        Expr::Subquery(sq) => {
            f(&mut sq.at);
            for_each_at(&mut sq.expr, f);
        }
        Expr::Unary(unary) => for_each_at(&mut unary.expr, f),
        Expr::Paren(paren) => for_each_at(&mut paren.expr, f),
        Expr::Binary(binary) => {
            for_each_at(&mut binary.lhs, f);
            for_each_at(&mut binary.rhs, f);
        }
        Expr::Aggregate(agg) => {
            for_each_at(&mut agg.expr, f);
            if let Some(param) = agg.param.as_deref_mut() {
                for_each_at(param, f);
            }
        }
        Expr::Call(call) => {
            for arg in &mut call.args.args {
                for_each_at(arg, f);
            }
        }
        Expr::NumberLiteral(_) | Expr::StringLiteral(_) | Expr::Extension(_) => {}
    }
}

// the parser reads `@` as float seconds, which drifts by a microsecond; Prometheus keeps millis
fn to_millis(micros: i64) -> i64 {
    (micros + 500).div_euclid(1000) * 1000
}

fn system_time(micros: i64) -> SystemTime {
    match u64::try_from(micros) {
        Ok(after) => UNIX_EPOCH + Duration::from_micros(after),
        Err(_) => UNIX_EPOCH - Duration::from_micros(micros.unsigned_abs()),
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    const T: i64 = 1_600_000_000_000_000;

    fn pin_of(query: &str) -> Result<Pin> {
        pin(&parser::parse(query).unwrap())
    }

    #[test]
    fn test_resolve_at_modifiers_round_trips_through_the_query_string() {
        let mut expr = parser::parse("rate(a[5m] @ end()) + b @ start() + c").unwrap();
        assert!(resolve_at_modifiers(
            &mut expr,
            T + 1_234_567,
            T + 9_999_499
        ));

        let reparsed = parser::parse(&expr.to_string()).unwrap();
        let mut pinned = Vec::new();
        let mut reparsed_mut = reparsed.clone();
        for_each_at(&mut reparsed_mut, &mut |at| {
            pinned.push(at.as_ref().and_then(at_micros))
        });
        assert_eq!(
            pinned,
            vec![Some(T + 9_999_000), Some(T + 1_235_000), None],
            "{reparsed}"
        );
    }

    #[test]
    fn test_resolve_at_modifiers_leaves_other_queries_alone() {
        let mut expr = parser::parse("rate(a[5m] @ 1600000000) + b offset 5m").unwrap();
        assert!(!resolve_at_modifiers(&mut expr, 0, T));
    }

    #[test]
    fn test_pin_hoists_to_the_largest_step_invariant_subtree() {
        assert_eq!(pin_of("a @ 1600000000").unwrap(), Pin::At(T));
        assert_eq!(
            pin_of("topk(5, rate(a[1h] @ 1600000000 offset 5m))").unwrap(),
            Pin::At(T)
        );
        assert_eq!(
            pin_of("sum(a @ 1600000000) / 2 > bool 1").unwrap(),
            Pin::At(T)
        );
        assert_eq!(pin_of("a").unwrap(), Pin::Varies);
        assert_eq!(
            pin_of("a and topk(5, a @ 1600000000)").unwrap(),
            Pin::Varies
        );
        assert_eq!(
            pin_of("a @ 1600000000 + a @ 1600000060").unwrap(),
            Pin::Varies
        );
        assert_eq!(pin_of("vector(1)").unwrap(), Pin::Neutral);
    }

    #[test]
    fn test_pin_keeps_time_dependent_calls_on_the_steps() {
        assert_eq!(
            pin_of("predict_linear(a[1h] @ 1600000000, 60)").unwrap(),
            Pin::Varies
        );
        assert_eq!(pin_of("timestamp(a @ 1600000000)").unwrap(), Pin::Varies);
        assert_eq!(pin_of("a @ 1600000000 + time()").unwrap(), Pin::Varies);
    }

    #[test]
    fn test_pin_rejects_what_it_cannot_evaluate() {
        let err = pin_of("a[1h:1m] @ 1600000000").unwrap_err().to_string();
        assert!(
            err.contains("Subquery: @ modifier is not supported"),
            "{err}"
        );
        let err = pin_of("a @ end()").unwrap_err().to_string();
        assert!(err.contains("must be resolved"), "{err}");
    }

    #[test]
    fn test_at_micros_before_the_epoch() {
        let Expr::VectorSelector(vs) = parser::parse("a @ -1.5").unwrap() else {
            panic!("expected a vector selector");
        };
        assert_eq!(at_micros(vs.at.as_ref().unwrap()), Some(-1_500_000));
    }

    #[test]
    fn test_strip_at_keeps_the_offset() {
        let mut expr = parser::parse("rate(a[5m] @ 1600000000 offset 1m)").unwrap();
        strip_at(&mut expr);
        assert_eq!(expr.to_string(), "rate(a[5m] offset 1m)");
    }
}
