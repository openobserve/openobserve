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

use config::meta::promql::value::Sample;

use crate::{common::kahan_sum_increment, functions::RangeFunc};

pub struct AvgOverTimeFunc;

impl RangeFunc for AvgOverTimeFunc {
    fn name(&self) -> &'static str {
        "avg_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        let (first, rest) = samples.split_first()?;
        let (mut sum, mut c, mut mean) = (first.value, 0.0, 0.0);
        let mut incremental = false;
        for (i, sample) in rest.iter().enumerate() {
            let count = (i + 2) as f64;
            if !incremental {
                let (new_sum, new_c) = kahan_sum_increment(sample.value, sum, c);
                if !new_sum.is_infinite() {
                    (sum, c) = (new_sum, new_c);
                    continue;
                }
                // the direct sum would overflow, so continue with an incremental mean
                incremental = true;
                mean = sum / (count - 1.0);
                c /= count - 1.0;
            }
            let q = (count - 1.0) / count;
            (mean, c) = kahan_sum_increment(sample.value / count, q * mean, q * c);
        }
        let count = samples.len() as f64;
        Some(if incremental {
            mean + c
        } else {
            sum / count + c / count
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{EvalContext, Labels, RangeValue, TimeWindow, Value};
    use datafusion::error::Result;

    use super::*;

    fn avg_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
        crate::functions::eval_range(data, AvgOverTimeFunc, eval_ctx)
    }

    // Test helper
    fn avg_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        avg_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_avg_over_time_value_none_input() {
        let result = avg_over_time_test_helper(Value::None).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_avg_over_time_invalid_input_returns_err() {
        let result = avg_over_time_test_helper(Value::Float(1.0));
        assert!(result.is_err());
    }

    #[test]
    fn test_avg_over_time_exec_empty_samples_returns_none() {
        let func = AvgOverTimeFunc;
        assert!(func.exec(&[], 0, &Duration::ZERO).is_none());
    }

    #[test]
    fn test_avg_over_time_function() {
        // Create a range value with sample data
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
        let result = avg_over_time_test_helper(matrix).unwrap();

        // Should return a matrix with average value
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert_eq!(m[0].samples.len(), 1);
                // Average should be (10+20+30)/3 = 20.0
                assert!((m[0].samples[0].value - 20.0).abs() < 0.001);
                assert_eq!(m[0].samples[0].timestamp, 3000);
            }
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_avg_over_time_falls_back_to_incremental_mean_on_overflow() {
        let func = AvgOverTimeFunc;
        let at = |values: &[f64]| {
            let samples: Vec<_> = values
                .iter()
                .enumerate()
                .map(|(i, &value)| Sample::new(i as i64, value))
                .collect();
            func.exec(&samples, 0, &Duration::ZERO).unwrap()
        };
        assert_eq!(at(&[1e308, 1e308]), 1e308);
        assert_eq!(at(&[1e100, 1.0, -1e100]), 1.0 / 3.0);
        assert_eq!(at(&[f64::INFINITY, 1.0]), f64::INFINITY);
        assert!(at(&[f64::INFINITY, f64::NEG_INFINITY]).is_nan());
    }
}
