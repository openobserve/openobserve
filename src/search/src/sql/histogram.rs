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
        Cte, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Ident, ObjectName, Query,
        Select, SelectItem, SelectItemQualifiedWildcardKind, SetExpr, Statement, TableAlias,
        TableFactor, Value, visit_expressions, visit_expressions_mut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::visitor::histogram_interval::generate_histogram_interval;

/// Most query levels and relations walked to resolve one output column.
const OUTPUT_RESOLVE_BUDGET: usize = 256;

/// A result column looked up by output name or, through an alias column list, by position.
#[derive(Clone)]
enum OutputColumn {
    Name(ColumnName),
    Index(usize),
}

/// An output name: the raw value the cache picker read, or an identifier folded by dialect rules.
#[derive(Clone)]
struct ColumnName {
    name: String,
    folded: bool,
}

impl ColumnName {
    fn raw(name: &str) -> Self {
        Self {
            name: name.to_string(),
            folded: false,
        }
    }

    fn from_ident(ident: &Ident) -> Self {
        Self {
            name: fold_ident(ident),
            folded: true,
        }
    }

    fn matches(&self, ident: &Ident) -> bool {
        if self.folded {
            fold_ident(ident) == self.name
        } else {
            ident.value == self.name
        }
    }
}

/// What pinning found in a statement's `histogram()` calls.
pub struct PinnedHistograms {
    pub changed: bool,
    /// Bucket offset in microseconds shared by every call; `None` when the calls disagree.
    pub offset: Option<i64>,
}

/// Sets every `histogram()` interval from the request, so execution buckets like the partitions.
pub fn handle_histogram(
    origin_sql: &mut String,
    q_time_range: (i64, i64),
    histogram_interval: i64,
) {
    if !origin_sql.to_ascii_lowercase().contains("histogram") {
        return;
    }
    let Ok(mut statements) = Parser::parse_sql(&PostgreSqlDialect {}, origin_sql) else {
        return;
    };
    let mut changed = false;
    for statement in &mut statements {
        let _ = visit_expressions_mut(statement, |expr| {
            changed |= set_histogram_interval(expr, q_time_range, histogram_interval);
            ControlFlow::<()>::Continue(())
        });
    }
    if changed {
        *origin_sql = statements
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ");
    }
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

/// Whether result column `column` of `sql` is a `histogram()` output; `None` when unresolvable.
pub fn is_histogram_output(sql: &str, column: &str) -> Option<bool> {
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
    let Statement::Query(query) = statements.pop()? else {
        return None;
    };
    let mut budget = OUTPUT_RESOLVE_BUDGET;
    let column = OutputColumn::Name(ColumnName::raw(column));
    query_output(&query, &[], &column, &mut budget)
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

fn timezone_offset_micros(timezone: Option<&str>, end_time: i64) -> Result<i64, Error> {
    let Some(tz) = timezone else {
        return Ok(0);
    };
    parse_timezone_to_offset_at(tz, end_time)
        .and_then(|offset| offset.checked_mul(1_000_000))
        .ok_or_else(|| Error::Message(format!("Invalid timezone in histogram(): '{tz}'")))
}

fn set_histogram_interval(
    expr: &mut Expr,
    q_time_range: (i64, i64),
    histogram_interval: i64,
) -> bool {
    let Expr::Function(func) = expr else {
        return false;
    };
    if !is_histogram_function(&func.name) {
        return false;
    }
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
) -> Result<Option<(bool, i64)>, Error> {
    let Expr::Function(func) = expr else {
        return Ok(None);
    };
    if !is_histogram_function(&func.name) {
        return Ok(None);
    }
    let FunctionArguments::List(list) = &mut func.args else {
        return Ok(None);
    };
    let Some(arg) = list.args.get_mut(2) else {
        return timezone_offset_micros(timezone, end_time).map(|offset| Some((false, offset)));
    };
    let value = string_literal(arg).ok_or_else(|| {
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

fn query_output<'a>(
    query: &'a Query,
    outer_ctes: &[&'a Cte],
    column: &OutputColumn,
    budget: &mut usize,
) -> Option<bool> {
    *budget = budget.checked_sub(1)?;
    let mut ctes = outer_ctes.to_vec();
    if let Some(with) = &query.with {
        ctes.extend(with.cte_tables.iter());
    }
    set_expr_output(&query.body, &ctes, column, budget)
}

fn set_expr_output<'a>(
    body: &'a SetExpr,
    ctes: &[&'a Cte],
    column: &OutputColumn,
    budget: &mut usize,
) -> Option<bool> {
    match body {
        SetExpr::Select(select) => select_output(select, ctes, column, budget),
        SetExpr::Query(query) => query_output(query, ctes, column, budget),
        // A set operation names its columns after the left side; every branch must agree.
        SetExpr::SetOperation { left, right, .. } => {
            let column = match column {
                OutputColumn::Index(_) => column.clone(),
                OutputColumn::Name(name) => OutputColumn::Index(output_index(left, name)?),
            };
            merge_outputs([
                set_expr_output(left, ctes, &column, budget),
                set_expr_output(right, ctes, &column, budget),
            ])
        }
        _ => None,
    }
}

fn select_output<'a>(
    select: &'a Select,
    ctes: &[&'a Cte],
    column: &OutputColumn,
    budget: &mut usize,
) -> Option<bool> {
    let is_wildcard = |item: &SelectItem| {
        matches!(
            item,
            SelectItem::Wildcard(_) | SelectItem::QualifiedWildcard(..)
        )
    };
    let name = match column {
        OutputColumn::Index(index) => {
            if select.projection.iter().any(is_wildcard) {
                return None;
            }
            return match select.projection.get(*index)? {
                SelectItem::UnnamedExpr(expr)
                | SelectItem::ExprWithAlias { expr, .. }
                | SelectItem::ExprWithAliases { expr, .. } => {
                    projected_expr_output(select, expr, ctes, budget)
                }
                _ => None,
            };
        }
        OutputColumn::Name(name) => name,
    };
    let mut matched = None;
    let mut wildcard_qualifiers = Vec::new();
    for item in &select.projection {
        let expr = match item {
            SelectItem::ExprWithAlias { expr, alias } if name.matches(alias) => expr,
            SelectItem::UnnamedExpr(expr)
                if column_ref(expr).is_some_and(|(_, ident)| name.matches(ident)) =>
            {
                expr
            }
            SelectItem::ExprWithAliases { expr, aliases }
                if aliases.iter().any(|alias| name.matches(alias)) =>
            {
                expr
            }
            SelectItem::Wildcard(_) => {
                wildcard_qualifiers.push(None);
                continue;
            }
            SelectItem::QualifiedWildcard(SelectItemQualifiedWildcardKind::ObjectName(q), _) => {
                wildcard_qualifiers.push(Some(q.0.last()?.as_ident()?));
                continue;
            }
            SelectItem::QualifiedWildcard(..) => return None,
            _ => continue,
        };
        // Two outputs with the same name make the column ambiguous.
        if matched.is_some() {
            return None;
        }
        matched = Some(expr);
    }
    if let Some(expr) = matched {
        return projected_expr_output(select, expr, ctes, budget);
    }
    if wildcard_qualifiers.is_empty() {
        return None;
    }
    merge_outputs(
        wildcard_qualifiers
            .into_iter()
            .map(|qualifier| relation_output(select, qualifier, name, ctes, budget)),
    )
}

fn projected_expr_output<'a>(
    select: &'a Select,
    expr: &Expr,
    ctes: &[&'a Cte],
    budget: &mut usize,
) -> Option<bool> {
    let expr = without_nesting(expr);
    if is_histogram_call(expr) {
        return Some(true);
    }
    if let Some((qualifier, name)) = column_ref(expr) {
        return relation_output(
            select,
            qualifier,
            &ColumnName::from_ident(name),
            ctes,
            budget,
        );
    }
    // Any other expression stays UTC only when every column it reads is UTC.
    for (qualifier, name) in expr_inputs(expr)? {
        let column = ColumnName::from_ident(&name);
        if relation_output(select, qualifier.as_ref(), &column, ctes, budget)? {
            return None;
        }
    }
    Some(false)
}

/// Position of output `name` in the leftmost select of `body`; wildcards make it unknown.
fn output_index(body: &SetExpr, name: &ColumnName) -> Option<usize> {
    let select = match body {
        SetExpr::Select(select) => select,
        SetExpr::Query(query) => return output_index(&query.body, name),
        SetExpr::SetOperation { left, .. } => return output_index(left, name),
        _ => return None,
    };
    let mut index = None;
    for (i, item) in select.projection.iter().enumerate() {
        let found = match item {
            SelectItem::ExprWithAlias { alias, .. } => name.matches(alias),
            SelectItem::UnnamedExpr(expr) => {
                column_ref(expr).is_some_and(|(_, ident)| name.matches(ident))
            }
            SelectItem::ExprWithAliases { aliases, .. } => {
                aliases.iter().any(|alias| name.matches(alias))
            }
            _ => return None,
        };
        if found {
            // Two outputs with the same name make the column ambiguous.
            if index.is_some() {
                return None;
            }
            index = Some(i);
        }
    }
    index
}

fn relation_output<'a>(
    select: &'a Select,
    qualifier: Option<&Ident>,
    column: &ColumnName,
    ctes: &[&'a Cte],
    budget: &mut usize,
) -> Option<bool> {
    let factors = select.from.iter().flat_map(|from| {
        std::iter::once(&from.relation).chain(from.joins.iter().map(|j| &j.relation))
    });
    let mut results = Vec::new();
    for factor in factors {
        let (alias, name) = match factor {
            TableFactor::Derived { alias, .. } => (alias.as_ref(), None),
            TableFactor::Table { alias, name, .. } => {
                (alias.as_ref(), name.0.last().and_then(|p| p.as_ident()))
            }
            _ => return None,
        };
        let visible = alias.map(|alias| &alias.name).or(name);
        if qualifier.is_some_and(|q| visible.is_none_or(|v| !same_ident(v, q))) {
            continue;
        }
        let Some(target) = aliased_column(alias, column) else {
            continue;
        };
        results.push(match factor {
            TableFactor::Derived { subquery, .. } => query_output(subquery, ctes, &target, budget),
            // A qualified name such as `logs.t` names the stream, never a CTE.
            _ => match cte_index(factor, name, ctes) {
                Some(i) => {
                    let Some(target) = cte_column(&ctes[i].alias, target) else {
                        continue;
                    };
                    query_output(&ctes[i].query, &ctes[..i], &target, budget)
                }
                None => Some(false),
            },
        });
    }
    merge_outputs(results)
}

fn cte_index(factor: &TableFactor, name: Option<&Ident>, ctes: &[&Cte]) -> Option<usize> {
    let TableFactor::Table { name: full, .. } = factor else {
        return None;
    };
    if full.0.len() != 1 {
        return None;
    }
    let name = name?;
    ctes.iter()
        .rposition(|cte| same_ident(&cte.alias.name, name))
}

/// Maps `column` through a relation's alias column list, when it has one.
fn aliased_column(alias: Option<&TableAlias>, column: &ColumnName) -> Option<OutputColumn> {
    match alias.filter(|alias| !alias.columns.is_empty()) {
        Some(alias) => alias
            .columns
            .iter()
            .position(|c| column.matches(&c.name))
            .map(OutputColumn::Index),
        None => Some(OutputColumn::Name(column.clone())),
    }
}

fn cte_column(alias: &TableAlias, column: OutputColumn) -> Option<OutputColumn> {
    match &column {
        OutputColumn::Name(name) => aliased_column(Some(alias), name),
        OutputColumn::Index(_) => Some(column),
    }
}

/// Agreeing relations decide; a disagreement or an unresolved relation is unknown.
fn merge_outputs(results: impl IntoIterator<Item = Option<bool>>) -> Option<bool> {
    let mut merged = None;
    for result in results {
        let value = result?;
        if merged.is_some_and(|m| m != value) {
            return None;
        }
        merged = Some(value);
    }
    merged
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

fn is_histogram_call(expr: &Expr) -> bool {
    matches!(expr, Expr::Function(f) if is_histogram_function(&f.name))
}

fn without_nesting(expr: &Expr) -> &Expr {
    match expr {
        Expr::Nested(inner) => without_nesting(inner),
        other => other,
    }
}

/// Columns an expression reads; a `histogram()` call or a subquery inside makes them unknown.
fn expr_inputs(expr: &Expr) -> Option<Vec<(Option<Ident>, Ident)>> {
    let mut inputs = Vec::new();
    let result = visit_expressions(expr, |expr| {
        if is_histogram_call(expr)
            || matches!(
                expr,
                Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. }
            )
        {
            return ControlFlow::Break(());
        }
        if let Some((qualifier, name)) = column_ref(expr) {
            inputs.push((qualifier.cloned(), name.clone()));
        }
        ControlFlow::Continue(())
    });
    result.is_continue().then_some(inputs)
}

/// An unquoted identifier folds like DataFusion does, ASCII only; a quoted one keeps its case.
fn fold_ident(ident: &Ident) -> String {
    if ident.quote_style.is_some() {
        ident.value.clone()
    } else {
        ident.value.to_ascii_lowercase()
    }
}

fn same_ident(a: &Ident, b: &Ident) -> bool {
    fold_ident(a) == fold_ident(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timezone_histogram_output_resolves_per_query_level() {
        let inner = "SELECT _timestamp, histogram(_timestamp, '1 hour', '+05:30') AS ts FROM t";
        let bucket = "SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t";
        let shifted = format!("{bucket} LIMIT 1");
        for (sql, column, expected) in [
            (
                "SELECT HISTOGRAM(_timestamp, '1 day', '+05:30') AS ts, count(*) FROM t GROUP BY ts".to_string(),
                "ts",
                Some(true),
            ),
            (format!("SELECT ts AS bucket FROM ({inner}) AS q"), "bucket", Some(true)),
            (format!("SELECT \"ts\" AS bucket FROM ({inner}) AS q"), "bucket", Some(true)),
            (format!("SELECT q.ts AS bucket FROM ({inner}) AS q"), "bucket", Some(true)),
            (format!("SELECT * FROM ({inner}) AS q"), "ts", Some(true)),
            (format!("SELECT q.* FROM ({inner}) AS q"), "ts", Some(true)),
            (format!("WITH h AS ({inner}) SELECT ts FROM h"), "ts", Some(true)),
            (
                "WITH t AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t) SELECT _timestamp FROM t".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                "WITH h(bucket) AS (SELECT histogram(_timestamp, '1 day', '+05:30') AS ts FROM t) SELECT bucket AS _timestamp FROM h".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                format!("SELECT bucket AS _timestamp FROM ({inner}) AS h(raw, bucket)"),
                "_timestamp",
                Some(true),
            ),
            (
                format!("SELECT raw AS _timestamp FROM ({inner}) AS h(raw, bucket)"),
                "_timestamp",
                Some(false),
            ),
            (
                format!("SELECT raw.* FROM t AS raw CROSS JOIN ({shifted}) AS h"),
                "_timestamp",
                Some(false),
            ),
            (
                format!("SELECT h.* FROM t AS raw CROSS JOIN ({shifted}) AS h"),
                "_timestamp",
                Some(true),
            ),
            (
                format!("SELECT * FROM t AS raw CROSS JOIN ({shifted}) AS h"),
                "_timestamp",
                None,
            ),
            (
                format!("SELECT bucket FROM (SELECT * FROM ({inner}) AS q) AS h(raw, bucket)"),
                "bucket",
                None,
            ),
            (format!("SELECT _timestamp AS ts FROM ({inner}) AS q ORDER BY ts"), "ts", Some(false)),
            (format!("SELECT q._timestamp AS ts FROM ({inner}) AS q"), "ts", Some(false)),
            (format!("SELECT _timestamp FROM ({inner}) AS q"), "_timestamp", Some(false)),
            (
                "SELECT _timestamp FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') >= to_timestamp_micros(0)".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "SELECT _timestamp AS ts FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') >= to_timestamp_micros(0)".to_string(),
                "ts",
                Some(false),
            ),
            (
                "SELECT (histogram(_timestamp, '1 hour', '+05:30')) AS ts FROM t".to_string(),
                "ts",
                Some(true),
            ),
            (
                "SELECT max(_timestamp) AS _timestamp FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') > to_timestamp_micros(0)".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "SELECT to_timestamp_micros(_timestamp) AS ts FROM t".to_string(),
                "ts",
                Some(false),
            ),
            (
                "SELECT CASE WHEN histogram(_timestamp, '1 hour', '+05:30') IS NULL THEN _timestamp ELSE _timestamp END AS _timestamp FROM t ORDER BY _timestamp".to_string(),
                "_timestamp",
                None,
            ),
            (
                "SELECT to_timestamp_micros(histogram(_timestamp, '1 hour', '+05:30')) AS ts FROM t".to_string(),
                "ts",
                None,
            ),
            (format!("SELECT ts + 1 AS ts FROM ({inner}) AS q"), "ts", None),
            (
                "SELECT (SELECT max(_timestamp) FROM t) AS ts FROM t".to_string(),
                "ts",
                None,
            ),
            (
                "SELECT name FROM t WHERE histogram(_timestamp, '1 hour', '+05:30') > to_timestamp_micros(0)".to_string(),
                "_timestamp",
                None,
            ),
            (
                format!("SELECT _timestamp FROM ({bucket} UNION ALL SELECT to_timestamp_micros(_timestamp) AS _timestamp FROM t) AS q"),
                "_timestamp",
                None,
            ),
            (
                format!("SELECT _timestamp FROM ({bucket} UNION ALL {bucket}) AS q"),
                "_timestamp",
                Some(true),
            ),
            (
                "SELECT _timestamp FROM (SELECT _timestamp FROM t UNION ALL SELECT _timestamp FROM t) AS q".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "SELECT \"TS\" AS _timestamp FROM (SELECT histogram(_timestamp, '1 hour', '+05:30') AS ts, _timestamp AS \"TS\" FROM t) AS q ORDER BY _timestamp".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "SELECT ts AS _timestamp FROM (SELECT histogram(_timestamp, '1 hour', '+05:30') AS \"TS\", _timestamp AS ts FROM t) AS q".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "SELECT \"TS\" AS _timestamp FROM (SELECT histogram(_timestamp, '1 hour', '+05:30') AS \"TS\", _timestamp AS ts FROM t) AS q".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                "SELECT TS AS _timestamp FROM (SELECT histogram(_timestamp, '1 hour', '+05:30') AS \"ts\" FROM t) AS q".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                "SELECT histogram(_timestamp, '1 hour', '+05:30') AS ts, _timestamp AS \"TS\" FROM t".to_string(),
                "TS",
                Some(false),
            ),
            (
                "SELECT histogram(_timestamp, '1 hour', '+05:30') AS ts, _timestamp AS \"TS\" FROM t".to_string(),
                "ts",
                Some(true),
            ),
            (
                "SELECT histogram(_timestamp, '1 hour', '+05:30') AS ts, _timestamp AS ts FROM t".to_string(),
                "ts",
                None,
            ),
            (
                "WITH t AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t) SELECT _timestamp FROM logs.t".to_string(),
                "_timestamp",
                Some(false),
            ),
            (
                "WITH t AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t) SELECT _timestamp FROM t".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                "SELECT \"histogram\"(_timestamp, '1 hour', '+05:30') AS ts FROM t".to_string(),
                "ts",
                Some(true),
            ),
            (
                "WITH \"ω\" AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t), Ω AS (SELECT _timestamp FROM t) SELECT _timestamp FROM \"ω\"".to_string(),
                "_timestamp",
                Some(true),
            ),
            (
                "WITH \"ω\" AS (SELECT histogram(_timestamp, '1 hour', '+05:30') AS _timestamp FROM t), Ω AS (SELECT _timestamp FROM t) SELECT _timestamp FROM Ω".to_string(),
                "_timestamp",
                Some(false),
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
            match is_histogram_output(&nested, "a") {
                Some(false) => {}
                // Deeper nesting than the parser accepts is unknown; the parser sets the depth.
                None => {
                    assert!(Parser::parse_sql(&PostgreSqlDialect {}, &nested).is_err());
                    break;
                }
                Some(true) => panic!("{nested}"),
            }
        }
        let mut ctes = vec!["c0 AS (SELECT _timestamp AS a FROM t)".to_string()];
        for i in 1..30 {
            let prev = i - 1;
            ctes.push(format!(
                "c{i} AS (SELECT a FROM c{prev} x JOIN c{prev} y ON x.a = y.a)"
            ));
        }
        let joined = format!("WITH {} SELECT a FROM c29", ctes.join(", "));
        // 2^30 resolution paths exhaust the step budget, so the column is unknown, not UTC.
        assert_eq!(is_histogram_output(&joined, "a"), None);
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
    fn timezone_quoted_histogram_name_is_pinned() {
        let end = 1_752_000_000_000_000;
        let sql = "SELECT \"histogram\"(_timestamp, '1 hour', 'Asia/Kolkata') AS ts FROM t";
        assert_eq!(pin_offset(sql, None, end).unwrap(), Some(19_800_000_000));
        let sql = "SELECT HISTOGRAM(_timestamp, '1 hour') AS ts FROM t";
        assert_eq!(
            pin_offset(sql, Some("-08:00"), end).unwrap(),
            Some(-28_800_000_000)
        );
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
                format!("SELECT histogram(_timestamp, '3600 second', '{timezone}') FROM t")
            );
        }
    }

    #[test]
    fn timezone_interval_normalization_follows_the_ast() {
        let cases = [
            (
                "SELECT \"histogram\"(_timestamp, '1 day', '+05:30') AS ts, count(*) FROM t GROUP BY ts",
                "SELECT \"histogram\"(_timestamp, '3600 second', '+05:30') AS ts, count(*) FROM t GROUP BY ts",
            ),
            (
                "SELECT \"histogram\" (_timestamp, '1 day', '+05:30') AS ts, count(*) FROM t GROUP BY ts",
                "SELECT \"histogram\"(_timestamp, '3600 second', '+05:30') AS ts, count(*) FROM t GROUP BY ts",
            ),
            (
                "SELECT HISTOGRAM /* bucket */ (_timestamp, '1 day') AS ts, count(*) FROM t GROUP BY ts",
                "SELECT HISTOGRAM(_timestamp, '3600 second') AS ts, count(*) FROM t GROUP BY ts",
            ),
            (
                "SELECT histogram(_timestamp) AS ts, count(*) FROM t GROUP BY ts",
                "SELECT histogram(_timestamp, '3600 second') AS ts, count(*) FROM t GROUP BY ts",
            ),
            (
                "SELECT ts, n FROM (SELECT histogram(_timestamp, (('1 day'))) AS ts, count(*) AS n FROM t GROUP BY ts) WHERE n > 0",
                "SELECT ts, n FROM (SELECT histogram(_timestamp, '3600 second') AS ts, count(*) AS n FROM t GROUP BY ts) WHERE n > 0",
            ),
            (
                "SELECT histogram(_timestamp, '1 day') AS a, histogram(_timestamp, '2 day') AS b FROM t GROUP BY a, b",
                "SELECT histogram(_timestamp, '3600 second') AS a, histogram(_timestamp, '3600 second') AS b FROM t GROUP BY a, b",
            ),
        ];
        for (input, expected) in cases {
            let mut sql = input.to_string();
            handle_histogram(&mut sql, (0, 0), 3600);
            assert_eq!(sql, expected, "{input}");
        }
    }

    #[test]
    fn timezone_interval_normalization_keeps_untouched_sql_verbatim() {
        let untouched = [
            "SELECT   histogram(_timestamp, '3600 second')  FROM t",
            "SELECT   histogram(_timestamp, '1 day')  FROM t",
            "SELECT   count(*) FROM t WHERE kind = 'histogram'",
            "SELECT histogram(_timestamp, '1 day') FROM",
        ];
        for input in untouched {
            let mut sql = input.to_string();
            handle_histogram(
                &mut sql,
                (0, 0),
                if input.contains("3600") { 3600 } else { 0 },
            );
            assert_eq!(sql, input, "{input}");
        }
        let mut sql = "SELECT histogram(_timestamp) FROM t".to_string();
        handle_histogram(&mut sql, (0, 3_600_000_000), 0);
        assert_eq!(
            sql,
            format!(
                "SELECT histogram(_timestamp, '{}') FROM t",
                super::generate_histogram_interval((0, 3_600_000_000))
            )
        );
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
