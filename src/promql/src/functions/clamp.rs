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

use super::ScalarArg;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: Value, min: &ScalarArg, max: &ScalarArg) -> Result<Value> {
    let clamped = super::map_samples(data, "clamp", |sample| {
        let (min, max) = (min.at(sample.timestamp), max.at(sample.timestamp));
        // Prometheus' math.Min/Max propagate NaN, where f64::clamp would panic on a NaN bound
        if sample.value.is_nan() || min.is_nan() || max.is_nan() {
            f64::NAN
        } else {
            sample.value.min(max).max(min)
        }
    })?;
    let Value::Matrix(mut matrix) = clamped else {
        return Ok(clamped);
    };
    // Prometheus returns nothing at a step whose max is below its min, and a NaN bound is not below
    for series in &mut matrix {
        series.samples.retain(|sample| {
            let (min, max) = (min.at(sample.timestamp), max.at(sample.timestamp));
            min.is_nan() || max.is_nan() || max >= min
        });
    }
    matrix.retain(|series| !series.samples.is_empty());
    Ok(Value::Matrix(matrix))
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
        let result = clamp(Value::None, &ScalarArg::Value(0.0), &ScalarArg::Value(10.0)).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_clamp_invalid_input_returns_err() {
        let result = clamp(
            Value::Float(5.0),
            &ScalarArg::Value(0.0),
            &ScalarArg::Value(10.0),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_clamp_function() {
        let eval_ts = 1000;
        let matrix = create_matrix(eval_ts, vec![5.0, 15.0, 25.0]);
        let result = clamp(matrix, &ScalarArg::Value(10.0), &ScalarArg::Value(20.0)).unwrap();

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
}
