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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: Value, min: f64, max: f64) -> Result<Value> {
    match data {
        Value::Matrix(matrix) => {
            let out: Vec<RangeValue> = matrix
                .into_par_iter()
                .map(|mut range_value| {
                    // Apply clamp to all samples in this range
                    let samples: Vec<Sample> = range_value
                        .samples
                        .into_iter()
                        .map(|sample| {
                            let val = sample.value.clamp(min, max);
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
            "Invalid input for clamp, expected matrix but got: {:?}",
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
    fn test_clamp_function() {
        let eval_ts = 1000;
        let matrix = create_matrix(eval_ts, vec![5.0, 15.0, 25.0]);
        let result = clamp(matrix, 10.0, 20.0).unwrap();

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
