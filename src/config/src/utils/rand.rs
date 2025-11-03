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

use rand::{
    Rng,
    distr::{Alphanumeric, SampleString},
};

pub fn get_rand_element<T>(arr: &[T]) -> &T {
    let mut buf = [0u8; 1];
    rand::rng().fill(&mut buf);
    &arr[buf[0] as usize % arr.len()]
}

pub fn generate_random_string(len: usize) -> String {
    Alphanumeric.sample_string(&mut rand::rng(), len)
}

/// Generate random number within the given range
pub fn get_rand_num_within(min: u64, max: u64) -> u64 {
    if max <= min {
        return min;
    }
    let mut buf = [0u8; 1];
    rand::rng().fill(&mut buf);
    min + buf[0] as u64 % (max - min)
}

pub fn get_rand_u128() -> u128 {
    let mut buf = [0u8; 16];
    rand::rng().fill(&mut buf);
    u128::from_le_bytes(buf)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn test_get_rand_element() {
        let arr = vec![1, 2, 3, 4, 5];
        let element = get_rand_element(&arr);
        assert!(arr.contains(element));
    }

    #[test]
    fn test_generate_random_string() {
        let len = 10;
        let s = generate_random_string(len);
        assert_eq!(s.len(), len);
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_get_rand_num_within() {
        let min = 5;
        let max = 10;
        let num = get_rand_num_within(min, max);
        assert!(num >= min && num < max);
    }

    #[test]
    fn test_get_rand_num_within_same_range() {
        let num = get_rand_num_within(5, 5);
        assert_eq!(num, 5);
    }

    #[test]
    fn test_get_rand_u128() {
        let num = get_rand_u128();
        assert!(num > 0);
    }

    #[test]
    fn test_random_distribution() {
        // Test that we get different values on multiple calls
        let values: HashSet<u128> = HashSet::from_iter((0..100).map(|_| get_rand_u128()));
        // We should have at least 90 different values out of 100 calls
        assert!(values.len() > 90);
    }
}
