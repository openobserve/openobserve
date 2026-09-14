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

//! Static analysis of a PromQL expression that decides whether series labels
//! can be skipped entirely when loading data.

use promql_parser::parser::{AggregateExpr, Call, Expr as PromExpr, ParenExpr, UnaryExpr, token};

/// Aggregations that with no modifier group every series into a single
/// labelless output series, so the input labels are provably unused.
const LABEL_DROPPING_AGGS: [u8; 8] = [
    token::T_SUM,
    token::T_AVG,
    token::T_COUNT,
    token::T_MIN,
    token::T_MAX,
    token::T_GROUP,
    token::T_STDDEV,
    token::T_STDVAR,
];

/// Functions that neither read nor create label values — they only transform
/// per-series samples. Anything label-sensitive (`label_replace`,
/// `histogram_quantile`, `absent`, ...) must NOT be listed here.
const LABEL_AGNOSTIC_FUNCS: [&str; 32] = [
    "rate",
    "irate",
    "increase",
    "delta",
    "idelta",
    "deriv",
    "changes",
    "resets",
    "avg_over_time",
    "min_over_time",
    "max_over_time",
    "sum_over_time",
    "count_over_time",
    "last_over_time",
    "stddev_over_time",
    "stdvar_over_time",
    "quantile_over_time",
    "predict_linear",
    "holt_winters",
    "abs",
    "ceil",
    "floor",
    "exp",
    "sqrt",
    "ln",
    "log2",
    "log10",
    "round",
    "sgn",
    "clamp",
    "clamp_max",
    "clamp_min",
];

/// Returns true when the query's root aggregation discards all labels and the
/// subtree below it never reads label values, so series labels don't need to
/// be loaded at all.
pub fn labels_dropped_at_root(expr: &PromExpr) -> bool {
    match expr {
        PromExpr::Aggregate(AggregateExpr {
            op,
            expr,
            param,
            modifier,
        }) => {
            modifier.is_none()
                && param.is_none()
                && LABEL_DROPPING_AGGS.contains(&op.id())
                && subtree_labels_unused(expr)
        }
        PromExpr::Paren(ParenExpr { expr }) => labels_dropped_at_root(expr),
        _ => false,
    }
}

fn subtree_labels_unused(expr: &PromExpr) -> bool {
    match expr {
        PromExpr::VectorSelector(_) | PromExpr::MatrixSelector(_) => true,
        PromExpr::NumberLiteral(_) => true,
        PromExpr::Paren(ParenExpr { expr }) => subtree_labels_unused(expr),
        PromExpr::Unary(UnaryExpr { expr }) => subtree_labels_unused(expr),
        PromExpr::Subquery(subquery) => subtree_labels_unused(&subquery.expr),
        PromExpr::Call(Call { func, args }) => {
            LABEL_AGNOSTIC_FUNCS.contains(&func.name)
                && args.args.iter().all(|arg| subtree_labels_unused(arg))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_labels_dropped_at_root() {
        let cases = [
            ("sum(rate(metric[5m]))", true),
            ("avg(irate(metric[1m]))", true),
            ("max(abs(metric))", true),
            ("count(metric)", true),
            ("(sum(rate(metric[5m])))", true),
            ("sum(clamp(rate(metric[5m]), 0, 100))", true),
            // grouping keeps labels
            ("sum by (region) (rate(metric[5m]))", false),
            ("sum without (le) (rate(metric[5m]))", false),
            // root is not an aggregation
            ("rate(metric[5m])", false),
            ("sum(rate(metric[5m])) / 2", false),
            // label-sensitive constructs
            (
                "histogram_quantile(0.9, sum by (le) (rate(metric[5m])))",
                false,
            ),
            ("topk(3, rate(metric[5m]))", false),
            (
                "sum(label_replace(metric, \"a\", \"$1\", \"b\", \"(.*)\"))",
                false,
            ),
            ("sum(metric_a + metric_b)", false),
        ];
        for (query, expected) in cases {
            let expr = promql_parser::parser::parse(query).unwrap();
            assert_eq!(labels_dropped_at_root(&expr), expected, "query: {query}");
        }
    }
}
