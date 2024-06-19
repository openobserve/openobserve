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
