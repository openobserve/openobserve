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

//! Super-cluster replication of link rows: queued Puts, outbox retries and the apply order.

use std::future::Future;

use config::utils::time::now_micros;
use infra::{
    db::get_orm_client_rw,
    table::{
        entity::public_dashboards::Model as PublicDashboard,
        public_dashboards::{self as pd_table, Applied},
    },
};
use sea_orm::ConnectionTrait;

/// How often the housekeeping job retries failed emits.
pub const OUTBOX_RETRY_SECS: i64 = 60;
/// Outbox entries one retry pass sends at most.
const OUTBOX_BATCH: usize = 100;
/// Entries one pass reads, so entries still backing off do not crowd out the due ones.
const OUTBOX_SCAN: u64 = 1000;
/// The longest wait between two retries of one entry.
const OUTBOX_MAX_BACKOFF_SECS: i64 = 3600;

/// Whether link rows replicate: Enterprise with the super cluster on, the guard dashboards use.
pub fn enabled() -> bool {
    #[cfg(feature = "enterprise")]
    return o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    false
}

/// Sends the row its write already queued in the outbox; a failed send stays queued for retry.
pub async fn replicate(row: &PublicDashboard) {
    if enabled() {
        deliver_on(get_orm_client_rw().await, row, emit).await;
    }
}

/// Sends the row when replication is on; nothing to send is a success.
pub async fn send(row: PublicDashboard) -> Result<(), anyhow::Error> {
    if enabled() { emit(row).await } else { Ok(()) }
}

/// Sends every outbox entry's current row again; delivered entries leave the outbox.
pub async fn retry_outbox() {
    if enabled() {
        let sent = retry_outbox_on(get_orm_client_rw().await, emit, now_micros()).await;
        if sent > 0 {
            log::info!("[public_dashboards] outbox delivered {sent} link rows");
        }
    }
}

/// Applies a link row another region sent; a local write that wins a revision tie is sent back.
pub async fn apply(json: &str, origin: &str) -> Result<(), anyhow::Error> {
    let incoming: PublicDashboard = serde_json::from_str(json)?;
    let db = get_orm_client_rw().await;
    let applied =
        pd_table::apply_replicated(db, &incoming, origin, &local_origin(), now_micros()).await?;
    if let Applied::Reasserted(row) = applied {
        deliver_on(db, row.as_ref(), send).await;
    }
    Ok(())
}

/// The row's outbox entry is written with the row, so only a delivered send removes it.
pub(crate) async fn deliver_on<C, F, Fut>(db: &C, row: &PublicDashboard, emit: F)
where
    C: ConnectionTrait,
    F: Fn(PublicDashboard) -> Fut,
    Fut: Future<Output = Result<(), anyhow::Error>>,
{
    let result = match emit(row.clone()).await {
        Ok(()) => pd_table::outbox_delete(db, &row.id, row.rev).await,
        Err(e) => {
            log::error!(
                "[public_dashboards] replicating link {} at rev {} failed, left for retry: {e}",
                row.id,
                row.rev
            );
            return;
        }
    };
    if let Err(e) = result {
        log::error!(
            "[public_dashboards] clearing the outbox of link {}: {e}",
            row.id
        );
    }
}

/// Returns how many entries were delivered; the current row always goes, never an older one.
pub(crate) async fn retry_outbox_on<C, F, Fut>(db: &C, emit: F, now: i64) -> usize
where
    C: ConnectionTrait,
    F: Fn(PublicDashboard) -> Fut,
    Fut: Future<Output = Result<(), anyhow::Error>>,
{
    let listed = match pd_table::outbox_list_due(db, now, OUTBOX_SCAN).await {
        Ok(listed) => listed,
        Err(e) => {
            log::error!("[public_dashboards] reading the outbox failed: {e}");
            return 0;
        }
    };
    let due = listed
        .into_iter()
        .filter(|e| outbox_due(e.attempts, e.updated_at, now))
        .take(OUTBOX_BATCH);
    let mut sent = 0;
    for entry in due {
        let row = match pd_table::get(db, &entry.link_id).await {
            Ok(Some(row)) => row,
            // Purged after its 30 days: nothing is left to send.
            Ok(None) => {
                let _ = pd_table::outbox_delete(db, &entry.link_id, i64::MAX).await;
                continue;
            }
            Err(e) => {
                log::error!("[public_dashboards] outbox read of {}: {e}", entry.link_id);
                continue;
            }
        };
        let result = match emit(row.clone()).await {
            Ok(()) => {
                sent += 1;
                pd_table::outbox_delete(db, &row.id, row.rev).await
            }
            Err(e) => {
                let attempts = entry.attempts.saturating_add(1);
                if reaches_max_backoff(attempts) {
                    log::error!(
                        "[public_dashboards] replicating link {} failed {attempts} times; retrying hourly: {e}",
                        row.id
                    );
                } else {
                    log::warn!("[public_dashboards] outbox retry of {}: {e}", row.id);
                }
                pd_table::outbox_bump_attempts(db, &row.id, now).await
            }
        };
        if let Err(e) = result {
            log::error!("[public_dashboards] outbox update of {}: {e}", row.id);
        }
    }
    sent
}

/// The wait after `attempts` failed retries: none for the first, then doubling up to an hour.
fn outbox_backoff_secs(attempts: i32) -> i64 {
    let Ok(doublings) = u32::try_from(attempts.saturating_sub(2)) else {
        return 0;
    };
    (OUTBOX_RETRY_SECS << doublings.min(16)).min(OUTBOX_MAX_BACKOFF_SECS)
}

/// Whether an entry is due; half a period of slack, so a pass that runs a little early still sends.
fn outbox_due(attempts: i32, updated_at: i64, now: i64) -> bool {
    let slack = OUTBOX_RETRY_SECS / 2;
    now.saturating_sub(updated_at) >= (outbox_backoff_secs(attempts) - slack) * 1_000_000
}

/// True for the one failure count at which the wait first reaches its hourly maximum.
fn reaches_max_backoff(attempts: i32) -> bool {
    outbox_backoff_secs(attempts) == OUTBOX_MAX_BACKOFF_SECS
        && outbox_backoff_secs(attempts.saturating_sub(1)) < OUTBOX_MAX_BACKOFF_SECS
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn emit(row: PublicDashboard) -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::super_cluster::queue::public_dashboards_put(
        &row.org_id,
        serde_json::to_string(&row)?,
    )
    .await?;
    Ok(())
}

fn local_origin() -> String {
    #[cfg(feature = "enterprise")]
    return o2_enterprise::enterprise::super_cluster::kv::cluster::get_local_cluster_name();
    #[cfg(not(feature = "enterprise"))]
    config::get_cluster_name()
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    pub(crate) async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        pd_table::create_tables_for_tests(&db).await.unwrap();
        db
    }

    pub(crate) fn link(id: &str) -> PublicDashboard {
        PublicDashboard {
            id: id.into(),
            org_id: "o".into(),
            folder_id: "f".into(),
            dashboard_id: "d".into(),
            slug: format!("slug-{id}"),
            name: "n".into(),
            visibility: 1,
            time_ranges: None,
            default_range_key: None,
            frozen_variables: None,
            refresh_secs: 300,
            dashboard_version: 8,
            published_by: "p@x".into(),
            enabled: true,
            expires_at: None,
            created_by: "p@x".into(),
            updated_by: None,
            created_at: 1,
            updated_at: 1,
            rev: 1,
            deleted_at: None,
            last_accessed_at: None,
            access_count: 0,
        }
    }

    /// An emitter that fails while `down` is set and records what it sent.
    #[derive(Clone, Default)]
    pub(crate) struct Queue {
        pub down: Arc<AtomicBool>,
        pub sent: Arc<std::sync::Mutex<Vec<PublicDashboard>>>,
    }

    impl Queue {
        pub fn emitter(
            &self,
        ) -> impl Fn(PublicDashboard) -> std::future::Ready<Result<(), anyhow::Error>> + '_
        {
            move |row| {
                if self.down.load(Ordering::SeqCst) {
                    return std::future::ready(Err(anyhow::anyhow!("queue unavailable")));
                }
                self.sent.lock().unwrap().push(row);
                std::future::ready(Ok(()))
            }
        }
    }

    async fn queued(db: &DatabaseConnection) -> Vec<(String, i64, i32)> {
        pd_table::outbox_list_due(db, i64::MAX, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|e| (e.link_id, e.rev, e.attempts))
            .collect()
    }

    /// Every semantic write queues its Put with the row, so a crash before the send loses nothing.
    #[tokio::test]
    async fn gate07_a_crash_between_the_commit_and_the_emit_is_repaired_by_the_outbox() {
        let db = db().await;
        let row = link("l");
        pd_table::insert_capped(&db, &row, 10, 10, true)
            .await
            .unwrap();
        assert_eq!(queued(&db).await, [("l".to_string(), 1, 0)]);

        // The process dies after the commit: nothing was sent, the entry carries the revoke.
        let revoke = |l: &mut PublicDashboard| {
            l.deleted_at = Some(9);
            Ok::<(), anyhow::Error>(())
        };
        let revoked = crate::public_dashboards::edit_on(&db, "o", "l", true, revoke)
            .await
            .unwrap();
        assert_eq!(queued(&db).await, [("l".to_string(), revoked.rev, 0)]);

        let queue = Queue::default();
        queue.down.store(true, Ordering::SeqCst);
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 0);
        assert_eq!(queued(&db).await, [("l".to_string(), revoked.rev, 1)]);

        queue.down.store(false, Ordering::SeqCst);
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 1);
        let sent = queue.sent.lock().unwrap().clone();
        assert_eq!((sent[0].rev, sent[0].deleted_at), (revoked.rev, Some(9)));
        assert!(queued(&db).await.is_empty());
    }

    #[tokio::test]
    async fn gate07_a_delivered_emit_clears_its_entry_and_a_failed_one_keeps_it() {
        let db = db().await;
        let row = link("l");
        pd_table::insert_capped(&db, &row, 10, 10, true)
            .await
            .unwrap();
        let queue = Queue::default();
        deliver_on(&db, &row, queue.emitter()).await;
        assert_eq!(queue.sent.lock().unwrap().len(), 1);
        assert!(queued(&db).await.is_empty());

        let pause = |l: &mut PublicDashboard| {
            l.enabled = false;
            Ok::<(), anyhow::Error>(())
        };
        let paused = crate::public_dashboards::edit_on(&db, "o", "l", true, pause)
            .await
            .unwrap();
        queue.down.store(true, Ordering::SeqCst);
        deliver_on(&db, &paused, queue.emitter()).await;
        assert_eq!(queued(&db).await, [("l".to_string(), paused.rev, 0)]);

        // An entry whose row was purged is dropped without sending anything.
        queue.down.store(false, Ordering::SeqCst);
        pd_table::outbox_put(&db, "gone", 3, 1).await.unwrap();
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 1);
        assert!(queued(&db).await.is_empty());
    }

    #[tokio::test]
    async fn failed_retries_back_off_up_to_an_hour_and_log_once_at_the_cap() {
        let db = db().await;
        let t0 = 1_000_000_000_000;
        pd_table::outbox_put(&db, "l", 1, t0).await.unwrap();
        pd_table::insert_capped(&db, &link("l"), 10, 10, false)
            .await
            .unwrap();
        let queue = Queue::default();
        queue.down.store(true, Ordering::SeqCst);
        // The first two failures retry on the next passes, as before.
        retry_outbox_on(&db, queue.emitter(), t0).await;
        retry_outbox_on(&db, queue.emitter(), t0).await;
        assert_eq!(queued(&db).await[0].2, 2);
        // Then the wait doubles from the retry period: 60 s, then 120 s.
        let sec = 1_000_000;
        retry_outbox_on(&db, queue.emitter(), t0 + 29 * sec).await;
        assert_eq!(queued(&db).await[0].2, 2, "not due yet");
        retry_outbox_on(&db, queue.emitter(), t0 + 60 * sec).await;
        assert_eq!(queued(&db).await[0].2, 3);
        retry_outbox_on(&db, queue.emitter(), t0 + 120 * sec).await;
        assert_eq!(queued(&db).await[0].2, 3, "not due yet");
        retry_outbox_on(&db, queue.emitter(), t0 + 180 * sec).await;
        assert_eq!(queued(&db).await[0].2, 4);
        // A delivery still clears it once the queue is back.
        queue.down.store(false, Ordering::SeqCst);
        assert_eq!(
            retry_outbox_on(&db, queue.emitter(), t0 + 420 * sec).await,
            1
        );
        assert!(queued(&db).await.is_empty());

        let waits: Vec<i64> = (0..=10).map(outbox_backoff_secs).collect();
        assert_eq!(
            waits,
            [0, 0, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]
        );
        assert_eq!(outbox_backoff_secs(i32::MAX), OUTBOX_MAX_BACKOFF_SECS);
        let capped: Vec<i32> = (0..1000).filter(|a| reaches_max_backoff(*a)).collect();
        assert_eq!(capped, [8], "the cap is logged once");
    }

    #[test]
    fn a_row_round_trips_through_the_wire_json() {
        let mut row = link("l");
        row.deleted_at = Some(9);
        row.rev = 42;
        let json = serde_json::to_string(&row).unwrap();
        assert_eq!(serde_json::from_str::<PublicDashboard>(&json).unwrap(), row);
    }
}
