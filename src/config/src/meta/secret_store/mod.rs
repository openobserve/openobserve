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

pub mod api;
pub mod digest;
pub mod external;
pub mod grammar;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strum::{EnumIter, EnumString, IntoStaticStr};
use zeroize::Zeroizing;

macro_rules! store_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident),+ $(,)? }) => {
        $(#[$m])*
        #[derive(
            Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize,
            EnumString, IntoStaticStr, EnumIter, utoipa::ToSchema,
        )]
        #[serde(rename_all = "snake_case")]
        #[strum(serialize_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub fn as_str(self) -> &'static str {
                self.into()
            }
        }
    };
}

use store_enum;

pub const ORG_ENV_ID: &str = "_org";
pub const STORE_ID_LEN: usize = 27;

const BASE62: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OWNER_DOMAIN: &str = "o2-owner/v1";
const ENV_DOMAIN: &str = "o2-env/v1";

pub type SecretValue = Zeroizing<String>;

store_enum!(SecretKind { Secret, Variable });
store_enum!(SecretState {
    Active,
    Deleted,
    Purged,
    Conflict
});
store_enum!(ValueState {
    Set,
    Unset,
    Inherit,
    Deleted
});
store_enum!(ValueStatusState {
    Set,
    Unset,
    Inherit,
    Deleted,
    Absent
});
store_enum!(ConsumerType {
    AlertDestination,
    PipelineDestination,
    SyntheticsCheck,
    AiToolset
});
store_enum!(ArrivalReason {
    Gate,
    NoBindRequest,
    PrincipalUnknown,
    UseDenied,
    PermissionsUnavailable,
    PolicyChanged,
    ConsumerNotAllowed,
    PinMismatch,
    RefsMismatch,
    DependencyStale,
    NoOrgValue
});
store_enum!(
    /// Every store error code; `http_status` is `None` for codes that only a resolve or job
    /// reports.
    SecretErrorCode {
        StoreDisabled,
        StoreGateClosed,
        SecretUnbound,
        NotAuthorizedInRegion,
        SecretMissing,
        SecretDeleted,
        SecretConflict,
        ConsumerNotAllowed,
        AllowedConsumersEmpty,
        DeliveryStale,
        SecretPinRequired,
        PinMismatch,
        PrivateLocationRefused,
        SecretUnset,
        ValueMissingInRegion,
        SecretUnavailable,
        RedirectRefused,
        SecretNotFound,
        SecretNameTaken,
        SecretNameInvalid,
        SecretInUse,
        SecretKindMismatch,
        SecretMetadataTooLarge,
        SecretRecoveryExpired,
        SecretNotDeleted,
        SecretAccessRequired,
        SecretUseDenied,
        SecretManageRequiredForToolset,
        SecretGrantsViaStoreOnly,
        SecretPrivateLocationRefused,
        PermissionsUnavailable,
        FgaDisabled,
        FgaNotShared,
        UnknownGrant,
        GrantEditTooLarge,
        EnvIsOrgScope,
        RefNotAllowedInField,
        RefTypo,
        TemplatedAuthorityRefused,
        AuthorityOverrideRefused,
        InsecureTransport,
        PinEntryInvalid,
        PinHostsEmpty,
        PinModeInvalid,
        PinOverrideReasonRequired,
        PrivateLocationsInvalid,
        PrivateLocationsReasonRequired,
        PolicyChanged,
        ConsumerStale,
        NoOrgValue,
        SaveBeforeTest,
        CaptureOffForSecretBearing,
        JiraSetupNeedsLiteralToken,
        VariableFeedsSecretConsumer,
        SlotValueRequired,
        SlotValueRequiredOnHostChange,
        DuplicateSlotIdentity,
        SlotOriginChanged,
        ReservedKeyName,
        DekNameTaken,
        DekUnwrappedRefused,
        LeaseSuperseded,
        LeaseWrongRegion,
        RegionCallbackUnconfigured,
        RegionNameMismatch,
        RegionLabelDuplicate,
        FgaModeMismatch,
        FgaStoreMismatch,
        AgentTokenRotationRequired,
        ProbeUpgradeRequired,
        PublicLocationNotRegistrable,
        AuthModeNotEnabled,
        AwsTargetLimit,
        AzureCloudMismatch,
        ExternalSourceRequiresSecret,
        IdentityProvisionedInCloud,
        OrgTagPending,
        SecretStoreRegionUnset,
        SessionPolicyTooLarge,
        TrustPolicyIgnoresExternalId,
        BackendMissing,
        IdentityMissing,
        IdentityPropagating,
        TenantTrustMissing,
        LocatorRequired,
    }
);

impl SecretErrorCode {
    pub fn http_status(self) -> Option<u16> {
        use SecretErrorCode::*;
        match self {
            SecretNotFound => Some(404),
            LeaseWrongRegion => Some(421),
            PermissionsUnavailable | FgaNotShared => Some(503),
            PrivateLocationRefused
            | SecretAccessRequired
            | SecretUseDenied
            | SecretManageRequiredForToolset
            | AgentTokenRotationRequired
            | PublicLocationNotRegistrable => Some(403),
            SecretMetadataTooLarge
            | AllowedConsumersEmpty
            | SecretNameInvalid
            | SecretGrantsViaStoreOnly
            | UnknownGrant
            | GrantEditTooLarge
            | EnvIsOrgScope
            | RefNotAllowedInField
            | RefTypo
            | TemplatedAuthorityRefused
            | AuthorityOverrideRefused
            | InsecureTransport
            | PinEntryInvalid
            | PinHostsEmpty
            | PinModeInvalid
            | PinOverrideReasonRequired
            | PrivateLocationsInvalid
            | PrivateLocationsReasonRequired
            | SlotValueRequired
            | DuplicateSlotIdentity
            | ReservedKeyName
            | ProbeUpgradeRequired
            | ExternalSourceRequiresSecret
            | SecretStoreRegionUnset
            | SessionPolicyTooLarge
            | LocatorRequired => Some(400),
            StoreDisabled
            | StoreGateClosed
            | ConsumerNotAllowed
            | SecretPinRequired
            | PinMismatch
            | SecretNameTaken
            | SecretInUse
            | SecretKindMismatch
            | SecretRecoveryExpired
            | SecretNotDeleted
            | SecretPrivateLocationRefused
            | FgaDisabled
            | PolicyChanged
            | ConsumerStale
            | NoOrgValue
            | SaveBeforeTest
            | CaptureOffForSecretBearing
            | JiraSetupNeedsLiteralToken
            | VariableFeedsSecretConsumer
            | SlotValueRequiredOnHostChange
            | LeaseSuperseded
            | AuthModeNotEnabled
            | AwsTargetLimit
            | AzureCloudMismatch
            | IdentityProvisionedInCloud
            | OrgTagPending
            | TrustPolicyIgnoresExternalId => Some(409),
            SecretUnbound
            | NotAuthorizedInRegion
            | SecretMissing
            | SecretDeleted
            | SecretConflict
            | DeliveryStale
            | SecretUnset
            | ValueMissingInRegion
            | SecretUnavailable
            | RedirectRefused
            | SlotOriginChanged
            | DekNameTaken
            | DekUnwrappedRefused
            | RegionCallbackUnconfigured
            | RegionNameMismatch
            | RegionLabelDuplicate
            | FgaModeMismatch
            | FgaStoreMismatch
            | BackendMissing
            | IdentityMissing
            | IdentityPropagating
            | TenantTrustMissing => None,
        }
    }
}

impl std::fmt::Display for SecretErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::error::Error for SecretErrorCode {}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum StoreMode {
    SingleCluster,
    SuperCluster { region: String },
}

/// Ordered: a route's declared minimum is met by its own state and every later one.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    EnumString,
    IntoStaticStr,
    EnumIter,
    utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GateState {
    Closed,
    Writable,
    Latched,
}

/// Value-free by construction: a save returns it and nothing in P1 publishes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindRequest {
    pub saved_by: String,
    pub refs: Vec<BindRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindRef {
    pub field: String,
    pub secret_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaseIssuer {
    Dispatcher,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeasePrincipal {
    pub org_id: String,
    pub job_id: String,
    pub attempt: i32,
    pub issuer: LeaseIssuer,
    pub upload_key_prefix: String,
}

/// Implemented in ENT over `check_strict`; `Unavailable` maps to `PermissionsUnavailable`.
#[async_trait]
pub trait SecretStoreAuthz: Send + Sync {
    async fn check_strict(
        &self,
        org_id: &str,
        user_id: &str,
        role: &str,
        object: &str,
        verb: &str,
    ) -> Result<Decision, SecretErrorCode>;

    async fn list_objects(
        &self,
        org_id: &str,
        user_id: &str,
        role: &str,
        object_type: &str,
        verb: &str,
    ) -> Result<Vec<String>, SecretErrorCode>;
}

pub trait StoreGate: Send + Sync {
    fn state(&self) -> Result<GateState, SecretErrorCode>;

    fn require(&self, min: GateState) -> Result<(), SecretErrorCode>;
}

#[async_trait]
pub trait ProbeLease: Send + Sync {
    async fn authenticate(&self, token: &str) -> Result<LeasePrincipal, SecretErrorCode>;
}

/// The OSS build's stand-in for every store trait.
#[derive(Clone, Copy, Debug, Default)]
pub struct DisabledStore;

#[async_trait]
impl SecretStoreAuthz for DisabledStore {
    async fn check_strict(
        &self,
        _org_id: &str,
        _user_id: &str,
        _role: &str,
        _object: &str,
        _verb: &str,
    ) -> Result<Decision, SecretErrorCode> {
        Err(SecretErrorCode::StoreDisabled)
    }

    async fn list_objects(
        &self,
        _org_id: &str,
        _user_id: &str,
        _role: &str,
        _object_type: &str,
        _verb: &str,
    ) -> Result<Vec<String>, SecretErrorCode> {
        Err(SecretErrorCode::StoreDisabled)
    }
}

impl StoreGate for DisabledStore {
    fn state(&self) -> Result<GateState, SecretErrorCode> {
        Err(SecretErrorCode::StoreDisabled)
    }

    fn require(&self, _min: GateState) -> Result<(), SecretErrorCode> {
        Err(SecretErrorCode::StoreDisabled)
    }
}

#[async_trait]
impl ProbeLease for DisabledStore {
    async fn authenticate(&self, _token: &str) -> Result<LeasePrincipal, SecretErrorCode> {
        Err(SecretErrorCode::StoreDisabled)
    }
}

/// Owner id for kinds whose natural key is not an immutable id of at most 27 characters.
pub fn owner_surrogate(org_id: &str, owner_kind: &str, natural_key: &str) -> String {
    derived_id(&[
        OWNER_DOMAIN.as_bytes(),
        org_id.as_bytes(),
        owner_kind.as_bytes(),
        natural_key.as_bytes(),
    ])
}

/// Deterministic `credential_values.secret_ref` of one owned slot.
pub fn owned_slot_ref(org_id: &str, owner_kind: &str, owner_id: &str, slot_path: &str) -> String {
    derived_id(&[
        org_id.as_bytes(),
        owner_kind.as_bytes(),
        owner_id.as_bytes(),
        slot_path.as_bytes(),
    ])
}

/// One environment life; `created_at` is the row's creation time in microseconds.
pub fn env_incarnation(org_id: &str, env_id: &str, created_at: i64) -> String {
    let created_at = created_at.to_string();
    derived_id(&[
        ENV_DOMAIN.as_bytes(),
        org_id.as_bytes(),
        env_id.as_bytes(),
        created_at.as_bytes(),
    ])
}

/// Length-prefixed (u32 big-endian) concatenation, so no two component lists collide.
pub fn length_prefixed(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(parts.iter().map(|p| p.len() + 4).sum());
    for part in parts {
        out.extend_from_slice(&(part.len() as u32).to_be_bytes());
        out.extend_from_slice(part);
    }
    out
}

fn derived_id(parts: &[&[u8]]) -> String {
    let digest = Sha256::digest(length_prefixed(parts));
    base62_padded(&digest[..20], STORE_ID_LEN)
}

fn base62_padded(bytes: &[u8], width: usize) -> String {
    let mut num = bytes.to_vec();
    let mut digits = Vec::with_capacity(width);
    while num.iter().any(|b| *b != 0) {
        let mut rem = 0u32;
        for byte in num.iter_mut() {
            let acc = (rem << 8) | u32::from(*byte);
            *byte = (acc / 62) as u8;
            rem = acc % 62;
        }
        digits.push(BASE62[rem as usize]);
    }
    while digits.len() < width {
        digits.push(b'0');
    }
    digits.reverse();
    String::from_utf8(digits).expect("base62 alphabet is ASCII")
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use strum::IntoEnumIterator;

    use super::*;

    // ENT and the runner fixtures reuse these; a change breaks every stored owned row.
    const GOLDEN_OWNER_SURROGATE: &str = "Xj0CpDSTbnlYEjmLOelxuVK1lp8";
    const GOLDEN_OWNED_SLOT_REF: &str = "9VnRGkTXjhpayvedefrAUe2gyob";
    const GOLDEN_ENV_INCARNATION: &str = "MlGnDqOF3X3RDP4AmAPuQh4Fbxm";

    #[test]
    fn golden_owner_surrogate() {
        assert_eq!(
            owner_surrogate("default", "StorageProvider", "default"),
            GOLDEN_OWNER_SURROGATE
        );
    }

    #[test]
    fn golden_owned_slot_ref() {
        assert_eq!(
            owned_slot_ref("default", "ProbeToken", "tok_1", "token"),
            GOLDEN_OWNED_SLOT_REF
        );
    }

    #[test]
    fn golden_env_incarnation() {
        assert_eq!(
            env_incarnation("default", "default/prod", 1_700_000_000_000_000),
            GOLDEN_ENV_INCARNATION
        );
    }

    #[test]
    fn derived_ids_are_27_base62_chars_and_input_sensitive() {
        let long_org = "o".repeat(300);
        let ids = [
            owner_surrogate(&long_org, "Telephony", &long_org),
            owner_surrogate("a", "b", "c"),
            owner_surrogate("ab", "", "c"),
            owned_slot_ref("a", "b", "c", "d"),
            env_incarnation("a", "a/prod", 1),
            env_incarnation("a", "a/prod", 2),
        ];
        for id in &ids {
            assert_eq!(id.len(), STORE_ID_LEN, "{id}");
            assert!(id.bytes().all(|b| b.is_ascii_alphanumeric()), "{id}");
        }
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len());
    }

    #[test]
    fn base62_pads_small_numbers() {
        assert_eq!(base62_padded(&[0; 20], 27), "0".repeat(27));
        assert_eq!(base62_padded(&[0, 62], 4), "0010");
        assert_eq!(base62_padded(&[255; 20], 27).len(), 27);
    }

    #[test]
    fn bind_request_round_trips_and_carries_no_value() {
        let req = BindRequest {
            saved_by: "u@example.com".into(),
            refs: vec![BindRef {
                field: "headers.Authorization".into(),
                secret_id: "2abc".into(),
            }],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "saved_by": "u@example.com",
                "refs": [{"field": "headers.Authorization", "secret_id": "2abc"}]
            })
        );
        let back: BindRequest = serde_json::from_value(json).unwrap();
        assert_eq!(back, req);
        let with_value = serde_json::json!({
            "saved_by": "u", "refs": [{"field": "f", "secret_id": "s", "value": "x"}]
        });
        assert!(serde_json::from_value::<BindRequest>(with_value).is_err());
    }

    #[test]
    fn enum_strings_round_trip() {
        for code in SecretErrorCode::iter() {
            assert_eq!(SecretErrorCode::from_str(code.as_str()).unwrap(), code);
            let json = serde_json::to_value(code).unwrap();
            assert_eq!(json, serde_json::json!(code.as_str()));
        }
        assert_eq!(SecretState::Conflict.as_str(), "conflict");
        assert_eq!(ValueStatusState::Absent.as_str(), "absent");
        assert_eq!(ConsumerType::AiToolset.as_str(), "ai_toolset");
        assert_eq!(ArrivalReason::DependencyStale.as_str(), "dependency_stale");
        assert!(SecretErrorCode::from_str("reveal_log_unavailable").is_err());
    }

    #[test]
    fn empty_allowed_consumers_is_a_bad_request() {
        let code: SecretErrorCode = serde_json::from_str(r#""allowed_consumers_empty""#).unwrap();
        assert_eq!(code, SecretErrorCode::AllowedConsumersEmpty);
        assert_eq!(code.http_status(), Some(400));
        assert_eq!(
            serde_json::to_value(code).unwrap(),
            "allowed_consumers_empty"
        );
    }

    #[test]
    fn error_statuses_match_the_design() {
        assert_eq!(SecretErrorCode::SecretNotFound.http_status(), Some(404));
        assert_eq!(SecretErrorCode::StoreDisabled.http_status(), Some(409));
        assert_eq!(SecretErrorCode::LeaseWrongRegion.http_status(), Some(421));
        assert_eq!(
            SecretErrorCode::PermissionsUnavailable.http_status(),
            Some(503)
        );
        assert_eq!(SecretErrorCode::SecretUnavailable.http_status(), None);
        assert_eq!(
            SecretErrorCode::DuplicateSlotIdentity.http_status(),
            Some(400)
        );
        assert_eq!(SecretErrorCode::SlotOriginChanged.http_status(), None);
        assert_eq!(
            SecretErrorCode::SlotOriginChanged.as_str(),
            "slot_origin_changed"
        );
    }

    #[test]
    fn gate_states_are_ordered() {
        assert!(GateState::Closed < GateState::Writable);
        assert!(GateState::Writable < GateState::Latched);
    }

    #[tokio::test]
    async fn disabled_store_refuses_everything() {
        let s = DisabledStore;
        assert_eq!(
            s.check_strict("o", "u", "admin", "secrets:x", "GET").await,
            Err(SecretErrorCode::StoreDisabled)
        );
        assert_eq!(
            s.list_objects("o", "u", "admin", "secrets", "GET").await,
            Err(SecretErrorCode::StoreDisabled)
        );
        assert_eq!(s.state(), Err(SecretErrorCode::StoreDisabled));
        assert_eq!(
            StoreGate::require(&s, GateState::Writable),
            Err(SecretErrorCode::StoreDisabled)
        );
        assert_eq!(
            s.authenticate("o2lease_j.x").await,
            Err(SecretErrorCode::StoreDisabled)
        );
    }
}
