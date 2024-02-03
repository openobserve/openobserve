// Copyright 2023 Zinc Labs Inc.
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

// offset64 FNVa offset basis. See https://en.wikipedia.org/wiki/Fowler–Noll–Vo_hash_function#FNV-1a_hash
const OFFSET64: u64 = 14695981039346656037;
// prime64 FNVa prime value. See https://en.wikipedia.org/wiki/Fowler–Noll–Vo_hash_function#FNV-1a_hash
const PRIME64: u64 = 1099511628211;

/// refer: https://github.com/allegro/bigcache/blob/main/fnv.go
#[derive(Default)]
pub struct Fnv64a {}

pub fn new() -> Fnv64a {
    Fnv64a::new()
}

impl Fnv64a {
    pub fn new() -> Fnv64a {
        Fnv64a {}
    }

    pub fn sum64(&self, key: &str) -> u64 {
        let mut hash: u64 = OFFSET64;
        for c in key.chars() {
            hash ^= c as u64;
            hash = hash.wrapping_mul(PRIME64);
        }
        hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fnv64a() {
        let fnv = Fnv64a::new();
        assert_eq!(fnv.sum64("hello"), 11831194018420276491);
        assert_eq!(fnv.sum64("world"), 5717881983045765875);
        assert_eq!(fnv.sum64("foo"), 15902901984413996407);
        assert_eq!(fnv.sum64("bar"), 16101355973854746);
    }
}
