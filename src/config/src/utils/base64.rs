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

use std::io::{Error, ErrorKind};

use base64::Engine;

#[inline(always)]
pub fn decode(s: &str) -> Result<String, Error> {
    let ns = match base64::engine::general_purpose::STANDARD.decode(s.as_bytes()) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {e}"),
            ));
        }
    };
    let s = match String::from_utf8(ns) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {e}"),
            ));
        }
    };

    Ok(s)
}

#[inline(always)]
pub fn decode_raw(s: &str) -> Result<Vec<u8>, Error> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("base64 decode error: {e}")))
}

pub fn encode(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode() {
        let s = "aGVsbG8gd29ybGQ=";
        assert_eq!(decode(s).unwrap(), "hello world");
        assert!(decode(&s[..s.len() - 1]).is_err());
    }

    #[test]
    fn test_decode_raw_success() {
        let input = "aGVsbG8sIHdvcmxkIQ=="; // "hello, world!" base64-encoded
        let expected: Vec<u8> = b"hello, world!".to_vec();
        let result = decode_raw(input).expect("Failed to decode base64 input");
        assert_eq!(result, expected);
    }

    #[test]
    fn test_decode_raw_invalid_base64() {
        let input = "aGVsbG8sIHdvcmxkIQ!@"; // Invalid base64 string
        let result = decode_raw(input);
        assert!(
            result.is_err(),
            "Expected an error due to invalid base64 input"
        );

        if let Err(e) = result {
            assert_eq!(
                e.kind(),
                ErrorKind::InvalidData,
                "Expected an InvalidData error"
            );
        }
    }

    #[test]
    fn test_decode_raw_empty_input() {
        let input = ""; // Empty input string
        let expected: Vec<u8> = Vec::new();
        let result = decode_raw(input).expect("Failed to decode empty input");
        assert_eq!(result, expected);
    }
}
