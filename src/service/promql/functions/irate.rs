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

pub(crate) fn irate(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, IrateFunc::new(), eval_ctx)
}

pub struct IrateFunc;

impl IrateFunc {
    pub fn new() -> Self {
        IrateFunc {}
    }
}

impl RangeFunc for IrateFunc {
    fn name(&self) -> &'static str {
        "irate"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.len() < 2 {
            return None;
        }
        let last = samples.last().unwrap();
        let previous = samples.get(samples.len() - 2).unwrap();
        let dt_seconds = (last.timestamp - previous.timestamp) as f64 / 1_000_000.0;
        if dt_seconds == 0.0 {
            return Some(0.0);
        }
        let dt_value = if last.value - previous.value >= 0.0 {
            last.value - previous.value
        } else {
            last.value
        };
        Some(dt_value / dt_seconds)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;

    // Test helper function that creates an EvalContext for instant queries
    fn irate_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        irate(data, &eval_ctx)
    }

    #[test]
    fn test_irate_function() {
        // Create a range value with increasing counter values
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
        let result = irate_test_helper(matrix).unwrap();

        // Should return a matrix with irate value
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert_eq!(m[0].samples.len(), 1);
                // Irate should be positive for increasing counter
                assert!(m[0].samples[0].value > 0.0);
                assert_eq!(m[0].samples[0].timestamp, 3000);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
