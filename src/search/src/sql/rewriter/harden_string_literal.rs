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

use sqlparser::ast::{DollarQuotedString, Expr, Value, VisitorMut};

pub struct HardenStringLiteralVisitor {}

impl Default for HardenStringLiteralVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl HardenStringLiteralVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for HardenStringLiteralVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        let Expr::Value(v) = expr else {
            return ControlFlow::Continue(());
        };
        let Value::SingleQuotedString(s) = &v.value else {
            return ControlFlow::Continue(());
        };
        // sqlparser serializes a `\'` inside a single-quoted literal without re-doubling the
        // quote, so re-parsing the emitted SQL splits the literal (GHSA-fgm2-fp3h-h54f);
        // dollar-quoting carries no escaping and round-trips the value verbatim.
        if !has_backslash_before_quote(s) {
            return ControlFlow::Continue(());
        }
        let value = s.clone();
        let tag = choose_dollar_tag(&value);
        v.value = Value::DollarQuotedString(DollarQuotedString { value, tag });
        ControlFlow::Continue(())
    }
}

fn has_backslash_before_quote(s: &str) -> bool {
    let bytes = s.as_bytes();
    (1..bytes.len()).any(|i| bytes[i] == b'\'' && bytes[i - 1] == b'\\')
}

fn choose_dollar_tag(value: &str) -> Option<String> {
    if !value.contains('$') {
        return None;
    }
    let mut n = 0u32;
    loop {
        let tag = if n == 0 {
            "o2".to_string()
        } else {
            format!("o2_{n}")
        };
        if !value.contains(&format!("${tag}$")) {
            return Some(tag);
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::PostgreSqlDialect, parser::Parser};

    use super::*;

    fn harden(sql: &str) -> String {
        let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut visitor = HardenStringLiteralVisitor::new();
        let _ = statement.visit(&mut visitor);
        statement.to_string()
    }

    fn literal_values(sql: &str) -> Vec<String> {
        let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut found = Vec::new();
        let mut collector = LiteralCollector { out: &mut found };
        let _ = statement.visit(&mut collector);
        found
    }

    struct LiteralCollector<'a> {
        out: &'a mut Vec<String>,
    }

    impl VisitorMut for LiteralCollector<'_> {
        type Break = ();

        fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
            if let Expr::Value(v) = expr {
                match &v.value {
                    Value::SingleQuotedString(s)
                    | Value::DollarQuotedString(DollarQuotedString { value: s, .. }) => {
                        self.out.push(s.clone());
                    }
                    _ => {}
                }
            }
            ControlFlow::Continue(())
        }
    }

    #[test]
    fn backslash_quote_payload_round_trips_as_single_literal() {
        // untrusted `x\' OR 1=1 --`, standard-escaped by the caller (quote doubled)
        let sql = r#"SELECT COUNT(*) AS n FROM "t" WHERE 'S' = 'x\'' OR 1=1 --'"#;
        let hardened = harden(sql);
        // the whole payload survives re-parsing as one literal, so `OR 1=1` never reaches code
        assert!(literal_values(&hardened).contains(&r#"x\' OR 1=1 --"#.to_string()));
    }

    #[test]
    fn union_payload_is_neutralized() {
        let sql = r#"SELECT COUNT(*) AS n FROM "t" WHERE 'S' = 'x\'' UNION SELECT 1 --'"#;
        let hardened = harden(sql);
        assert!(literal_values(&hardened).contains(&r#"x\' UNION SELECT 1 --"#.to_string()));
    }

    #[test]
    fn value_containing_dollar_quote_delimiter_gets_a_tag() {
        // raw value `a\'$$b`, caller-escaped by doubling the quote
        let sql = r#"SELECT * FROM "t" WHERE a = 'a\''$$b'"#;
        let hardened = harden(sql);
        assert!(hardened.contains("$o2$"));
        assert!(literal_values(&hardened).contains(&r#"a\'$$b"#.to_string()));
    }

    #[test]
    fn benign_backslash_value_is_untouched_and_preserved() {
        let sql = r#"SELECT * FROM "t" WHERE a = 'a\b'"#;
        let hardened = harden(sql);
        assert_eq!(hardened, sql);
        assert!(literal_values(&hardened).contains(&r#"a\b"#.to_string()));
    }

    #[test]
    fn benign_quoted_value_is_untouched() {
        let sql = r#"SELECT * FROM "t" WHERE a = 'o''brien'"#;
        assert_eq!(harden(sql), sql);
    }

    #[test]
    fn has_backslash_before_quote_detects_only_escaped_quotes() {
        assert!(has_backslash_before_quote(r#"x\'"#));
        assert!(!has_backslash_before_quote(r#"a\b"#));
        assert!(!has_backslash_before_quote("plain"));
        assert!(!has_backslash_before_quote("'"));
    }

    #[test]
    fn choose_dollar_tag_skips_when_no_dollar() {
        assert_eq!(choose_dollar_tag("no dollar here"), None);
        assert_eq!(choose_dollar_tag("a$b"), Some("o2".to_string()));
        assert_eq!(choose_dollar_tag("a$o2$b"), Some("o2_1".to_string()));
    }
}
