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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn absent_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] absent_range() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, AbsentFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] absent_range() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct AbsentFunc;

impl AbsentFunc {
    pub fn new() -> Self {
        AbsentFunc {}
    }
}

impl RangeFunc for AbsentFunc {
    fn name(&self) -> &'static str {
        "absent"
    }

    fn exec_instant(&self, data: RangeValue) -> Option<f64> {
        // Return 1.0 if no samples exist, None otherwise
        if data.samples.is_empty() {
            Some(1.0)
        } else {
            None
        }
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        // Return 1.0 if no samples exist, None otherwise
        if samples.is_empty() { Some(1.0) } else { None }
    }
}
