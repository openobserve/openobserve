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

use serde::{Deserialize, Serialize};

pub const TOKEN_PREFIX: &str = "o2dt.";
pub const TOKEN_VERSION: u8 = 1;
pub const SCOPE_ASSISTANT: &str = "assistant";
pub const KEY_INFO: &[u8] = b"o2-slack-delegation-v1";
pub const MAC_DOMAIN: &[u8] = b"o2dt.v1\0";
/// `ZO_DELEGATION_SIGNING_KEY_PREVIOUS` value that keeps the master-key-derived key verifying.
pub const PREVIOUS_DERIVED: &str = "derived";

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

pub fn derive_key(_master_key_b64: &str) -> anyhow::Result<[u8; 32]> {
    Err(anyhow::anyhow!("slack phase0: not implemented"))
}

pub fn effective_keys(
    _master_b64: &str,
    _override_b64: &str,
    _previous: &str,
) -> anyhow::Result<Keys> {
    Err(anyhow::anyhow!("slack phase0: not implemented"))
}

pub fn sign(_keys: &Keys, _claims: &Claims) -> String {
    // slack phase0: not implemented
    String::new()
}

pub fn verify(_keys: &Keys, _token: &str, _now: i64) -> Result<Claims, DelegationError> {
    Err(DelegationError::Malformed(
        "slack phase0: not implemented".to_string(),
    ))
}
