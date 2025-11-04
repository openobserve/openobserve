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

use datafusion::error::{DataFusionError, Result};

use crate::service::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};

pub(crate) fn vector_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let value = match data {
        Value::Float(f) => f,
        _ => {
            return Err(DataFusionError::Plan(
                "Unexpected input. Expected: \"vector(s scalar)\"".into(),
            ));
        }
    };

    // Generate samples based on start, end, and step from eval_ctx
    let mut samples = Vec::new();
    let mut current_ts = eval_ctx.start;

    while current_ts <= eval_ctx.end {
        samples.push(Sample::new(current_ts, value));
        current_ts += eval_ctx.step;
    }

    // Create a matrix with a single RangeValue containing all generated samples
    let range_value = RangeValue {
        labels: Labels::default(),
        samples,
        exemplars: None,
        time_window: None,
    };

    Ok(Value::Matrix(vec![range_value]))
}
