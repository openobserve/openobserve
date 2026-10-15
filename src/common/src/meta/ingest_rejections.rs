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

//! Rejected ingest requests shown by the first-event diagnosis, and the gate that picks them.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::infra::config::ORGANIZATIONS;

pub const MAX_ORG_KEY_LEN: usize = 256;
/// Path and token name are cut to this many characters so an entry stays under 256 bytes.
pub const MAX_FIELD_LEN: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RejectionReason {
    InvalidCredentials,
    MalformedBody,
    BatchTooLarge,
    RateOrQuota,
}

impl RejectionReason {
    /// The reason an ingest response status maps to; 404, 5xx and successes map to none.
    pub fn from_status(status: u16) -> Option<Self> {
        match status {
            401 | 403 => Some(Self::InvalidCredentials),
            400 => Some(Self::MalformedBody),
            413 => Some(Self::BatchTooLarge),
            429 => Some(Self::RateOrQuota),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidCredentials => "invalid_credentials",
            Self::MalformedBody => "malformed_body",
            Self::BatchTooLarge => "batch_too_large",
            Self::RateOrQuota => "rate_or_quota",
        }
    }
}

/// One rejection cause of an org; never holds a secret, a header or body bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct IngestRejection {
    /// Unix time in microseconds when this reason was first seen; never refreshed.
    pub first_seen: i64,
    pub status: u16,
    pub reason: RejectionReason,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_name: Option<String>,
}

impl IngestRejection {
    pub fn new(
        first_seen: i64,
        status: u16,
        reason: RejectionReason,
        path: &str,
        token_name: Option<&str>,
    ) -> Self {
        Self {
            first_seen,
            status,
            reason,
            path: truncate_chars(path, MAX_FIELD_LEN),
            token_name: token_name.map(|name| truncate_chars(name, MAX_FIELD_LEN)),
        }
    }
}

/// `tracked` is false when the org has user data, for which no rejection is ever stored.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RecentRejections {
    pub tracked: bool,
    pub list: Vec<IngestRejection>,
}

/// The reason to record for this response, or none when the org is not in this node's cache.
pub fn should_record(org_id: &str, status: u16) -> Option<RejectionReason> {
    rejection_reason(org_id, status, |org| {
        // try_read keeps this sync and DB-free; a rejection racing an org write is not recorded
        ORGANIZATIONS
            .try_read()
            .is_ok_and(|orgs| orgs.contains_key(org))
    })
}

/// The reason to record when `is_known` accepts the org; the org is asked only for a mapped status.
pub fn rejection_reason(
    org_id: &str,
    status: u16,
    is_known: impl FnOnce(&str) -> bool,
) -> Option<RejectionReason> {
    let reason = RejectionReason::from_status(status)?;
    if org_id.is_empty() || org_id.chars().count() > MAX_ORG_KEY_LEN {
        return None;
    }
    is_known(org_id).then_some(reason)
}

fn truncate_chars(value: &str, max: usize) -> String {
    match value.char_indices().nth(max) {
        Some((end, _)) => value[..end].to_string(),
        None => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(first_seen: i64) -> IngestRejection {
        IngestRejection::new(
            first_seen,
            401,
            RejectionReason::InvalidCredentials,
            "/api/o/s/_json",
            None,
        )
    }

    #[test]
    fn test_status_mapping() {
        assert_eq!(
            RejectionReason::from_status(401),
            Some(RejectionReason::InvalidCredentials)
        );
        assert_eq!(
            RejectionReason::from_status(403),
            Some(RejectionReason::InvalidCredentials)
        );
        assert_eq!(
            RejectionReason::from_status(400),
            Some(RejectionReason::MalformedBody)
        );
        assert_eq!(
            RejectionReason::from_status(413),
            Some(RejectionReason::BatchTooLarge)
        );
        assert_eq!(
            RejectionReason::from_status(429),
            Some(RejectionReason::RateOrQuota)
        );
        for status in [200, 204, 404, 405, 500, 503] {
            assert_eq!(RejectionReason::from_status(status), None, "{status}");
        }
    }

    #[test]
    fn test_reason_serializes_as_its_string() {
        for reason in [
            RejectionReason::InvalidCredentials,
            RejectionReason::MalformedBody,
            RejectionReason::BatchTooLarge,
            RejectionReason::RateOrQuota,
        ] {
            let json = serde_json::to_value(reason).unwrap();
            assert_eq!(json, serde_json::Value::String(reason.as_str().to_string()));
            assert_eq!(
                serde_json::from_value::<RejectionReason>(json).unwrap(),
                reason
            );
        }
        assert!(serde_json::from_str::<RejectionReason>("\"unknown_org\"").is_err());
    }

    #[test]
    fn test_json_shape_is_snake_case_and_omits_an_unknown_token_name() {
        let with = IngestRejection::new(
            7,
            413,
            RejectionReason::BatchTooLarge,
            "/api/o/_bulk",
            Some("ci"),
        );
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"first_seen": 7, "status": 413, "reason": "batch_too_large", "path": "/api/o/_bulk", "token_name": "ci"})
        );
        let without = serde_json::to_value(entry(1)).unwrap();
        assert!(without.get("token_name").is_none());
        let answer = RecentRejections {
            tracked: true,
            list: vec![entry(1)],
        };
        let json = serde_json::to_value(&answer).unwrap();
        assert_eq!(json["tracked"], serde_json::Value::Bool(true));
        assert_eq!(json["list"][0]["first_seen"], 1);
        assert_eq!(
            serde_json::to_value(RecentRejections::default()).unwrap(),
            serde_json::json!({"tracked": false, "list": []})
        );
    }

    #[test]
    fn test_long_fields_are_truncated() {
        let long = "x".repeat(500);
        let r = IngestRejection::new(1, 400, RejectionReason::MalformedBody, &long, Some(&long));
        assert_eq!(r.path.chars().count(), MAX_FIELD_LEN);
        assert_eq!(r.token_name.unwrap().chars().count(), MAX_FIELD_LEN);
        assert_eq!(
            truncate_chars("é".repeat(70).as_str(), 64).chars().count(),
            64
        );
    }

    #[test]
    fn test_should_record_needs_a_cached_org_and_a_mapped_status() {
        let org = "ingest_rejections_common_known_org";
        ORGANIZATIONS.blocking_write().insert(
            org.to_string(),
            crate::meta::organization::Organization {
                identifier: org.to_string(),
                name: org.to_string(),
                org_type: "default".to_string(),
                service_account: None,
            },
        );
        assert_eq!(
            should_record(org, 401),
            Some(RejectionReason::InvalidCredentials)
        );
        assert_eq!(should_record(org, 404), None);
        assert_eq!(should_record(org, 500), None);
        assert_eq!(should_record("ingest_rejections_common_absent", 401), None);
        assert_eq!(should_record(&"o".repeat(MAX_ORG_KEY_LEN + 1), 401), None);
    }

    #[test]
    fn test_rejection_reason_asks_the_org_check_only_for_a_mapped_status() {
        let mut asked = Vec::new();
        let mut known = |org: &str| {
            asked.push(org.to_string());
            org == "known"
        };
        assert_eq!(
            rejection_reason("known", 413, &mut known),
            Some(RejectionReason::BatchTooLarge)
        );
        assert_eq!(rejection_reason("other", 401, &mut known), None);
        assert_eq!(rejection_reason("known", 404, &mut known), None);
        assert_eq!(rejection_reason("", 401, &mut known), None);
        assert_eq!(
            rejection_reason(&"k".repeat(MAX_ORG_KEY_LEN + 1), 401, &mut known),
            None
        );
        assert_eq!(asked, ["known", "other"]);
    }
}
