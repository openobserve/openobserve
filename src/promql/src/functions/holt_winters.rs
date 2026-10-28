// Copyright 2026 OpenObserve Inc.
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
use datafusion::error::{DataFusionError, Result};

use crate::{common::calculate_trend, functions::RangeFunc, scalar_param::ScalarParam};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#holt_winters
pub(crate) fn holt_winters(
    data: Value,
    scaling_factor: ScalarParam,
    trend_factor: ScalarParam,
    eval_ctx: &EvalContext,
    pinned: Option<i64>,
) -> Result<Value> {
    // Prometheus checks the factors per series with samples, so an empty selection never errors
    let has_samples =
        matches!(&data, Value::Matrix(matrix) if matrix.iter().any(|s| !s.samples.is_empty()));
    for (factor, name, short) in [
        (&scaling_factor, "smoothing", "sf"),
        (&trend_factor, "trend", "tf"),
    ] {
        if let ScalarParam::Const(value) = *factor
            && has_samples
            && (value <= 0.0 || value >= 1.0)
        {
            return Err(DataFusionError::Execution(format!(
                "invalid {name} factor. Expected: 0 < {short} < 1, got: {value:.6}"
            )));
        }
    }
    super::eval_range_at(
        data,
        HoltWintersFunc::new(scaling_factor, trend_factor),
        eval_ctx,
        pinned,
    )
}

pub struct HoltWintersFunc {
    scaling_factor: ScalarParam,
    trend_factor: ScalarParam,
}

impl HoltWintersFunc {
    pub fn new(scaling_factor: ScalarParam, trend_factor: ScalarParam) -> Self {
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

    fn exec(&self, samples: &[Sample], eval_ts: i64, _range: &Duration) -> Option<f64> {
        holt_winters_calculation(
            samples,
            self.scaling_factor.at(eval_ts),
            self.trend_factor.at(eval_ts),
        )
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
        holt_winters(
            data,
            ScalarParam::Const(scaling_factor),
            ScalarParam::Const(trend_factor),
            &eval_ctx,
            None,
        )
    }

    #[test]
    fn test_holt_winters_rejects_constant_factors_outside_zero_one() {
        let series = |samples: Vec<Sample>| {
            Value::Matrix(vec![RangeValue {
                labels: Labels::default(),
                samples,
                exemplars: None,
                time_window: Some(TimeWindow::new(Duration::from_secs(2))),
            }])
        };
        let data = || series(vec![Sample::new(2000, 10.0), Sample::new(3000, 20.0)]);
        for (sf, tf, expected) in [
            (
                1.5,
                0.5,
                "invalid smoothing factor. Expected: 0 < sf < 1, got: 1.500000",
            ),
            (
                0.0,
                0.5,
                "invalid smoothing factor. Expected: 0 < sf < 1, got: 0.000000",
            ),
            (
                0.5,
                0.0,
                "invalid trend factor. Expected: 0 < tf < 1, got: 0.000000",
            ),
            (
                0.5,
                1.0,
                "invalid trend factor. Expected: 0 < tf < 1, got: 1.000000",
            ),
        ] {
            let err = holt_winters_test_helper(data(), sf, tf).unwrap_err();
            assert!(
                matches!(&err, DataFusionError::Execution(message) if message == expected),
                "{err}"
            );
        }
        // as in Prometheus, an empty selection is never checked and NaN fails no comparison
        assert!(holt_winters_test_helper(series(vec![]), 1.5, 0.5).is_ok());
        assert!(holt_winters_test_helper(Value::None, 1.5, 0.5).is_ok());
        assert!(holt_winters_test_helper(data(), f64::NAN, 0.5).is_ok());
    }

    #[test]
    fn test_holt_winters_calculation_fewer_than_two_samples() {
        assert!(holt_winters_calculation(&[], 0.5, 0.3).is_none());
        let one = vec![Sample::new(1000, 10.0)];
        assert!(holt_winters_calculation(&one, 0.5, 0.3).is_none());
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
