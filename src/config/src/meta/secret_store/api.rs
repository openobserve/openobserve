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
use strum::{EnumIter, EnumString, IntoStaticStr};
use utoipa::{
    IntoParams, PartialSchema, ToSchema,
    openapi::{RefOr, schema::Schema},
};

use super::{
    ConsumerType, GateState, SecretErrorCode, SecretKind, SecretState, SecretValue, ValueState,
    external::{AuthMode, BackendKind, Pointer},
    store_enum,
};

store_enum!(PinMode {
    None,
    Hosts,
    Any,
    Legacy
});
store_enum!(PrivateLocations { Off, On, Legacy });
store_enum!(SecretSource {
    Local,
    External,
    Mixed
});
store_enum!(StoreModeName {
    SingleCluster,
    SuperCluster
});
store_enum!(FgaSetting { On, Off });

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct ListSecretsQuery {
    pub kind: Option<SecretKind>,
    /// Case-insensitive substring of the name; page on with the returned `next` as `cursor`.
    pub q: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub usable_by: Option<ConsumerType>,
    pub consumer_id: Option<String>,
    /// Comma-separated location ids of an unsaved synthetics check; they replace its saved ones.
    pub locations: Option<String>,
    /// `true` lists only deleted (restorable) rows; the default lists active rows.
    pub deleted: Option<bool>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AllowedConsumer {
    #[serde(rename = "type")]
    pub consumer_type: ConsumerType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretEnvSummary {
    pub env: String,
    pub state: ValueState,
    pub value_version: i64,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretListItem {
    pub id: String,
    pub name: String,
    pub kind: SecretKind,
    pub description: String,
    pub state: SecretState,
    pub allowed_types: Vec<ConsumerType>,
    pub selected_count: u64,
    pub allowed_hosts: Vec<String>,
    pub pin_mode: PinMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin_override_reason: Option<String>,
    pub private_locations: PrivateLocations,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_locations_reason: Option<String>,
    pub envs: Vec<SecretEnvSummary>,
    pub usage_count: u64,
    pub source: SecretSource,
    pub updated_at: i64,
    pub updated_by: String,
    /// Only variables expose a value because secrets are write-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretPickerItem {
    pub id: String,
    pub name: String,
    pub kind: SecretKind,
    pub pin_mode: PinMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin_override_reason: Option<String>,
    pub private_locations: PrivateLocations,
    pub allowed_here: bool,
    pub rights: SecretRights,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum SecretListPage {
    List {
        items: Vec<SecretListItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        next: Option<String>,
    },
    Picker {
        // An empty picker has the same wire representation as an empty list.
        #[schema(min_items = 1)]
        items: Vec<SecretPickerItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        next: Option<String>,
    },
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnvValueInput {
    pub env: String,
    #[schema(value_type = String)]
    pub value: SecretValue,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateGrants {
    #[serde(rename = "use", default)]
    pub use_roles: Vec<String>,
    #[serde(default)]
    pub manage: Vec<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSecretRequest {
    pub name: String,
    pub kind: SecretKind,
    pub description: Option<String>,
    #[schema(value_type = String, nullable)]
    #[serde(default)]
    pub value: Option<SecretValue>,
    pub env_values: Option<Vec<EnvValueInput>>,
    pub allowed_consumers: Vec<AllowedConsumer>,
    pub allowed_hosts: Option<Vec<String>>,
    pub grants: Option<CreateGrants>,
    /// An external pointer for the org value; `kind=secret` only, exclusive with `value`.
    #[schema(value_type = Option<Object>)]
    pub source: Option<Pointer>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreateSecretResponse {
    pub id: String,
    /// The inline grants whose tuples were not written; the secret exists without them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grants_unapplied: Option<CreateGrants>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretEnvDetail {
    pub env: String,
    pub state: ValueState,
    pub value_version: i64,
    pub updated_at: i64,
    pub updated_by: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: SecretKind,
    pub state: SecretState,
    pub envs: Vec<SecretEnvDetail>,
    pub allowed_consumers: Vec<AllowedConsumer>,
    pub allowed_hosts: Vec<String>,
    pub pin_mode: PinMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin_override_reason: Option<String>,
    pub private_locations: PrivateLocations,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_locations_reason: Option<String>,
    pub policy_rev: String,
    pub usage_count: u64,
    pub rights: SecretRights,
    /// Only variables expose a value because secrets are write-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// The caller's own rights on one secret, so the UI hides actions it would refuse.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SecretRights {
    pub see: bool,
    #[serde(rename = "use")]
    pub use_value: bool,
    pub manage: bool,
    pub manage_access: bool,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DescribeSecretRequest {
    pub description: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutValueRequest {
    #[schema(value_type = String, nullable)]
    #[serde(default)]
    pub value: Option<SecretValue>,
    pub unset: Option<bool>,
    /// Exactly one of `value`, `unset` or `source`; `source` is for `kind=secret` only.
    #[schema(value_type = Option<Object>)]
    pub source: Option<Pointer>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ValueWriteResponse {
    pub value_rev: String,
    pub value_version: i64,
    pub updated_at: i64,
    pub updated_by: String,
}

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct PolicyQuery {
    pub dry_run: Option<bool>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PolicyRequest {
    pub allowed_consumers: Vec<AllowedConsumer>,
    pub allowed_hosts: Vec<String>,
    pub pin_mode: Option<PinMode>,
    pub pin_override_reason: Option<String>,
    pub private_locations: Option<PrivateLocations>,
    pub private_locations_reason: Option<String>,
    pub expected_policy_rev: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct NowFailing {
    pub consumer_type: ConsumerType,
    pub consumer_id: String,
    pub consumer_name: String,
    pub code: SecretErrorCode,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct PolicyResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_rev: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_version: Option<i64>,
    pub now_failing: Vec<NowFailing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective: Option<bool>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SecretGrants {
    #[serde(default)]
    pub see: Vec<String>,
    #[serde(rename = "use", default)]
    pub use_roles: Vec<String>,
    #[serde(default)]
    pub manage: Vec<String>,
    #[serde(default)]
    pub manage_access: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_grants_rev: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretGrantsResponse {
    pub grants_rev: String,
    #[serde(flatten)]
    #[schema(schema_with = flattened_grants_schema)]
    pub grants: SecretGrants,
    /// Roles whose requested add or removal did not take effect.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unapplied: Option<SecretGrants>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateGrantsAll {
    pub create: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UsageHop {
    pub consumer_type: ConsumerType,
    pub consumer_id: String,
    pub consumer_name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UsageEntry {
    pub path: Vec<UsageHop>,
    pub field: String,
    pub status: String,
    pub token_name: String,
}

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct UsageQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct UsagePage {
    pub items: Vec<UsageEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct DeleteSecretQuery {
    pub force: Option<bool>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenameSecretRequest {
    pub new_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct PrescanHit {
    pub consumer_type: ConsumerType,
    pub consumer_id: String,
    pub field: String,
    pub token: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct PrescanPage {
    pub items: Vec<PrescanHit>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct OrgStoreStatus {
    pub mode: StoreModeName,
    pub region: String,
    pub store_ready: bool,
    /// One of super_cluster, refs_disabled, fga_mode_mismatch, upgrading; empty when ready.
    #[serde(default)]
    pub not_ready_reason: String,
    pub fga: FgaSetting,
    /// Whether the caller passes the strict create check.
    pub can_create: bool,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct NodeStoreStatus {
    pub node: String,
    pub level: u32,
    pub refs_enabled: bool,
    pub fga_mode: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct MetaStoreStatus {
    pub gate: GateState,
    pub nodes: Vec<NodeStoreStatus>,
    pub unprefixed_cipher_rows: u64,
    pub aesenc_system_rows: u64,
    pub wrap_floor: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum StoreStatus {
    Meta(MetaStoreStatus),
    Org(OrgStoreStatus),
}

/// Provider settings only (endpoint, account, project, vault, CA bundle, tenant role);
/// never a credential, which goes through the write-only credential PUT.
pub type BackendConfig = serde_json::Map<String, serde_json::Value>;

#[derive(Serialize, Deserialize, ToSchema)]
pub struct BackendItem {
    pub id: String,
    pub name: String,
    pub kind: BackendKind,
    pub description: String,
    #[schema(value_type = Object)]
    pub config: BackendConfig,
    pub path_prefixes: Vec<String>,
    pub auth_mode: AuthMode,
    /// Whether a static credential is stored; the credential itself is never returned.
    pub cred_set: bool,
    /// A readiness row exists at the current backend and identity revisions.
    pub ready: bool,
    pub secrets_count: u64,
    pub ttl_secs: i32,
    pub stale_max_secs: i32,
    pub backend_rev: String,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct BackendListPage {
    pub items: Vec<BackendItem>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateBackendRequest {
    pub name: String,
    pub kind: BackendKind,
    #[serde(default)]
    pub description: String,
    #[schema(value_type = Object)]
    pub config: BackendConfig,
    pub path_prefixes: Vec<String>,
    pub auth_mode: AuthMode,
    pub ttl_secs: Option<i32>,
    pub stale_max_secs: Option<i32>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreateBackendResponse {
    pub id: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateBackendRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    #[schema(value_type = Option<Object>)]
    pub config: Option<BackendConfig>,
    pub path_prefixes: Option<Vec<String>>,
    pub auth_mode: Option<AuthMode>,
    pub ttl_secs: Option<i32>,
    pub stale_max_secs: Option<i32>,
    pub expected_backend_rev: String,
}

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct DeleteBackendQuery {
    pub force: Option<bool>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BackendCredentialRequest {
    #[schema(value_type = String)]
    pub value: SecretValue,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BackendTestRequest {
    pub locator: Option<String>,
}

/// Status only: never the value, its length, a hash, a provider version or provider text.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct BackendTestResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BackendGrants {
    #[serde(default)]
    pub see: Vec<String>,
    #[serde(rename = "use", default)]
    pub use_roles: Vec<String>,
    #[serde(default)]
    pub manage: Vec<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct BackendGrantsResponse {
    #[serde(flatten)]
    #[schema(schema_with = flattened_backend_grants_schema)]
    pub grants: BackendGrants,
    /// Roles whose requested add or removal did not take effect.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unapplied: Option<BackendGrants>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct BackendIdentityResponse {
    pub provider: BackendKind,
    pub state: String,
    pub principal: String,
    pub org_tag: String,
    pub external_id_or_subject: Option<String>,
    pub incarnation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_principal: Option<String>,
    pub switch_ready: Vec<String>,
    pub last_verified_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

store_enum!(TrustTemplateFormat {
    Cloudformation,
    Terraform,
});

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct TrustTemplateQuery {
    pub format: TrustTemplateFormat,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct TrustTemplateResponse {
    pub format: TrustTemplateFormat,
    pub template: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct IdentityAccepted {
    pub accepted: bool,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutBackendIdentityRequest {
    pub principal: String,
}

#[derive(Serialize, Deserialize, ToSchema, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct IdentityJobsQuery {
    pub state: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct IdentityJobsResponse {
    pub items: Vec<IdentityJobItem>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct IdentityJobItem {
    pub id: String,
    pub org_id: String,
    pub provider: String,
    pub r#gen: i64,
    pub did: String,
    pub state: String,
    pub attempts: i32,
    pub requested_by: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RetryIdentityRequest {
    #[serde(default)]
    pub force_switch: bool,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SecretErrorBody {
    pub code: SecretErrorCode,
    pub message: String,
}

pub fn parse_env_segment(env: &str) -> Result<&str, SecretErrorCode> {
    match env {
        "" | "global" => Err(SecretErrorCode::EnvIsOrgScope),
        _ => Ok(env),
    }
}

fn flattened_grants_schema() -> RefOr<Schema> {
    let mut schema = SecretGrants::schema();
    if let RefOr::T(Schema::Object(grants)) = &mut schema {
        // The flattened grants share an object with the response's optional unapplied field.
        grants.additional_properties = None;
    }
    schema
}

fn flattened_backend_grants_schema() -> RefOr<Schema> {
    let mut schema = BackendGrants::schema();
    if let RefOr::T(Schema::Object(grants)) = &mut schema {
        grants.additional_properties = None;
    }
    schema
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::secret_store::ORG_ENV_ID;

    #[test]
    fn org_store_status_defaults_and_round_trips_not_ready_reason() {
        let body = r#"{"mode":"single_cluster","region":"","store_ready":false,"fga":"on","can_create":false}"#;
        let mut status: OrgStoreStatus = serde_json::from_str(body).unwrap();
        assert!(status.not_ready_reason.is_empty());
        for reason in [
            "",
            "super_cluster",
            "refs_disabled",
            "fga_mode_mismatch",
            "upgrading",
        ] {
            status.not_ready_reason = reason.into();
            let json = serde_json::to_value(&status).unwrap();
            assert_eq!(json["not_ready_reason"], reason);
            assert!(json.get("not_ready").is_none());
            let back: OrgStoreStatus = serde_json::from_value(json).unwrap();
            assert_eq!(back.not_ready_reason, reason);
        }
    }

    #[test]
    fn secret_grants_revision_round_trips_and_defaults_for_older_requests() {
        let old: SecretGrants =
            serde_json::from_str(r#"{"see":["reader"],"use":["builder"]}"#).unwrap();
        assert!(old.expected_grants_rev.is_none());
        assert!(
            serde_json::to_value(&old)
                .unwrap()
                .get("expected_grants_rev")
                .is_none()
        );
        let grants: SecretGrants = serde_json::from_value(serde_json::json!({
            "see": ["reader"], "use": ["builder"], "manage": [], "manage_access": [],
            "expected_grants_rev": "previous"
        }))
        .unwrap();
        let response = SecretGrantsResponse {
            grants,
            grants_rev: "current".into(),
            unapplied: None,
        };
        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["expected_grants_rev"], "previous");
        assert_eq!(json["grants_rev"], "current");
        let back: SecretGrantsResponse = serde_json::from_value(json).unwrap();
        assert_eq!(back.grants.expected_grants_rev.as_deref(), Some("previous"));
        assert_eq!(back.grants.use_roles, ["builder"]);
        assert_eq!(back.grants_rev, "current");
    }

    #[test]
    fn env_segments_preserve_named_and_org_environments() {
        for env in [ORG_ENV_ID, "production"] {
            assert_eq!(parse_env_segment(env), Ok(env));
        }
        for env in ["", "global"] {
            assert_eq!(parse_env_segment(env), Err(SecretErrorCode::EnvIsOrgScope));
        }
    }

    #[test]
    fn backend_bodies_refuse_unknown_keys() {
        assert!(serde_json::from_str::<BackendGrants>(r#"{"manage_access":[]}"#).is_err());
        assert!(
            serde_json::from_str::<BackendCredentialRequest>(r#"{"value":"k","extra":1}"#).is_err()
        );
    }

    #[test]
    fn secret_grants_reject_reveal() {
        assert!(serde_json::from_str::<SecretGrants>(r#"{"reveal":[]}"#).is_err());
    }
}
