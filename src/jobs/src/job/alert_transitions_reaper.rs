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

//! Retention for the alert state change log (`alert_state_transitions`), in bounded batches.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::cluster::{Node, NodeStatus},
    spawn_pausable_job,
    utils::time::now_micros,
};
use infra::{errors, table::alert_states::delete_transitions_batch_before_with};
use rand::RngExt;
use sea_orm::{ConnectionTrait, TransactionTrait};

/// Rows per delete transaction (D:L259).
const BATCH_ROWS: u64 = 1_000;
/// A pass stops here and leaves the rest to the next one (D:L259 "timeout/cancellation").
const PASS_BUDGET_SECS: u64 = 900;
/// Gives SQLite's single writer room for evaluation writes between batches.
const BATCH_PAUSE_MS: u64 = 50;
/// Daily rather than the ledger's hourly cadence (D:L259).
const INTERVAL_SECS: u64 = 86_400;
/// Spreads the daily pass so regions restarted together do not sweep together (D:L259).
const JITTER_SECS: u64 = 3_600;
/// A daily first wait never elapses on a node restarted daily (ledger reaper `:32-35`).
const FIRST_WAIT_SECS: (u64, u64) = (60, 660);
/// Alert calibration's largest window (ENT `alert_calibration_service/org_config.rs:37-38`).
const LONGEST_READER_DAYS: i64 = 90;
/// Room for a late or re-claimed calibration run, the margin the ledger reaper keeps.
const HEADROOM_DAYS: i64 = 7;

#[derive(Debug, PartialEq, Eq)]
enum PassOutcome {
    NotLeader,
    Disabled,
    Swept {
        deleted: u64,
        batches: u32,
        complete: bool,
    },
}

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[ALERT_TRANSITIONS_REAPER] not a scheduler node, skipping");
        return;
    }

    let days = get_config().limit.alert_transitions_retention_days;
    log::info!("[ALERT_TRANSITIONS_REAPER] initialized with retention: {days}d");
    if days <= 0 {
        log::info!(
            "[ALERT_TRANSITIONS_REAPER] paused: ZO_ALERT_TRANSITIONS_RETENTION_DAYS is {days}, so alert state changes are kept until it is set above 0"
        );
    } else if days < LONGEST_READER_DAYS + HEADROOM_DAYS {
        log::warn!(
            "[ALERT_TRANSITIONS_REAPER] Alert state changes are kept for {days} days, less than the {LONGEST_READER_DAYS}-day alert calibration window plus {HEADROOM_DAYS} days; calibration will see a shorter history."
        );
    }

    let first = AtomicBool::new(true);
    spawn_pausable_job!(
        "alert_transitions_reaper",
        // Evaluated even while paused; skipping it keeps the short first wait for an unpause.
        if retention_paused() {
            0
        } else {
            next_wait_secs(&first)
        },
        {
            let leader = elect(
                infra::cluster::get_cached_nodes(|node| {
                    node.status == NodeStatus::Online && node.is_scheduler()
                })
                .await,
                &LOCAL_NODE.uuid,
            );
            let days = get_config().limit.alert_transitions_retention_days;
            let now = now_micros();
            let started = Instant::now();
            let deadline = started + Duration::from_secs(PASS_BUDGET_SECS);
            let conn = infra::db::get_orm_client_rw().await;
            let outcome = pass(conn, leader, now, days, deadline).await;
            report(outcome, now, days, started.elapsed());
        },
        pause_if: retention_paused()
    );
}

fn retention_paused() -> bool {
    get_config().limit.alert_transitions_retention_days <= 0
}

/// Lowest-uuid online scheduler leads, the ledger reaper's rule.
fn elect(nodes: Option<Vec<Node>>, local_uuid: &str) -> bool {
    match nodes {
        Some(nodes) if !nodes.is_empty() => nodes
            .iter()
            .min_by(|a, b| a.uuid.cmp(&b.uuid))
            .is_some_and(|node| node.uuid == local_uuid),
        // With no cluster view, assume a single node and do the work.
        _ => true,
    }
}

/// The instant before which state changes may be dropped, or `None` when retention is disabled.
fn retention_cutoff_us(now_us: i64, retention_days: i64) -> Option<i64> {
    if retention_days <= 0 {
        return None;
    }
    // Saturating: a wrapped span from an absurd env value would put the cutoff in the future.
    let span_us = retention_days
        .saturating_mul(86_400)
        .saturating_mul(1_000_000);
    Some(now_us.saturating_sub(span_us))
}

fn next_wait_secs(first: &AtomicBool) -> u64 {
    let mut rng = rand::rng();
    if first.swap(false, Ordering::Relaxed) {
        rng.random_range(FIRST_WAIT_SECS.0..FIRST_WAIT_SECS.1)
    } else {
        INTERVAL_SECS + rng.random_range(0..JITTER_SECS)
    }
}

/// Deletes due rows batch by batch until a batch comes back short or the deadline passes.
async fn pass<C>(
    conn: &C,
    leader: bool,
    now_us: i64,
    days: i64,
    deadline: Instant,
) -> Result<PassOutcome, errors::Error>
where
    C: ConnectionTrait + TransactionTrait,
{
    if !leader {
        return Ok(PassOutcome::NotLeader);
    }
    let Some(cutoff) = retention_cutoff_us(now_us, days) else {
        return Ok(PassOutcome::Disabled);
    };
    let (mut after, mut deleted, mut batches) = (0, 0, 0);
    loop {
        let batch = delete_transitions_batch_before_with(conn, cutoff, after, BATCH_ROWS).await?;
        deleted += batch.deleted;
        let Some(last_id) = batch.last_id else {
            return Ok(PassOutcome::Swept {
                deleted,
                batches,
                complete: true,
            });
        };
        batches += 1;
        after = last_id;
        // Selected, not deleted: rows a concurrent delete took still count toward a full batch.
        if batch.selected < BATCH_ROWS {
            return Ok(PassOutcome::Swept {
                deleted,
                batches,
                complete: true,
            });
        }
        if Instant::now() >= deadline {
            return Ok(PassOutcome::Swept {
                deleted,
                batches,
                complete: false,
            });
        }
        tokio::time::sleep(Duration::from_millis(BATCH_PAUSE_MS)).await;
    }
}

fn report(outcome: Result<PassOutcome, errors::Error>, now_us: i64, days: i64, took: Duration) {
    let cutoff = retention_cutoff_us(now_us, days)
        .and_then(chrono::DateTime::from_timestamp_micros)
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default();
    match outcome {
        Ok(PassOutcome::NotLeader) => {
            log::debug!("[ALERT_TRANSITIONS_REAPER] not leader, skipping this pass")
        }
        Ok(PassOutcome::Disabled) => {
            log::debug!("[ALERT_TRANSITIONS_REAPER] retention disabled, skipping this pass")
        }
        Ok(PassOutcome::Swept {
            deleted: 0,
            complete: true,
            ..
        }) => log::debug!("[ALERT_TRANSITIONS_REAPER] no state changes older than {days} days"),
        Ok(PassOutcome::Swept {
            deleted,
            batches,
            complete: true,
        }) => log::info!(
            "[ALERT_TRANSITIONS_REAPER] deleted {deleted} state changes older than {days} days (before {cutoff}) in {batches} batches ({:.1}s)",
            took.as_secs_f64()
        ),
        Ok(PassOutcome::Swept {
            deleted,
            batches,
            complete: false,
        }) => log::warn!(
            "[ALERT_TRANSITIONS_REAPER] deleted {deleted} state changes older than {days} days (before {cutoff}), then stopped after {batches} batches at the {PASS_BUDGET_SECS}s pass limit; the rest is deleted on the next pass"
        ),
        Err(e) => log::error!(
            "[ALERT_TRANSITIONS_REAPER] deleting state changes older than {days} days failed: {e}; the next pass retries"
        ),
    }
}

#[cfg(test)]
mod tests {
    use infra::table::entity::alert_state_transitions;
    use sea_orm::{Database, DatabaseConnection, EntityTrait, Schema, Set, Statement};

    use super::*;

    const DAY_US: i64 = 86_400 * 1_000_000;
    const NOW: i64 = 1_750_000_000_000_000;

    async fn db(with_table: bool) -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        if with_table {
            let backend = db.get_database_backend();
            let table =
                Schema::new(backend).create_table_from_entity(alert_state_transitions::Entity);
            db.execute(backend.build(&table)).await.unwrap();
        }
        db
    }

    async fn seed(db: &DatabaseConnection, ats: &[i64]) {
        let rows: Vec<_> = ats
            .iter()
            .map(|&at| alert_state_transitions::ActiveModel {
                alert_id: Set("a-old".to_string()),
                group_key: Set(String::new()),
                from_outcome: Set(None),
                to_outcome: Set(0),
                from_level: Set(None),
                to_level: Set(None),
                at: Set(at),
                value: Set(None),
                rule_value: Set(None),
                group_labels: Set(None),
                ..Default::default()
            })
            .collect();
        for chunk in rows.chunks(500) {
            alert_state_transitions::Entity::insert_many(chunk.to_vec())
                .exec(db)
                .await
                .unwrap();
        }
    }

    async fn ats(db: &DatabaseConnection) -> Vec<i64> {
        let mut ats: Vec<i64> = alert_state_transitions::Entity::find()
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.at)
            .collect();
        ats.sort_unstable();
        ats
    }

    fn node(uuid: &str) -> Node {
        Node {
            uuid: uuid.to_string(),
            ..Default::default()
        }
    }

    fn later() -> Instant {
        Instant::now() + Duration::from_secs(PASS_BUDGET_SECS)
    }

    /// One-connection pools on a throwaway schema of the `ZO_META_POSTGRES_DSN` Postgres.
    async fn postgres_pools(
        n: usize,
    ) -> Option<(DatabaseConnection, String, Vec<DatabaseConnection>)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        // The SQLite lane sets the variable empty rather than unsetting it.
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!("atr_test_{}", config::ider::generate().to_ascii_lowercase());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut pools = Vec::new();
        for _ in 0..n {
            let mut options = sea_orm::ConnectOptions::new(dsn.clone());
            options
                .max_connections(1)
                .min_connections(1)
                .set_schema_search_path(schema.clone());
            pools.push(Database::connect(options).await.unwrap());
        }
        let backend = pools[0].get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(alert_state_transitions::Entity);
        pools[0].execute(backend.build(&table)).await.unwrap();
        Some((admin, schema, pools))
    }

    async fn drop_schema(admin: DatabaseConnection, schema: &str, pools: Vec<DatabaseConnection>) {
        for pool in pools {
            pool.close().await.unwrap();
        }
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }

    /// Waits until a session of this database is blocked on a row lock in the transition table.
    async fn wait_for_a_blocked_delete(admin: &DatabaseConnection) {
        let probe = Statement::from_string(
            admin.get_database_backend(),
            "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() \
             AND wait_event_type = 'Lock' AND query ILIKE 'DELETE FROM %alert_state_transitions%'",
        );
        for _ in 0..3_000 {
            let row = admin.query_one(probe.clone()).await.unwrap().unwrap();
            if row.try_get::<i64>("", "n").unwrap() > 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the pass never blocked on the row the other transaction is deleting");
    }

    #[test]
    fn the_cutoff_is_exactly_that_many_days_of_microseconds_back() {
        assert_eq!(retention_cutoff_us(NOW, 1), Some(NOW - DAY_US));
        assert_eq!(retention_cutoff_us(NOW, 97), Some(NOW - 97 * DAY_US));
    }

    #[test]
    fn a_non_positive_or_absurd_retention_never_moves_the_cutoff_forward() {
        assert_eq!(retention_cutoff_us(NOW, 0), None);
        assert_eq!(retention_cutoff_us(NOW, -1), None);
        assert!(retention_cutoff_us(NOW, i64::MAX).unwrap() < NOW - 97 * DAY_US);
    }

    /// Reads the effective config, so an explicit override is the operator's choice and skipped.
    #[test]
    fn the_default_retention_covers_the_longest_reader() {
        if std::env::var("ZO_ALERT_TRANSITIONS_RETENTION_DAYS").is_ok() {
            return;
        }
        assert!(
            get_config().limit.alert_transitions_retention_days
                >= LONGEST_READER_DAYS + HEADROOM_DAYS,
            "ZO_ALERT_TRANSITIONS_RETENTION_DAYS must cover the 90-day calibration window plus headroom"
        );
    }

    #[tokio::test]
    async fn a_non_leader_pass_touches_nothing() {
        let db = db(true).await;
        seed(&db, &[NOW - 100 * DAY_US; 50]).await;
        let outcome = pass(&db, false, NOW, 97, later()).await.unwrap();
        assert_eq!(outcome, PassOutcome::NotLeader);
        assert_eq!(ats(&db).await.len(), 50);
    }

    #[test]
    fn the_election_picks_the_lowest_online_scheduler_and_falls_back_to_self() {
        assert!(elect(Some(vec![node("b"), node("a")]), "a"));
        assert!(!elect(Some(vec![node("a"), node("b")]), "b"));
        assert!(elect(None, "a"));
        assert!(elect(Some(vec![]), "a"));
    }

    #[tokio::test]
    async fn a_pass_stops_at_its_deadline_and_the_next_pass_finishes() {
        let db = db(true).await;
        seed(&db, &[NOW - 100 * DAY_US; 2_500]).await;
        let first = pass(&db, true, NOW, 97, Instant::now()).await.unwrap();
        assert_eq!(
            first,
            PassOutcome::Swept {
                deleted: 1_000,
                batches: 1,
                complete: false,
            }
        );
        let second = pass(&db, true, NOW, 97, later()).await.unwrap();
        assert_eq!(
            second,
            PassOutcome::Swept {
                deleted: 1_500,
                batches: 2,
                complete: true,
            }
        );
        assert!(ats(&db).await.is_empty());
    }

    #[tokio::test]
    async fn the_cutoff_follows_config_each_pass() {
        let db = db(true).await;
        let (old, older, recent) = (NOW - 40 * DAY_US, NOW - 100 * DAY_US, NOW - DAY_US);
        seed(&db, &[old, older, recent]).await;
        pass(&db, true, NOW, 97, later()).await.unwrap();
        assert_eq!(ats(&db).await, [old, recent]);
        pass(&db, true, NOW, 30, later()).await.unwrap();
        assert_eq!(ats(&db).await, [recent]);
        let paused = pass(&db, true, NOW, 0, later()).await.unwrap();
        assert_eq!(paused, PassOutcome::Disabled);
        assert_eq!(ats(&db).await, [recent]);
    }

    #[tokio::test]
    async fn a_failed_batch_ends_the_pass_with_an_error() {
        let db = db(false).await;
        assert!(pass(&db, true, NOW, 97, later()).await.is_err());
    }

    #[test]
    fn the_first_wait_is_short_and_later_waits_are_a_jittered_day() {
        let first = AtomicBool::new(true);
        let waits: Vec<u64> = (0..200).map(|_| next_wait_secs(&first)).collect();
        assert!((60..660).contains(&waits[0]), "{}", waits[0]);
        assert!(
            waits[1..].iter().all(|w| (86_400..90_000).contains(w)),
            "{waits:?}"
        );
    }

    #[tokio::test]
    async fn a_concurrent_delete_of_selected_rows_does_not_end_the_pass_early() {
        let Some((admin, schema, pools)) = postgres_pools(2).await else {
            return;
        };
        let (reaper, other) = (&pools[0], &pools[1]);
        seed(reaper, &[NOW - 100 * DAY_US; 2_500]).await;
        let held = alert_state_transitions::Entity::find()
            .all(reaper)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .min()
            .unwrap()
            + 10;
        let txn = other.begin().await.unwrap();
        alert_state_transitions::Entity::delete_by_id(held)
            .exec(&txn)
            .await
            .unwrap();
        let release = async {
            wait_for_a_blocked_delete(&admin).await;
            txn.commit().await.unwrap();
        };
        let (outcome, ()) = tokio::join!(pass(reaper, true, NOW, 97, later()), release);
        assert_eq!(
            outcome.unwrap(),
            PassOutcome::Swept {
                deleted: 2_499,
                batches: 3,
                complete: true,
            }
        );
        assert!(ats(reaper).await.is_empty());
        drop_schema(admin, &schema, pools).await;
        println!(
            "postgres arm ran: {}",
            std::thread::current().name().unwrap_or("?")
        );
    }
}
