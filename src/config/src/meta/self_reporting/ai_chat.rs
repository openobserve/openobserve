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

//! The protected `_o2_ai_chat_events` stream — canonical store of AI chats.
//!
//! Server-side chat persistence keeps two things: a small index row per chat
//! in the meta DB (`ai_chat_sessions`) and, per organization, this Logs
//! stream holding opencode's durable session events verbatim. The stream is
//! the source of truth: browser history is projected from it and a replica
//! that lost its local opencode state is rebuilt from it (opencode
//! `POST /sync/replay`).
//!
//! It is internal. The `_o2_` prefix puts it under the un-gated
//! [`super::usage::is_internal_rollup_stream`] guard (no user ingestion in
//! any edition). Every SQL query is resolved to its streams in
//! `search::sql::Sql::resolve`, which refuses this stream (as "not found")
//! unless the caller runs inside [`as_chat_history_reader`] — so UI searches,
//! dashboards, alerts, reports and scheduled pipelines all stay out, and the
//! Chat API (which scopes by owner) is the only reader. The query is planned
//! again in spawned tasks, where the task-local is gone, so the leader
//! carries the mark on the internal request
//! (`datafusion::request::Request::chat_history_reader`).
//! [`is_protected_ai_chat_stream`] additionally keeps it out of stream
//! listing/management and realtime pipelines.

pub const AI_CHAT_EVENTS_STREAM: &str = "_o2_ai_chat_events";

tokio::task_local! {
    static CHAT_HISTORY_READER: ();
}

/// Run `fut` as the Chat API's history reader — the only code allowed to
/// query the chat-events stream. A task-local rather than a request field:
/// nothing a client sends, and no stored alert, dashboard or pipeline, can
/// set it.
pub async fn as_chat_history_reader<F: std::future::Future>(fut: F) -> F::Output {
    CHAT_HISTORY_READER.scope((), fut).await
}

/// Whether the current task is the Chat API's history reader.
pub fn is_chat_history_reader() -> bool {
    CHAT_HISTORY_READER.try_with(|_| ()).is_ok()
}

/// Whether `stream_name` is the protected chat-events stream.
///
/// The guards that keep it out of the user-facing stream APIs (search,
/// listing, create/delete) call this. The record shape and everything that
/// writes it live in `o2_enterprise::enterprise::ai::chat`; only the reserved
/// name belongs here, next to the other internal-stream predicates.
pub fn is_protected_ai_chat_stream(stream_name: &str) -> bool {
    stream_name == AI_CHAT_EVENTS_STREAM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_chat_events_stream_is_protected() {
        assert!(is_protected_ai_chat_stream("_o2_ai_chat_events"));
        assert!(!is_protected_ai_chat_stream("_o2_service_graph"));
        assert!(!is_protected_ai_chat_stream("default"));
        // And it sits under the un-gated rollup-stream ingest guard.
        assert!(super::super::usage::is_internal_rollup_stream(
            AI_CHAT_EVENTS_STREAM
        ));
    }

    #[tokio::test]
    async fn only_code_inside_the_reader_scope_is_the_reader() {
        assert!(!is_chat_history_reader());
        assert!(as_chat_history_reader(async { is_chat_history_reader() }).await);
        // A task spawned from inside does not inherit the marker.
        let spawned = as_chat_history_reader(async {
            tokio::spawn(async { is_chat_history_reader() })
                .await
                .unwrap()
        })
        .await;
        assert!(!spawned);
    }
}
