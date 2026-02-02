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

pub(crate) fn delta(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, DeltaFunc::new(), eval_ctx)
}

pub struct DeltaFunc;

impl DeltaFunc {
    pub fn new() -> Self {
        DeltaFunc {}
    }
}

impl RangeFunc for DeltaFunc {
    fn name(&self) -> &'static str {
        "delta"
    }

    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
        extrapolated_rate(
            samples,
            eval_ts,
            *range,
            Duration::ZERO,
            ExtrapolationKind::Delta,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;

    // Test helper
    fn delta_test_helper(data: Value, eval_ts: i64) -> Result<Value> {
        let eval_ctx = EvalContext::new(eval_ts, eval_ts, 0, "test".to_string());
        delta(data, &eval_ctx)
    }

    #[test]
    fn test_delta_function_single_sample() {
        // Single sample should return empty or None
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
        let result = delta_test_helper(matrix, 3000).unwrap();

        match result {
            Value::Matrix(m) => {
                // With single sample, delta should return empty result
                assert_eq!(m.len(), 0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_delta_function_no_samples() {
        // Empty samples should return empty result
        let samples = vec![];

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
        let result = delta_test_helper(matrix, 3000).unwrap();

        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_delta_function_name() {
        let func = DeltaFunc::new();
        assert_eq!(func.name(), "delta");
    }
}
