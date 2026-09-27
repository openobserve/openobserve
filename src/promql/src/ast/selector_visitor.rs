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

use promql_parser::{parser::Expr, util::ExprVisitor};

#[derive(Default)]
pub struct MetricSelectorVisitor {
    pub(crate) exprs: Vec<Expr>,
}

impl ExprVisitor for MetricSelectorVisitor {
    type Error = &'static str;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        match expr {
            // each selector runs its own engine, so a repeated one would be scanned twice
            Expr::VectorSelector(_) | Expr::MatrixSelector(_) if !self.exprs.contains(expr) => {
                self.exprs.push(expr.clone());
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
    use crate::ast::visitor::walk_expr;

    #[test]
    fn test_selector_visitor() {
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
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &ast).unwrap();

        let expected = [
            "container_fs_reads_bytes_total{container!=\"\",device=~\"(/dev/)?(mmcblk[0-9]p[0-9]+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|md.+|dasd.+)\"}[5m]",
            "container_fs_writes_bytes_total{container!=\"\",device=~\"(/dev/)?(mmcblk[0-9]p[0-9]+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|md.+|dasd.+)\"}[5m]",
        ];
        assert_eq!(
            visitor.exprs,
            expected
                .into_iter()
                .map(|expr| parser::parse(expr).unwrap())
                .collect::<Vec<_>>()
        );

        let promql = r#"http_requests_total{environment=~"staging|testing|development",method!="GET"} offset 5m"#;

        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &ast).unwrap();
        let expected = [
            "http_requests_total{environment=~\"staging|testing|development\",method!=\"GET\"} offset 5m",
        ];
        assert_eq!(
            visitor.exprs,
            expected
                .into_iter()
                .map(|expr| parser::parse(expr).unwrap())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_selector_visitor_empty() {
        let visitor = MetricSelectorVisitor::default();
        assert!(visitor.exprs.is_empty());
    }

    #[test]
    fn test_selector_visitor_non_selector_expr_not_collected() {
        // Scalar arithmetic has no VectorSelector or MatrixSelector
        let promql = "1 + 2";
        let ast = parser::parse(promql).unwrap();
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &ast).unwrap();
        assert!(visitor.exprs.is_empty());
    }

    #[test]
    fn test_selector_visitor_dedups_repeated_selectors() {
        let ast = parser::parse("topk(scalar(m), m) + m{a=\"b\"}").unwrap();
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &ast).unwrap();
        let expected = ["m", "m{a=\"b\"}"];
        assert_eq!(
            visitor.exprs,
            expected
                .into_iter()
                .map(|expr| parser::parse(expr).unwrap())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_selector_visitor_collects_aggregation_param_selectors() {
        let ast = parser::parse("topk(scalar(k{a=\"b\"}), m)").unwrap();
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &ast).unwrap();
        let expected = ["m", "k{a=\"b\"}"];
        assert_eq!(
            visitor.exprs,
            expected
                .into_iter()
                .map(|expr| parser::parse(expr).unwrap())
                .collect::<Vec<_>>()
        );
    }
}
