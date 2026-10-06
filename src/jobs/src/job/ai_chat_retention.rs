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

//! Keeps the AI chat index (`ai_chat_sessions`) in step with the retention of
//! the `_o2_ai_chat_events` stream it indexes.
//!
//! Invariant: an index row exists only while ALL of its chat's events do —
//! otherwise every read and every restore of it fails as an integrity error.
//! With R the stream's effective retention, each pass:
//!
//! 1. refreshes chats in use: a chat used within the last R/2 whose oldest events are older than
//!    R/2 has its history rewritten with fresh timestamps (byte-identical rows, deduplicated on
//!    read), under its turn lease, so a chat in use never loses history however long it lives;
//! 2. purges rows whose oldest events are past R (plus a day of margin for compaction lag): chats
//!    unused for long enough, and tombstones of deleted chats, which are only needed while the
//!    deleted events still exist;
//! 3. re-sends the removal of chats deleted within the last day to every live o2-ai replica until
//!    one pass reaches them all (a replica down at delete time keeps its copy otherwise).
//!
//! Idempotent: any scheduler may run it, and a missed pass only delays work.

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{self_reporting::ai_chat::AI_CHAT_EVENTS_STREAM, stream::StreamType},
    spawn_pausable_job,
    utils::time::now_micros,
};
use infra::table::{ai_chat_sessions, ai_chat_turns};

const SWEEP_INTERVAL_SECS: u64 = 60 * 60;
/// Chats refreshed per org per pass; the rest wait for the next pass.
const REFRESH_PER_PASS: u64 = 50;
/// Removal lags the stream's retention by this much, so a row is never
/// dropped while compaction may still be deleting its events.
const MARGIN_DAYS: i64 = 1;
const MICROS_PER_DAY: i64 = 24 * 60 * 60 * 1_000_000;
/// Deleted chats whose replica copies are re-purged per org per pass.
const REPLICA_PURGE_PER_PASS: u64 = 100;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[AI_CHAT_RETENTION] not a scheduler node, skipping");
        return;
    }
    spawn_pausable_job!("ai_chat_retention", SWEEP_INTERVAL_SECS, {
        if let Err(e) = sweep().await {
            log::error!("[AI_CHAT_RETENTION] sweep failed: {e}");
        }
    });
}

async fn sweep() -> Result<(), infra::errors::Error> {
    let now = now_micros();
    for org_id in ai_chat_sessions::orgs_with_chats().await? {
        purge_deleted_replicas(&org_id, now).await;
        let settings =
            infra::schema::get_settings(&org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs)
                .await
                .unwrap_or_default();
        let Some(days) = effective_retention_days(
            settings.data_retention,
            get_config().compact.data_retention_days,
        ) else {
            continue;
        };
        refresh_in_use(&org_id, days, now).await;
        let cutoff = now - (days + MARGIN_DAYS) * MICROS_PER_DAY;
        match ai_chat_sessions::purge_expired(&org_id, cutoff).await {
            Ok(0) => {}
            Ok(n) => log::info!("[AI_CHAT_RETENTION] {org_id}: removed {n} expired chat(s)"),
            Err(e) => log::error!("[AI_CHAT_RETENTION] {org_id}: purge failed: {e}"),
        }
        match infra::table::ai_chat_shares::purge_orphans(&org_id).await {
            Ok(0) => {}
            Ok(n) => log::info!("[AI_CHAT_RETENTION] {org_id}: removed {n} orphaned share(s)"),
            Err(e) => log::error!("[AI_CHAT_RETENTION] {org_id}: share purge failed: {e}"),
        }
        match ai_chat_turns::purge_orphans(&org_id).await {
            Ok(0) => {}
            Ok(n) => {
                log::info!("[AI_CHAT_RETENTION] {org_id}: removed {n} orphaned turn record(s)")
            }
            Err(e) => log::error!("[AI_CHAT_RETENTION] {org_id}: turn purge failed: {e}"),
        }
    }
    Ok(())
}

/// Rewrite the history of this org's chats in use before it can age out.
async fn refresh_in_use(org_id: &str, days: i64, now: i64) {
    let half = now - days * MICROS_PER_DAY / 2;
    let due = match ai_chat_sessions::due_for_refresh(org_id, half, half, REFRESH_PER_PASS).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[AI_CHAT_RETENTION] {org_id}: cannot list chats to refresh: {e}");
            return;
        }
    };
    let chat_retention = o2_enterprise::enterprise::common::config::get_config()
        .ai
        .chat_retention_days;
    for row in due {
        // A running turn owns the chat; it is refreshed on a later pass.
        let lease =
            match o2_enterprise::enterprise::ai::chat::lease::acquire(org_id, &row.session_id, 1)
                .await
            {
                Ok(lease) => lease,
                Err(_) => continue,
            };
        match openobserve_core::ai_chat::refresh_chat_history(&row, chat_retention).await {
            Ok(n) => log::info!(
                "[AI_CHAT_RETENTION] {org_id}/{}: refreshed {n} event(s)",
                row.session_id
            ),
            Err(e) => log::error!(
                "[AI_CHAT_RETENTION] {org_id}/{}: refresh failed: {e:#}",
                row.session_id
            ),
        }
        lease.release().await;
    }
}

/// A chat deleted within the last day is done once one pass reaches every live replica.
async fn purge_deleted_replicas(org_id: &str, now: i64) {
    let due = match ai_chat_sessions::due_for_replica_purge(
        org_id,
        now - MICROS_PER_DAY,
        REPLICA_PURGE_PER_PASS,
    )
    .await
    {
        Ok(rows) if rows.is_empty() => return,
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[AI_CHAT_RETENTION] {org_id}: cannot list deleted chats: {e}");
            return;
        }
    };
    let Some(client) = o2_enterprise::enterprise::ai::client::get_agent_client() else {
        return;
    };
    let auth = match openobserve_core::organization::get_sre_agent_credentials(org_id).await {
        Ok((email, token)) => openobserve_core::auth::build_basic_auth_header(&email, &token),
        // o2-ai still accepts the internal secret the client attaches.
        Err(_) => String::new(),
    };
    for row in due {
        let result = client
            .delete_session_everywhere(&row.session_id, org_id, &auth)
            .await;
        let label = if result.is_ok() { "ok" } else { "failed" };
        config::metrics::AI_CHAT_REPLICA_PURGES_TOTAL
            .with_label_values(&[label])
            .inc();
        match result {
            Ok(()) => {
                if let Err(e) =
                    ai_chat_sessions::mark_replica_purged(org_id, &row.session_id, now_micros())
                        .await
                {
                    log::warn!(
                        "[AI_CHAT_RETENTION] {org_id}/{}: cannot record the purge: {e}",
                        row.session_id
                    );
                }
            }
            Err(e) => log::warn!(
                "[AI_CHAT_RETENTION] {org_id}/{}: replica purge failed: {e:#}",
                row.session_id
            ),
        }
    }
}

/// The stream's effective retention in days, or `None` when it keeps data
/// forever. Same resolution as the compactor: the stream's own setting when
/// set, else the global default.
fn effective_retention_days(stream_days: i64, global_days: i64) -> Option<i64> {
    let days = if stream_days > 0 {
        stream_days
    } else {
        global_days
    };
    (days > 0).then_some(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_retention_wins_and_zero_keeps_forever() {
        assert_eq!(effective_retention_days(30, 7), Some(30));
        assert_eq!(effective_retention_days(0, 7), Some(7));
        assert_eq!(effective_retention_days(0, 0), None);
    }
}
