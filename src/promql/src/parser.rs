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

use std::sync::OnceLock;

use promql_parser::{
    parser::{self, Expr, Function, function::register_extra_functions, value::ValueType},
    util::ExprVisitor,
};

static LEGACY_FUNCTIONS: OnceLock<Result<(), String>> = OnceLock::new();

struct SupportedModifiers;

impl ExprVisitor for SupportedModifiers {
    type Error = String;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        if let Expr::Binary(binary) = expr
            && let Some(modifier) = &binary.modifier
            && (modifier.fill_values.lhs.is_some() || modifier.fill_values.rhs.is_some())
        {
            return Err("Unsupported binary fill modifier".to_string());
        }
        Ok(true)
    }
}

/// Preserves the legacy smoothing function and rejects modifiers the evaluator cannot execute.
pub fn parse(query: &str) -> Result<Expr, String> {
    LEGACY_FUNCTIONS
        .get_or_init(|| {
            register_extra_functions(vec![Function::new(
                "holt_winters",
                vec![ValueType::Matrix, ValueType::Scalar, ValueType::Scalar],
                0,
                ValueType::Vector,
                false,
            )])
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let expr = parser::parse(query)?;
    crate::ast::visitor::walk_expr(&mut SupportedModifiers, &expr)?;
    Ok(expr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_smoothing_function_keeps_signature_and_round_trips() {
        let query = "holt_winters(m[5m], 0.5, 0.3)";
        let expr = parse(query).unwrap();
        assert_eq!(parse(&expr.to_string()).unwrap(), expr);
        assert!(parse("holt_winters(m[5m], 0.5)").is_err());
    }

    #[test]
    fn binary_fill_modifiers_are_rejected_at_every_depth() {
        for query in [
            "a + fill(0) b",
            "a + fill_left(0) b",
            "sum(a + fill_right(0) b)",
            "topk(scalar(a + fill(0) b), c)",
        ] {
            assert!(parser::parse(query).is_ok(), "{query}");
            assert_eq!(
                parse(query).unwrap_err(),
                "Unsupported binary fill modifier"
            );
        }
        assert!(parse("fill + fill_left + fill_right").is_ok());
    }
}
