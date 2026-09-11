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

use std::collections::HashSet;

use promql_parser::{parser::Expr, util::ExprVisitor};

use crate::utils::metric_name;

pub struct MetricNameVisitor {
    pub(crate) name: HashSet<String>,
}

impl MetricNameVisitor {
    pub fn new() -> Self {
        Self {
            name: HashSet::new(),
        }
    }

    pub fn into_names(self) -> HashSet<String> {
        self.name
    }
}

impl Default for MetricNameVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl ExprVisitor for MetricNameVisitor {
    type Error = &'static str;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        let selector = match expr {
            Expr::VectorSelector(vector_selector) => vector_selector,
            Expr::MatrixSelector(matrix_selector) => &matrix_selector.vs,
            _ => return Ok(true),
        };
        // callers authorize and file-list these names, so a nameless selector must fail, not be ""
        self.name
            .insert(metric_name(selector).ok_or("metric name is required")?);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    #[test]
    fn test_name_visitor() {
        let promql = r#"sum by(k8s_node_name)(
                            rate(container_fs_reads_bytes_total{
                                container!= "",
                                device=~"(/dev/)?(mmcblk[0-9]p[0-9]+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|md.+|dasd.+)"
                            }[5m])
                            +
                            rate(container_fs_writes_bytes_total{
                                container!= "",
                                device=~"(/dev/)?(mmcblk[0-9]p[0-9]+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|md.+|dasd.+)"
                            }[5m])
                            )"#;

        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::default();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();

        assert_eq!(visitor.name.len(), 2);

        let promql = r#"http_requests_total{environment=~"staging|testing|development",method!="GET"} offset 5m"#;

        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::default();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
        assert_eq!(visitor.name.len(), 1);
    }

    #[test]
    fn test_name_visitor_new_starts_empty() {
        let visitor = MetricNameVisitor::new();
        assert!(visitor.name.is_empty());
    }

    #[test]
    fn test_name_visitor_resolves_name_label_matcher() {
        let promql = r#"sum(rate({__name__="http_requests_total"}[1m]))"#;
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::new();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
        assert!(visitor.name.contains("http_requests_total"));
        assert_eq!(visitor.name.len(), 1);
    }

    #[test]
    fn test_name_visitor_both_name_forms_agree() {
        let bare = r#"sum(rate(http_requests_total{}[1m]))"#;
        let labelled = r#"sum(rate({__name__="http_requests_total"}[1m]))"#;
        let names = |promql| {
            let ast = parser::parse(promql).unwrap();
            let mut visitor = MetricNameVisitor::new();
            promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
            visitor.into_names()
        };
        assert_eq!(names(bare), names(labelled));
    }

    #[test]
    fn test_name_visitor_rejects_non_equality_name_matchers() {
        // A regex or negated `__name__` would authorize `metrics:node_.*`, a stream no one has
        // a lone negative matcher does not parse, so those two carry a companion matcher
        for promql in [
            r#"{__name__=~"node_.*"}"#,
            r#"{__name__!="http_requests_total", job="test"}"#,
            r#"{__name__!~"node_.*", job="test"}"#,
        ] {
            let ast = parser::parse(promql).unwrap();
            let mut visitor = MetricNameVisitor::new();
            assert!(
                promql_parser::util::walk_expr(&mut visitor, &ast).is_err(),
                "{promql} should not resolve to a stream name"
            );
        }
    }

    #[test]
    fn test_name_visitor_picks_the_equality_matcher_among_several() {
        let promql = r#"{__name__="http_requests_total", __name__!="other"}"#;
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::new();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
        assert!(visitor.name.contains("http_requests_total"));
        assert_eq!(visitor.name.len(), 1);
    }

    #[test]
    fn test_name_visitor_no_name_label_selector_is_an_error() {
        // Never yield "" here: callers build FGA objects and file-list lookups from these names
        let promql = r#"{job="test"}"#;
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::new();
        assert!(promql_parser::util::walk_expr(&mut visitor, &ast).is_err());
        assert!(!visitor.name.contains(""));
    }

    #[test]
    fn test_name_visitor_non_selector_expr_ignored() {
        // A scalar literal has no VectorSelector/MatrixSelector, so nothing is added
        let promql = "1 + 2";
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::new();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
        assert!(visitor.name.is_empty());
    }
}
