// Copyright 2024 Zinc Labs Inc.
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

// rewrite count(distinct(field)) query

use core::ops::ControlFlow;

use datafusion::error::Result;
use sqlparser::{
    ast::{Ident, ObjectName, Query, TableFactor, TableWithJoins, VisitMut, VisitorMut},
    dialect::GenericDialect,
    parser::Parser,
};

pub fn replace_data_source_to_tbl(sql: &str) -> Result<String> {
    let mut statements = Parser::parse_sql(&GenericDialect {}, sql)?;
    statements.visit(&mut ReplaceDataSource);
    Ok(statements[0].to_string())
}

struct ReplaceDataSource;

impl VisitorMut for ReplaceDataSource {
    type Break = ();

    /// Invoked for any queries that appear in the AST before visiting children
    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(ref mut select) = *query.body {
            let source = TableWithJoins {
                relation: TableFactor::Table {
                    name: ObjectName(vec![Ident::new("tbl")]),
                    alias: None,
                    args: None,
                    with_hints: vec![],
                    version: None,
                    partitions: vec![],
                },
                joins: vec![],
            };
            select.from = vec![source];
        }
        ControlFlow::Continue(())
    }
}
