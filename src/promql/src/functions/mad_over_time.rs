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

use crate::{common::quantile_in_place, functions::RangeFunc};

/// The median absolute deviation of the window's samples.
pub struct MadOverTimeFunc;

impl RangeFunc for MadOverTimeFunc {
    fn name(&self) -> &'static str {
        "mad_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        // a NaN makes the median undefined, so it poisons the result instead of being dropped
        if samples.iter().any(|sample| sample.value.is_nan()) {
            return Some(f64::NAN);
        }
        let mut values: Vec<f64> = samples.iter().map(|sample| sample.value).collect();
        let median = quantile_in_place(&mut values, 0.5)?;
        for value in &mut values {
            *value = (*value - median).abs();
        }
        quantile_in_place(&mut values, 0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mad(values: &[f64]) -> Option<f64> {
        let samples: Vec<_> = values
            .iter()
            .enumerate()
            .map(|(i, v)| Sample::new(i as i64 * 10_000_000, *v))
            .collect();
        MadOverTimeFunc.exec(&samples, 0, &Duration::ZERO)
    }

    /// Cases from upstream `functions.test`.
    #[test]
    fn test_mad_over_time() {
        assert_eq!(mad(&[6.0, 2.0, 1.0, 999.0, 1.0, 2.0]), Some(1.0));
        assert_eq!(mad(&[1.0, 2.0, 3.0, 4.0, 5.0]), Some(1.0));
        assert_eq!(mad(&[7.0, 7.0, 7.0, 7.0, 7.0]), Some(0.0));
        assert_eq!(mad(&[5.0]), Some(0.0));
        assert!(mad(&[1.0, 2.0, f64::NAN, 4.0]).unwrap().is_nan());
        assert_eq!(mad(&[]), None);
    }
}
