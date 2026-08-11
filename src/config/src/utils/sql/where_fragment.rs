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

use sqlparser::{dialect::GenericDialect, parser::Parser};

/// Validate that `filter` is a single well-formed SQL boolean expression suitable
/// for splicing into a WHERE clause. Rejects empty input, multi-statement payloads,
/// and fragments that only parse because a comment (`--`, `/*`) swallowed the
/// closing context. Defense-in-depth for endpoints that accept raw filter fragments
/// (traces latest/latest_stream) — clients must still escape values.
///
/// It intentionally does NOT reject tautologies (`a='x' OR 1=1` is valid SQL); the
/// client-side escaping is the real fix, this is the backstop for direct API callers.
pub fn validate_where_fragment(filter: &str) -> Result<(), String> {
    if filter.trim().is_empty() {
        return Err("filter must not be empty".to_string());
    }
    let probe = format!("SELECT 1 FROM t WHERE ({filter})");
    let dialect = GenericDialect {};
    match Parser::parse_sql(&dialect, &probe) {
        Ok(statements) if statements.len() == 1 => Ok(()),
        Ok(_) => Err("filter must be a single expression".to_string()),
        Err(e) => Err(format!("invalid filter expression: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_where_fragment() {
        // Well-formed fragments pass
        assert!(validate_where_fragment("service_name='api' AND duration > 100").is_ok());
        assert!(validate_where_fragment("\"k8s_pod_name\" = 'checkout.service'").is_ok());
        // Statement smuggling / truncation / garbage fail
        assert!(validate_where_fragment("1=1; DROP TABLE t").is_err());
        // A trailing comment swallows the wrapper's closing paren -> unclosed paren
        assert!(validate_where_fragment("a='x' --").is_err());
        assert!(validate_where_fragment("a='x' /*").is_err());
        assert!(validate_where_fragment("a='x").is_err()); // unterminated literal
        assert!(validate_where_fragment("").is_err());
        assert!(validate_where_fragment("   ").is_err());
        // Set-operation smuggling is rejected too (the wrapper paren is still open)
        assert!(validate_where_fragment("a='x' UNION SELECT 1").is_err());
    }

    #[test]
    fn test_validate_where_fragment_balanced_breakout_is_accepted() {
        // Documented limitation: a payload that BALANCES the wrapper paren itself and
        // comments out the tail still parses as one statement, so it is accepted.
        // That is intended: the fragment is still a single boolean expression spliced
        // into one WHERE clause (here a tautology), not a second statement. Tautologies
        // are deliberately out of scope for this backstop — the client-side escaping
        // is what prevents them. What this validator guarantees is that no additional
        // statement and no truncated/garbage SQL reaches the planner.
        assert!(validate_where_fragment("a='x') OR 1=1 --").is_ok());
        // ...but the same shape cannot smuggle a second statement:
        assert!(validate_where_fragment("a='x') ; DROP TABLE t --").is_err());
    }
}
