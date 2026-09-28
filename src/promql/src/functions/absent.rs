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

use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    sync::Arc,
};

use config::meta::promql::{
    NAME_LABEL,
    value::{EvalContext, Label, Labels, RangeValue, Sample, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::{label::MatchOp, parser::Expr};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent
/// Returns 1 for each timestamp where the input vector has no data
pub(crate) fn absent(data: Value, labels: Labels, eval_ctx: &EvalContext) -> Result<Value> {
    let matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => vec![],
        _ => {
            return Err(DataFusionError::Plan(format!(
                "Invalid input for absent, expected matrix but got: {:?}",
                data.get_type()
            )));
        }
    };
    let present: BTreeSet<_> = matrix
        .iter()
        .flat_map(|series| series.samples.iter().map(|sample| sample.timestamp))
        .collect();
    Ok(absent_series(
        labels,
        eval_ctx
            .timestamps()
            .into_iter()
            .filter(|timestamp| !present.contains(timestamp)),
    ))
}

/// Prometheus' `createLabelsForAbsentFunction`: a selector's equality matchers, minus repeated
/// names.
pub(crate) fn absent_labels(expr: &Expr) -> Labels {
    let selector = match expr {
        Expr::VectorSelector(vs) => vs,
        Expr::MatrixSelector(ms) => &ms.vs,
        _ => return Labels::default(),
    };
    let mut labels = BTreeMap::new();
    let mut seen = HashSet::new();
    for matcher in &selector.matchers.matchers {
        if matcher.name == NAME_LABEL {
            continue;
        }
        // an empty value unsets the label, as Prometheus' labels.Builder does
        if matches!(matcher.op, MatchOp::Equal)
            && seen.insert(matcher.name.as_str())
            && !matcher.value.is_empty()
        {
            labels.insert(matcher.name.as_str(), matcher.value.as_str());
        } else {
            labels.remove(matcher.name.as_str());
        }
    }
    labels
        .into_iter()
        .map(|(name, value)| {
            Arc::new(Label {
                name: name.to_string(),
                value: value.to_string(),
            })
        })
        .collect()
}

pub(super) fn absent_series(labels: Labels, timestamps: impl Iterator<Item = i64>) -> Value {
    let samples: Vec<_> = timestamps
        .map(|timestamp| Sample::new(timestamp, 1.0))
        .collect();
    if samples.is_empty() {
        return Value::None;
    }
    Value::Matrix(vec![RangeValue {
        labels,
        samples,
        exemplars: None,
        time_window: None,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_absent_instant_with_zero_step() {
        let ctx = EvalContext::new(1_000_000, 1_000_000, 0, "test".into());
        for input in [Value::None, Value::Matrix(vec![])] {
            let Value::Matrix(matrix) = absent(input, Labels::default(), &ctx).unwrap() else {
                panic!("expected one absent sample");
            };
            assert_eq!(matrix.len(), 1);
            assert_eq!(matrix[0].samples.len(), 1);
            assert_eq!(matrix[0].samples[0].timestamp, ctx.start);
            assert_eq!(matrix[0].samples[0].value, 1.0);
        }
        let input = Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: vec![Sample::new(ctx.start, 7.0)],
            exemplars: None,
            time_window: None,
        }]);
        assert!(matches!(
            absent(input, Labels::default(), &ctx).unwrap(),
            Value::None
        ));
    }

    fn create_eval_ctx() -> EvalContext {
        EvalContext::new(
            1000, // start: 1000
            1002, // end: 1002 (3 timestamps: 1000, 1001, 1002)
            1,    // step: 1
            "test".to_string(),
        )
    }

    #[test]
    fn test_absent_with_empty_matrix() {
        // Empty matrix should return 1.0 for all timestamps in range
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![]);
        let result = absent(value, Labels::default(), &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 3); // 3 timestamps: 1000, 1001, 1002
            assert_eq!(samples[0].timestamp, 1000);
            assert_eq!(samples[0].value, 1.0);
            assert_eq!(samples[1].timestamp, 1001);
            assert_eq!(samples[1].value, 1.0);
            assert_eq!(samples[2].timestamp, 1002);
            assert_eq!(samples[2].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_absent_with_none() {
        // None should return 1.0 for all timestamps
        let eval_ctx = create_eval_ctx();
        let value = Value::None;
        let result = absent(value, Labels::default(), &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 3);
            assert_eq!(samples[0].value, 1.0);
            assert_eq!(samples[1].value, 1.0);
            assert_eq!(samples[2].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_absent_with_all_timestamps_present() {
        // When all timestamps have data, should return None
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: vec![
                Sample::new(1000, 42.0),
                Sample::new(1001, 43.0),
                Sample::new(1002, 44.0),
            ],
            exemplars: None,
            time_window: None,
        }]);
        let result = absent(value, Labels::default(), &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_absent_with_partial_data() {
        // When some timestamps have data, should return 1.0 for missing timestamps
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: vec![
                Sample::new(1000, 42.0),
                // 1001 is missing
                Sample::new(1002, 44.0),
            ],
            exemplars: None,
            time_window: None,
        }]);
        let result = absent(value, Labels::default(), &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 1); // Only 1 missing timestamp
            assert_eq!(samples[0].timestamp, 1001);
            assert_eq!(samples[0].value, 1.0);
        } else {
            panic!("Expected Matrix result with missing timestamp");
        }
    }

    #[test]
    fn test_absent_with_invalid_input() {
        // Invalid input type should return error
        let eval_ctx = create_eval_ctx();
        let value = Value::Float(5.0);
        let result = absent(value, Labels::default(), &eval_ctx);
        assert!(result.is_err());
    }

    fn labels_of(query: &str) -> Vec<(String, String)> {
        let Expr::Call(call) = promql_parser::parser::parse(query).unwrap() else {
            panic!("not a call: {query}");
        };
        absent_labels(&call.args.args[0])
            .iter()
            .map(|label| (label.name.clone(), label.value.clone()))
            .collect()
    }

    #[test]
    fn test_absent_labels_follow_equality_matchers() {
        let pairs = |labels: &[(&str, &str)]| -> Vec<(String, String)> {
            labels
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect()
        };
        assert_eq!(labels_of(r#"absent(up{job="x"})"#), pairs(&[("job", "x")]));
        assert_eq!(
            labels_of(r#"absent(up{job="x",instance=~".*",env!="dev",a="1"})"#),
            pairs(&[("a", "1"), ("job", "x")])
        );
        assert_eq!(
            labels_of(r#"absent(up{job="a",job="b",foo="bar"})"#),
            pairs(&[("foo", "bar")])
        );
        assert_eq!(
            labels_of(r#"absent({__name__="up",job="x"})"#),
            pairs(&[("job", "x")])
        );
        assert_eq!(
            labels_of(r#"absent_over_time(up{job="x"}[5m])"#),
            pairs(&[("job", "x")])
        );
        assert!(labels_of(r#"absent(sum(up{job="x"}))"#).is_empty());
        assert_eq!(
            labels_of(r#"absent(up{job="",env="a"})"#),
            pairs(&[("env", "a")])
        );
        assert!(labels_of(r#"absent(up{job="",job="x"})"#).is_empty());
        assert!(labels_of(r#"absent_over_time(up{job="x"}[5m:1m])"#).is_empty());
    }
}
