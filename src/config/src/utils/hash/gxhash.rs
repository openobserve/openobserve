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

use super::Sum64;

pub struct GxHash {}

pub fn new() -> GxHash {
    GxHash {}
}

impl Sum64 for GxHash {
    fn sum64(&mut self, key: &str) -> u64 {
        gxhash::gxhash64(key.as_bytes(), 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gxhash_sum64() {
        let mut h = new();
        for key in &[
            "hello", "world", "foo", "bar", "test", "test1", "test2", "test3",
        ] {
            let sum = h.sum64(key);
            println!("{}: {}", key, sum);
        }
        assert_eq!(h.sum64("hello"), 17199510979973968020);
        assert_eq!(h.sum64("world"), 16083628800851799373);
        assert_eq!(h.sum64("foo"), 12351526755496507957);
        assert_eq!(h.sum64("bar"), 2492955946775841796);
        assert_eq!(h.sum64("test"), 687545438460047850);
        assert_eq!(h.sum64("test1"), 13065486829486102133);
        assert_eq!(h.sum64("test2"), 16870625056057693394);
        assert_eq!(h.sum64("test3"), 14341735574462002086);
    }
}
