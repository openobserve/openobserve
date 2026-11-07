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
        Expr, FunctionArg, FunctionArgExpr, FunctionArguments, SetExpr, Statement, Value, VisitMut,
        visit_expressions_mut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::{
    RE_HISTOGRAM,
    visitor::histogram_interval::{
        HistogramIntervalVisitor, generate_histogram_interval, histogram_timezone_literal,
    },
};

pub fn handle_histogram(
    origin_sql: &mut String,
    q_time_range: (i64, i64),
    histogram_interval: i64,
) {
    let Some(captures) = RE_HISTOGRAM.captures(origin_sql.as_str()) else {
        return;
    };

    let args = match captures.get(1) {
        Some(args) => args
            .as_str()
            .split(',')
            .map(|value| {
                value
                    .trim()
                    .trim_matches(|value| value == '\'' || value == '"')
            })
            .collect::<Vec<_>>(),
        None => return,
    };

    let interval = if histogram_interval > 0 {
        format!("{histogram_interval} second")
    } else {
        args.get(1)
            .map_or_else(|| generate_histogram_interval(q_time_range), |value| *value)
            .to_string()
    };
    let field = args.first().unwrap_or(&"_timestamp");

    let timezone = captures
        .get(1)
        .and_then(|args| args.as_str().split(',').nth(2))
        .map_or_else(String::new, |value| format!(",{}", value.trim()));

    *origin_sql = origin_sql.replace(
        captures.get(0).unwrap().as_str(),
        &format!("histogram({field},'{interval}'{timezone})"),
    );
}

/// The timezone argument of the first `histogram()` in the SQL.
pub fn histogram_timezone_arg(sql: &str) -> Result<Option<String>, Error> {
    let Some(call) = first_histogram_call(sql) else {
        return Ok(None);
    };
    if let Some(error) = call.error {
        return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error)));
    }
    Ok(call.timezone)
}

/// The offset east of UTC that `histogram()` buckets use; the SQL argument beats the request.
pub fn histogram_offset_micros(
    sql: &str,
    timezone: Option<&str>,
    end_time: i64,
) -> Result<i64, Error> {
    let sql_timezone = histogram_timezone_arg(sql)?;
    timezone_offset_micros(sql_timezone.as_deref().or(timezone), end_time)
}

/// Cache coverage requires every histogram to use the same shifted timestamp coordinate.
pub fn histogram_cache_offset_micros(
    sql: &str,
    timezone: Option<&str>,
    end_time: i64,
) -> Result<Option<i64>, Error> {
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error.to_string())))?;
    let mut timezones = Vec::new();
    for statement in &mut statements {
        let _ = visit_expressions_mut(statement, |expr| {
            if let Expr::Function(func) = expr
                && func.name.to_string().eq_ignore_ascii_case("histogram")
                && let FunctionArguments::List(list) = &func.args
            {
                timezones.push(list.args.get(2).map(histogram_timezone_literal).transpose());
            }
            ControlFlow::<()>::Continue(())
        });
    }
    let mut offset = None;
    for sql_timezone in timezones {
        let sql_timezone =
            sql_timezone.map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error)))?;
        let current = timezone_offset_micros(sql_timezone.as_deref().or(timezone), end_time)?;
        if let Some(previous) = offset
            && previous != current
        {
            return Ok(None);
        }
        offset = Some(current);
    }
    Ok(Some(offset.unwrap_or_default()))
}

/// Replaces named zones by their offset at the request end, so partitions and deltas agree.
pub fn pin_histogram_timezone(
    sql: &mut String,
    timezone: &mut Option<String>,
    end_time: i64,
) -> Result<(), Error> {
    let end_time = if end_time > 0 { end_time } else { now_micros() };
    if sql.to_ascii_lowercase().contains("histogram") {
        let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error.to_string())))?;
        let mut changed = false;
        for statement in &mut statements {
            let result = visit_expressions_mut(statement, |expr| {
                match pin_named_zone_argument(expr, end_time) {
                    Ok(updated) => {
                        changed |= updated;
                        ControlFlow::Continue(())
                    }
                    Err(error) => ControlFlow::Break(error),
                }
            });
            if let ControlFlow::Break(error) = result {
                return Err(error);
            }
        }
        if changed {
            *sql = statements
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
        }
    }
    if let Some(tz) = timezone.as_deref()
        && let Some(fixed) = fixed_offset_of_named_zone(tz, end_time)
    {
        *timezone = Some(fixed);
    }
    Ok(())
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

fn timezone_offset_micros(timezone: Option<&str>, end_time: i64) -> Result<i64, Error> {
    let Some(tz) = timezone else {
        return Ok(0);
    };
    parse_timezone_to_offset_at(tz, end_time)
        .and_then(|offset| offset.checked_mul(1_000_000))
        .ok_or_else(|| Error::Message(format!("Invalid timezone in histogram(): '{tz}'")))
}

/// Reads the first `histogram()` from the parsed SQL, because a regex misses valid spellings.
fn first_histogram_call(sql: &str) -> Option<HistogramIntervalVisitor> {
    if !sql.to_ascii_lowercase().contains("histogram") {
        return None;
    }
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
    let mut visitor = HistogramIntervalVisitor::new((0, 0));
    for mut statement in statements {
        let _ = statement.visit(&mut visitor);
    }
    visitor.is_histogram.then_some(visitor)
}

fn pin_named_zone_argument(expr: &mut Expr, end_time: i64) -> Result<bool, Error> {
    let Expr::Function(func) = expr else {
        return Ok(false);
    };
    if !func.name.to_string().eq_ignore_ascii_case("histogram") {
        return Ok(false);
    }
    let FunctionArguments::List(list) = &mut func.args else {
        return Ok(false);
    };
    let Some(arg) = list.args.get_mut(2) else {
        return Ok(false);
    };
    let timezone = histogram_timezone_literal(arg)
        .map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error)))?;
    let fixed = fixed_offset_of_named_zone(&timezone, end_time);
    let FunctionArg::Unnamed(FunctionArgExpr::Expr(arg)) = arg else {
        return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "histogram() timezone must be a constant string".to_string(),
        )));
    };
    if let Expr::Value(literal) = without_brackets(arg) {
        if let Some(fixed) = fixed {
            literal.value = Value::SingleQuotedString(fixed);
            return Ok(true);
        }
        return Ok(false);
    }
    *arg = Expr::Value(Value::SingleQuotedString(fixed.unwrap_or(timezone)).into());
    Ok(true)
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
    let (sign, secs) = if secs < 0 { ('-', -secs) } else { ('+', secs) };
    let mut fixed = format!("{sign}{:02}:{:02}", secs / 3600, secs % 3600 / 60);
    if secs % 60 != 0 {
        fixed.push_str(&format!(":{:02}", secs % 60));
    }
    Some(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timezone_constant_arguments_do_not_fall_back() {
        for expression in [
            "CASE WHEN true THEN '+05:30' ELSE '-08:00' END",
            "CAST('+05:30' AS VARCHAR)",
            "concat('+05', ':30')",
        ] {
            let sql = format!("SELECT histogram(_timestamp, '1 day', {expression}) FROM t");
            assert_eq!(
                histogram_offset_micros(&sql, Some("UTC"), 1_782_864_000_000_000).unwrap(),
                19_800_000_000,
                "{expression}"
            );
        }
        let sql = "SELECT histogram(_timestamp, '1 day', _timestamp) FROM t";
        assert!(histogram_offset_micros(sql, Some("UTC"), 1_782_864_000_000_000).is_err());
        let sql = "SELECT histogram(_timestamp, '1 day', NULL) FROM t";
        assert!(histogram_offset_micros(sql, Some("+05:30"), 1_782_864_000_000_000).is_err());
    }

    #[test]
    fn timezone_sql_precedence_and_named_zone_stability() {
        const HOUR: i64 = 3_600_000_000;
        const JULY: i64 = 1_782_864_000_000_000;
        const JANUARY: i64 = 1_767_225_600_000_000;
        for sql in [
            "SELECT histogram(_timestamp, '1 day', '+05:30') FROM t",
            "SELECT histogram (_timestamp, '1 day', ('+05:30')) FROM t",
            "SELECT histogram/*x*/(_timestamp, '1 day', $$+05:30$$) FROM t",
        ] {
            assert_eq!(
                super::histogram_offset_micros(sql, Some("-08:00"), JULY).unwrap(),
                11 * HOUR / 2
            );
        }
        let sql = "SELECT histogram(_timestamp, '1 day') FROM t";
        assert_eq!(
            super::histogram_offset_micros(sql, Some("-08:00"), JULY).unwrap(),
            -8 * HOUR
        );
        assert!(super::histogram_offset_micros(sql, Some("Invalid/Zone"), JULY).is_err());
        for (zone, reference, fixed) in [
            ("America/Los_Angeles", JULY, "-07:00"),
            ("Africa/Monrovia", 31_536_000_000_000, "-00:44:30"),
        ] {
            let mut sql = format!(
                "SELECT histogram(_timestamp, '1 day', '{zone}') FROM t WHERE name = '{zone}'"
            );
            let mut timezone = Some(zone.to_string());
            super::pin_histogram_timezone(&mut sql, &mut timezone, reference).unwrap();
            assert_eq!(
                super::histogram_timezone_arg(&sql).unwrap().as_deref(),
                Some(fixed)
            );
            assert_eq!(timezone.as_deref(), Some(fixed));
            let pinned = sql.clone();
            let offset =
                super::histogram_offset_micros(&sql, timezone.as_deref(), reference).unwrap();
            super::pin_histogram_timezone(&mut sql, &mut timezone, JANUARY).unwrap();
            assert_eq!(sql, pinned);
            assert_eq!(
                super::histogram_offset_micros(&sql, timezone.as_deref(), JANUARY).unwrap(),
                offset
            );
            assert!(sql.contains(&format!("WHERE name = '{zone}'")));
        }
    }

    #[test]
    fn timezone_survives_interval_normalization() {
        for timezone in ["+05:30", "-08:00", "UTC", "America/Los_Angeles"] {
            let mut sql = format!("SELECT histogram(_timestamp, '1 day', '{timezone}') FROM t");
            super::handle_histogram(&mut sql, (0, 0), 3600);
            assert_eq!(
                sql,
                format!("SELECT histogram(_timestamp,'3600 second','{timezone}') FROM t")
            );
        }
    }

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
