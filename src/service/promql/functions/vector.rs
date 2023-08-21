// Copyright 2023 Zinc Labs Inc.
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

use crate::service::promql::value::{InstantValue, Labels, Sample, Value};
use datafusion::error::{DataFusionError, Result};

pub(crate) fn vector(data: &Value, eval_ts: i64) -> Result<Value> {
    let value = match data {
        Value::Float(f) => *f,
        _ => {
            return Err(DataFusionError::NotImplemented(
                "Unexpected input. Expected: \"vector(s scalar)\"".into(),
            ));
        }
    };

    let instant = InstantValue {
        labels: Labels::default(),
        sample: Sample {
            timestamp: eval_ts,
            value,
        },
    };
    Ok(Value::Vector(vec![instant]))
}
