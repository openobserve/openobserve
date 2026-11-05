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

//! Stopping the turn that runs in a chat session, whoever started it.

use std::time::Duration;

use o2_enterprise::enterprise::ai::{
    chat::registry::{self, CancelReason},
    client::{CancelBy, get_agent_client},
};

/// How long a cancel waits for o2-ai before stopping the turn on this node.
const UPSTREAM_CANCEL_WAIT: Duration = Duration::from_secs(5);
/// How long a turn may keep settling after o2-ai accepted its abort.
const CANCEL_GRACE: Duration = Duration::from_secs(15);

/// A cancel that o2-ai or this node took.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatCancel {
    pub cancelled: bool,
    pub active: bool,
}

/// A cancel that neither o2-ai nor this node took.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatCancelError {
    /// o2-ai refused it; its status and body, to relay as they are.
    Upstream { status: u16, body: String },
    /// o2-ai is not configured, failed or did not answer in time.
    Unanswered,
}

/// Asks o2-ai to abort first so the partial reply is still stored, else stops the turn here.
pub async fn cancel_chat_turn(
    org_id: &str,
    session_id: &str,
    auth_header: &str,
) -> Result<ChatCancel, ChatCancelError> {
    let upstream = match get_agent_client() {
        Some(client) => {
            let (org_id, session_id, auth) = (
                org_id.to_string(),
                session_id.to_string(),
                auth_header.to_string(),
            );
            let task = tokio::spawn(async move {
                client
                    .cancel_session(&session_id, &org_id, &auth, CancelBy::User)
                    .await
            });
            Some(tokio::time::timeout(UPSTREAM_CANCEL_WAIT, task).await)
        }
        None => None,
    };
    let answered = match upstream {
        Some(Ok(Ok(Ok(resp)))) => Some(resp),
        Some(Ok(Ok(Err(e)))) => {
            log::warn!("[AI-CHAT] failed to forward cancel for {session_id}: {e}");
            None
        }
        Some(Ok(Err(e))) => {
            log::error!("[AI-CHAT] cancel task for {session_id} failed: {e}");
            None
        }
        Some(Err(_)) => {
            log::warn!("[AI-CHAT] o2-ai did not answer the cancel for {session_id} in time");
            None
        }
        None => None,
    };
    match answered {
        Some(resp) if resp.status().is_success() => {
            let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
            let upstream_active = body.get("active").and_then(|v| v.as_bool()) == Some(true)
                || body.get("cancelled").and_then(|v| v.as_bool()) == Some(true);
            let stopped = if upstream_active {
                schedule_cancel_fallback(org_id, session_id);
                true
            } else {
                // o2-ai runs nothing for it, but this node may hold the turn (owner wait, restore).
                registry::cancel(org_id, session_id, CancelReason::User)
            };
            Ok(ChatCancel {
                cancelled: stopped,
                active: stopped,
            })
        }
        answered => {
            if registry::cancel(org_id, session_id, CancelReason::User) {
                return Ok(ChatCancel {
                    cancelled: true,
                    active: true,
                });
            }
            match answered {
                Some(resp) => {
                    let status = resp.status().as_u16();
                    let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
                    Err(ChatCancelError::Upstream { status, body })
                }
                None => Err(ChatCancelError::Unanswered),
            }
        }
    }
}

/// Stops the turn here if it is still running once o2-ai has had time to settle the abort.
fn schedule_cancel_fallback(org_id: &str, session_id: &str) {
    let Some(turn) = registry::get(org_id, session_id) else {
        return;
    };
    let (org_id, session_id) = (org_id.to_string(), session_id.to_string());
    tokio::spawn(async move {
        tokio::time::sleep(CANCEL_GRACE).await;
        registry::cancel_if(&org_id, &session_id, &turn.turn_id, CancelReason::User);
    });
}
