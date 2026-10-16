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

pub mod bridge_error_codes {
    pub const SESSION_OWNER_UNAVAILABLE: &str = "session_owner_unavailable";
    pub const SESSION_NOT_FOUND: &str = "session_not_found";
    pub const TURN_ALREADY_RUNNING: &str = "turn_already_running";
}

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Consumer email domains: never a link domain, and they turn automatic linking off at install.
pub const PUBLIC_EMAIL_DOMAINS: &[&str] = &[
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "live.com",
    "msn.com",
    "mail.com",
    "zoho.com",
    "yandex.com",
    "gmx.com",
    "me.com",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Http,
    #[default]
    Socket,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LinkMethod {
    #[default]
    Oidc,
    Email,
    AdminBulk,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RevokedReason {
    Unlinked,
    UserRemoved,
    SlackUserDeleted,
    EmailChanged,
    Uninstalled,
    BotTokensRevoked,
    OrgDeleted,
    OrgRemoved,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnswerMode {
    #[default]
    Thread,
    Private,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ThreadKind {
    #[default]
    Question,
    Link,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SetFrom {
    #[default]
    Settings,
    Install,
    Destination,
}

/// The `slack_disabled_reason` value of the org config response.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DisabledReason {
    Edition,
    Flag,
    Allowlist,
    MasterKey,
    HomeRegionUnset,
    OtherRegion,
    SuperCluster,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InstallationStatus {
    #[default]
    Pending,
    Revoked,
    Degraded,
    Healthy,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppTokenState {
    #[default]
    NotApplicable,
    Missing,
    Ok,
    Revoked,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LinkingSource {
    Mapping,
    #[default]
    Manual,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InstallScope {
    #[default]
    Org,
    Instance,
}

/// `""` on org workspaces; an instance workspace is `all` or `listed`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrgAccess {
    #[default]
    #[serde(rename = "")]
    Unset,
    All,
    Listed,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionSource {
    #[default]
    Org,
    Instance,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ManifestOptions {
    pub app_name: String,
    pub channel_history: bool,
    pub command: String,
}

/// A `slack_installations` row; secrets are plaintext here and encrypted only inside the table ops.
#[derive(Clone, Default, PartialEq)]
pub struct SlackInstallation {
    pub id: String,
    pub app_id: String,
    pub enterprise_id: String,
    pub team_id: String,
    pub team_name: String,
    pub is_enterprise_install: bool,
    pub bot_user_id: Option<String>,
    pub bot_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub signing_secret: Option<String>,
    pub app_token: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub config_refresh_token: Option<String>,
    pub manifest_options: ManifestOptions,
    pub auto_link_enabled: bool,
    pub auto_link_domains: Vec<String>,
    pub mode: Mode,
    pub scope: InstallScope,
    pub org_access: OrgAccess,
    pub home_region: String,
    pub installed_by: String,
    pub installed_org_id: String,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
    /// False when a stored `*_enc` fails to decrypt (lost or replaced `_meta` DEK or master key).
    pub credentials_readable: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ThisOrgConnection {
    pub connected_by: String,
    pub created_at: i64,
    pub destination_count: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationHealth {
    pub sockets_up: u32,
    pub sockets_want: u32,
    pub nodes: u32,
    pub last_event_at: Option<i64>,
    pub as_of: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationView {
    pub id: String,
    pub app_id: String,
    pub team_id: String,
    pub team_name: String,
    pub enterprise_id: String,
    pub is_enterprise_install: bool,
    pub mode: Mode,
    pub home_region: String,
    pub status: InstallationStatus,
    pub credentials_readable: bool,
    pub has_config_refresh_token: bool,
    pub app_token_state: AppTokenState,
    pub this_org: ThisOrgConnection,
    pub other_connected_orgs: u64,
    pub health: InstallationHealth,
    pub created_at: i64,
    pub scope: InstallScope,
    pub managed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_access: Option<OrgAccess>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_help_contact: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LinkingSummary {
    pub enabled: bool,
    pub source: LinkingSource,
    pub domains: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InstallationSummary {
    pub id: String,
    pub team_name: String,
    pub status: InstallationStatus,
    pub linking: LinkingSummary,
}

/// Counts cover only members of the calling org.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LinkCounts {
    pub email: u64,
    pub oidc: u64,
    pub admin_bulk: u64,
    pub matches_not_linked: u64,
    pub skipped_domain: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LinkingView {
    pub enabled: bool,
    pub source: LinkingSource,
    pub domains: Vec<String>,
    pub counts: LinkCounts,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalIdentityLink {
    pub id: String,
    pub provider: String,
    pub installation_id: String,
    pub external_enterprise_id: String,
    pub external_team_id: String,
    pub external_user_id: String,
    pub user_email: String,
    pub default_org_id: String,
    pub link_method: LinkMethod,
    pub created_at: i64,
    pub last_used_at: i64,
    pub revoked_at: Option<i64>,
    pub revoked_reason: Option<RevokedReason>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

/// A `slack_link_requests` row; `question` is plaintext here and stored as `question_enc`.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct SlackLinkRequest {
    pub id: String,
    pub installation_id: String,
    pub external_user_id: String,
    pub workspace_user_id: String,
    pub channel_id: Option<String>,
    pub thread_ts: Option<String>,
    pub message_ts: Option<String>,
    pub question: Option<String>,
    pub oidc_nonce: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub redeemed_at: Option<i64>,
    pub discarded_at: Option<i64>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackOrgConnection {
    pub installation_id: String,
    pub org_id: String,
    pub connected_by: String,
    pub help_contact: Option<String>,
    pub source: ConnectionSource,
    pub created_at: i64,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackChannelDefault {
    pub installation_id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub org_id: String,
    pub answer_mode: AnswerMode,
    pub set_from: SetFrom,
    pub updated_by: String,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SlackThreadKey {
    pub installation_id: String,
    pub channel_id: String,
    pub thread_ts: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SharedUrl {
    pub message_ts: String,
    pub url: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotAnswer {
    pub ts: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackThread {
    pub installation_id: String,
    pub channel_id: String,
    pub thread_ts: String,
    pub org_id: String,
    pub kind: ThreadKind,
    pub assistant_session_id: String,
    pub started_by_link_id: Option<String>,
    pub shared_urls: Vec<SharedUrl>,
    pub bot_answers: Vec<BotAnswer>,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub expires_at: i64,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_scope_and_access_serialize_as_the_columns_store_them() {
        assert_eq!(
            serde_json::to_string(&InstallScope::Instance).unwrap(),
            "\"instance\""
        );
        assert_eq!(serde_json::to_string(&OrgAccess::Unset).unwrap(), "\"\"");
        assert_eq!(
            serde_json::from_str::<OrgAccess>("\"listed\"").unwrap(),
            OrgAccess::Listed
        );
        assert_eq!(ConnectionSource::default(), ConnectionSource::Org);
        assert_eq!(
            serde_json::to_string(&RevokedReason::OrgRemoved).unwrap(),
            "\"org_removed\""
        );
        assert_eq!(
            serde_json::to_string(&DisabledReason::SuperCluster).unwrap(),
            "\"super_cluster\""
        );
    }

    #[test]
    fn a_view_carries_org_access_and_the_instance_contact_only_when_set() {
        let v = InstallationView::default();
        let json = serde_json::to_value(&v).unwrap();
        assert!(json.get("org_access").is_none());
        assert!(json.get("instance_help_contact").is_none());
        assert_eq!(json["scope"], "org");
        assert_eq!(json["managed"], false);
    }
}
