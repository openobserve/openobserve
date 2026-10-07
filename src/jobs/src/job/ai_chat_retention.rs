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

// Keeps `ai_chat_sessions` within `_o2_ai_chat_events` retention; chats in use are rewritten first.

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
/// A row is removed this long before compaction may start deleting its oldest events.
const MARGIN_MICROS: i64 = MICROS_PER_DAY;
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
        purge_deleted_replicas(&org_id).await;
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
        let cutoff = now - purge_age(days);
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
        match openobserve_core::ai_chat::refresh_chat_history(
            org_id,
            &row.session_id,
            chat_retention,
        )
        .await
        {
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

/// A deleted chat is done once one pass reaches every live replica; until then it is retried.
async fn purge_deleted_replicas(org_id: &str) {
    let due = match ai_chat_sessions::due_for_replica_purge(org_id, REPLICA_PURGE_PER_PASS).await {
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
            Err(e) => {
                log::warn!(
                    "[AI_CHAT_RETENTION] {org_id}/{}: replica purge failed: {e:#}",
                    row.session_id
                );
                if let Err(e) =
                    ai_chat_sessions::defer_replica_purge(org_id, &row.session_id, now_micros())
                        .await
                {
                    log::warn!(
                        "[AI_CHAT_RETENTION] {org_id}/{}: cannot defer the purge: {e}",
                        row.session_id
                    );
                }
            }
        }
    }
}

/// The stream's retention in days as the compactor resolves it; `None` keeps data forever.
fn effective_retention_days(stream_days: i64, global_days: i64) -> Option<i64> {
    let days = if stream_days > 0 {
        stream_days
    } else {
        global_days
    };
    (days > 0).then_some(days)
}

/// Age (micros) past which a row goes: before its events may, but beyond the refresh horizon (R/2).
fn purge_age(days: i64) -> i64 {
    let retention = days * MICROS_PER_DAY;
    (retention - MARGIN_MICROS).max(retention * 3 / 4)
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

    #[test]
    fn rows_go_before_their_events_and_never_inside_the_refresh_horizon() {
        assert_eq!(purge_age(30), 29 * MICROS_PER_DAY);
        assert_eq!(purge_age(2), MICROS_PER_DAY * 3 / 2);
        assert_eq!(purge_age(1), MICROS_PER_DAY * 3 / 4);
        for days in 1..=60 {
            let age = purge_age(days);
            assert!(age < days * MICROS_PER_DAY, "{days}");
            assert!(age > days * MICROS_PER_DAY / 2, "{days}");
        }
    }
}
