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

use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::Result;

use crate::functions::RangeFunc;

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent_over_time
pub(crate) fn absent_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    // A selector matching nothing arrives as None or as an empty matrix, and eval_range walks
    // series, so it has none to report on - the absence this function exists for is the one case
    // it cannot see. Answer that here, before delegating the per-series case to it.
    let nothing_matched = match &data {
        Value::None => true,
        Value::Matrix(matrix) => matrix.is_empty(),
        _ => false,
    };
    if nothing_matched {
        return Ok(Value::Matrix(vec![RangeValue {
            labels: Labels::default(),
            samples: eval_ctx
                .timestamps()
                .into_iter()
                .map(|timestamp| Sample::new(timestamp, 1.0))
                .collect(),
            exemplars: None,
            time_window: None,
        }]));
    }

    super::eval_range(data, AbsentOverTimeFunc::new(), eval_ctx)
}

pub struct AbsentOverTimeFunc;

impl AbsentOverTimeFunc {
    pub fn new() -> Self {
        AbsentOverTimeFunc {}
    }
}

impl RangeFunc for AbsentOverTimeFunc {
    fn name(&self) -> &'static str {
        "absent_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return Some(1.0);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::TimeWindow;

    use super::*;

    // Test helper
    fn reported(value: &Value) -> Vec<(i64, f64)> {
        match value {
            Value::Matrix(v) => v
                .iter()
                .flat_map(|series| series.samples.iter())
                .map(|sample| (sample.timestamp, sample.value))
                .collect(),
            _ => panic!("Expected Matrix result"),
        }
    }

    // Test helper
    fn absent_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        absent_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_absent_over_time_value_none_input() {
        let result = absent_over_time_test_helper(Value::None).unwrap();

        match &result {
            Value::Matrix(v) => assert_eq!(
                v.len(),
                1,
                "a metric that is entirely gone is still one answer"
            ),
            _ => panic!("Expected Matrix result"),
        }
        assert_eq!(reported(&result), vec![(3000, 1.0)]);
    }

    #[test]
    fn test_absent_over_time_reports_every_step_of_a_range_query() {
        let eval_ctx = EvalContext::new(1000, 3000, 1000, "test".to_string());
        let result = absent_over_time(Value::None, &eval_ctx).unwrap();

        assert_eq!(
            reported(&result),
            vec![(1000, 1.0), (2000, 1.0), (3000, 1.0)]
        );
    }

    #[test]
    fn test_absent_over_time_is_silent_while_the_metric_reports() {
        let range_value = RangeValue {
            labels: Labels::default(),
            samples: vec![Sample::new(3000, 5.0)],
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };
        let result = absent_over_time_test_helper(Value::Matrix(vec![range_value])).unwrap();

        match result {
            Value::Matrix(v) => assert!(v.is_empty(), "present data must report no absence"),
            _ => panic!("Expected Matrix result"),
        }
    }

    #[test]
    fn test_absent_over_time_invalid_input_returns_err() {
        let result = absent_over_time_test_helper(Value::Float(1.0));
        assert!(result.is_err());
    }

    #[test]
    fn test_absent_over_time_exec_samples_present_returns_none() {
        let func = AbsentOverTimeFunc::new();
        let samples = vec![Sample::new(1000, 5.0)];
        assert!(func.exec(&samples, 0, &Duration::ZERO).is_none());
    }

    #[test]
    fn test_absent_over_time_exec_empty_returns_one() {
        let func = AbsentOverTimeFunc::new();
        assert_eq!(func.exec(&[], 0, &Duration::ZERO), Some(1.0));
    }

    #[test]
    fn test_absent_over_time_function() {
        // Test with empty matrix - should return 1.0
        let empty_matrix = Value::Matrix(vec![]);
        let result = absent_over_time_test_helper(empty_matrix).unwrap();

        assert_eq!(reported(&result), vec![(3000, 1.0)]);
    }
}
