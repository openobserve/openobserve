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

pub(crate) fn avg_over_time(data: &Value) -> Result<Value> {
    super::eval_idelta(data, "avg_over_time", exec)
}

fn exec(data: &RangeValue) -> Option<f64> {
    if data.samples.is_empty() {
        return None;
    }
    Some(data.samples.iter().map(|s| s.value).sum::<f64>() / data.samples.len() as f64)
}
