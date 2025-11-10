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
    value::{EvalContext, Labels, Sample, TimeWindow, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#predict_linear
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn predict_linear(data: Value, duration: f64, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] predict_linear() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, PredictLinearFunc::new(duration), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] predict_linear() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct PredictLinearFunc {
    duration: f64,
}

impl PredictLinearFunc {
    pub fn new(duration: f64) -> Self {
        PredictLinearFunc { duration }
    }
}

impl RangeFunc for PredictLinearFunc {
    fn name(&self) -> &'static str {
        "predict_linear"
    }

    fn exec(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        let eval_ts = time_win.as_ref()?.eval_ts;
        let (slope, intercept) = linear_regression(samples, eval_ts / 1000)?;
        Some(slope * self.duration + intercept)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    // Test helper
    fn predict_linear_test_helper(data: Value, duration: f64) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        predict_linear(data, duration, &eval_ctx)
    }

    #[test]
    fn test_predict_linear_function() {
        // Create a range value with a linear trend
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
        let duration = 10.0;
        let result = predict_linear_test_helper(matrix, duration).unwrap();
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Should return a predicted value (should be finite)
                assert!(v[0].sample.value.is_finite());
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
