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
    ast::{
        Expr, LimitClause, ObjectName, Query, SetExpr, Statement, TableFactor, Value, Visit,
        Visitor,
    },
    dialect::GenericDialect,
    parser::{Parser, ParserError},
};

use crate::meta::stream::StreamType;

/// Finds a nested query or a window function anywhere in a statement.
#[derive(Default)]
struct CrossSliceVisitor {
    queries: usize,
}

impl Visitor for CrossSliceVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, _query: &Query) -> ControlFlow<Self::Break> {
        self.queries += 1;
        if self.queries > 1 {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Function(func) if func.over.is_some() => ControlFlow::Break(()),
            _ => ControlFlow::Continue(()),
        }
    }
}

/// True when every output row depends only on input rows of its own time slice.
pub fn is_time_splittable(query: &str) -> Result<bool, ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    Ok(match ast.as_slice() {
        [Statement::Query(query)] => {
            query.with.is_none()
                && !has_offset(query)
                && is_splittable_body(&query.body)
                && query.visit(&mut CrossSliceVisitor::default()).is_continue()
        }
        _ => false,
    })
}

fn is_splittable_body(body: &SetExpr) -> bool {
    match body {
        SetExpr::Select(select) => {
            let mut streams = 0;
            for factor in select.from.iter().flat_map(|table| {
                std::iter::once(&table.relation).chain(table.joins.iter().map(|j| &j.relation))
            }) {
                match factor {
                    TableFactor::Table {
                        name, args: None, ..
                    } => streams += usize::from(!is_enrichment_table(name)),
                    _ => return false,
                }
            }
            // Each slice reads a whole enrichment table, but two streams pair rows across slices.
            streams <= 1
        }
        SetExpr::SetOperation { left, right, .. } => {
            is_splittable_body(left) && is_splittable_body(right)
        }
        _ => false,
    }
}

fn is_enrichment_table(name: &ObjectName) -> bool {
    match name.0.as_slice() {
        [.., schema, _] => schema.as_ident().is_some_and(|ident| {
            StreamType::from(ident.value.as_str()) == StreamType::EnrichmentTables
        }),
        _ => false,
    }
}

fn has_offset(query: &Query) -> bool {
    let offset = match &query.limit_clause {
        Some(LimitClause::LimitOffset {
            offset: Some(offset),
            ..
        }) => &offset.value,
        Some(LimitClause::OffsetCommaLimit { offset, .. }) => offset,
        _ => return false,
    };
    !matches!(offset, Expr::Value(v) if matches!(&v.value, Value::Number(n, _) if n.parse::<u64>() == Ok(0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splittable_queries() {
        for sql in [
            "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 100",
            "SELECT _timestamp, k FROM t WHERE k = 'a' ORDER BY _timestamp",
            "SELECT histogram(_timestamp) AS ts, count(*) AS c FROM t GROUP BY ts ORDER BY ts",
            "SELECT histogram(_timestamp) AS ts, k, count(*) AS c FROM t GROUP BY ts, k HAVING count(*) > 1 ORDER BY ts",
            "SELECT k, count(*) FROM t GROUP BY k",
            "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 10 OFFSET 0",
            "SELECT t._timestamp, e.name FROM t JOIN enrich.users e ON t.uid = e.uid",
            "SELECT histogram(t._timestamp) AS ts, e.name, count(*) FROM t LEFT JOIN \"enrichment_tables\".\"users\" e ON t.uid = e.uid GROUP BY ts, e.name",
            "SELECT _timestamp, k FROM a UNION ALL SELECT _timestamp, k FROM b ORDER BY _timestamp",
        ] {
            assert_eq!(is_time_splittable(sql), Ok(true), "{sql}");
        }
    }

    #[test]
    fn cross_slice_queries() {
        for sql in [
            "SELECT t._timestamp, s.c FROM t JOIN (SELECT k, COUNT(*) AS c FROM t GROUP BY k) s ON t.k = s.k",
            "SELECT a._timestamp, b.v FROM t a JOIN t2 b ON a.k = b.k",
            "SELECT a._timestamp, b.v FROM t a JOIN t b ON a.k = b.k",
            "SELECT a._timestamp, b.v FROM t a, t2 b",
            "SELECT histogram(a._timestamp) AS ts, count(*) FROM t a LEFT JOIN t2 b ON a.k = b.k GROUP BY ts",
            "SELECT * FROM (SELECT _timestamp, k FROM t) s ORDER BY _timestamp",
            "SELECT * FROM (SELECT _timestamp, k FROM t ORDER BY _timestamp DESC LIMIT 10) s",
            "WITH s AS (SELECT _timestamp, k FROM t) SELECT * FROM s ORDER BY _timestamp",
            "SELECT _timestamp, k FROM t WHERE k IN (SELECT k FROM t2)",
            "SELECT _timestamp, k FROM t WHERE EXISTS (SELECT 1 FROM t2 WHERE t2.k = t.k)",
            "SELECT _timestamp FROM t WHERE duration > (SELECT avg(duration) FROM t)",
            "SELECT histogram(_timestamp) AS ts, count(*) FROM t WHERE k IN (SELECT k FROM t2) GROUP BY ts",
            "SELECT _timestamp, row_number() OVER () AS rn FROM t",
            "SELECT _timestamp, lag(v) OVER (ORDER BY _timestamp) AS p FROM t",
            "SELECT histogram(_timestamp) AS ts, sum(count(*)) OVER (ORDER BY histogram(_timestamp)) AS cum FROM t GROUP BY ts",
            "SELECT histogram(_timestamp) AS ts, count(*) * 100 / sum(count(*)) OVER () AS pct FROM t GROUP BY ts",
            "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 10 OFFSET 5",
            "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 5, 10",
            "SELECT * FROM t; SELECT * FROM t2",
        ] {
            assert_eq!(is_time_splittable(sql), Ok(false), "{sql}");
        }
    }
}
