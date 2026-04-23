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

use aes_siv::{KeyInit, siv::Aes256Siv};
use base64::{Engine, prelude::BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use thiserror::Error as ThisError;

/// AES-256-SIV requires two concatenated 256-bit keys — 64 bytes total.
const AES_256_SIV_KEY_LEN: usize = 64;

/// Decode and validate a base64-encoded AES-256-SIV key.
///
/// Returns the raw key bytes on success, or a human-readable error string on
/// failure.
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

#[derive(ThisError, Debug)]
pub enum EncryptError {
    #[error("Algorithm Error: {0}")]
    AlgorithmError(String),
    #[error("Encryption Error: {0}")]
    EncryptionError(String),
    #[error("Decryption Error: {0}")]
    DecryptionError(String),
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Algorithm {
    /// General AES 256-bit SIV algorithm
    Aes256Siv,
    None,
}

impl std::fmt::Display for Algorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Aes256Siv => write!(f, "aes-256-siv"),
            Self::None => write!(f, "none"),
        }
    }
}

impl TryFrom<String> for Algorithm {
    type Error = EncryptError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "aes-256-siv" => Ok(Self::Aes256Siv),
            "none" => Ok(Self::None),
            _ => Err(EncryptError::AlgorithmError(
                "Invalid algorithm, only following are supported : [aes-256-siv]".into(),
            )),
        }
    }
}

impl Algorithm {
    pub fn encrypt(&self, key: &[u8], plaintext: &str) -> Result<String, EncryptError> {
        // SIV mode: nonce need to be empty for the SIV itself to serve as the IV
        let nonce = [] as [&[u8]; 0];

        match self {
            Self::Aes256Siv => {
                let mut cipher = Aes256Siv::new_from_slice(key).map_err(|e| {
                    EncryptError::AlgorithmError(format!("AES256 creation failed : {e}"))
                })?;
                let t = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|e| {
                    EncryptError::EncryptionError(format!("Encryption failed : {e}"))
                })?;
                Ok(BASE64_STANDARD.encode(&t))
            }
            Self::None => Ok(BASE64_STANDARD.encode(plaintext.as_bytes())),
        }
    }

    pub fn decrypt(&self, key: &[u8], encrypted: &str) -> Result<String, EncryptError> {
        let decoded = BASE64_STANDARD.decode(encrypted).map_err(|_| {
            EncryptError::DecryptionError("Failed to decode encrypted string from base64".into())
        })?;

        // SIV mode: nonce need to be empty for the SIV itself to serve as the IV
        let nonce = [] as [&[u8]; 0];

        match self {
            Self::Aes256Siv => {
                let mut cipher = Aes256Siv::new_from_slice(key).map_err(|e| {
                    EncryptError::AlgorithmError(format!("AES256 creation failed : {e}"))
                })?;
                let t = cipher.decrypt(nonce, &decoded).map_err(|e| {
                    EncryptError::DecryptionError(format!("Decryption failed : {e}"))
                })?;
                Ok(String::from_utf8_lossy(&t).to_string())
            }
            Self::None => Ok(String::from_utf8_lossy(&decoded).to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> Vec<u8> {
        vec![0u8; 64]
    }

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

    #[test]
    fn test_display_aes() {
        assert_eq!(Algorithm::Aes256Siv.to_string(), "aes-256-siv");
    }

    #[test]
    fn test_try_from_valid() {
        assert!(Algorithm::try_from("aes-256-siv".to_string()).is_ok());
    }

    #[test]
    fn test_try_from_invalid() {
        assert!(Algorithm::try_from("bad".to_string()).is_err());
    }

    #[test]
    fn test_aes_encrypt_decrypt() {
        let algo = Algorithm::Aes256Siv;
        let enc = algo.encrypt(&key(), "test").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "test");
    }

    #[test]
    fn test_aes_empty() {
        let algo = Algorithm::Aes256Siv;
        let enc = algo.encrypt(&key(), "").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "");
    }

    #[test]
    fn test_aes_unicode() {
        let algo = Algorithm::Aes256Siv;
        let enc = algo.encrypt(&key(), "世界").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "世界");
    }

    #[test]
    fn test_aes_bad_key() {
        assert!(Algorithm::Aes256Siv.encrypt(&[0u8; 10], "x").is_err());
    }

    #[test]
    fn test_aes_bad_base64() {
        assert!(Algorithm::Aes256Siv.decrypt(&key(), "!!!").is_err());
    }

    #[test]
    fn test_none_encrypt_decrypt() {
        let algo = Algorithm::None;
        let enc = algo.encrypt(&key(), "test").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "test");
    }

    #[test]
    fn test_none_empty() {
        let algo = Algorithm::None;
        let enc = algo.encrypt(&key(), "").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "");
    }

    #[test]
    fn test_none_unicode() {
        let algo = Algorithm::None;
        let enc = algo.encrypt(&key(), "世界").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "世界");
    }

    #[test]
    fn test_none_bad_key() {
        assert!(Algorithm::None.encrypt(&[0u8; 10], "x").is_ok());
    }

    #[test]
    fn test_none_bad_base64() {
        assert!(Algorithm::None.decrypt(&key(), "!!!").is_err());
    }
}
