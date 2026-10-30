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

use base64::{
    Engine,
    prelude::{BASE64_STANDARD, BASE64_URL_SAFE_NO_PAD},
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::utils::{encryption::decode_encryption_key, str::constant_time_eq};

pub const TOKEN_PREFIX: &str = "o2dt.";
pub const TOKEN_VERSION: u8 = 1;
pub const SCOPE_ASSISTANT: &str = "assistant";
/// Minted only by the Slack click handler, for the alert buttons' routes.
pub const SCOPE_SLACK_ACTION: &str = "slack_action";
pub const KEY_INFO: &[u8] = b"o2-slack-delegation-v1";
pub const MAC_DOMAIN: &[u8] = b"o2dt.v1\0";
/// `ZO_DELEGATION_SIGNING_KEY_PREVIOUS` value that keeps the master-key-derived key verifying.
pub const PREVIOUS_DERIVED: &str = "derived";
const MIN_OVERRIDE_KEY_LEN: usize = 32;
/// Clock skew allowed between the minting node and this one, in seconds.
const MAX_IAT_SKEW_SECS: i64 = 60;
/// An hour plus that skew; a longer-lived token was not minted by O2.
const MAX_LIFETIME_SECS: i64 = 3660;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claims {
    pub v: u8,
    pub sub: String,
    pub org: String,
    pub lid: String,
    pub scope: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
}

/// `previous` verifies only, never signs.
#[derive(Clone, PartialEq, Eq)]
pub struct Keys {
    pub current: Vec<u8>,
    pub previous: Option<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DelegationError {
    #[error("malformed delegated token: {0}")]
    Malformed(String),
    #[error("delegated token signature mismatch")]
    BadSignature,
    #[error("unsupported delegated token version {0}")]
    UnsupportedVersion(u8),
    #[error("delegated token expired")]
    Expired,
}

/// HKDF over the master key alone, so root password or `cipher_keys` changes never move it.
pub fn derive_key(master_key_b64: &str) -> anyhow::Result<[u8; 32]> {
    let master = decode_encryption_key(master_key_b64).map_err(|e| anyhow::anyhow!(e))?;
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(None, &master)
        .expand(KEY_INFO, &mut key)
        .map_err(|e| anyhow::anyhow!("delegation key derivation failed: {e}"))?;
    Ok(key)
}

pub fn effective_keys(
    master_b64: &str,
    override_b64: &str,
    previous: &str,
) -> anyhow::Result<Keys> {
    let current = if override_b64.is_empty() {
        derive_key(master_b64)?.to_vec()
    } else {
        decode_override(override_b64, "ZO_DELEGATION_SIGNING_KEY")?
    };
    let previous = match previous {
        "" => None,
        PREVIOUS_DERIVED => Some(derive_key(master_b64)?.to_vec()),
        key => Some(decode_override(key, "ZO_DELEGATION_SIGNING_KEY_PREVIOUS")?),
    };
    Ok(Keys { current, previous })
}

pub fn sign(keys: &Keys, claims: &Claims) -> String {
    let claims_json = serde_json::to_vec(claims).unwrap_or_default();
    let claims_b64 = BASE64_URL_SAFE_NO_PAD.encode(claims_json);
    let mac = BASE64_URL_SAFE_NO_PAD.encode(mac(&keys.current, &claims_b64));
    format!("{TOKEN_PREFIX}{claims_b64}.{mac}")
}

/// `now`, `iat` and `exp` are Unix seconds.
pub fn verify(keys: &Keys, token: &str, now: i64) -> Result<Claims, DelegationError> {
    let (claims_b64, mac_b64) = token
        .strip_prefix(TOKEN_PREFIX)
        .and_then(|rest| rest.split_once('.'))
        .ok_or_else(|| DelegationError::Malformed("expected o2dt.<claims>.<mac>".to_string()))?;
    let given = BASE64_URL_SAFE_NO_PAD
        .decode(mac_b64)
        .map_err(|e| DelegationError::Malformed(format!("mac: {e}")))?;
    let matches = |key: &Vec<u8>| constant_time_eq(&mac(key, claims_b64), &given);
    if !(matches(&keys.current) || keys.previous.as_ref().is_some_and(matches)) {
        return Err(DelegationError::BadSignature);
    }
    let claims_json = BASE64_URL_SAFE_NO_PAD
        .decode(claims_b64)
        .map_err(|e| DelegationError::Malformed(format!("claims: {e}")))?;
    let claims: Claims = serde_json::from_slice(&claims_json)
        .map_err(|e| DelegationError::Malformed(format!("claims: {e}")))?;
    if claims.v != TOKEN_VERSION {
        return Err(DelegationError::UnsupportedVersion(claims.v));
    }
    if claims.exp <= now {
        return Err(DelegationError::Expired);
    }
    if claims.iat > now + MAX_IAT_SKEW_SECS {
        return Err(DelegationError::Malformed(
            "issued in the future".to_string(),
        ));
    }
    if claims.exp - claims.iat > MAX_LIFETIME_SECS {
        return Err(DelegationError::Malformed(
            "lifetime over an hour".to_string(),
        ));
    }
    Ok(claims)
}

fn decode_override(key_b64: &str, name: &str) -> anyhow::Result<Vec<u8>> {
    let key = BASE64_STANDARD
        .decode(key_b64.trim())
        .map_err(|e| anyhow::anyhow!("{name} is not valid base64: {e}"))?;
    if key.len() < MIN_OVERRIDE_KEY_LEN {
        anyhow::bail!(
            "{name} must decode to at least {MIN_OVERRIDE_KEY_LEN} bytes, got {}",
            key.len()
        );
    }
    Ok(key)
}

fn mac(key: &[u8], claims_b64: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes any key length");
    mac.update(MAC_DOMAIN);
    mac.update(claims_b64.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_937_000;
    const A1_FIXTURE_CLAIMS: &str = "eyJ2IjoxLCJzdWIiOiJhbGljZUBhY21lLmlvIiwib3JnIjoiZGVmYXVsdCIsImxpZCI6Imxua18wMSIsInNjb3BlIjoiYXNzaXN0YW50IiwiaWF0IjoxNzkxOTM2MDAwLCJleHAiOjE3OTE5Mzk2MDAsImp0aSI6Imp0aS0wMDAxIn0";

    fn master() -> String {
        BASE64_STANDARD.encode([7u8; 64])
    }

    fn other_master() -> String {
        BASE64_STANDARD.encode([8u8; 64])
    }

    fn override_key() -> String {
        BASE64_STANDARD.encode([5u8; 32])
    }

    fn claims() -> Claims {
        Claims {
            v: TOKEN_VERSION,
            sub: "alice@acme.io".to_string(),
            org: "default".to_string(),
            lid: "lnk_01".to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
            iat: 1_791_936_000,
            exp: 1_791_939_600,
            jti: "jti-0001".to_string(),
        }
    }

    fn derived_keys() -> Keys {
        effective_keys(&master(), "", "").unwrap()
    }

    fn segments(token: &str) -> (&str, &str) {
        token
            .strip_prefix(TOKEN_PREFIX)
            .and_then(|rest| rest.split_once('.'))
            .expect("o2dt.<claims>.<mac>")
    }

    fn mac_over(key: &[u8], claims_b64: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
        mac.update(MAC_DOMAIN);
        mac.update(claims_b64.as_bytes());
        BASE64_URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    #[test]
    fn claims_segment_is_json_with_sub() {
        let token = sign(&derived_keys(), &claims());
        let (claims_b64, _) = segments(&token);
        assert_eq!(claims_b64, A1_FIXTURE_CLAIMS, "o2-ai's A1 fixture format");
        let json: serde_json::Value =
            serde_json::from_slice(&BASE64_URL_SAFE_NO_PAD.decode(claims_b64).unwrap()).unwrap();
        assert_eq!(json["sub"], "alice@acme.io");
        assert_eq!(json["v"], 1);
        assert_eq!(json["scope"], "assistant");
        assert_eq!(
            token.split('.').nth(1),
            Some(claims_b64),
            "o2-ai reads parts[1]"
        );
    }

    #[test]
    fn mac_covers_the_domain_label_and_claims_segment() {
        let keys = derived_keys();
        let token = sign(&keys, &claims());
        let (claims_b64, mac_b64) = segments(&token);
        assert_eq!(mac_b64, mac_over(&keys.current, claims_b64));
    }

    #[test]
    fn sign_verify_round_trip() {
        let keys = derived_keys();
        let token = sign(&keys, &claims());
        assert_eq!(verify(&keys, &token, NOW), Ok(claims()));
    }

    #[test]
    fn altered_claims_are_a_bad_signature() {
        let keys = derived_keys();
        let token = sign(&keys, &claims());
        let (_, mac_b64) = segments(&token);
        let forged = Claims {
            org: "other".to_string(),
            ..claims()
        };
        let forged_b64 = BASE64_URL_SAFE_NO_PAD.encode(serde_json::to_vec(&forged).unwrap());
        let altered = format!("{TOKEN_PREFIX}{forged_b64}.{mac_b64}");
        assert_eq!(
            verify(&keys, &altered, NOW),
            Err(DelegationError::BadSignature)
        );
        let mut flipped = token.clone().into_bytes();
        let last = flipped.len() - 1;
        flipped[last] = if flipped[last] == b'A' { b'B' } else { b'A' };
        let flipped = String::from_utf8(flipped).unwrap();
        assert!(verify(&keys, &flipped, NOW).is_err());
    }

    #[test]
    fn a_token_signed_with_another_key_is_refused() {
        let token = sign(&effective_keys(&other_master(), "", "").unwrap(), &claims());
        assert_eq!(
            verify(&derived_keys(), &token, NOW),
            Err(DelegationError::BadSignature)
        );
    }

    #[test]
    fn expired_is_refused() {
        let keys = derived_keys();
        let token = sign(&keys, &claims());
        assert_eq!(
            verify(&keys, &token, claims().exp),
            Err(DelegationError::Expired)
        );
        assert_eq!(
            verify(&keys, &token, claims().exp + 1),
            Err(DelegationError::Expired)
        );
        assert!(verify(&keys, &token, claims().exp - 1).is_ok());
    }

    #[test]
    fn issued_in_the_future_or_living_too_long_is_malformed() {
        let keys = derived_keys();
        let at = |iat: i64, exp: i64| {
            verify(
                &keys,
                &sign(
                    &keys,
                    &Claims {
                        iat,
                        exp,
                        ..claims()
                    },
                ),
                NOW,
            )
        };
        assert!(
            at(NOW + 60, NOW + 3600).is_ok(),
            "60 s of clock skew is allowed"
        );
        assert!(matches!(
            at(NOW + 61, NOW + 3600),
            Err(DelegationError::Malformed(_))
        ));
        assert!(
            at(NOW - 60, NOW - 60 + 3660).is_ok(),
            "an hour plus a minute is allowed"
        );
        assert!(matches!(
            at(NOW - 60, NOW - 60 + 3661),
            Err(DelegationError::Malformed(_))
        ));
        assert!(matches!(
            at(NOW - 60, NOW + 86_400 * 365),
            Err(DelegationError::Malformed(_))
        ));
    }

    #[test]
    fn wrong_prefix_and_malformed_are_refused() {
        let keys = derived_keys();
        let token = sign(&keys, &claims());
        let (claims_b64, mac_b64) = segments(&token);
        for bad in [
            format!("o2dx.{claims_b64}.{mac_b64}"),
            format!("{claims_b64}.{mac_b64}"),
            format!("{TOKEN_PREFIX}{claims_b64}"),
            format!("{TOKEN_PREFIX}{claims_b64}.{mac_b64}.extra"),
            format!("{TOKEN_PREFIX}{claims_b64}.!!notbase64"),
            String::new(),
        ] {
            assert!(
                matches!(verify(&keys, &bad, NOW), Err(DelegationError::Malformed(_))),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_signed_non_json_claims_segment_is_malformed() {
        let keys = derived_keys();
        let claims_b64 = BASE64_URL_SAFE_NO_PAD.encode(b"not json");
        let token = format!(
            "{TOKEN_PREFIX}{claims_b64}.{}",
            mac_over(&keys.current, &claims_b64)
        );
        assert!(matches!(
            verify(&keys, &token, NOW),
            Err(DelegationError::Malformed(_))
        ));
    }

    #[test]
    fn unsupported_version_is_refused() {
        let keys = derived_keys();
        let token = sign(&keys, &Claims { v: 2, ..claims() });
        assert_eq!(
            verify(&keys, &token, NOW),
            Err(DelegationError::UnsupportedVersion(2))
        );
    }

    #[test]
    fn derive_key_is_hkdf_sha256_with_the_info_label() {
        let master_bytes = [7u8; 64];
        let mut expected = [0u8; 32];
        hkdf::Hkdf::<Sha256>::new(None, &master_bytes)
            .expand(b"o2-slack-delegation-v1", &mut expected)
            .unwrap();
        let derived = derive_key(&master()).unwrap();
        assert_eq!(derived, expected);
        let mut other_label = [0u8; 32];
        hkdf::Hkdf::<Sha256>::new(None, &master_bytes)
            .expand(b"o2-something-else", &mut other_label)
            .unwrap();
        assert_ne!(derived, other_label, "the info label separates uses");
        assert_ne!(&derived[..], &master_bytes[..32]);
        assert_ne!(derived, derive_key(&other_master()).unwrap());
        assert_eq!(
            derived,
            derive_key(&master()).unwrap(),
            "a pure function of the master key: root password and cipher_keys rows never enter it"
        );
    }

    #[test]
    fn derive_key_refuses_a_bad_master_key() {
        assert!(derive_key("").is_err());
        assert!(derive_key("not base64!").is_err());
        assert!(derive_key(&BASE64_STANDARD.encode([1u8; 32])).is_err());
    }

    #[test]
    fn override_wins_over_the_derived_key() {
        let keys = effective_keys(&master(), &override_key(), "").unwrap();
        assert_eq!(keys.current, vec![5u8; 32]);
        assert_eq!(keys.previous, None);
        let token = sign(&keys, &claims());
        assert!(verify(&keys, &token, NOW).is_ok());
        assert_eq!(
            verify(&derived_keys(), &token, NOW),
            Err(DelegationError::BadSignature)
        );
    }

    #[test]
    fn previous_derived_keeps_derived_tokens_valid_until_removed() {
        let derived_token = sign(&derived_keys(), &claims());
        let rotating = effective_keys(&master(), &override_key(), PREVIOUS_DERIVED).unwrap();
        assert_eq!(rotating.current, vec![5u8; 32], "previous never signs");
        assert!(verify(&rotating, &derived_token, NOW).is_ok());
        let rotated = effective_keys(&master(), &override_key(), "").unwrap();
        assert_eq!(
            verify(&rotated, &derived_token, NOW),
            Err(DelegationError::BadSignature)
        );
    }

    #[test]
    fn previous_override_key_verifies_only() {
        let old = BASE64_STANDARD.encode([3u8; 40]);
        let old_token = sign(&effective_keys(&master(), &old, "").unwrap(), &claims());
        let keys = effective_keys(&master(), &override_key(), &old).unwrap();
        assert!(verify(&keys, &old_token, NOW).is_ok());
        assert_eq!(keys.current, vec![5u8; 32]);
    }

    #[test]
    fn a_bad_override_names_the_variable() {
        for bad in ["not base64!", &BASE64_STANDARD.encode([1u8; 31])] {
            let err = effective_keys(&master(), bad, "")
                .err()
                .unwrap()
                .to_string();
            assert!(err.contains("ZO_DELEGATION_SIGNING_KEY"), "{err}");
        }
        let err = effective_keys(&master(), &override_key(), "short")
            .err()
            .unwrap()
            .to_string();
        assert!(err.contains("ZO_DELEGATION_SIGNING_KEY_PREVIOUS"), "{err}");
    }

    #[test]
    fn no_master_key_and_no_override_has_no_key() {
        assert!(effective_keys("", "", "").is_err());
        let keys = effective_keys("", &override_key(), "").unwrap();
        assert_eq!(keys.current, vec![5u8; 32]);
    }
}
