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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent_over_time
pub(crate) fn absent_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
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
    use super::*;

    // Test helper
    fn absent_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        absent_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_absent_over_time_function() {
        // Test with empty matrix - should return 1.0
        let empty_matrix = Value::Matrix(vec![]);
        let result = absent_over_time_test_helper(empty_matrix).unwrap();

        match result {
            Value::Matrix(v) => {
                assert_eq!(v.len(), 0);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
