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

use datafusion::error::Result;

use crate::service::promql::{
    functions::RangeFunc,
    value::{EvalContext, Sample, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#changes
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn changes(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] changes() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, ChangesFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] changes() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct ChangesFunc;

impl ChangesFunc {
    pub fn new() -> Self {
        ChangesFunc {}
    }
}

impl RangeFunc for ChangesFunc {
    fn name(&self) -> &'static str {
        "changes"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        let changes = samples
            .iter()
            .zip(samples.iter().skip(1))
            .map(|(current, next)| (!current.value.eq(&next.value) as u32) as f64)
            .sum();
        Some(changes)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    // Test helper
    fn changes_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        changes(data, &eval_ctx)
    }

    #[test]
    fn test_changes_function() {
        // Create a range value with changing counter values
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 15.0),
            crate::service::promql::value::Sample::new(3000, 25.0),
            crate::service::promql::value::Sample::new(4000, 25.0), // No change
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_secs(3),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = changes_test_helper(matrix).unwrap();

        // Should return a matrix with number of changes
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert!(!m[0].samples.is_empty());
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
