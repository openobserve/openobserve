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

//! Pure rules behind the Incidents v2 columns of an incident: its similarity fingerprint, its
//! customer impact values and the onset detector that dates the start of impact.

use std::{collections::HashMap, ops::ControlFlow};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlparser::{
    ast::{
        BinaryOperator, Expr, GroupByExpr, Query, Select, SelectItem, SetExpr, Statement,
        TableFactor, Value, Visit, VisitMut, Visitor, VisitorMut,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use utoipa::ToSchema;

use super::Operator;
use crate::{meta::oncall::response::ResolutionCause, utils::sql::AGGREGATE_UDF_LIST};

/// Group keys a fingerprint reads; `env` is the fallback spelling of the environment group.
const SERVICE_KEY: &str = "service";
const ENV_KEYS: &[&str] = &["environment", "env"];
/// Consecutive buckets past the band that make a change point (design 2.12 step 3).
const ONSET_RUN: usize = 2;
const ONSET_MADS: f64 = 3.0;

/// Whether customers were affected, as a person states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CustomerImpact {
    Confirmed,
    None,
    Unknown,
}

impl CustomerImpact {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::None => "none",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ResolutionDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_cause: Option<ResolutionCause>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_impact: Option<CustomerImpact>,
}

impl ResolutionDetails {
    pub fn is_empty(&self) -> bool {
        self.resolution_cause.is_none()
            && self.resolution_note.is_none()
            && self.customer_impact.is_none()
    }
}

/// The way the alert's signal moves when things go wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnsetDirection {
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementLanguage {
    Sql,
    Promql,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryMeasurement {
    SqlRatio {
        numerator: String,
        denominator: String,
    },
    SqlValue {
        value: String,
        volume: String,
        direction: OnsetDirection,
    },
    PromqlValue {
        query: String,
        direction: OnsetDirection,
    },
    SqlRate {
        rate: String,
        volume: String,
    },
    Unsupported,
}

struct TimePredicateStripper;

impl VisitorMut for TimePredicateStripper {
    type Break = ();

    fn pre_visit_select(&mut self, select: &mut Select) -> ControlFlow<()> {
        if let Some(selection) = select.selection.take() {
            select.selection = conjuncts(&selection)
                .into_iter()
                .filter(|term| !is_time_predicate(term))
                .cloned()
                .reduce(|left, right| Expr::BinaryOp {
                    left: Box::new(left),
                    op: BinaryOperator::And,
                    right: Box::new(right),
                });
        }
        ControlFlow::Continue(())
    }
}

#[derive(Default)]
struct SingleQuery {
    seen: bool,
}

impl Visitor for SingleQuery {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        if std::mem::replace(&mut self.seen, true) {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

#[derive(Default)]
struct ProjectionAggregate {
    query_depth: usize,
}

impl Visitor for ProjectionAggregate {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        self.query_depth += 1;
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        self.query_depth -= 1;
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        if self.query_depth == 0
            && let Expr::Function(function) = expr
            && function.over.is_none()
            && AGGREGATE_UDF_LIST.contains(&function.name.to_string().to_lowercase().as_str())
        {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

/// Lowercase hex SHA-256 of `service=<v>\nenv=<v>`; `None` when the group names no service.
pub fn group_fingerprint(group_values: &serde_json::Value) -> Option<String> {
    let value = |key: &str| {
        group_values
            .get(key)
            .and_then(|v| v.as_str())
            .map(normalize)
            .filter(|v| !v.is_empty())
    };
    let service = value(SERVICE_KEY)?;
    let env = ENV_KEYS
        .iter()
        .find_map(|key| value(key))
        .unwrap_or_default();
    let digest = Sha256::digest(format!("service={service}\nenv={env}").as_bytes());
    Some(hex::encode(digest))
}

/// The first bucket of the run of two or more past median + 3 MAD in `direction` that is still
/// past it at the last bucket; a run that recovered before the alert fired is not its onset.
pub fn impact_onset(buckets: &[(i64, f64)], direction: OnsetDirection) -> Option<i64> {
    let values: Vec<f64> = buckets
        .iter()
        .map(|(_, v)| *v)
        .filter(|v| v.is_finite())
        .collect();
    let baseline = median(values.clone())?;
    let deviations: Vec<f64> = values.iter().map(|v| (v - baseline).abs()).collect();
    let mad = median(deviations.clone())?;
    // A mostly constant series has MAD 0, and any move off it would count; the mean keeps a band.
    let spread = if mad > 0.0 {
        mad
    } else {
        deviations.iter().sum::<f64>() / deviations.len() as f64
    };
    let past = |v: f64| match direction {
        OnsetDirection::Up => v > baseline + ONSET_MADS * spread,
        OnsetDirection::Down => v < baseline - ONSET_MADS * spread,
    };
    let run: Vec<i64> = buckets
        .iter()
        .rev()
        .take_while(|(_, v)| v.is_finite() && past(*v))
        .map(|(at, _)| *at)
        .collect();
    if run.len() < ONSET_RUN {
        return None;
    }
    run.last().copied()
}

/// Every `step` of `[start, end)` with its value from `series`, `empty` where it has none;
/// `start` sits on a step boundary, and a step that is not positive yields no steps.
pub fn fill_steps(
    series: &[(i64, f64)],
    start: i64,
    end: i64,
    step: i64,
    empty: f64,
) -> Vec<(i64, f64)> {
    let Ok(stride) = usize::try_from(step) else {
        return Vec::new();
    };
    if stride == 0 {
        return Vec::new();
    }
    let by_step: HashMap<i64, f64> = series
        .iter()
        .map(|(at, v)| (at - at.rem_euclid(step), *v))
        .collect();
    (start..end)
        .step_by(stride)
        .map(|at| (at, by_step.get(&at).copied().unwrap_or(empty)))
        .collect()
}

pub fn strip_time_predicates(query: &mut Query) {
    let _ = VisitMut::visit(query, &mut TimePredicateStripper);
}

pub fn classify_measurement(query: &str, language: MeasurementLanguage) -> QueryMeasurement {
    if language == MeasurementLanguage::Promql {
        return QueryMeasurement::PromqlValue {
            query: query.to_string(),
            direction: value_direction(query),
        };
    }
    let Some(mut query) = measurement_query(query) else {
        return QueryMeasurement::Unsupported;
    };
    strip_time_predicates(&mut query);
    let SetExpr::Select(select) = query.body.as_ref() else {
        return QueryMeasurement::Unsupported;
    };
    classify_select(&query, select)
}

pub fn recovery_alert_sql(
    sql: &str,
    aggregate: Option<(&str, Operator, f64)>,
) -> Option<(String, String)> {
    let query = measurement_query(sql)?;
    let SetExpr::Select(select) = query.body.as_ref() else {
        return None;
    };
    if !simple_recovery_select(&query, select) {
        return None;
    }
    let where_terms = select.selection.as_ref().map_or_else(Vec::new, conjuncts);
    let scope: Vec<_> = where_terms
        .iter()
        .copied()
        .filter(|term| !marks_bad_rows(term))
        .collect();
    let volume = measurement_sql(&query, select, "COUNT(*)", &scope, &[]);
    let groups = group_dimensions(select);
    if !matches!(&select.group_by, GroupByExpr::Expressions(expressions, _) if expressions.len() == groups.len())
    {
        return None;
    }
    let value = if let Some((column, operator, threshold)) = aggregate {
        let (expr, _) = select
            .projection
            .iter()
            .filter_map(aggregate_expr)
            .find(|(_, alias)| *alias == Some(column))?;
        if select
            .having
            .as_ref()
            .is_some_and(|having| !is_alert_having(having, expr, column, operator, threshold))
        {
            return None;
        }
        expr.to_string()
    } else if select.having.is_none()
        && groups.is_empty()
        && select.projection.iter().all(is_row_projection)
    {
        "COUNT(*)".to_owned()
    } else {
        return None;
    };
    Some((
        measurement_sql(&query, select, &value, &where_terms, &groups),
        volume,
    ))
}

pub fn has_grouped_projection(select: &Select) -> bool {
    match &select.group_by {
        GroupByExpr::All(_) => true,
        GroupByExpr::Expressions(expressions, _) => {
            !expressions.is_empty()
                || select
                    .projection
                    .iter()
                    .any(|item| aggregate_expr(item).is_some())
        }
    }
}

pub fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    })
}

/// Mirrors on-call routing's `normalize_value`, so a declare and an alert hash the same value.
fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

fn measurement_query(sql: &str) -> Option<Box<Query>> {
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
    let [Statement::Query(query)] = statements.as_mut_slice() else {
        return None;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return None;
    };
    (!select.from.is_empty() && select.into.is_none()).then(|| query.clone())
}

fn simple_recovery_select(query: &Query, select: &Select) -> bool {
    let [from] = select.from.as_slice() else {
        return false;
    };
    query.with.is_none()
        && query.limit_clause.is_none()
        && query.fetch.is_none()
        && query.pipe_operators.is_empty()
        && select.distinct.is_none()
        && select.top.is_none()
        && select.qualify.is_none()
        && select.prewhere.is_none()
        && select.lateral_views.is_empty()
        && matches!(&select.group_by, GroupByExpr::Expressions(_, modifiers) if modifiers.is_empty())
        && from.joins.is_empty()
        && matches!(from.relation, TableFactor::Table { args: None, .. })
        && Visit::visit(query, &mut SingleQuery::default()).is_continue()
}

fn is_row_projection(item: &SelectItem) -> bool {
    match item {
        SelectItem::Wildcard(_) | SelectItem::QualifiedWildcard(..) => true,
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => {
            matches!(expr, Expr::Identifier(_) | Expr::CompoundIdentifier(_))
        }
        _ => false,
    }
}

fn is_alert_having(
    having: &Expr,
    aggregate: &Expr,
    column: &str,
    operator: Operator,
    threshold: f64,
) -> bool {
    let Expr::BinaryOp { left, op, right } = unnest(having) else {
        return false;
    };
    let (forward, reversed) = match operator {
        Operator::GreaterThan => (BinaryOperator::Gt, BinaryOperator::Lt),
        Operator::GreaterThanEquals => (BinaryOperator::GtEq, BinaryOperator::LtEq),
        Operator::LessThan => (BinaryOperator::Lt, BinaryOperator::Gt),
        Operator::LessThanEquals => (BinaryOperator::LtEq, BinaryOperator::GtEq),
        _ => return false,
    };
    let matches_operands = |value: &Expr, bound: &Expr| {
        let value = unnest(value);
        (value.to_string() == aggregate.to_string() || column_name(value) == Some(column))
            && unnest(bound).to_string().parse::<f64>().ok() == Some(threshold)
    };
    (op == &forward && matches_operands(left, right))
        || (op == &reversed && matches_operands(right, left))
}

fn classify_select(query: &Query, select: &Select) -> QueryMeasurement {
    let terms = select.selection.as_ref().map_or_else(Vec::new, conjuncts);
    let groups = group_dimensions(select);
    let sql = |value: &str, filters: &[&Expr], groups: &[String]| {
        measurement_sql(query, select, value, filters, groups)
    };
    if select.from.len() == 1
        && select.from[0].joins.is_empty()
        && terms.iter().any(|term| marks_bad_rows(term))
    {
        let remaining: Vec<_> = terms
            .iter()
            .copied()
            .filter(|term| !marks_bad_rows(term))
            .collect();
        return QueryMeasurement::SqlRatio {
            numerator: sql("COUNT(*)", &terms, &[]),
            denominator: sql("COUNT(*)", &remaining, &[]),
        };
    }
    if let Some((aggregate, label)) = select.projection.iter().find_map(aggregate_expr) {
        let expression = aggregate.to_string();
        let direction = value_direction(label.unwrap_or(&expression));
        return QueryMeasurement::SqlValue {
            value: sql(&expression, &terms, &groups),
            volume: sql("COUNT(*)", &terms, &[]),
            direction,
        };
    }
    if terms.is_empty() {
        return QueryMeasurement::Unsupported;
    }
    QueryMeasurement::SqlRate {
        rate: sql("COUNT(*)", &terms, &[]),
        volume: sql(
            "COUNT(*)",
            &terms
                .iter()
                .copied()
                .filter(|term| is_scope_filter(term))
                .collect::<Vec<_>>(),
            &[],
        ),
    }
}

fn measurement_sql(
    query: &Query,
    select: &Select,
    value: &str,
    filters: &[&Expr],
    dimensions: &[String],
) -> String {
    let mut sql = String::new();
    if let Some(with) = &query.with {
        sql.push_str(&format!("{with} "));
    }
    let from = select
        .from
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    sql.push_str(&format!(
        "SELECT histogram(_timestamp, '1 minute') AS zo_onset_bucket,          MIN(_timestamp) AS zo_onset_at, {value} AS zo_onset_value FROM {}",
        from.join(", ")
    ));
    if !filters.is_empty() {
        let where_sql = filters
            .iter()
            .map(|term| format!("({term})"))
            .collect::<Vec<_>>();
        sql.push_str(&format!(" WHERE {}", where_sql.join(" AND ")));
    }
    sql.push_str(" GROUP BY zo_onset_bucket");
    for group in dimensions {
        sql.push_str(&format!(", {group}"));
    }
    sql.push_str(" ORDER BY zo_onset_bucket");
    sql
}

fn group_dimensions(select: &Select) -> Vec<String> {
    let GroupByExpr::Expressions(expressions, _) = &select.group_by else {
        return Vec::new();
    };
    expressions
        .iter()
        .map(|expr| group_expression(expr, &select.projection))
        .filter(|expr| !is_time_dimension(expr))
        .map(ToString::to_string)
        .collect()
}

fn group_expression<'a>(expr: &'a Expr, projections: &'a [SelectItem]) -> &'a Expr {
    if let Some(index) = expr
        .to_string()
        .parse::<usize>()
        .ok()
        .and_then(|n| n.checked_sub(1))
        && let Some(item) = projections.get(index)
        && let SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } = item
    {
        return expr;
    }
    if let Expr::Identifier(id) = expr {
        for item in projections {
            if let SelectItem::ExprWithAlias { expr, alias } = item
                && alias.value == id.value
            {
                return expr;
            }
        }
    }
    expr
}

fn aggregate_expr(item: &SelectItem) -> Option<(&Expr, Option<&str>)> {
    let (expr, label) = match item {
        SelectItem::UnnamedExpr(expr) => (expr, None),
        SelectItem::ExprWithAlias { expr, alias } => (expr, Some(alias.value.as_str())),
        _ => return None,
    };
    Visit::visit(expr, &mut ProjectionAggregate::default())
        .is_break()
        .then_some((expr, label))
}

fn value_direction(measurement: &str) -> OnsetDirection {
    measurement
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
        .find_map(|symbol| {
            let symbol = symbol.to_ascii_lowercase();
            if [
                "availability",
                "success_rate",
                "success_ratio",
                "throughput",
            ]
            .iter()
            .any(|name| symbol.contains(name))
            {
                Some(OnsetDirection::Down)
            } else if ["error", "failure", "latency"]
                .iter()
                .any(|name| symbol.contains(name))
            {
                Some(OnsetDirection::Up)
            } else {
                None
            }
        })
        .unwrap_or(OnsetDirection::Up)
}

fn is_scope_filter(expr: &Expr) -> bool {
    let Expr::BinaryOp { left, .. } = unnest(expr) else {
        return false;
    };
    column_name(left).is_some_and(|column| {
        ["service", "service_name", "env", "environment", "region"]
            .iter()
            .any(|scope| column.eq_ignore_ascii_case(scope))
    })
}

fn is_time_dimension(expr: &Expr) -> bool {
    column_name(expr).is_some_and(|name| name.eq_ignore_ascii_case(crate::TIMESTAMP_COL_NAME))
        || matches!(expr, Expr::Function(function)
            if matches!(function.name.to_string().to_lowercase().as_str(),
                "histogram" | "date_bin" | "date_trunc" | "time_bucket"))
}

fn marks_bad_rows(expr: &Expr) -> bool {
    if let Expr::Between {
        expr,
        negated: false,
        low,
        high,
    } = unnest(expr)
    {
        let is_number = |expr: &Expr, expected: &str| match unnest(expr) {
            Expr::Value(value) => matches!(&value.value, Value::Number(n, _) if n == expected),
            _ => false,
        };
        return column_name(expr).is_some_and(|name| name.eq_ignore_ascii_case("status_code"))
            && is_number(low, "500")
            && is_number(high, "599");
    }
    let Expr::BinaryOp { left, op, right } = unnest(expr) else {
        return false;
    };
    let Some(column) = column_name(left) else {
        return false;
    };
    let Expr::Value(literal) = unnest(right) else {
        return false;
    };
    match (column.to_ascii_lowercase().as_str(), op, &literal.value) {
        ("status_code", BinaryOperator::GtEq, Value::Number(number, _)) => number == "500",
        ("status_code", BinaryOperator::Gt, Value::Number(number, _)) => number == "499",
        (
            "level" | "status" | "span_status",
            BinaryOperator::Eq,
            Value::SingleQuotedString(value),
        ) => value.eq_ignore_ascii_case("error"),
        _ => false,
    }
}

fn is_time_predicate(expr: &Expr) -> bool {
    match unnest(expr) {
        Expr::Between {
            expr, low, high, ..
        } => is_timestamp(expr) && is_literal(low) && is_literal(high),
        Expr::BinaryOp {
            left,
            op:
                BinaryOperator::Gt
                | BinaryOperator::GtEq
                | BinaryOperator::Lt
                | BinaryOperator::LtEq
                | BinaryOperator::Eq
                | BinaryOperator::NotEq,
            right,
        } => (is_timestamp(left) && is_literal(right)) || (is_timestamp(right) && is_literal(left)),
        _ => false,
    }
}

fn is_literal(expr: &Expr) -> bool {
    matches!(unnest(expr), Expr::Value(_) | Expr::TypedString(_))
}

fn is_timestamp(expr: &Expr) -> bool {
    column_name(expr).is_some_and(|name| name.eq_ignore_ascii_case(crate::TIMESTAMP_COL_NAME))
}

fn column_name(expr: &Expr) -> Option<&str> {
    match unnest(expr) {
        Expr::Identifier(id) => Some(id.value.as_str()),
        Expr::CompoundIdentifier(ids) => ids.last().map(|id| id.value.as_str()),
        _ => None,
    }
}

fn conjuncts(expr: &Expr) -> Vec<&Expr> {
    match unnest(expr) {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            let mut terms = conjuncts(left);
            terms.extend(conjuncts(right));
            terms
        }
        _ => vec![expr],
    }
}

fn unnest(mut expr: &Expr) -> &Expr {
    while let Expr::Nested(inner) = expr {
        expr = inner;
    }
    expr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minutes(values: &[f64]) -> Vec<(i64, f64)> {
        values
            .iter()
            .enumerate()
            .map(|(i, v)| (i as i64, *v))
            .collect()
    }

    fn noisy(len: usize) -> Vec<f64> {
        (0..len).map(|i| 10.0 + (i % 3) as f64).collect()
    }

    #[test]
    fn mitigation_volume_excludes_the_server_error_range() {
        let sql = "SELECT * FROM logs WHERE service_name = 'orders'
                   AND status_code BETWEEN 500 AND 599";
        let (numerator, volume) = recovery_alert_sql(sql, None).unwrap();
        assert!(numerator.contains("status_code BETWEEN 500 AND 599"));
        assert!(volume.contains("service_name = 'orders'"));
        assert!(!volume.contains("status_code"));
    }

    #[test]
    fn mitigation_sql_keeps_scope_and_drops_threshold_having() {
        let sql = "SELECT AVG(latency) AS latency, host FROM logs
                   WHERE service_name = 'orders' AND level = 'error'
                   GROUP BY host HAVING AVG(latency) > 100";
        let (value, volume) =
            recovery_alert_sql(sql, Some(("latency", Operator::GreaterThan, 100.0))).unwrap();
        assert!(value.contains("AVG(latency)") && value.contains("GROUP BY zo_onset_bucket, host"));
        assert!(value.contains("level = 'error'"));
        assert!(!value.contains("HAVING"));
        assert!(volume.contains("service_name = 'orders'"));
        assert!(!volume.contains("level = 'error'"));
        assert!(recovery_alert_sql(sql, Some(("latency", Operator::GreaterThan, 200.0))).is_none());
        let reversed = sql.replace("AVG(latency) > 100", "100 < AVG(latency)");
        assert_eq!(
            recovery_alert_sql(&reversed, Some(("latency", Operator::GreaterThan, 100.0))),
            Some((value, volume))
        );
        assert!(
            recovery_alert_sql(&reversed, Some(("latency", Operator::LessThan, 100.0))).is_none()
        );
    }

    #[test]
    fn declare_measurement_prefers_the_bad_ratio_and_keeps_scope() {
        let query = "SELECT COUNT(*) FROM logs WHERE (_timestamp >= 100 AND env = 'prod') AND status_code >= 500";
        let QueryMeasurement::SqlRatio {
            numerator,
            denominator,
            ..
        } = classify_measurement(query, MeasurementLanguage::Sql)
        else {
            panic!("5xx predicates must be measured as a ratio");
        };
        assert!(numerator.contains("status_code >= 500"));
        assert!(!denominator.contains("status_code"));
        assert!(denominator.contains("env = 'prod'"));
        assert!(!denominator.contains("_timestamp >="));
    }

    #[test]
    fn declare_error_ratio_uses_all_service_rows_as_its_denominator() {
        let sql = "SELECT * FROM logs WHERE service = 'checkout'
                   AND status_code >= 500 AND level = 'error'";
        let QueryMeasurement::SqlRatio {
            numerator,
            denominator,
        } = classify_measurement(sql, MeasurementLanguage::Sql)
        else {
            panic!("expected an error ratio");
        };
        assert!(numerator.contains("status_code >= 500"));
        assert!(numerator.contains("level = 'error'"));
        assert!(denominator.contains("service = 'checkout'"));
        assert!(!denominator.contains("status_code") && !denominator.contains("level"));
    }

    #[test]
    fn declare_measurement_classifies_value_rate_and_unsupported() {
        for (query, language, expected) in [
            (
                "SELECT approx_percentile_cont(duration, 0.95) FROM traces",
                MeasurementLanguage::Sql,
                "value",
            ),
            (
                "sum(rate(requests_total[5m]))",
                MeasurementLanguage::Promql,
                "promql",
            ),
            (
                "SELECT * FROM logs WHERE message LIKE '%timeout%'",
                MeasurementLanguage::Sql,
                "rate",
            ),
            (
                "SELECT * FROM logs WHERE _timestamp > 1",
                MeasurementLanguage::Sql,
                "unsupported",
            ),
            (
                "SELECT * FROM logs",
                MeasurementLanguage::Sql,
                "unsupported",
            ),
        ] {
            let kind = match classify_measurement(query, language) {
                QueryMeasurement::SqlRatio { .. } => "ratio",
                QueryMeasurement::SqlValue { .. } => "value",
                QueryMeasurement::PromqlValue { .. } => "promql",
                QueryMeasurement::SqlRate { .. } => "rate",
                QueryMeasurement::Unsupported => "unsupported",
            };
            assert_eq!(kind, expected, "{query}");
        }
    }

    #[test]
    fn availability_measurements_get_worse_when_they_fall() {
        for (query, language) in [
            (
                "SELECT AVG(success) AS availability FROM logs",
                MeasurementLanguage::Sql,
            ),
            ("avg(http_success_ratio)", MeasurementLanguage::Promql),
        ] {
            match classify_measurement(query, language) {
                QueryMeasurement::SqlValue { direction, .. }
                | QueryMeasurement::PromqlValue { direction, .. } => {
                    assert_eq!(direction, OnsetDirection::Down);
                }
                other => panic!("expected value measurement, got {other:?}"),
            }
        }
    }

    #[test]
    fn a_flat_series_has_no_onset() {
        assert_eq!(impact_onset(&minutes(&[5.0; 60]), OnsetDirection::Up), None);
        assert_eq!(impact_onset(&minutes(&noisy(60)), OnsetDirection::Up), None);
        assert_eq!(impact_onset(&[], OnsetDirection::Up), None);
    }

    #[test]
    fn a_step_up_at_minute_fifty_is_the_onset() {
        let mut series = noisy(50);
        series.extend([100.0; 10]);
        assert_eq!(
            impact_onset(&minutes(&series), OnsetDirection::Up),
            Some(50)
        );
    }

    #[test]
    fn a_one_bucket_spike_is_not_a_change_point() {
        let mut series = noisy(60);
        series[40] = 500.0;
        series[55] = 500.0;
        assert_eq!(impact_onset(&minutes(&series), OnsetDirection::Up), None);
    }

    #[test]
    fn only_the_bad_direction_counts() {
        let mut drop = noisy(50);
        drop.extend([0.0; 10]);
        assert_eq!(impact_onset(&minutes(&drop), OnsetDirection::Up), None);
        assert_eq!(
            impact_onset(&minutes(&drop), OnsetDirection::Down),
            Some(50)
        );
    }

    #[test]
    fn a_mostly_zero_series_needs_a_real_move_off_zero() {
        let mut series = vec![0.0; 60];
        series[10] = 0.01;
        series[11] = 0.01;
        series[58] = 1.0;
        series[59] = 1.0;
        assert_eq!(
            impact_onset(&minutes(&series), OnsetDirection::Up),
            Some(58)
        );
        let mut drizzle = vec![0.0; 60];
        drizzle[20] = 5.0;
        drizzle[21] = 5.0;
        for value in &mut drizzle[57..] {
            *value = 0.01;
        }
        assert_eq!(
            impact_onset(&minutes(&drizzle), OnsetDirection::Up),
            None,
            "with MAD 0 a move far smaller than the hour's own swings is not an onset"
        );
        let mut errors = vec![0.0; 50];
        errors.extend([40.0; 10]);
        assert_eq!(
            impact_onset(&minutes(&errors), OnsetDirection::Up),
            Some(50)
        );
    }

    #[test]
    fn a_run_that_recovered_before_the_alert_is_not_the_onset() {
        let mut series = noisy(60);
        series[5] = 100.0;
        series[6] = 100.0;
        for value in &mut series[52..] {
            *value = 100.0;
        }
        assert_eq!(
            impact_onset(&minutes(&series), OnsetDirection::Up),
            Some(52)
        );
        series[59] = 10.0;
        assert_eq!(impact_onset(&minutes(&series), OnsetDirection::Up), None);
    }

    #[test]
    fn missing_steps_are_filled_so_gaps_break_a_run() {
        let series = [(5, 9.0), (40, 9.0), (41, 9.0)];
        let zeros = fill_steps(&series, 0, 42, 1, 0.0);
        assert_eq!(zeros.len(), 42);
        assert_eq!(zeros[5], (5, 9.0));
        assert_eq!(zeros[6], (6, 0.0));
        assert_eq!(
            impact_onset(&zeros, OnsetDirection::Up),
            Some(40),
            "minutes 5 and 40 are not neighbours"
        );
        let mut quiet = noisy(50);
        quiet.extend([0.0; 10]);
        let sparse: Vec<(i64, f64)> = minutes(&quiet).into_iter().take(50).collect();
        let filled = fill_steps(&sparse, 0, 60, 1, 0.0);
        assert_eq!(
            impact_onset(&filled, OnsetDirection::Down),
            Some(50),
            "traffic that stops is a drop, not missing data"
        );
        let no_value = fill_steps(&[(0, 1.0), (2, 1.0)], 0, 3, 1, f64::NAN);
        assert!(no_value[1].1.is_nan());
        let at_minutes = fill_steps(&[(65, 3.0)], 0, 180, 60, 0.0);
        assert_eq!(at_minutes, vec![(0, 0.0), (60, 3.0), (120, 0.0)]);
        assert!(fill_steps(&[(65, 3.0)], 0, 180, 0, 0.0).is_empty());
        assert!(fill_steps(&[(65, 3.0)], 0, 180, -60, 0.0).is_empty());
    }

    #[test]
    fn the_fingerprint_hashes_service_and_env_whatever_the_order_or_case() {
        let a = serde_json::json!({"service": "Checkout ", "environment": "prod", "host": "h1"});
        let b = serde_json::json!({"host": "h2", "environment": "PROD", "service": "checkout"});
        let fp = group_fingerprint(&a).unwrap();
        assert_eq!(Some(fp.clone()), group_fingerprint(&b));
        assert_eq!(fp.len(), 64);
        assert!(
            fp.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
        assert_eq!(
            fp,
            hex::encode(Sha256::digest(b"service=checkout\nenv=prod"))
        );
        let other_env = serde_json::json!({"service": "checkout", "env": "dev"});
        assert_ne!(group_fingerprint(&other_env), Some(fp));
    }

    #[test]
    fn no_service_means_no_fingerprint() {
        assert_eq!(group_fingerprint(&serde_json::json!({"env": "prod"})), None);
        assert_eq!(
            group_fingerprint(&serde_json::json!({"service": " "})),
            None
        );
    }
}
