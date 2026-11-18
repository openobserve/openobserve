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

//! What a library alert needs from a stream, read from its own query by syntax alone.

use std::{collections::BTreeSet, ops::ControlFlow};

use promql_parser::{
    label::MatchOp,
    parser::{Expr as PromExpr, LabelModifier, VectorSelector},
};
use serde_json::Value;
use sqlparser::{
    ast::{Expr, ObjectName, Query, SelectItem, SetExpr, TableFactor, Visit, Visitor},
    dialect::GenericDialect,
    parser::Parser,
};

/// A `__name__=~` pattern says something about one stream only past this literal prefix.
const MIN_PATTERN_PREFIX: usize = 3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum QueryKind {
    #[default]
    Promql,
    Sql,
    Filters,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Needs {
    pub kind: QueryKind,
    /// FROM/JOIN streams (SQL) or the alert's stream (filters), normalised.
    pub streams: BTreeSet<String>,
    /// Columns the query reads, minus aliases and the timestamp column.
    pub fields: BTreeSet<String>,
    pub metrics: BTreeSet<String>,
    /// `__name__=~` regex sources with a selective literal prefix.
    pub name_patterns: Vec<String>,
    /// Keys of positive matchers: the series must carry them.
    pub hard_labels: BTreeSet<String>,
    /// Keys of `by`/`on`/`group_*`: without them the query still runs, coarser.
    pub soft_labels: BTreeSet<String>,
    /// False when the query did not parse; such an entry is never suggested.
    pub parsed: bool,
}

/// Normalises a stream or field name the way the server names streams, for comparison.
pub fn normalize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == ':' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// The needs of one published alert file.
pub fn derive(file: &Value, timestamp_column: &str) -> Needs {
    let qc = file.get("query_condition");
    let qtype = qc.and_then(|q| q.get("type")).and_then(Value::as_str);
    if let Some(anomaly) = file.get("anomaly_config").filter(|v| v.is_object()) {
        return anomaly_needs(file, anomaly, timestamp_column);
    }
    match qtype {
        Some("promql") => promql_needs(str_at(qc, "promql").unwrap_or_default()),
        Some("sql") => sql_needs(str_at(qc, "sql").unwrap_or_default(), timestamp_column),
        _ => Needs::default(),
    }
}

fn str_at<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a str> {
    value?.get(key)?.as_str()
}

fn anomaly_needs(file: &Value, anomaly: &Value, timestamp_column: &str) -> Needs {
    let output = str_at(Some(anomaly), "detection_function_field").unwrap_or_default();
    if let Some(sql) = str_at(Some(anomaly), "custom_sql").filter(|s| !s.trim().is_empty()) {
        let mut needs = sql_needs(sql, timestamp_column);
        // In custom SQL the detection field names a SELECT alias, not a stream column.
        needs.fields.remove(&normalize(output));
        return needs;
    }
    let mut fields: BTreeSet<String> = anomaly
        .get("filters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|f| f.get("field").and_then(Value::as_str))
        .map(normalize)
        .collect();
    if !output.is_empty() {
        fields.insert(normalize(output));
    }
    fields.remove(&normalize(timestamp_column));
    Needs {
        kind: QueryKind::Filters,
        streams: str_at(Some(file), "stream_name")
            .map(normalize)
            .into_iter()
            .collect(),
        fields,
        parsed: true,
        ..Default::default()
    }
}

/// Metrics, name patterns and label keys from a PromQL expression's AST.
pub fn promql_needs(query: &str) -> Needs {
    let Ok(expr) = promql_parser::parser::parse(query) else {
        return Needs::default();
    };
    let mut needs = Needs {
        kind: QueryKind::Promql,
        parsed: true,
        ..Default::default()
    };
    let mut created = BTreeSet::new();
    walk_promql(&expr, &mut needs, &mut created);
    needs.hard_labels.retain(|l| !created.contains(l));
    needs.soft_labels.retain(|l| !created.contains(l));
    needs
}

fn walk_promql(expr: &PromExpr, needs: &mut Needs, created: &mut BTreeSet<String>) {
    match expr {
        PromExpr::VectorSelector(vs) => selector_needs(vs, needs),
        PromExpr::MatrixSelector(ms) => selector_needs(&ms.vs, needs),
        PromExpr::Aggregate(agg) => {
            if let Some(LabelModifier::Include(labels)) = agg.modifier.as_ref() {
                needs.soft_labels.extend(labels.labels.iter().cloned());
            }
            // count_values writes its result into the label its string parameter names.
            if let Some(PromExpr::StringLiteral(s)) = agg.param.as_deref() {
                created.insert(s.val.clone());
            }
            walk_promql(&agg.expr, needs, created);
        }
        PromExpr::Binary(bin) => {
            if let Some(modifier) = bin.modifier.as_ref() {
                if let Some(LabelModifier::Include(labels)) = modifier.matching.as_ref() {
                    needs.soft_labels.extend(labels.labels.iter().cloned());
                }
                if let Some(labels) = modifier.card.labels() {
                    needs.soft_labels.extend(labels.labels.iter().cloned());
                }
            }
            walk_promql(&bin.lhs, needs, created);
            walk_promql(&bin.rhs, needs, created);
        }
        PromExpr::Call(call) => {
            if matches!(call.func.name, "label_replace" | "label_join")
                && let Some(PromExpr::StringLiteral(dst)) = call.args.args.get(1).map(|a| &**a)
            {
                created.insert(dst.val.clone());
            }
            for arg in call.args.args.iter() {
                walk_promql(arg, needs, created);
            }
        }
        PromExpr::Unary(u) => walk_promql(&u.expr, needs, created),
        PromExpr::Paren(p) => walk_promql(&p.expr, needs, created),
        PromExpr::Subquery(s) => walk_promql(&s.expr, needs, created),
        _ => {}
    }
}

fn selector_needs(vs: &VectorSelector, needs: &mut Needs) {
    if let Some(name) = vs.name.as_deref() {
        needs.metrics.insert(normalize(name));
    }
    let matchers = vs
        .matchers
        .matchers
        .iter()
        .chain(vs.matchers.or_matchers.iter().flatten());
    for m in matchers {
        if m.name == "__name__" {
            match &m.op {
                MatchOp::Equal => {
                    needs.metrics.insert(normalize(&m.value));
                }
                MatchOp::Re(_) if literal_prefix(&m.value).len() >= MIN_PATTERN_PREFIX => {
                    needs.name_patterns.push(m.value.clone());
                }
                _ => {}
            }
            continue;
        }
        let positive = match &m.op {
            MatchOp::Equal => !m.value.is_empty(),
            MatchOp::Re(re) => !re.is_match(""),
            MatchOp::NotEqual | MatchOp::NotRe(_) => false,
        };
        if positive {
            needs.hard_labels.insert(m.name.clone());
        }
    }
}

fn literal_prefix(pattern: &str) -> &str {
    let end = pattern
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == ':'))
        .unwrap_or(pattern.len());
    &pattern[..end]
}

/// Streams and columns from a SQL query's AST.
pub fn sql_needs(sql: &str, timestamp_column: &str) -> Needs {
    let Ok(statements) = Parser::parse_sql(&GenericDialect {}, sql) else {
        return Needs::default();
    };
    let mut visitor = SqlNames::default();
    let _ = statements.visit(&mut visitor);
    let mut excluded = visitor.aliases;
    excluded.insert(normalize(timestamp_column));
    let streams: BTreeSet<String> = visitor
        .relations
        .into_iter()
        .filter(|r| !visitor.ctes.contains(r))
        .collect();
    let fields = visitor
        .columns
        .into_iter()
        .filter(|c| !excluded.contains(c) && !visitor.ctes.contains(c))
        .collect();
    Needs {
        kind: QueryKind::Sql,
        streams,
        fields,
        parsed: true,
        ..Default::default()
    }
}

#[derive(Default)]
struct SqlNames {
    relations: BTreeSet<String>,
    ctes: BTreeSet<String>,
    aliases: BTreeSet<String>,
    columns: BTreeSet<String>,
}

impl Visitor for SqlNames {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        if let Some(with) = query.with.as_ref() {
            self.ctes.extend(
                with.cte_tables
                    .iter()
                    .map(|c| normalize(&c.alias.name.value)),
            );
        }
        if let SetExpr::Select(select) = query.body.as_ref() {
            for item in select.projection.iter() {
                if let SelectItem::ExprWithAlias { alias, .. } = item {
                    self.aliases.insert(normalize(&alias.value));
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<()> {
        if let Some(last) = relation.0.last().and_then(|p| p.as_ident()) {
            self.relations.insert(normalize(&last.value));
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<()> {
        let alias = match factor {
            TableFactor::Table { alias, .. } | TableFactor::Derived { alias, .. } => alias.as_ref(),
            _ => None,
        };
        if let Some(alias) = alias {
            self.aliases.insert(normalize(&alias.name.value));
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        match expr {
            Expr::Identifier(ident) => {
                self.columns.insert(normalize(&ident.value));
            }
            Expr::CompoundIdentifier(idents) => {
                if let Some(last) = idents.last() {
                    self.columns.insert(normalize(&last.value));
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn promql_needs_by_syntax() {
        // (query, metrics, patterns, hard, soft)
        let cases: &[(&str, &[&str], &[&str], &[&str], &[&str])] = &[
            ("up == 0", &["up"], &[], &[], &[]),
            (
                r#"sum by (instance) (rate(http_errors_total{code=~"5.."}[5m])) / on (instance) group_left (job) sum by (instance) (rate(http_requests_total[5m]))"#,
                &["http_errors_total", "http_requests_total"],
                &[],
                &["code"],
                &["instance", "job"],
            ),
            (
                r#"{__name__=~"node_disk_.*", device!="", mode=~".*"} offset 5m"#,
                &[],
                &["node_disk_.*"],
                &[],
                &[],
            ),
            (r#"{__name__=~".+"}"#, &[], &[], &[], &[]),
            (
                r#"label_replace(kube_pod_info{namespace="x"}, "node2", "$1", "node", "(.*)") * on (node2) kube_node_info"#,
                &["kube_node_info", "kube_pod_info"],
                &[],
                &["namespace"],
                &[],
            ),
            (
                r#"sum without (pod) (rate(errors_total[1m])) and ignoring (pod) vector(1)"#,
                &["errors_total"],
                &[],
                &[],
                &[],
            ),
        ];
        for (query, metrics, patterns, hard, soft) in cases {
            let needs = promql_needs(query);
            assert!(needs.parsed, "{query}");
            assert_eq!(needs.metrics, set(metrics), "{query}");
            assert_eq!(needs.name_patterns, patterns.to_vec(), "{query}");
            assert_eq!(needs.hard_labels, set(hard), "{query}");
            assert_eq!(needs.soft_labels, set(soft), "{query}");
        }
        assert!(!promql_needs("sum(").parsed);
    }

    #[test]
    fn sql_needs_by_syntax() {
        // (sql, streams, fields)
        let cases: &[(&str, &[&str], &[&str])] = &[
            (
                r#"SELECT service_name, COUNT(*) AS calls, SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS error_pct FROM "default" WHERE gen_ai_operation_name IN ('chat') GROUP BY service_name HAVING COUNT(*) >= 20 ORDER BY error_pct"#,
                &["default"],
                &["gen_ai_operation_name", "service_name", "span_status"],
            ),
            (
                r#"WITH b AS (SELECT histogram(_timestamp, '5m') AS t, AVG(value) AS v FROM "cloud.metrics" WHERE timestamp > 0 GROUP BY t) SELECT t, SUM(v) AS total FROM b GROUP BY t"#,
                &["cloud_metrics"],
                &["timestamp", "value"],
            ),
            (
                "SELECT e.reason, COUNT(*) AS n FROM k8s_events AS e JOIN other o ON e.uid = o.uid GROUP BY e.reason",
                &["k8s_events", "other"],
                &["reason", "uid"],
            ),
        ];
        for (sql, streams, fields) in cases {
            let needs = sql_needs(sql, "_timestamp");
            assert!(needs.parsed, "{sql}");
            assert_eq!(needs.streams, set(streams), "{sql}");
            assert_eq!(needs.fields, set(fields), "{sql}");
        }
        assert!(!sql_needs("SELEC nothing", "_timestamp").parsed);
    }

    #[test]
    fn anomaly_files_read_their_own_shape() {
        let custom = serde_json::json!({
            "stream_name": "x",
            "anomaly_config": {"custom_sql": "SELECT histogram(_timestamp) AS b, AVG(latency) AS lat FROM x GROUP BY b", "detection_function_field": "lat"}
        });
        let needs = derive(&custom, "_timestamp");
        assert_eq!(
            (needs.kind, needs.fields),
            (QueryKind::Sql, set(&["latency"]))
        );

        let filters = serde_json::json!({
            "stream_name": "App.Logs",
            "anomaly_config": {"filters": [{"field": "level"}], "detection_function_field": "duration"}
        });
        let needs = derive(&filters, "_timestamp");
        assert_eq!(needs.kind, QueryKind::Filters);
        assert_eq!(
            (needs.streams, needs.fields),
            (set(&["app_logs"]), set(&["duration", "level"]))
        );
    }
}
