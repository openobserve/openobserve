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

use std::sync::LazyLock;

use datafusion::sql::{TableReference, parser::DFParser, resolve::resolve_table_references};
use serde::{Deserialize, Serialize};
use sqlparser::{
    ast::{Expr, SelectItem, SetExpr, Statement},
    dialect::PostgreSqlDialect,
    keywords::ALL_KEYWORDS,
    parser::Parser,
};
use utoipa::ToSchema;

use super::stream::StreamType;

pub const MAX_LIMIT: i64 = 100000;
pub const MAX_OFFSET: i64 = 100000;

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
