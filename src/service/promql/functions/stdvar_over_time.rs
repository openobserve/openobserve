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
    common::std_variance,
    functions::RangeFunc,
    value::{EvalContext, Labels, RangeValue, Sample, TimeWindow, Value},
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#stdvar_over_time
/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn stdvar_over_time_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id: {}] [PromQL Timing] stdvar_over_time_range() started",
        eval_ctx.trace_id
    );
    let result = super::eval_range(data, StdvarOverTimeFunc::new(), eval_ctx);
    log::info!(
        "[trace_id: {}] [PromQL Timing] stdvar_over_time_range() execution took: {:?}",
        eval_ctx.trace_id,
        start.elapsed()
    );
    result
}

pub struct StdvarOverTimeFunc;

impl StdvarOverTimeFunc {
    pub fn new() -> Self {
        StdvarOverTimeFunc {}
    }
}

impl RangeFunc for StdvarOverTimeFunc {
    fn name(&self) -> &'static str {
        "stdvar_over_time"
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
            return None;
        }
        let sample_values: Vec<f64> = samples.iter().map(|s| s.value).collect();
        std_variance(&sample_values)
    }
}
