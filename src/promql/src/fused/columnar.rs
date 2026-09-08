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

//! One shared timestamp axis and a dense value column per series, for consumers that keep the
//! whole matrix: half the bytes of `Vec<RangeValue>`, and one contiguous slice per series.

use std::sync::Arc;

use config::meta::promql::value::Labels;

/// A quiet NaN with a payload arithmetic never produces; marks a slot the function left empty.
const MISSING_BITS: u64 = 0x7ff8_0000_0000_ffff;

pub(crate) const MISSING: f64 = f64::from_bits(MISSING_BITS);

pub(crate) struct ColumnarSeries {
    pub labels: Labels,
    /// One value per timestamp, `MISSING` where the function produced none.
    pub values: Vec<f64>,
}

pub(crate) struct ColumnarMatrix {
    pub timestamps: Arc<[i64]>,
    pub series: Vec<ColumnarSeries>,
}

pub(crate) fn is_missing(value: f64) -> bool {
    value.to_bits() == MISSING_BITS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_missing_is_not_an_ordinary_nan() {
        assert!(is_missing(MISSING));
        assert!(MISSING.is_nan());
        assert!(!is_missing(f64::NAN));
        let zero: f64 = "0".parse().unwrap();
        assert!(!is_missing(zero / zero));
        assert!(!is_missing(f64::INFINITY - f64::INFINITY));
        assert!(!is_missing(1.5));
    }
}
