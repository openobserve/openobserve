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
    functions::RangeFunc,
    value::{EvalContext, Sample, TimeWindow, Value},
};

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn count_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] count_over_time() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, CountOverTimeFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] count_over_time() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct CountOverTimeFunc;

impl CountOverTimeFunc {
    pub fn new() -> Self {
        CountOverTimeFunc {}
    }
}

impl RangeFunc for CountOverTimeFunc {
    fn name(&self) -> &'static str {
        "count_over_time"
    }

    fn exec(&self, samples: &[Sample], _time_win: &Option<TimeWindow>) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        Some(samples.len() as f64)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    // Test helper
    fn count_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        count_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_count_over_time_function() {
        // Create a range value with sample data
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
        let result = count_over_time_test_helper(matrix).unwrap();

        // Should return a vector with count of samples
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Should count 3 samples
                assert!((v[0].sample.value - 3.0).abs() < 0.001);
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
