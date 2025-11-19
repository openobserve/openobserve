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

use crate::service::promql::functions::RangeFunc;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#resets
pub(crate) fn resets(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, ResetsFunc::new(), eval_ctx)
}

pub struct ResetsFunc;

impl ResetsFunc {
    pub fn new() -> Self {
        ResetsFunc {}
    }
}

impl RangeFunc for ResetsFunc {
    fn name(&self) -> &'static str {
        "resets"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        let resets = samples
            .iter()
            .zip(samples.iter().skip(1))
            .map(|(current, next)| (current.value.gt(&next.value) as u32) as f64)
            .sum();
        Some(resets)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{RangeValue, Sample};

    use super::*;

    // Helper function to create RangeValue for testing
    fn create_range_value(values: Vec<f64>) -> RangeValue {
        let samples = values
            .into_iter()
            .enumerate()
            .map(|(i, v)| Sample::new(i as i64 * 1000, v))
            .collect();
        RangeValue {
            samples,
            exemplars: None,
            time_window: None,
            labels: Default::default(),
        }
    }

    #[test]
    fn test_exec_no_resets() {
        let func = ResetsFunc::new();

        // Monotonically increasing - should have 0 resets
        let data = create_range_value(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));

        // Constant values - should have 0 resets
        let data = create_range_value(vec![5.0, 5.0, 5.0, 5.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));

        // Mixed increasing and constant - should have 0 resets
        let data = create_range_value(vec![1.0, 2.0, 2.0, 3.0, 4.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));
    }

    #[test]
    fn test_exec_single_reset() {
        let func = ResetsFunc::new();

        // One reset: values go up then down
        let data = create_range_value(vec![1.0, 2.0, 3.0, 1.0, 2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0));

        // One reset at the end
        let data = create_range_value(vec![1.0, 2.0, 3.0, 4.0, 2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0));

        // One reset at the beginning
        let data = create_range_value(vec![5.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0));
    }

    #[test]
    fn test_exec_multiple_resets() {
        let func = ResetsFunc::new();

        // Multiple resets: up-down-up-down pattern
        let data = create_range_value(vec![1.0, 5.0, 2.0, 6.0, 3.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(2.0)); // 5→2 and 6→3

        // Counter-like behavior with resets
        let data = create_range_value(vec![100.0, 150.0, 200.0, 50.0, 100.0, 120.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0)); // 200→50

        // All decreasing values
        let data = create_range_value(vec![10.0, 9.0, 8.0, 7.0, 6.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(4.0)); // Each step is a reset
    }

    #[test]
    fn test_exec_edge_cases() {
        let func = ResetsFunc::new();

        // Single sample - should have 0 resets (no pairs to compare)
        let data = create_range_value(vec![42.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));

        // Two samples - no reset
        let data = create_range_value(vec![1.0, 2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));

        // Two samples - with reset
        let data = create_range_value(vec![2.0, 1.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0));

        // Empty samples (should not happen in practice, but test for safety)
        let data = create_range_value(vec![]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));
    }

    #[test]
    fn test_exec_negative_values() {
        let func = ResetsFunc::new();

        // All negative values - decreasing (more negative)
        let data = create_range_value(vec![-1.0, -2.0, -3.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(2.0)); // Each step down is a "reset"

        // All negative values - increasing (less negative)
        let data = create_range_value(vec![-3.0, -2.0, -1.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));

        // Mixed positive and negative
        let data = create_range_value(vec![1.0, -1.0, 2.0, -2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(2.0)); // 1→-1 and 2→-2
    }

    #[test]
    fn test_exec_floating_point_precision() {
        let func = ResetsFunc::new();

        // Test with very close floating point values
        let data = create_range_value(vec![1.0000001, 1.0000002, 1.0000001]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0)); // 1.0000002 → 1.0000001

        // Test with identical floating point values (no reset)
        let data = create_range_value(vec![1.0000001, 1.0000001, 1.0000001]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0));
    }

    #[test]
    fn test_exec_special_values() {
        let func = ResetsFunc::new();

        // Test with infinity
        let data = create_range_value(vec![1.0, f64::INFINITY, 2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0)); // INFINITY → 2.0

        // Test with NaN (comparison with NaN is always false)
        let data = create_range_value(vec![1.0, f64::NAN, 2.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(0.0)); // NaN comparisons are false

        // Test decreasing to zero
        let data = create_range_value(vec![5.0, 3.0, 1.0, 0.0]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(3.0)); // Each step down
    }

    #[test]
    fn test_exec_counter_overflow_scenarios() {
        let func = ResetsFunc::new();

        // Typical counter overflow scenario (common in monitoring)
        let data = create_range_value(vec![
            1000.0, 1100.0, 1200.0, 1300.0, // Normal increase
            100.0,  // Counter reset/overflow
            200.0, 300.0, 400.0, // Continue from new base
        ]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(1.0)); // Only 1300 → 100

        // Multiple counter overflows
        let data = create_range_value(vec![
            100.0, 200.0, // First period
            50.0, 150.0, // Reset and continue
            25.0, 125.0, // Another reset
        ]);
        assert_eq!(func.exec(&data.samples, 1000, &Duration::ZERO), Some(2.0)); // 200→50 and 150→25
    }
}
