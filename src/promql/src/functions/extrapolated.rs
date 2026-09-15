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

use config::meta::promql::value::{ExtrapolationKind, Sample, extrapolated_rate};

use super::RangeFunc;

impl RangeFunc for ExtrapolationKind {
    fn name(&self) -> &'static str {
        match self {
            Self::Rate => "rate",
            Self::Increase => "increase",
            Self::Delta => "delta",
        }
    }

    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
        extrapolated_rate(samples, eval_ts, *range, Duration::ZERO, *self)
    }

    fn counter_extrapolation(&self) -> Option<ExtrapolationKind> {
        match self {
            Self::Rate | Self::Increase => Some(*self),
            Self::Delta => None,
        }
    }
}

#[cfg(test)]
mod rate_tests {
    use super::*;

    #[test]
    fn test_rate_name() {
        assert_eq!(ExtrapolationKind::Rate.name(), "rate");
    }

    #[test]
    fn test_rate_empty_samples() {
        let func = ExtrapolationKind::Rate;
        assert!(func.exec(&[], 0, &Duration::from_secs(60)).is_none());
    }

    #[test]
    fn test_rate_single_sample() {
        let func = ExtrapolationKind::Rate;
        let sample = Sample {
            timestamp: 60_000_000,
            value: 100.0,
        };
        assert!(
            func.exec(&[sample], 120_000_000, &Duration::from_secs(60))
                .is_none()
        );
    }

    #[test]
    fn test_rate_two_samples_returns_some() {
        let func = ExtrapolationKind::Rate;
        // range=60s, eval_ts=120s, start=60s
        // samples within [60s, 120s]
        let samples = vec![
            Sample {
                timestamp: 70_000_000,
                value: 100.0,
            },
            Sample {
                timestamp: 110_000_000,
                value: 200.0,
            },
        ];
        let result = func.exec(&samples, 120_000_000, &Duration::from_secs(60));
        assert!(result.is_some());
        assert!(result.unwrap() >= 0.0);
    }
}

#[cfg(test)]
mod increase_tests {
    use std::time::Duration;

    use config::meta::promql::value::{EvalContext, Labels, RangeValue, TimeWindow, Value};
    use datafusion::error::Result;

    use super::*;

    fn increase(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
        crate::functions::eval_range(data, ExtrapolationKind::Increase, eval_ctx)
    }
    // Test helper
    fn increase_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        increase(data, &eval_ctx)
    }

    #[test]
    fn test_increase_value_none_input() {
        let result = increase_test_helper(Value::None).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_increase_invalid_input_returns_err() {
        let result = increase_test_helper(Value::Float(1.0));
        assert!(result.is_err());
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

#[cfg(test)]
mod delta_tests {
    use std::time::Duration;

    use config::meta::promql::value::{EvalContext, Labels, RangeValue, TimeWindow, Value};
    use datafusion::error::Result;

    use super::*;

    fn delta(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
        crate::functions::eval_range(data, ExtrapolationKind::Delta, eval_ctx)
    }

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
        let func = ExtrapolationKind::Delta;
        assert_eq!(func.name(), "delta");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::functions::Func;

    #[test]
    fn test_dispatch_preserves_counter_optimization_selection() {
        for (func, name, counter) in [
            (Func::Rate, "rate", Some("rate")),
            (Func::Increase, "increase", Some("increase")),
            (Func::Delta, "delta", None),
        ] {
            let implementation = func.range_func().unwrap();
            assert_eq!(implementation.name(), name);
            assert_eq!(
                implementation
                    .counter_extrapolation()
                    .map(|kind| kind.name()),
                counter
            );
        }
    }
}
