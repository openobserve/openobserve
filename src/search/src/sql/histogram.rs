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
        Cte, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Ident, Query, Select,
        SelectItem, SetExpr, Statement, TableFactor, Value, visit_expressions,
        visit_expressions_mut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::{RE_HISTOGRAM, visitor::histogram_interval::generate_histogram_interval};

/// Most query levels and relations walked to resolve one output column.
const OUTPUT_RESOLVE_BUDGET: usize = 256;

/// What pinning found in a statement's `histogram()` calls.
pub struct PinnedHistograms {
    pub changed: bool,
    /// Bucket offset in microseconds shared by every call; `None` when the calls disagree.
    pub offset: Option<i64>,
}

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

/// Replaces named zones by their offset at the request end, so partitions and deltas agree.
pub fn pin_histogram_timezone(
    sql: &mut String,
    timezone: &mut Option<String>,
    end_time: i64,
) -> Result<(), Error> {
    let end_time = pin_reference_time(end_time);
    pin_request_timezone(timezone, end_time);
    if !sql.to_ascii_lowercase().contains("histogram") {
        return Ok(());
    }
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|error| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(error.to_string())))?;
    let mut changed = false;
    for statement in &mut statements {
        changed |= pin_statement_timezones(statement, timezone.as_deref(), end_time)?.changed;
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

/// The instant named zones are resolved at; a request without an end means now.
pub fn pin_reference_time(end_time: i64) -> i64 {
    if end_time > 0 { end_time } else { now_micros() }
}

pub fn pin_request_timezone(timezone: &mut Option<String>, end_time: i64) {
    if let Some(tz) = timezone.as_deref()
        && let Some(fixed) = fixed_offset_of_named_zone(tz, end_time)
    {
        *timezone = Some(fixed);
    }
}

/// Pins every `histogram()` timezone in the statement; `timezone` is the request default.
pub fn pin_statement_timezones(
    statement: &mut Statement,
    timezone: Option<&str>,
    end_time: i64,
) -> Result<PinnedHistograms, Error> {
    let mut changed = false;
    let mut offsets = Vec::new();
    let result = visit_expressions_mut(statement, |expr| {
        match pin_histogram_call(expr, timezone, end_time) {
            Ok(Some((updated, offset))) => {
                changed |= updated;
                offsets.push(offset);
            }
            Ok(None) => {}
            Err(error) => return ControlFlow::Break(error),
        }
        ControlFlow::Continue(())
    });
    if let ControlFlow::Break(error) = result {
        return Err(error);
    }
    let first = offsets.first().copied().unwrap_or_default();
    Ok(PinnedHistograms {
        changed,
        offset: offsets
            .iter()
            .all(|offset| *offset == first)
            .then_some(first),
    })
}

/// Whether result column `column` of `sql` is a `histogram()` output, resolved level by level.
pub fn is_histogram_output(sql: &str, column: &str) -> bool {
    let Ok(mut statements) = Parser::parse_sql(&PostgreSqlDialect {}, sql) else {
        return false;
    };
    let Some(Statement::Query(query)) = statements.pop() else {
        return false;
    };
    let mut budget = OUTPUT_RESOLVE_BUDGET;
    query_output_is_histogram(&query, &[], column, &mut budget)
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

fn pin_histogram_call(
    expr: &mut Expr,
    timezone: Option<&str>,
    end_time: i64,
) -> Result<Option<(bool, i64)>, Error> {
    let Expr::Function(func) = expr else {
        return Ok(None);
    };
    if !func.name.to_string().eq_ignore_ascii_case("histogram") {
        return Ok(None);
    }
    let FunctionArguments::List(list) = &mut func.args else {
        return Ok(None);
    };
    let Some(arg) = list.args.get_mut(2) else {
        return timezone_offset_micros(timezone, end_time).map(|offset| Some((false, offset)));
    };
    let value = timezone_literal(arg).ok_or_else(|| {
        Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "histogram() timezone must be a constant string".to_string(),
        ))
    })?;
    let tz = value.clone().into_string().unwrap_or_default();
    let fixed = fixed_offset_of_named_zone(&tz, end_time);
    let offset = timezone_offset_micros(Some(fixed.as_deref().unwrap_or(&tz)), end_time)?;
    let changed = fixed.is_some();
    if let Some(fixed) = fixed {
        *value = Value::SingleQuotedString(fixed);
    }
    Ok(Some((changed, offset)))
}

fn timezone_literal(arg: &mut FunctionArg) -> Option<&mut Value> {
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

fn query_output_is_histogram<'a>(
    query: &'a Query,
    outer_ctes: &[&'a Cte],
    column: &str,
    budget: &mut usize,
) -> bool {
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    let mut ctes = outer_ctes.to_vec();
    if let Some(with) = &query.with {
        ctes.extend(with.cte_tables.iter());
    }
    set_expr_output_is_histogram(&query.body, &ctes, column, budget)
}

fn set_expr_output_is_histogram<'a>(
    body: &'a SetExpr,
    ctes: &[&'a Cte],
    column: &str,
    budget: &mut usize,
) -> bool {
    match body {
        SetExpr::Select(select) => select_output_is_histogram(select, ctes, column, budget),
        SetExpr::Query(query) => query_output_is_histogram(query, ctes, column, budget),
        // A set operation takes its column names from the left side.
        SetExpr::SetOperation { left, .. } => {
            set_expr_output_is_histogram(left, ctes, column, budget)
        }
        _ => false,
    }
}

fn select_output_is_histogram<'a>(
    select: &'a Select,
    ctes: &[&'a Cte],
    column: &str,
    budget: &mut usize,
) -> bool {
    let mut wildcard = false;
    for item in &select.projection {
        let expr = match item {
            SelectItem::ExprWithAlias { expr, alias } if ident_is(alias, column) => expr,
            SelectItem::UnnamedExpr(expr)
                if column_ref(expr).is_some_and(|(_, name)| ident_is(name, column)) =>
            {
                expr
            }
            SelectItem::Wildcard(_) | SelectItem::QualifiedWildcard(..) => {
                wildcard = true;
                continue;
            }
            _ => continue,
        };
        if has_histogram_call(expr) {
            return true;
        }
        return column_ref(expr).is_some_and(|(qualifier, name)| {
            relation_output_is_histogram(select, qualifier, &name.value, ctes, budget)
        });
    }
    wildcard && relation_output_is_histogram(select, None, column, ctes, budget)
}

fn relation_output_is_histogram<'a>(
    select: &'a Select,
    qualifier: Option<&Ident>,
    column: &str,
    ctes: &[&'a Cte],
    budget: &mut usize,
) -> bool {
    let factors = select.from.iter().flat_map(|from| {
        std::iter::once(&from.relation).chain(from.joins.iter().map(|j| &j.relation))
    });
    for factor in factors {
        let (alias, name) = match factor {
            TableFactor::Derived { alias, .. } => (alias.as_ref(), None),
            TableFactor::Table { alias, name, .. } => {
                (alias.as_ref(), name.0.last().and_then(|p| p.as_ident()))
            }
            _ => continue,
        };
        // Renamed alias columns hide the inner names; such a relation is treated as raw.
        if alias.is_some_and(|alias| !alias.columns.is_empty()) {
            continue;
        }
        let visible = alias.map(|alias| &alias.name).or(name);
        if qualifier.is_some_and(|q| visible.is_none_or(|v| !ident_is(v, &q.value))) {
            continue;
        }
        let found = match factor {
            TableFactor::Derived { subquery, .. } => {
                query_output_is_histogram(subquery, ctes, column, budget)
            }
            _ => name
                .and_then(|name| {
                    ctes.iter()
                        .rposition(|cte| ident_is(&cte.alias.name, &name.value))
                })
                .is_some_and(|i| {
                    query_output_is_histogram(&ctes[i].query, &ctes[..i], column, budget)
                }),
        };
        if found {
            return true;
        }
    }
    false
}

fn column_ref(expr: &Expr) -> Option<(Option<&Ident>, &Ident)> {
    match expr {
        Expr::Identifier(name) => Some((None, name)),
        Expr::CompoundIdentifier(parts) => match parts.as_slice() {
            [.., qualifier, name] => Some((Some(qualifier), name)),
            [name] => Some((None, name)),
            [] => None,
        },
        Expr::Nested(inner) => column_ref(inner),
        _ => None,
    }
}

fn has_histogram_call(expr: &Expr) -> bool {
    visit_expressions(expr, |expr| match expr {
        Expr::Function(f)
            if f.name
                .to_string()
                .trim_matches('"')
                .eq_ignore_ascii_case("histogram") =>
        {
            ControlFlow::Break(())
        }
        _ => ControlFlow::Continue(()),
    })
    .is_break()
}

fn ident_is(ident: &Ident, name: &str) -> bool {
    ident.value.eq_ignore_ascii_case(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timezone_histogram_output_resolves_per_query_level() {
        let inner = "SELECT _timestamp, histogram(_timestamp, '1 hour', '+05:30') AS ts FROM t";
        for (sql, column, expected) in [
            (
                "SELECT HISTOGRAM(_timestamp, '1 day', '+05:30') AS ts, count(*) FROM t GROUP BY ts".to_string(),
                "ts",
                true,
            ),
            (format!("SELECT ts AS bucket FROM ({inner}) AS q"), "bucket", true),
            (format!("SELECT \"ts\" AS bucket FROM ({inner}) AS q"), "bucket", true),
            (format!("SELECT q.ts AS bucket FROM ({inner}) AS q"), "bucket", true),
            (format!("SELECT * FROM ({inner}) AS q"), "ts", true),
            (format!("WITH h AS ({inner}) SELECT ts FROM h"), "ts", true),
            (
                "WITH t AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t) SELECT _timestamp FROM t".to_string(),
                "_timestamp",
                true,
            ),
            (format!("SELECT _timestamp AS ts FROM ({inner}) AS q ORDER BY ts"), "ts", false),
            (format!("SELECT q._timestamp AS ts FROM ({inner}) AS q"), "ts", false),
            (format!("SELECT _timestamp FROM ({inner}) AS q"), "_timestamp", false),
            (
                "SELECT _timestamp FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') >= to_timestamp_micros(0)".to_string(),
                "_timestamp",
                false,
            ),
            (
                "SELECT _timestamp AS ts FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') >= to_timestamp_micros(0)".to_string(),
                "ts",
                false,
            ),
        ] {
            assert_eq!(is_histogram_output(&sql, column), expected, "{sql}");
        }
    }

    #[test]
    fn timezone_histogram_output_cost_is_bounded() {
        let started = std::time::Instant::now();
        let mut nested = "SELECT _timestamp AS a, _timestamp AS b FROM t".to_string();
        for _ in 0..40 {
            nested = format!("SELECT a AS a, a AS b FROM ({nested}) AS q");
        }
        assert!(!is_histogram_output(&nested, "a"));
        let mut ctes = vec!["c0 AS (SELECT _timestamp AS a FROM t)".to_string()];
        for i in 1..30 {
            let prev = i - 1;
            ctes.push(format!(
                "c{i} AS (SELECT a FROM c{prev} x JOIN c{prev} y ON x.a = y.a)"
            ));
        }
        let joined = format!("WITH {} SELECT a FROM c29", ctes.join(", "));
        assert!(!is_histogram_output(&joined, "a"));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    fn pin_offset(sql: &str, timezone: Option<&str>, end_time: i64) -> Result<Option<i64>, Error> {
        let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut timezone = timezone.map(str::to_string);
        pin_request_timezone(&mut timezone, end_time);
        Ok(pin_statement_timezones(&mut statement, timezone.as_deref(), end_time)?.offset)
    }

    #[test]
    fn timezone_argument_must_be_a_string_literal() {
        for expression in [
            "CASE WHEN true THEN '+05:30' ELSE '-08:00' END",
            "CAST('+05:30' AS VARCHAR)",
            "concat('+05', ':30')",
            "_timestamp",
            "NULL",
        ] {
            let sql = format!("SELECT histogram(_timestamp, '1 day', {expression}) FROM t");
            assert!(
                pin_offset(&sql, Some("UTC"), 1_782_864_000_000_000).is_err(),
                "{expression}"
            );
        }
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
                pin_offset(sql, Some("-08:00"), JULY).unwrap(),
                Some(11 * HOUR / 2)
            );
        }
        let sql = "SELECT histogram(_timestamp, '1 day') FROM t";
        assert_eq!(
            pin_offset(sql, Some("-08:00"), JULY).unwrap(),
            Some(-8 * HOUR)
        );
        assert!(pin_offset(sql, Some("Invalid/Zone"), JULY).is_err());
        assert_eq!(
            pin_offset("SELECT 1 FROM t", Some("Invalid/Zone"), JULY).unwrap(),
            Some(0)
        );
        let sql = "SELECT histogram(_timestamp, '1 day', 'UTC') a, histogram(_timestamp, '1 day', '+05:30') b FROM t";
        assert_eq!(pin_offset(sql, None, JULY).unwrap(), None);

        let zone = "America/Los_Angeles";
        let mut sql =
            format!("SELECT histogram(_timestamp, '1 day', '{zone}') FROM t WHERE name = '{zone}'");
        let mut timezone = Some(zone.to_string());
        pin_histogram_timezone(&mut sql, &mut timezone, JULY).unwrap();
        assert!(
            sql.contains("histogram(_timestamp, '1 day', '-07:00')"),
            "{sql}"
        );
        assert!(sql.contains(&format!("WHERE name = '{zone}'")));
        assert_eq!(timezone.as_deref(), Some("-07:00"));
        let pinned = sql.clone();
        pin_histogram_timezone(&mut sql, &mut timezone, JANUARY).unwrap();
        assert_eq!(sql, pinned);
        assert_eq!(
            pin_offset(&sql, timezone.as_deref(), JANUARY).unwrap(),
            Some(-7 * HOUR)
        );

        let sql = "SELECT histogram(_timestamp, '1 day', 'Africa/Monrovia') FROM t";
        let mut pinned = sql.to_string();
        pin_histogram_timezone(&mut pinned, &mut None, 31_536_000_000_000).unwrap();
        assert_eq!(pinned, sql);
        assert_eq!(
            pin_offset(sql, None, 31_536_000_000_000).unwrap(),
            Some(-2_670_000_000)
        );
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
