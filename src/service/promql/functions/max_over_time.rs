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

use config::utils::sort::sort_float;
use datafusion::error::Result;

use crate::service::promql::value::{RangeValue, Value};

pub(crate) fn max_over_time(data: Value) -> Result<Value> {
    super::eval_idelta(data, "max_over_time", exec, false)
}

fn exec(data: RangeValue) -> Option<f64> {
    if data.samples.is_empty() {
        return None;
    }
    Some(
        data.samples
            .iter()
            .map(|s| s.value)
            .max_by(sort_float)
            .unwrap(),
    )
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    #[test]
    fn test_max_over_time_function() {
        // Create a range value with sample data
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 30.0),
            crate::service::promql::value::Sample::new(3000, 20.0),
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
        let result = max_over_time(matrix).unwrap();

        // Should return a vector with max value
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Should return the max value: 30.0
                assert!((v[0].sample.value - 30.0).abs() < 0.001);
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
