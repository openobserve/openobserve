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

//! Static analysis of a PromQL expression that decides which series labels
//! need to be loaded.

use promql_parser::parser::{
    AggregateExpr, BinaryExpr, Call, Expr as PromExpr, LabelModifier, ParenExpr, UnaryExpr, token,
};

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
const LABEL_AGNOSTIC_FUNCS: [&str; 33] = [
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
    "present_over_time",
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

/// Returns true when loading only the grouping labels cannot merge series before they are grouped.
pub fn grouping_labels_suffice(expr: &PromExpr) -> bool {
    selectors_grouped(expr, false)
}

fn subtree_labels_unused(expr: &PromExpr) -> bool {
    match expr {
        PromExpr::VectorSelector(_) | PromExpr::MatrixSelector(_) | PromExpr::NumberLiteral(_) => {
            true
        }
        PromExpr::Paren(ParenExpr { expr }) | PromExpr::Unary(UnaryExpr { expr }) => {
            subtree_labels_unused(expr)
        }
        PromExpr::Subquery(subquery) => subtree_labels_unused(&subquery.expr),
        PromExpr::Call(Call { func, args }) => {
            LABEL_AGNOSTIC_FUNCS.contains(&func.name)
                && args.args.iter().all(|arg| subtree_labels_unused(arg))
        }
        _ => false,
    }
}

fn selectors_grouped(expr: &PromExpr, grouped: bool) -> bool {
    match expr {
        PromExpr::VectorSelector(_) | PromExpr::MatrixSelector(_) => grouped,
        PromExpr::NumberLiteral(_) | PromExpr::StringLiteral(_) => true,
        PromExpr::Paren(ParenExpr { expr }) | PromExpr::Unary(UnaryExpr { expr }) => {
            selectors_grouped(expr, grouped)
        }
        PromExpr::Subquery(subquery) => selectors_grouped(&subquery.expr, grouped),
        PromExpr::Aggregate(AggregateExpr {
            op,
            expr,
            param,
            modifier,
        }) => {
            // topk/bottomk and `without` keep labels that were never loaded
            let collapses = !matches!(op.id(), token::T_TOPK | token::T_BOTTOMK)
                && !matches!(modifier, Some(LabelModifier::Exclude(_)));
            selectors_grouped(expr, collapses)
                && param
                    .as_deref()
                    .is_none_or(|param| selectors_grouped(param, false))
        }
        PromExpr::Call(Call { func, args }) => {
            let grouped = grouped && LABEL_AGNOSTIC_FUNCS.contains(&func.name);
            args.args.iter().all(|arg| selectors_grouped(arg, grouped))
        }
        // matching and the duplicate-labelset checks need every label of both operands
        PromExpr::Binary(BinaryExpr { lhs, rhs, .. }) => {
            selectors_grouped(lhs, false) && selectors_grouped(rhs, false)
        }
        PromExpr::Extension(_) => false,
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

    #[test]
    fn test_grouping_labels_suffice() {
        let cases = [
            ("sum by (job) (m)", true),
            ("sum by (job) (rate(m[5m]))", true),
            ("sum by (job) (abs(-m))", true),
            ("sum by (job) (m) / 2", true),
            (
                "sum by (job) (rate(a[5m])) / on (job) sum by (job) (rate(b[5m]))",
                true,
            ),
            ("sum by (job) (max by (job, instance) (m) / 2)", true),
            ("histogram_quantile(0.9, sum by (le) (rate(m[5m])))", true),
            ("count(m) + sum by (job) (n)", true),
            ("topk by (job) (1, sum by (job, instance) (m))", true),
            (
                "label_replace(sum by (job) (m), \"j\", \"$1\", \"job\", \"(.*)\")",
                true,
            ),
            // #14976: an operator inside the aggregation sees series before they are grouped
            ("sum by (job) (m / 2)", false),
            ("sum by (job) (m * 60)", false),
            ("max by (job) (m - 1)", false),
            ("sum by (job) (m + m)", false),
            ("sum by (job) (rate(a[5m]) / rate(b[5m]))", false),
            // a selector outside every grouping aggregation keeps all its labels
            ("sum by (job) (m) + n", false),
            ("m / on (job) group_left n", false),
            ("topk by (job) (1, m)", false),
            ("sum without (instance) (m)", false),
            ("sum by (job) (sum without (instance) (m))", false),
            // #11321: label_replace reads and creates labels outside the grouping
            (
                "count by (new) (label_replace(m, \"new\", \"$1\", \"old\", \"(.*)\"))",
                false,
            ),
            ("sum by (job) (histogram_quantile(0.9, rate(m[5m])))", false),
        ];
        for (query, expected) in cases {
            let expr = promql_parser::parser::parse(query).unwrap();
            assert_eq!(grouping_labels_suffice(&expr), expected, "query: {query}");
        }
    }
}
