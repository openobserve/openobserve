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

//! An assistant call (o2-ai's session header) changes something only with o2-ai's signed approval.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, OnceLock},
};

use futures_util::future::BoxFuture;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::ledger::Origin;

/// Header o2-ai sends on an approved call: `<approval_id>.<expiry>.<hmac>`.
pub const APPROVAL_HEADER: &str = "x-o2-approval";
/// `data.code` of the JSON-RPC error refusing an unapproved call; o2-ai turns it into a card.
pub const APPROVAL_REQUIRED: &str = "approval_required";
/// JSON-RPC error code of that refusal (implementation-defined server error range).
pub const APPROVAL_REQUIRED_RPC_CODE: i32 = -32003;
/// The tool o2-ai signs its approved REST deletes (`o2_delete` batches) for.
pub const REST_DELETE_TOOL: &str = "o2_delete";
// o2-ai mints an assertion for one call, so a far-future expiry is a forgery or a bug.
const MAX_LIFETIME_SECS: i64 = 600;
const MESSAGE_VERSION: &str = "o2-approval-v2";
const KEY_LABEL: &[u8] = b"o2-approval-key-v1";
const GRANT_PREFIX: &str = "grant_";
// Spent signatures are swept once the cache holds this many.
const SPENT_SWEEP_AT: usize = 10_000;

static KEY: OnceLock<[u8; 32]> = OnceLock::new();
static GRANT_CHECK: OnceLock<GrantCheck> = OnceLock::new();
static SPENT: LazyLock<Mutex<HashMap<String, i64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Whether a standing grant still allows `query`; registered by the enterprise build.
pub type GrantCheck = fn(GrantQuery) -> BoxFuture<'static, bool>;

/// Why an assistant call that changes something was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Missing,
    Malformed,
    Expired,
    BadSignature,
    Replayed,
    /// o2-ai signed the call but this server has no secret to check it with.
    NotConfigured,
    /// The grant the approval names was revoked, or never belonged to this caller.
    GrantNotLive,
}

impl Refusal {
    pub fn reason(self) -> &'static str {
        match self {
            Refusal::Missing => "missing",
            Refusal::Malformed => "malformed",
            Refusal::Expired => "expired",
            Refusal::BadSignature => "bad_signature",
            Refusal::Replayed => "replayed",
            Refusal::NotConfigured => "not_configured",
            Refusal::GrantNotLive => "grant_not_live",
        }
    }
}

/// The refusal as an error `route_request` answers with a typed JSON-RPC error.
#[derive(Debug)]
pub struct ApprovalRequired {
    pub tool: String,
    pub refusal: Refusal,
}

impl std::fmt::Display for ApprovalRequired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Tool '{}' changes data and needs the user's approval ({})",
            self.tool,
            self.refusal.reason()
        )
    }
}

impl std::error::Error for ApprovalRequired {}

/// What one approval is bound to; a signature for any other value does not verify.
pub struct Claim<'a> {
    pub org_id: &'a str,
    pub user: &'a str,
    pub session_id: &'a str,
    pub tool: &'a str,
    pub arguments_sha256: &'a str,
}

/// A grant an approval names, for the registered [`GrantCheck`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantQuery {
    pub org_id: String,
    pub user_email: String,
    pub session_id: String,
    pub grant_id: String,
    pub tool: String,
}

/// A signature that verified, still to be spent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub approval_id: String,
    pub signature: String,
    pub expiry: i64,
}

/// Installs the key derived from the secret shared with o2-ai; `false` when there is none.
pub fn set_secret(secret: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    if KEY.set(derive_key(secret)).is_err() {
        log::warn!("[MCP] approval secret already set; keeping the first one");
    }
    true
}

pub fn enforced() -> bool {
    KEY.get().is_some()
}

/// Installs the lookup that decides whether a `grant_<id>` approval is still live.
pub fn set_grant_check(check: GrantCheck) {
    if GRANT_CHECK.set(check).is_err() {
        log::warn!("[MCP] approval grant check already set; keeping the first one");
    }
}

/// Hex SHA-256 of `arguments` serialized with sorted keys and no spaces, as o2-ai hashes them.
pub fn arguments_sha256(arguments: &Value) -> String {
    let mut text = String::new();
    canonical_json(arguments, &mut text);
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// Refuses an assistant call to `tool` with `arguments` unless o2-ai approved exactly that call.
pub async fn check(
    org_id: &str,
    tool: &str,
    requires_confirmation: bool,
    origin: Option<&Origin>,
    arguments: &Value,
) -> Result<(), ApprovalRequired> {
    let refuse = |refusal: Refusal| ApprovalRequired {
        tool: tool.to_string(),
        refusal,
    };
    let Some(origin) = origin else {
        return Ok(());
    };
    let digest = arguments_sha256(arguments);
    let claim = Claim {
        org_id,
        user: &origin.user_email,
        session_id: &origin.session_id,
        tool,
        arguments_sha256: &digest,
    };
    let verified = check_with(
        KEY.get(),
        &claim,
        origin.approval.as_deref(),
        requires_confirmation,
        now_secs(),
    )
    .map_err(|refusal| {
        if refusal == Refusal::NotConfigured {
            log::error!(
                "[MCP] o2-ai signed {tool} but O2_AI_INTERNAL_SECRET is unset here; refusing it"
            );
        }
        refuse(refusal)
    })?;
    let Some(verified) = verified else {
        return Ok(());
    };
    if let Some(grant_id) = grant_of(&verified.approval_id) {
        let query = GrantQuery {
            org_id: org_id.to_string(),
            user_email: origin.user_email.clone(),
            session_id: origin.session_id.clone(),
            grant_id: grant_id.to_string(),
            tool: tool.to_string(),
        };
        let live = match GRANT_CHECK.get() {
            Some(is_live) => is_live(query).await,
            None => false,
        };
        if !live {
            return Err(refuse(Refusal::GrantNotLive));
        }
    }
    if !spend(&verified, now_secs()) {
        return Err(refuse(Refusal::Replayed));
    }
    Ok(())
}

/// [`check`] for one of the assistant's REST calls, bound to its method and `/api/...` target.
pub async fn check_rest(
    org_id: &str,
    method: &str,
    target: &str,
    origin: Option<&Origin>,
) -> Result<(), ApprovalRequired> {
    let method = method.to_ascii_uppercase();
    let changes = matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
    let arguments = serde_json::json!({"method": method, "target": target});
    check(org_id, REST_DELETE_TOOL, changes, origin, &arguments).await
}

/// The signature check alone, with an explicit key and clock; `None` when nothing is to verify.
pub fn check_with(
    key: Option<&[u8; 32]>,
    claim: &Claim<'_>,
    assertion: Option<&str>,
    requires_confirmation: bool,
    now: i64,
) -> Result<Option<Verified>, Refusal> {
    if !requires_confirmation {
        return Ok(None);
    }
    let Some(key) = key else {
        // No trust anchor: an unsigned write passes, but a signed one means the secrets differ.
        return match assertion.filter(|a| !a.is_empty()) {
            Some(_) => Err(Refusal::NotConfigured),
            None => Ok(None),
        };
    };
    verify(key, assertion, claim, now).map(Some)
}

/// Verifies `assertion` against `claim` at unix time `now`.
pub fn verify(
    key: &[u8; 32],
    assertion: Option<&str>,
    claim: &Claim<'_>,
    now: i64,
) -> Result<Verified, Refusal> {
    let assertion = assertion
        .filter(|a| !a.is_empty())
        .ok_or(Refusal::Missing)?;
    let mut parts = assertion.splitn(3, '.');
    let (Some(approval_id), Some(expiry), Some(signature)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return Err(Refusal::Malformed);
    };
    let expiry: i64 = expiry.parse().map_err(|_| Refusal::Malformed)?;
    let raw_signature = hex::decode(signature).map_err(|_| Refusal::Malformed)?;
    if approval_id.is_empty() {
        return Err(Refusal::Malformed);
    }
    if expiry <= now || expiry > now + MAX_LIFETIME_SECS {
        return Err(Refusal::Expired);
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| Refusal::BadSignature)?;
    mac.update(message(claim, approval_id, expiry).as_bytes());
    mac.verify_slice(&raw_signature)
        .map_err(|_| Refusal::BadSignature)?;
    Ok(Verified {
        approval_id: approval_id.to_string(),
        signature: signature.to_ascii_lowercase(),
        expiry,
    })
}

/// HKDF-SHA256 (empty salt, one block) of `secret` with the approval label.
pub fn derive_key(secret: &str) -> [u8; 32] {
    let mut extract =
        Hmac::<Sha256>::new_from_slice(&[0u8; 32]).expect("HMAC accepts any key length");
    extract.update(secret.as_bytes());
    let prk = extract.finalize().into_bytes();
    let mut expand = Hmac::<Sha256>::new_from_slice(&prk).expect("HMAC accepts any key length");
    expand.update(KEY_LABEL);
    expand.update(&[1u8]);
    expand.finalize().into_bytes().into()
}

/// The grant a `grant_<id>~<nonce>` approval names; o2-ai adds the nonce so each call is unique.
fn grant_of(approval_id: &str) -> Option<&str> {
    let rest = approval_id.strip_prefix(GRANT_PREFIX)?;
    Some(rest.split_once('~').map_or(rest, |(grant, _)| grant))
}

/// Marks a verified signature used; `false` when it already was (a replay).
fn spend(verified: &Verified, now: i64) -> bool {
    let mut spent = SPENT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if spent.len() >= SPENT_SWEEP_AT {
        spent.retain(|_, expiry| *expiry > now);
    }
    spent
        .insert(verified.signature.clone(), verified.expiry)
        .is_none()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The signed text; o2-ai's `approval_policy.assertion_message` builds the same one.
fn message(claim: &Claim<'_>, approval_id: &str, expiry: i64) -> String {
    [
        MESSAGE_VERSION,
        claim.org_id,
        &claim.user.to_lowercase(),
        &claim.session_id.to_lowercase(),
        approval_id,
        claim.tool,
        claim.arguments_sha256,
        &expiry.to_string(),
    ]
    .join("\n")
}

/// `value` as JSON with object keys sorted, whatever order the map keeps them in.
fn canonical_json(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                canonical_json(&map[key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical_json(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const SECRET_VALUE: &str = "s3cret";
    const NOW: i64 = 1_760_000_000;
    const ARGS_SHA: &str = "aa";
    const VECTOR: &str = include_str!("testdata/approval_assertion_vector.json");

    fn claim() -> Claim<'static> {
        Claim {
            org_id: "acme",
            user: "alice@acme.io",
            session_id: "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718",
            tool: "UpdateAlert",
            arguments_sha256: ARGS_SHA,
        }
    }

    fn key() -> [u8; 32] {
        derive_key(SECRET_VALUE)
    }

    fn sign(claim: &Claim<'_>, approval_id: &str, expiry: i64) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&key()).unwrap();
        mac.update(message(claim, approval_id, expiry).as_bytes());
        let digest = hex::encode(mac.finalize().into_bytes());
        format!("{approval_id}.{expiry}.{digest}")
    }

    #[test]
    fn the_shared_vector_verifies_the_way_o2_ai_signed_it() {
        let vector: Value = serde_json::from_str(VECTOR).unwrap();
        let text = |k: &str| vector[k].as_str().unwrap().to_string();
        let key = derive_key(&text("secret"));
        assert_eq!(hex::encode(key), text("key_hex"));
        let mut canonical = String::new();
        canonical_json(&vector["arguments"], &mut canonical);
        assert_eq!(canonical, text("canonical_arguments"));
        let digest = arguments_sha256(&vector["arguments"]);
        assert_eq!(digest, text("arguments_sha256"));
        let (org, user, session, tool) = (
            text("org_id"),
            text("user"),
            text("session_id"),
            text("tool"),
        );
        let claim = Claim {
            org_id: &org,
            user: &user,
            session_id: &session,
            tool: &tool,
            arguments_sha256: &digest,
        };
        let expiry = vector["expiry"].as_i64().unwrap();
        let verified = verify(&key, Some(&text("assertion")), &claim, expiry - 60).unwrap();
        assert_eq!(verified.approval_id, text("approval_id"));
    }

    #[test]
    fn a_missing_or_garbled_assertion_is_refused() {
        assert_eq!(verify(&key(), None, &claim(), NOW), Err(Refusal::Missing));
        for garbled in ["apr_1", "apr_1.x.ab", "apr_1.10.zz", ".10.ab"] {
            assert_eq!(
                verify(&key(), Some(garbled), &claim(), NOW),
                Err(Refusal::Malformed),
                "{garbled}"
            );
        }
    }

    #[test]
    fn an_expired_or_far_future_assertion_is_refused() {
        let stale = sign(&claim(), "apr_1", NOW - 1);
        assert_eq!(
            verify(&key(), Some(&stale), &claim(), NOW),
            Err(Refusal::Expired)
        );
        let forever = sign(&claim(), "apr_1", NOW + MAX_LIFETIME_SECS + 1);
        assert_eq!(
            verify(&key(), Some(&forever), &claim(), NOW),
            Err(Refusal::Expired)
        );
    }

    #[test]
    fn an_assertion_for_another_call_is_refused() {
        let token = sign(&claim(), "apr_1", NOW + 60);
        let others = [
            Claim {
                session_id: "0199e7b2-6f0c-7a3e-a1b2-000000000000",
                ..claim()
            },
            Claim {
                user: "mallory@acme.io",
                ..claim()
            },
            Claim {
                org_id: "globex",
                ..claim()
            },
            Claim {
                tool: "DeleteAlert",
                ..claim()
            },
            Claim {
                arguments_sha256: "bb",
                ..claim()
            },
        ];
        for other in &others {
            assert_eq!(
                verify(&key(), Some(&token), other, NOW),
                Err(Refusal::BadSignature)
            );
        }
        let raw_secret_key: [u8; 32] = {
            let mut k = [0u8; 32];
            k[..SECRET_VALUE.len()].copy_from_slice(SECRET_VALUE.as_bytes());
            k
        };
        assert_eq!(
            verify(&raw_secret_key, Some(&token), &claim(), NOW),
            Err(Refusal::BadSignature)
        );
    }

    #[test]
    fn reads_are_not_checked_and_a_signed_call_without_a_key_is_a_mismatch() {
        let token = sign(&claim(), "apr_1", NOW + 60);
        assert_eq!(
            check_with(Some(&key()), &claim(), None, false, NOW),
            Ok(None)
        );
        assert_eq!(check_with(None, &claim(), None, true, NOW), Ok(None));
        assert_eq!(
            check_with(None, &claim(), Some(&token), true, NOW),
            Err(Refusal::NotConfigured)
        );
        assert_eq!(
            check_with(Some(&key()), &claim(), None, true, NOW),
            Err(Refusal::Missing)
        );
    }

    #[test]
    fn an_approval_is_spent_on_first_use() {
        let verified = verify(
            &key(),
            Some(&sign(&claim(), "apr_spend", NOW + 60)),
            &claim(),
            NOW,
        )
        .unwrap();
        assert!(spend(&verified, NOW));
        assert!(!spend(&verified, NOW));
    }

    #[test]
    fn a_grant_approval_names_its_grant_whatever_the_nonce() {
        assert_eq!(grant_of("grant_g1~ab12cd34"), Some("g1"));
        assert_eq!(grant_of("grant_g1"), Some("g1"));
        assert_eq!(grant_of("apr_0123"), None);
        assert_eq!(grant_of("unenforced~ab12"), None);
    }

    #[test]
    fn canonical_arguments_sort_keys_at_every_depth() {
        let mut text = String::new();
        canonical_json(&json!({"b": [{"z": 1, "a": "é"}], "a": null}), &mut text);
        assert_eq!(text, r#"{"a":null,"b":[{"a":"é","z":1}]}"#);
    }

    #[test]
    fn the_signed_text_names_the_arguments_hash() {
        let text = message(&claim(), "apr_1", 1_760_000_060);
        assert_eq!(
            text,
            "o2-approval-v2\nacme\nalice@acme.io\n0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718\napr_1\nUpdateAlert\naa\n1760000060"
        );
    }
}
