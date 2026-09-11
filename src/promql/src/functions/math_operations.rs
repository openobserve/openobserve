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

use config::meta::promql::value::Value;
use datafusion::error::Result;

pub(crate) fn abs(data: Value) -> Result<Value> {
    exec(data, f64::abs)
}

pub(crate) fn ceil(data: Value) -> Result<Value> {
    exec(data, f64::ceil)
}

pub(crate) fn floor(data: Value) -> Result<Value> {
    exec(data, f64::floor)
}

pub(crate) fn exp(data: Value) -> Result<Value> {
    exec(data, f64::exp)
}

pub(crate) fn ln(data: Value) -> Result<Value> {
    exec(data, f64::ln)
}

pub(crate) fn log2(data: Value) -> Result<Value> {
    exec(data, f64::log2)
}

pub(crate) fn log10(data: Value) -> Result<Value> {
    exec(data, f64::log10)
}

pub(crate) fn sqrt(data: Value) -> Result<Value> {
    exec(data, f64::sqrt)
}

pub(crate) fn round(data: Value, to_nearest: f64) -> Result<Value> {
    exec(data, |input| {
        // Prometheus semantics: ties round up, and the inverse keeps e.g. 0.1 steps exact
        let inverse = 1.0 / to_nearest;
        (input * inverse + 0.5).floor() / inverse
    })
}

pub(crate) fn sgn(data: Value) -> Result<Value> {
    exec(data, f64::signum)
}

/// Apply a given simple match function to a float type
fn exec(data: Value, op: impl Fn(f64) -> f64 + Sync) -> Result<Value> {
    super::map_samples(data, "math operation", |sample| op(sample.value))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, Sample, TimeWindow, Value};

    use super::*;

    // Helper function to create a matrix from sample values
    fn create_matrix(eval_ts: i64, values: Vec<f64>) -> Value {
        let range_values: Vec<RangeValue> = values
            .into_iter()
            .map(|val| RangeValue {
                labels: Labels::default(),
                samples: vec![Sample::new(eval_ts, val)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    range: Duration::from_secs(5),
                    offset: Duration::ZERO,
                }),
            })
            .collect();
        Value::Matrix(range_values)
    }

    fn apply(op: impl FnOnce(Value) -> Result<Value>, input: f64) -> f64 {
        let Value::Matrix(matrix) = op(create_matrix(1000, vec![input])).unwrap() else {
            panic!("expected matrix");
        };
        matrix[0].samples[0].value
    }

    #[test]
    fn test_math_operations_values() {
        assert_eq!(apply(abs, -5.0), 5.0);
        assert_eq!(apply(abs, 5.0), 5.0);
        assert_eq!(apply(abs, 0.0), 0.0);

        assert_eq!(apply(ceil, 3.2), 4.0);
        assert_eq!(apply(ceil, 3.0), 3.0);
        assert_eq!(apply(ceil, -3.2), -3.0);

        assert_eq!(apply(floor, 3.2), 3.0);
        assert_eq!(apply(floor, 3.0), 3.0);
        assert_eq!(apply(floor, -3.2), -4.0);

        assert_eq!(apply(exp, 0.0), 1.0);
        assert_eq!(apply(exp, 1.0), std::f64::consts::E);
        assert_eq!(apply(exp, -1.0), 1.0 / std::f64::consts::E);

        assert_eq!(apply(ln, 1.0), 0.0);
        assert_eq!(apply(ln, std::f64::consts::E), 1.0);

        assert_eq!(apply(log2, 1.0), 0.0);
        assert_eq!(apply(log2, 2.0), 1.0);
        assert_eq!(apply(log2, 4.0), 2.0);

        assert_eq!(apply(log10, 1.0), 0.0);
        assert_eq!(apply(log10, 10.0), 1.0);
        assert_eq!(apply(log10, 100.0), 2.0);

        assert_eq!(apply(sqrt, 0.0), 0.0);
        assert_eq!(apply(sqrt, 1.0), 1.0);
        assert_eq!(apply(sqrt, 4.0), 2.0);

        let round = |input| apply(|data| super::round(data, 1.0), input);
        assert_eq!(round(3.2), 3.0);
        assert_eq!(round(3.5), 4.0);
        assert_eq!(round(3.7), 4.0);
        assert_eq!(round(-3.2), -3.0);
        assert_eq!(round(-3.5), -3.0);
        let round = |input| apply(|data| super::round(data, 0.5), input);
        assert_eq!(round(3.2), 3.0);
        assert_eq!(round(3.25), 3.5);
        assert_eq!(round(3.7), 3.5);
        assert_eq!(round(-3.2), -3.0);
        let round = |input| apply(|data| super::round(data, 0.1), input);
        assert_eq!(round(2.345), 2.3);
        assert_eq!(round(0.3), 0.3);
        let round = |input| apply(|data| super::round(data, 5.0), input);
        assert_eq!(round(12.5), 15.0);
        assert_eq!(round(12.4), 10.0);

        assert_eq!(apply(sgn, 5.0), 1.0);
        assert_eq!(apply(sgn, 0.0), 1.0);
        assert_eq!(apply(sgn, -5.0), -1.0);
    }

    #[test]
    fn test_abs() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![-5.0, 3.0]);
        let result = abs(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 2);
            assert_eq!(result_matrix[0].samples[0].value, 5.0);
            assert_eq!(result_matrix[1].samples[0].value, 3.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_ceil() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![3.2, -3.2]);
        let result = ceil(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 2);
            assert_eq!(result_matrix[0].samples[0].value, 4.0);
            assert_eq!(result_matrix[1].samples[0].value, -3.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_floor() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![3.2, -3.2]);
        let result = floor(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 2);
            assert_eq!(result_matrix[0].samples[0].value, 3.0);
            assert_eq!(result_matrix[1].samples[0].value, -4.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_exp() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![0.0, 1.0]);
        let result = exp(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 2);
            assert_eq!(result_matrix[0].samples[0].value, 1.0);
            assert_eq!(result_matrix[1].samples[0].value, std::f64::consts::E);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_ln() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![1.0, std::f64::consts::E]);
        let result = ln(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 2);
            assert_eq!(result_matrix[0].samples[0].value, 0.0);
            assert_eq!(result_matrix[1].samples[0].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_log2() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![1.0, 2.0, 4.0]);
        let result = log2(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 3);
            assert_eq!(result_matrix[0].samples[0].value, 0.0);
            assert_eq!(result_matrix[1].samples[0].value, 1.0);
            assert_eq!(result_matrix[2].samples[0].value, 2.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_log10() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![1.0, 10.0, 100.0]);
        let result = log10(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 3);
            assert_eq!(result_matrix[0].samples[0].value, 0.0);
            assert_eq!(result_matrix[1].samples[0].value, 1.0);
            assert_eq!(result_matrix[2].samples[0].value, 2.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_sqrt() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![0.0, 1.0, 4.0]);
        let result = sqrt(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 3);
            assert_eq!(result_matrix[0].samples[0].value, 0.0);
            assert_eq!(result_matrix[1].samples[0].value, 1.0);
            assert_eq!(result_matrix[2].samples[0].value, 2.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_round() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![3.2, 3.5, -3.2]);
        let result = round(value, 1.0).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 3);
            assert_eq!(result_matrix[0].samples[0].value, 3.0);
            assert_eq!(result_matrix[1].samples[0].value, 4.0);
            assert_eq!(result_matrix[2].samples[0].value, -3.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_sgn() {
        let eval_ts = 1000;
        let value = create_matrix(eval_ts, vec![5.0, -5.0, 0.0]);
        let result = sgn(value).unwrap();

        if let Value::Matrix(result_matrix) = result {
            assert_eq!(result_matrix.len(), 3);
            assert_eq!(result_matrix[0].samples[0].value, 1.0);
            assert_eq!(result_matrix[1].samples[0].value, -1.0);
            assert_eq!(result_matrix[2].samples[0].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_none_value() {
        let value = Value::None;
        let result = abs(value).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_invalid_input() {
        let value = Value::Float(5.0);
        let result = abs(value);
        assert!(result.is_err());
    }
}
