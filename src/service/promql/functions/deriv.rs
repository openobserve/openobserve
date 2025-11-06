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
    functions::RangeFunc,
    value::{EvalContext, Labels, RangeValue, Sample, TimeWindow, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#deriv
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn deriv_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] deriv_range() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, DerivFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] deriv_range() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct DerivFunc;

impl DerivFunc {
    pub fn new() -> Self {
        DerivFunc {}
    }
}

impl RangeFunc for DerivFunc {
    fn name(&self) -> &'static str {
        "deriv"
    }

    fn exec_instant(&self, _data: RangeValue) -> Option<f64> {
        None
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        if samples.len() < 2 {
            return None;
        }
        // https://github.com/prometheus/prometheus/issues/2674
        let value = linear_regression(samples, samples[0].timestamp / 1000);
        match value {
            Some((slope, _)) => Some(slope),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    // Test helper
    fn deriv_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        deriv_range(data, &eval_ctx)
    }

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
        let result = deriv_test_helper(matrix).unwrap();

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
