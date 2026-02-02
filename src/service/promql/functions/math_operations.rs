// Copyright 2025 OpenObserve Inc.
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

use config::meta::promql::value::{LabelsExt, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use strum::EnumIter;

#[derive(Debug, EnumIter)]
pub enum MathOperationsType {
    Abs,
    Ceil,
    Exp,
    Floor,
    Ln,
    Log10,
    Log2,
    Round,
    Sgn,
    Sqrt,
}

impl MathOperationsType {
    /// Apply a given simple match function to a float type
    pub fn apply(&self, input: f64) -> f64 {
        match self {
            Self::Abs => input.abs(),
            Self::Ceil => input.ceil(),
            Self::Exp => input.exp(),
            Self::Floor => input.floor(),
            Self::Ln => input.ln(),
            Self::Log2 => input.log2(),
            Self::Log10 => input.log10(),
            Self::Sgn => input.signum(),
            Self::Sqrt => input.sqrt(),
            Self::Round => input.round(),
        }
    }
}

pub(crate) fn abs(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Abs)
}

pub(crate) fn ceil(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Ceil)
}

pub(crate) fn floor(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Floor)
}

pub(crate) fn exp(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Exp)
}

pub(crate) fn ln(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Ln)
}

pub(crate) fn log2(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Log2)
}

pub(crate) fn log10(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Log10)
}

pub(crate) fn sqrt(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Sqrt)
}

pub(crate) fn round(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Round)
}

pub(crate) fn sgn(data: Value) -> Result<Value> {
    exec(data, &MathOperationsType::Sgn)
}

fn exec(data: Value, op: &MathOperationsType) -> Result<Value> {
    match data {
        Value::Matrix(matrix) => {
            let out: Vec<RangeValue> = matrix
                .into_par_iter()
                .map(|mut range_value| {
                    // Apply the math operation to all samples in this range
                    let samples: Vec<Sample> = range_value
                        .samples
                        .into_iter()
                        .map(|sample| {
                            let val = op.apply(sample.value);
                            Sample::new(sample.timestamp, val)
                        })
                        .collect();

                    RangeValue {
                        labels: std::mem::take(&mut range_value.labels).without_metric_name(),
                        samples,
                        exemplars: range_value.exemplars,
                        time_window: range_value.time_window,
                    }
                })
                .collect();
            Ok(Value::Matrix(out))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::Plan(format!(
            "Invalid input for math operation, expected matrix but got: {:?}",
            data.get_type()
        ))),
    }
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

    #[test]
    fn test_math_operations_type_apply() {
        assert_eq!(MathOperationsType::Abs.apply(-5.0), 5.0);
        assert_eq!(MathOperationsType::Abs.apply(5.0), 5.0);
        assert_eq!(MathOperationsType::Abs.apply(0.0), 0.0);

        assert_eq!(MathOperationsType::Ceil.apply(3.2), 4.0);
        assert_eq!(MathOperationsType::Ceil.apply(3.0), 3.0);
        assert_eq!(MathOperationsType::Ceil.apply(-3.2), -3.0);

        assert_eq!(MathOperationsType::Floor.apply(3.2), 3.0);
        assert_eq!(MathOperationsType::Floor.apply(3.0), 3.0);
        assert_eq!(MathOperationsType::Floor.apply(-3.2), -4.0);

        assert_eq!(MathOperationsType::Exp.apply(0.0), 1.0);
        assert_eq!(MathOperationsType::Exp.apply(1.0), std::f64::consts::E);
        assert_eq!(
            MathOperationsType::Exp.apply(-1.0),
            1.0 / std::f64::consts::E
        );

        assert_eq!(MathOperationsType::Ln.apply(1.0), 0.0);
        assert_eq!(MathOperationsType::Ln.apply(std::f64::consts::E), 1.0);

        assert_eq!(MathOperationsType::Log2.apply(1.0), 0.0);
        assert_eq!(MathOperationsType::Log2.apply(2.0), 1.0);
        assert_eq!(MathOperationsType::Log2.apply(4.0), 2.0);

        assert_eq!(MathOperationsType::Log10.apply(1.0), 0.0);
        assert_eq!(MathOperationsType::Log10.apply(10.0), 1.0);
        assert_eq!(MathOperationsType::Log10.apply(100.0), 2.0);

        assert_eq!(MathOperationsType::Sqrt.apply(0.0), 0.0);
        assert_eq!(MathOperationsType::Sqrt.apply(1.0), 1.0);
        assert_eq!(MathOperationsType::Sqrt.apply(4.0), 2.0);

        assert_eq!(MathOperationsType::Round.apply(3.2), 3.0);
        assert_eq!(MathOperationsType::Round.apply(3.5), 4.0);
        assert_eq!(MathOperationsType::Round.apply(3.7), 4.0);
        assert_eq!(MathOperationsType::Round.apply(-3.2), -3.0);
        assert_eq!(MathOperationsType::Round.apply(-3.5), -4.0);

        assert_eq!(MathOperationsType::Sgn.apply(5.0), 1.0);
        assert_eq!(MathOperationsType::Sgn.apply(0.0), 1.0);
        assert_eq!(MathOperationsType::Sgn.apply(-5.0), -1.0);
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
        let result = round(value).unwrap();

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
