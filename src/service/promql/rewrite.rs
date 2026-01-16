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

use config::get_config;
use promql_parser::{
    label::{MatchOp, Matcher},
    parser::VectorSelector,
};

struct RemoveFilterAllRewriter {}

impl RemoveFilterAllRewriter {
    pub fn new() -> Self {
        RemoveFilterAllRewriter {}
    }
}

impl RemoveFilterAllRewriter {
    pub fn rewrite(&self, vs: &mut VectorSelector) {
        let placeholder = get_config().common.dashboard_placeholder.to_string();

        vs.matchers
            .matchers
            .retain(|m| !match_placeholder(m, &placeholder));
        vs.matchers
            .or_matchers
            .iter_mut()
            .for_each(|vs| vs.retain(|m| !match_placeholder(m, &placeholder)));
    }
}

fn match_placeholder(matcher: &Matcher, placeholder: &str) -> bool {
    match &matcher.op {
        MatchOp::Equal => matcher.value == placeholder,
        MatchOp::NotEqual => matcher.value == placeholder,
        MatchOp::Re(pattern) => pattern.to_string() == placeholder,
        MatchOp::NotRe(pattern) => pattern.to_string() == placeholder,
    }
}

pub fn remove_filter_all(vs: &mut VectorSelector) {
    RemoveFilterAllRewriter::new().rewrite(vs);
}

#[cfg(test)]
mod tests {
    use promql_parser::label::Matchers;
    use regex::Regex;

    use super::*;

    fn create_test_matcher(name: &str, op: MatchOp, value: &str) -> Matcher {
        Matcher {
            name: name.to_string(),
            op: match op {
                MatchOp::Equal => MatchOp::Equal,
                MatchOp::NotEqual => MatchOp::NotEqual,
                MatchOp::Re(_) => MatchOp::Re(Regex::new(value).unwrap()),
                MatchOp::NotRe(_) => MatchOp::NotRe(Regex::new(value).unwrap()),
            },
            value: value.to_string(),
        }
    }

    fn create_vector_selector_with_matchers(matchers: Vec<Matcher>) -> VectorSelector {
        VectorSelector {
            name: Some("test_metric".to_string()),
            matchers: Matchers {
                matchers,
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        }
    }

    #[test]
    fn test_match_placeholder_equal_op() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let matcher = create_test_matcher("label", MatchOp::Equal, &placeholder);
        assert!(match_placeholder(&matcher, &placeholder));

        let non_matching_matcher = create_test_matcher("label", MatchOp::Equal, "other_value");
        assert!(!match_placeholder(&non_matching_matcher, &placeholder));
    }

    #[test]
    fn test_match_placeholder_not_equal_op() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let matcher = create_test_matcher("label", MatchOp::NotEqual, &placeholder);
        assert!(match_placeholder(&matcher, &placeholder));

        let non_matching_matcher = create_test_matcher("label", MatchOp::NotEqual, "other_value");
        assert!(!match_placeholder(&non_matching_matcher, &placeholder));
    }

    #[test]
    fn test_match_placeholder_regex_op() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let matcher =
            create_test_matcher("label", MatchOp::Re(Regex::new("").unwrap()), &placeholder);
        assert!(match_placeholder(&matcher, &placeholder));

        let non_matching_matcher =
            create_test_matcher("label", MatchOp::Re(Regex::new("").unwrap()), "other.*");
        assert!(!match_placeholder(&non_matching_matcher, &placeholder));
    }

    #[test]
    fn test_match_placeholder_not_regex_op() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let matcher = create_test_matcher(
            "label",
            MatchOp::NotRe(Regex::new("").unwrap()),
            &placeholder,
        );
        assert!(match_placeholder(&matcher, &placeholder));

        let non_matching_matcher =
            create_test_matcher("label", MatchOp::NotRe(Regex::new("").unwrap()), "other.*");
        assert!(!match_placeholder(&non_matching_matcher, &placeholder));
    }

    #[test]
    fn test_remove_filter_all_removes_placeholder_matchers() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let placeholder_matcher = create_test_matcher("env", MatchOp::Equal, &placeholder);
        let normal_matcher = create_test_matcher("service", MatchOp::Equal, "web");

        let mut vs =
            create_vector_selector_with_matchers(vec![placeholder_matcher, normal_matcher.clone()]);

        remove_filter_all(&mut vs);

        assert_eq!(vs.matchers.matchers.len(), 1);
        assert_eq!(vs.matchers.matchers[0].name, "service");
        assert_eq!(vs.matchers.matchers[0].value, "web");
    }

    #[test]
    fn test_remove_filter_all_removes_all_placeholder_matchers() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let placeholder_matcher1 = create_test_matcher("env", MatchOp::Equal, &placeholder);
        let placeholder_matcher2 = create_test_matcher("region", MatchOp::NotEqual, &placeholder);
        let placeholder_matcher3 = create_test_matcher(
            "cluster",
            MatchOp::Re(Regex::new("").unwrap()),
            &placeholder,
        );

        let mut vs = create_vector_selector_with_matchers(vec![
            placeholder_matcher1,
            placeholder_matcher2,
            placeholder_matcher3,
        ]);

        remove_filter_all(&mut vs);

        assert_eq!(vs.matchers.matchers.len(), 0);
    }

    #[test]
    fn test_remove_filter_all_preserves_non_placeholder_matchers() {
        let normal_matcher1 = create_test_matcher("service", MatchOp::Equal, "web");
        let normal_matcher2 = create_test_matcher("env", MatchOp::NotEqual, "dev");
        let normal_matcher3 =
            create_test_matcher("version", MatchOp::Re(Regex::new("").unwrap()), "v1.*");

        let mut vs = create_vector_selector_with_matchers(vec![
            normal_matcher1,
            normal_matcher2,
            normal_matcher3,
        ]);

        remove_filter_all(&mut vs);

        assert_eq!(vs.matchers.matchers.len(), 3);
        assert_eq!(vs.matchers.matchers[0].name, "service");
        assert_eq!(vs.matchers.matchers[1].name, "env");
        assert_eq!(vs.matchers.matchers[2].name, "version");
    }

    #[test]
    fn test_remove_filter_all_handles_or_matchers() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let placeholder_matcher = create_test_matcher("env", MatchOp::Equal, &placeholder);
        let normal_matcher = create_test_matcher("service", MatchOp::Equal, "web");

        let mut vs = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers: Matchers {
                matchers: vec![normal_matcher.clone()],
                or_matchers: vec![
                    vec![placeholder_matcher.clone(), normal_matcher.clone()],
                    vec![normal_matcher.clone()],
                ],
            },
            offset: None,
            at: None,
        };

        remove_filter_all(&mut vs);

        assert_eq!(vs.matchers.matchers.len(), 1);
        assert_eq!(vs.matchers.or_matchers.len(), 2);
        assert_eq!(vs.matchers.or_matchers[0].len(), 1); // placeholder removed
        assert_eq!(vs.matchers.or_matchers[1].len(), 1); // unchanged
        assert_eq!(vs.matchers.or_matchers[0][0].name, "service");
    }

    #[test]
    fn test_remove_filter_all_with_empty_matchers() {
        let mut vs = create_vector_selector_with_matchers(vec![]);

        remove_filter_all(&mut vs);

        assert_eq!(vs.matchers.matchers.len(), 0);
        assert_eq!(vs.matchers.or_matchers.len(), 0);
    }
}
