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

use config::meta::promql::value::{EvalContext, RangeValue, Sample, Value};
use datafusion::error::Result;
use hashbrown::HashMap;

use crate::service::promql::{
    aggregations::{Accumulate, AggFunc},
    common::quantile as calculate_quantile,
};

/// Note: quantile aggregates all series into a single result (no label grouping)
pub fn quantile(qtile: f64, data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] quantile_range({qtile}) started",
        eval_ctx.trace_id,
    );

    // Handle invalid quantile parameter by returning special values
    if !(0.0..=1.0).contains(&qtile) || qtile.is_nan() {
        let value = match qtile.signum() as i32 {
            1 => f64::INFINITY,
            -1 => f64::NEG_INFINITY,
            _ => f64::NAN,
        };
        let timestamps = eval_ctx.timestamps();
        let samples: Vec<Sample> = timestamps
            .iter()
            .map(|&ts| Sample::new(ts, value))
            .collect();
        let range_value = RangeValue {
            labels: Default::default(),
            samples,
            exemplars: None,
            time_window: None,
        };
        return Ok(Value::Matrix(vec![range_value]));
    }

    let result = super::eval_aggregate(&None, data, Quantile { qtile }, eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] quantile_range({qtile}) execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct Quantile {
    qtile: f64,
}

impl AggFunc for Quantile {
    fn name(&self) -> &'static str {
        "quantile"
    }

    fn build(&self) -> Box<dyn super::Accumulate> {
        Box::new(QuantileAccumulate::new(self.qtile))
    }
}

pub struct QuantileAccumulate {
    qtile: f64,
    // Store all values per timestamp for quantile calculation
    values: HashMap<i64, Vec<f64>>,
}

impl QuantileAccumulate {
    fn new(qtile: f64) -> Self {
        QuantileAccumulate {
            qtile,
            values: HashMap::new(),
        }
    }
}

impl Accumulate for QuantileAccumulate {
    fn accumulate(&mut self, sample: &Sample) {
        let entry = self.values.entry(sample.timestamp).or_default();
        entry.push(sample.value);
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.values
            .into_iter()
            .filter_map(|(timestamp, values)| {
                if values.is_empty() {
                    return Some(Sample::new(timestamp, f64::NAN));
                }
                // Calculate quantile
                calculate_quantile(&values, self.qtile)
                    .map(|quantile_val| Sample::new(timestamp, quantile_val))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantile_value_none_input() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(0.5, Value::None, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_quantile_invalid_input_returns_err() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(0.5, Value::Float(1.0), &eval_ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_quantile_out_of_range_positive_returns_infinity() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(1.5, Value::None, &eval_ctx).unwrap();
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert!(m[0].samples[0].value.is_infinite());
                assert!(m[0].samples[0].value > 0.0);
            }
            _ => panic!("Expected Matrix"),
        }
    }

    #[test]
    fn test_quantile_out_of_range_negative_returns_neg_infinity() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(-0.1, Value::None, &eval_ctx).unwrap();
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert!(m[0].samples[0].value.is_infinite());
                assert!(m[0].samples[0].value < 0.0);
            }
            _ => panic!("Expected Matrix"),
        }
    }

    #[test]
    fn test_quantile_nan_returns_nan_samples() {
        let timestamp = 1640995200;
        let eval_ctx = EvalContext::new(timestamp, timestamp + 1, 1, "test".to_string());
        let result = quantile(f64::NAN, Value::None, &eval_ctx).unwrap();
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert!(m[0].samples[0].value.is_nan());
            }
            _ => panic!("Expected Matrix"),
        }
    }

    #[test]
    fn test_quantile_calculation() {
        // Test the core quantile calculation logic
        let values = vec![10.0, 20.0, 30.0];
        let qtile = 0.5; // 50th percentile

        let quantile_value = calculate_quantile(&values, qtile).unwrap();
        assert_eq!(quantile_value, 20.0); // 50th percentile should be 20.0
    }

    #[test]
    fn test_quantile_edge_cases() {
        // Test edge cases for quantile calculation
        let values = vec![10.0, 20.0, 30.0];

        // 0th percentile (minimum)
        let min_value = calculate_quantile(&values, 0.0).unwrap();
        assert_eq!(min_value, 10.0);

        // 100th percentile (maximum)
        let max_value = calculate_quantile(&values, 1.0).unwrap();
        assert_eq!(max_value, 30.0);
    }
}
