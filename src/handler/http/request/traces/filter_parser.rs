// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sqlparser::{
    ast::{BinaryOperator, Expr, FunctionArg, FunctionArguments, Ident, ObjectName, ObjectNamePart},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

/// Result of parsing a filter containing composite fields
#[derive(Debug)]
pub struct ParsedFilter {
    /// Regular field conditions for WHERE clause
    pub where_conditions: Vec<String>,
    /// Composite field conditions for HAVING clause
    pub having_conditions: Vec<String>,
    /// Whether rate (COUNT(*)) is referenced
    pub needs_rate: bool,
    /// Whether error (SUM(CASE...)) is referenced
    pub needs_error: bool,
}

impl ParsedFilter {
    /// Merge another ParsedFilter into this one
    fn merge(&mut self, other: ParsedFilter) {
        self.where_conditions.extend(other.where_conditions);
        self.having_conditions.extend(other.having_conditions);
        self.needs_rate = self.needs_rate || other.needs_rate;
        self.needs_error = self.needs_error || other.needs_error;
    }
}

/// Parse a filter string and separate composite fields (rate, error) from regular fields
pub fn parse_filter(filter: &str) -> Result<ParsedFilter, String> {
    if filter.is_empty() {
        return Ok(ParsedFilter {
            where_conditions: vec![],
            having_conditions: vec![],
            needs_rate: false,
            needs_error: false,
        });
    }

    // Parse as a WHERE clause expression
    let sql = format!("SELECT * FROM dummy WHERE {filter}");
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, &sql)
        .map_err(|e| format!("Failed to parse filter: {e}"))?
        .pop()
        .ok_or("Failed to get statement")?;

    // Extract the WHERE expression
    let where_expr = match &mut statement {
        sqlparser::ast::Statement::Query(query) => match query.body.as_mut() {
            sqlparser::ast::SetExpr::Select(select) => select
                .selection
                .take()
                .ok_or("No WHERE clause found".to_string())?,
            _ => return Err("Unsupported query type".to_string()),
        },
        _ => return Err("Expected SELECT statement".to_string()),
    };

    // Process the expression tree
    process_expression(&where_expr)
}

/// Recursively process an expression and separate composite from regular fields
fn process_expression(expr: &Expr) -> Result<ParsedFilter, String> {
    match expr {
        Expr::BinaryOp { left, op, right } => {
            // Check if this is an AND/OR operation - recurse
            if matches!(op, BinaryOperator::And | BinaryOperator::Or) {
                let mut result = process_expression(left)?;
                let right_result = process_expression(right)?;
                result.merge(right_result);
                Ok(result)
            } else {
                // This is a comparison operation - check if it involves composite fields
                let condition_str = format!("{left} {op} {right}");

                if contains_composite_field(left, "rate") || contains_composite_field(right, "rate") {
                    // Transform rate condition to COUNT(*) condition
                    let transformed = transform_rate_condition(left, op, right)?;
                    Ok(ParsedFilter {
                        where_conditions: vec![],
                        having_conditions: vec![transformed],
                        needs_rate: true,
                        needs_error: false,
                    })
                } else if contains_composite_field(left, "error") || contains_composite_field(right, "error") {
                    // Transform error condition to SUM(CASE...) condition
                    let transformed = transform_error_condition(left, op, right)?;
                    Ok(ParsedFilter {
                        where_conditions: vec![],
                        having_conditions: vec![transformed],
                        needs_rate: false,
                        needs_error: true,
                    })
                } else {
                    // Regular field condition
                    Ok(ParsedFilter {
                        where_conditions: vec![condition_str],
                        having_conditions: vec![],
                        needs_rate: false,
                        needs_error: false,
                    })
                }
            }
        }
        Expr::Nested(inner) => process_expression(inner),
        _ => {
            // Other expressions are kept as-is in WHERE
            Ok(ParsedFilter {
                where_conditions: vec![expr.to_string()],
                having_conditions: vec![],
                needs_rate: false,
                needs_error: false,
            })
        }
    }
}

/// Check if an expression contains a reference to a specific field
fn contains_composite_field(expr: &Expr, field_name: &str) -> bool {
    match expr {
        Expr::Identifier(ident) => ident.value.to_lowercase() == field_name,
        Expr::CompoundIdentifier(idents) => {
            idents.iter().any(|i| i.value.to_lowercase() == field_name)
        }
        Expr::Nested(inner) => contains_composite_field(inner, field_name),
        _ => false,
    }
}

/// Transform a rate condition to COUNT(*) condition
fn transform_rate_condition(left: &Expr, op: &BinaryOperator, right: &Expr) -> Result<String, String> {
    let count_expr = Expr::Function(sqlparser::ast::Function {
        name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("COUNT"))]),
        args: FunctionArguments::List(sqlparser::ast::FunctionArgumentList {
            duplicate_treatment: None,
            args: vec![FunctionArg::Unnamed(sqlparser::ast::FunctionArgExpr::Wildcard)],
            clauses: vec![],
        }),
        filter: None,
        null_treatment: None,
        over: None,
        within_group: vec![],
        parameters: sqlparser::ast::FunctionArguments::None,
        uses_odbc_syntax: false,
    });

    if contains_composite_field(left, "rate") {
        Ok(format!("{count_expr} {op} {right}"))
    } else {
        Ok(format!("{left} {op} {count_expr}"))
    }
}

/// Transform an error condition to SUM(CASE...) condition
fn transform_error_condition(left: &Expr, op: &BinaryOperator, right: &Expr) -> Result<String, String> {
    // SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)
    let sum_case_expr = "SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)";

    if contains_composite_field(left, "error") {
        Ok(format!("{sum_case_expr} {op} {right}"))
    } else {
        Ok(format!("{left} {op} {sum_case_expr}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_filter_empty() {
        let result = parse_filter("").unwrap();
        assert!(result.where_conditions.is_empty());
        assert!(result.having_conditions.is_empty());
        assert!(!result.needs_rate);
        assert!(!result.needs_error);
    }

    #[test]
    fn test_parse_filter_regular_fields() {
        let result = parse_filter("service_name = 'my-service' AND duration > 1000").unwrap();
        assert_eq!(result.where_conditions.len(), 2);
        assert!(result.having_conditions.is_empty());
        assert!(!result.needs_rate);
        assert!(!result.needs_error);
    }

    #[test]
    fn test_parse_filter_rate_only() {
        let result = parse_filter("rate > 10").unwrap();
        assert!(result.where_conditions.is_empty());
        assert_eq!(result.having_conditions.len(), 1);
        assert!(result.needs_rate);
        assert!(!result.needs_error);
        assert!(result.having_conditions[0].contains("COUNT(*)"));
    }

    #[test]
    fn test_parse_filter_error_only() {
        let result = parse_filter("error > 0").unwrap();
        assert!(result.where_conditions.is_empty());
        assert_eq!(result.having_conditions.len(), 1);
        assert!(!result.needs_rate);
        assert!(result.needs_error);
        assert!(result.having_conditions[0].contains("SUM(CASE"));
    }

    #[test]
    fn test_parse_filter_mixed() {
        let result = parse_filter("service_name = 'test' AND rate > 10 AND error > 0").unwrap();
        assert_eq!(result.where_conditions.len(), 1);
        assert_eq!(result.having_conditions.len(), 2);
        assert!(result.needs_rate);
        assert!(result.needs_error);
    }
}
