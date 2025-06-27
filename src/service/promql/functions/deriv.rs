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

use datafusion::error::Result;

use crate::service::promql::{
    common::linear_regression,
    value::{RangeValue, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#deriv
pub(crate) fn deriv(data: Value) -> Result<Value> {
    super::eval_idelta(data, "deriv", exec, false)
}

fn exec(data: RangeValue) -> Option<f64> {
    if data.samples.len() < 2 {
        return None;
    }
    // https://github.com/prometheus/prometheus/issues/2674
    let value = linear_regression(&data.samples, data.samples[0].timestamp / 1000);
    match value {
        Some((slope, _)) => Some(slope),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    #[test]
    fn test_deriv_function() {
        // Create a range value with linear trend
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 20.0),
            crate::service::promql::value::Sample::new(3000, 30.0),
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                eval_ts: 3000,
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = deriv(matrix).unwrap();

        // Should return a vector with derivative value
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Derivative should be positive for increasing trend
                assert!(v[0].sample.value > 0.0);
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
