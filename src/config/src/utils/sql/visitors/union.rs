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
    ast::{Query, SetExpr, SetQuantifier, Statement, Visit, Visitor},
    dialect::GenericDialect,
    parser::Parser,
};

pub(crate) fn has_union(query: &Query) -> bool {
    let mut visitor = UnionVisitor::new();
    let _ = query.visit(&mut visitor);
    visitor.has_union
}

fn has_union_all(query: &Query) -> bool {
    let mut visitor = UnionAllVisitor::new();
    let _ = query.visit(&mut visitor);
    visitor.has_union_all
}

pub(crate) fn is_multi_search_eligible_for_histogram(
    query: &str,
) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement
            && has_union_all(query)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

struct UnionVisitor {
    pub has_union: bool,
}

impl UnionVisitor {
    fn new() -> Self {
        Self { has_union: false }
    }
}

impl Visitor for UnionVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::SetOperation { .. } = *query.body {
            self.has_union = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

struct UnionAllVisitor {
    pub has_union_all: bool,
}

impl UnionAllVisitor {
    fn new() -> Self {
        Self {
            has_union_all: false,
        }
    }
}

impl Visitor for UnionAllVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::SetOperation { set_quantifier, .. } = *query.body
            && set_quantifier == SetQuantifier::All
        {
            self.has_union_all = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_union_all_visitor() {
        let sql1 = "select * from oly union select * from oly2";
        let sql2 = "select * from oly union all select * from oly2";

        let is_not_union_all = is_multi_search_eligible_for_histogram(sql1).unwrap();
        let is_union_all = is_multi_search_eligible_for_histogram(sql2).unwrap();

        assert_eq!(is_not_union_all, false);
        assert_eq!(is_union_all, true);
    }
}
