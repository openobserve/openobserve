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

use std::collections::BTreeSet;

use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};

/// Helper function to generate a matrix with value 1.0 for all timestamps in the eval context
fn generate_absent_matrix(eval_ctx: &EvalContext) -> Value {
    let mut samples = Vec::new();
    let mut ts = eval_ctx.start;
    while ts <= eval_ctx.end {
        samples.push(Sample::new(ts, 1.0));
        ts += eval_ctx.step;
    }

    let range_value = RangeValue {
        labels: Labels::default(),
        samples,
        exemplars: None,
        time_window: None,
    };

    Value::Matrix(vec![range_value])
}

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent
/// Returns 1 for each timestamp where the input vector has no data
pub(crate) fn absent(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    match data {
        Value::Matrix(matrix) => {
            // If the matrix is completely empty, return 1 for all timestamps
            if matrix.is_empty() {
                return Ok(generate_absent_matrix(eval_ctx));
            }

            // Collect all timestamps that have data across all series
            let mut timestamps_with_data = BTreeSet::new();
            for range_value in &matrix {
                for sample in &range_value.samples {
                    timestamps_with_data.insert(sample.timestamp);
                }
            }

            // Generate samples for timestamps that DON'T have data
            let mut absent_samples = Vec::new();
            let mut ts = eval_ctx.start;
            while ts <= eval_ctx.end {
                if !timestamps_with_data.contains(&ts) {
                    absent_samples.push(Sample::new(ts, 1.0));
                }
                ts += eval_ctx.step;
            }

            // If all timestamps have data, return None (empty result)
            if absent_samples.is_empty() {
                return Ok(Value::None);
            }

            // Return 1.0 for timestamps where data is absent
            let range_value = RangeValue {
                labels: Labels::default(),
                samples: absent_samples,
                exemplars: None,
                time_window: None,
            };

            Ok(Value::Matrix(vec![range_value]))
        }
        Value::None => {
            // No data at all, return 1 for all timestamps
            Ok(generate_absent_matrix(eval_ctx))
        }
        _ => Err(DataFusionError::Plan(format!(
            "Invalid input for absent, expected matrix but got: {:?}",
            data.get_type()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_eval_ctx() -> EvalContext {
        EvalContext::new(
            1000, // start: 1000
            1002, // end: 1002 (3 timestamps: 1000, 1001, 1002)
            1,    // step: 1
            "test".to_string(),
        )
    }

    #[test]
    fn test_absent_with_empty_matrix() {
        // Empty matrix should return 1.0 for all timestamps in range
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![]);
        let result = absent(value, &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 3); // 3 timestamps: 1000, 1001, 1002
            assert_eq!(samples[0].timestamp, 1000);
            assert_eq!(samples[0].value, 1.0);
            assert_eq!(samples[1].timestamp, 1001);
            assert_eq!(samples[1].value, 1.0);
            assert_eq!(samples[2].timestamp, 1002);
            assert_eq!(samples[2].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_absent_with_none() {
        // None should return 1.0 for all timestamps
        let eval_ctx = create_eval_ctx();
        let value = Value::None;
        let result = absent(value, &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 3);
            assert_eq!(samples[0].value, 1.0);
            assert_eq!(samples[1].value, 1.0);
            assert_eq!(samples[2].value, 1.0);
        } else {
            panic!("Expected Matrix result");
        }
    }

    #[test]
    fn test_absent_with_all_timestamps_present() {
        // When all timestamps have data, should return None
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: vec![
                Sample::new(1000, 42.0),
                Sample::new(1001, 43.0),
                Sample::new(1002, 44.0),
            ],
            exemplars: None,
            time_window: None,
        }]);
        let result = absent(value, &eval_ctx).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_absent_with_partial_data() {
        // When some timestamps have data, should return 1.0 for missing timestamps
        let eval_ctx = create_eval_ctx();
        let value = Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: vec![
                Sample::new(1000, 42.0),
                // 1001 is missing
                Sample::new(1002, 44.0),
            ],
            exemplars: None,
            time_window: None,
        }]);
        let result = absent(value, &eval_ctx).unwrap();

        if let Value::Matrix(matrix) = result {
            assert_eq!(matrix.len(), 1);
            let samples = &matrix[0].samples;
            assert_eq!(samples.len(), 1); // Only 1 missing timestamp
            assert_eq!(samples[0].timestamp, 1001);
            assert_eq!(samples[0].value, 1.0);
        } else {
            panic!("Expected Matrix result with missing timestamp");
        }
    }

    #[test]
    fn test_absent_with_invalid_input() {
        // Invalid input type should return error
        let eval_ctx = create_eval_ctx();
        let value = Value::Float(5.0);
        let result = absent(value, &eval_ctx);
        assert!(result.is_err());
    }
}
