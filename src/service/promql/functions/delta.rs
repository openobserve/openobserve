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
    value::{EvalContext, ExtrapolationKind, Sample, Value, extrapolated_rate},
};

pub(crate) fn delta(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, DeltaFunc::new(), eval_ctx)
}

pub struct DeltaFunc;

impl DeltaFunc {
    pub fn new() -> Self {
        DeltaFunc {}
    }
}

impl RangeFunc for DeltaFunc {
    fn name(&self) -> &'static str {
        "delta"
    }

    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
        extrapolated_rate(
            samples,
            eval_ts,
            *range,
            Duration::ZERO,
            ExtrapolationKind::Delta,
        )
    }
}
