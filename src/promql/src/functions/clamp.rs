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

use config::meta::promql::value::{LabelsExt, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::prelude::*;

use crate::scalar_param::ScalarParam;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: Value, min: &ScalarParam, max: &ScalarParam) -> Result<Value> {
    let mut matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(format!(
                "Invalid input for clamp, expected matrix but got: {:?}",
                data.get_type()
            )));
        }
    };
    matrix.par_iter_mut().for_each(|series| {
        series.labels = std::mem::take(&mut series.labels).without_metric_name();
        series.samples.retain_mut(|sample| {
            let (min, max) = (min.at(sample.timestamp), max.at(sample.timestamp));
            // Prometheus answers an empty vector at a step whose bounds cross
            if min > max {
                return false;
            }
            sample.value = go_max(min, go_min(max, sample.value));
            true
        });
    });
    matrix.retain(|series| !series.samples.is_empty());
    Ok(Value::Matrix(matrix))
}

// Go's math.Min, which Prometheus clamps with: -Inf wins over NaN, any other NaN propagates.
fn go_min(left: f64, right: f64) -> f64 {
    if left == f64::NEG_INFINITY || right == f64::NEG_INFINITY {
        f64::NEG_INFINITY
    } else if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.min(right)
    }
}

fn go_max(left: f64, right: f64) -> f64 {
    if left == f64::INFINITY || right == f64::INFINITY {
        f64::INFINITY
    } else if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.max(right)
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
    fn test_clamp_value_none_input() {
        let result = clamp(
            Value::None,
            &ScalarParam::Const(0.0),
            &ScalarParam::Const(10.0),
        )
        .unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_clamp_invalid_input_returns_err() {
        let result = clamp(
            Value::Float(5.0),
            &ScalarParam::Const(0.0),
            &ScalarParam::Const(10.0),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_clamp_function() {
        let eval_ts = 1000;
        let matrix = create_matrix(eval_ts, vec![5.0, 15.0, 25.0]);
        let result = clamp(matrix, &ScalarParam::Const(10.0), &ScalarParam::Const(20.0)).unwrap();

        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 3);
                // 5.0 should be clamped to 10.0
                assert!((m[0].samples[0].value - 10.0).abs() < 0.001);
                // 15.0 should remain 15.0
                assert!((m[1].samples[0].value - 15.0).abs() < 0.001);
                // 25.0 should be clamped to 20.0
                assert!((m[2].samples[0].value - 20.0).abs() < 0.001);
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_clamp_bounds_follow_go_min_max() {
        let values = |min: f64, max: f64, input: f64| {
            let Value::Matrix(m) = clamp(
                create_matrix(1000, vec![input]),
                &ScalarParam::Const(min),
                &ScalarParam::Const(max),
            )
            .unwrap() else {
                panic!("Expected Matrix result");
            };
            m.iter()
                .map(|series| series.samples[0].value)
                .collect::<Vec<_>>()
        };
        assert!(values(f64::NAN, 10.0, 5.0)[0].is_nan());
        assert!(values(f64::NEG_INFINITY, f64::NAN, 5.0)[0].is_nan());
        assert_eq!(
            values(f64::NEG_INFINITY, f64::NAN, f64::NEG_INFINITY),
            [f64::NEG_INFINITY]
        );
        assert_eq!(
            values(f64::NAN, f64::INFINITY, f64::INFINITY),
            [f64::INFINITY]
        );
        assert!(values(3.0, 1.0, 2.0).is_empty());
    }
}
