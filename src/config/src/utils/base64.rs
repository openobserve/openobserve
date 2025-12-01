// Copyright 2025 OpenObserve Inc.
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

pub fn decode(s: impl AsRef<[u8]>) -> Result<String, Error> {
    match String::from_utf8(decode_raw(s)?) {
        Ok(v) => Ok(v),
        Err(e) => Err(Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode error: {e}"),
        )),
    }
}

pub fn decode_raw(s: impl AsRef<[u8]>) -> Result<Vec<u8>, Error> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_ref())
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("base64 decode error: {e}")))
}

pub fn encode(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

pub fn encode_url(s: &str) -> String {
    encode(s)
        .replace('+', "-")
        .replace('/', "_")
        .replace('=', ".")
}

pub fn decode_url(s: &str) -> Result<String, Error> {
    let s = s.replace('-', "+").replace('_', "/").replace('.', "=");
    decode(&s)
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

    #[test]
    fn test_encode() {
        let s = "hello world";
        assert_eq!(encode(s), "aGVsbG8gd29ybGQ=");

        let s = "/root/defau/root@example.com";
        assert_eq!(encode(s), "L3Jvb3QvZGVmYXUvcm9vdEBleGFtcGxlLmNvbQ==");
    }

    #[test]
    fn test_encode_url() {
        let s = "hello world";
        let s_e = "aGVsbG8gd29ybGQ.";
        assert_eq!(encode_url(s), s_e);
        assert_eq!(decode_url(s_e).unwrap(), s);

        let s = "/root/defau/root@example.com";
        let s_e = "L3Jvb3QvZGVmYXUvcm9vdEBleGFtcGxlLmNvbQ..";
        assert_eq!(encode_url(s), s_e);
        assert_eq!(decode_url(s_e).unwrap(), s);
    }

    // Additional edge case tests for better coverage
    #[test]
    fn test_decode_edge_cases() {
        // Test with padding
        assert_eq!(decode("aGVsbG8=").unwrap(), "hello");

        // Test with very long strings
        let long_string = "a".repeat(1000);
        let encoded = encode(&long_string);
        assert_eq!(decode(&encoded).unwrap(), long_string);

        // Test with special characters
        let special = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
        let encoded = encode(special);
        assert_eq!(decode(&encoded).unwrap(), special);
    }

    #[test]
    fn test_decode_url_edge_cases() {
        // Test with various URL-safe base64 strings
        let test_cases = [
            ("aGVsbG8gd29ybGQ.", "hello world"),
            ("L3Jvb3QvZGVmYXU.", "/root/defau"),
            ("dGVzdC1kYXRhLTEyMw..", "test-data-123"),
        ];

        for (encoded, expected) in test_cases {
            assert_eq!(decode_url(encoded).unwrap(), expected);
        }

        // Test with malformed URL-safe base64
        assert!(decode_url("invalid!@#").is_err());
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let test_strings = [
            "",
            "a",
            "ab",
            "abc",
            "abcd",
            "hello world",
            "Hello, World!",
            "1234567890",
            "!@#$%^&*()",
            "🚀🌟✨",
            &"a".repeat(100),
        ];

        for s in test_strings {
            let encoded = encode(s);
            let decoded = decode(&encoded).unwrap();
            assert_eq!(decoded, s, "Failed roundtrip for: {:?}", s);

            let url_encoded = encode_url(s);
            let url_decoded = decode_url(&url_encoded).unwrap();
            assert_eq!(url_decoded, s, "Failed URL roundtrip for: {:?}", s);
        }
    }

    #[test]
    fn test_decode_invalid_inputs() {
        let invalid_inputs = [
            "aGVsbG8gd29ybGQ!@#", // Invalid characters
            "aGVsbG8gd29ybGQ===", // Too many padding characters
            "aGVsbG8gd29ybGQ==!", // Invalid padding
            "aGVsbG8gd29ybGQ=!",  // Invalid character after padding
        ];

        for input in invalid_inputs {
            assert!(decode(input).is_err(), "Should fail for: {}", input);
            assert!(decode_raw(input).is_err(), "Should fail for: {}", input);
        }
    }

    #[test]
    fn test_decode_utf8_errors() {
        // Test with base64 that decodes to invalid UTF-8
        // This is tricky to create, but we can test the error path
        let invalid_utf8 = [0xFF, 0xFE, 0xFD];
        let encoded = base64::engine::general_purpose::STANDARD.encode(&invalid_utf8);

        // This should fail when trying to convert to String
        assert!(decode(&encoded).is_err());

        // But decode_raw should succeed
        assert!(decode_raw(&encoded).is_ok());
    }
}
