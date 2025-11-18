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

use crate::service::promql::value::{EvalContext, Value};

pub(crate) fn scalar(data: Value, _eval_ctx: &EvalContext) -> Result<Value> {
    println!("scalar input: {:?}", data);
    match data {
        Value::Float(f) => Ok(Value::Float(f)),
        Value::Matrix(v) => Ok(Value::Matrix(v)),
        _ => Err(DataFusionError::Plan(
            "Unexpected input. Expected: \"vector(s scalar)\"".into(),
        )),
    }
}
