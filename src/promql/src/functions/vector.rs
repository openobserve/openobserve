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

pub(crate) fn vector(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let value = match data {
        Value::Float(f) => f,
        _ => {
            return Err(DataFusionError::Plan(
                "Unexpected input. Expected: \"vector(s scalar)\"".into(),
            ));
        }
    };

    // Generate samples using timestamps from eval_ctx
    let samples: Vec<Sample> = eval_ctx
        .timestamps()
        .iter()
        .map(|&ts| Sample::new(ts, value))
        .collect();

    // Create a matrix with a single RangeValue containing all generated samples
    let range_value = RangeValue {
        labels: Labels::default(),
        samples,
        exemplars: None,
        time_window: None,
    };

    Ok(Value::Matrix(vec![range_value]))
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
    fn test_vector_float_produces_matrix() {
        let result = vector(Value::Float(7.0), &instant_ctx()).unwrap();
        let Value::Matrix(ranges) = result else {
            panic!("expected Matrix");
        };
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].samples.len(), 1);
        assert_eq!(ranges[0].samples[0].value, 7.0);
    }

    #[test]
    fn test_vector_range_produces_correct_sample_count() {
        let ctx = range_ctx();
        let result = vector(Value::Float(3.0), &ctx).unwrap();
        let Value::Matrix(ranges) = result else {
            panic!("expected Matrix");
        };
        assert_eq!(ranges[0].samples.len(), 3);
        assert!(ranges[0].samples.iter().all(|s| s.value == 3.0));
    }

    #[test]
    fn test_vector_non_float_returns_error() {
        let result = vector(Value::None, &instant_ctx());
        assert!(result.is_err());
    }
}
