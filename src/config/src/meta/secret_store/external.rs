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

use std::{fmt, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strum::{EnumIter, EnumString, IntoStaticStr};

use super::{SecretErrorCode, SecretValue, length_prefixed, store_enum};

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_BODY_BYTES: usize = 1024 * 1024;
pub const MAX_VALUE_BYTES: usize = 64 * 1024;
pub const RETRY_BACKOFFS: [Duration; 2] = [Duration::from_millis(200), Duration::from_millis(800)];

const BASE32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
const ORG_TAG_LEN: usize = 26;

store_enum!(AuthMode {
    Static,
    Mapped,
    RegionIssuer
});
store_enum!(BackendKind {
    AwsSm,
    GcpSm,
    AzureKv
});

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pointer {
    pub backend_id: String,
    pub locator: String,
    pub version_selector: VersionSelector,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionSelector {
    Stage(String),
    Id(String),
    Latest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedIdentity {
    Static {
        credential_rev: String,
    },
    Mapped {
        region: String,
        identity_incarnation: String,
    },
    RegionIssuer {
        region: String,
        kid: String,
    },
}

impl ResolvedIdentity {
    pub fn identity_rev(&self) -> String {
        match self {
            Self::Static { credential_rev } => credential_rev.clone(),
            Self::Mapped {
                region,
                identity_incarnation,
            } => format!("{region}:{identity_incarnation}"),
            Self::RegionIssuer { region, kid } => format!("{region}:{kid}"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct FetchBudget {
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub fetch_timeout: Duration,
    pub max_body_bytes: usize,
    pub max_value_bytes: usize,
    pub retry_backoffs: [Duration; 2],
}

impl Default for FetchBudget {
    fn default() -> Self {
        Self {
            connect_timeout: CONNECT_TIMEOUT,
            request_timeout: REQUEST_TIMEOUT,
            fetch_timeout: FETCH_TIMEOUT,
            max_body_bytes: MAX_BODY_BYTES,
            max_value_bytes: MAX_VALUE_BYTES,
            retry_backoffs: RETRY_BACKOFFS,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FetchError {
    Transient {
        reason: &'static str,
    },
    /// A transient refusal whose provider asked for a minimum wait before the next attempt.
    Throttled {
        reason: &'static str,
        retry_after: Duration,
    },
    Denied {
        reason: &'static str,
    },
    Missing {
        reason: &'static str,
    },
    Invalid {
        reason: &'static str,
    },
}

impl FetchError {
    pub fn class(&self) -> &'static str {
        match self {
            Self::Transient { .. } | Self::Throttled { .. } => "transient",
            Self::Denied { .. } => "denied",
            Self::Missing { .. } => "missing",
            Self::Invalid { .. } => "invalid",
        }
    }

    pub fn reason(&self) -> &'static str {
        match self {
            Self::Transient { reason }
            | Self::Throttled { reason, .. }
            | Self::Denied { reason }
            | Self::Missing { reason }
            | Self::Invalid { reason } => reason,
        }
    }

    pub fn is_transient(&self) -> bool {
        matches!(self, Self::Transient { .. } | Self::Throttled { .. })
    }

    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::Throttled { retry_after, .. } => Some(*retry_after),
            _ => None,
        }
    }
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.class(), self.reason())
    }
}

#[async_trait]
pub trait ExternalSecretBackend: Send + Sync {
    fn kind(&self) -> BackendKind;

    async fn fetch(
        &self,
        pointer: &Pointer,
        identity: &ResolvedIdentity,
        budget: &FetchBudget,
    ) -> Result<SecretValue, FetchError>;
}

pub struct DisabledBackend(pub BackendKind);

#[async_trait]
impl ExternalSecretBackend for DisabledBackend {
    fn kind(&self) -> BackendKind {
        self.0
    }

    async fn fetch(
        &self,
        _pointer: &Pointer,
        _identity: &ResolvedIdentity,
        _budget: &FetchBudget,
    ) -> Result<SecretValue, FetchError> {
        Err(FetchError::Denied {
            reason: "store_disabled",
        })
    }
}

pub fn org_tag(org_id: &str, org_incarnation: &str) -> Result<String, SecretErrorCode> {
    if org_incarnation.is_empty() {
        return Err(SecretErrorCode::OrgTagPending);
    }
    let digest = Sha256::digest(length_prefixed(&[
        b"o2-org/v2",
        org_id.as_bytes(),
        org_incarnation.as_bytes(),
    ]));
    let mut tag = String::with_capacity(ORG_TAG_LEN);
    let mut bits = 0;
    let mut buffer = 0u16;
    for byte in digest {
        buffer = (buffer << 8) | u16::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            tag.push(BASE32[((buffer >> bits) & 31) as usize] as char);
            if tag.len() == ORG_TAG_LEN {
                return Ok(tag);
            }
        }
    }
    Ok(tag)
}

pub fn validate_region(region: &str) -> bool {
    (1..=24).contains(&region.len())
        && region
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn auth_modes_and_backend_kinds_have_stable_names() {
        for (mode, name) in [
            (AuthMode::Static, "static"),
            (AuthMode::Mapped, "mapped"),
            (AuthMode::RegionIssuer, "region_issuer"),
        ] {
            assert_eq!(mode.as_str(), name);
            assert_eq!(serde_json::to_value(mode).unwrap(), json!(name));
        }
        for (kind, name) in [
            (BackendKind::AwsSm, "aws_sm"),
            (BackendKind::GcpSm, "gcp_sm"),
            (BackendKind::AzureKv, "azure_kv"),
        ] {
            assert_eq!(kind.as_str(), name);
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
        }
    }

    #[test]
    fn pointer_wire_shapes_round_trip() {
        for (selector, selector_json, key) in [
            (
                VersionSelector::Stage("current".into()),
                json!({"stage": "current"}),
                Some("field"),
            ),
            (VersionSelector::Id("v1".into()), json!({"id": "v1"}), None),
            (VersionSelector::Latest, json!("latest"), None),
        ] {
            let pointer = Pointer {
                backend_id: "b".into(),
                locator: "l".into(),
                version_selector: selector,
                json_key: key.map(str::to_owned),
            };
            let mut wire =
                json!({"backend_id": "b", "locator": "l", "version_selector": selector_json});
            if let Some(key) = key {
                wire["json_key"] = json!(key);
            }
            assert_eq!(serde_json::to_value(&pointer).unwrap(), wire);
            assert_eq!(serde_json::from_value::<Pointer>(wire).unwrap(), pointer);
        }
        let unknown =
            json!({"backend_id":"b", "locator":"l", "version_selector":"latest", "extra":true});
        assert!(serde_json::from_value::<Pointer>(unknown).is_err());
    }

    #[test]
    fn identity_revision_includes_region_for_regional_modes() {
        for (identity, rev) in [
            (
                ResolvedIdentity::Static {
                    credential_rev: "c1".into(),
                },
                "c1",
            ),
            (
                ResolvedIdentity::Mapped {
                    region: "east".into(),
                    identity_incarnation: "i1".into(),
                },
                "east:i1",
            ),
            (
                ResolvedIdentity::RegionIssuer {
                    region: "west".into(),
                    kid: "k1".into(),
                },
                "west:k1",
            ),
        ] {
            assert_eq!(identity.identity_rev(), rev);
        }
    }

    #[test]
    fn fetch_budget_pins_deadlines_limits_and_backoffs() {
        let budget = FetchBudget::default();
        assert_eq!(budget.connect_timeout, Duration::from_secs(3));
        assert_eq!(budget.request_timeout, Duration::from_secs(10));
        assert_eq!(budget.fetch_timeout, Duration::from_secs(15));
        assert_eq!(budget.max_body_bytes, 1024 * 1024);
        assert_eq!(budget.max_value_bytes, 64 * 1024);
        assert_eq!(
            budget.retry_backoffs,
            [Duration::from_millis(200), Duration::from_millis(800)]
        );
    }

    #[test]
    fn fetch_errors_report_class_and_static_reason() {
        for (error, class, reason) in [
            (
                FetchError::Transient { reason: "timeout" },
                "transient",
                "timeout",
            ),
            (
                FetchError::Throttled {
                    reason: "throttled",
                    retry_after: Duration::from_secs(2),
                },
                "transient",
                "throttled",
            ),
            (FetchError::Denied { reason: "denied" }, "denied", "denied"),
            (
                FetchError::Missing {
                    reason: "identity_missing",
                },
                "missing",
                "identity_missing",
            ),
            (
                FetchError::Invalid {
                    reason: "binary_not_supported",
                },
                "invalid",
                "binary_not_supported",
            ),
        ] {
            assert_eq!(error.class(), class);
            assert_eq!(error.reason(), reason);
            assert_eq!(error.to_string(), format!("{class}:{reason}"));
        }
    }

    #[test]
    fn org_tag_matches_golden_vectors_and_requires_incarnation() {
        for (org, expected) in [
            ("default", "p6chafstytn226hmddnssl7cdn"),
            ("x".repeat(256).as_str(), "ffmzzlzwvqywoxtiufjmbldq3l"),
        ] {
            let tag = org_tag(org, "2abcdefghijklmnopqrstuvwxyz").unwrap();
            assert_eq!(tag, expected);
            assert_eq!(tag.len(), 26);
            assert!(
                tag.bytes()
                    .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b))
            );
        }
        assert_eq!(org_tag("default", ""), Err(SecretErrorCode::OrgTagPending));
    }

    #[test]
    fn region_validates_ascii_and_length() {
        for region in ["-", "r2-west", &"a".repeat(24)] {
            assert!(validate_region(region), "{region:?}");
        }
        for region in ["", "Upper", "r_2", "a/b", "ré", "r\n", &"a".repeat(25)] {
            assert!(!validate_region(region), "{region:?}");
        }
    }

    #[tokio::test]
    async fn disabled_backend_refuses_fetch() {
        let backend: &dyn ExternalSecretBackend = &DisabledBackend(BackendKind::GcpSm);
        assert_eq!(backend.kind(), BackendKind::GcpSm);
        let result: Result<SecretValue, FetchError> = backend
            .fetch(
                &Pointer {
                    backend_id: "b".into(),
                    locator: "l".into(),
                    version_selector: VersionSelector::Latest,
                    json_key: None,
                },
                &ResolvedIdentity::Static {
                    credential_rev: "c1".into(),
                },
                &FetchBudget::default(),
            )
            .await;
        assert!(matches!(
            result,
            Err(FetchError::Denied {
                reason: "store_disabled"
            })
        ));
    }
}
