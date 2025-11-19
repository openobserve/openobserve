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

use crate::service::promql::{common::calculate_trend, functions::RangeFunc};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#holt_winters
pub(crate) fn holt_winters(
    data: Value,
    scaling_factor: f64,
    trend_factor: f64,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    super::eval_range(
        data,
        HoltWintersFunc::new(scaling_factor, trend_factor),
        eval_ctx,
    )
}

pub struct HoltWintersFunc {
    scaling_factor: f64,
    trend_factor: f64,
}

impl HoltWintersFunc {
    pub fn new(scaling_factor: f64, trend_factor: f64) -> Self {
        HoltWintersFunc {
            scaling_factor,
            trend_factor,
        }
    }
}

impl RangeFunc for HoltWintersFunc {
    fn name(&self) -> &'static str {
        "holt_winters"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        holt_winters_calculation(samples, self.scaling_factor, self.trend_factor)
    }
}

pub fn holt_winters_calculation(
    samples: &[Sample],
    smoothing_factor: f64,
    trend_factor: f64,
) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }

    let mut previous_smoothed = 0.0;
    let mut current_smoothed = samples[0].value;
    let mut trend = samples[1].value - samples[0].value;

    for (i, sample) in samples[1..].iter().enumerate() {
        let scaled_value = smoothing_factor * sample.value;
        trend = calculate_trend(
            i as i64,
            trend_factor,
            previous_smoothed,
            current_smoothed,
            trend,
        );
        let scaled_trend = (1.0 - smoothing_factor) * (current_smoothed + trend);
        previous_smoothed = current_smoothed;
        current_smoothed = scaled_value + scaled_trend;
    }

    Some(current_smoothed)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;

    // Test helper
    fn holt_winters_test_helper(
        data: Value,
        scaling_factor: f64,
        trend_factor: f64,
    ) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        holt_winters(data, scaling_factor, trend_factor, &eval_ctx)
    }

    #[test]
    fn test_holt_winters_function() {
        // Create a range value with sample data
        let samples = vec![
            Sample::new(1000, 10.0),
            Sample::new(2000, 15.0),
            Sample::new(3000, 20.0),
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
        let result = holt_winters_test_helper(matrix, 0.5, 0.3).unwrap();

        // Should return a matrix with holt-winters forecast
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert_eq!(m[0].samples.len(), 1);
                // Should return a forecasted value
                assert!(m[0].samples[0].value.is_finite());
                assert_eq!(m[0].samples[0].timestamp, 3000);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
