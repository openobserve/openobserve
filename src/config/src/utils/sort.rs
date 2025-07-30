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

use std::cmp::Ordering;

pub fn sort_float(a: &f64, b: &f64) -> Ordering {
    match (a.is_nan(), b.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, _) => Ordering::Less,
        (_, true) => Ordering::Greater,
        _ => a.partial_cmp(b).unwrap_or(Ordering::Equal),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sort_float() {
        // Test regular numbers
        assert_eq!(sort_float(&1.0, &2.0), Ordering::Less);
        assert_eq!(sort_float(&2.0, &1.0), Ordering::Greater);
        assert_eq!(sort_float(&1.0, &1.0), Ordering::Equal);

        // Test with NaN
        assert_eq!(sort_float(&f64::NAN, &1.0), Ordering::Less);
        assert_eq!(sort_float(&1.0, &f64::NAN), Ordering::Greater);
        assert_eq!(sort_float(&f64::NAN, &f64::NAN), Ordering::Equal);

        // Test with infinity
        assert_eq!(sort_float(&f64::INFINITY, &1.0), Ordering::Greater);
        assert_eq!(sort_float(&f64::NEG_INFINITY, &1.0), Ordering::Less);
        assert_eq!(sort_float(&f64::INFINITY, &f64::INFINITY), Ordering::Equal);
    }

    #[test]
    fn test_sort_float_array() {
        let mut numbers = [
            1.5,
            f64::NAN,
            0.0,
            f64::INFINITY,
            -2.7,
            f64::NEG_INFINITY,
            f64::NAN,
            std::f64::consts::PI,
        ];

        // Sort the vector using our custom sort_float function
        numbers.sort_by(sort_float);

        // Create expected result
        // NaN values should come first (treated as smallest)
        // Then negative infinity
        // Then regular numbers in ascending order
        // Then positive infinity
        let expected = [
            f64::NAN,
            f64::NAN,
            f64::NEG_INFINITY,
            -2.7,
            0.0,
            1.5,
            std::f64::consts::PI,
            f64::INFINITY,
        ];

        // We can't directly compare vectors with NaN values using assert_eq!
        // So we'll check each element's position
        for (i, (actual, expected)) in numbers.iter().zip(expected.iter()).enumerate() {
            if actual.is_nan() && expected.is_nan() {
                continue; // Both are NaN, this is fine
            }
            assert_eq!(
                actual, expected,
                "Mismatch at position {i}: expected {expected:?}, got {actual:?}"
            );
        }
    }
}
