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

use config::{
    meta::promql::value::{EvalContext, Value},
    utils::sort::sort_float_nan_last,
};
use datafusion::error::{DataFusionError, Result};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#sort
pub(crate) fn sort(data: Value, descending: bool, eval_ctx: &EvalContext) -> Result<Value> {
    let mut matrix = match data {
        Value::Matrix(m) => m,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "Unexpected input. Expected: \"sort(v instant-vector)\"".into(),
            ));
        }
    };
    // Prometheus orders range-query series by labels, so sort only acts on instant queries.
    if eval_ctx.is_instant() {
        matrix.retain(|rv| !rv.samples.is_empty());
        matrix.sort_by(|a, b| {
            sort_float_nan_last(&a.samples[0].value, &b.samples[0].value, descending)
        });
    }
    Ok(Value::Matrix(matrix))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{Label, RangeValue, Sample};

    use super::*;

    fn series(name: &str, values: &[f64]) -> RangeValue {
        RangeValue {
            labels: vec![Arc::new(Label::new("name", name))],
            samples: values
                .iter()
                .enumerate()
                .map(|(i, v)| Sample::new(1000 + i as i64 * 100, *v))
                .collect(),
            exemplars: None,
            time_window: None,
        }
    }

    fn names(value: Value) -> Vec<String> {
        match value {
            Value::Matrix(m) => m.iter().map(|rv| rv.labels[0].value.clone()).collect(),
            _ => panic!("Expected Matrix result"),
        }
    }

    fn instant_ctx() -> EvalContext {
        EvalContext::new(1000, 1000, 0, "trace".to_string())
    }

    #[test]
    fn test_sort_ascending_and_descending() {
        let input = || {
            Value::Matrix(vec![
                series("b", &[2.0]),
                series("c", &[3.0]),
                series("a", &[1.0]),
            ])
        };
        let asc = sort(input(), false, &instant_ctx()).unwrap();
        assert_eq!(names(asc), ["a", "b", "c"]);
        let desc = sort(input(), true, &instant_ctx()).unwrap();
        assert_eq!(names(desc), ["c", "b", "a"]);
    }

    #[test]
    fn test_sort_preserves_labels_and_values() {
        let input = Value::Matrix(vec![series("b", &[2.0]), series("a", &[-1.5])]);
        let Value::Matrix(m) = sort(input, false, &instant_ctx()).unwrap() else {
            panic!("Expected Matrix result");
        };
        assert_eq!(m[0].labels[0].value, "a");
        assert_eq!(m[0].samples[0].value, -1.5);
        assert_eq!(m[1].labels[0].value, "b");
        assert_eq!(m[1].samples[0].value, 2.0);
    }

    #[test]
    fn test_sort_nan_last_in_both_directions() {
        let input = || {
            Value::Matrix(vec![
                series("nan", &[f64::NAN]),
                series("inf", &[f64::INFINITY]),
                series("neg_inf", &[f64::NEG_INFINITY]),
                series("one", &[1.0]),
            ])
        };
        let asc = sort(input(), false, &instant_ctx()).unwrap();
        assert_eq!(names(asc), ["neg_inf", "one", "inf", "nan"]);
        let desc = sort(input(), true, &instant_ctx()).unwrap();
        assert_eq!(names(desc), ["inf", "one", "neg_inf", "nan"]);
    }

    #[test]
    fn test_sort_empty_inputs() {
        assert!(matches!(
            sort(Value::None, false, &instant_ctx()).unwrap(),
            Value::None
        ));
        let empty = sort(Value::Matrix(vec![]), true, &instant_ctx()).unwrap();
        assert!(names(empty).is_empty());
        let no_samples =
            sort(Value::Matrix(vec![series("a", &[])]), false, &instant_ctx()).unwrap();
        assert!(names(no_samples).is_empty());
    }

    #[test]
    fn test_sort_range_query_keeps_input_order() {
        let ctx = EvalContext::new(1000, 1100, 100, "trace".to_string());
        let input = Value::Matrix(vec![series("b", &[2.0, 0.0]), series("a", &[1.0, 5.0])]);
        assert_eq!(names(sort(input, false, &ctx).unwrap()), ["b", "a"]);
    }

    #[test]
    fn test_sort_invalid_input_returns_err() {
        assert!(sort(Value::Float(1.0), false, &instant_ctx()).is_err());
    }
}
