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

use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};

pub(crate) fn scalar(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    match data {
        Value::Float(f) => Ok(Value::Float(f)),
        Value::Matrix(v) => Ok(Value::Matrix(v)),
        Value::None => {
            // Generate samples using timestamps from eval_ctx
            let samples: Vec<Sample> = eval_ctx
                .timestamps()
                .iter()
                .map(|&ts| Sample::new(ts, f64::NAN))
                .collect();
            Ok(Value::Matrix(vec![RangeValue {
                labels: Labels::default(),
                samples,
                exemplars: None,
                time_window: None,
            }]))
        }
        _ => Err(DataFusionError::Plan(
            "Unexpected input. Expected: \"vector(s scalar)\"".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::EvalContext;

    use super::*;

    fn instant_ctx() -> EvalContext {
        EvalContext::new(1_000_000, 1_000_000, 1_000_000, "t".into())
    }

    fn range_ctx() -> EvalContext {
        EvalContext::new(1_000_000, 3_000_000, 1_000_000, "t".into())
    }

    #[test]
    fn test_scalar_float_passthrough() {
        let result = scalar(Value::Float(42.0), &instant_ctx()).unwrap();
        assert!(matches!(result, Value::Float(f) if f == 42.0));
    }

    #[test]
    fn test_scalar_none_generates_nan_samples() {
        let ctx = range_ctx();
        let result = scalar(Value::None, &ctx).unwrap();
        let Value::Matrix(ranges) = result else {
            panic!("expected Matrix");
        };
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].samples.len(), 3);
        assert!(ranges[0].samples.iter().all(|s| s.value.is_nan()));
    }

    #[test]
    fn test_scalar_matrix_passthrough() {
        let matrix = Value::Matrix(vec![]);
        let result = scalar(matrix, &instant_ctx()).unwrap();
        assert!(matches!(result, Value::Matrix(_)));
    }

    #[test]
    fn test_scalar_unexpected_type_returns_error() {
        let result = scalar(Value::String("oops".into()), &instant_ctx());
        assert!(result.is_err());
    }
}
