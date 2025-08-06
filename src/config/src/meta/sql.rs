// Copyright 2025 OpenObserve Inc.
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

use datafusion::sql::{TableReference, parser::DFParser, resolve::resolve_table_references};
use serde::{Deserialize, Serialize};
use sqlparser::dialect::PostgreSqlDialect;
use utoipa::ToSchema;

use super::stream::StreamType;

pub const MAX_LIMIT: i64 = 100000;
pub const MAX_OFFSET: i64 = 100000;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrderBy {
    #[default]
    Desc,
    Asc,
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
        let names = resolve_stream_names_with_type(sql).unwrap();
        println!("{names:?}");
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
}
