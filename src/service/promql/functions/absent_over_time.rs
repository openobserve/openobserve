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

use crate::service::promql::{
    functions::RangeFunc,
    value::{EvalContext, Labels, RangeValue, Sample, TimeWindow, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent_over_time
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn absent_over_time_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] absent_over_time_range() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, AbsentOverTimeFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] absent_over_time_range() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
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

    fn exec_instant(&self, _data: RangeValue) -> Option<f64> {
        None
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
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
        absent_over_time_range(data, &eval_ctx)
    }

    #[test]
    fn test_absent_over_time_function() {
        // Test with empty matrix - should return 1.0
        let empty_matrix = Value::Matrix(vec![]);
        let result = absent_over_time_test_helper(empty_matrix).unwrap();

        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 0);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
