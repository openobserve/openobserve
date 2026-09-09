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
//! out, shared by the aggregate and the projection.

use std::{sync::Arc, time::Duration};

use config::meta::promql::value::{CounterSeries, EvalContext, ExtrapolationKind, Sample};

use crate::{
    functions::{RangeFunc, advance_sample_window},
    micros,
};

/// How one series becomes per-step values: the range function, its window, and the slots.
pub(crate) struct RangeExpr {
    pub(crate) func: Arc<dyn RangeFunc>,
    counter_kind: Option<ExtrapolationKind>,
    pub(crate) range: Duration,
    pub(crate) eval_ctx: EvalContext,
    pub(crate) timestamps: Vec<i64>,
}

impl RangeExpr {
    pub(crate) fn new(func: Arc<dyn RangeFunc>, range: Duration, eval_ctx: &EvalContext) -> Self {
        Self {
            counter_kind: func.counter_extrapolation(),
            func,
            range,
            eval_ctx: eval_ctx.clone(),
            timestamps: eval_ctx.timestamps(),
        }
    }

    /// Evaluates the function over one series, handing each value to `emit` with its slot.
    pub(super) fn evaluate(&self, samples: &[Sample], mut emit: impl FnMut(usize, f64)) {
        let range_micros = micros(self.range);
        let mut start_index = 0;
        let mut end_index = 0;
        let counter =
            CounterSeries::try_new(samples, self.counter_kind, &self.eval_ctx, range_micros);

        for (slot, &eval_ts) in self.timestamps.iter().enumerate() {
            let window_samples = advance_sample_window(
                samples,
                eval_ts - range_micros,
                eval_ts,
                &mut start_index,
                &mut end_index,
            );
            if window_samples.is_empty() {
                continue;
            }
            let value = match &counter {
                Some(counter) => counter.extrapolate(start_index, end_index, eval_ts, self.range),
                None => self.func.exec(window_samples, eval_ts, &self.range),
            };
            if let Some(value) = value {
                emit(slot, value);
            }
        }
    }
}
