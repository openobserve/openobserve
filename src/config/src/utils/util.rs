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

use crate::meta::stream::StreamType;

pub const DISTINCT_STREAM_PREFIX: &str = "distinct_values";

pub fn zero_or<T>(v: T, def: T) -> T
where
    T: PartialEq + Default,
{
    if v == Default::default() { def } else { v }
}

pub fn is_power_of_two(n: u64) -> bool {
    n == 0 || (n & (n - 1)) == 0
}

pub fn get_distinct_stream_name(st: StreamType, s: &str) -> String {
    format!("{}_{}_{}", DISTINCT_STREAM_PREFIX, st.as_str(), s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_or() {
        assert_eq!(zero_or(0, 1), 1);
        assert_eq!(zero_or(2, 1), 2);
        assert_eq!(zero_or(0, 0), 0);
        assert_eq!(zero_or(0.0, 1.1), 1.1);
        assert_eq!(zero_or(2.1, 1.1), 2.1);
        assert_eq!(zero_or("", "v"), "v");
        assert_eq!(zero_or("vv", "v"), "vv");
    }

    #[test]
    fn test_is_power_of_two() {
        assert!(is_power_of_two(0));
        assert!(is_power_of_two(1));
        assert!(is_power_of_two(2));
        assert!(!is_power_of_two(3));
        assert!(is_power_of_two(4));
        assert!(!is_power_of_two(5));
        assert!(!is_power_of_two(6));
        assert!(!is_power_of_two(7));
        assert!(is_power_of_two(8));
    }
}
