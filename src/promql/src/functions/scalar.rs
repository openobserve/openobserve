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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#scalar
pub(crate) fn scalar(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let matrix = match data {
        Value::Float(_) => return Ok(data),
        Value::Matrix(matrix) => matrix,
        Value::None => Vec::new(),
        _ => {
            return Err(DataFusionError::Plan(
                "Unexpected input. Expected: \"vector(s scalar)\"".into(),
            ));
        }
    };

    let timestamps = eval_ctx.timestamps();
    let mut counts = vec![0u32; timestamps.len()];
    let mut values = vec![f64::NAN; timestamps.len()];
    for sample in matrix.iter().flat_map(|series| &series.samples) {
        if let Ok(step) = timestamps.binary_search(&sample.timestamp) {
            counts[step] += 1;
            values[step] = sample.value;
        }
    }
    // a series can report at some steps and not others, so the element count belongs to a step
    for (value, count) in values.iter_mut().zip(counts) {
        if count != 1 {
            *value = f64::NAN;
        }
    }

    // exec and the binary operators only treat a Float as a scalar
    if eval_ctx.is_instant() {
        return Ok(Value::Float(values[0]));
    }

    Ok(Value::Matrix(vec![RangeValue {
        labels: Labels::default(),
        samples: timestamps
            .into_iter()
            .zip(values)
            .map(|(timestamp, value)| Sample::new(timestamp, value))
            .collect(),
        exemplars: None,
        time_window: None,
    }]))
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

    fn series(samples: Vec<Sample>) -> RangeValue {
        RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: None,
        }
    }

    #[test]
    fn test_scalar_of_one_element_is_that_value() {
        let one = Value::Matrix(vec![series(vec![Sample::new(1_000_000, 42.0)])]);
        let result = scalar(one, &instant_ctx()).unwrap();
        assert!(matches!(result, Value::Float(f) if f == 42.0));
    }

    #[test]
    fn test_scalar_of_several_elements_is_nan() {
        let several = Value::Matrix(vec![
            series(vec![Sample::new(1_000_000, 42.0)]),
            series(vec![Sample::new(1_000_000, 7.0)]),
        ]);
        let result = scalar(several, &instant_ctx()).unwrap();
        assert!(
            matches!(result, Value::Float(f) if f.is_nan()),
            "more than one element is not a scalar"
        );
    }

    #[test]
    fn test_scalar_of_no_elements_is_nan() {
        let result = scalar(Value::Matrix(vec![]), &instant_ctx()).unwrap();
        assert!(matches!(result, Value::Float(f) if f.is_nan()));
    }

    #[test]
    fn test_scalar_counts_elements_at_each_step_of_a_range_query() {
        // Two series report at the middle step only, so that step alone is ambiguous.
        let matrix = Value::Matrix(vec![
            series(vec![
                Sample::new(1_000_000, 42.0),
                Sample::new(2_000_000, 42.0),
                Sample::new(3_000_000, 42.0),
            ]),
            series(vec![Sample::new(2_000_000, 7.0)]),
        ]);
        let result = scalar(matrix, &range_ctx()).unwrap();

        let Value::Matrix(ranges) = result else {
            panic!("expected Matrix");
        };
        assert_eq!(ranges.len(), 1);
        let values: Vec<f64> = ranges[0].samples.iter().map(|s| s.value).collect();
        assert_eq!(values[0], 42.0);
        assert!(values[1].is_nan(), "two elements at this step");
        assert_eq!(values[2], 42.0);
    }

    #[test]
    fn test_scalar_unexpected_type_returns_error() {
        let result = scalar(Value::String("oops".into()), &instant_ctx());
        assert!(result.is_err());
    }
}
