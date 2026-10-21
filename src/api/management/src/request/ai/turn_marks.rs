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

//! Cluster-visible marks of a turn: whose turn runs a session, and the approvals it asked.

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicI64, Ordering},
    },
};

use config::utils::time::now_micros;
use infra::table::{
    ai_approvals::{self, Decision, NewApproval},
    ai_turn_marks::{self, KIND_ANSWERED, KIND_TURN, NewMark},
};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde_json::Value;

const MICROS_PER_SEC: i64 = 1_000_000;
const TURN_GRACE_SECS: i64 = 60;
// Outlives the 24 h a chat's newest turn may report a pending approval.
const ANSWERED_TTL_SECS: i64 = 25 * 3600;
const CONFIRMATION_REQUIRED: &str = "confirmation_required";
const CONFIRMATION_RESOLVED: &str = "confirmation_resolved";
// A frame line longer than this is not an approval frame worth buffering.
const MAX_PENDING_LINE: usize = 1 << 20;
// Each node sweeps expired and old approvals at most this often, when a new card arrives.
const PURGE_EVERY_MICROS: i64 = 3600 * MICROS_PER_SEC;

static LAST_PURGE: AtomicI64 = AtomicI64::new(0);

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

/// Stores each approval card a turn raises and each decision it streams in `ai_approvals`.
pub(crate) struct ConfirmationWatch {
    org_id: String,
    session_id: String,
    user_email: String,
    // The unterminated tail of the last chunk; a frame split across chunks is joined here.
    partial: Mutex<String>,
}

impl ConfirmationWatch {
    pub(crate) fn new(org_id: &str, session_id: &str, user_email: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            user_email: user_email.to_string(),
            partial: Mutex::new(String::new()),
        }
    }

    /// Returns at once; the approvals are written in the background.
    pub(crate) fn note(&self, chunk: &[u8]) {
        for frame in self.frames(chunk) {
            let (org_id, session_id) = (self.org_id.clone(), self.session_id.clone());
            let user_email = self.user_email.clone();
            tokio::spawn(async move {
                record_frame(&org_id, &session_id, &user_email, &frame).await;
            });
        }
    }

    fn frames(&self, chunk: &[u8]) -> Vec<Value> {
        let mut partial = self
            .partial
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        partial.push_str(&String::from_utf8_lossy(chunk));
        let complete = match partial.rfind('\n') {
            Some(end) => partial.drain(..=end).collect::<String>(),
            None => String::new(),
        };
        if partial.len() > MAX_PENDING_LINE {
            partial.clear();
        }
        approval_frames(&complete)
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

/// Notes that `user_email` answered the session's pending confirmation now; best effort.
pub(crate) async fn mark_answered(org_id: &str, session_id: &str, user_email: &str) {
    let now = now_micros();
    let mark = NewMark {
        org_id,
        session_id,
        user_email,
        kind: KIND_ANSWERED,
        value: None,
        expires_at: now + ANSWERED_TTL_SECS * MICROS_PER_SEC,
    };
    if let Err(e) = ai_turn_marks::insert(&mark, now).await {
        log::warn!("[org_id:{org_id}] answer to the confirmation of {session_id} not noted: {e}");
    }
}

/// Confirmations `user_email` answered per session since its `since` time; 0 when unreadable.
pub(crate) async fn answers_since(
    org_id: &str,
    user_email: &str,
    sessions: &[(String, i64)],
) -> HashMap<String, usize> {
    let session_ids: Vec<String> = sessions.iter().map(|(id, _)| id.clone()).collect();
    let created = ai_turn_marks::created_per_session(
        org_id,
        user_email,
        KIND_ANSWERED,
        &session_ids,
        now_micros(),
    )
    .await
    .unwrap_or_else(|e| {
        log::warn!("[org_id:{org_id}] answered confirmations unreadable: {e}");
        HashMap::new()
    });
    sessions
        .iter()
        .map(|(id, since)| {
            let answers = created
                .get(id)
                .map_or(0, |times| times.iter().filter(|at| *at >= since).count());
            (id.clone(), answers)
        })
        .collect()
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

/// The stored decision a `confirmation_resolved` frame (`resolved`) reports.
pub(crate) fn decision_of<'a>(frame: &'a Value, resolved: &'a str) -> Decision<'a> {
    let status = if frame["approved"] == true {
        ai_approvals::STATUS_APPROVED
    } else if frame["expired"] == true {
        ai_approvals::STATUS_EXPIRED
    } else {
        ai_approvals::STATUS_DENIED
    };
    Decision {
        status,
        scope: frame["scope"].as_str(),
        resolved,
    }
}

/// Stores a card as pending or a decision on one; a decided card is never overwritten.
async fn record_frame(org_id: &str, session_id: &str, user_email: &str, frame: &Value) {
    let Some(id) = frame["id"].as_str().filter(|id| id.starts_with("apr_")) else {
        return;
    };
    let now = now_micros();
    let stored = if frame["type"] == CONFIRMATION_REQUIRED {
        let approval = NewApproval {
            id,
            org_id,
            session_id,
            user_email,
            tool: frame["tool"].as_str().filter(|t| !t.is_empty()),
            card: &frame.to_string(),
            expires_at: frame["expires_at"]
                .as_i64()
                .unwrap_or(0)
                .saturating_mul(1000),
        };
        maybe_purge(now);
        ai_approvals::insert_pending(&approval, now).await
    } else {
        let resolved = frame.to_string();
        ai_approvals::decide(org_id, id, &decision_of(frame, &resolved), now).await
    };
    if let Err(e) = stored {
        log::warn!("[org_id:{org_id}] approval {id} of {session_id} not stored: {e}");
    }
}

fn maybe_purge(now: i64) {
    let last = LAST_PURGE.load(Ordering::Relaxed);
    let due = now - last >= PURGE_EVERY_MICROS;
    if due
        && LAST_PURGE
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    {
        tokio::spawn(async move {
            if let Err(e) = ai_approvals::purge(now).await {
                log::warn!("[AI-CHAT] approval purge failed: {e}");
            }
        });
    }
}

/// Each complete `confirmation_required` or `confirmation_resolved` frame in `text`.
fn approval_frames(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
        .filter(|frame| {
            frame["type"] == CONFIRMATION_REQUIRED || frame["type"] == CONFIRMATION_RESOLVED
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn approval_frames_split_across_chunks_are_joined() {
        let watch = ConfirmationWatch::new("o", "s", "a@x");
        let first = concat!(
            "data: {\"type\":\"status\",\"tool\":\"SearchSQL\"}\n\n",
            "data: {\"type\":\"confirmation_required\",\"id\":\"apr_1\",\"tool\":\"Upd",
        );
        assert!(watch.frames(first.as_bytes()).is_empty());
        let rest = "ateDashboard\"}\n\ndata: {\"type\":\"confirmation_resolved\",\"id\":\"apr_1\",\"approved\":true}\n";
        let frames = watch.frames(rest.as_bytes());
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["tool"], "UpdateDashboard");
        assert_eq!(frames[1]["type"], CONFIRMATION_RESOLVED);
    }

    #[test]
    fn a_resolved_frame_maps_to_its_stored_status() {
        let status = |frame: Value| decision_of(&frame, "").status;
        assert_eq!(
            status(json!({"approved": true, "scope": "chat"})),
            ai_approvals::STATUS_APPROVED
        );
        assert_eq!(
            status(json!({"approved": false, "expired": true})),
            ai_approvals::STATUS_EXPIRED
        );
        assert_eq!(
            status(json!({"approved": false, "withdrawn": true})),
            ai_approvals::STATUS_DENIED
        );
    }
}
