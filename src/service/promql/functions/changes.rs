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

use crate::service::promql::value::{RangeValue, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#changes
pub(crate) fn changes(data: Value) -> Result<Value> {
    super::eval_idelta(data, "changes", exec, false)
}

fn exec(data: RangeValue) -> Option<f64> {
    let changes = data
        .samples
        .iter()
        .zip(data.samples.iter().skip(1))
        .map(|(current, next)| (!current.value.eq(&next.value) as u32) as f64)
        .sum();
    Some(changes)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    #[test]
    fn test_changes_function() {
        // Create a range value with changing counter values
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 15.0),
            crate::service::promql::value::Sample::new(3000, 25.0),
            crate::service::promql::value::Sample::new(4000, 25.0), // No change
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                eval_ts: 4000,
                range: Duration::from_secs(3),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = changes(matrix).unwrap();

        // Should return a vector with number of changes
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
