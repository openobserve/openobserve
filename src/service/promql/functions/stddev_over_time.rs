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

use crate::service::promql::{common::std_deviation, functions::RangeFunc};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#stddev_over_time
pub(crate) fn stddev_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, StddevOverTimeFunc::new(), eval_ctx)
}

pub struct StddevOverTimeFunc;

impl StddevOverTimeFunc {
    pub fn new() -> Self {
        StddevOverTimeFunc {}
    }
}

impl RangeFunc for StddevOverTimeFunc {
    fn name(&self) -> &'static str {
        "stddev_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        let sample_values: Vec<f64> = samples.iter().map(|s| s.value).collect();
        std_deviation(&sample_values)
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
    fn test_stddev_over_time_name() {
        assert_eq!(StddevOverTimeFunc::new().name(), "stddev_over_time");
    }

    #[test]
    fn test_stddev_over_time_empty() {
        let func = StddevOverTimeFunc::new();
        assert!(func.exec(&[], 0, &Duration::from_secs(1)).is_none());
    }

    #[test]
    fn test_stddev_over_time_constant() {
        let func = StddevOverTimeFunc::new();
        let samples = make_samples(&[3.0, 3.0, 3.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(0.0));
    }

    #[test]
    fn test_stddev_over_time_non_trivial() {
        let func = StddevOverTimeFunc::new();
        // [1,2,3]: mean=2, variance=2/3, stddev=sqrt(2/3)
        let samples = make_samples(&[1.0, 2.0, 3.0]);
        let result = func.exec(&samples, 0, &Duration::from_secs(1)).unwrap();
        assert!((result - (2.0_f64 / 3.0_f64).sqrt()).abs() < 1e-10);
    }
}
