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

//! Per-node rejection and credential-use counters, merged into the trigger rows once a minute.

use std::{collections::BTreeMap, sync::LazyLock, time::Duration};

use config::utils::time::now_micros;
use infra::{
    db::get_orm_client_rw,
    table::workflow_http_triggers::{self as triggers, RejectionDelta},
};
use parking_lot::Mutex;
use sea_orm::TransactionTrait;

use super::{HookReason, payload::is_credential_value};

const MERGE_EVERY: Duration = Duration::from_secs(60);
const AUDIT_EVERY_US: i64 = 60 * 1_000_000;
// Bounds the per-node maps however many triggers a flood names.
const MAX_PENDING_TRIGGERS: usize = 10_000;
// Minted ids are 22 characters; a longer path segment cannot name a trigger.
const MAX_TRIGGER_ID_LEN: usize = 64;

static PENDING: LazyLock<Mutex<PendingRejections>> = LazyLock::new(Default::default);

#[derive(Default)]
struct PendingRejections {
    deltas: BTreeMap<String, BTreeMap<String, RejectionDelta>>,
    used: BTreeMap<String, (i64, Vec<String>)>,
    audited: BTreeMap<(String, HookReason), i64>,
}

impl PendingRejections {
    fn record(&mut self, trigger_id: &str, reason: HookReason, caller_ip: &str, now_us: i64) {
        if !reason.is_recorded() || !is_recordable_id(trigger_id) {
            return;
        }
        if !self.deltas.contains_key(trigger_id) && self.deltas.len() >= MAX_PENDING_TRIGGERS {
            return;
        }
        let delta = self
            .deltas
            .entry(trigger_id.to_string())
            .or_default()
            .entry(reason.code().to_string())
            .or_insert_with(|| RejectionDelta {
                count: 0,
                last_at: now_us,
                last_ip: caller_ip.to_string(),
            });
        delta.count = delta.count.saturating_add(1);
        if now_us >= delta.last_at {
            delta.last_at = now_us;
            delta.last_ip = caller_ip.to_string();
        }
    }

    fn record_use(&mut self, trigger_id: &str, credential_id: &str, now_us: i64) {
        if !self.used.contains_key(trigger_id) && self.used.len() >= MAX_PENDING_TRIGGERS {
            return;
        }
        let (last, credentials) = self
            .used
            .entry(trigger_id.to_string())
            .or_insert_with(|| (now_us, Vec::new()));
        *last = (*last).max(now_us);
        if !credentials.iter().any(|c| c == credential_id) {
            credentials.push(credential_id.to_string());
        }
    }

    fn should_audit(&mut self, trigger_id: &str, reason: HookReason, now_us: i64) -> bool {
        if self.audited.len() >= MAX_PENDING_TRIGGERS {
            self.audited.retain(|_, at| now_us - *at < AUDIT_EVERY_US);
        }
        let key = (trigger_id.to_string(), reason);
        if self
            .audited
            .get(&key)
            .is_some_and(|at| now_us - at < AUDIT_EVERY_US)
        {
            return false;
        }
        if self.audited.len() >= MAX_PENDING_TRIGGERS {
            return false;
        }
        self.audited.insert(key, now_us);
        true
    }

    /// Drains the counters for a merge pass; the audit marks stay, so sampling spans passes.
    fn take(&mut self) -> Self {
        Self {
            deltas: std::mem::take(&mut self.deltas),
            used: std::mem::take(&mut self.used),
            audited: BTreeMap::new(),
        }
    }
}

/// A pasted credential is never a map key, a lookup key or a log field.
pub fn is_recordable_id(trigger_id: &str) -> bool {
    trigger_id.len() <= MAX_TRIGGER_ID_LEN && !is_credential_value(trigger_id)
}

pub fn record(trigger_id: &str, reason: HookReason, caller_ip: &str, now_us: i64) {
    PENDING.lock().record(trigger_id, reason, caller_ip, now_us);
}

pub fn record_use(trigger_id: &str, credential_id: &str, now_us: i64) {
    PENDING.lock().record_use(trigger_id, credential_id, now_us);
}

pub fn should_audit(trigger_id: &str, reason: HookReason, now_us: i64) -> bool {
    PENDING.lock().should_audit(trigger_id, reason, now_us)
}

pub async fn run_merge_loop() {
    let mut interval = tokio::time::interval(MERGE_EVERY);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval.tick().await;
    loop {
        interval.tick().await;
        if let Err(e) = flush(now_micros()).await {
            log::error!("[WORKFLOW_HOOK] rejection merge failed: {e}");
        }
    }
}

async fn flush(now_us: i64) -> Result<(), anyhow::Error> {
    let pending = PENDING.lock().take();
    flush_into(get_orm_client_rw().await, pending, now_us).await
}

/// Writes every trigger it can; a missing row (unknown or swept id) is skipped by the merge itself.
async fn flush_into<C: TransactionTrait>(
    db: &C,
    pending: PendingRejections,
    now_us: i64,
) -> Result<(), anyhow::Error> {
    let mut failed = 0;
    for (trigger_id, deltas) in &pending.deltas {
        if let Err(e) = triggers::merge_rejections(db, trigger_id, deltas, now_us).await {
            log::warn!("[WORKFLOW_HOOK] rejections of trigger {trigger_id} not merged: {e}");
            failed += 1;
        }
    }
    for (trigger_id, (invoked_at, credential_ids)) in &pending.used {
        let txn = db.begin().await?;
        let touched =
            triggers::touch_last_used(&txn, trigger_id, *invoked_at, credential_ids).await;
        match touched {
            Ok(()) => txn.commit().await?,
            Err(e) => {
                txn.rollback().await?;
                log::warn!("[WORKFLOW_HOOK] last use of trigger {trigger_id} not written: {e}");
                failed += 1;
            }
        }
    }
    if failed > 0 {
        anyhow::bail!("{failed} trigger rows not merged");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use infra::table::{
        entity::workflow_http_triggers::Model as TriggerRow,
        workflow_http_triggers::{RejectionEntry, create_tables_for_tests},
    };
    use sea_orm::Database;

    use super::*;

    const MINUTE_US: i64 = 60 * 1_000_000;
    const DAY_US: i64 = 24 * 3600 * 1_000_000;

    fn trigger_row(id: &str) -> TriggerRow {
        TriggerRow {
            id: id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: format!("wf-{id}"),
            enabled: true,
            auth_mode: "token".to_string(),
            max_body_bytes: 1024,
            rate_limit_per_minute: 60,
            created_by: "a@acme.io".to_string(),
            created_at: 1,
            updated_at: 7,
            version: 3,
            origin_cluster: "local".to_string(),
            deleted_at: None,
            last_invoked_at: None,
            rejections: None,
        }
    }

    async fn db_with(ids: &[&str]) -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_tests(&db).await.unwrap();
        for id in ids {
            triggers::insert_trigger(&db, trigger_row(id))
                .await
                .unwrap();
        }
        db
    }

    async fn stored(
        db: &sea_orm::DatabaseConnection,
        id: &str,
    ) -> BTreeMap<String, RejectionEntry> {
        let row = triggers::get(db, id).await.unwrap().unwrap();
        row.rejections
            .as_deref()
            .map(|raw| serde_json::from_str(raw).unwrap())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn merge_adds_deltas_within_the_window() {
        let db = db_with(&["t1"]).await;
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::InvalidToken, "203.0.113.1", 100);
        pending.record("t1", HookReason::InvalidToken, "203.0.113.2", 200);
        flush_into(&db, pending, 1_000).await.unwrap();
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::InvalidToken, "203.0.113.3", MINUTE_US);
        flush_into(&db, pending, MINUTE_US + 1).await.unwrap();
        let entry = &stored(&db, "t1").await["invalid_token"];
        assert_eq!(entry.count_24h, 3);
        assert_eq!(entry.last_at, MINUTE_US);
        assert_eq!(entry.last_ip, "203.0.113.3");
    }

    #[tokio::test]
    async fn merge_resets_after_twenty_four_hours() {
        let db = db_with(&["t1"]).await;
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::RateLimited, "203.0.113.1", 100);
        pending.record("t1", HookReason::RateLimited, "203.0.113.1", 101);
        flush_into(&db, pending, 1_000).await.unwrap();
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::RateLimited, "203.0.113.9", DAY_US + 2_000);
        flush_into(&db, pending, DAY_US + 2_000).await.unwrap();
        assert_eq!(stored(&db, "t1").await["rate_limited"].count_24h, 1);
    }

    #[tokio::test]
    async fn merge_keeps_the_newer_ip() {
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::StaleTimestamp, "203.0.113.2", 500);
        pending.record("t1", HookReason::StaleTimestamp, "203.0.113.1", 400);
        let delta = &pending.deltas["t1"]["stale_timestamp"];
        assert_eq!(delta.count, 2);
        assert_eq!(delta.last_at, 500);
        assert_eq!(delta.last_ip, "203.0.113.2");
    }

    #[tokio::test]
    async fn stored_reason_is_specific_not_unauthorized() {
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::Unauthorized, "203.0.113.1", 1);
        pending.record("t1", HookReason::InternalError, "203.0.113.1", 1);
        pending.record("t1", HookReason::RunNotFound, "203.0.113.1", 1);
        assert!(pending.deltas.is_empty());
        pending.record("t1", HookReason::InvalidSignature, "203.0.113.1", 1);
        assert_eq!(
            pending.deltas["t1"].keys().collect::<Vec<_>>(),
            vec!["invalid_signature"]
        );
    }

    #[tokio::test]
    async fn merge_leaves_version_and_updated_at() {
        let db = db_with(&["t1"]).await;
        let mut pending = PendingRejections::default();
        pending.record("t1", HookReason::CredentialInUrl, "203.0.113.1", 5);
        pending.record_use("t1", "c1", 5);
        flush_into(&db, pending, 10).await.unwrap();
        let row = triggers::get(&db, "t1").await.unwrap().unwrap();
        assert_eq!((row.version, row.updated_at), (3, 7));
        assert_eq!(row.last_invoked_at, Some(5));
    }

    #[tokio::test]
    async fn an_unknown_trigger_id_is_skipped() {
        let db = db_with(&["t1"]).await;
        let mut pending = PendingRejections::default();
        pending.record("nope", HookReason::CredentialInUrl, "203.0.113.1", 5);
        pending.record("t1", HookReason::CredentialInUrl, "203.0.113.1", 5);
        flush_into(&db, pending, 10).await.unwrap();
        assert_eq!(stored(&db, "t1").await["credential_in_url"].count_24h, 1);
    }

    #[test]
    fn pending_triggers_are_bounded() {
        let mut pending = PendingRejections::default();
        for i in 0..MAX_PENDING_TRIGGERS + 5 {
            pending.record(&format!("t{i}"), HookReason::CredentialInUrl, "ip", 1);
        }
        assert_eq!(pending.deltas.len(), MAX_PENDING_TRIGGERS);
        let mut fresh = PendingRejections::default();
        fresh.record(
            &"t".repeat(MAX_TRIGGER_ID_LEN + 1),
            HookReason::CredentialInUrl,
            "ip",
            1,
        );
        assert!(
            fresh.deltas.is_empty(),
            "an overlong path segment is never kept"
        );
        pending.record("t0", HookReason::CredentialInUrl, "ip", 2);
        assert_eq!(pending.deltas["t0"]["credential_in_url"].count, 2);
    }

    #[test]
    fn a_credential_shaped_id_is_never_a_key() {
        let mut pending = PendingRejections::default();
        for id in [
            "o2wh_AbCdEfGhIjKlMnOpQrStUvWxYz0123",
            "WHSEC%5Fabc",
            "whsec_abc",
        ] {
            pending.record(id, HookReason::PayloadTooLarge, "ip", 1);
        }
        assert!(pending.deltas.is_empty(), "{:?}", pending.deltas.keys());
    }

    #[test]
    fn rejection_audit_is_sampled_once_per_minute_per_reason() {
        let mut pending = PendingRejections::default();
        assert!(pending.should_audit("t1", HookReason::InvalidToken, 0));
        assert!(!pending.should_audit("t1", HookReason::InvalidToken, MINUTE_US - 1));
        assert!(pending.should_audit("t1", HookReason::RateLimited, 1));
        assert!(pending.should_audit("t2", HookReason::InvalidToken, 1));
        assert!(pending.should_audit("t1", HookReason::InvalidToken, MINUTE_US));
        let _ = pending.take();
        assert!(
            !pending.should_audit("t1", HookReason::InvalidToken, MINUTE_US + 1),
            "a merge pass keeps the audit marks"
        );
    }

    #[tokio::test]
    async fn last_used_is_written_at_most_once_a_minute() {
        let db = db_with(&["t1"]).await;
        let mut pending = PendingRejections::default();
        pending.record_use("t1", "c1", 30);
        pending.record_use("t1", "c1", 10);
        pending.record_use("t1", "c2", 20);
        assert_eq!(
            pending.used["t1"],
            (30, vec!["c1".to_string(), "c2".to_string()])
        );
        flush_into(&db, pending, 40).await.unwrap();
        assert_eq!(
            triggers::get(&db, "t1")
                .await
                .unwrap()
                .unwrap()
                .last_invoked_at,
            Some(30)
        );
        assert_eq!(MERGE_EVERY, Duration::from_secs(60));
    }
}
