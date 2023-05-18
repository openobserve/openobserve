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

use crate::service::promql::value::{extrapolated_rate, ExtrapolationKind, RangeValue, Value};

pub(crate) fn increase(data: &Value) -> Result<Value> {
    super::eval_idelta(data, "increase", exec)
}

fn exec(series: &RangeValue) -> Option<f64> {
    let tw = series
        .time_window
        .as_ref()
        .expect("BUG: `increase` function requires time window");
    extrapolated_rate(
        &series.samples,
        tw.eval_ts,
        tw.range,
        tw.offset,
        ExtrapolationKind::Increase,
    )
}
