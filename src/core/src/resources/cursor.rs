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

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use config::meta::resources::{MatchTier, ResourceKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::SearchError;

const MAX_CURSOR_BYTES: usize = 8192;
const TTL_US: i64 = 300_000_000;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SortKey {
    pub tier: Option<MatchTier>,
    pub name: String,
    pub kind: ResourceKind,
    pub id: String,
}

pub(super) struct CursorScope<'a> {
    pub subject: &'a str,
    pub org: &'a str,
    pub kind: ResourceKind,
    pub query: &'a str,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Cursor {
    subject: String,
    org: String,
    kind: ResourceKind,
    query_hash: String,
    pub generation: String,
    pub last: SortKey,
    expires_at_us: i64,
}

pub(super) fn encode(
    scope: &CursorScope<'_>,
    generation: &str,
    last: SortKey,
    now_us: i64,
) -> Result<String, SearchError> {
    let cursor = Cursor {
        subject: scope.subject.into(),
        org: scope.org.into(),
        kind: scope.kind,
        query_hash: query_hash(scope.query),
        generation: generation.into(),
        last,
        expires_at_us: now_us.saturating_add(TTL_US),
    };
    let bytes = serde_json::to_vec(&cursor).map_err(|_| SearchError::ServiceUnavailable)?;
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    if encoded.len() > MAX_CURSOR_BYTES {
        return Err(SearchError::InvalidQuery("cursor exceeds 8 KiB".into()));
    }
    Ok(encoded)
}

pub(super) fn decode(
    value: &str,
    scope: &CursorScope<'_>,
    now_us: i64,
) -> Result<Cursor, SearchError> {
    let invalid = || SearchError::InvalidQuery("invalid or expired cursor".into());
    if value.len() > MAX_CURSOR_BYTES {
        return Err(invalid());
    }
    let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid())?;
    let cursor: Cursor = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if cursor.subject != scope.subject
        || cursor.org != scope.org
        || cursor.kind != scope.kind
        || cursor.last.kind != scope.kind
        || cursor.query_hash != query_hash(scope.query)
        || cursor.expires_at_us <= now_us
        || cursor.expires_at_us > now_us.saturating_add(TTL_US)
        || cursor.generation.len() > 128
    {
        return Err(invalid());
    }
    Ok(cursor)
}

fn query_hash(query: &str) -> String {
    let digest = Sha256::digest(query.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope<'a>(subject: &'a str, org: &'a str, query: &'a str) -> CursorScope<'a> {
        CursorScope {
            subject,
            org,
            kind: ResourceKind::Dashboard,
            query,
        }
    }

    fn key() -> SortKey {
        SortKey {
            tier: Some(MatchTier::NamePrefix),
            name: "payment".into(),
            kind: ResourceKind::Dashboard,
            id: "d1".into(),
        }
    }

    #[test]
    fn cursor_binds_subject_org_type_query_and_expiration() {
        let s = scope("a", "org", "Pay");
        let encoded = encode(&s, "boot:3", key(), 10).unwrap();
        assert_eq!(decode(&encoded, &s, 11).unwrap().generation, "boot:3");
        assert!(decode(&encoded, &scope("b", "org", "Pay"), 11).is_err());
        assert!(decode(&encoded, &scope("a", "else", "Pay"), 11).is_err());
        assert!(decode(&encoded, &scope("a", "org", "pay"), 11).is_err());
        let other = CursorScope {
            kind: ResourceKind::Alert,
            ..s
        };
        assert!(decode(&encoded, &other, 11).is_err());
        assert!(decode(&encoded, &s, 10 + TTL_US).is_err());
    }

    #[test]
    fn cursor_rejects_malformed_or_oversized_input() {
        let s = scope("a", "org", "Pay");
        assert!(decode("not-json", &s, 11).is_err());
        assert!(decode(&"a".repeat(MAX_CURSOR_BYTES + 1), &s, 11).is_err());
        let mut last = key();
        last.name = "a".repeat(MAX_CURSOR_BYTES);
        assert!(encode(&s, "boot:3", last, 10).is_err());
    }
}
