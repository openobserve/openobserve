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

use promql_parser::{
    parser::{Expr, VectorSelector},
    util::ExprVisitor,
};

pub struct MetricNameVisitor {
    pub(crate) name: HashSet<String>,
}

impl MetricNameVisitor {
    pub fn new() -> Self {
        Self {
            name: HashSet::new(),
        }
    }
}

impl Default for MetricNameVisitor {
    fn default() -> Self {
        Self::new()
    }
}

fn get_name_from_expr(vector_selector: &VectorSelector) -> String {
    match vector_selector.name.as_ref() {
        Some(name) => name.clone(),
        None => "".to_string(),
    }
}

impl ExprVisitor for MetricNameVisitor {
    type Error = &'static str;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        match expr {
            Expr::VectorSelector(vector_selector) => {
                self.name.insert(get_name_from_expr(vector_selector));
            }
            Expr::MatrixSelector(matrix_selector) => {
                self.name.insert(get_name_from_expr(&matrix_selector.vs));
            }
            _ => {}
        }
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
    fn test_name_visitor_no_name_label_selector_inserts_empty_string() {
        // A selector with no explicit metric name (only label matchers) gives name = None
        let promql = r#"{job="test"}"#;
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricNameVisitor::new();
        promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
        // name field is None → get_name_from_expr returns "" → inserted into set
        assert!(visitor.name.contains(""));
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
