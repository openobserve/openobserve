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
pub fn decode(s: &str) -> Result<String, Error> {
    let ns = match base64::engine::general_purpose::STANDARD.decode(s.as_bytes()) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {}", e),
            ))
        }
    };
    let s = match String::from_utf8(ns) {
        Ok(v) => v,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("base64 decode error: {}", e),
            ))
        }
    };

    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode() {
        let s = "aGVsbG8gd29ybGQ=";
        let s = decode(s).unwrap();
        assert_eq!(s, "hello world");

        let s = "aGVsbG8gd29ybGQ";
        let s = decode(s);
        assert_eq!(s.is_err(), true);
    }
}
