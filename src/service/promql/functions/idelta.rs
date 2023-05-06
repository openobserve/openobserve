// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use datafusion::error::Result;

use crate::service::promql::value::{RangeValue, Value};

pub(crate) fn idelta(data: &Value) -> Result<Value> {
    super::eval_idelta(data, "idelta", exec)
}

fn exec(data: &RangeValue) -> f64 {
    if data.values.len() <= 1 {
        return 0.0;
    }
    let (last, data) = data.values.split_last().unwrap();
    let previous = match data.last() {
        Some(v) => v,
        None => return 0.0,
    };
    last.value - previous.value
}
