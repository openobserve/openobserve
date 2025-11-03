// Copyright 2025 OpenObserve Inc.
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

use std::ops::ControlFlow;

use sqlparser::{
    ast::{
        Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList, FunctionArguments,
        Ident, ObjectName, ObjectNamePart, Query, Select, SetExpr, Statement, TableFactor, Value,
        ValueWithSpan, VisitorMut,
    },
    tokenizer::Span,
};

pub const O2_CUSTOM_SUFFIX: &str = "::_o2_custom";

#[derive(Debug)]
pub struct StringMatchReplacer {
    pub replacements_made: usize,
}

impl StringMatchReplacer {
    pub fn new() -> Self {
        Self {
            replacements_made: 0,
        }
    }

    /// Check if a value ends with "::_o2_custom" suffix
    fn has_o2_custom_suffix(value: &Value) -> Option<String> {
        if let Value::SingleQuotedString(s) = value
            && s.ends_with(O2_CUSTOM_SUFFIX)
        {
            // Extract the prefix before "::_o2_custom"
            let prefix = s.trim_end_matches(O2_CUSTOM_SUFFIX);
            return Some(prefix.to_string());
        }
        None
    }

    /// Create a str_match function call
    fn create_str_match_function(field_expr: Expr, match_value: String) -> Expr {
        Expr::Function(Function {
            name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("str_match"))]),
            args: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(field_expr)),
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(ValueWithSpan {
                        value: Value::SingleQuotedString(match_value),
                        span: Span::empty(),
                    }))),
                ],
                clauses: vec![],
            }),
            filter: None,
            null_treatment: None,
            over: None,
            within_group: vec![],
            uses_odbc_syntax: false,
            parameters: FunctionArguments::List(FunctionArgumentList {
                duplicate_treatment: None,
                args: vec![],
                clauses: vec![],
            }),
        })
    }

    /// Clean up the SQL string to remove extra parentheses from str_match functions
    fn clean_sql_output(sql: String) -> String {
        // Replace str_match()("arg1", "arg2") with str_match("arg1", "arg2")
        sql.replace("str_match()(", "str_match(")
    }

    /// Process IN expression and replace if it matches our pattern
    fn process_in_expression(
        &mut self,
        field_expr: &Expr,
        list: &[Expr],
        negated: bool,
    ) -> Option<Expr> {
        // We only handle non-negated IN expressions with a single value
        if negated || list.len() != 1 {
            return None;
        }

        if let Expr::Value(value) = &list[0]
            && let Some(match_value) = Self::has_o2_custom_suffix(&value.value)
        {
            self.replacements_made += 1;
            return Some(Self::create_str_match_function(
                field_expr.clone(),
                match_value,
            ));
        }

        None
    }

    /// Process equality expression and replace if it matches our pattern
    fn process_equality_expression(&mut self, left: &Expr, right: &Expr) -> Option<Expr> {
        // Check if right side is a value with _o2_custom suffix
        if let Expr::Value(value) = right
            && let Some(match_value) = Self::has_o2_custom_suffix(&value.value)
        {
            self.replacements_made += 1;
            return Some(Self::create_str_match_function(left.clone(), match_value));
        }

        // Check if left side is a value with _o2_custom suffix
        if let Expr::Value(value) = left
            && let Some(match_value) = Self::has_o2_custom_suffix(&value.value)
        {
            self.replacements_made += 1;
            return Some(Self::create_str_match_function(right.clone(), match_value));
        }

        None
    }
}

impl VisitorMut for StringMatchReplacer {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::InList {
                expr: field_expr,
                list,
                negated,
            } => {
                if let Some(replacement) = self.process_in_expression(field_expr, list, *negated) {
                    *expr = replacement;
                    return ControlFlow::Continue(());
                }
                self.pre_visit_expr(field_expr)?;
                for item in list.iter_mut() {
                    self.pre_visit_expr(item)?;
                }
            }
            Expr::BinaryOp { left, right, op } => {
                // Handle equality expressions
                if matches!(op, sqlparser::ast::BinaryOperator::Eq)
                    && let Some(replacement) = self.process_equality_expression(left, right)
                {
                    *expr = replacement;
                    return ControlFlow::Continue(());
                }
                // Continue with normal traversal
                self.pre_visit_expr(left)?;
                self.pre_visit_expr(right)?;
            }
            Expr::UnaryOp { expr: subexpr, .. } => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Nested(subexpr) => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Between {
                expr: subexpr,
                low,
                high,
                ..
            } => {
                self.pre_visit_expr(subexpr)?;
                self.pre_visit_expr(low)?;
                self.pre_visit_expr(high)?;
            }
            Expr::Case {
                operand,
                conditions,
                else_result,
                ..
            } => {
                if let Some(op) = operand {
                    self.pre_visit_expr(op)?;
                }
                for cond in conditions.iter_mut() {
                    self.pre_visit_expr(&mut cond.condition)?;
                    self.pre_visit_expr(&mut cond.result)?;
                }
                if let Some(e) = else_result {
                    self.pre_visit_expr(e)?;
                }
            }
            Expr::Function(func) => {
                if let FunctionArguments::List(list) = &mut func.args {
                    for arg in list.args.iter_mut() {
                        if let FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) = arg {
                            self.pre_visit_expr(e)?;
                        }
                    }
                }
            }
            Expr::Cast { expr: subexpr, .. } => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Exists { .. } => {
                // subquery: Box<Query>
                // Already handled in pre_visit_query
            }
            Expr::Subquery(_) => {
                // Handled in pre_visit_query
            }
            Expr::IsNull(subexpr) | Expr::IsNotNull(subexpr) => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Extract { expr: subexpr, .. } => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Collate { expr: subexpr, .. } => {
                self.pre_visit_expr(subexpr)?;
            }
            Expr::Tuple(exprs) => {
                for e in exprs.iter_mut() {
                    self.pre_visit_expr(e)?;
                }
            }
            // Add more variants as needed for your SQL dialect
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_statement(&mut self, statement: &mut Statement) -> ControlFlow<Self::Break> {
        // Manually traverse the statement to ensure all expressions are visited
        if let Statement::Query(query) = statement {
            self.pre_visit_query(query)?;
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // Handle WITH clause (CTEs)
        if let Some(with) = &mut query.with {
            for cte in &mut with.cte_tables {
                self.pre_visit_query(&mut cte.query)?;
            }
        }

        // Handle the main query body
        if let SetExpr::Select(select) = &mut *query.body {
            self.pre_visit_select(select)?;
        }

        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, table: &mut TableFactor) -> ControlFlow<Self::Break> {
        if let TableFactor::Derived { subquery, .. } = table {
            self.pre_visit_query(subquery)?;
        }
        ControlFlow::Continue(())
    }
}

impl StringMatchReplacer {
    fn pre_visit_select(&mut self, select: &mut Select) -> ControlFlow<()> {
        // Visit FROM clause
        for table_with_join in &mut select.from {
            self.pre_visit_table_factor(&mut table_with_join.relation)?;
        }

        // Visit WHERE clause
        if let Some(where_clause) = &mut select.selection {
            self.pre_visit_expr(where_clause)?;
        }

        // Visit HAVING clause
        if let Some(having_clause) = &mut select.having {
            self.pre_visit_expr(having_clause)?;
        }

        ControlFlow::Continue(())
    }
}

impl Default for StringMatchReplacer {
    fn default() -> Self {
        Self::new()
    }
}

/// Main function to process SQL and replace patterns
pub fn replace_o2_custom_patterns(sql: &str) -> Result<String, String> {
    if !sql.contains(O2_CUSTOM_SUFFIX) {
        return Ok(sql.to_string());
    }
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    let dialect = GenericDialect {};
    let mut statements =
        Parser::parse_sql(&dialect, sql).map_err(|e| format!("Parse error: {e}"))?;

    if statements.is_empty() {
        return Err("No statements found".to_string());
    }

    let mut replacer = StringMatchReplacer::new();

    // Process each statement
    for statement in &mut statements {
        let _ = replacer.pre_visit_statement(statement);
    }

    // Convert back to SQL string
    let modified_sql = statements
        .iter()
        .map(|stmt| stmt.to_string())
        .collect::<Vec<_>>()
        .join(";\n");

    Ok(StringMatchReplacer::clean_sql_output(modified_sql))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_replacement() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username IN ('admin::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(username, 'admin')"));
        assert!(!result.contains("::_o2_custom"));
    }

    #[test]
    fn test_multiple_replacements() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username IN ('admin::_o2_custom') 
               OR role IN ('superuser::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(username, 'admin')"));
        assert!(result.contains("str_match(role, 'superuser')"));
    }

    #[test]
    fn test_subquery_replacement() {
        let sql = r#"
            SELECT * FROM (
                SELECT id, name FROM users 
                WHERE department IN ('engineering::_o2_custom')
            ) sub
            WHERE sub.name IN ('john::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(department, 'engineering')"));
        assert!(result.contains("str_match(sub.name, 'john')"));
    }

    #[test]
    fn test_cte_replacement() {
        let sql = r#"
            WITH filtered_users AS (
                SELECT * FROM users 
                WHERE status IN ('active::_o2_custom')
                and check_status = 'checked::_o2_custom'
            )
            SELECT * FROM filtered_users 
            WHERE role IN ('admin::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(status, 'active')"));
        assert!(result.contains("str_match(role, 'admin')"));
        assert!(result.contains("str_match(check_status, 'checked')"));
    }

    #[test]
    fn test_join_replacement() {
        let sql = r#"
            SELECT u.name, p.title 
            FROM users u
            JOIN projects p ON u.id = p.user_id
            WHERE u.department IN ('sales::_o2_custom')
              AND p.category IN ('internal::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(u.department, 'sales')"));
        assert!(result.contains("str_match(p.category, 'internal')"));
    }

    #[test]
    fn test_no_replacement_for_multiple_values() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username IN ('admin::_o2_custom', 'user::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("::_o2_custom")); // Original should remain
    }

    #[test]
    fn test_no_replacement_for_negated() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username NOT IN ('admin::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("::_o2_custom")); // Original should remain
    }

    #[test]
    fn test_no_replacement_without_suffix() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username IN ('admin')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();

        assert!(result.contains("username IN ('admin')"));
    }

    #[test]
    fn test_complex_field_expressions() {
        let sql = r#"
            SELECT * FROM users 
            WHERE LOWER(username) IN ('admin::_o2_custom')
              AND table.field IN ('value::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();

        assert!(result.contains("str_match(LOWER(username), 'admin')"));
        assert!(result.contains("str_match(table.field, 'value')"));
    }

    #[test]
    fn test_equality_replacement() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username = 'admin::_o2_custom'
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(username, 'admin')"));
        assert!(!result.contains("::_o2_custom"));
    }

    #[test]
    fn test_equality_with_complex_expressions() {
        let sql = r#"
            SELECT * FROM users 
            WHERE LOWER(username) = 'admin::_o2_custom'
              AND table.field = 'value::_o2_custom'
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(LOWER(username), 'admin')"));
        assert!(result.contains("str_match(table.field, 'value')"));
    }

    #[test]
    fn test_mixed_in_and_equality() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username IN ('admin::_o2_custom')
              AND role = 'superuser::_o2_custom'
              OR department IN ('engineering::_o2_custom')
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();
        println!("result: {result}");

        assert!(result.contains("str_match(username, 'admin')"));
        assert!(result.contains("str_match(role, 'superuser')"));
        assert!(result.contains("str_match(department, 'engineering')"));
    }

    #[test]
    fn test_no_replacement_for_equality_without_suffix() {
        let sql = r#"
            SELECT * FROM users 
            WHERE username = 'admin'
        "#;

        let result = replace_o2_custom_patterns(sql).unwrap();

        assert!(result.contains("username = 'admin'"));
    }
}
