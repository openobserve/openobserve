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

pub(crate) fn sum_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, SumOverTimeFunc::new(), eval_ctx)
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

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        Some(samples.iter().map(|s| s.value).sum())
    }
}
