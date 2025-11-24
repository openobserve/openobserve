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

use std::time::Duration;

use config::meta::promql::value::{EvalContext, Sample, Value};
use datafusion::error::Result;

use crate::service::promql::functions::RangeFunc;

pub(crate) fn last_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, LastOverTimeFunc::new(), eval_ctx)
}

pub struct LastOverTimeFunc;

impl LastOverTimeFunc {
    pub fn new() -> Self {
        LastOverTimeFunc {}
    }
}

impl RangeFunc for LastOverTimeFunc {
    fn name(&self) -> &'static str {
        "last_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        // NOTE: Comment taken from prometheus golang source.
        // The last_over_time function acts like offset; thus, it
        // should keep the metric name.  For all the other range
        // vector functions, the only change needed is to drop the
        // metric name in the output.
        Some(samples.last().unwrap().value)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;

    // Test helper
    fn last_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        last_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_last_over_time_function() {
        // Create a range value with sample data
        let samples = vec![
            Sample::new(1000, 10.0),
            Sample::new(2000, 20.0),
            Sample::new(3000, 30.0),
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = last_over_time_test_helper(matrix).unwrap();

        // Should return a matrix with last value
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert_eq!(m[0].samples.len(), 1);
                // Should return the last value: 30.0
                assert!((m[0].samples[0].value - 30.0).abs() < 0.001);
                assert_eq!(m[0].samples[0].timestamp, 3000);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
