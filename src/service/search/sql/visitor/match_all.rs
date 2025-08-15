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

use std::ops::ControlFlow;

use sqlparser::ast::{Expr, FunctionArguments, VisitorMut};

use crate::service::search::datafusion::udf::match_all_udf::{
    FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME,
};

/// get all item from match_all functions
pub struct MatchVisitor {
    pub has_match_all: bool,
}

impl MatchVisitor {
    pub fn new() -> Self {
        Self {
            has_match_all: false,
        }
    }
}

impl VisitorMut for MatchVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            let name = func.name.to_string().to_lowercase();
            if (name == MATCH_ALL_UDF_NAME || name == FUZZY_MATCH_ALL_UDF_NAME)
                && let FunctionArguments::List(list) = &func.args
                && !list.args.is_empty()
            {
                self.has_match_all = true;
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {

    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_match_visitor() {
        let sql = "SELECT * FROM logs WHERE match_all('error') AND match_all('critical')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        // Should extract match_all values
        assert!(match_visitor.has_match_all);
    }
}
