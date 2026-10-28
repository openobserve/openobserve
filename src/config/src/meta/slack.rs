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
use utoipa::ToSchema;

use crate::meta::alerts::{ack::AckView, incidents::IncidentStatus, level::AlertLevel};

/// The cluster-local stream that carries alert messages to the Slack leader.
pub const SLACK_OUTBOUND_TOPIC: &str = "slack_outbound";

pub const ALERT_SLACK_EVENT_VERSION: u8 = 1;

/// The largest `slack_alert_messages.content` the table stores, in bytes of JSON.
pub const SLACK_ALERT_MESSAGE_CONTENT_MAX_BYTES: usize = 16 * 1024;

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
    /// An alert message's thread: every reply needs a mention, nobody owns the session.
    Alert,
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
    MasterKey,
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
    /// Alert messages waiting for Slack; absent until the leader reports it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outbound_depth: Option<u32>,
    /// Age of the oldest waiting alert message, computed when read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outbound_oldest_age_secs: Option<i64>,
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
    /// The installation's manual list, sent only under `mapping`, where it governs unmapped orgs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manual_domains: Vec<String>,
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
    /// A button click held until the user links (spec 8.2 step 3); Not now drops it.
    pub held_action: Option<HeldAction>,
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
    /// Set when the org stopped being served here: the row answers nothing, one reply gets a note.
    #[serde(default)]
    pub org_removed_at: Option<i64>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertSlackEventKind {
    Fire,
    Repeat,
    LevelUp,
    Refresh,
    Recovered,
    Post,
    Test,
}

/// The rendered template of a notification, as it travels to the Slack leader.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RenderedWire {
    pub title: String,
    pub body: String,
    pub fields: Vec<(String, String)>,
    pub links: Vec<(String, String)>,
    pub open_url: String,
}

/// One message on the `slack_outbound` stream; the consumer re-reads the truth, never this payload.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertSlackEvent {
    pub v: u8,
    pub kind: AlertSlackEventKind,
    pub destination_id: String,
    pub org_id: String,
    pub alert_id: String,
    #[serde(default)]
    pub group_key: String,
    pub firing_started_at: i64,
    #[serde(default)]
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered: Option<RenderedWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart_png_b64: Option<String>,
    pub level: AlertLevel,
    pub at: i64,
}

/// The `slack_alert_messages.content` JSON, kept so a re-render can rebuild the message.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SlackMessageContent {
    pub rendered: RenderedWire,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_file_id: Option<String>,
    /// Repeat replies posted so far; the next one says "Repeat n+1".
    pub repeats: u32,
    /// The window of the last send shown, so a redelivered event is not shown twice.
    pub seq: u64,
    /// The level the message last showed, the `from` of the next level-up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<AlertLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escalated_from: Option<(AlertLevel, i64)>,
    /// The Slack error that ended the row as `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageState {
    #[default]
    Firing,
    Acked,
    Muted,
    Cleared,
    Gone,
    /// Slack refused the post or edit for good (the channel or message is gone); nothing retries
    /// it.
    Failed,
}

impl MessageState {
    pub const OPEN: [MessageState; 3] = [Self::Firing, Self::Acked, Self::Muted];
    pub const TERMINAL: [MessageState; 3] = [Self::Cleared, Self::Gone, Self::Failed];
}

/// The unique key of a `slack_alert_messages` row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SlackAlertMessageKey {
    pub destination_id: String,
    pub alert_id: String,
    pub group_key: String,
    pub firing_started_at: i64,
}

/// One `slack_alert_messages` row: the Slack message of one firing on one destination.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackAlertMessage {
    pub destination_id: String,
    pub org_id: String,
    pub alert_id: String,
    pub group_key: String,
    pub firing_started_at: i64,
    pub installation_id: String,
    pub channel_id: String,
    pub message_ts: Option<String>,
    pub digest_ts: Option<String>,
    pub reuses_firing_started_at: Option<i64>,
    pub refire_count: i32,
    pub first_fired_at: i64,
    pub state: MessageState,
    pub wanted_seq: i64,
    pub rendered_seq: i64,
    pub pending_since: Option<i64>,
    pub posting_since: Option<i64>,
    pub last_auto_investigated_at: Option<i64>,
    pub content: Option<SlackMessageContent>,
    pub created_at: i64,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

impl SlackAlertMessage {
    pub fn key(&self) -> SlackAlertMessageKey {
        SlackAlertMessageKey {
            destination_id: self.destination_id.clone(),
            alert_id: self.alert_id.clone(),
            group_key: self.group_key.clone(),
            firing_started_at: self.firing_started_at,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoneKind {
    GroupUntracked,
    GroupLimit,
    AlertDeleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertMessagePhase {
    Firing,
    Cleared,
    Gone(GoneKind),
    Disabled { by: String, at: i64 },
}

/// A live mute of the firing; `groups` empty means every group of the alert.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MuteView {
    pub downtime_id: String,
    pub version: i64,
    pub ends_at: i64,
    #[serde(default)]
    pub until_clear: bool,
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended_by: Option<String>,
    #[serde(default)]
    pub groups: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageIncident {
    pub id: String,
    pub label: String,
    pub status: IncidentStatus,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagePage {
    pub response_ids: Vec<String>,
    pub team: String,
    pub step: u32,
    pub of: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalates_at: Option<i64>,
}

/// What an alert message shows, read from the current truth at render time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertMessageView {
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: String,
    #[serde(default)]
    pub group_labels: Vec<(String, String)>,
    pub firing_started_at: i64,
    pub level: AlertLevel,
    pub phase: AlertMessagePhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ack: Option<AckView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mute: Option<MuteView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incident: Option<MessageIncident>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<MessagePage>,
    #[serde(default)]
    pub other_groups_unacked: u32,
    pub alert_enabled: bool,
    pub downtimes_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runbook_url: Option<String>,
    pub open_url: String,
}

/// A button click held for an unlinked user, stored as `slack_link_requests.held_action` JSON.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldAction {
    pub action: String,
    pub ref_key: String,
    /// The element's value as Slack sent it: the ref id, or a menu pick prefixed to it.
    #[serde(default)]
    pub value: String,
    pub firing_started_at: i64,
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
    fn disabled_reasons_are_the_four_v1_strings() {
        for r in ["edition", "flag", "master_key", "super_cluster"] {
            let parsed: DisabledReason = serde_json::from_str(&format!("\"{r}\"")).unwrap();
            assert_eq!(serde_json::to_string(&parsed).unwrap(), format!("\"{r}\""));
        }
        for gone in ["allowlist", "home_region_unset", "other_region"] {
            assert!(
                serde_json::from_str::<DisabledReason>(&format!("\"{gone}\"")).is_err(),
                "{gone}"
            );
        }
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

    #[test]
    fn an_alert_event_round_trips_and_an_older_one_decodes() {
        let event = AlertSlackEvent {
            v: ALERT_SLACK_EVENT_VERSION,
            kind: AlertSlackEventKind::LevelUp,
            destination_id: "d1".into(),
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: "k".into(),
            firing_started_at: 10,
            seq: 3,
            rendered: Some(RenderedWire {
                title: "CPU high".into(),
                body: "b".into(),
                fields: vec![("host".into(), "h1".into())],
                links: vec![("Runbook".into(), "https://r".into())],
                open_url: "https://o2/alerts/a1".into(),
            }),
            chart_png_b64: None,
            level: AlertLevel::Critical,
            at: 11,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["kind"], "level_up");
        assert_eq!(json["level"], "critical");
        assert!(json.get("chart_png_b64").is_none());
        assert_eq!(
            serde_json::from_value::<AlertSlackEvent>(json).unwrap(),
            event
        );
        let old: AlertSlackEvent = serde_json::from_value(serde_json::json!({
            "v": 1, "kind": "refresh", "destination_id": "d1", "org_id": "acme",
            "alert_id": "a1", "firing_started_at": 10, "level": "warning", "at": 11,
            "added_later": {"x": 1},
        }))
        .unwrap();
        assert_eq!(old.group_key, "");
        assert_eq!(old.seq, 0);
        assert!(old.rendered.is_none());
        assert_eq!(SLACK_OUTBOUND_TOPIC, "slack_outbound");
    }

    #[test]
    fn message_states_and_phases_use_snake_case() {
        for (state, text) in [
            (MessageState::Firing, "firing"),
            (MessageState::Acked, "acked"),
            (MessageState::Muted, "muted"),
            (MessageState::Cleared, "cleared"),
            (MessageState::Gone, "gone"),
            (MessageState::Failed, "failed"),
        ] {
            assert_eq!(serde_json::to_value(state).unwrap(), text);
        }
        assert_eq!(
            serde_json::to_value(AlertMessagePhase::Gone(GoneKind::GroupLimit)).unwrap(),
            serde_json::json!({"gone": "group_limit"})
        );
        assert_eq!(
            serde_json::to_value(AlertMessagePhase::Disabled {
                by: "a@b.c".into(),
                at: 5
            })
            .unwrap(),
            serde_json::json!({"disabled": {"by": "a@b.c", "at": 5}})
        );
        assert_eq!(
            serde_json::to_value(AlertMessagePhase::Firing).unwrap(),
            "firing"
        );
    }

    #[test]
    fn held_actions_and_content_decode_old_and_new_shapes() {
        let held: HeldAction = serde_json::from_str(
            r#"{"action":"o2_alert_ack","ref_key":"r1","firing_started_at":7,"minutes":30}"#,
        )
        .unwrap();
        assert_eq!(held.ref_key, "r1");
        assert_eq!(held.firing_started_at, 7);
        let content: SlackMessageContent =
            serde_json::from_str(r#"{"rendered":{"title":"t"}}"#).unwrap();
        assert_eq!(content.rendered.title, "t");
        assert!(content.rendered.fields.is_empty());
        assert!(content.chart_file_id.is_none());
        let view: MuteView =
            serde_json::from_str(r#"{"downtime_id":"d1","version":1,"ends_at":9,"by":"a@b.c"}"#)
                .unwrap();
        assert!(!view.until_clear && view.groups.is_empty());
    }

    #[test]
    fn content_keeps_what_the_leader_needs_for_later_renders() {
        let old: SlackMessageContent =
            serde_json::from_str(r#"{"rendered":{"title":"t"},"chart_file_id":"F1"}"#).unwrap();
        assert_eq!((old.repeats, old.seq), (0, 0));
        assert!(old.level.is_none() && old.escalated_from.is_none());
        let content = SlackMessageContent {
            repeats: 3,
            seq: 9,
            level: Some(AlertLevel::Critical),
            escalated_from: Some((AlertLevel::Warning, 7)),
            ..Default::default()
        };
        let json = serde_json::to_value(&content).unwrap();
        assert_eq!(json["repeats"], 3);
        assert_eq!(json["level"], "critical");
        assert_eq!(json["escalated_from"], serde_json::json!(["warning", 7]));
        assert_eq!(
            serde_json::from_value::<SlackMessageContent>(json).unwrap(),
            content
        );
        let fresh = serde_json::to_value(SlackMessageContent::default()).unwrap();
        assert!(fresh.get("level").is_none() && fresh.get("escalated_from").is_none());
    }

    #[test]
    fn health_serves_the_outbound_names_the_web_reads() {
        let quiet = serde_json::to_value(InstallationHealth::default()).unwrap();
        assert!(
            quiet.get("outbound_depth").is_none(),
            "the web hides the line while absent"
        );
        assert!(quiet.get("outbound_oldest_age_secs").is_none());
        let busy = InstallationHealth {
            outbound_depth: Some(3),
            outbound_oldest_age_secs: Some(42),
            ..Default::default()
        };
        let json = serde_json::to_value(&busy).unwrap();
        assert_eq!(json["outbound_depth"], 3);
        assert_eq!(json["outbound_oldest_age_secs"], 42);
        let old: InstallationHealth =
            serde_json::from_str(r#"{"sockets_up":1,"sockets_want":1,"nodes":1}"#).unwrap();
        assert_eq!(old.outbound_depth, None);
        assert_eq!(old.outbound_oldest_age_secs, None);
    }
}
