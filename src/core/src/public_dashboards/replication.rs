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

//! Super-cluster replication of link rows: one Put after every semantic write, an outbox that
//! retries failed emits, and the apply order of the consumer. Result files never replicate.

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
const OUTBOX_BATCH: u64 = 100;

/// Whether link rows replicate: Enterprise with the super cluster on, the guard dashboards use.
pub fn enabled() -> bool {
    #[cfg(feature = "enterprise")]
    return o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    false
}

/// Sends the row to the other regions; a failed send is queued in the outbox.
pub async fn replicate(row: &PublicDashboard) {
    if enabled() {
        replicate_on(get_orm_client_rw().await, row, emit).await;
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
        replicate_on(db, row.as_ref(), send).await;
    }
    Ok(())
}

pub(crate) async fn replicate_on<C, F, Fut>(db: &C, row: &PublicDashboard, emit: F)
where
    C: ConnectionTrait,
    F: Fn(PublicDashboard) -> Fut,
    Fut: Future<Output = Result<(), anyhow::Error>>,
{
    let Err(e) = emit(row.clone()).await else {
        return;
    };
    log::error!(
        "[public_dashboards] replicating link {} at rev {} failed, queued for retry: {e}",
        row.id,
        row.rev
    );
    if let Err(e) = pd_table::outbox_put(db, &row.id, row.rev, now_micros()).await {
        log::error!(
            "[public_dashboards] queueing link {} for replication failed: {e}",
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
    let due = match pd_table::outbox_list_due(db, now, OUTBOX_BATCH).await {
        Ok(due) => due,
        Err(e) => {
            log::error!("[public_dashboards] reading the outbox failed: {e}");
            return 0;
        }
    };
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
                log::warn!("[public_dashboards] outbox retry of {}: {e}", row.id);
                pd_table::outbox_bump_attempts(db, &row.id, now).await
            }
        };
        if let Err(e) = result {
            log::error!("[public_dashboards] outbox update of {}: {e}", row.id);
        }
    }
    sent
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

    #[tokio::test]
    async fn gate07_a_failed_emit_is_repaired_by_the_outbox() {
        let db = db().await;
        let mut row = link("l");
        pd_table::insert_capped(&db, &row, 10, 10).await.unwrap();
        let queue = Queue::default();
        queue.down.store(true, Ordering::SeqCst);

        replicate_on(&db, &row, queue.emitter()).await;
        assert_eq!(
            pd_table::outbox_list_due(&db, i64::MAX, 10)
                .await
                .unwrap()
                .len(),
            1
        );
        // Still down: the entry stays and counts the attempt.
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 0);
        let entry = &pd_table::outbox_list_due(&db, i64::MAX, 10).await.unwrap()[0];
        assert_eq!((entry.rev, entry.attempts), (1, 1));

        // A newer local write lands before the queue recovers; the retry sends that one.
        row.enabled = false;
        row.rev = 5;
        assert!(pd_table::update_cas(&db, &row, 1).await.unwrap());
        queue.down.store(false, Ordering::SeqCst);
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 1);
        let sent = queue.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 1);
        assert_eq!((sent[0].rev, sent[0].enabled), (5, false));
        assert!(
            pd_table::outbox_list_due(&db, i64::MAX, 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn gate07_a_delivered_emit_leaves_nothing_in_the_outbox() {
        let db = db().await;
        let row = link("l");
        pd_table::insert_capped(&db, &row, 10, 10).await.unwrap();
        let queue = Queue::default();
        replicate_on(&db, &row, queue.emitter()).await;
        assert_eq!(queue.sent.lock().unwrap().len(), 1);
        assert!(
            pd_table::outbox_list_due(&db, i64::MAX, 10)
                .await
                .unwrap()
                .is_empty()
        );

        // An entry whose row was purged is dropped without sending anything.
        pd_table::outbox_put(&db, "gone", 3, 1).await.unwrap();
        assert_eq!(retry_outbox_on(&db, queue.emitter(), now_micros()).await, 0);
        assert!(
            pd_table::outbox_list_due(&db, i64::MAX, 10)
                .await
                .unwrap()
                .is_empty()
        );
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
