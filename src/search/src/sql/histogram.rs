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

use std::ops::ControlFlow;

use config::{
    HISTOGRAM_BREAKDOWN_FIELDS,
    meta::stream::StreamType,
    utils::{
        sql::is_eligible_for_histogram,
        time::{now_micros, parse_timezone_to_offset_at, parse_timezone_to_offset_opt},
    },
};
use infra::errors::{Error, ErrorCodes};
use sqlparser::{
    ast::{
        Expr, Function, FunctionArg, FunctionArgExpr, FunctionArguments, ObjectName, SetExpr,
        Statement, Value, visit_expressions, visit_expressions_mut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::visitor::histogram_interval::generate_histogram_interval;

/// Sets the bucket `histogram()` interval from the request, so execution buckets like partitions.
pub fn handle_histogram(
    origin_sql: &mut String,
    q_time_range: (i64, i64),
    histogram_interval: i64,
) {
    if !mentions_histogram(origin_sql) {
        return;
    }
    // The interval belongs to the first call, the one `HistogramIntervalVisitor` reads it from.
    let mut bucket_args = None;
    let _ = rewrite_statements(origin_sql, |statement| {
        let mut changed = false;
        let _ = visit_expressions_mut(statement, |expr| {
            if let Expr::Function(func) = expr
                && is_histogram_function(&func.name)
                && bucket_args.get_or_insert_with(|| func.args.clone()) == &func.args
            {
                changed |= set_histogram_interval(func, q_time_range, histogram_interval);
            }
            ControlFlow::<()>::Continue(())
        });
        Ok(changed)
    });
}

/// Replaces named zones by their offset at the request end, so partitions and deltas agree.
pub fn pin_histogram_timezone(
    sql: &mut String,
    timezone: &mut Option<String>,
    end_time: i64,
) -> Result<(), Error> {
    let reference_time = pin_reference_time(end_time);
    if !mentions_histogram(sql) {
        pin_request_timezone(timezone, reference_time);
        return Ok(());
    }
    rewrite_statements(sql, |statement| {
        pin_request_timezone(timezone, reference_time);
        let mut changed = false;
        let result = visit_expressions_mut(statement, |expr| {
            match pin_histogram_call(expr, timezone.as_deref(), reference_time) {
                Ok(updated) => changed |= updated,
                Err(error) => return ControlFlow::Break(error),
            }
            ControlFlow::Continue(())
        });
        match result {
            ControlFlow::Break(error) => Err(error),
            ControlFlow::Continue(()) => Ok(changed),
        }
    })
}

/// Returns the shared histogram offset at the supplied instant, or None when offsets differ.
pub fn histogram_offset(
    statement: &Statement,
    timezone: Option<&str>,
    reference_time: i64,
) -> Result<Option<i64>, Error> {
    let mut offsets = Vec::new();
    let result = visit_expressions(statement, |expr| {
        if let Expr::Function(func) = expr
            && is_histogram_function(&func.name)
            && let FunctionArguments::List(list) = &func.args
        {
            let offset = histogram_timezone(&list.args, timezone)
                .and_then(|timezone| timezone_offset_micros(timezone.as_deref(), reference_time));
            match offset {
                Ok(offset) => offsets.push(offset),
                Err(error) => return ControlFlow::Break(error),
            }
        }
        ControlFlow::Continue(())
    });
    if let ControlFlow::Break(error) = result {
        return Err(error);
    }
    let first = offsets.first().copied().unwrap_or_default();
    Ok(offsets
        .iter()
        .all(|offset| *offset == first)
        .then_some(first))
}

/// Cheap pre-check shared by every caller that would otherwise parse the SQL for `histogram()`.
pub fn mentions_histogram(sql: &str) -> bool {
    sql.to_ascii_lowercase().contains("histogram")
}

/// DataFusion resolves `"histogram"` and `HISTOGRAM` to the same UDF, so every caller must agree.
pub fn is_histogram_function(name: &ObjectName) -> bool {
    matches!(name.0.as_slice(), [part] if part.as_ident().is_some_and(|i| i.value.eq_ignore_ascii_case("histogram")))
}

/// Converts an original query to a histogram query
/// Extracts WHERE clause and builds histogram query with provided stream name
pub fn convert_to_histogram_query(
    original_query: &str,
    stream_names: &[String],
    is_multi_stream_search: bool,
    breakdown_field: Option<&str>,
) -> Result<String, Error> {
    let (is_eligible, is_sub_query) =
        is_eligible_for_histogram(original_query, is_multi_stream_search)
            .map_err(|e| Error::Message(e.to_string()))?;
    if !is_eligible {
        let error = Error::ErrorCode(ErrorCodes::SearchHistogramNotAvailable(
            "Histogram unavailable for CTEs, DISTINCT, UNION, JOIN and LIMIT queries.".to_string(),
        ));
        return Err(error);
    }

    // Parse the original query
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, original_query)
        .map_err(|e| anyhow::anyhow!("Failed to parse SQL query: {}", e))?;

    let histogram_query = if is_multi_stream_search {
        multi_stream_histogram_query(&statements, stream_names)?
    } else {
        single_stream_histogram_query(&statements, stream_names, is_sub_query, breakdown_field)?
    };

    Ok(histogram_query)
}

fn single_stream_histogram_query(
    statements: &[Statement],
    stream_names: &[String],
    is_sub_query: bool,
    breakdown_field: Option<&str>,
) -> Result<String, Error> {
    let statement = statements
        .first()
        .ok_or_else(|| anyhow::anyhow!("No SQL statement found"))?;

    // Extract WHERE clause only
    let where_clause = extract_where_clause(statement)?;
    let stream_name = stream_names
        .first()
        .ok_or_else(|| anyhow::anyhow!("No stream name found"))?;
    // Build histogram query
    let mut histogram_query = match breakdown_field {
        Some(field) => {
            // Escape any double-quotes inside the field name so it cannot break
            // identifier quoting and cannot be used as a SQL injection vector.
            let safe_field = field.replace('"', "\"\"");
            format!(
                "SELECT histogram(_timestamp) AS zo_sql_key, \"{safe_field}\" AS zo_sql_breakdown, count(*) AS zo_sql_num FROM \"{stream_name}\""
            )
        }
        None => format!(
            "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"{stream_name}\""
        ),
    };

    // Add WHERE clause if it exists
    // skip where clause for sub query
    if !where_clause.is_empty() && !is_sub_query {
        histogram_query.push_str(&format!(" WHERE {where_clause}"));
    }

    // Add GROUP BY and ORDER BY
    if breakdown_field.is_some() {
        histogram_query.push_str(" GROUP BY zo_sql_key, zo_sql_breakdown ORDER BY zo_sql_key DESC");
    } else {
        histogram_query.push_str(" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC");
    }
    Ok(histogram_query)
}

/// Detects the preferred histogram breakdown field from stream schema fields.
pub fn detect_histogram_breakdown_field(schema_fields: &[String]) -> Option<String> {
    for prioritized_field in HISTOGRAM_BREAKDOWN_FIELDS.iter() {
        if let Some(field) = schema_fields
            .iter()
            .find(|field_name| field_name.eq_ignore_ascii_case(prioritized_field))
        {
            return Some(field.clone());
        }
    }
    None
}

/// Resolves the histogram breakdown field for a stream by reading its schema
/// and applying [`detect_histogram_breakdown_field`].
pub async fn resolve_histogram_breakdown_field(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Option<String> {
    infra::schema::get(org_id, stream_name, stream_type)
        .await
        .ok()
        .and_then(|schema| {
            let schema_fields = schema
                .fields()
                .iter()
                .map(|field| field.name().to_string())
                .collect::<Vec<_>>();
            detect_histogram_breakdown_field(&schema_fields)
        })
}

fn multi_stream_histogram_query(
    statements: &[Statement],
    stream_names: &[String],
) -> Result<String, Error> {
    if statements.is_empty() || stream_names.is_empty() {
        return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "No statements or stream names provided".to_string(),
        )));
    }

    // Build individual histogram queries for each stream
    let mut histogram_queries = Vec::new();
    for stream_name in stream_names {
        let mut query = format!(
            "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"{stream_name}\"",
        );

        query.push_str(" GROUP BY zo_sql_key");
        histogram_queries.push(query);
    }

    // Combine all histogram queries with UNION ALL
    let cte_body = histogram_queries.join(" UNION ALL ");

    // Build the complete query with CTE
    let final_query = format!(
        "WITH multistream_histogram AS ({cte_body}) SELECT zo_sql_key, sum(zo_sql_num) AS zo_sql_num FROM multistream_histogram GROUP BY zo_sql_key ORDER BY zo_sql_key",
    );

    Ok(final_query)
}

/// Extract WHERE clause from SQL statement
fn extract_where_clause(statement: &Statement) -> Result<String, Error> {
    if let Statement::Query(query) = statement {
        if let SetExpr::Select(select) = &*query.body {
            // Extract WHERE clause
            let where_clause = select
                .selection
                .as_ref()
                .map(|clause| clause.to_string())
                .unwrap_or_default();

            Ok(where_clause)
        } else {
            let error = Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Query is not a SELECT statement".to_string(),
            ));
            Err(error)
        }
    } else {
        let error = Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "Statement is not a query".to_string(),
        ));
        Err(error)
    }
}

/// The instant named zones are resolved at; a request without an end means now.
fn pin_reference_time(end_time: i64) -> i64 {
    if end_time > 0 { end_time } else { now_micros() }
}

fn pin_request_timezone(timezone: &mut Option<String>, end_time: i64) {
    if let Some(tz) = timezone.as_deref()
        && let Some(fixed) = fixed_offset_of_named_zone(tz, end_time)
    {
        *timezone = Some(fixed);
    }
}

/// Parses, applies `rewrite` per statement and serializes back only when a statement changed.
fn rewrite_statements(
    sql: &mut String,
    mut rewrite: impl FnMut(&mut Statement) -> Result<bool, Error>,
) -> Result<(), Error> {
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error.to_string())))?;
    let mut changed = false;
    for statement in &mut statements {
        changed |= rewrite(statement)?;
    }
    if changed {
        *sql = statements
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ");
    }
    Ok(())
}

fn timezone_offset_micros(timezone: Option<&str>, end_time: i64) -> Result<i64, Error> {
    let Some(tz) = timezone else {
        return Ok(0);
    };
    parse_timezone_to_offset_at(tz, end_time)
        .and_then(|offset| offset.checked_mul(1_000_000))
        .ok_or_else(|| Error::Message(format!("Invalid timezone in histogram(): '{tz}'")))
}

fn set_histogram_interval(
    func: &mut Function,
    q_time_range: (i64, i64),
    histogram_interval: i64,
) -> bool {
    let FunctionArguments::List(list) = &mut func.args else {
        return false;
    };
    if list.args.is_empty() {
        return false;
    }
    let interval = if histogram_interval > 0 {
        format!("{histogram_interval} second")
    } else if list.args.len() > 1 {
        return false;
    } else {
        generate_histogram_interval(q_time_range).to_string()
    };
    let literal = FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::value(
        Value::SingleQuotedString(interval.clone()),
    )));
    let Some(arg) = list.args.get_mut(1) else {
        list.args.insert(1, literal);
        return true;
    };
    let same = string_literal(arg)
        .is_some_and(|value| value.clone().into_string().as_deref() == Some(interval.as_str()));
    if same {
        return false;
    }
    *arg = literal;
    true
}

fn pin_histogram_call(
    expr: &mut Expr,
    timezone: Option<&str>,
    end_time: i64,
) -> Result<bool, Error> {
    let Expr::Function(func) = expr else {
        return Ok(false);
    };
    if !is_histogram_function(&func.name) {
        return Ok(false);
    }
    let FunctionArguments::List(list) = &mut func.args else {
        return Ok(false);
    };
    let timezone = histogram_timezone(&list.args, timezone)?;
    timezone_offset_micros(timezone.as_deref(), end_time)?;
    if let Some(tz) = timezone.as_deref()
        && let Some(fixed) = fixed_offset_of_named_zone(tz, end_time)
        && let Some(arg) = list.args.get_mut(2)
        && let Some(value) = string_literal(arg)
    {
        *value = Value::SingleQuotedString(fixed);
        return Ok(true);
    }
    Ok(false)
}

fn histogram_timezone(
    args: &[FunctionArg],
    timezone: Option<&str>,
) -> Result<Option<String>, Error> {
    let Some(arg) = args.get(2) else {
        return Ok(timezone.map(str::to_string));
    };
    let value = match arg {
        FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) => {
            let mut expr = expr;
            while let Expr::Nested(inner) = expr {
                expr = inner;
            }
            match expr {
                Expr::Value(literal) => literal.value.clone().into_string(),
                _ => None,
            }
        }
        _ => None,
    };
    value.map(Some).ok_or_else(|| {
        Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "histogram() timezone must be a constant string".to_string(),
        ))
    })
}

fn string_literal(arg: &mut FunctionArg) -> Option<&mut Value> {
    let FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) = arg else {
        return None;
    };
    let Expr::Value(literal) = without_brackets(expr) else {
        return None;
    };
    let is_string = literal.value.clone().into_string().is_some();
    is_string.then_some(&mut literal.value)
}

fn without_brackets(expr: &mut Expr) -> &mut Expr {
    match expr {
        Expr::Nested(inner) => without_brackets(inner),
        other => other,
    }
}

fn fixed_offset_of_named_zone(tz: &str, end_time: i64) -> Option<String> {
    if parse_timezone_to_offset_opt(tz).is_some() {
        return None;
    }
    let secs = parse_timezone_to_offset_at(tz, end_time)?;
    // A sub-minute offset (pre-1972 local mean time) cannot be written as a fixed offset.
    if secs % 60 != 0 {
        return None;
    }
    let (sign, secs) = if secs < 0 { ('-', -secs) } else { ('+', secs) };
    Some(format!("{sign}{:02}:{:02}", secs / 3600, secs % 3600 / 60))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handle_histogram() {
        // Test case 1: Basic histogram with numeric interval
        let mut sql = "SELECT histogram(_timestamp, '10 seconds') FROM logs".to_string();
        let time_range = (1640995200000000, 1641081600000000); // 2022-01-01 to 2022-01-02
        handle_histogram(&mut sql, time_range, 10);
        assert!(sql.contains("histogram(_timestamp,"));
        assert!(sql.contains("second"));
    }

    #[test]
    fn test_convert_simple_query() {
        let original_query = "SELECT * FROM \"logs\" WHERE status = 500";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, None).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"logs\" WHERE status = 500 GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_without_where() {
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, None).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"logs\" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_with_group_by() {
        let original_query = "SELECT * FROM \"api_logs\" GROUP BY level";
        let stream_names = vec!["api_logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, None).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"api_logs\" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_multi_stream_histogram_query_basic() {
        let original_query = "SELECT * FROM default UNION ALL SELECT * FROM default_enrich";
        let stream_names = vec!["default".to_string(), "default_enrich".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names, true, None).unwrap();

        let expected = "WITH multistream_histogram AS (SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"default\" GROUP BY zo_sql_key UNION ALL SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"default_enrich\" GROUP BY zo_sql_key) SELECT zo_sql_key, sum(zo_sql_num) AS zo_sql_num FROM multistream_histogram GROUP BY zo_sql_key ORDER BY zo_sql_key";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_with_breakdown_field() {
        let original_query = "SELECT * FROM \"logs\" WHERE status = 500";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, Some("severity"))
                .unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, \"severity\" AS zo_sql_breakdown, count(*) AS zo_sql_num FROM \"logs\" WHERE status = 500 GROUP BY zo_sql_key, zo_sql_breakdown ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_detect_histogram_breakdown_field_priority() {
        let fields = vec![
            "status".to_string(),
            "level".to_string(),
            "severity".to_string(),
        ];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("severity".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_log_level_over_level() {
        let fields = vec!["level".to_string(), "log_level".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("log_level".to_string()));
    }

    // --- detect_histogram_breakdown_field edge cases ---

    #[test]
    fn test_detect_histogram_breakdown_field_empty_input() {
        // No fields at all → no breakdown field
        let fields: Vec<String> = vec![];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, None);
    }

    #[test]
    fn test_detect_histogram_breakdown_field_no_match() {
        // Fields present but none are in the priority list → no breakdown
        let fields = vec![
            "message".to_string(),
            "timestamp".to_string(),
            "user_id".to_string(),
        ];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, None);
    }

    #[test]
    fn test_detect_histogram_breakdown_field_only_status() {
        // status is the lowest-priority field but still detected when it's the only match
        let fields = vec!["message".to_string(), "status".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("status".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_severity_beats_log_level() {
        // severity is highest priority; log_level must not win
        let fields = vec!["log_level".to_string(), "severity".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("severity".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_severity_beats_level() {
        let fields = vec!["level".to_string(), "severity".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("severity".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_severity_beats_status() {
        let fields = vec!["status".to_string(), "severity".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("severity".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_log_level_beats_status() {
        let fields = vec!["status".to_string(), "log_level".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("log_level".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_level_beats_status() {
        let fields = vec!["status".to_string(), "level".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("level".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_case_insensitive() {
        // Matching is case-insensitive; the returned value is the original schema field name
        let fields = vec!["MESSAGE".to_string(), "SEVERITY".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("SEVERITY".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_preserves_original_casing() {
        // The returned string must be the schema field name, not the priority-list key
        let fields = vec!["Status".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("Status".to_string()));
    }

    #[test]
    fn test_detect_histogram_breakdown_field_mixed_case_log_level() {
        let fields = vec!["Log_Level".to_string(), "status".to_string()];
        let result = detect_histogram_breakdown_field(&fields);
        assert_eq!(result, Some("Log_Level".to_string()));
    }

    // --- convert_to_histogram_query with breakdown_field ---

    #[test]
    fn test_convert_query_with_breakdown_no_where() {
        // breakdown field present, no WHERE clause in original query
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, Some("level"))
                .unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, \"level\" AS zo_sql_breakdown, count(*) AS zo_sql_num FROM \"logs\" GROUP BY zo_sql_key, zo_sql_breakdown ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_none_breakdown_preserves_flat_group_by() {
        // Passing None must produce the original flat GROUP BY (regression guard)
        let original_query = "SELECT * FROM \"logs\" WHERE level = 'info'";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, None).unwrap();

        // Must NOT contain zo_sql_breakdown
        assert!(!result.contains("zo_sql_breakdown"));
        assert!(result.contains("GROUP BY zo_sql_key ORDER BY"));
    }

    #[test]
    fn test_convert_query_breakdown_group_by_includes_breakdown_column() {
        // When breakdown_field is Some, GROUP BY must list both zo_sql_key and zo_sql_breakdown
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, Some("severity"))
                .unwrap();

        assert!(result.contains("GROUP BY zo_sql_key, zo_sql_breakdown"));
    }

    #[test]
    fn test_convert_query_breakdown_select_contains_breakdown_alias() {
        // The SELECT list must contain the aliased breakdown column
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, Some("severity"))
                .unwrap();

        assert!(result.contains("\"severity\" AS zo_sql_breakdown"));
    }

    #[test]
    fn test_convert_query_with_cte_not_eligible() {
        let original_query = "WITH cte AS (SELECT * FROM logs) SELECT * FROM cte";
        let stream_names = vec!["logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names, false, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("Histogram unavailable"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn test_convert_query_with_limit_not_eligible() {
        let original_query = "SELECT * FROM \"logs\" LIMIT 100";
        let stream_names = vec!["logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names, false, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_convert_query_with_distinct_not_eligible() {
        let original_query = "SELECT DISTINCT level FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names, false, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_multi_stream_histogram_empty_statements_returns_error() {
        let statements: Vec<Statement> = vec![];
        let stream_names = vec!["logs".to_string()];
        let result = multi_stream_histogram_query(&statements, &stream_names);
        assert!(result.is_err());
    }

    #[test]
    fn test_multi_stream_histogram_empty_stream_names_returns_error() {
        let sql = "SELECT * FROM logs";
        let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).unwrap();
        let stream_names: Vec<String> = vec![];
        let result = multi_stream_histogram_query(&statements, &stream_names);
        assert!(result.is_err());
    }

    #[test]
    fn test_convert_query_breakdown_field_with_quote_escaped() {
        // breakdown field containing a double-quote is escaped in the output
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result =
            convert_to_histogram_query(original_query, &stream_names, false, Some("bad\"field"))
                .unwrap();
        // The double-quote inside the field name must be escaped as "" inside the identifier
        assert!(result.contains("\"bad\"\"field\""));
    }

    #[test]
    fn test_single_stream_sub_query_skips_where_clause() {
        // When is_sub_query=true, the WHERE clause from the original must be dropped.
        // is_eligible_for_histogram returns (true, true) for a sub-query pattern
        // which we trigger via a UNION ALL (multi-stream) is_sub_query path.
        // Instead, call single_stream_histogram_query directly with is_sub_query=true.
        let sql = "SELECT * FROM logs WHERE level = 'error'";
        let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).unwrap();
        let stream_names = vec!["logs".to_string()];
        let result = single_stream_histogram_query(&statements, &stream_names, true, None).unwrap();
        // WHERE clause must be absent when is_sub_query is true
        assert!(!result.contains("WHERE"), "expected no WHERE: {result}");
    }
}
