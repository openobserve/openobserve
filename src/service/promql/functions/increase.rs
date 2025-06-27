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

use crate::service::promql::value::{ExtrapolationKind, RangeValue, Value, extrapolated_rate};

pub(crate) fn increase(data: Value) -> Result<Value> {
    super::eval_idelta(data, "increase", exec, false)
}

fn exec(series: RangeValue) -> Option<f64> {
    let tw = series
        .time_window
        .as_ref()
        .expect("BUG: `increase` function requires time window");
    extrapolated_rate(
        &series.samples,
        tw.eval_ts,
        tw.range,
        tw.offset,
        ExtrapolationKind::Increase,
    )
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    #[test]
    fn test_increase_function() {
        // Create a range value with increasing counter values
        let samples = vec![crate::service::promql::value::Sample::new(1000, 10.0)];

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
        let result = increase(matrix).unwrap();

        // Should return a vector with increase value
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 0);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
