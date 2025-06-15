use std::{
    collections::{HashMap, HashSet, VecDeque},
    ops::ControlFlow,
};

use sqlparser::ast::{
    Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Query, SelectItem, SetExpr, Statement,
    TableFactor, Visitor,
};

const TIMESTAMP_COL_NAME: &str = "_timestamp";
#[derive(Debug, Clone)]
struct QueryInfo {
    projections: Vec<SelectItem>,
    is_main_query: bool,
}

#[derive(Debug)]
pub struct TimestampVisitor {
    pub timestamp_selected: bool,
    pub timestamp_aliases: HashSet<String>,
    pub timestamp_columns: Vec<String>,
    pub query_depth: usize,
    pub cte_timestamp_columns: HashMap<String, HashSet<String>>,
    pub current_scope_timestamp_columns: HashSet<String>,

    // Queue-based processing
    query_queue: VecDeque<QueryInfo>,
}

impl Default for TimestampVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl TimestampVisitor {
    pub fn new() -> Self {
        Self {
            timestamp_selected: false,
            timestamp_aliases: HashSet::new(),
            timestamp_columns: Vec::new(),
            query_depth: 0,
            cte_timestamp_columns: HashMap::new(),
            current_scope_timestamp_columns: HashSet::new(),
            query_queue: VecDeque::new(),
        }
    }

    pub fn add_timestamp_column(&mut self, column: String) {
        if !self.timestamp_columns.contains(&column) {
            self.timestamp_columns.push(column);
        }
    }

    pub fn is_timestamp_expr(expr: &Expr) -> bool {
        match expr {
            Expr::Identifier(ident) => ident.value == TIMESTAMP_COL_NAME,
            Expr::CompoundIdentifier(parts) => {
                // Handle qualified column references like "t1._timestamp"
                parts
                    .last()
                    .map(|part| part.value == TIMESTAMP_COL_NAME)
                    .unwrap_or(false)
            }
            Expr::Function(func) => {
                if let Some(name) = func.name.0.first() {
                    if name.value.to_lowercase() == "histogram" {
                        if let FunctionArguments::List(args) = &func.args {
                            return args.args.iter().any(|arg| {
                                if let FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) = arg {
                                    Self::is_timestamp_expr(expr)
                                } else {
                                    false
                                }
                            });
                        }
                    }
                }
                false
            }
            _ => false,
        }
    }

    fn is_timestamp_column_reference(&self, column: &str, _table: Option<&str>) -> bool {
        column == TIMESTAMP_COL_NAME || self.timestamp_aliases.contains(column)
    }

    // Process all collected queries in the correct order
    pub fn process_query_queue(&mut self) {
        while let Some(query_info) = self.query_queue.pop_front() {
            self.process_query_projections(&query_info.projections, query_info.is_main_query);
        }
    }

    fn process_query_projections(&mut self, projections: &[SelectItem], is_main_query: bool) {
        for item in projections {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    let is_timestamp = match expr {
                        Expr::Identifier(ident) => {
                            Self::is_timestamp_expr(expr)
                                || self.timestamp_aliases.contains(&ident.value)
                                || self.is_timestamp_column_reference(&ident.value, None)
                        }
                        Expr::CompoundIdentifier(parts) => {
                            // Check if it's a direct timestamp (like t1._timestamp)
                            Self::is_timestamp_expr(expr) ||
                            // Check if the column part is a timestamp alias (like t.other where other is an alias)
                            parts.last().map(|part| self.timestamp_aliases.contains(&part.value)).unwrap_or(false)
                        }
                        _ => Self::is_timestamp_expr(expr),
                    };

                    if is_timestamp {
                        // Get the actual column name being selected
                        let column_name = match expr {
                            Expr::Identifier(ident) => ident.value.clone(), // "ts"
                            Expr::CompoundIdentifier(parts) => parts
                                .last()
                                .map(|part| part.value.clone())
                                .unwrap_or_else(|| TIMESTAMP_COL_NAME.to_string()),
                            _ => TIMESTAMP_COL_NAME.to_string(),
                        };

                        self.current_scope_timestamp_columns
                            .insert(column_name.clone()); // Use actual name
                        if is_main_query {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(column_name); // Use actual name
                        }
                    }
                }

                SelectItem::ExprWithAlias { expr, alias } => {
                    let is_timestamp = if alias.value == TIMESTAMP_COL_NAME {
                        true // Anything aliased as _timestamp counts
                    } else if let Expr::Identifier(ident) = expr {
                        Self::is_timestamp_expr(expr)
                            || self.timestamp_aliases.contains(&ident.value)
                            || self.is_timestamp_column_reference(&ident.value, None)
                    } else {
                        Self::is_timestamp_expr(expr)
                    };

                    if is_timestamp {
                        self.current_scope_timestamp_columns
                            .insert(alias.value.clone());
                        // Always add to aliases for propagation
                        self.timestamp_aliases.insert(alias.value.clone());
                        // Only set final result for main query
                        if is_main_query {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(alias.value.clone());
                        }
                    }

                    // Handle alias chains for non-timestamp expressions
                    if !is_timestamp {
                        if let Expr::Identifier(ident) = expr {
                            if self.timestamp_aliases.contains(&ident.value) {
                                self.current_scope_timestamp_columns
                                    .insert(alias.value.clone());
                                self.timestamp_aliases.insert(alias.value.clone());
                                // Only set final result for main query
                                if is_main_query {
                                    self.timestamp_selected = true;
                                    self.add_timestamp_column(alias.value.clone());
                                }
                            }
                        }
                    }
                }

                SelectItem::Wildcard(_) => {
                    // For wildcard, use whatever timestamp columns are available in current scope
                    for col in &self.current_scope_timestamp_columns.clone() {
                        if is_main_query {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(col.clone());
                        }
                    }
                    // If no scope columns, default to _timestamp
                    if self.current_scope_timestamp_columns.is_empty() {
                        self.current_scope_timestamp_columns
                            .insert(TIMESTAMP_COL_NAME.to_string());
                        if is_main_query {
                            self.timestamp_selected = true;
                            self.add_timestamp_column(TIMESTAMP_COL_NAME.to_string());
                        }
                    }
                }

                SelectItem::QualifiedWildcard(..) => {
                    self.current_scope_timestamp_columns
                        .insert(TIMESTAMP_COL_NAME.to_string());
                    // Only set final result for main query
                    if is_main_query {
                        self.timestamp_selected = true;
                        self.add_timestamp_column(TIMESTAMP_COL_NAME.to_string());
                    }
                }
            }
        }
    }
}

impl Visitor for TimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        let is_outermost = self.query_depth == 0;
        self.query_depth += 1;

        // Save current scope state
        let saved_scope_columns = self.current_scope_timestamp_columns.clone();
        self.current_scope_timestamp_columns.clear();

        // **HANDLE WITH CLAUSE (CTEs) FIRST**
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                // Save current scope for this CTE
                let saved_cte_scope = self.current_scope_timestamp_columns.clone();
                self.current_scope_timestamp_columns.clear();

                // Process the CTE query recursively
                self.pre_visit_query(&cte.query)?;

                // Store the timestamp columns for this CTE
                self.cte_timestamp_columns.insert(
                    cte.alias.name.value.clone(),
                    self.current_scope_timestamp_columns.clone(),
                );

                // Restore scope
                self.current_scope_timestamp_columns = saved_cte_scope;
            }
        }

        // Determine if this is the main query (has WITH clause OR is outermost without WITH)
        let is_main_query = query.with.is_some() || (query.with.is_none() && is_outermost);

        // **QUEUE APPROACH**: Instead of processing immediately, add to queue
        if let SetExpr::Select(select) = query.body.as_ref() {
            // Process FROM clause first to handle subqueries
            for table in &select.from {
                self.pre_visit_table_factor(&table.relation)?;
            }

            // **BUILD ALIASES DURING VISITOR PHASE** for immediate availability
            for item in &select.projection {
                if let SelectItem::ExprWithAlias { expr, alias } = item {
                    let is_timestamp = if alias.value == TIMESTAMP_COL_NAME {
                        true
                    } else if let Expr::Identifier(ident) = expr {
                        Self::is_timestamp_expr(expr)
                            || self.timestamp_aliases.contains(&ident.value)
                            || self.is_timestamp_column_reference(&ident.value, None)
                    } else {
                        Self::is_timestamp_expr(expr)
                    };

                    if is_timestamp {
                        // Add to aliases immediately during visitor phase
                        self.timestamp_aliases.insert(alias.value.clone());
                        self.current_scope_timestamp_columns
                            .insert(alias.value.clone());
                    }

                    // Handle alias chains
                    if !is_timestamp {
                        if let Expr::Identifier(ident) = expr {
                            if self.timestamp_aliases.contains(&ident.value) {
                                self.timestamp_aliases.insert(alias.value.clone());
                                self.current_scope_timestamp_columns
                                    .insert(alias.value.clone());
                            }
                        }
                    }
                }
            }

            // Add this query's projections to the queue for final result determination
            let query_info = QueryInfo {
                projections: select.projection.clone(),
                is_main_query,
            };

            if is_main_query {
                self.query_queue.push_back(query_info); // Main query processed last
            } else {
                self.query_queue.push_front(query_info); // Subqueries processed first
            }
        }

        // Restore previous scope
        if !is_outermost {
            self.current_scope_timestamp_columns = saved_scope_columns;
        }

        self.query_depth -= 1;
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, table: &TableFactor) -> ControlFlow<Self::Break> {
        match table {
            TableFactor::Table { name, alias, .. } => {
                let table_name = &name.0.last().unwrap().value;

                // Check if this table is a CTE
                if let Some(cte_columns) = self.cte_timestamp_columns.get(table_name) {
                    // Add CTE timestamp columns to current scope
                    for col in cte_columns {
                        if let Some(_alias) = alias {
                            // If table has alias, timestamp would be accessed as alias.col
                            self.current_scope_timestamp_columns.insert(col.clone());
                        } else {
                            self.current_scope_timestamp_columns.insert(col.clone());
                        }
                    }
                }
            }
            TableFactor::Derived {
                subquery, alias, ..
            } => {
                // Save current scope
                let saved_scope = self.current_scope_timestamp_columns.clone();
                self.current_scope_timestamp_columns.clear();

                // Process the subquery
                self.pre_visit_query(subquery)?;

                // If subquery has timestamp columns, make them available in current scope
                let subquery_columns = self.current_scope_timestamp_columns.clone();

                // Restore and merge
                self.current_scope_timestamp_columns = saved_scope;
                for col in subquery_columns {
                    if let Some(_alias) = alias {
                        // Subquery has alias, so columns are accessed as alias.col
                        self.current_scope_timestamp_columns.insert(col);
                    } else {
                        self.current_scope_timestamp_columns.insert(col);
                    }
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

#[derive(Debug)]
pub struct TimestampAnalysisResult {
    pub has_timestamp: bool,
    pub column_names: Vec<String>,
}

// Main analysis function
pub fn analyze_timestamp_selection(sql: &str) -> Result<TimestampAnalysisResult, String> {
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    let dialect = GenericDialect {};
    let mut statements =
        Parser::parse_sql(&dialect, sql).map_err(|e| format!("Parse error: {}", e))?;

    if statements.len() != 1 {
        return Err("Expected exactly one statement".to_string());
    }

    if let Statement::Query(query) = &mut statements[0] {
        let mut visitor = TimestampVisitor::new();

        // First pass: collect all queries in the queue
        let _ = visitor.pre_visit_query(query);

        // Second pass: process the queue in correct order
        visitor.process_query_queue();

        Ok(TimestampAnalysisResult {
            has_timestamp: visitor.timestamp_selected,
            column_names: visitor.timestamp_columns,
        })
    } else {
        Err("Expected a query statement".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_selection() {
        let test_cases = vec![(
            "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
            false,
            "CHECK: Final result does not have _timestamp field from the CTE cnt",
        )];

        for (sql, expected, test_name) in test_cases {
            let result = analyze_timestamp_selection(sql);
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

    #[test]
    fn all_test_timestamp_selection() {
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
                "One of the functions has _timestamp alias",
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
                "Expression without _timestamp alias",
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
                "No Timestamp CASE",
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
                false,
                "Final result does not have _timestamp field SubQuery",
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
                "Still results a _timestamp field SubQuery with group by",
            ),
            // Subquery
            (
                "SELECT * FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field - wildcard",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM (SELECT _timestamp, array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field - histogram in top level",
            ),
            // Subquery
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM tbl WHERE responsecode IN(SELECT array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field - histogram in top level2",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT * FROM tbl1",
                true,
                "Still results a _timestamp field - histogram in CTE",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT ts, cnt FROM tbl1",
                true,
                "Still results a _timestamp field - histogram in CTE2",
            ),
            // Subquery
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
                false,
                "Final result does not have _timestamp field from the CTE cnt",
            ),
            // Subquery
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts ASC, request_count DESC",
                true,
                "Still results a _timestamp field - histogram in CTE3",
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
                "Still results a _timestamp field - histogram in CTE4",
            ),
        ];

        for (sql, expected, test_name) in test_cases {
            let result = analyze_timestamp_selection(sql);
            match result {
                Ok(result) => {
                    println!(
                        "test case '{}': expected {}, got {}. Columns: {:?}.",
                        sql, expected, result.has_timestamp, result.column_names
                    );
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
