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

//! Cluster-visible marks of a turn: whose turn runs a session, and what it asked to confirm.

use config::utils::time::now_micros;
use infra::table::ai_turn_marks::{self, KIND_CONFIRMATION, KIND_TURN, NewMark};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde_json::Value;

const MICROS_PER_SEC: i64 = 1_000_000;
const TURN_GRACE_SECS: i64 = 60;
// A pending delete outlives its turn in o2-ai, so its confirmation may come this much later.
const CONFIRMATION_TTL_SECS: i64 = 3600;
const CONFIRMATION_REQUIRED: &str = "confirmation_required";

/// The mark of one running turn; dropping it at the turn's end removes the mark.
pub(crate) struct TurnMark {
    release: Option<Box<dyn FnOnce() + Send>>,
}

impl TurnMark {
    /// A mark that runs `release` when dropped.
    pub(crate) fn new(release: impl FnOnce() + Send + 'static) -> Self {
        Self {
            release: Some(Box::new(release)),
        }
    }

    fn unwritten() -> Self {
        Self { release: None }
    }
}

impl Drop for TurnMark {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            release();
        }
    }
}

/// Records each `confirmation_required` frame's tool, so `/confirm` grants only what was asked.
pub(crate) struct ConfirmationWatch {
    org_id: String,
    session_id: String,
    user_email: String,
}

impl ConfirmationWatch {
    pub(crate) fn new(org_id: &str, session_id: &str, user_email: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            user_email: user_email.to_string(),
        }
    }

    /// Returns at once; the marks are written in the background.
    pub(crate) fn note(&self, chunk: &[u8]) {
        for tool in confirmation_tools(chunk) {
            let (org_id, session_id) = (self.org_id.clone(), self.session_id.clone());
            let user_email = self.user_email.clone();
            tokio::spawn(async move {
                let now = now_micros();
                let mark = NewMark {
                    org_id: &org_id,
                    session_id: &session_id,
                    user_email: &user_email,
                    kind: KIND_CONFIRMATION,
                    value: Some(&tool),
                    expires_at: now + CONFIRMATION_TTL_SECS * MICROS_PER_SEC,
                };
                if let Err(e) = ai_turn_marks::insert(&mark, now).await {
                    log::warn!("[org_id:{org_id}] confirmation of {tool} not recorded: {e}");
                }
            });
        }
    }
}

/// Marks that `user_email`'s turn runs `session_id`; a mark that fails to write only loses rows.
pub(crate) async fn mark_turn(org_id: &str, session_id: &str, user_email: &str) -> TurnMark {
    let now = now_micros();
    let max_turn = get_o2_config().ai.chat_max_turn_secs.max(60) as i64;
    let mark = NewMark {
        org_id,
        session_id,
        user_email,
        kind: KIND_TURN,
        value: None,
        expires_at: now + (max_turn + TURN_GRACE_SECS) * MICROS_PER_SEC,
    };
    match ai_turn_marks::insert(&mark, now).await {
        Ok(id) => TurnMark::new(move || {
            tokio::spawn(async move {
                if let Err(e) = ai_turn_marks::delete(&id).await {
                    log::warn!("[AI-CHAT] turn mark {id} not removed, it expires on its own: {e}");
                }
            });
        }),
        Err(e) => {
            log::warn!("[org_id:{org_id}] turn mark of {session_id} not written: {e}");
            TurnMark::unwritten()
        }
    }
}

/// Whether a turn of `user_email` runs `session_id` on any node.
pub(crate) async fn turn_runs(org_id: &str, session_id: &str, user_email: &str) -> bool {
    ai_turn_marks::exists(
        org_id,
        session_id,
        user_email,
        KIND_TURN,
        None,
        now_micros(),
    )
    .await
    .unwrap_or_else(|e| {
        log::warn!("[org_id:{org_id}] turn marks of {session_id} unreadable: {e}");
        false
    })
}

/// Consumes the confirmation of `tool` the member's turn asked; `false` when it asked none.
pub(crate) async fn take_confirmation(
    org_id: &str,
    session_id: &str,
    user_email: &str,
    tool: &str,
) -> bool {
    ai_turn_marks::take(
        org_id,
        session_id,
        user_email,
        KIND_CONFIRMATION,
        Some(tool),
        now_micros(),
    )
    .await
    .unwrap_or_else(|e| {
        log::warn!("[org_id:{org_id}] confirmations of {session_id} unreadable: {e}");
        false
    })
}

/// The `tool` of each `confirmation_required` frame in `chunk`; a frame split in two is missed.
fn confirmation_tools(chunk: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(chunk)
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
        .filter(|frame| frame["type"] == CONFIRMATION_REQUIRED)
        .filter_map(|frame| frame["tool"].as_str().map(str::to_string))
        .filter(|tool| !tool.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_tool_of_a_confirmation_frame_is_recorded() {
        let chunk = concat!(
            "data: {\"type\":\"status\",\"tool\":\"SearchSQL\"}\n\n",
            "data: {\"type\":\"confirmation_required\",\"tool\":\"UpdateDashboard\"}\n\n",
            "data: {\"type\":\"confirmation_required\"}\n\n",
            "data: {\"type\":\"confirmation_requi",
        );
        assert_eq!(confirmation_tools(chunk.as_bytes()), ["UpdateDashboard"]);
    }
}
