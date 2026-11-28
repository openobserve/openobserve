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

use sqlparser::{
    ast::{BinaryOperator, Expr, Value as SqlValue, visit_expressions},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::{ClaimScope, EvidenceItem, Hypothesis, Polarity, Strength, TimeWindow};
use crate::{
    meta::{
        oncall::confidence::{COMPARE_SERVICE_VERSIONS, SignalClass, ToolCallRecord},
        sql::single_stream,
    },
    utils::sql::quote_identifier,
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GradeTrust {
    pub super_cluster: bool,
    pub serving_region: Option<String>,
}

enum ServiceSelector {
    Covered,
    Unrelated,
    Unproven,
}

pub(crate) fn cited_change(reference: &str, record: &ToolCallRecord) -> bool {
    if record.signal != SignalClass::Change {
        return false;
    }
    let native = record.tool == COMPARE_SERVICE_VERSIONS;
    match native_reference(reference.trim()) {
        Some(Ok((service, version))) => {
            native
                && record
                    .coverage
                    .as_ref()
                    .and_then(|c| c.comparison.as_ref())
                    .is_some_and(|c| c.names(service, version))
        }
        Some(Err(())) => false,
        None => !native && record.reads_change(reference),
    }
}

pub(crate) fn effective_strength(item: &EvidenceItem, record: &ToolCallRecord) -> Strength {
    let Some(coverage) = record.coverage.as_ref() else {
        return if record.tool == COMPARE_SERVICE_VERSIONS {
            Strength::Supporting
        } else {
            item.strength
        };
    };
    let lead = coverage.insufficient == Some(true)
        || (record.tool == COMPARE_SERVICE_VERSIONS
            && !coverage
                .comparison
                .as_ref()
                .is_some_and(|c| c.is_decisive()));
    if lead {
        Strength::Supporting
    } else {
        item.strength
    }
}

pub(crate) fn independent_classes(decisive: &[&ToolCallRecord]) -> usize {
    let is_native = |r: &&&ToolCallRecord| r.tool == COMPARE_SERVICE_VERSIONS;
    let native: Vec<&ToolCallRecord> = decisive.iter().filter(is_native).copied().collect();
    let read_diff = decisive
        .iter()
        .any(|r| r.signal == SignalClass::Change && !is_native(&r));
    let mut classes: Vec<SignalClass> = Vec::new();
    if native.is_empty() || read_diff {
        for r in decisive {
            if !classes.contains(&r.signal) {
                classes.push(r.signal);
            }
        }
        return classes.len();
    }
    let sources: Vec<Option<&str>> = native
        .iter()
        .filter_map(|r| r.coverage.as_ref()?.comparison.as_ref())
        .flat_map(|c| c.decisive_metrics().map(|m| m.source.as_deref()))
        .collect();
    let overlaps = |r: &ToolCallRecord| {
        sources.iter().any(|source| match source {
            None => true,
            Some(source) => r
                .target
                .streams
                .iter()
                .any(|s| *source == format!("{}/{s}", r.signal.as_str())),
        })
    };
    classes.push(SignalClass::Change);
    for r in decisive {
        let corroborates = match r.signal {
            SignalClass::Metrics | SignalClass::Infra => true,
            SignalClass::Logs => !overlaps(r),
            _ => false,
        };
        if corroborates && !classes.contains(&r.signal) {
            classes.push(r.signal);
        }
    }
    classes.len()
}

pub(crate) fn rules_out(
    h: &Hypothesis,
    records: &[Option<&ToolCallRecord>],
    trust: &GradeTrust,
) -> bool {
    let usable: Vec<(&EvidenceItem, &ToolCallRecord)> = h
        .evidence
        .iter()
        .zip(records)
        .filter_map(|(item, record)| {
            let record = (*record)?;
            let ok = matches!(item.polarity, Polarity::RulesOut | Polarity::Contradicts)
                && effective_strength(item, record) == Strength::Decisive
                && record.signal.counts()
                && record.coverage.as_ref().is_some_and(|c| c.is_complete())
                && !(trust.super_cluster && is_runtime_read(record));
            ok.then_some((item, record))
        })
        .collect();
    usable.iter().any(|(item, _)| {
        let Some(scope) = item.claim_scope.as_ref() else {
            return false;
        };
        let windows: Vec<TimeWindow> = usable
            .iter()
            .filter(|(other, record)| {
                other
                    .claim_scope
                    .as_ref()
                    .is_some_and(|s| s.selectors_eq(scope))
                    && scope_selects(scope, record, trust)
            })
            .filter_map(|(_, record)| record.coverage.as_ref()?.effective_window)
            .collect();
        covers(windows, scope.start_us, scope.end_us)
    })
}

fn native_reference(reference: &str) -> Option<Result<(&str, &str), ()>> {
    if !reference.contains('@') || reference.contains(char::is_whitespace) {
        return None;
    }
    Some(match reference.split_once('@') {
        Some((service, version))
            if !service.is_empty() && !version.is_empty() && !version.contains('@') =>
        {
            Ok((service, version))
        }
        _ => Err(()),
    })
}

fn is_runtime_read(record: &ToolCallRecord) -> bool {
    matches!(
        record.signal,
        SignalClass::Logs | SignalClass::Metrics | SignalClass::Traces
    )
}

fn scope_selects(scope: &ClaimScope, record: &ToolCallRecord, trust: &GradeTrust) -> bool {
    let stream = scope
        .stream
        .as_deref()
        .is_none_or(|s| record.target.streams.iter().any(|t| t == s));
    let service = scope
        .service
        .as_deref()
        .is_none_or(|service| service_selected(record, service));
    let region = scope.region.as_deref().is_none_or(|r| {
        !trust.super_cluster && trust.serving_region.as_deref().is_none_or(|own| own == r)
    });
    stream && service && region
}

fn service_selected(record: &ToolCallRecord, service: &str) -> bool {
    if service.is_empty() {
        return false;
    }
    if record.tool == COMPARE_SERVICE_VERSIONS {
        return record
            .coverage
            .as_ref()
            .and_then(|coverage| coverage.comparison.as_ref())
            .is_some_and(|comparison| comparison.service == service);
    }
    let sql = if let Some(sql) = &record.target.sql {
        sql.clone()
    } else if let Some(filter) = &record.target.filter
        && let Some(stream) = record.target.streams.first()
    {
        format!("SELECT * FROM {} WHERE {filter}", quote_identifier(stream))
    } else {
        return false;
    };
    let Some(selection) = single_stream(&sql, None).and_then(|query| query.where_clause) else {
        return false;
    };
    let Ok(mut parser) = Parser::new(&PostgreSqlDialect {}).try_with_sql(&selection) else {
        return false;
    };
    parser
        .parse_expr()
        .is_ok_and(|expr| matches!(service_selector(&expr, service), ServiceSelector::Covered))
}

fn service_selector(expr: &Expr, service: &str) -> ServiceSelector {
    match expr {
        Expr::Nested(inner) => service_selector(inner, service),
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            match (
                service_selector(left, service),
                service_selector(right, service),
            ) {
                (ServiceSelector::Unproven, _) | (_, ServiceSelector::Unproven) => {
                    ServiceSelector::Unproven
                }
                (ServiceSelector::Covered, ServiceSelector::Covered)
                | (ServiceSelector::Covered, ServiceSelector::Unrelated)
                | (ServiceSelector::Unrelated, ServiceSelector::Covered) => {
                    ServiceSelector::Covered
                }
                (ServiceSelector::Unrelated, ServiceSelector::Unrelated) => {
                    ServiceSelector::Unrelated
                }
            }
        }
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Or,
            right,
        } => {
            match (
                service_selector(left, service),
                service_selector(right, service),
            ) {
                (ServiceSelector::Covered, ServiceSelector::Covered) => ServiceSelector::Covered,
                (ServiceSelector::Unrelated, ServiceSelector::Unrelated) => {
                    ServiceSelector::Unrelated
                }
                (ServiceSelector::Unproven, _)
                | (_, ServiceSelector::Unproven)
                | (ServiceSelector::Covered, ServiceSelector::Unrelated)
                | (ServiceSelector::Unrelated, ServiceSelector::Covered) => {
                    ServiceSelector::Unproven
                }
            }
        }
        Expr::BinaryOp {
            left,
            op: BinaryOperator::Eq,
            right,
        } if (service_column(left) && sql_string(right) == Some(service))
            || (service_column(right) && sql_string(left) == Some(service)) =>
        {
            ServiceSelector::Covered
        }
        Expr::InList {
            expr,
            list,
            negated: false,
        } if service_column(expr)
            && list.iter().all(|value| sql_string(value).is_some())
            && list.iter().any(|value| sql_string(value) == Some(service)) =>
        {
            ServiceSelector::Covered
        }
        _ => {
            if visit_expressions(expr, |part| {
                if service_column(part) {
                    ControlFlow::Break(())
                } else {
                    ControlFlow::Continue(())
                }
            })
            .is_break()
            {
                ServiceSelector::Unproven
            } else {
                ServiceSelector::Unrelated
            }
        }
    }
}

fn service_column(expr: &Expr) -> bool {
    let name = match expr {
        Expr::Identifier(id) => Some(id.value.as_str()),
        Expr::CompoundIdentifier(ids) => ids.last().map(|id| id.value.as_str()),
        _ => None,
    };
    name.is_some_and(|name| matches!(name, "service" | "service_name" | "service.name"))
}

fn sql_string(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Value(value) => match &value.value {
            SqlValue::SingleQuotedString(value) | SqlValue::DoubleQuotedString(value) => {
                Some(value)
            }
            _ => None,
        },
        _ => None,
    }
}

fn covers(mut windows: Vec<TimeWindow>, start: i64, end: i64) -> bool {
    if start > end {
        return false;
    }
    windows.sort_by_key(|w| w.start);
    let mut reached = start;
    for w in windows {
        if w.end < reached {
            continue;
        }
        if w.start > reached {
            return false;
        }
        if w.end >= end {
            return true;
        }
        reached = w.end.saturating_add(1);
    }
    false
}
