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

use std::sync::OnceLock;

use config::{
    meta::promql::NAME_LABEL,
    utils::{flatten::format_label_name_owned, schema::format_stream_name},
};
use promql_parser::{
    label::{Labels, MatchOp, Matcher},
    parser::{
        self, Expr, Function, LabelModifier, VectorMatchCardinality, VectorSelector,
        function::register_extra_functions, value::ValueType,
    },
    util::ExprVisitor,
};

static LEGACY_FUNCTIONS: OnceLock<Result<(), String>> = OnceLock::new();

struct SupportedModifiers;

impl ExprVisitor for SupportedModifiers {
    type Error = String;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        if let Expr::Binary(binary) = expr
            && let Some(modifier) = &binary.modifier
            && (modifier.fill_values.lhs.is_some() || modifier.fill_values.rhs.is_some())
        {
            return Err("Unsupported binary fill modifier".to_string());
        }
        Ok(true)
    }
}

/// Preserves the legacy smoothing function, rejects modifiers the evaluator cannot execute, and
/// rewrites metric and label names to the form ingest stores them in.
pub fn parse(query: &str) -> Result<Expr, String> {
    LEGACY_FUNCTIONS
        .get_or_init(|| {
            register_extra_functions(vec![Function::new(
                "holt_winters",
                vec![ValueType::Matrix, ValueType::Scalar, ValueType::Scalar],
                0,
                ValueType::Vector,
                false,
            )])
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let mut expr = parser::parse(query)?;
    crate::ast::visitor::walk_expr(&mut SupportedModifiers, &expr)?;
    normalize_names(&mut expr);
    Ok(expr)
}

fn normalize_names(expr: &mut Expr) {
    match expr {
        Expr::VectorSelector(vs) => normalize_selector(vs),
        Expr::MatrixSelector(ms) => normalize_selector(&mut ms.vs),
        Expr::Aggregate(agg) => {
            normalize_names(&mut agg.expr);
            match agg.param.as_deref_mut() {
                // only count_values takes a string parameter, and it names the output label
                Some(Expr::StringLiteral(label)) => normalize_label(&mut label.val),
                Some(param) => normalize_names(param),
                None => {}
            }
            if let Some(modifier) = &mut agg.modifier {
                normalize_modifier(modifier);
            }
        }
        Expr::Binary(binary) => {
            normalize_names(&mut binary.lhs);
            normalize_names(&mut binary.rhs);
            if let Some(modifier) = &mut binary.modifier {
                if let Some(matching) = &mut modifier.matching {
                    normalize_modifier(matching);
                }
                if let VectorMatchCardinality::ManyToOne(labels)
                | VectorMatchCardinality::OneToMany(labels) = &mut modifier.card
                {
                    normalize_labels(labels);
                }
            }
        }
        Expr::Call(call) => {
            let func = call.func.name;
            for (index, arg) in call.args.args.iter_mut().enumerate() {
                match &mut **arg {
                    Expr::StringLiteral(label) if is_label_arg(func, index) => {
                        normalize_label(&mut label.val)
                    }
                    arg => normalize_names(arg),
                }
            }
        }
        Expr::Unary(unary) => normalize_names(&mut unary.expr),
        Expr::Paren(paren) => normalize_names(&mut paren.expr),
        Expr::Subquery(sq) => normalize_names(&mut sq.expr),
        Expr::NumberLiteral(_) | Expr::StringLiteral(_) | Expr::Extension(_) => {}
    }
}

fn normalize_selector(vs: &mut VectorSelector) {
    if let Some(name) = vs.name.take() {
        vs.name = Some(format_stream_name(name));
    }
    let or_matchers = vs.matchers.or_matchers.iter_mut().flatten();
    for matcher in vs.matchers.matchers.iter_mut().chain(or_matchers) {
        normalize_matcher(matcher);
    }
}

fn normalize_matcher(matcher: &mut Matcher) {
    normalize_label(&mut matcher.name);
    // a regex cannot be rewritten safely, so only a literal metric name is normalized
    if matcher.name == NAME_LABEL && matches!(matcher.op, MatchOp::Equal | MatchOp::NotEqual) {
        matcher.value = format_stream_name(std::mem::take(&mut matcher.value));
    }
}

fn normalize_modifier(modifier: &mut LabelModifier) {
    match modifier {
        LabelModifier::Include(labels) | LabelModifier::Exclude(labels) => normalize_labels(labels),
    }
}

fn normalize_labels(labels: &mut Labels) {
    labels.labels.iter_mut().for_each(normalize_label);
}

fn normalize_label(label: &mut String) {
    *label = format_label_name_owned(std::mem::take(label));
}

/// Whether argument `index` of `func` is a label name rather than a value.
fn is_label_arg(func: &str, index: usize) -> bool {
    match func {
        "label_replace" => index == 1 || index == 3,
        "label_join" => index == 1 || index >= 3,
        "sort_by_label" | "sort_by_label_desc" => index >= 1,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoothing_functions_preserve_names_when_formatted() {
        for name in ["holt_winters", "double_exponential_smoothing"] {
            let query = format!("{name}(m[5m], 0.5, 0.3)");
            let expr = parse(&query).unwrap();
            assert_eq!(expr.to_string(), query);
            assert_eq!(expr.prettify(), query);
            assert_eq!(parse(&expr.to_string()).unwrap(), expr);
        }
    }

    #[test]
    fn smoothing_functions_name_the_called_function_in_arity_errors() {
        for name in ["holt_winters", "double_exponential_smoothing"] {
            for args in ["m[5m], 0.5", "m[5m], 0.5, 0.3, 0.1"] {
                let error = parse(&format!("{name}({args})")).unwrap_err();
                assert!(error.contains(&format!("call to '{name}'")), "{error}");
            }
        }
    }

    #[test]
    fn binary_fill_modifiers_are_rejected_at_every_depth() {
        for query in [
            "a + fill(0) b",
            "a + fill_left(0) b",
            "sum(a + fill_right(0) b)",
            "topk(scalar(a + fill(0) b), c)",
        ] {
            assert!(parser::parse(query).is_ok(), "{query}");
            assert_eq!(
                parse(query).unwrap_err(),
                "Unsupported binary fill modifier"
            );
        }
        assert!(parse("fill + fill_left + fill_right").is_ok());
    }

    #[test]
    fn names_are_normalized_like_ingest() {
        for (query, expected) in [
            (
                r#"DCGM_FI_DEV_GPU_TEMP{UUID="GPU-1", modelName=~"A.*"}"#,
                r#"dcgm_fi_dev_gpu_temp{uuid="GPU-1", modelname=~"A.*"}"#,
            ),
            (
                r#"m{Job="a" or Instance!="B"}"#,
                r#"m{job="a" or instance!="B"}"#,
            ),
            (
                r#"{__name__="PortXmitData", Port="1"}"#,
                r#"{__name__="portxmitdata", port="1"}"#,
            ),
            (r#"{__name__=~"DCGM_.*"}"#, r#"{__name__=~"DCGM_.*"}"#),
            (
                "rate(PortXmitDataExtended[1m])",
                "rate(portxmitdataextended[1m])",
            ),
            ("count by (UUID) (m)", "count by (uuid) (m)"),
            (
                "sum without (UUID, pci_bus_id) (m)",
                "sum without (uuid, pci_bus_id) (m)",
            ),
            (
                "x * on (UUID) group_left (modelName) y",
                "x * on (uuid) group_left (modelname) y",
            ),
            (
                "x / ignoring (GPU) group_right y",
                "x / ignoring (gpu) group_right y",
            ),
            (
                r#"count_values("Version", m)"#,
                r#"count_values("version", m)"#,
            ),
            ("topk(5, M)", "topk(5, m)"),
            (
                r#"label_replace(m, "DST", "$1-X", "SRC_Label", "(A.*)")"#,
                r#"label_replace(m, "dst", "$1-X", "src_label", "(A.*)")"#,
            ),
            (
                r#"label_join(m, "Out", "-", "A", "B")"#,
                r#"label_join(m, "out", "-", "a", "b")"#,
            ),
            (r#"sort_by_label(m, "UUID")"#, r#"sort_by_label(m, "uuid")"#),
            ("max_over_time(M[5m:1m])", "max_over_time(m[5m:1m])"),
        ] {
            assert_eq!(
                parse(query).unwrap(),
                parser::parse(expected).unwrap(),
                "{query}"
            );
        }
    }
}
