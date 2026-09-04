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

pub fn is_explain_query(query: &str) -> bool {
    match Parser::parse_sql(&GenericDialect {}, query) {
        Ok(statements) if !statements.is_empty() => {
            matches!(statements[0], Statement::Explain { .. })
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_explain_query() {
        assert!(is_explain_query("EXPLAIN SELECT * FROM users"));
        assert!(is_explain_query("explain select count(*) from logs"));
        assert!(is_explain_query("EXPLAIN ANALYZE SELECT * FROM users"));
        assert!(!is_explain_query("SELECT * FROM users"));
        assert!(!is_explain_query("SELECT count(*) FROM logs"));
        assert!(!is_explain_query("INVALID SQL"));
    }
}
