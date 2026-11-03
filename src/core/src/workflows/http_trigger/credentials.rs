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

//! Minting and verifying the bearer tokens and signing secrets of HTTP triggers.

use base64::{Engine, prelude::BASE64_STANDARD};
use config::utils::str::constant_time_eq;
use infra::{
    secrets::{self, PreparedSecret, SecretError, SecretMaterial, SecretOwnerKind, SecretPurpose},
    table::workflow_http_triggers::{CredentialKind, CredentialState, is_live},
};
use sha2::{Digest, Sha256};

pub const TOKEN_PREFIX: &str = "o2wh_";
pub const SECRET_PREFIX: &str = "whsec_";
const TOKEN_CHARS: usize = 43;
const TRIGGER_ID_CHARS: usize = 22;
const SECRET_BYTES: usize = 32;
const DISPLAY_CHARS: usize = 4;
const BASE62: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Compared against when the trigger is unknown, so a miss costs the same hash and compare.
const DUMMY_SHA256: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone)]
pub struct MintedSecret {
    pub plaintext: String,
    pub display_prefix: String,
    pub token_sha256: Option<String>,
}

impl std::fmt::Debug for MintedSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MintedSecret")
            .field("plaintext", &"[REDACTED]")
            .field("display_prefix", &self.display_prefix)
            .field(
                "token_sha256",
                &self.token_sha256.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Clone)]
pub struct LiveCredential {
    pub id: String,
    pub kind: CredentialKind,
    pub display_prefix: String,
    pub token_sha256: Option<String>,
    pub signing_key: Option<Vec<u8>>,
    pub state: CredentialState,
    pub expires_at: Option<i64>,
}

impl LiveCredential {
    pub fn is_live_at(&self, now_us: i64) -> bool {
        is_live(self.state, self.expires_at, now_us)
    }
}

impl std::fmt::Debug for LiveCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveCredential")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("display_prefix", &self.display_prefix)
            .field(
                "token_sha256",
                &self.token_sha256.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "signing_key",
                &self.signing_key.as_ref().map(|_| "[REDACTED]"),
            )
            .field("state", &self.state)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

pub fn new_trigger_id() -> String {
    base62_random(TRIGGER_ID_CHARS)
}

pub fn mint_token() -> MintedSecret {
    let plaintext = format!("{TOKEN_PREFIX}{}", base62_random(TOKEN_CHARS));
    MintedSecret {
        display_prefix: display_prefix(&plaintext),
        token_sha256: Some(sha256_hex(&plaintext)),
        plaintext,
    }
}

pub fn mint_signing_secret() -> MintedSecret {
    let key = config::utils::rand::random_bytes(SECRET_BYTES);
    let plaintext = format!("{SECRET_PREFIX}{}", BASE64_STANDARD.encode(key));
    MintedSecret {
        display_prefix: display_prefix(&plaintext),
        token_sha256: None,
        plaintext,
    }
}

pub fn secret_purpose(kind: CredentialKind) -> SecretPurpose {
    match kind {
        CredentialKind::Token => SecretPurpose::Auth,
        CredentialKind::SigningSecret => SecretPurpose::Signing,
    }
}

/// Encrypts a minted credential under the org DEK; call before `begin`, as `get_dek` may write.
pub async fn prepare_secret(
    org_id: &str,
    credential_id: &str,
    kind: CredentialKind,
    minted: &MintedSecret,
) -> Result<PreparedSecret, SecretError> {
    secrets::prepare_create(
        org_id,
        SecretOwnerKind::WorkflowTrigger,
        credential_id,
        secret_purpose(kind),
        None,
        secret_material(minted),
    )
    .await
}

pub fn display_prefix(plaintext: &str) -> String {
    let (prefix, random) = [TOKEN_PREFIX, SECRET_PREFIX]
        .into_iter()
        .find_map(|p| plaintext.strip_prefix(p).map(|rest| (p, rest)))
        .unwrap_or(("", plaintext));
    let chars: Vec<char> = random.chars().collect();
    let head: String = chars.iter().take(DISPLAY_CHARS).collect();
    let tail: String = chars[chars.len().saturating_sub(DISPLAY_CHARS)..]
        .iter()
        .collect();
    format!("{prefix}{head}…{tail}")
}

pub fn sha256_hex(value: &str) -> String {
    sha256_hex_bytes(value.as_bytes())
}

pub fn sha256_hex_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

pub fn verify_token<'a>(
    presented: &str,
    credentials: &'a [LiveCredential],
    now_us: i64,
) -> Option<&'a LiveCredential> {
    verify_token_with(presented, credentials, now_us, constant_time_eq)
}

pub fn dummy_token_check(presented: &str) {
    let hash = sha256_hex(presented);
    std::hint::black_box(constant_time_eq(hash.as_bytes(), DUMMY_SHA256.as_bytes()));
}

/// Compares against every live token without an early exit, so the match position does not leak.
fn verify_token_with<'a>(
    presented: &str,
    credentials: &'a [LiveCredential],
    now_us: i64,
    mut eq: impl FnMut(&[u8], &[u8]) -> bool,
) -> Option<&'a LiveCredential> {
    let hash = sha256_hex(presented);
    let mut found = None;
    for credential in credentials
        .iter()
        .filter(|c| c.kind == CredentialKind::Token && c.is_live_at(now_us))
    {
        let Some(stored) = credential.token_sha256.as_deref() else {
            continue;
        };
        if eq(hash.as_bytes(), stored.as_bytes()) && found.is_none() {
            found = Some(credential);
        }
    }
    found
}

fn secret_material(minted: &MintedSecret) -> SecretMaterial {
    SecretMaterial::Token {
        value: minted.plaintext.clone(),
    }
}

/// Rejection sampling keeps every character equally likely: 248 is the largest multiple of 62.
fn base62_random(len: usize) -> String {
    let mut out = String::with_capacity(len);
    while out.len() < len {
        for byte in config::utils::rand::random_bytes(len * 2) {
            if byte < 248 && out.len() < len {
                out.push(BASE62[usize::from(byte % 62)] as char);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_credential(id: &str, token: &str, state: CredentialState) -> LiveCredential {
        LiveCredential {
            id: id.to_string(),
            kind: CredentialKind::Token,
            display_prefix: display_prefix(token),
            token_sha256: Some(sha256_hex(token)),
            signing_key: None,
            state,
            expires_at: None,
        }
    }

    #[test]
    fn a_minted_token_has_the_prefix_and_256_bits() {
        let minted = mint_token();
        let random = minted.plaintext.strip_prefix(TOKEN_PREFIX).unwrap();
        assert_eq!(random.len(), TOKEN_CHARS);
        assert!(random.bytes().all(|b| BASE62.contains(&b)));
        assert!(
            TOKEN_CHARS as f64 * 62f64.log2() >= 256.0,
            "43 base62 characters carry at least 256 bits"
        );
        assert_ne!(mint_token().plaintext, minted.plaintext);
    }

    #[test]
    fn a_minted_token_carries_its_hash_and_its_plaintext_for_encryption() {
        let minted = mint_token();
        let hash = minted.token_sha256.clone().unwrap();
        assert_eq!(hash, sha256_hex(&minted.plaintext));
        assert_eq!(hash.len(), 64);
        assert!(!hash.contains(&minted.plaintext[TOKEN_PREFIX.len()..]));
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(matches!(
            secret_material(&minted),
            SecretMaterial::Token { value } if value == minted.plaintext
        ));
    }

    #[test]
    fn secret_purpose_is_auth_for_tokens_and_signing_for_secrets() {
        assert_eq!(secret_purpose(CredentialKind::Token), SecretPurpose::Auth);
        assert_eq!(
            secret_purpose(CredentialKind::SigningSecret),
            SecretPurpose::Signing
        );
    }

    #[test]
    fn the_display_prefix_shows_four_and_four() {
        assert_eq!(
            display_prefix("o2wh_ABCDefghijklmnopWXYZ"),
            "o2wh_ABCD…WXYZ"
        );
        assert_eq!(
            display_prefix("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"),
            "whsec_MfKQ…LaSw"
        );
        let minted = mint_token();
        assert_eq!(minted.display_prefix, display_prefix(&minted.plaintext));
    }

    #[test]
    fn a_signing_secret_is_standard_base64_of_32_bytes() {
        let minted = mint_signing_secret();
        let encoded = minted.plaintext.strip_prefix(SECRET_PREFIX).unwrap();
        assert_eq!(BASE64_STANDARD.decode(encoded).unwrap().len(), 32);
        assert!(minted.token_sha256.is_none());
        assert_eq!(minted.display_prefix, display_prefix(&minted.plaintext));
    }

    #[test]
    fn a_trigger_id_is_22_base62_characters() {
        let id = new_trigger_id();
        assert_eq!(id.len(), TRIGGER_ID_CHARS);
        assert!(id.bytes().all(|b| BASE62.contains(&b)));
    }

    #[test]
    fn verify_checks_every_live_credential() {
        let creds = vec![
            token_credential("a", "o2wh_first", CredentialState::Active),
            token_credential("b", "o2wh_second", CredentialState::Retiring),
            token_credential("c", "o2wh_third", CredentialState::Revoked),
        ];
        let mut compared = 0;
        let found = verify_token_with("o2wh_first", &creds, 10, |a, b| {
            compared += 1;
            constant_time_eq(a, b)
        });
        assert_eq!(found.map(|c| c.id.as_str()), Some("a"));
        assert_eq!(
            compared, 2,
            "every live credential is compared, the match too"
        );
        assert_eq!(
            verify_token("o2wh_second", &creds, 10).map(|c| c.id.as_str()),
            Some("b")
        );
        assert!(verify_token("o2wh_third", &creds, 10).is_none());
        assert!(verify_token("o2wh_other", &creds, 10).is_none());
    }

    #[test]
    fn an_expired_retiring_token_does_not_verify() {
        let mut retiring = token_credential("b", "o2wh_second", CredentialState::Retiring);
        retiring.expires_at = Some(5);
        let creds = [retiring];
        assert!(verify_token("o2wh_second", &creds, 4).is_some());
        assert!(verify_token("o2wh_second", &creds, 5).is_none());
    }

    #[test]
    fn a_missing_trigger_still_hashes_the_token() {
        dummy_token_check("o2wh_anything");
        dummy_token_check("");
    }

    #[test]
    fn minted_secret_debug_is_redacted() {
        let minted = mint_token();
        let printed = format!("{minted:?}");
        assert!(!printed.contains(&minted.plaintext));
        assert!(!printed.contains(minted.token_sha256.as_deref().unwrap()));
        assert!(printed.contains(&minted.display_prefix));
    }

    #[test]
    fn live_credential_debug_omits_key_material() {
        let mut cred = token_credential("a", "o2wh_first", CredentialState::Active);
        cred.signing_key = Some(b"super-secret-key".to_vec());
        let printed = format!("{cred:?}");
        assert!(!printed.contains(cred.token_sha256.as_deref().unwrap()));
        assert!(!printed.contains("115, 117, 112"));
        assert!(!printed.contains("super-secret-key"));
        assert!(printed.contains("\"a\""));
    }
}
