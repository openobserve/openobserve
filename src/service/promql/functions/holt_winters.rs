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

use datafusion::error::{DataFusionError, Result};

use crate::service::promql::{
    common::calculate_trend,
    value::{InstantValue, Sample, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#holt_winters
pub(crate) fn holt_winters(data: Value, scaling_factor: f64, trend_factor: f64) -> Result<Value> {
    let data = match data {
        Value::Matrix(v) => v,
        Value::None => return Ok(Value::None),
        v => {
            return Err(DataFusionError::Plan(format!(
                "holt_winters: matrix argument expected got {}",
                v.get_type()
            )));
        }
    };

    let mut rate_values = Vec::with_capacity(data.len());
    for mut metric in data {
        let labels = std::mem::take(&mut metric.labels);
        let eval_ts = metric.time_window.as_ref().unwrap().eval_ts;
        if let Some(value) = holt_winters_calculation(&metric.samples, scaling_factor, trend_factor)
        {
            rate_values.push(InstantValue {
                labels,
                sample: Sample::new(eval_ts, value),
            });
        }
    }
    Ok(Value::Vector(rate_values))
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

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};

    #[test]
    fn test_holt_winters_function() {
        // Create a range value with sample data
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 15.0),
            crate::service::promql::value::Sample::new(3000, 20.0),
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
        let result = holt_winters(matrix, 0.5, 0.3).unwrap();

        // Should return a vector with holt-winters forecast
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Should return a forecasted value
                assert!(v[0].sample.value.is_finite());
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
