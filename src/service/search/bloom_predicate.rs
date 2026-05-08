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

//! Pull bloom-prunable predicates out of an `IndexCondition`.
//!
//! Only **positive equality / IN** on a bloom-indexed field is useful: a
//! bloom can prove a value definitely *isn't* in a file, never that it
//! definitely *is*. The full top-level AND has to all evaluate to "maybe"
//! before we keep a file.
//!
//! Anything else (NOT, !=, regex, full-text, OR-with-non-indexed) is
//! *ignored* — search-side prune treats those files as kept.

use std::collections::HashSet;

use super::index::{Condition, IndexCondition};

/// One predicate worth testing against a `.bf`. Each `(field, candidates)`
/// passes if **any** candidate value's bloom check returns true.
///
/// - `Equal(f, v)` → `Predicate { field: f, values: [v] }`
/// - `In(f, [a,b,c], false)` → `Predicate { field: f, values: [a,b,c] }`
/// - `In(.., true)` → skipped (negation, bloom can't help)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BloomPredicate {
    pub field: String,
    pub values: Vec<String>,
}

/// Extract from a query the predicates that can be tested against a `.bf`.
///
/// `bloom_indexed_fields` is the set of fields the *stream* declares as
/// (SecondaryIndex ∩ BloomFilter) — passing an unrelated field through here
/// would just produce blooms misses on the search side and waste IO.
pub fn extract(
    condition: &IndexCondition,
    bloom_indexed_fields: &HashSet<String>,
) -> Vec<BloomPredicate> {
    let mut out: Vec<BloomPredicate> = Vec::new();
    for cond in &condition.conditions {
        match cond {
            Condition::Equal(field, value) => {
                if bloom_indexed_fields.contains(field) {
                    out.push(BloomPredicate {
                        field: field.clone(),
                        values: vec![value.clone()],
                    });
                }
            }
            Condition::In(field, values, negated) => {
                if *negated {
                    continue;
                }
                if bloom_indexed_fields.contains(field) && !values.is_empty() {
                    out.push(BloomPredicate {
                        field: field.clone(),
                        values: values.clone(),
                    });
                }
            }
            // Everything else is invisible to bloom pruning.
            // - NotEqual/Not: bloom can't refute "not X"
            // - StrMatch / Regex / MatchAll / FuzzyMatchAll: tokenized,
            //   bloom is keyed by exact term
            // - And: top-level conditions are already AND'd; nested And
            //   we punt on for simplicity
            // - Or: a single OR breaks pruning — we'd need every branch
            //   to be bloom-prunable, and joining branch results with OR
            //   weakens the filter
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::super::index::{Condition, IndexCondition};
    use super::*;

    fn fields(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_extract_equal_on_indexed_field() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::Equal("trace_id".into(), "abc".into()));
        let p = extract(&c, &fields(&["trace_id"]));
        assert_eq!(
            p,
            vec![BloomPredicate {
                field: "trace_id".into(),
                values: vec!["abc".into()]
            }]
        );
    }

    #[test]
    fn test_skip_equal_on_non_indexed_field() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::Equal("body".into(), "abc".into()));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_extract_positive_in() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::In(
            "trace_id".into(),
            vec!["a".into(), "b".into()],
            false,
        ));
        let p = extract(&c, &fields(&["trace_id"]));
        assert_eq!(p[0].field, "trace_id");
        assert_eq!(p[0].values, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_skip_negated_in() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::In(
            "trace_id".into(),
            vec!["a".into()],
            true, // negated
        ));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_skip_empty_in() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::In("trace_id".into(), vec![], false));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_skip_not_equal() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::NotEqual("trace_id".into(), "abc".into()));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_skip_regex_and_str_match() {
        let mut c = IndexCondition::new();
        c.add_condition(Condition::Regex("trace_id".into(), "^abc.*".into()));
        c.add_condition(Condition::StrMatch(
            "trace_id".into(),
            "abc".into(),
            true,
        ));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_skip_or_at_top_level() {
        // OR of two equalities is conservative: bloom can't easily express
        // "either bloom must say maybe" without weakening the filter.
        let mut c = IndexCondition::new();
        c.add_condition(Condition::Or(
            Box::new(Condition::Equal("trace_id".into(), "a".into())),
            Box::new(Condition::Equal("trace_id".into(), "b".into())),
        ));
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }

    #[test]
    fn test_multiple_top_level_ands_extracted_independently() {
        // Top-level AND: each prunable predicate must hit; non-prunable
        // ones are simply ignored (file kept if blooms allow it).
        let mut c = IndexCondition::new();
        c.add_condition(Condition::Equal("trace_id".into(), "x".into()));
        c.add_condition(Condition::NotEqual("body".into(), "noise".into())); // ignored
        c.add_condition(Condition::Equal("user_id".into(), "u-1".into()));
        let p = extract(&c, &fields(&["trace_id", "user_id"]));
        assert_eq!(p.len(), 2);
        assert!(p.iter().any(|x| x.field == "trace_id"));
        assert!(p.iter().any(|x| x.field == "user_id"));
    }

    #[test]
    fn test_empty_condition() {
        let c = IndexCondition::new();
        let p = extract(&c, &fields(&["trace_id"]));
        assert!(p.is_empty());
    }
}
