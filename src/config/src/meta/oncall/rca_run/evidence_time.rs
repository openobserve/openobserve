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

use std::{collections::BTreeMap, ops::ControlFlow};

use serde_json::Value;
use sqlparser::{
    ast::{Expr, GroupByExpr, OrderByKind, Query, SelectItem, SetExpr, Statement, Visit, Visitor},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::{
    EvidenceTarget,
    evidence::{decode_output, epoch_micros, text_micros},
};
use crate::{
    meta::{
        alerts::incident_fields::{OnsetDirection, impact_onset},
        oncall::confidence::is_prometheus_tool,
    },
    utils::sql::AGGREGATE_UDF_LIST,
};

#[derive(Default)]
struct TimeExpression {
    time: bool,
    bucket: bool,
    aggregate: bool,
    non_temporal_aggregate: bool,
}

impl Visitor for TimeExpression {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<Self::Break> {
        ControlFlow::Break(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Identifier(id) => self.time |= time_column(&id.value),
            Expr::CompoundIdentifier(ids) => {
                self.time |= ids.last().is_some_and(|id| time_column(&id.value));
            }
            Expr::Function(function) => {
                if function.over.is_some() {
                    return ControlFlow::Break(());
                }
                let name = function.name.to_string().to_ascii_lowercase();
                self.bucket |= matches!(
                    name.as_str(),
                    "histogram" | "date_bin" | "date_trunc" | "time_bucket"
                );
                let aggregate = AGGREGATE_UDF_LIST.contains(&name.as_str()) || name == "histogram";
                self.aggregate |= aggregate;
                self.non_temporal_aggregate |=
                    aggregate && !matches!(name.as_str(), "min" | "max" | "histogram");
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

#[derive(Default)]
struct SqlTimes {
    columns: Vec<String>,
    values: Vec<String>,
    ascending: bool,
    aggregated: bool,
    bucketed: bool,
}

impl SqlTimes {
    fn parse(sql: &str) -> Option<Self> {
        let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
        if statements.len() != 1 {
            return None;
        }
        let Statement::Query(query) = statements.pop()? else {
            return None;
        };
        let SetExpr::Select(select) = query.body.as_ref() else {
            return None;
        };
        let mut parsed = Self {
            aggregated: match &select.group_by {
                GroupByExpr::All(_) => true,
                GroupByExpr::Expressions(expressions, _) => !expressions.is_empty(),
            },
            ..Self::default()
        };
        for projection in &select.projection {
            let (expr, alias) = match projection {
                SelectItem::ExprWithAlias { expr, alias } => (expr, Some(alias.value.clone())),
                SelectItem::UnnamedExpr(expr) => (expr, None),
                _ => continue,
            };
            let mut found = TimeExpression::default();
            if expr.visit(&mut found).is_break() {
                continue;
            }
            let name = alias.unwrap_or_else(|| expr.to_string());
            parsed.aggregated |= found.aggregate;
            if found.time && !found.non_temporal_aggregate {
                parsed.columns.push(name);
                parsed.bucketed |= found.bucket;
            } else if found.aggregate {
                parsed.values.push(name);
            }
        }
        if let Some(order) = &query.order_by
            && let OrderByKind::Expressions(expressions) = &order.kind
            && let Some(first) = expressions.first()
        {
            let name = match &first.expr {
                Expr::Identifier(id) => Some(id.value.as_str()),
                Expr::CompoundIdentifier(ids) => ids.last().map(|id| id.value.as_str()),
                _ => None,
            };
            let temporal = name.is_some_and(|name| {
                time_column(name) || parsed.columns.iter().any(|column| column == name)
            });
            parsed.ascending = temporal && first.options.asc != Some(false);
            if temporal && first.options.asc == Some(false) {
                return None;
            }
        }
        Some(parsed)
    }

    fn row_time(&self, row: &Value) -> Option<i64> {
        row.as_object()?
            .iter()
            .filter(|(key, _)| time_column(key) || self.columns.contains(key))
            .filter_map(|(_, value)| timestamp(value))
            .min()
    }

    fn bucket_onset(&self, rows: &[Value], target: &EvidenceTarget) -> Option<i64> {
        let mut series = BTreeMap::<(Vec<(String, String)>, String), Vec<(i64, f64)>>::new();
        for row in rows {
            let Some(at) = self.row_time(row).filter(|at| in_window(*at, target)) else {
                continue;
            };
            let Some(fields) = row.as_object() else {
                continue;
            };
            let group: Vec<_> = fields
                .iter()
                .filter(|(key, _)| {
                    !time_column(key) && !self.columns.contains(key) && !self.values.contains(key)
                })
                .map(|(key, value)| (key.clone(), value.to_string()))
                .collect();
            for column in &self.values {
                if let Some(value) = fields.get(column).and_then(number) {
                    series
                        .entry((group.clone(), column.clone()))
                        .or_default()
                        .push((at, value));
                }
            }
        }
        series.into_values().filter_map(series_onset).min()
    }
}

pub(super) fn observed_from(tool: &str, output: &Value, target: &EvidenceTarget) -> Option<i64> {
    let body = decode_output(output);
    if is_prometheus_tool(tool) {
        return prometheus_onset(&body, target);
    }
    let parsed = SqlTimes::parse(target.sql.as_deref()?)?;
    if !parsed.ascending && !parsed.aggregated {
        return None;
    }
    let rows = result_rows(&body);
    if parsed.bucketed {
        return parsed.bucket_onset(&rows, target);
    }
    rows.iter()
        .filter_map(|row| parsed.row_time(row))
        .filter(|at| in_window(*at, target))
        .min()
}

fn time_column(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "_timestamp" | "timestamp" | "time"
    )
}

fn timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::String(text) => text_micros(text),
        Value::Number(number) => number.as_f64().and_then(epoch_micros),
        _ => None,
    }
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|value| value.is_finite())
}

fn in_window(at: i64, target: &EvidenceTarget) -> bool {
    target.start_us.is_none_or(|start| at >= start) && target.end_us.is_none_or(|end| at <= end)
}

fn result_rows(body: &Value) -> Vec<Value> {
    if let Some(rows) = body
        .get("hits")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty())
    {
        return rows.clone();
    }
    let Some(data) = body.get("data").and_then(Value::as_str) else {
        return Vec::new();
    };
    match body.get("format").and_then(Value::as_str) {
        Some("ndjson") => data
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect(),
        Some("csv") => tabular_rows(data.lines().filter_map(csv_cells)),
        Some("md_table") => tabular_rows(data.lines().filter_map(markdown_cells)),
        _ => Vec::new(),
    }
}

fn tabular_rows(mut rows: impl Iterator<Item = Vec<String>>) -> Vec<Value> {
    let Some(columns) = rows.next() else {
        return Vec::new();
    };
    rows.filter(|row| row.len() == columns.len())
        .map(|row| {
            Value::Object(
                columns
                    .iter()
                    .cloned()
                    .zip(row.into_iter().map(Value::String))
                    .collect(),
            )
        })
        .collect()
}

fn csv_cells(line: &str) -> Option<Vec<String>> {
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = line.trim_end_matches('\r').chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => cells.push(std::mem::take(&mut cell)),
            other => cell.push(other),
        }
    }
    if quoted {
        return None;
    }
    cells.push(cell);
    Some(cells)
}

fn markdown_cells(line: &str) -> Option<Vec<String>> {
    let line = line.trim().strip_prefix('|')?.strip_suffix('|')?;
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => cell.push(chars.next()?),
            '|' => cells.push(std::mem::take(&mut cell).trim().to_string()),
            other => cell.push(other),
        }
    }
    cells.push(cell.trim().to_string());
    if cells
        .iter()
        .all(|cell| cell.chars().all(|ch| matches!(ch, '-' | ':' | ' ')))
    {
        return None;
    }
    Some(cells)
}

fn series_onset(mut series: Vec<(i64, f64)>) -> Option<i64> {
    series.sort_by_key(|(at, _)| *at);
    impact_onset(&series, OnsetDirection::Up)
}

fn prometheus_onset(body: &Value, target: &EvidenceTarget) -> Option<i64> {
    let series = body
        .pointer("/data/result")
        .or_else(|| body.get("result"))?
        .as_array()?;
    series
        .iter()
        .filter_map(|series| {
            let values = series.get("values")?.as_array()?;
            let buckets = values
                .iter()
                .filter_map(|pair| {
                    let at = timestamp(pair.get(0)?)?;
                    let value = number(pair.get(1)?)?;
                    in_window(at, target).then_some((at, value))
                })
                .collect();
            series_onset(buckets)
        })
        .min()
}
