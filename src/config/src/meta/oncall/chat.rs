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

//! On-call in Slack: a page's message rows and a team's Slack room edits.

use serde::{Deserialize, Serialize};

use super::team::Team;
use crate::meta::slack::SlackInstallation;

/// What a message row stands for: the team room's message, a person's DM, or a fallback marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageKind {
    Room,
    Dm,
    Fallback,
}

impl ChatMessageKind {
    /// Durable storage id. **Never reorder or reuse.** [pure]
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Room => 1,
            Self::Dm => 2,
            Self::Fallback => 3,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know. [pure]
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
    /// Durable storage id. **Never reorder or reuse.** [pure]
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Queued => 1,
            Self::Sent => 2,
            Self::Failed => 3,
            Self::Done => 4,
        }
    }

    /// Reads a stored id; `None` for an id this build does not know. [pure]
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

/// One Slack message about a page: a room post, a DM, or the fallback marker (§10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub org_id: String,
    pub response_id: String,
    pub team_id: String,
    pub ladder_run: i32,
    /// `slack_installations.id` the message was posted through.
    pub installation_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub message_ts: Option<String>,
    #[serde(default)]
    pub permalink: Option<String>,
    pub kind: ChatMessageKind,
    /// A DM's recipient email.
    #[serde(default)]
    pub recipient: Option<String>,
    pub status: ChatMessageStatus,
    pub rendered: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What a team-channel save does to the team's Slack fields (RO-1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackRoomEdit {
    /// Leave every Slack field as it is.
    Keep,
    /// Store this same-room destination, or none.
    SameRoom(Option<String>),
    /// Empty the channel, its workspace and the same-room destination.
    Clear,
}

impl SlackRoomEdit {
    /// The edit a team-channel PUT asks for: an omitted destination keeps the stored one, a blank
    /// one unticks it, and a named one must be the team's. [pure]
    pub fn from_request(
        same_room: Option<String>,
        clear: bool,
        team_channel: &[String],
    ) -> Result<Self, SlackRoomEditError> {
        let same_room = same_room.map(|d| d.trim().to_string());
        match (same_room, clear) {
            (None, true) => Ok(Self::Clear),
            (Some(d), true) if d.is_empty() => Ok(Self::Clear),
            (Some(_), true) => Err(SlackRoomEditError::ClearWithDestination),
            (None, false) => Ok(Self::Keep),
            (Some(d), false) if d.is_empty() => Ok(Self::SameRoom(None)),
            (Some(d), false) if !team_channel.contains(&d) => {
                Err(SlackRoomEditError::ForeignDestination(d))
            }
            (Some(d), false) => Ok(Self::SameRoom(Some(d))),
        }
    }
}

/// Why a team-channel save's Slack part is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackRoomEditError {
    /// The same-room destination is not one of the team's webhook destinations.
    ForeignDestination(String),
    /// The save both clears the Slack channel and names a same-room destination.
    ClearWithDestination,
}

impl std::fmt::Display for SlackRoomEditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ForeignDestination(d) => {
                write!(f, "`{d}` is not one of this team's webhook destinations")
            }
            Self::ClearWithDestination => {
                f.write_str("clearing the Slack channel also clears the same-room destination")
            }
        }
    }
}

/// What the team-channel read and write show of the team's Slack channel (RO-1, RO-2); never its
/// workspace id.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct TeamSlackView {
    pub slack_channel_set: bool,
    /// Display only.
    pub slack_channel_name: Option<String>,
    /// Only while it is still one of the team's webhook destinations.
    pub slack_same_room_destination: Option<String>,
    /// Pages post in the channel through a Slack app installation serving the org.
    pub slack_native: bool,
    /// The org has an active Slack app installation.
    pub slack_connected: bool,
    /// SA-8 / RO-2: why pages cannot post in Slack.
    pub slack_unavailable_reason: Option<String>,
    /// RO-2: "Pages can't post to #{channel}: {reason}".
    pub slack_post_problem: Option<String>,
}

/// Where a team's page posts go now: its native Slack room, its webhooks, and the fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomPlan {
    pub native: Option<NativeRoom>,
    /// For stage posts and step broadcasts only; gap and L0 verdict posts keep the full list.
    pub stage_webhooks: Vec<String>,
    /// The same-room destination still in the team's list, used when the room cannot be posted to.
    pub fallback_destination: Option<String>,
}

/// The team's Slack channel, in a workspace an installation serving the org is in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeRoom {
    pub installation_id: String,
    pub channel_id: String,
    /// Display only.
    pub channel_name: Option<String>,
}

/// C6: the team's native room under `installation`, its stage webhooks and its fallback, over
/// the team's `destinations`. `installation` is the one `installation_for` matched to the
/// team's room, so the Slack app's team rule is applied once, there (D45). [pure]
pub fn room_plan(
    team: Option<&Team>,
    installation: Option<&SlackInstallation>,
    destinations: &[String],
) -> RoomPlan {
    let native = match (team, installation) {
        (Some(team), Some(inst)) => team.slack_channel_id.as_ref().map(|channel_id| NativeRoom {
            installation_id: inst.id.clone(),
            channel_id: channel_id.clone(),
            channel_name: team.slack_channel_name.clone(),
        }),
        _ => None,
    };
    // RO-1: a destination removed from the team's list since it was ticked no longer counts.
    let counted = team
        .and_then(|t| t.slack_same_room_destination.as_deref())
        .filter(|d| destinations.iter().any(|x| x == d));
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

    #[test]
    fn test_stored_ids_are_fixed_and_round_trip() {
        let kinds = [
            (ChatMessageKind::Room, 1),
            (ChatMessageKind::Dm, 2),
            (ChatMessageKind::Fallback, 3),
        ];
        for (v, id) in kinds {
            assert_eq!((v.to_i32(), ChatMessageKind::from_i32(id)), (id, Some(v)));
        }
        let statuses = [
            (ChatMessageStatus::Queued, 1),
            (ChatMessageStatus::Sent, 2),
            (ChatMessageStatus::Failed, 3),
            (ChatMessageStatus::Done, 4),
        ];
        for (v, id) in statuses {
            assert_eq!((v.to_i32(), ChatMessageStatus::from_i32(id)), (id, Some(v)));
        }
        assert_eq!(ChatMessageKind::from_i32(0), None);
        assert_eq!(ChatMessageStatus::from_i32(0), None);
    }

    fn installation(team_id: &str) -> SlackInstallation {
        SlackInstallation {
            id: "inst_1".into(),
            team_id: team_id.into(),
            ..Default::default()
        }
    }

    fn team(workspace: Option<&str>, channel: Option<&str>, same: Option<&str>) -> Team {
        Team {
            id: "t1".into(),
            org_id: "acme".into(),
            name: "Payments".into(),
            timezone: "UTC".into(),
            description: None,
            channel_destinations: None,
            slack_enterprise_id: None,
            slack_workspace_id: workspace.map(str::to_string),
            slack_channel_id: channel.map(str::to_string),
            slack_channel_name: channel.map(|_| "pay".to_string()),
            slack_same_room_destination: same.map(str::to_string),
            created_at: 1,
            updated_at: 1,
        }
    }

    /// C6, RO-3: a native room only in the serving installation's workspace; the same-room
    /// webhook leaves the stage posts only then, and counts only while it is the team's.
    #[test]
    fn test_room_plan_strips_the_same_room_destination_only_with_a_native_room() {
        let t1 = installation("T1");
        let native = Some(NativeRoom {
            installation_id: "inst_1".to_string(),
            channel_id: "C1".to_string(),
            channel_name: Some("pay".to_string()),
        });
        // (case, team workspace, team channel, installation, expected native)
        let rooms = [
            ("match", Some("T1"), Some("C1"), Some(&t1), native),
            ("no installation", Some("T1"), Some("C1"), None, None),
            ("no channel", Some("T1"), None, Some(&t1), None),
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
                let t = team(*workspace, *channel, stored);
                let plan = room_plan(Some(&t), *inst, &list);
                let stage_webhooks = match (native, counted) {
                    (Some(_), Some(_)) => vec!["pagerduty".to_string()],
                    _ => list.clone(),
                };
                let want = RoomPlan {
                    native: native.clone(),
                    stage_webhooks,
                    fallback_destination: counted.map(str::to_string),
                };
                assert_eq!(plan, want, "{room} / {dest_case}");
            }
        }
        let no_team = room_plan(None, Some(&t1), &list);
        assert_eq!((no_team.native, no_team.stage_webhooks), (None, list));
    }

    /// RO-1: a same-room destination must be one of the team's webhooks; clear empties it too.
    #[test]
    fn test_slack_room_edit_accepts_only_the_teams_own_destinations() {
        use SlackRoomEdit as E;
        use SlackRoomEditError as X;
        let list = vec!["slack-old".to_string(), "pagerduty".to_string()];
        let same = |d: &str| Ok(E::SameRoom(Some(d.to_string())));
        // (case, requested destination, clear, outcome)
        let cases = [
            ("own", Some("slack-old"), false, same("slack-old")),
            ("trimmed", Some(" pagerduty "), false, same("pagerduty")),
            ("omitted keeps", None, false, Ok(E::Keep)),
            ("blank unticks", Some("  "), false, Ok(E::SameRoom(None))),
            (
                "foreign",
                Some("elsewhere"),
                false,
                Err(X::ForeignDestination("elsewhere".to_string())),
            ),
            ("clear", None, true, Ok(E::Clear)),
            (
                "clear with one",
                Some("slack-old"),
                true,
                Err(X::ClearWithDestination),
            ),
        ];
        for (case, requested, clear, want) in cases {
            let got = SlackRoomEdit::from_request(requested.map(str::to_string), clear, &list);
            assert_eq!(got, want, "{case}");
        }
    }
}
