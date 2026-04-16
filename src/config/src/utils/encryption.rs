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

// https://developers.google.com/tink/wire-format#tink_output_prefix
const TINK_PREFIX_LENGTH: usize = 5;
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
    /// Tink uses its own way to encode the encrypted value
    /// so it has a dedicated algorithm type
    TInkDaead256Siv {
        key_id: u32,
    },
    /// General AES 256-bit SIV algorithm
    Aes256Siv,
    None,
}

impl std::fmt::Display for Algorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Aes256Siv => write!(f, "aes-256-siv"),
            Self::TInkDaead256Siv { .. } => write!(f, "tink-daead-256-siv"),
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
        let bytes = plaintext.as_bytes();

        // SIV mode: nonce need to be empty for the SIV itself to serve as the IV
        let nonce = [] as [&[u8]; 0];

        match self {
            Self::Aes256Siv => {
                let mut cipher = Aes256Siv::new_from_slice(key).map_err(|e| {
                    EncryptError::AlgorithmError(format!("AES256 creation failed : {e}"))
                })?;
                let t = cipher.encrypt(nonce, bytes).map_err(|e| {
                    EncryptError::EncryptionError(format!("Encryption failed : {e}"))
                })?;
                let output = BASE64_STANDARD.encode(&t);
                Ok(output)
            }
            Self::TInkDaead256Siv { key_id } => {
                let mut cipher = Aes256Siv::new_from_slice(key).map_err(|e| {
                    EncryptError::AlgorithmError(format!("AES256 creation failed : {e}"))
                })?;
                let t = cipher.encrypt(nonce, bytes).map_err(|e| {
                    EncryptError::EncryptionError(format!("Encryption failed : {e}"))
                })?;
                // When encoding, tink prepends a special prefix to the encrypted value,
                // used when decrypting. Hence we also need to do that
                // prefix starts with 1 byte version = 1 (fixed)
                let mut temp = vec![0x01];
                // then 4 bytes key id used for encryption, as big-endian byte order
                temp.extend_from_slice(&key_id.to_be_bytes());
                // and finally the encrypted value
                temp.extend(t);
                // all encoded as base64 string
                let output = BASE64_STANDARD.encode(&temp);
                Ok(output)
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

        // we do not support any having associated data in aes
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
            Self::TInkDaead256Siv { key_id } => {
                let mut cipher = Aes256Siv::new_from_slice(key).map_err(|e| {
                    EncryptError::AlgorithmError(format!("AES256 creation failed {e}"))
                })?;

                if decoded.len() < TINK_PREFIX_LENGTH {
                    return Err(EncryptError::DecryptionError(
                        "Invalid encrypted string format, missing tink prefix".into(),
                    ));
                }
                // we need to do a reverse checking of the Tink prefix and validate
                // check that version = 1 (fixed)
                if decoded[0] != 1 {
                    return Err(EncryptError::DecryptionError(
                        "Invalid encrypted string format, invalid version in prefix".into(),
                    ));
                }
                // check that key id used for encryption matches the one used for decryption
                if u32::from_be_bytes(decoded[1..=4].try_into().unwrap()) != *key_id {
                    return Err(EncryptError::DecryptionError(
                        "Invalid encrypted string format, key id mismatch in prefix".into(),
                    ));
                }
                // decrypt  the actual value that is after the prefix
                let t = cipher
                    .decrypt(nonce, &decoded[TINK_PREFIX_LENGTH..])
                    .map_err(|e| {
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

    // -----------------------------------------------------------------------
    // decode_encryption_key
    // -----------------------------------------------------------------------

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
    fn test_display_tink() {
        assert_eq!(
            Algorithm::TInkDaead256Siv { key_id: 1 }.to_string(),
            "tink-daead-256-siv"
        );
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
    fn test_tink_encrypt_decrypt() {
        let algo = Algorithm::TInkDaead256Siv { key_id: 99 };
        let enc = algo.encrypt(&key(), "data").unwrap();
        assert_eq!(algo.decrypt(&key(), &enc).unwrap(), "data");
    }

    #[test]
    fn test_tink_prefix() {
        let algo = Algorithm::TInkDaead256Siv { key_id: 123 };
        let enc = algo.encrypt(&key(), "x").unwrap();
        let dec = BASE64_STANDARD.decode(&enc).unwrap();
        assert_eq!(dec[0], 1);
        assert_eq!(u32::from_be_bytes([dec[1], dec[2], dec[3], dec[4]]), 123);
    }

    #[test]
    fn test_tink_short() {
        let algo = Algorithm::TInkDaead256Siv { key_id: 1 };
        let short = BASE64_STANDARD.encode([1, 2]);
        assert!(algo.decrypt(&key(), &short).is_err());
    }

    #[test]
    fn test_tink_bad_version() {
        let algo = Algorithm::TInkDaead256Siv { key_id: 1 };
        let mut bad = vec![99, 0, 0, 0, 1];
        bad.extend(vec![0; 20]);
        assert!(algo.decrypt(&key(), &BASE64_STANDARD.encode(&bad)).is_err());
    }

    #[test]
    fn test_tink_key_mismatch() {
        let a1 = Algorithm::TInkDaead256Siv { key_id: 1 };
        let a2 = Algorithm::TInkDaead256Siv { key_id: 2 };
        let enc = a1.encrypt(&key(), "x").unwrap();
        assert!(a2.decrypt(&key(), &enc).is_err());
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
