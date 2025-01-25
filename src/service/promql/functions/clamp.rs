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

use crate::service::promql::value::{InstantValue, Sample, Value};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#clamp
pub(crate) fn clamp(data: Value, min: f64, max: f64) -> Result<Value> {
    let vec = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "clamp: InstantValue argument expected".into(),
            ));
        }
    };

    let out = vec
        .into_iter()
        .map(|mut instant| {
            let value = instant.sample.value.clamp(min, max);
            InstantValue {
                labels: std::mem::take(&mut instant.labels),
                sample: Sample::new(instant.sample.timestamp, value),
            }
        })
        .collect();
    Ok(Value::Vector(out))
}
