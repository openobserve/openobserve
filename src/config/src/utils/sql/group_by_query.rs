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

use sqlparser::{ast::Statement, dialect::GenericDialect, parser::Parser};

use super::helpers::has_group_by;

/// Top-level GROUP BY only: a grouped subquery does not group the outer result set.
pub fn is_group_by_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    Ok(ast
        .iter()
        .any(|statement| matches!(statement, Statement::Query(query) if has_group_by(query))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_group_by_clause() {
        let queries = [
            "SELECT code, COUNT(*) FROM logs GROUP BY code",
            "SELECT code, host, COUNT(*) FROM logs WHERE code > 399 GROUP BY code, host",
            "SELECT code, COUNT(*) AS c FROM logs GROUP BY code HAVING COUNT(*) > 5 ORDER BY c",
        ];
        for q in queries {
            assert!(is_group_by_query(q).unwrap(), "expected GROUP BY: {q}");
        }
    }

    #[test]
    fn no_group_by_clause_is_false() {
        let queries = [
            "SELECT code FROM logs",
            "SELECT COUNT(*) FROM logs WHERE code > 399",
            "SELECT * FROM logs ORDER BY _timestamp LIMIT 10",
        ];
        for q in queries {
            assert!(!is_group_by_query(q).unwrap(), "expected no GROUP BY: {q}");
        }
    }

    #[test]
    fn group_by_only_inside_a_subquery_is_false() {
        let q = "SELECT * FROM (SELECT code, COUNT(*) FROM logs GROUP BY code) t";
        assert!(!is_group_by_query(q).unwrap());
    }

    #[test]
    fn unparseable_sql_is_an_error() {
        assert!(is_group_by_query("SELECT FROM WHERE GROUP").is_err());
    }
}
