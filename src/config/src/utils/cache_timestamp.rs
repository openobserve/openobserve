use std::{collections::HashSet, ops::ControlFlow};

use sqlparser::ast::{
    Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Query, SelectItem, SetExpr, Statement,
    TableFactor, Visit, Visitor,
};

const TIMESTAMP_COL_NAME: &str = "_timestamp";

#[derive(Debug, Clone)]
pub struct TimestampVisitor {
    pub timestamp_selected: bool,
    pub timestamp_aliases: HashSet<String>,
    pub timestamp_columns: Vec<String>,
    query_depth: usize, // Add this field to track query depth
}

#[derive(Debug, Clone)]
pub struct TimestampResult {
    pub has_timestamp: bool,
    pub column_names: Vec<String>, // Column names or aliases
}

impl TimestampVisitor {
    pub fn new() -> Self {
        Self {
            timestamp_selected: false,
            timestamp_aliases: HashSet::new(),
            timestamp_columns: Vec::new(),
            query_depth: 0,
        }
    }

    /// Main entry point to analyze a SQL statement
    ///
    /// Note: This implementation assumes that every row in the database contains
    /// a _timestamp column with valid values. Therefore, wildcard selections (*)
    /// are automatically considered to include timestamp data.
    pub fn analyze_statement(&mut self, stmt: &Statement) -> TimestampResult {
        self.reset();

        match stmt {
            Statement::Query(query) => {
                query.visit(self);
            }
            _ => {}
        }

        TimestampResult {
            has_timestamp: self.timestamp_selected,
            column_names: self.timestamp_columns.clone(),
        }
    }

    /// Reset visitor state for new analysis
    fn reset(&mut self) {
        self.timestamp_selected = false;
        self.timestamp_aliases.clear();
        self.timestamp_columns.clear();
        self.query_depth = 0;
    }

    /// Check if an expression is _timestamp or a function of _timestamp that returns unix epoch
    fn is_timestamp_expr(expr: &Expr) -> bool {
        match expr {
            // Direct _timestamp column reference
            Expr::Identifier(ident) => ident.value == TIMESTAMP_COL_NAME,

            // Qualified _timestamp (e.g., table._timestamp)
            Expr::CompoundIdentifier(idents) => idents
                .last()
                .map_or(false, |id| id.value == TIMESTAMP_COL_NAME),

            // Function calls that operate on _timestamp - these all return timestamp values
            Expr::Function(func) => {
                let func_name = func.name.to_string().to_lowercase();

                // Only histogram is considered a timestamp-preserving function
                // Other functions like MAX, MIN, COUNT are not timestamp expressions
                match func_name.as_str() {
                    "histogram" => match &func.args {
                        FunctionArguments::List(args) => args.args.iter().any(|arg| match arg {
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => {
                                Self::is_timestamp_expr(e)
                            }
                            _ => false,
                        }),
                        _ => false,
                    },
                    _ => false, // MAX, MIN, COUNT, etc. are not timestamp expressions
                }
            }

            // Binary operations involving timestamp (e.g., _timestamp + interval)
            Expr::BinaryOp { .. } => false,

            // Cast expressions
            Expr::Cast { expr, .. } => Self::is_timestamp_expr(expr),

            // Parenthesized expressions
            Expr::Nested(inner) => Self::is_timestamp_expr(inner),

            // CASE expressions
            Expr::Case { .. } => false,

            _ => false,
        }
    }

    /// Extract column name or alias from expression
    fn _get_column_name_from_expr(expr: &Expr) -> Option<String> {
        match expr {
            Expr::Identifier(ident) => Some(ident.value.clone()),
            Expr::CompoundIdentifier(parts) => parts.last().map(|p| p.value.clone()),
            Expr::Function(func) => {
                let func_name = func.name.to_string();
                Some(format!("{}({}_timestamp)", func_name, TIMESTAMP_COL_NAME))
            }
            _ => Some("timestamp_expr".to_string()),
        }
    }

    /// Helper method to visit table factors and handle subqueries
    fn visit_table_factor(&mut self, relation: &TableFactor) -> ControlFlow<()> {
        match relation {
            TableFactor::Derived { subquery, .. } => {
                subquery.visit(self)?;
            }
            TableFactor::NestedJoin {
                table_with_joins,
                alias: _,
            } => {
                for join in &table_with_joins.joins {
                    join.relation.visit(self)?;
                }
                table_with_joins.relation.visit(self)?;
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    /// Add a column name to the results, avoiding duplicates
    fn add_timestamp_column(&mut self, name: String) {
        if !self.timestamp_columns.contains(&name) {
            self.timestamp_columns.push(name);
        }
    }
}

impl Visitor for TimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        let is_outermost = self.query_depth == 0;
        self.query_depth += 1;

        // Recurse into CTEs first - they may define timestamp aliases
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                cte.query.visit(self)?;
            }
        }

        // Handle the main query body
        if let SetExpr::Select(select) = query.body.as_ref() {
            // Recurse into subqueries in FROM clause first
            for table in &select.from {
                self.visit_table_factor(&table.relation)?;
            }

            // Analyze the SELECT projections
            for item in &select.projection {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        if Self::is_timestamp_expr(expr) {
                            if is_outermost {
                                self.timestamp_selected = true;
                                self.add_timestamp_column(TIMESTAMP_COL_NAME.to_string());
                            }
                        }

                        if let Expr::Identifier(ident) = expr {
                            if self.timestamp_aliases.contains(&ident.value) {
                                if is_outermost {
                                    self.timestamp_selected = true;
                                    self.add_timestamp_column(ident.value.clone());
                                }
                            }
                        }
                    }

                    SelectItem::ExprWithAlias { expr, alias } => {
                        if alias.value == TIMESTAMP_COL_NAME {
                            if is_outermost {
                                self.timestamp_selected = true;
                                self.add_timestamp_column(alias.value.clone());
                            }
                        } else {
                            if Self::is_timestamp_expr(expr) {
                                self.timestamp_aliases.insert(alias.value.clone());
                                if is_outermost {
                                    self.timestamp_selected = true;
                                    self.add_timestamp_column(alias.value.clone());
                                }
                            }

                            if let Expr::Identifier(ident) = expr {
                                if self.timestamp_aliases.contains(&ident.value) {
                                    self.timestamp_aliases.insert(alias.value.clone());
                                    if is_outermost {
                                        self.timestamp_selected = true;
                                        self.add_timestamp_column(alias.value.clone());
                                    }
                                }
                            }
                        }
                    }

                    SelectItem::Wildcard(_) => {
                        if is_outermost {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(TIMESTAMP_COL_NAME.to_string());
                        }
                    }

                    SelectItem::QualifiedWildcard(..) => {
                        if is_outermost {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(TIMESTAMP_COL_NAME.to_string());
                        }
                    }
                }
            }
        }

        self.query_depth -= 1;
        ControlFlow::Continue(())
    }
}

// Helper methods for common usage patterns
impl TimestampVisitor {
    /// Convenience method to check if a SQL string has valid timestamp projections
    pub fn validate_sql(sql: &str) -> Result<TimestampResult, String> {
        use sqlparser::{dialect::GenericDialect, parser::Parser};

        let dialect = GenericDialect {};
        let mut parser = Parser::new(&dialect)
            .try_with_sql(sql)
            .map_err(|e| format!("Failed to create parser: {}", e))?;

        let statements = parser
            .parse_statements()
            .map_err(|e| format!("Failed to parse SQL: {}", e))?;

        if statements.is_empty() {
            return Err("No SQL statements found".to_string());
        }

        let mut visitor = TimestampVisitor::new();
        let result = visitor.analyze_statement(&statements[0]);

        Ok(result)
    }

    /// Check if the timestamp expressions are likely to return unix epoch values
    pub fn validates_epoch_requirement(&self) -> bool {
        // This validates that we have timestamp data that should return unix epoch values
        self.timestamp_selected && !self.timestamp_columns.is_empty()
    }

    /// Get all timestamp-related aliases found during analysis
    pub fn get_timestamp_aliases(&self) -> &HashSet<String> {
        &self.timestamp_aliases
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_selection() {
        let test_cases = vec![
            // Basic selection cases
            (
                "SELECT _timestamp FROM table1",
                true,
                "Direct timestamp selection",
            ),
            (
                "SELECT name, _timestamp FROM table1",
                true,
                "Timestamp with other columns",
            ),
            (
                "SELECT * FROM table1",
                true,
                "Wildcard selection includes timestamp",
            ),
            ("SELECT name FROM table1", false, "No timestamp selected"),
            // Function cases without alias - should all be false
            (
                "SELECT MAX(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT MAX(_timestamp), MAX(_timestamp) as _timestamp FROM table1",
                true,
                "CHECK: One of the functions has _timestamp alias",
            ),
            (
                "SELECT MIN(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT COUNT(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            // Function cases with alias - should be true when aliased as _timestamp
            (
                "SELECT MAX(_timestamp) as _timestamp FROM table1",
                true,
                "Function aliased as _timestamp",
            ),
            (
                "SELECT MIN(_timestamp) as other FROM table1",
                false,
                "Function with different alias",
            ),
            // Expression cases
            (
                "SELECT _timestamp + 1 FROM table1",
                false,
                "CHECK: Expression without _timestamp alias",
            ),
            (
                "SELECT (_timestamp + 1) as _timestamp FROM table1",
                true,
                "Expression aliased as _timestamp",
            ),
            // Compound identifiers
            (
                "SELECT t1._timestamp FROM table1 t1",
                true,
                "Table qualified timestamp",
            ),
            (
                "SELECT t1._timestamp as other FROM table1 t1",
                true,
                "Table qualified timestamp with different alias",
            ),
            // Complex expressions
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END FROM table1",
                false,
                "CHECK: Timestamp in subquery",
            ),
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END as _timestamp FROM table1",
                true,
                "CASE expression aliased as _timestamp",
            ),
            // Subqueries
            (
                "SELECT * FROM (SELECT _timestamp FROM table1) t",
                true,
                "Subquery with wildcard",
            ),
            (
                "SELECT t.other FROM (SELECT _timestamp as other FROM table1) t",
                true,
                "Subquery with renamed timestamp",
            ),
            // Multiple levels of aliases
            (
                "SELECT MAX(_timestamp) as ts1, ts1 as _timestamp FROM table1",
                true,
                "Still results a _timestamp field ts1",
            ),
            // Subquery
            (
                "SELECT ts, code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                true,
                "Still results a _timestamp field CTE ts",
            ),
            // Subquery
            (
                "SELECT code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                true,
                "CHECK: Final result does not have _timestamp field SubQuery",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp) AS ts, count(*) FROM tbl1 WHERE a=b AND c IN(SELECT c FROM tbl2 WHERE c=d) GROUP BY ts ORDER BY ts ASC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT ts, cnt FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT * FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM (SELECT _timestamp, array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM tbl WHERE responsecode IN(SELECT array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT * FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT ts, cnt FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
                false,
                "CHECK: Final result does not have _timestamp field from the CTE cnt",
            ),
            // Subquery
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts ASC, request_count DESC",
                true,
                "Still results a _timestamp field",
            ),
            // Subquery
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts AS ts2, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts2 AS ts3, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts2 ASC, request_count DESC",
                true,
                "Still results a _timestamp field bucketed_statuses and ranked_statuses",
            ),
            // Join
            (
                "SELECT histogram(a._timestamp) AS ts, b.name, count(*) FROM tbl1 AS a LEFT JOIN tbl2 AS b ON a.userid=b.userid GROUP BY ts, name ORDER BY ts ASC",
                true,
                "Still results a _timestamp field from the join",
            ),
            // CTE
            (
                "WITH a AS (SELECT histogram(_timestamp) AS ts, userid, count(*) as cnt FROM tbl1 GROUP BY ts, userid HAVING cnt > 40) SELECT ts, SUM(cnt) AS cnt, COUNT(DISTINCT userid) AS user_cnt FROM a GROUP BY ts",
                true,
                "Still results a _timestamp field",
            ),
        ];

        for (sql, expected, test_name) in test_cases {
            let result = TimestampVisitor::validate_sql(sql);
            match result {
                Ok(result) => {
                    assert_eq!(
                        result.has_timestamp, expected,
                        "Failed test case '{}': expected {}, got {}. Columns: {:?}.",
                        test_name, expected, result.has_timestamp, result.column_names
                    );
                }
                Err(e) => {
                    panic!(
                        "Failed to parse SQL for test case '{}': {}. SQL: {}",
                        test_name, e, sql
                    );
                }
            }
        }
    }
}
