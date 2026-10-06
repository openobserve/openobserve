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

use hashbrown::HashSet;
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
const LABEL_AGNOSTIC_FUNCS: [&str; 64] = [
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
    "timestamp",
    "sort",
    "sort_desc",
    "day_of_month",
    "day_of_week",
    "day_of_year",
    "days_in_month",
    "hour",
    "minute",
    "month",
    "year",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "sinh",
    "cosh",
    "tanh",
    "asinh",
    "acosh",
    "atanh",
    "deg",
    "rad",
    "first_over_time",
    "mad_over_time",
    "ts_of_min_over_time",
    "ts_of_max_over_time",
    "ts_of_last_over_time",
    "ts_of_first_over_time",
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

/// The label columns that keep series apart until they are grouped; empty means every label.
pub fn grouping_labels(expr: &PromExpr) -> HashSet<String> {
    let mut labels = HashSet::new();
    if !selectors_grouped(expr, false, &mut labels) {
        labels.clear();
    }
    labels
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

fn selectors_grouped(expr: &PromExpr, grouped: bool, labels: &mut HashSet<String>) -> bool {
    match expr {
        PromExpr::VectorSelector(_) | PromExpr::MatrixSelector(_) => grouped,
        PromExpr::NumberLiteral(_) | PromExpr::StringLiteral(_) => true,
        PromExpr::Paren(ParenExpr { expr }) | PromExpr::Unary(UnaryExpr { expr }) => {
            selectors_grouped(expr, grouped, labels)
        }
        PromExpr::Subquery(subquery) => selectors_grouped(&subquery.expr, grouped, labels),
        PromExpr::Aggregate(AggregateExpr {
            op,
            expr,
            param,
            modifier,
        }) => {
            // selecting aggregations and `without` keep labels that were never loaded
            let collapses = !matches!(
                op.id(),
                token::T_TOPK | token::T_BOTTOMK | token::T_LIMITK | token::T_LIMIT_RATIO
            ) && !matches!(modifier, Some(LabelModifier::Exclude(_)));
            if collapses && let Some(LabelModifier::Include(by)) = modifier {
                labels.extend(by.labels.iter().cloned());
            }
            selectors_grouped(expr, collapses, labels)
                && param
                    .as_deref()
                    .is_none_or(|param| selectors_grouped(param, false, labels))
        }
        PromExpr::Call(Call { func, args }) => {
            let grouped = grouped && LABEL_AGNOSTIC_FUNCS.contains(&func.name);
            args.args
                .iter()
                .all(|arg| selectors_grouped(arg, grouped, labels))
        }
        // matching and the duplicate-labelset checks need every label of both operands
        PromExpr::Binary(BinaryExpr { lhs, rhs, .. }) => {
            selectors_grouped(lhs, false, labels) && selectors_grouped(rhs, false, labels)
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
            ("sum(deg(atan(metric)))", true),
            ("max(ts_of_max_over_time(metric[5m]))", true),
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
    fn test_grouping_labels() {
        let cases: [(&str, &[&str]); 33] = [
            ("sum by (job) (m)", &["job"]),
            ("sum by (job) (rate(m[5m]))", &["job"]),
            ("sum by (job) (abs(-m))", &["job"]),
            ("max by (job) (timestamp(m))", &["job"]),
            ("count by (job) (hour(m))", &["job"]),
            ("sum by (job) (m) / 2", &["job"]),
            (
                "sum by (job) (rate(a[5m])) / on (job) sum by (job) (rate(b[5m]))",
                &["job"],
            ),
            (
                "sum by (job) (a) / on (job, instance) sum by (job) (b)",
                &["job"],
            ),
            (
                "sum by (job) (max by (job, instance) (m) / 2)",
                &["instance", "job"],
            ),
            (
                "histogram_quantile(0.9, sum by (le) (rate(m[5m])))",
                &["le"],
            ),
            ("count(m) + sum by (job) (n)", &["job"]),
            (
                "topk by (region) (1, sum by (job, instance) (m))",
                &["instance", "job"],
            ),
            (
                "label_replace(sum by (job) (m), \"j\", \"$1\", \"job\", \"(.*)\")",
                &["job"],
            ),
            ("sum(m)", &[]),
            // #14976: an operator inside the aggregation sees series before they are grouped
            ("sum by (job) (m / 2)", &[]),
            ("sum by (job) (m * 60)", &[]),
            ("max by (job) (m - 1)", &[]),
            ("sum by (job) (m + m)", &[]),
            ("sum by (job) (rate(a[5m]) / rate(b[5m]))", &[]),
            ("sum by (job) (a * on (pod) group_left (job) b)", &[]),
            // a selector outside every grouping aggregation keeps all its labels
            ("sum by (job) (m) + n", &[]),
            ("m / on (job) group_left n", &[]),
            ("topk by (job) (1, m)", &[]),
            ("limitk by (job) (1, m)", &[]),
            ("limit_ratio by (job) (0.5, m)", &[]),
            (
                "limitk by (region) (1, sum by (job, instance) (m))",
                &["instance", "job"],
            ),
            ("sum without (instance) (m)", &[]),
            ("sum by (job) (sum without (instance) (m))", &[]),
            ("quantile by (job) (scalar(q), m)", &[]),
            // #11321: label_replace reads and creates labels outside the grouping
            (
                "count by (new) (label_replace(m, \"new\", \"$1\", \"old\", \"(.*)\"))",
                &[],
            ),
            ("sum by (job) (histogram_quantile(0.9, rate(m[5m])))", &[]),
            ("m", &[]),
            ("rate(m[5m])", &[]),
        ];
        for (query, expected) in cases {
            let expr = promql_parser::parser::parse(query).unwrap();
            let mut labels: Vec<_> = grouping_labels(&expr).into_iter().collect();
            labels.sort();
            assert_eq!(labels, expected, "query: {query}");
        }
    }
}
