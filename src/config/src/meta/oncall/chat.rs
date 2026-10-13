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

#[cfg(test)]
mod tests {
    use super::*;

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
}
