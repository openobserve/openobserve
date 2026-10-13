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

//! Chat-platform rows: an org's install, a person's link, and one message per page post.

use serde::{Deserialize, Serialize};

/// The chat platform a row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatPlatform {
    Slack,
}

impl ChatPlatform {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Slack => 1,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know.
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Slack),
            _ => None,
        }
    }
}

/// Whether an install's bot token still works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallStatus {
    Active,
    Revoked,
}

impl InstallStatus {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Active => 1,
            Self::Revoked => 2,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know.
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Active),
            2 => Some(Self::Revoked),
            _ => None,
        }
    }
}

/// What a message row stands for: the team room's message, a person's DM, or a fallback marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageKind {
    Room,
    Dm,
    Fallback,
}

impl ChatMessageKind {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Room => 1,
            Self::Dm => 2,
            Self::Fallback => 3,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know.
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Room),
            2 => Some(Self::Dm),
            3 => Some(Self::Fallback),
            _ => None,
        }
    }
}

/// Where a message row is in its life: waiting to send, sent, given up on, or final.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageStatus {
    Queued,
    Sent,
    Failed,
    Done,
}

impl ChatMessageStatus {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Queued => 1,
            Self::Sent => 2,
            Self::Failed => 3,
            Self::Done => 4,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know.
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Queued),
            2 => Some(Self::Sent),
            3 => Some(Self::Failed),
            4 => Some(Self::Done),
            _ => None,
        }
    }
}

/// One org's connection to one chat workspace; the bot token is stored only encrypted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatInstall {
    pub id: String,
    pub org_id: String,
    pub platform: ChatPlatform,
    pub workspace_id: String,
    pub workspace_name: String,
    #[serde(default)]
    pub enterprise_id: Option<String>,
    pub app_id: String,
    pub bot_user_id: String,
    pub bot_token_cipher: String,
    pub scopes: String,
    pub status: InstallStatus,
    pub installed_by: String,
    pub installed_at: i64,
    pub updated_at: i64,
}

/// One person's link between their chat-platform user and their OpenObserve email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatIdentity {
    pub id: String,
    pub org_id: String,
    pub platform: ChatPlatform,
    pub workspace_id: String,
    pub platform_user_id: String,
    #[serde(default)]
    pub enterprise_user_id: Option<String>,
    pub user_email: String,
    pub linked_at: i64,
    #[serde(default)]
    pub unlinked_at: Option<i64>,
    pub changed_at: i64,
}

/// One chat message about a page: a room post, a DM, or a fallback marker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub org_id: String,
    pub response_id: String,
    pub team_id: String,
    pub ladder_run: i32,
    pub platform: ChatPlatform,
    pub workspace_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub message_ts: Option<String>,
    #[serde(default)]
    pub permalink: Option<String>,
    pub kind: ChatMessageKind,
    #[serde(default)]
    pub recipient: Option<String>,
    pub status: ChatMessageStatus,
    pub rendered: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Where a team's page posts go right now: its native Slack room, its webhooks, and the fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomPlan {
    pub native: Option<NativeRoom>,
    /// For stage posts and step broadcasts only; gap and L0 verdict posts keep the full list.
    pub stage_webhooks: Vec<String>,
    /// The same-room destination still in the team's list, used when the room cannot be posted to.
    pub fallback_destination: Option<String>,
}

/// The team's Slack channel in the org's connected workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeRoom {
    pub workspace_id: String,
    pub channel_id: String,
    /// Display only.
    pub channel_name: Option<String>,
}

/// Whether this deployment offers Slack to orgs, as `/config` reports it (IN-2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackAvailability {
    Off,
    /// Set up, but bot tokens cannot be stored until the operator sets the master key.
    NeedsKey,
    On,
}

impl SlackAvailability {
    /// Off unless on-call is on and the Slack app is set; then on only while encrypting. [pure]
    pub fn of(oncall_enabled: bool, slack_set: bool, encrypting: bool) -> Self {
        match (oncall_enabled && slack_set, encrypting) {
            (false, _) => Self::Off,
            (true, false) => Self::NeedsKey,
            (true, true) => Self::On,
        }
    }
}

/// Decides the team's native room, stage webhooks and fallback from its stored Slack fields. [pure]
pub fn room_plan(
    team_workspace_id: Option<&str>,
    team_channel_id: Option<&str>,
    team_channel_name: Option<&str>,
    same_room_destination: Option<&str>,
    install: Option<&ChatInstall>,
    destinations: &[String],
) -> RoomPlan {
    let native = match (install, team_workspace_id, team_channel_id) {
        (Some(install), Some(workspace_id), Some(channel_id))
            if install.status == InstallStatus::Active && install.workspace_id == workspace_id =>
        {
            Some(NativeRoom {
                workspace_id: workspace_id.to_string(),
                channel_id: channel_id.to_string(),
                channel_name: team_channel_name.map(str::to_string),
            })
        }
        _ => None,
    };
    // RO-1: a destination removed from the team's list since it was ticked no longer counts.
    let counted = same_room_destination.filter(|d| destinations.iter().any(|x| x == d));
    let stage_webhooks = match (&native, counted) {
        (Some(_), Some(same_room)) => destinations
            .iter()
            .filter(|d| *d != same_room)
            .cloned()
            .collect(),
        _ => destinations.to_vec(),
    };
    RoomPlan {
        native,
        stage_webhooks,
        fallback_destination: counted.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // An install of workspace `T1` in `status`.
    fn install(status: InstallStatus) -> ChatInstall {
        ChatInstall {
            id: "i1".to_string(),
            org_id: "default".to_string(),
            platform: ChatPlatform::Slack,
            workspace_id: "T1".to_string(),
            workspace_name: "Acme".to_string(),
            enterprise_id: None,
            app_id: "A1".to_string(),
            bot_user_id: "U0".to_string(),
            bot_token_cipher: "x".to_string(),
            scopes: "chat:write".to_string(),
            status,
            installed_by: "ann@o2.ai".to_string(),
            installed_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn test_room_plan_strips_the_same_room_destination_only_with_a_native_room() {
        let active = install(InstallStatus::Active);
        let revoked = install(InstallStatus::Revoked);
        let native = Some(NativeRoom {
            workspace_id: "T1".to_string(),
            channel_id: "C1".to_string(),
            channel_name: Some("pay".to_string()),
        });
        // (case, team workspace, team channel, install, expected native)
        let rooms = [
            ("match", Some("T1"), Some("C1"), Some(&active), native),
            (
                "workspace mismatch",
                Some("T2"),
                Some("C1"),
                Some(&active),
                None,
            ),
            ("revoked", Some("T1"), Some("C1"), Some(&revoked), None),
            ("no install", Some("T1"), Some("C1"), None, None),
            ("no channel", Some("T1"), None, Some(&active), None),
        ];
        let list = vec!["slack-old".to_string(), "pagerduty".to_string()];
        // (case, stored same-room destination, the counted one)
        let destinations = [
            ("present", Some("slack-old"), Some("slack-old")),
            ("left the list", Some("gone"), None),
            ("absent", None, None),
        ];
        for (room, workspace, channel, inst, native) in &rooms {
            for (dest_case, stored, counted) in destinations {
                let plan = room_plan(*workspace, *channel, Some("pay"), stored, *inst, &list);
                let stage_webhooks = match (native, counted) {
                    (Some(_), Some(_)) => vec!["pagerduty".to_string()],
                    _ => list.clone(),
                };
                let expected = RoomPlan {
                    native: native.clone(),
                    stage_webhooks,
                    fallback_destination: counted.map(str::to_string),
                };
                assert_eq!(plan, expected, "{room} / {dest_case}");
            }
        }
        let unnamed = room_plan(Some("T1"), Some("C1"), None, None, Some(&active), &list);
        assert_eq!(unnamed.native.map(|n| n.channel_name), Some(None));
    }

    #[test]
    fn test_stored_ids_are_fixed_and_round_trip() {
        let platforms = [(ChatPlatform::Slack, 1)];
        for (v, id) in platforms {
            assert_eq!((v.to_i32(), ChatPlatform::from_i32(id)), (id, Some(v)));
        }
        let statuses = [(InstallStatus::Active, 1), (InstallStatus::Revoked, 2)];
        for (v, id) in statuses {
            assert_eq!((v.to_i32(), InstallStatus::from_i32(id)), (id, Some(v)));
        }
        let kinds = [
            (ChatMessageKind::Room, 1),
            (ChatMessageKind::Dm, 2),
            (ChatMessageKind::Fallback, 3),
        ];
        for (v, id) in kinds {
            assert_eq!((v.to_i32(), ChatMessageKind::from_i32(id)), (id, Some(v)));
        }
        let message_statuses = [
            (ChatMessageStatus::Queued, 1),
            (ChatMessageStatus::Sent, 2),
            (ChatMessageStatus::Failed, 3),
            (ChatMessageStatus::Done, 4),
        ];
        for (v, id) in message_statuses {
            assert_eq!((v.to_i32(), ChatMessageStatus::from_i32(id)), (id, Some(v)));
        }
        assert_eq!(ChatPlatform::from_i32(0), None);
        assert_eq!(InstallStatus::from_i32(0), None);
        assert_eq!(ChatMessageKind::from_i32(0), None);
        assert_eq!(ChatMessageStatus::from_i32(0), None);
    }

    #[test]
    fn test_slack_availability_needs_oncall_the_app_and_the_master_key() {
        use SlackAvailability as A;
        let cases = [
            (false, false, false, A::Off, "off"),
            (false, true, true, A::Off, "off"),
            (true, false, true, A::Off, "off"),
            (true, true, false, A::NeedsKey, "needs_key"),
            (true, true, true, A::On, "on"),
        ];
        for (oncall, slack, encrypting, want, wire) in cases {
            let got = SlackAvailability::of(oncall, slack, encrypting);
            assert_eq!(got, want, "{oncall} {slack} {encrypting}");
            assert_eq!(serde_json::to_value(got).unwrap(), wire);
        }
    }
}
