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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_samples(values: &[f64]) -> Vec<Sample> {
        values
            .iter()
            .enumerate()
            .map(|(i, &v)| Sample {
                timestamp: i as i64 * 1_000_000,
                value: v,
            })
            .collect()
    }

    #[test]
    fn test_quantile_over_time_name() {
        assert_eq!(QuantileOverTimeFunc::new(0.5).name(), "quantile_over_time");
    }

    #[test]
    fn test_quantile_over_time_empty() {
        let func = QuantileOverTimeFunc::new(0.5);
        assert!(func.exec(&[], 0, &Duration::from_secs(1)).is_none());
    }

    #[test]
    fn test_quantile_over_time_median() {
        let func = QuantileOverTimeFunc::new(0.5);
        let samples = make_samples(&[1.0, 2.0, 3.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(2.0));
    }

    #[test]
    fn test_quantile_over_time_min() {
        let func = QuantileOverTimeFunc::new(0.0);
        let samples = make_samples(&[3.0, 1.0, 2.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(1.0));
    }

    #[test]
    fn test_quantile_over_time_max() {
        let func = QuantileOverTimeFunc::new(1.0);
        let samples = make_samples(&[3.0, 1.0, 2.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(3.0));
    }
}
