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

use std::hash::{DefaultHasher, Hasher};

use super::Sum64;

pub fn new() -> DefaultHasher {
    DefaultHasher::new()
}

impl Sum64 for DefaultHasher {
    fn sum64(&mut self, key: &str) -> u64 {
        self.write(key.as_bytes());
        self.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_hasher_sum64() {
        let mut h = new();
        assert_eq!(h.sum64("hello"), 16350172494705860510);
        assert_eq!(h.sum64("world"), 1348462810646499051);
        assert_eq!(h.sum64("foo"), 13658606619662280602);
        assert_eq!(h.sum64("bar"), 11254443135816450233);
        assert_eq!(h.sum64("test"), 18199023029103496422);
        assert_eq!(h.sum64("test1"), 5073490808167294919);
        assert_eq!(h.sum64("test2"), 14030261930256505646);
    }
}
