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

use itertools::Itertools;

use crate::INDEX_MIN_CHAR_LEN;

/// Split a string into tokens based on a delimiter. if delimiter is empty, split by whitespace and
/// punctuation. also filter out tokens that are less than INDEX_MIN_CHAR_LEN characters long.
pub fn split_token(s: &str, delimiter: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| {
            if delimiter.is_empty() {
                c.is_whitespace() || c.is_ascii_punctuation()
            } else {
                delimiter.contains(c)
            }
        })
        .filter_map(|s| {
            let s = s.trim().trim_matches(|c: char| c.is_ascii_punctuation());
            if s.len() >= INDEX_MIN_CHAR_LEN {
                Some(s.to_string())
            } else {
                None
            }
        })
        .unique()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_string() {
        let result = split_token("", "");
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_empty_delimiter() {
        let result = split_token("Hello, world! This is a test.", "");
        assert_eq!(
            result,
            vec![
                "hello".to_string(),
                "world".to_string(),
                "this".to_string(),
                "test".to_string()
            ]
        );
    }

    #[test]
    fn test_non_empty_delimiter() {
        let result = split_token("Hello,world,This,is,a,test", ",");
        assert_eq!(
            result,
            vec![
                "hello".to_string(),
                "world".to_string(),
                "this".to_string(),
                "test".to_string()
            ]
        );
    }

    #[test]
    fn test_mixed_whitespace_and_punctuation() {
        let result = split_token("Hello, world! This - is; a: test.", "");
        assert_eq!(
            result,
            vec![
                "hello".to_string(),
                "world".to_string(),
                "this".to_string(),
                "test".to_string()
            ]
        );
    }

    #[test]
    fn test_all_punctuation() {
        let result = split_token("!!!,,,;;;...???", "");
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_min_char_length_filter() {
        let result = split_token("a an and", "");
        assert_eq!(result, vec!["and".to_string()]);
    }

    #[test]
    fn test_with_numeric_characters() {
        let result = split_token("123 4567 89", "");
        assert_eq!(result, vec!["123".to_string(), "4567".to_string()]);
    }

    #[test]
    fn test_leading_and_trailing_punctuation() {
        let result = split_token("!!!Hello!!! !!!world!!!", "");
        assert_eq!(result, vec!["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn test_duplicate_tokens() {
        let result = split_token("hello, hello, world, world", ",");
        assert_eq!(result, vec!["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn test_mixed_case_sensitivity() {
        let result = split_token("Hello, HeLLo, WORLD, world", ",");
        assert_eq!(result, vec!["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn test_delimiter_as_whitespace() {
        let result = split_token("Hello world This is a test", " ");
        assert_eq!(
            result,
            vec![
                "hello".to_string(),
                "world".to_string(),
                "this".to_string(),
                "test".to_string()
            ]
        );
    }

    #[test]
    fn test_complex_delimiter() {
        let result = split_token("Hello||world||This||is||a||test", "||");
        assert_eq!(
            result,
            vec![
                "hello".to_string(),
                "world".to_string(),
                "this".to_string(),
                "test".to_string()
            ]
        );
    }
}
