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

use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};

pub(crate) fn vector(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let value = match data {
        Value::Float(f) => f,
        _ => {
            return Err(DataFusionError::Plan(
                "Unexpected input. Expected: \"vector(s scalar)\"".into(),
            ));
        }
    };

    // Generate samples using timestamps from eval_ctx
    let samples: Vec<Sample> = eval_ctx
        .timestamps()
        .iter()
        .map(|&ts| Sample::new(ts, value))
        .collect();

    // Create a matrix with a single RangeValue containing all generated samples
    let range_value = RangeValue {
        labels: Labels::default(),
        samples,
        exemplars: None,
        time_window: None,
    };

    Ok(Value::Matrix(vec![range_value]))
}
