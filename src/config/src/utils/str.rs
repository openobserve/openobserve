// Copyright 2024 Zinc Labs Inc.
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

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn find(haystack: &str, needle: &str) -> bool {
    memchr::memmem::find(haystack.as_bytes(), needle.as_bytes()).is_some()
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn find(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find() {
        let haystack = "This is search-unitTest";
        let needle = "unitTest";
        assert!(find(haystack, needle));
    }
}
