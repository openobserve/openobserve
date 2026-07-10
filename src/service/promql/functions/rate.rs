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
    EvalContext, ExtrapolationKind, Sample, Value, extrapolated_rate, extrapolated_rate_prepared,
    reset_corrections,
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

    fn prepare(&self, samples: &[Sample]) -> Option<Vec<f64>> {
        Some(reset_corrections(samples))
    }

    fn exec_prepared(
        &self,
        samples: &[Sample],
        prepared: &[f64],
        window: (usize, usize),
        eval_ts: i64,
        range: &Duration,
    ) -> Option<f64> {
        extrapolated_rate_prepared(
            samples,
            prepared,
            window,
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
    fn test_rate_prepared_matches_exec() {
        // Counter with two resets; samples every 15s starting at t=1000s.
        let values = [
            10.0, 25.0, 40.0, 3.0, 18.0, 30.0, 55.0, 2.0, 9.0, 21.0, 40.0, 61.0,
        ];
        let samples: Vec<Sample> = values
            .iter()
            .enumerate()
            .map(|(i, &v)| Sample {
                timestamp: (1000 + 15 * i as i64) * 1_000_000,
                value: v,
            })
            .collect();
        let func = RateFunc::new();
        let range = Duration::from_secs(60);
        let prepared = func.prepare(&samples).unwrap();

        // Slide the eval timestamp so every window shape is exercised.
        for step in 0..20 {
            let eval_ts = (1030 + 15 * step) * 1_000_000;
            let ws = samples.partition_point(|s| s.timestamp < eval_ts - 60 * 1_000_000);
            let we = samples.partition_point(|s| s.timestamp <= eval_ts);
            if ws == we {
                continue;
            }
            let expected = func.exec(&samples[ws..we], eval_ts, &range);
            let got = func.exec_prepared(&samples, &prepared, (ws, we), eval_ts, &range);
            match (expected, got) {
                (None, None) => {}
                (Some(a), Some(b)) => {
                    assert!(
                        (a - b).abs() <= a.abs().max(b.abs()) * 1e-12,
                        "step {step}: exec={a} prepared={b}"
                    );
                }
                other => panic!("step {step}: mismatch {other:?}"),
            }
        }
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
