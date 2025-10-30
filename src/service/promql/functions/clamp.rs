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
    value::{EvalContext, Labels, RangeValue, Sample, TimeWindow, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn clamp_range(data: Value, min: f64, max: f64, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!("[PromQL Timing] clamp_range() started");
    let result = super::eval_range(data, ClampFunc::new(min, max), eval_ctx);
    log::info!(
        "[PromQL Timing] clamp_range() execution took: {:?}",
        start.elapsed()
    );
    result
}

pub struct ClampFunc {
    min: f64,
    max: f64,
}

impl ClampFunc {
    pub fn new(min: f64, max: f64) -> Self {
        ClampFunc { min, max }
    }
}

impl RangeFunc for ClampFunc {
    fn name(&self) -> &'static str {
        "clamp"
    }

    fn exec_instant(&self, data: RangeValue) -> Option<f64> {
        // For instant queries, clamp the last sample value
        data.samples.last().map(|s| s.value.clamp(self.min, self.max))
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        // For range queries, clamp the last sample value
        samples.last().map(|s| s.value.clamp(self.min, self.max))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    use std::time::Duration;

    // Test helper
    fn clamp_test_helper(data: Value, min: f64, max: f64) -> Result<Value> {
        let eval_ctx = EvalContext::instant(1000);
        clamp_range(data, min, max, &eval_ctx)
    }

    #[test]
    fn test_clamp_function() {
        let eval_ts = 1000;

        // Create range values (clamp operates on range vectors in the new pattern)
        let range_values = vec![
            RangeValue {
                labels: Labels::default(),
                samples: vec![Sample::new(eval_ts, 5.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    eval_ts,
                    range: Duration::from_secs(5),
                    offset: Duration::ZERO,
                }),
            },
            RangeValue {
                labels: Labels::default(),
                samples: vec![Sample::new(eval_ts, 15.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    eval_ts,
                    range: Duration::from_secs(5),
                    offset: Duration::ZERO,
                }),
            },
            RangeValue {
                labels: Labels::default(),
                samples: vec![Sample::new(eval_ts, 25.0)],
                exemplars: None,
                time_window: Some(TimeWindow {
                    eval_ts,
                    range: Duration::from_secs(5),
                    offset: Duration::ZERO,
                }),
            },
        ];

        let matrix = Value::Matrix(range_values);
        let result = clamp_test_helper(matrix, 10.0, 20.0).unwrap();

        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 3);
                // 5.0 should be clamped to 10.0
                assert!((v[0].sample.value - 10.0).abs() < 0.001);
                // 15.0 should remain 15.0
                assert!((v[1].sample.value - 15.0).abs() < 0.001);
                // 25.0 should be clamped to 20.0
                assert!((v[2].sample.value - 20.0).abs() < 0.001);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
