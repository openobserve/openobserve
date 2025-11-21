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

use std::time::Duration;

use config::meta::promql::value::{EvalContext, Sample, Value};
use datafusion::error::Result;

use crate::service::promql::{common::quantile, functions::RangeFunc};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#quantile_over_time
pub(crate) fn quantile_over_time(
    phi_quantile: f64,
    data: Value,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    super::eval_range(data, QuantileOverTimeFunc::new(phi_quantile), eval_ctx)
}

pub struct QuantileOverTimeFunc {
    phi_quantile: f64,
}

impl QuantileOverTimeFunc {
    pub fn new(phi_quantile: f64) -> Self {
        QuantileOverTimeFunc { phi_quantile }
    }
}

impl RangeFunc for QuantileOverTimeFunc {
    fn name(&self) -> &'static str {
        "quantile_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        let input: Vec<f64> = samples.iter().map(|x| x.value).collect();
        quantile(&input, self.phi_quantile)
    }
}
