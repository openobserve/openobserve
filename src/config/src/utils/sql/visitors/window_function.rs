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

use sqlparser::ast::{Expr, Function, Statement, Visit, Visitor};

pub(crate) fn has_window_functions(stat: &Statement) -> bool {
    let mut visitor = WindowFunctionVisitor::new();
    let _ = stat.visit(&mut visitor);
    visitor.has_window_function
}

struct WindowFunctionVisitor {
    pub has_window_function: bool,
}

impl WindowFunctionVisitor {
    fn new() -> Self {
        Self {
            has_window_function: false,
        }
    }
}

impl Visitor for WindowFunctionVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Function(Function { over, .. }) if over.is_some() => {
                self.has_window_function = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}
