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

use sqlparser::ast::{Expr, Ident, ObjectName, ObjectNamePart, VisitorMut};

pub struct MatchAllRawVisitor {}

impl MatchAllRawVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for MatchAllRawVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(f) = expr {
            let fname = f.name.to_string().to_lowercase();
            // for backward compatibility, we re-write these functions as match all
            if fname == "match_all_raw" || fname == "match_all_raw_ignore_case" {
                f.name = ObjectName(vec![ObjectNamePart::Identifier(Ident::new("match_all"))])
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
    fn test_match_all_raw1() {
        let sql = "SELECT * FROM t WHERE match_all_raw('test')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut visitor);
        let expected_sql = "SELECT * FROM t WHERE match_all('test')";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_match_all_raw2() {
        let sql =
            "SELECT * FROM t WHERE match_all_raw_ignore_case('test') group by name order by name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut visitor);
        let expected_sql = "SELECT * FROM t WHERE match_all('test') GROUP BY name ORDER BY name";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_match_all_raw3() {
        let sql = "SELECT t1.name, t2.name from t1 join t2 on t1.name = t2.name where match_all_raw('capture') group by t1.name, t2.name order by t1.name, t2.name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut visitor);
        let expected_sql = "SELECT t1.name, t2.name FROM t1 JOIN t2 ON t1.name = t2.name WHERE match_all('capture') GROUP BY t1.name, t2.name ORDER BY t1.name, t2.name";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_match_all_raw4() {
        let sql = "SELECT match_all_raw_ignore_case('fine') from t1";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut visitor);
        let expected_sql = "SELECT match_all('fine') FROM t1";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_match_all_raw5() {
        let sql = "SELECT match_all_raw('fine') from t1";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut visitor);
        let expected_sql = "SELECT match_all('fine') FROM t1";
        assert_eq!(statement.to_string(), expected_sql);
    }
}
