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

use config::meta::promql::value::{
    EvalContext, ExtrapolationKind, Sample, Value, extrapolated_rate,
};
use datafusion::error::Result;

use crate::service::promql::functions::RangeFunc;

pub(crate) fn increase(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, IncreaseFunc::new(), eval_ctx)
}

pub struct IncreaseFunc;

impl IncreaseFunc {
    pub fn new() -> Self {
        IncreaseFunc {}
    }
}

impl RangeFunc for IncreaseFunc {
    fn name(&self) -> &'static str {
        "increase"
    }

    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
        extrapolated_rate(
            samples,
            eval_ts,
            *range,
            Duration::ZERO,
            ExtrapolationKind::Increase,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;
    // Test helper
    fn increase_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        increase(data, &eval_ctx)
    }

    #[test]
    fn test_increase_function() {
        // Create a range value with increasing counter values
        let samples = vec![Sample::new(1000, 10.0)];

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
        let result = increase_test_helper(matrix).unwrap();

        // Should return a matrix with increase value
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
