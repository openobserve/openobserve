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

use crate::service::promql::value::{RangeValue, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#resets
pub(crate) fn resets(data: Value) -> Result<Value> {
    super::eval_idelta(data, "resets", exec, false)
}

fn exec(data: RangeValue) -> Option<f64> {
    let resets = data
        .samples
        .iter()
        .zip(data.samples.iter().skip(1))
        .map(|(current, next)| (current.value.gt(&next.value) as u32) as f64)
        .sum();
    Some(resets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::promql::value::Sample;

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
        // Monotonically increasing - should have 0 resets
        let data = create_range_value(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(exec(data), Some(0.0));

        // Constant values - should have 0 resets
        let data = create_range_value(vec![5.0, 5.0, 5.0, 5.0]);
        assert_eq!(exec(data), Some(0.0));

        // Mixed increasing and constant - should have 0 resets
        let data = create_range_value(vec![1.0, 2.0, 2.0, 3.0, 4.0]);
        assert_eq!(exec(data), Some(0.0));
    }

    #[test]
    fn test_exec_single_reset() {
        // One reset: values go up then down
        let data = create_range_value(vec![1.0, 2.0, 3.0, 1.0, 2.0]);
        assert_eq!(exec(data), Some(1.0));

        // One reset at the end
        let data = create_range_value(vec![1.0, 2.0, 3.0, 4.0, 2.0]);
        assert_eq!(exec(data), Some(1.0));

        // One reset at the beginning
        let data = create_range_value(vec![5.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(exec(data), Some(1.0));
    }

    #[test]
    fn test_exec_multiple_resets() {
        // Multiple resets: up-down-up-down pattern
        let data = create_range_value(vec![1.0, 5.0, 2.0, 6.0, 3.0]);
        assert_eq!(exec(data), Some(2.0)); // 5→2 and 6→3

        // Counter-like behavior with resets
        let data = create_range_value(vec![100.0, 150.0, 200.0, 50.0, 100.0, 120.0]);
        assert_eq!(exec(data), Some(1.0)); // 200→50

        // All decreasing values
        let data = create_range_value(vec![10.0, 9.0, 8.0, 7.0, 6.0]);
        assert_eq!(exec(data), Some(4.0)); // Each step is a reset
    }

    #[test]
    fn test_exec_edge_cases() {
        // Single sample - should have 0 resets (no pairs to compare)
        let data = create_range_value(vec![42.0]);
        assert_eq!(exec(data), Some(0.0));

        // Two samples - no reset
        let data = create_range_value(vec![1.0, 2.0]);
        assert_eq!(exec(data), Some(0.0));

        // Two samples - with reset
        let data = create_range_value(vec![2.0, 1.0]);
        assert_eq!(exec(data), Some(1.0));

        // Empty samples (should not happen in practice, but test for safety)
        let data = create_range_value(vec![]);
        assert_eq!(exec(data), Some(0.0));
    }

    #[test]
    fn test_exec_negative_values() {
        // All negative values - decreasing (more negative)
        let data = create_range_value(vec![-1.0, -2.0, -3.0]);
        assert_eq!(exec(data), Some(2.0)); // Each step down is a "reset"

        // All negative values - increasing (less negative)
        let data = create_range_value(vec![-3.0, -2.0, -1.0]);
        assert_eq!(exec(data), Some(0.0));

        // Mixed positive and negative
        let data = create_range_value(vec![1.0, -1.0, 2.0, -2.0]);
        assert_eq!(exec(data), Some(2.0)); // 1→-1 and 2→-2
    }

    #[test]
    fn test_exec_floating_point_precision() {
        // Test with very close floating point values
        let data = create_range_value(vec![1.0000001, 1.0000002, 1.0000001]);
        assert_eq!(exec(data), Some(1.0)); // 1.0000002 → 1.0000001

        // Test with identical floating point values (no reset)
        let data = create_range_value(vec![1.0000001, 1.0000001, 1.0000001]);
        assert_eq!(exec(data), Some(0.0));
    }

    #[test]
    fn test_exec_special_values() {
        // Test with infinity
        let data = create_range_value(vec![1.0, f64::INFINITY, 2.0]);
        assert_eq!(exec(data), Some(1.0)); // INFINITY → 2.0

        // Test with NaN (comparison with NaN is always false)
        let data = create_range_value(vec![1.0, f64::NAN, 2.0]);
        assert_eq!(exec(data), Some(0.0)); // NaN comparisons are false

        // Test decreasing to zero
        let data = create_range_value(vec![5.0, 3.0, 1.0, 0.0]);
        assert_eq!(exec(data), Some(3.0)); // Each step down
    }

    #[test]
    fn test_exec_counter_overflow_scenarios() {
        // Typical counter overflow scenario (common in monitoring)
        let data = create_range_value(vec![
            1000.0, 1100.0, 1200.0, 1300.0, // Normal increase
            100.0,  // Counter reset/overflow
            200.0, 300.0, 400.0, // Continue from new base
        ]);
        assert_eq!(exec(data), Some(1.0)); // Only 1300 → 100

        // Multiple counter overflows
        let data = create_range_value(vec![
            100.0, 200.0, // First period
            50.0, 150.0, // Reset and continue
            25.0, 125.0, // Another reset
        ]);
        assert_eq!(exec(data), Some(2.0)); // 200→50 and 150→25
    }
}
