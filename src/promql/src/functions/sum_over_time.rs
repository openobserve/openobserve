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

use config::meta::promql::value::Sample;

use crate::{common::kahan_sum_increment, functions::RangeFunc};

pub struct SumOverTimeFunc;

impl RangeFunc for SumOverTimeFunc {
    fn name(&self) -> &'static str {
        "sum_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        let (sum, c) = samples.iter().fold((0.0, 0.0), |(sum, c), s| {
            kahan_sum_increment(s.value, sum, c)
        });
        Some(if sum.is_infinite() { sum } else { sum + c })
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
    fn test_sum_over_time_name() {
        assert_eq!(SumOverTimeFunc.name(), "sum_over_time");
    }

    #[test]
    fn test_sum_over_time_empty() {
        let func = SumOverTimeFunc;
        assert!(func.exec(&[], 0, &Duration::from_secs(1)).is_none());
    }

    #[test]
    fn test_sum_over_time_single() {
        let func = SumOverTimeFunc;
        let samples = make_samples(&[5.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(5.0));
    }

    #[test]
    fn test_sum_over_time_multiple() {
        let func = SumOverTimeFunc;
        let samples = make_samples(&[1.0, 2.0, 3.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::from_secs(1)), Some(6.0));
    }

    #[test]
    fn test_sum_over_time_uses_kahan_summation() {
        let func = SumOverTimeFunc;
        let samples = make_samples(&[1e100, 1.0, -1e100]);
        assert_eq!(func.exec(&samples, 0, &Duration::ZERO), Some(1.0));
        let samples = make_samples(&[f64::INFINITY, 1.0]);
        assert_eq!(func.exec(&samples, 0, &Duration::ZERO), Some(f64::INFINITY));
    }
}
