// Copyright 2026 OpenObserve Inc.
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

//! The range function as a physical expression: one series in, one value per evaluation slot
//! out, shared by the aggregate and `eval_range`.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::{EvalContext, Sample};

use crate::functions::{RangeFunc, SeriesRange};

/// How one series becomes per-step values: the range function, its window, and the slots.
pub(crate) struct RangeExpr {
    pub(crate) func: Arc<dyn RangeFunc>,
    pub(crate) range: Duration,
    pub(crate) eval_ctx: EvalContext,
    pub(crate) timestamps: Vec<i64>,
}

impl RangeExpr {
    pub(crate) fn new(func: Arc<dyn RangeFunc>, range: Duration, eval_ctx: &EvalContext) -> Self {
        Self {
            func,
            range,
            eval_ctx: eval_ctx.clone(),
            timestamps: eval_ctx.timestamps(),
        }
    }

    /// The function's `(slot, value)` pairs over one series, in slot order.
    pub(super) fn values<'a>(
        &'a self,
        samples: &'a [Sample],
    ) -> impl Iterator<Item = (usize, f64)> + 'a {
        SeriesRange::new(
            samples,
            self.func.as_ref(),
            self.range,
            &self.eval_ctx,
            &self.timestamps,
        )
    }
}
