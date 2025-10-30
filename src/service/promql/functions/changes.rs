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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#changes
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn changes_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!("[PromQL Timing] changes_range() started");
    let result = super::eval_range(data, ChangesFunc::new(), eval_ctx);
    log::info!(
        "[PromQL Timing] changes_range() execution took: {:?}",
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

    fn exec_instant(&self, _data: RangeValue) -> Option<f64> {
        None
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
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
        let eval_ctx = EvalContext::instant(3000);
        changes_range(data, &eval_ctx)
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
                eval_ts: 4000,
                range: Duration::from_secs(3),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = changes_test_helper(matrix).unwrap();

        // Should return a vector with number of changes
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
