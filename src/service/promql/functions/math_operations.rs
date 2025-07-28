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

use datafusion::error::{DataFusionError, Result};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use strum::EnumIter;

use crate::service::promql::value::{InstantValue, Sample, Value};

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
        Value::Vector(v) => {
            let out = v
                .into_par_iter()
                .map(|mut instant| {
                    let val = op.apply(instant.sample.value);
                    InstantValue {
                        labels: std::mem::take(&mut instant.labels),
                        sample: Sample::new(instant.sample.timestamp, val),
                    }
                })
                .collect();
            Ok(Value::Vector(out))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::NotImplemented(format!(
            "Invalid input for minute value: {data:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::promql::value::{InstantValue, Labels, Sample, Value};

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
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, -5.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 3.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = abs(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 2);
            assert_eq!(result_vector[0].sample.value, 5.0);
            assert_eq!(result_vector[1].sample.value, 3.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_ceil() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 3.2),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, -3.2),
            },
        ];
        let value = Value::Vector(vector);
        let result = ceil(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 2);
            assert_eq!(result_vector[0].sample.value, 4.0);
            assert_eq!(result_vector[1].sample.value, -3.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_floor() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 3.2),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, -3.2),
            },
        ];
        let value = Value::Vector(vector);
        let result = floor(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 2);
            assert_eq!(result_vector[0].sample.value, 3.0);
            assert_eq!(result_vector[1].sample.value, -4.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_exp() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 0.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 1.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = exp(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 2);
            assert_eq!(result_vector[0].sample.value, 1.0);
            assert_eq!(result_vector[1].sample.value, std::f64::consts::E);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_ln() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, std::f64::consts::E),
            },
        ];
        let value = Value::Vector(vector);
        let result = ln(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 2);
            assert_eq!(result_vector[0].sample.value, 0.0);
            assert_eq!(result_vector[1].sample.value, 1.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_log2() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 2.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(3000, 4.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = log2(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 3);
            assert_eq!(result_vector[0].sample.value, 0.0);
            assert_eq!(result_vector[1].sample.value, 1.0);
            assert_eq!(result_vector[2].sample.value, 2.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_log10() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 1.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 10.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(3000, 100.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = log10(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 3);
            assert_eq!(result_vector[0].sample.value, 0.0);
            assert_eq!(result_vector[1].sample.value, 1.0);
            assert_eq!(result_vector[2].sample.value, 2.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_sqrt() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 0.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 1.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(3000, 4.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = sqrt(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 3);
            assert_eq!(result_vector[0].sample.value, 0.0);
            assert_eq!(result_vector[1].sample.value, 1.0);
            assert_eq!(result_vector[2].sample.value, 2.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_round() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 3.2),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, 3.5),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(3000, -3.2),
            },
        ];
        let value = Value::Vector(vector);
        let result = round(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 3);
            assert_eq!(result_vector[0].sample.value, 3.0);
            assert_eq!(result_vector[1].sample.value, 4.0);
            assert_eq!(result_vector[2].sample.value, -3.0);
        } else {
            panic!("Expected Vector result");
        }
    }

    #[test]
    fn test_sgn() {
        let vector = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(1000, 5.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(2000, -5.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(3000, 0.0),
            },
        ];
        let value = Value::Vector(vector);
        let result = sgn(value).unwrap();

        if let Value::Vector(result_vector) = result {
            assert_eq!(result_vector.len(), 3);
            assert_eq!(result_vector[0].sample.value, 1.0);
            assert_eq!(result_vector[1].sample.value, -1.0);
            assert_eq!(result_vector[2].sample.value, 1.0);
        } else {
            panic!("Expected Vector result");
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
