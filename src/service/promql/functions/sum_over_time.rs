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
    value::{EvalContext, Labels, Sample, TimeWindow, Value},
};

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn sum_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum_over_time() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, SumOverTimeFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] sum_over_time() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct SumOverTimeFunc;

impl SumOverTimeFunc {
    pub fn new() -> Self {
        SumOverTimeFunc {}
    }
}

impl RangeFunc for SumOverTimeFunc {
    fn name(&self) -> &'static str {
        "sum_over_time"
    }

    fn exec(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        Some(samples.iter().map(|s| s.value).sum())
    }
}
