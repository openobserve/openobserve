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

use base64::{
    Engine,
    alphabet::Alphabet,
    engine::{
        GeneralPurpose,
        general_purpose::{NO_PAD, STANDARD, URL_SAFE_NO_PAD},
    },
};
use once_cell::sync::Lazy;

static CUSTOM: Lazy<GeneralPurpose> = Lazy::new(|| {
    let custom =
        Alphabet::new("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_.").unwrap();
    base64::engine::GeneralPurpose::new(&custom, NO_PAD)
});

pub fn encode(s: &str) -> String {
    encode_raw(s.as_bytes())
}

pub fn encode_raw(s: &[u8]) -> String {
    STANDARD.encode(s)
}

pub fn decode(s: &str) -> Result<String, Error> {
    match String::from_utf8(decode_raw(s)?) {
        Ok(v) => Ok(v),
        Err(e) => Err(Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode error: {e}"),
        )),
    }
}

pub fn decode_raw(s: &str) -> Result<Vec<u8>, Error> {
    STANDARD
        .decode(s.as_bytes())
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("base64 decode error: {e}")))
}

pub fn encode_url(s: &str) -> String {
    URL_SAFE_NO_PAD.encode(s.as_bytes())
}

pub fn decode_url(s: &str) -> Result<String, Error> {
    let v = URL_SAFE_NO_PAD.decode(s.as_bytes()).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode_url error: {e}"),
        )
    })?;
    String::from_utf8(v).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode_url error: {e}"),
        )
    })
}

/// Encode a string using a custom base64 alphabet
pub fn encode_custom(s: &str) -> String {
    CUSTOM.encode(s)
}

/// Decode a string using a custom base64 alphabet
pub fn decode_custom(s: &str) -> Result<String, Error> {
    let v = CUSTOM.decode(s).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode_custom error: {e}"),
        )
    })?;
    String::from_utf8(v).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("base64 decode_custom error: {e}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::io::ErrorKind;

    use super::*;

    #[test]
    fn test_base64_encode() {
        assert_eq!(encode("Hello"), "SGVsbG8=");
        assert_eq!(encode("World"), "V29ybGQ=");

        // Test empty string
        assert_eq!(encode(""), "");

        // Test special characters
        assert_eq!(encode("Hello, World"), "SGVsbG8sIFdvcmxk");

        // Test Unicode characters
        assert_eq!(encode("你好"), "5L2g5aW9");

        // Test long string
        let long_str = "This is a long string that needs to be encoded using base64. It contains multiple sentences and various characters!";
        let encoded = encode(long_str);
        assert!(!encoded.is_empty());
        assert_eq!(decode(&encoded).unwrap(), long_str);

        // Test user keys
        let s = "/root/defau/root@example.com";
        assert_eq!(encode(s), "L3Jvb3QvZGVmYXUvcm9vdEBleGFtcGxlLmNvbQ==");
    }

    #[test]
    fn test_base64_encode_url() {
        assert_eq!(encode_url("Hello"), "SGVsbG8");
        assert_eq!(encode_url("World"), "V29ybGQ");

        // Test empty string
        assert_eq!(encode_url(""), "");

        // Test special characters
        assert_eq!(encode_url("Hello, World"), "SGVsbG8sIFdvcmxk");

        // Test Unicode characters
        assert_eq!(encode_url("你好"), "5L2g5aW9");

        // Test long string
        let long_str = "This is a long string that needs to be encoded using base64. It contains multiple sentences and various characters!";
        let encoded = encode_url(long_str);
        assert!(!encoded.is_empty());
        assert_eq!(decode_url(&encoded).unwrap(), long_str);

        // Test user keys
        let s = "/root/defau/root@example.com";
        assert_eq!(encode_url(s), "L3Jvb3QvZGVmYXUvcm9vdEBleGFtcGxlLmNvbQ");
    }

    #[test]
    fn test_base64_encode_custom() {
        // Test basic encoding
        assert_eq!(encode_custom("Hello"), "i6lIr6Y");
        assert_eq!(encode_custom("World"), "lSZOr6g");

        // Test empty string
        assert_eq!(encode_custom(""), "");

        // Test special characters
        assert_eq!(encode_custom("Hello, World"), "i6lIr6YI85tLsCNA");

        // Test Unicode characters
        assert_eq!(encode_custom("你好"), "VbSwVqmZ");

        // Test long string
        let long_str = "This is a long string that needs to be encoded using base64. It contains multiple sentences and various characters!";
        let encoded = encode_custom(long_str);
        assert!(!encoded.is_empty());
        assert_eq!(decode_custom(&encoded).unwrap(), long_str);

        // Test user keys
        let s = "/root/defau/root@example.com";
        assert_eq!(encode_custom(s), "bT9LrTgLp6lConkLsCZLt41Bu65Js6NBbCdLrg");
    }

    #[test]
    fn test_base64_decode() {
        // Test basic decoding
        assert_eq!(decode("SGVsbG8=").unwrap(), "Hello");
        assert_eq!(decode("V29ybGQ=").unwrap(), "World");

        // Test empty string
        assert_eq!(decode("").unwrap(), "");

        // Test special characters
        assert_eq!(decode("SGVsbG8sIFdvcmxk").unwrap(), "Hello, World");

        // Test Unicode characters
        assert_eq!(decode("5L2g5aW9").unwrap(), "你好");

        // Test invalid base64
        let invalid_result = decode("SGVsbG8!");
        assert!(invalid_result.is_err());
        if let Err(e) = invalid_result {
            assert_eq!(e.kind(), ErrorKind::InvalidData);
            assert!(e.to_string().contains("base64 decode error"));
        }
    }

    #[test]
    fn test_base64_decode_url() {
        // Test basic decoding
        assert_eq!(decode_url("SGVsbG8").unwrap(), "Hello");
        assert_eq!(decode_url("V29ybGQ").unwrap(), "World");

        // Test empty string
        assert_eq!(decode_url("").unwrap(), "");

        // Test special characters
        assert_eq!(decode_url("SGVsbG8sIFdvcmxk").unwrap(), "Hello, World");

        // Test Unicode characters
        assert_eq!(decode_url("5L2g5aW9").unwrap(), "你好");

        // Test invalid base64
        let invalid_result = decode_url("SGVsbG8!");
        assert!(invalid_result.is_err());
        if let Err(e) = invalid_result {
            assert_eq!(e.kind(), ErrorKind::InvalidData);
            assert!(e.to_string().contains("base64 decode_url error"));
        }
    }

    #[test]
    fn test_base64_decode_custom() {
        // Test basic decoding
        assert_eq!(decode_custom("i6lIr6Y").unwrap(), "Hello");
        assert_eq!(decode_custom("lSZOr6g").unwrap(), "World");

        // Test empty string
        assert_eq!(decode_custom("").unwrap(), "");

        // Test special characters
        assert_eq!(decode_custom("i6lIr6YI85tLsCNA").unwrap(), "Hello, World");

        // Test Unicode characters
        assert_eq!(decode_custom("VbSwVqmZ").unwrap(), "你好");

        // Test invalid base64
        let invalid_result = decode_custom("SGVsbG8!");
        assert!(invalid_result.is_err());
        if let Err(e) = invalid_result {
            assert_eq!(e.kind(), ErrorKind::InvalidData);
            assert!(e.to_string().contains("base64 decode_custom error"));
        }
    }

    #[test]
    fn test_base64_encode_decode_roundtrip() {
        let test_cases = vec![
            "Hello, World!",
            "Special chars: !@#$%^&*()",
            "Numbers: 1234567890",
            "Unicode: 你好世界",
            "Mixed: Hello 你好 123 !@#",
            "",       // empty string
            " ",      // single space
            "   ",    // multiple spaces
            "\n\t\r", // control characters
        ];

        for input in test_cases {
            let encoded = encode_custom(input);
            let decoded = decode_custom(&encoded).unwrap();
            assert_eq!(decoded, input, "Roundtrip failed for input: {:?}", input);
        }
    }

    #[test]
    fn test_base64_decode_invalid_input() {
        let invalid_inputs = vec![
            "SGVsbG8!",         // invalid character
            "SGVsbG8",          // incomplete padding
            "SGVsbG8===",       // too much padding
            "SGVsbG8=!",        // invalid padding
            "SGVsbG8=SGVsbG8=", // invalid format
        ];

        for input in invalid_inputs {
            let result = decode_custom(input);
            assert!(result.is_err(), "Should fail for input: {}", input);
            if let Err(e) = result {
                assert_eq!(e.kind(), ErrorKind::InvalidData);
                assert!(e.to_string().contains("base64 decode_custom error"));
            }
        }
    }

    #[test]
    fn test_base64_encode_decode_large_input() {
        // Test with a large string
        let large_input = "x".repeat(10000);
        let encoded = encode_custom(&large_input);
        let decoded = decode_custom(&encoded).unwrap();
        assert_eq!(decoded, large_input);
    }

    #[test]
    fn test_base64_encode_decode_binary_data() {
        // Test with binary data
        let binary_data = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        let binary_str = String::from_utf8(binary_data).unwrap();
        let encoded = encode_custom(&binary_str);
        let decoded = decode_custom(&encoded).unwrap();
        assert_eq!(decoded, binary_str);
    }
}
