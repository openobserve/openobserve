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

// Get the md5 hash of a string
pub fn hash(input: &str) -> String {
    let digest = md5::compute(input.as_bytes());
    format!("{digest:x}")
}

// Get a short hash of a string
pub fn short_hash(input: &str) -> String {
    // md5 hash will always consist of 32 characters
    let hash = hash(input);

    // get the middle index of the hash string
    // and extract 16 characters from the middle
    let mid_index = hash.len() / 2;
    let short_id = &hash[mid_index - 8..mid_index + 8];
    short_id.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash() {
        let input = "hello world";
        let expected = "5eb63bbbe01eeed093cb22bb8f5acdc3";
        let res = hash(input);
        assert_eq!(res, expected);
        assert_eq!(res.len(), 32);
    }

    #[test]
    fn test_short_hash() {
        let input = "hello world";
        let expected = "e01eeed093cb22bb";
        assert_eq!(short_hash(input), expected);
    }

    #[test]
    fn test_hash_empty_string() {
        // md5 of empty string is a well-known constant
        assert_eq!(hash(""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hash("").len(), 32);
    }

    #[test]
    fn test_hash_is_deterministic() {
        let input = "openobserve";
        assert_eq!(hash(input), hash(input));
    }

    #[test]
    fn test_hash_different_inputs_produce_different_outputs() {
        assert_ne!(hash("foo"), hash("bar"));
        // Single-character difference still produces a different hash.
        assert_ne!(hash("hello world"), hash("hello world!"));
    }

    #[test]
    fn test_hash_unicode_input() {
        // Non-ASCII content must hash without panicking and yield a 32-char hex string.
        let result = hash("こんにちは🌍");
        assert_eq!(result.len(), 32);
        assert!(result.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_short_hash_length_and_content() {
        let input = "hello world";
        let full = hash(input);
        let short = short_hash(input);
        // short_hash returns the middle 16 chars of the 32-char md5 hex digest.
        assert_eq!(short.len(), 16);
        assert_eq!(short, &full[8..24]);
        assert!(short.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_short_hash_empty_string() {
        // Middle 16 characters of the empty-string md5.
        let full = hash("");
        let short = short_hash("");
        assert_eq!(short, &full[8..24]);
    }

    #[test]
    fn test_short_hash_is_deterministic() {
        let input = "openobserve";
        assert_eq!(short_hash(input), short_hash(input));
    }
}
