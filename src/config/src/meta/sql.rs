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

use std::{
    collections::{HashMap, HashSet},
    ops::ControlFlow,
    sync::LazyLock,
};

use datafusion::sql::{TableReference, parser::DFParser, resolve::resolve_table_references};
use serde::{Deserialize, Serialize};
use sqlparser::{
    ast::{
        BinaryOperator, Expr, ObjectName, ObjectNamePart, Select, SelectItem, SetExpr, Statement,
        TableFactor, TableWithJoins, Visit, VisitMut, Visitor, VisitorMut,
    },
    dialect::PostgreSqlDialect,
    keywords::ALL_KEYWORDS,
    parser::Parser,
};
use utoipa::ToSchema;

use super::stream::StreamType;

pub const MAX_LIMIT: i64 = 100000;
pub const MAX_OFFSET: i64 = 100000;
const MAX_WHERE_SQL_BYTES: usize = 128 * 1024;

pub static SQL_RESERVED_KEYWORDS: LazyLock<Vec<String>> = LazyLock::new(|| {
    ALL_KEYWORDS
        .iter()
        .filter(|kw| is_reserved_identifier(kw))
        .map(|kw| kw.to_ascii_lowercase())
        .collect()
});

fn is_reserved_identifier(keyword: &str) -> bool {
    let quoted = format!("SELECT \"{keyword}\" FROM t");
    let unquoted = format!("SELECT {keyword} FROM t");
    parses_as_identifier(&quoted, keyword) && !parses_as_identifier(&unquoted, keyword)
}

fn parses_as_identifier(sql: &str, keyword: &str) -> bool {
    Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .ok()
        .and_then(|mut s| s.pop())
        .and_then(|s| extract_projection_identifier(&s))
        .is_some_and(|id| id.eq_ignore_ascii_case(keyword))
        && DFParser::parse_sql_with_dialect(sql, &PostgreSqlDialect {})
            .ok()
            .and_then(|mut s| s.pop_front())
            .is_some()
}

fn extract_projection_identifier(stmt: &Statement) -> Option<String> {
    match stmt {
        Statement::Query(q) => match q.body.as_ref() {
            SetExpr::Select(s) => s.projection.first().and_then(|item| match item {
                SelectItem::UnnamedExpr(e) | SelectItem::ExprWithAlias { expr: e, .. } => match e {
                    Expr::Identifier(id) => Some(id.value.clone()),
                    Expr::CompoundIdentifier(ids) if ids.len() == 1 => Some(ids[0].value.clone()),
                    _ => None,
                },
                _ => None,
            }),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrderBy {
    #[default]
    Desc,
    Asc,
}

pub fn sql_reserved_keywords() -> &'static [String] {
    SQL_RESERVED_KEYWORDS.as_slice()
}

/// get stream name from a sql
pub fn resolve_stream_names(sql: &str) -> Result<Vec<String>, anyhow::Error> {
    let dialect = &PostgreSqlDialect {};
    let statement = DFParser::parse_sql_with_dialect(sql, dialect)?
        .pop_back()
        .ok_or(anyhow::anyhow!("Failed to parse sql"))?;
    let (table_refs, _) = resolve_table_references(&statement, true)?;
    let mut tables = Vec::new();
    for table in table_refs {
        tables.push(table.table().to_string());
    }
    Ok(tables)
}

pub fn resolve_stream_names_with_type(sql: &str) -> Result<Vec<TableReference>, anyhow::Error> {
    let dialect = &PostgreSqlDialect {};
    let statement = DFParser::parse_sql_with_dialect(sql, dialect)?
        .pop_back()
        .ok_or(anyhow::anyhow!("Failed to parse sql"))?;
    let (table_refs, _) = resolve_table_references(&statement, true)?;
    let mut tables = Vec::new();
    for table in table_refs {
        tables.push(table);
    }
    Ok(tables)
}

/// Both forms of a query's WHERE, produced from a single parse.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct WhereInfo {
    /// Top-level (outer, for CTEs) WHERE as a string, verbatim; "" if none.
    pub where_clause: String,
    /// Per-stream WHERE for a JOIN (`{stream -> scoped WHERE}`, alias-stripped);
    /// empty for non-joins.
    pub where_by_stream: HashMap<String, String>,
}

/// Parse `sql` once and return both the full outer WHERE (single-stream base filter)
/// and the per-stream join WHERE. "" / empty for no-WHERE / unparseable.
pub fn extract_where(sql: &str) -> WhereInfo {
    let mut info = WhereInfo::default();
    // Reject pathologically large input before any recursive traversal (parse, Display, visitors).
    if sql.len() > MAX_WHERE_SQL_BYTES {
        return info;
    }
    let dialect = PostgreSqlDialect {};
    let Ok(statements) = Parser::parse_sql(&dialect, sql) else {
        return info;
    };
    for statement in statements {
        if let Statement::Query(query) = statement {
            // Full outer WHERE, verbatim (single-stream panels use this directly).
            if let Some(w) = where_from_set_expr(query.body.as_ref()) {
                info.where_clause = w;
            }
            // Per-stream WHERE — only for joins (2+ streams).
            if let Some(select) = outer_select(query.body.as_ref())
                && let Some(selection) = &select.selection
            {
                let (alias_to_stream, streams) = from_streams(&select.from);
                if streams.len() >= 2 {
                    let conjuncts = split_and(selection);
                    for stream in &streams {
                        // Keep conjuncts whose referenced streams ⊆ {stream} (empty set =
                        // unqualified columns, kept for every stream), then strip qualifiers.
                        let kept: Vec<String> = conjuncts
                            .iter()
                            .filter(|c| {
                                conjunct_streams(c, &alias_to_stream)
                                    .iter()
                                    .all(|s| s == stream)
                            })
                            .map(|c| {
                                let mut e = (*c).clone();
                                let _ = VisitMut::visit(&mut e, &mut QualifierStripper);
                                e.to_string()
                            })
                            .collect();
                        if !kept.is_empty() {
                            info.where_by_stream
                                .insert(stream.clone(), kept.join(" AND "));
                        }
                    }
                }
            }
            return info;
        }
    }
    info
}

/// WHERE of a query body, unwrapping parenthesized SELECT; None for UNION/set-ops.
fn where_from_set_expr(body: &SetExpr) -> Option<String> {
    match body {
        SetExpr::Select(select) => select.selection.as_ref().map(|e| e.to_string()),
        SetExpr::Query(query) => where_from_set_expr(query.body.as_ref()),
        _ => None,
    }
}

/// Innermost SELECT of a body, unwrapping parenthesized queries.
fn outer_select(body: &SetExpr) -> Option<&Select> {
    match body {
        SetExpr::Select(select) => Some(select),
        SetExpr::Query(query) => outer_select(query.body.as_ref()),
        _ => None,
    }
}

/// Last identifier of an object name (the stream/table name).
fn object_name_last(name: &ObjectName) -> String {
    match name.0.last() {
        Some(ObjectNamePart::Identifier(id)) => id.value.clone(),
        _ => String::new(),
    }
}

/// (alias/table -> stream, distinct stream names) from the FROM + JOIN clauses.
fn from_streams(from: &[TableWithJoins]) -> (HashMap<String, String>, Vec<String>) {
    let mut map = HashMap::new();
    let mut streams = Vec::new();
    for twj in from {
        let factors = std::iter::once(&twj.relation).chain(twj.joins.iter().map(|j| &j.relation));
        for factor in factors {
            if let TableFactor::Table { name, alias, .. } = factor {
                let stream = object_name_last(name);
                if stream.is_empty() {
                    continue;
                }
                if !streams.contains(&stream) {
                    streams.push(stream.clone());
                }
                if let Some(a) = alias {
                    map.insert(a.name.value.clone(), stream.clone());
                }
                map.insert(stream.clone(), stream.clone());
            }
        }
    }
    (map, streams)
}

fn split_and(expr: &Expr) -> Vec<&Expr> {
    const MAX_CONJUNCTS: usize = 1024;
    let mut out: Vec<&Expr> = Vec::new();
    let mut stack: Vec<&Expr> = vec![expr];
    while let Some(e) = stack.pop() {
        if out.len() >= MAX_CONJUNCTS {
            break;
        }
        match e {
            Expr::BinaryOp {
                left,
                op: BinaryOperator::And,
                right,
            } => {
                stack.push(right);
                stack.push(left);
            }
            Expr::Nested(inner) => stack.push(inner),
            other => out.push(other),
        }
    }
    out
}

/// The set of streams a conjunct's qualified columns reference (via `alias_to_stream`).
fn conjunct_streams(expr: &Expr, alias_to_stream: &HashMap<String, String>) -> HashSet<String> {
    let mut v = StreamRefs {
        alias_to_stream,
        streams: HashSet::new(),
    };
    let _ = expr.visit(&mut v);
    v.streams
}

struct StreamRefs<'a> {
    alias_to_stream: &'a HashMap<String, String>,
    streams: HashSet<String>,
}

impl Visitor for StreamRefs<'_> {
    type Break = ();
    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        if let Expr::CompoundIdentifier(ids) = expr
            && ids.len() >= 2
        {
            let qualifier = &ids[ids.len() - 2].value;
            let stream = self
                .alias_to_stream
                .get(qualifier)
                .cloned()
                .unwrap_or_else(|| qualifier.clone());
            self.streams.insert(stream);
        }
        ControlFlow::Continue(())
    }
}

/// Strips the table qualifier off every column ref (`a.col` -> `col`).
struct QualifierStripper;

impl VisitorMut for QualifierStripper {
    type Break = ();
    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::CompoundIdentifier(ids) = expr
            && let Some(last) = ids.last()
        {
            *expr = Expr::Identifier(last.clone());
        }
        ControlFlow::Continue(())
    }
}

pub trait TableReferenceExt {
    fn stream_type(&self) -> String;
    fn stream_name(&self) -> String;
    fn has_stream_type(&self) -> bool;
    fn get_stream_type(&self, stream_type: StreamType) -> StreamType;
}

impl TableReferenceExt for TableReference {
    fn stream_type(&self) -> String {
        self.schema().unwrap_or("").to_string()
    }

    fn stream_name(&self) -> String {
        self.table().to_string()
    }

    fn has_stream_type(&self) -> bool {
        self.schema().is_some()
    }

    fn get_stream_type(&self, stream_type: StreamType) -> StreamType {
        if self.has_stream_type() {
            StreamType::from(self.stream_type().as_str())
        } else {
            stream_type
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_stream_names_with_type() {
        let sql = "select * from \"log\".default";
        let refs = resolve_stream_names_with_type(sql).unwrap();
        assert_eq!(refs.len(), 1);
        let r = &refs[0];
        assert_eq!(r.stream_name(), "default");
        assert_eq!(r.stream_type(), "log");
        assert!(r.has_stream_type());
    }

    #[test]
    fn test_resolve_stream_names_with_type_bare_table() {
        let sql = "select * from mystream";
        let refs = resolve_stream_names_with_type(sql).unwrap();
        assert_eq!(refs.len(), 1);
        let r = &refs[0];
        assert_eq!(r.stream_name(), "mystream");
        assert_eq!(r.stream_type(), "");
        assert!(!r.has_stream_type());
    }

    #[test]
    fn test_extract_where_where_clause_field() {
        let wc = |sql: &str| extract_where(sql).where_clause;

        // Basic WHERE is returned without the leading keyword.
        assert_eq!(
            wc("SELECT a FROM t WHERE level = 'error' AND status = 500"),
            "level = 'error' AND status = 500",
        );

        // No WHERE → empty string.
        assert_eq!(wc("SELECT a FROM t GROUP BY a"), "");

        // Unparseable input → empty string, never a panic.
        assert_eq!(wc("not a query"), "");

        // The OUTER WHERE of a CTE query is returned (not the CTE's inner WHERE).
        assert_eq!(
            wc("WITH c AS (SELECT id FROM t WHERE inner_flag = 1) \
                SELECT id FROM c WHERE outer_flag = 2"),
            "outer_flag = 2",
        );

        // JOIN: the JOIN is in FROM, so the full WHERE (both stream aliases) is returned.
        assert_eq!(
            wc("SELECT a.svc, b.region FROM stream_a a \
                JOIN stream_b b ON a.id = b.id WHERE a.env = 'prod' AND b.tier = 'gold'"),
            "a.env = 'prod' AND b.tier = 'gold'",
        );

        // Subquery in WHERE is rendered verbatim, subquery included.
        assert_eq!(
            wc("SELECT a FROM t WHERE id IN (SELECT id FROM u WHERE x = 1)"),
            "id IN (SELECT id FROM u WHERE x = 1)",
        );

        // Parenthesized top-level SELECT is unwrapped to its WHERE.
        assert_eq!(wc("(SELECT a FROM t WHERE flag = 1)"), "flag = 1");

        // UNION has one WHERE per branch → no single clause, empty string.
        assert_eq!(
            wc("SELECT a FROM t WHERE x = 1 UNION SELECT a FROM u WHERE y = 2"),
            "",
        );
    }

    #[test]
    fn test_extract_where_by_stream() {
        let wbs = |sql: &str| extract_where(sql).where_by_stream;

        // Each stream keeps its own conjuncts, alias-stripped.
        let m = wbs(
            "SELECT a.svc, b.region FROM stream_a a JOIN stream_b b ON a.id = b.id \
             WHERE a.env = 'prod' AND b.tier = 'gold'",
        );
        assert_eq!(m.get("stream_a").map(String::as_str), Some("env = 'prod'"));
        assert_eq!(m.get("stream_b").map(String::as_str), Some("tier = 'gold'"));

        // A cross-stream conjunct (a.x = b.y) is dropped from both streams.
        let m2 = wbs("SELECT a.x FROM stream_a a JOIN stream_b b ON a.id = b.id \
             WHERE a.x = b.y AND a.env = 'prod'");
        assert_eq!(m2.get("stream_a").map(String::as_str), Some("env = 'prod'"));
        assert!(!m2.contains_key("stream_b"));

        // Single-stream query → empty (the caller uses where_clause instead).
        assert!(wbs("SELECT a FROM logs WHERE x = 1").is_empty());

        // Unparseable → empty, never a panic.
        assert!(wbs("not a query").is_empty());
    }

    #[test]
    fn test_extract_where_rejects_oversized_input() {
        let mut sql = String::from("SELECT * FROM logs WHERE ");
        sql.push_str(&"a = 1 AND ".repeat(30_000));
        sql.push_str("a = 1");
        assert!(sql.len() > MAX_WHERE_SQL_BYTES);
        let info = extract_where(&sql);
        assert_eq!(info.where_clause, "");
        assert!(info.where_by_stream.is_empty());
    }

    #[test]
    fn test_split_and_is_capped_and_iterative() {
        // A deep AND chain (parsed iteratively by sqlparser) is flattened by an iterative walk and
        // capped, so it can neither overflow the stack nor return an unbounded conjunct list.
        let mut sql = String::from("SELECT x FROM t WHERE ");
        sql.push_str(&"a = 1 AND ".repeat(3000));
        sql.push_str("a = 1");
        let dialect = PostgreSqlDialect {};
        let stmts = Parser::parse_sql(&dialect, &sql).unwrap();
        let Statement::Query(q) = &stmts[0] else {
            panic!("expected query");
        };
        let selection = outer_select(q.body.as_ref())
            .and_then(|s| s.selection.as_ref())
            .expect("selection");
        let conjuncts = split_and(selection);
        assert_eq!(
            conjuncts.len(),
            1024,
            "conjuncts must be capped at MAX_CONJUNCTS"
        );
    }

    #[test]
    fn test_table_reference_get_stream_type_with_schema() {
        let sql = "select * from \"metrics\".cpu_usage";
        let refs = resolve_stream_names_with_type(sql).unwrap();
        let r = &refs[0];
        // schema present → use it
        let st = r.get_stream_type(super::StreamType::Logs);
        assert_eq!(st, super::StreamType::Metrics);
    }

    #[test]
    fn test_table_reference_get_stream_type_without_schema() {
        let sql = "select * from cpu_usage";
        let refs = resolve_stream_names_with_type(sql).unwrap();
        let r = &refs[0];
        // no schema → fall back to provided default
        let st = r.get_stream_type(super::StreamType::Logs);
        assert_eq!(st, super::StreamType::Logs);
    }

    #[test]
    fn test_resolve_stream_names_extracts_table_names() {
        let sql = "select * from \"logs\".events";
        let names = resolve_stream_names(sql).unwrap();
        assert_eq!(names, vec!["events"]);
    }

    #[test]
    fn test_resolve_stream_names_error() {
        let sql = "";
        let names = resolve_stream_names_with_type(sql);
        assert!(names.is_err());
        assert!(
            names
                .err()
                .unwrap()
                .to_string()
                .contains("Failed to parse sql")
        );
        let names = resolve_stream_names(sql);
        assert!(names.is_err());
        assert!(
            names
                .err()
                .unwrap()
                .to_string()
                .contains("Failed to parse sql")
        );
    }

    #[test]
    fn test_sql_reserved_keywords() {
        let reserved = sql_reserved_keywords();
        assert!(!reserved.is_empty());
        assert!(reserved.contains(&"from".to_string()));
        assert!(reserved.contains(&"user".to_string()));
        assert!(!reserved.contains(&"message".to_string()));
    }

    #[test]
    fn test_order_by_default_is_desc() {
        let o: OrderBy = Default::default();
        assert_eq!(o, OrderBy::Desc);
    }

    #[test]
    fn test_order_by_serde_roundtrip() {
        let desc = serde_json::to_string(&OrderBy::Desc).unwrap();
        let asc = serde_json::to_string(&OrderBy::Asc).unwrap();
        assert_eq!(desc, "\"desc\"");
        assert_eq!(asc, "\"asc\"");
        let back_desc: OrderBy = serde_json::from_str(&desc).unwrap();
        let back_asc: OrderBy = serde_json::from_str(&asc).unwrap();
        assert_eq!(back_desc, OrderBy::Desc);
        assert_eq!(back_asc, OrderBy::Asc);
    }

    #[test]
    fn test_resolve_stream_names_join() {
        let sql = "select a.x, b.y from \"logs\".events a join \"logs\".alerts b on a.id = b.id";
        let names = resolve_stream_names(sql).unwrap();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"events".to_string()));
        assert!(names.contains(&"alerts".to_string()));
    }
}
