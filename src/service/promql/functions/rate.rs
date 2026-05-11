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

use config::meta::promql::value::{
    EvalContext, ExtrapolationKind, Sample, Value, extrapolated_rate,
};
use datafusion::error::Result;

use crate::service::promql::functions::RangeFunc;

pub(crate) fn rate(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    super::eval_range(data, RateFunc::new(), eval_ctx)
}

pub struct RateFunc;

impl RateFunc {
    pub fn new() -> Self {
        RateFunc {}
    }
}

impl RangeFunc for RateFunc {
    fn name(&self) -> &'static str {
        "rate"
    }

    fn exec(&self, samples: &[Sample], eval_ts: i64, range: &Duration) -> Option<f64> {
        extrapolated_rate(
            samples,
            eval_ts,
            *range,
            Duration::ZERO,
            ExtrapolationKind::Rate,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_name() {
        assert_eq!(RateFunc::new().name(), "rate");
    }

    #[test]
    fn test_rate_empty_samples() {
        let func = RateFunc::new();
        assert!(func.exec(&[], 0, &Duration::from_secs(60)).is_none());
    }

    #[test]
    fn test_rate_single_sample() {
        let func = RateFunc::new();
        let sample = Sample {
            timestamp: 60_000_000,
            value: 100.0,
        };
        assert!(
            func.exec(&[sample], 120_000_000, &Duration::from_secs(60))
                .is_none()
        );
    }

    #[test]
    fn test_rate_two_samples_returns_some() {
        let func = RateFunc::new();
        // range=60s, eval_ts=120s, start=60s
        // samples within [60s, 120s]
        let samples = vec![
            Sample {
                timestamp: 70_000_000,
                value: 100.0,
            },
            Sample {
                timestamp: 110_000_000,
                value: 200.0,
            },
        ];
        let result = func.exec(&samples, 120_000_000, &Duration::from_secs(60));
        assert!(result.is_some());
        assert!(result.unwrap() >= 0.0);
    }
}
