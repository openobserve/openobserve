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

use crate::service::promql::value::{InstantValue, Sample, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: Value, min: f64, max: f64) -> Result<Value> {
    let vec = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "clamp: InstantValue argument expected".into(),
            ));
        }
    };

    let out = vec
        .into_iter()
        .map(|mut instant| {
            let value = instant.sample.value.clamp(min, max);
            InstantValue {
                labels: std::mem::take(&mut instant.labels),
                sample: Sample::new(instant.sample.timestamp, value),
            }
        })
        .collect();
    Ok(Value::Vector(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::promql::value::Labels;

    #[test]
    fn test_clamp_function() {
        let eval_ts = 1000;

        // Test clamping values within range
        let instant_values = vec![
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(eval_ts, 5.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(eval_ts, 15.0),
            },
            InstantValue {
                labels: Labels::default(),
                sample: Sample::new(eval_ts, 25.0),
            },
        ];

        let vector = Value::Vector(instant_values);
        let result = clamp(vector, 10.0, 20.0).unwrap();

        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 3);
                // 5.0 should be clamped to 10.0
                assert!((v[0].sample.value - 10.0).abs() < 0.001);
                // 15.0 should remain 15.0
                assert!((v[1].sample.value - 15.0).abs() < 0.001);
                // 25.0 should be clamped to 20.0
                assert!((v[2].sample.value - 20.0).abs() < 0.001);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
