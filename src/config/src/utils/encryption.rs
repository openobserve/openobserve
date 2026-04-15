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

//! Shared encryption utilities used by both the `infra` and `o2-enterprise`
//! crates.

use base64::{Engine, prelude::BASE64_STANDARD};

/// AES-256-SIV requires two concatenated 256-bit keys — 64 bytes total.
const AES_256_SIV_KEY_LEN: usize = 64;

/// Decode and validate a base64-encoded AES-256-SIV master key.
///
/// Returns the raw key bytes on success, or a human-readable error string on
/// failure. The error string can be mapped to the caller's own error type.
///
/// # Errors
///
/// - Invalid base64 encoding.
/// - Wrong key length (must be exactly 64 bytes for AES-256-SIV).
pub fn decode_encryption_key(key_b64: &str) -> Result<Vec<u8>, String> {
    let key = BASE64_STANDARD
        .decode(key_b64)
        .map_err(|e| format!("master encryption key is not properly base64 encoded: {e}"))?;

    if key.len() != AES_256_SIV_KEY_LEN {
        return Err(format!(
            "invalid master encryption key: expected {AES_256_SIV_KEY_LEN} bytes, got {}",
            key.len()
        ));
    }

    Ok(key)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};

    use super::*;

    #[test]
    fn test_valid_key() {
        let key = BASE64_STANDARD.encode([0u8; 64]);
        assert!(decode_encryption_key(&key).is_ok());
    }

    #[test]
    fn test_invalid_base64() {
        assert!(decode_encryption_key("not-valid-base64!!!").is_err());
        let err = decode_encryption_key("!!!").unwrap_err();
        assert!(err.contains("base64"));
    }

    #[test]
    fn test_wrong_length() {
        let short = BASE64_STANDARD.encode([0u8; 32]);
        let err = decode_encryption_key(&short).unwrap_err();
        assert!(err.contains("64 bytes"));

        let long = BASE64_STANDARD.encode([0u8; 128]);
        assert!(decode_encryption_key(&long).is_err());
    }

    #[test]
    fn test_empty_string() {
        let err = decode_encryption_key("").unwrap_err();
        assert!(err.contains("64 bytes"));
    }
}
