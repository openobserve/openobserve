// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use base64::Engine;
use std::io::{Error, ErrorKind};

#[inline(always)]
pub(crate) fn decode(s: &str) -> Result<String, Error> {
    let ns = match base64::engine::general_purpose::STANDARD.decode(s.as_bytes()) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {e}"),
            ))
        }
    };
    let s = match String::from_utf8(ns) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {e}"),
            ))
        }
    };

    Ok(s)
}

#[inline(always)]
pub(crate) fn decode_raw(s: &str) -> Result<Vec<u8>, Error> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("base64 decode error: {e}")))
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
