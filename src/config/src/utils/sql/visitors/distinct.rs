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

use sqlparser::ast::{
    DuplicateTreatment, Expr, Function, FunctionArgumentList, FunctionArguments, Query, SetExpr,
    Statement, Visit, Visitor,
};

pub(crate) fn has_distinct(statement: &Statement) -> bool {
    let mut visitor = DistinctVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.has_distinct
}

struct DistinctVisitor {
    pub has_distinct: bool,
}

impl DistinctVisitor {
    fn new() -> Self {
        Self {
            has_distinct: false,
        }
    }
}

impl Visitor for DistinctVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_ref()
            && select.distinct.is_some()
        {
            self.has_distinct = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(Function {
            args:
                FunctionArguments::List(FunctionArgumentList {
                    duplicate_treatment: Some(DuplicateTreatment::Distinct),
                    ..
                }),
            ..
        }) = expr
        {
            self.has_distinct = true;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}
