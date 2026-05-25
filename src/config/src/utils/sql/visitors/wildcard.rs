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

use sqlparser::ast::{Query, SelectItem, SetExpr, Statement, Visit, Visitor};

// only check the query like `select * from table`, do not check the union
pub fn has_wildcard(statement: &Statement) -> bool {
    let mut visitor = WildcardVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.has_wildcard
}

struct WildcardVisitor {
    pub has_wildcard: bool,
}

impl WildcardVisitor {
    fn new() -> Self {
        Self {
            has_wildcard: false,
        }
    }
}

impl Visitor for WildcardVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_ref() {
            for item in &select.projection {
                if matches!(item, SelectItem::Wildcard(_)) {
                    self.has_wildcard = true;
                    return ControlFlow::Break(());
                }
            }
        }
        ControlFlow::Continue(())
    }
}
