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
    value::{
        EvalContext, ExtrapolationKind, Labels, RangeValue, Sample, TimeWindow, Value,
        extrapolated_rate,
    },
};

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn increase_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] increase_range() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, IncreaseFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] increase_range() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct IncreaseFunc;

impl IncreaseFunc {
    pub fn new() -> Self {
        IncreaseFunc {}
    }
}

impl RangeFunc for IncreaseFunc {
    fn name(&self) -> &'static str {
        "increase"
    }

    fn exec_instant(&self, _data: RangeValue) -> Option<f64> {
        None
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        let tw = time_win
            .as_ref()
            .expect("BUG: `increase` function requires time window");
        extrapolated_rate(
            samples,
            tw.eval_ts,
            tw.range,
            tw.offset,
            ExtrapolationKind::Increase,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    // Test helper
    fn increase_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::instant(3000, "test".to_string());
        increase_range(data, &eval_ctx)
    }

    #[test]
    fn test_increase_function() {
        // Create a range value with increasing counter values
        let samples = vec![crate::service::promql::value::Sample::new(1000, 10.0)];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                eval_ts: 3000,
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = increase_test_helper(matrix).unwrap();

        // Should return a vector with increase value
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 0);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
