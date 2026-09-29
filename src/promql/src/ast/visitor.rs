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

/// Depth-first walk like the parser's `walk_expr`, but it also visits an aggregation's parameter.
pub fn walk_expr<V: ExprVisitor>(visitor: &mut V, expr: &Expr) -> Result<bool, V::Error> {
    if !visitor.pre_visit(expr)? {
        return Ok(false);
    }
    let recurse = match expr {
        Expr::Aggregate(agg) => {
            walk_expr(visitor, &agg.expr)?
                && match &agg.param {
                    Some(param) => walk_expr(visitor, param)?,
                    None => true,
                }
        }
        Expr::Unary(unary) => walk_expr(visitor, &unary.expr)?,
        Expr::Binary(binary) => {
            walk_expr(visitor, &binary.lhs)? && walk_expr(visitor, &binary.rhs)?
        }
        Expr::Paren(paren) => walk_expr(visitor, &paren.expr)?,
        Expr::Subquery(sq) => walk_expr(visitor, &sq.expr)?,
        Expr::Extension(ext) => walk_all(visitor, ext.expr.children())?,
        Expr::Call(call) => walk_all(visitor, call.args.args.iter().map(|arg| &**arg))?,
        Expr::NumberLiteral(_)
        | Expr::StringLiteral(_)
        | Expr::VectorSelector(_)
        | Expr::MatrixSelector(_) => true,
    };
    if !recurse {
        return Ok(false);
    }
    visitor.post_visit(expr)
}

fn walk_all<'a, V: ExprVisitor>(
    visitor: &mut V,
    exprs: impl IntoIterator<Item = &'a Expr>,
) -> Result<bool, V::Error> {
    for expr in exprs {
        if !walk_expr(visitor, expr)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    struct Trace(Vec<String>);

    impl ExprVisitor for Trace {
        type Error = &'static str;

        fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
            if let Expr::VectorSelector(vs) = expr {
                self.0
                    .push(format!("pre {}", vs.name.as_deref().unwrap_or("")));
            }
            Ok(true)
        }

        fn post_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
            if let Expr::VectorSelector(vs) = expr {
                self.0
                    .push(format!("post {}", vs.name.as_deref().unwrap_or("")));
            }
            Ok(true)
        }
    }

    fn trace(promql: &str) -> Vec<String> {
        let ast = parser::parse(promql).unwrap();
        let mut visitor = Trace(Vec::new());
        assert!(walk_expr(&mut visitor, &ast).unwrap());
        visitor.0
    }

    #[test]
    fn visits_aggregation_param_after_body() {
        assert_eq!(
            trace("topk(scalar(sum(k)), m)"),
            ["pre m", "post m", "pre k", "post k"]
        );
    }

    #[test]
    fn matches_parser_order_elsewhere() {
        let promql = "sum(rate(a[5m])) + on(x) group_left b / max_over_time((-c)[1h:1m])";
        let ast = parser::parse(promql).unwrap();
        let mut ours = Trace(Vec::new());
        let mut theirs = Trace(Vec::new());
        walk_expr(&mut ours, &ast).unwrap();
        promql_parser::util::walk_expr(&mut theirs, &ast).unwrap();
        assert_eq!(ours.0, theirs.0);
        assert_eq!(ours.0, ["pre b", "post b", "pre c", "post c"]);
    }

    #[test]
    fn stops_when_a_visit_returns_false() {
        struct StopAt(&'static str, usize);
        impl ExprVisitor for StopAt {
            type Error = &'static str;
            fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
                self.1 += 1;
                Ok(!matches!(expr, Expr::VectorSelector(vs) if vs.name.as_deref() == Some(self.0)))
            }
        }
        let ast = parser::parse("topk(scalar(k), m)").unwrap();
        let mut visitor = StopAt("m", 0);
        assert!(!walk_expr(&mut visitor, &ast).unwrap());
        // aggregate, m: the walk ends before the parameter
        assert_eq!(visitor.1, 2);
    }
}
