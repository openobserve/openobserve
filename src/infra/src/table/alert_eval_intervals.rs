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

//! The alert availability ledger (S-16) — proof that an alert was *evaluating*,
//! which no other table carries.
//!
//! Run-length encoded: one row per run of constant `(level, frequency_secs)`.
//! The decision of *whether* an evaluation belongs here, and how wide a gap
//! still counts as the same run, lives in
//! [`config::meta::alerts::state`][state] so it is testable without a database;
//! this module is the persistence layer plus the two arithmetic-free branches
//! (extend / close-and-open) that need the stored row to choose between them.
//!
//! [state]: config::meta::alerts::state

use config::meta::alerts::{level::AlertLevel, state::EvalLedgerWrite};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::alert_eval_intervals;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// One stored interval, as the SLI reader sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlertEvalInterval {
    pub id: i64,
    pub org: String,
    pub alert_id: String,
    /// The level held across the interval. `None` only when the stored integer
    /// is one this build cannot interpret — degraded rather than failing the
    /// read, the same way `alert_states` handles it. A reader must treat it as
    /// unmeasured: an interval whose level is unknown cannot say whether the
    /// time was good.
    pub level: Option<AlertLevel>,
    pub frequency_secs: i64,
    pub from_us: i64,
    pub to_us: i64,
}

impl From<alert_eval_intervals::Model> for AlertEvalInterval {
    fn from(m: alert_eval_intervals::Model) -> Self {
        Self {
            id: m.id,
            org: m.org,
            alert_id: m.alert_id,
            level: AlertLevel::from_i32(m.level),
            frequency_secs: m.frequency_secs,
            from_us: m.from_us,
            to_us: m.to_us,
        }
    }
}

/// Fold one measured evaluation into the ledger, inside the caller's
/// transaction — the same one the state row is written in, so a failure loses
/// both together and the ledger consequence is a gap (the safe direction).
///
/// Three outcomes, per S-16 §3.3:
///
/// * same level, same cadence, and the run is merely late → extend the open interval;
/// * level or cadence changed, or the gap exceeded `max_gap` → close it and open a new one;
/// * the evaluation is older than what is already recorded → do nothing.
///
/// That last case is the replay guard. The queue redelivers and the scheduler
/// retries, so this can be called with an evaluation the ledger has already
/// moved past; both branches refuse it, and the UPDATE carries the same
/// condition as a `WHERE to_us < :at` predicate so the check cannot be
/// separated from the write. The predicate is spelled as a comparison rather
/// than `SET to_us = max(to_us, :at)` because no spelling of a two-argument max
/// is portable across the three supported meta stores: SQLite has scalar
/// `max(a, b)` but no `GREATEST`, while Postgres and MySQL have `GREATEST` and
/// an aggregate-only `MAX`.
pub async fn record_evaluation_with<C: sea_orm::ConnectionTrait>(
    txn: &C,
    write: &EvalLedgerWrite,
) -> Result<(), errors::Error> {
    let latest = latest_interval(txn, &write.alert_id).await?;

    if let Some(row) = latest {
        let same_run = row.level == write.level.to_i32()
            && row.frequency_secs == write.frequency_secs
            && write.at - row.to_us <= write.max_gap_secs().saturating_mul(1_000_000);

        if same_run {
            // `to_us < :at` is the monotonic guard, and it is the only one this
            // branch has: a replayed evaluation the interval has already moved
            // past matches zero rows and cannot drag `to_us` backwards.
            alert_eval_intervals::Entity::update_many()
                .col_expr(
                    alert_eval_intervals::Column::ToUs,
                    sea_orm::sea_query::Expr::value(write.at),
                )
                .filter(alert_eval_intervals::Column::Id.eq(row.id))
                .filter(alert_eval_intervals::Column::ToUs.lt(write.at))
                .exec(txn)
                .await?;
            return Ok(());
        }

        // A *different* run, but older than what is recorded — a replay that
        // arrived after the level or cadence moved on. Opening it would splice
        // an interval into the middle of history, where a range read would find
        // two runs claiming the same microseconds and double-count the overlap.
        if write.at <= row.to_us {
            return Ok(());
        }
    }

    alert_eval_intervals::ActiveModel {
        org: Set(write.org.clone()),
        alert_id: Set(write.alert_id.clone()),
        level: Set(write.level.to_i32()),
        frequency_secs: Set(write.frequency_secs),
        from_us: Set(write.at),
        to_us: Set(write.at),
        ..Default::default()
    }
    .insert(txn)
    .await?;
    Ok(())
}

/// The alert's newest interval, which is the only one a new evaluation can
/// extend. Ordered by the leading columns of the one index this table has.
async fn latest_interval<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<Option<alert_eval_intervals::Model>, errors::Error> {
    Ok(alert_eval_intervals::Entity::find()
        .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
        .order_by_desc(alert_eval_intervals::Column::FromUs)
        .order_by_desc(alert_eval_intervals::Column::Id)
        .one(conn)
        .await?)
}

/// Every interval bearing on `[range_start_us, range_end_us]`, oldest first.
///
/// **Over-fetches backwards by exactly one row.** An interval that ended before
/// the range still covers into it: §5.3 extends each interval forward by its own
/// `frequency_secs`, so an interval ending one second before `range_start` with
/// a 300s cadence covers the range's first five minutes. `frequency_secs` varies
/// per row, so there is no fixed slack constant to widen the predicate with —
/// the latest interval starting before the range is fetched unconditionally and
/// the reader clamps it. One row, because intervals do not overlap: anything
/// older than that one ends no later than it starts.
///
/// Two queries, both bounded by `(alert_id, from_us)` — the read has to be an
/// index range scan, not a scan of the alert's whole retained history. That is
/// why the in-range query is written as `from_us BETWEEN start AND end` rather
/// than the intuitive `from_us <= end AND to_us >= start`: the latter is
/// one-sided on the indexed column and leaves `to_us` as an unindexed filter,
/// so a 30-day window would examine every row of a 97-day retention. The two
/// forms return the same intervals, because the *only* row that can start
/// before the range and still reach into it is the latest one starting before
/// it — which the second query fetches unconditionally anyway.
///
/// The two predicates partition on `from_us`, so nothing can be returned twice.
pub async fn list_overlapping(
    alert_id: &str,
    range_start_us: i64,
    range_end_us: i64,
) -> Result<Vec<AlertEvalInterval>, errors::Error> {
    let client = get_orm_client_rw().await;
    list_overlapping_with(client, alert_id, range_start_us, range_end_us).await
}

/// [`list_overlapping`] against a caller-supplied connection.
pub async fn list_overlapping_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    range_start_us: i64,
    range_end_us: i64,
) -> Result<Vec<AlertEvalInterval>, errors::Error> {
    let mut rows = alert_eval_intervals::Entity::find()
        .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
        .filter(alert_eval_intervals::Column::FromUs.gte(range_start_us))
        .filter(alert_eval_intervals::Column::FromUs.lte(range_end_us))
        .order_by_asc(alert_eval_intervals::Column::FromUs)
        .all(conn)
        .await?;

    let preceding = alert_eval_intervals::Entity::find()
        .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
        .filter(alert_eval_intervals::Column::FromUs.lt(range_start_us))
        .order_by_desc(alert_eval_intervals::Column::FromUs)
        .one(conn)
        .await?;

    if let Some(row) = preceding {
        rows.insert(0, row);
    }

    rows.sort_by_key(|r| (r.from_us, r.id));
    Ok(rows.into_iter().map(Into::into).collect())
}

/// The start of the oldest interval this alert still has, or `None` when the
/// ledger holds nothing for it.
///
/// One half of PR 4's backfill clamp: there is no evidence of the alert's
/// behaviour before this instant, so measuring earlier would fabricate coverage
/// out of retention's blind spot.
pub async fn earliest_from_us(alert_id: &str) -> Result<Option<i64>, errors::Error> {
    let client = get_orm_client_ro().await;
    earliest_from_us_with(client, alert_id).await
}

/// [`earliest_from_us`] against a caller-supplied connection.
pub async fn earliest_from_us_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<Option<i64>, errors::Error> {
    Ok(alert_eval_intervals::Entity::find()
        .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
        // An index-range scan on `(alert_id, from_us)`, like every other read
        // here — not a MIN() aggregate over the alert's whole retention.
        .order_by_asc(alert_eval_intervals::Column::FromUs)
        .one(conn)
        .await?
        .map(|m| m.from_us))
}

/// Retention, mirroring `alert_states::delete_transitions_before`.
///
/// Keyed on `to_us` so a run that is still open — or one that ended after the
/// cutoff but began long before it — survives. Deleting on `from_us` would
/// delete the interval an alert has been sitting in for months.
pub async fn delete_before(cutoff_us: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_before_with(client, cutoff_us).await
}

/// [`delete_before`] against a caller-supplied connection.
pub async fn delete_before_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    cutoff_us: i64,
) -> Result<u64, errors::Error> {
    let res = alert_eval_intervals::Entity::delete_many()
        .filter(alert_eval_intervals::Column::ToUs.lt(cutoff_us))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Remove an alert's whole ledger. Called when the alert is deleted — these
/// rows are owned by the alert's lifecycle, exactly like its state rows.
pub async fn delete_by_alert(alert_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_alert_with(client, alert_id).await
}

/// [`delete_by_alert`] against a caller-supplied connection.
pub async fn delete_by_alert_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<(), errors::Error> {
    alert_eval_intervals::Entity::delete_many()
        .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
        .exec(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::state::SCHEDULER_JITTER_ALLOWANCE_SECS;

    use super::*;

    const SEC: i64 = 1_000_000;
    /// A minute cadence, so `max_gap` is 60 + 0 + the jitter allowance.
    const FREQ: i64 = 60;
    const T0: i64 = 1_750_000_000_000_000;

    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        let stmt = schema.create_table_from_entity(alert_eval_intervals::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn write_at(at: i64, level: AlertLevel, frequency_secs: i64) -> EvalLedgerWrite {
        write_for("alert-1", at, level, frequency_secs)
    }

    fn write_for(
        alert_id: &str,
        at: i64,
        level: AlertLevel,
        frequency_secs: i64,
    ) -> EvalLedgerWrite {
        EvalLedgerWrite {
            org: "myorg".to_string(),
            alert_id: alert_id.to_string(),
            level,
            frequency_secs,
            tolerance_secs: 0,
            at,
        }
    }

    async fn intervals<C: sea_orm::ConnectionTrait>(
        conn: &C,
        alert_id: &str,
    ) -> Vec<AlertEvalInterval> {
        alert_eval_intervals::Entity::find()
            .filter(alert_eval_intervals::Column::AlertId.eq(alert_id))
            .order_by_asc(alert_eval_intervals::Column::FromUs)
            .all(conn)
            .await
            .unwrap()
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// Insert an interval directly, for the read tests — going through the
    /// write path would make them depend on its merge rules.
    async fn seed<C: sea_orm::ConnectionTrait>(
        conn: &C,
        alert_id: &str,
        from_us: i64,
        to_us: i64,
    ) -> i64 {
        alert_eval_intervals::ActiveModel {
            org: Set("myorg".to_string()),
            alert_id: Set(alert_id.to_string()),
            level: Set(AlertLevel::Ok.to_i32()),
            frequency_secs: Set(FREQ),
            from_us: Set(from_us),
            to_us: Set(to_us),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap()
        .id
    }

    // ── Write path (§3.3) ───────────────────────────────────────────────────

    #[tokio::test]
    async fn the_first_measured_evaluation_opens_an_interval() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].org, "myorg");
        assert_eq!(rows[0].level, Some(AlertLevel::Ok));
        assert_eq!(rows[0].frequency_secs, FREQ);
        assert_eq!(
            (rows[0].from_us, rows[0].to_us),
            (T0, T0),
            "an interval opens as a single instant, not a span"
        );
    }

    #[tokio::test]
    async fn a_repeat_at_the_same_level_and_cadence_extends_the_open_interval() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 120 * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(
            rows.len(),
            1,
            "storage is O(state changes), not O(evaluations)"
        );
        assert_eq!((rows[0].from_us, rows[0].to_us), (T0, T0 + 120 * SEC));
    }

    #[tokio::test]
    async fn a_level_change_closes_the_interval_and_opens_a_new_one() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Critical, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].level, Some(AlertLevel::Ok));
        assert_eq!(
            (rows[0].from_us, rows[0].to_us),
            (T0, T0),
            "the closed interval keeps the last instant it actually held Ok"
        );
        assert_eq!(rows[1].level, Some(AlertLevel::Critical));
        assert_eq!(
            (rows[1].from_us, rows[1].to_us),
            (T0 + 60 * SEC, T0 + 60 * SEC),
            "the new interval opens at the transition instant"
        );
    }

    /// §5.3: the cadence is on the row because it decides how far the interval
    /// covers forward. An interval spanning two cadences could not say which
    /// applies to which part of it.
    #[tokio::test]
    async fn a_cadence_change_closes_the_interval_and_opens_a_new_one() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, 60))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Ok, 300))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(
            rows.len(),
            2,
            "an interval must describe exactly one cadence"
        );
        assert_eq!(rows[0].frequency_secs, 60);
        assert_eq!(rows[1].frequency_secs, 300);
        assert_eq!(rows[1].from_us, T0 + 60 * SEC);
    }

    #[tokio::test]
    async fn a_run_arriving_exactly_at_max_gap_still_extends() {
        let db = db().await;
        let max_gap = FREQ + SCHEDULER_JITTER_ALLOWANCE_SECS;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + max_gap * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 1, "max_gap is inclusive: `<=`, not `<`");
        assert_eq!(rows[0].to_us, T0 + max_gap * SEC);
    }

    #[tokio::test]
    async fn a_run_one_microsecond_past_max_gap_opens_a_new_interval() {
        let db = db().await;
        let max_gap = FREQ + SCHEDULER_JITTER_ALLOWANCE_SECS;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + max_gap * SEC + 1, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].to_us, T0, "the old interval must not absorb it");
    }

    /// The whole reason `max_gap` is not `2 x frequency_secs`: merging here
    /// would claim the missed period as measured at the last-known level.
    #[tokio::test]
    async fn a_fully_missed_evaluation_is_never_merged_in() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        // One evaluation due at T0+60s never happened; the next lands on time.
        record_evaluation_with(&db, &write_at(T0 + 2 * FREQ * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(
            rows.len(),
            2,
            "a missed evaluation must read as a gap, at the cost of one row"
        );
    }

    /// The alert's own `tolerance_in_secs` is deliberate schedule jitter — the
    /// scheduler really does push the next run out by `rand(0, tolerance)` — so
    /// a run late by that much is still the next expected one, not a missed one.
    #[tokio::test]
    async fn the_alerts_configured_tolerance_widens_the_gap() {
        let db = db().await;
        // 300s cadence, 120s tolerance: 450s is late but well short of the 600s
        // that would mean an evaluation never happened.
        let late_by = 300 + 120 + SCHEDULER_JITTER_ALLOWANCE_SECS;
        let mut first = write_at(T0, AlertLevel::Ok, 300);
        first.tolerance_secs = 120;
        let mut second = write_at(T0 + late_by * SEC, AlertLevel::Ok, 300);
        second.tolerance_secs = 120;

        record_evaluation_with(&db, &first).await.unwrap();
        record_evaluation_with(&db, &second).await.unwrap();

        assert_eq!(intervals(&db, "alert-1").await.len(), 1);
    }

    /// Nothing validates `tolerance_in_secs` against `frequency`, so a
    /// tolerance wider than the cadence is representable — and if it widened
    /// `max_gap` freely, a whole missed evaluation would be merged in and its
    /// period credited as measured. The interval must close instead.
    #[tokio::test]
    async fn a_tolerance_wider_than_the_cadence_still_cannot_merge_a_missed_run() {
        let db = db().await;
        let mut first = write_at(T0, AlertLevel::Ok, FREQ);
        first.tolerance_secs = 600;
        let mut second = write_at(T0 + 2 * FREQ * SEC, AlertLevel::Ok, FREQ);
        second.tolerance_secs = 600;

        record_evaluation_with(&db, &first).await.unwrap();
        record_evaluation_with(&db, &second).await.unwrap();

        assert_eq!(
            intervals(&db, "alert-1").await.len(),
            2,
            "a gap of two full periods is a missed evaluation at any tolerance"
        );
    }

    // ── Replay and monotonicity ─────────────────────────────────────────────

    #[tokio::test]
    async fn an_exact_redelivery_changes_nothing() {
        let db = db().await;
        let w = write_at(T0, AlertLevel::Ok, FREQ);
        record_evaluation_with(&db, &w).await.unwrap();
        record_evaluation_with(&db, &w).await.unwrap();
        record_evaluation_with(&db, &w).await.unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 1, "a redelivered message must not open a run");
        assert_eq!((rows[0].from_us, rows[0].to_us), (T0, T0));
    }

    #[tokio::test]
    async fn a_replayed_older_evaluation_cannot_move_the_interval_backwards() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        // A scheduler retry, or the queue redelivering out of order.
        record_evaluation_with(&db, &write_at(T0 + 30 * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].to_us,
            T0 + 60 * SEC,
            "coverage must never shrink because a message arrived twice"
        );
    }

    /// The same guard on the *other* branch. A replayed evaluation whose level
    /// differs must not splice an interval into the middle of history, where a
    /// range read would find two runs claiming the same microseconds.
    #[tokio::test]
    async fn a_replayed_older_evaluation_at_another_level_opens_nothing() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 30 * SEC, AlertLevel::Critical, FREQ))
            .await
            .unwrap();

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 1, "no interval may start inside an older one");
        assert_eq!(rows[0].level, Some(AlertLevel::Ok));
        assert_eq!(rows[0].to_us, T0 + 60 * SEC);
    }

    /// An evaluation replayed at exactly the recorded end is the commonest
    /// redelivery and must not re-open the run either.
    #[tokio::test]
    async fn a_replay_at_the_recorded_end_after_a_level_change_opens_nothing() {
        let db = db().await;
        record_evaluation_with(&db, &write_at(T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Critical, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_at(T0 + 60 * SEC, AlertLevel::Critical, FREQ))
            .await
            .unwrap();

        assert_eq!(intervals(&db, "alert-1").await.len(), 2);
    }

    /// The extend branch must look at *this* alert's newest interval. Reading
    /// the table's newest row instead would have a busy alert's evaluations
    /// extend a quiet one's interval.
    #[tokio::test]
    async fn one_alerts_evaluations_never_touch_anothers_intervals() {
        let db = db().await;
        record_evaluation_with(&db, &write_for("alert-1", T0, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(&db, &write_for("alert-2", T0 + SEC, AlertLevel::Ok, FREQ))
            .await
            .unwrap();
        record_evaluation_with(
            &db,
            &write_for("alert-1", T0 + 60 * SEC, AlertLevel::Ok, FREQ),
        )
        .await
        .unwrap();

        let one = intervals(&db, "alert-1").await;
        assert_eq!(one.len(), 1);
        assert_eq!((one[0].from_us, one[0].to_us), (T0, T0 + 60 * SEC));

        let two = intervals(&db, "alert-2").await;
        assert_eq!(two.len(), 1);
        assert_eq!(
            (two[0].from_us, two[0].to_us),
            (T0 + SEC, T0 + SEC),
            "alert-2's interval must not have been extended by alert-1's run"
        );
    }

    // ── Read path ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_overlapping_returns_the_intervals_that_touch_the_range() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await; // ends inside
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 300 * SEC).await; // fully inside
        seed(&db, "alert-1", T0 + 400 * SEC, T0 + 900 * SEC).await; // starts inside
        seed(&db, "alert-1", T0 + 1000 * SEC, T0 + 1100 * SEC).await; // wholly after

        let rows = list_overlapping_with(&db, "alert-1", T0 + 50 * SEC, T0 + 500 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].from_us, T0);
        assert_eq!(rows[1].from_us, T0 + 200 * SEC);
        assert_eq!(rows[2].from_us, T0 + 400 * SEC);
    }

    /// The over-fetch. This interval ends before the range begins, so an
    /// overlap predicate alone drops it — and with it the forward extension
    /// that covers the range's first slice.
    #[tokio::test]
    async fn list_overlapping_also_returns_the_last_interval_that_ended_before_the_range() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 10 * SEC).await;
        seed(&db, "alert-1", T0 + 500 * SEC, T0 + 600 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0 + 100 * SEC, T0 + 700 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].from_us, rows[0].to_us),
            (T0, T0 + 10 * SEC),
            "the preceding interval still covers into the range via + frequency_secs"
        );
    }

    /// Exactly one, not all of them: intervals do not overlap, so anything older
    /// than the latest preceding one ends no later than that one starts and can
    /// reach no further into the range.
    #[tokio::test]
    async fn the_backwards_over_fetch_is_exactly_one_row() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 10 * SEC).await;
        seed(&db, "alert-1", T0 + 100 * SEC, T0 + 110 * SEC).await;
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 210 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0 + 500 * SEC, T0 + 900 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].from_us,
            T0 + 200 * SEC,
            "the latest preceding interval, not the earliest"
        );
    }

    /// The preceding row is usually one the overlap predicate already returned.
    /// Returning it twice would have the reader count its coverage twice.
    #[tokio::test]
    async fn an_interval_spanning_the_range_start_is_returned_once() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 900 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0 + 100 * SEC, T0 + 500 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].from_us, rows[0].to_us), (T0, T0 + 900 * SEC));
    }

    #[tokio::test]
    async fn list_overlapping_is_scoped_to_one_alert() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-2", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-2", T0 - 500 * SEC, T0 - 400 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0, T0 + 100 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].alert_id, "alert-1");
    }

    #[tokio::test]
    async fn list_overlapping_returns_nothing_for_an_alert_with_no_history() {
        let db = db().await;
        seed(&db, "alert-2", T0, T0 + 100 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0, T0 + 100 * SEC)
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn list_overlapping_returns_rows_oldest_first() {
        let db = db().await;
        seed(&db, "alert-1", T0 + 400 * SEC, T0 + 500 * SEC).await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 300 * SEC).await;

        let rows = list_overlapping_with(&db, "alert-1", T0, T0 + 900 * SEC)
            .await
            .unwrap();
        let starts: Vec<i64> = rows.iter().map(|r| r.from_us).collect();
        assert_eq!(starts, vec![T0, T0 + 200 * SEC, T0 + 400 * SEC]);
    }

    // ── Retention and lifecycle ─────────────────────────────────────────────

    #[tokio::test]
    async fn delete_before_removes_only_intervals_that_ended_before_the_cutoff() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 300 * SEC).await;
        seed(&db, "alert-1", T0 + 400 * SEC, T0 + 500 * SEC).await;

        let deleted = delete_before_with(&db, T0 + 300 * SEC).await.unwrap();
        assert_eq!(deleted, 1, "the cutoff is exclusive: to_us < cutoff");

        let rows = intervals(&db, "alert-1").await;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].from_us, T0 + 200 * SEC);
    }

    /// A long-running interval must survive until its *end* ages out, or an
    /// alert that has held Ok for months loses the proof it was evaluating.
    #[tokio::test]
    async fn delete_before_keeps_an_interval_that_began_before_the_cutoff_but_ends_after_it() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 900 * SEC).await;

        assert_eq!(delete_before_with(&db, T0 + 500 * SEC).await.unwrap(), 0);
        assert_eq!(intervals(&db, "alert-1").await.len(), 1);
    }

    #[tokio::test]
    async fn delete_by_alert_removes_that_alerts_history_and_no_one_elses() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 300 * SEC).await;
        seed(&db, "alert-2", T0, T0 + 100 * SEC).await;

        delete_by_alert_with(&db, "alert-1").await.unwrap();

        assert!(intervals(&db, "alert-1").await.is_empty());
        assert_eq!(intervals(&db, "alert-2").await.len(), 1);
    }

    /// Best-effort at the call site, so it is called on alerts that never
    /// evaluated as well.
    #[tokio::test]
    async fn delete_by_alert_is_idempotent() {
        let db = db().await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;

        delete_by_alert_with(&db, "alert-1").await.unwrap();
        delete_by_alert_with(&db, "alert-1").await.unwrap();
        delete_by_alert_with(&db, "never-evaluated").await.unwrap();
    }

    /// A level integer this build cannot interpret degrades to `None` rather
    /// than failing the whole read — but it must not silently read as `Ok`,
    /// which would turn unknown time into uptime.
    #[tokio::test]
    async fn an_uninterpretable_stored_level_degrades_to_none() {
        let db = db().await;
        alert_eval_intervals::ActiveModel {
            org: Set("myorg".to_string()),
            alert_id: Set("alert-1".to_string()),
            level: Set(999),
            frequency_secs: Set(FREQ),
            from_us: Set(T0),
            to_us: Set(T0 + 100 * SEC),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        let rows = list_overlapping_with(&db, "alert-1", T0, T0 + 100 * SEC)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].level, None);
    }

    // ---- the ledger's start (S-16 PR 4) ------------------------------------

    /// Half of PR 4's backfill clamp: there is no evidence of the alert's
    /// behaviour before this instant, so measuring earlier would fabricate
    /// coverage out of retention's blind spot.
    #[tokio::test]
    async fn the_ledger_start_is_the_oldest_intervals_beginning() {
        let db = db().await;
        seed(&db, "alert-1", T0 + 500 * SEC, T0 + 600 * SEC).await;
        seed(&db, "alert-1", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-1", T0 + 200 * SEC, T0 + 300 * SEC).await;

        assert_eq!(
            earliest_from_us_with(&db, "alert-1").await.unwrap(),
            Some(T0)
        );
    }

    /// An alert that has never evaluated has no floor to contribute — not a
    /// floor of zero, which would clamp every backfill to the epoch.
    #[tokio::test]
    async fn an_alert_with_no_ledger_has_no_start() {
        let db = db().await;
        assert_eq!(earliest_from_us_with(&db, "alert-1").await.unwrap(), None);
    }

    /// Scoped per alert, like every other read here: a busy neighbour's older
    /// history must not extend this alert's measurable past.
    #[tokio::test]
    async fn the_ledger_start_is_scoped_to_one_alert() {
        let db = db().await;
        seed(&db, "alert-2", T0, T0 + 100 * SEC).await;
        seed(&db, "alert-1", T0 + 900 * SEC, T0 + 1000 * SEC).await;

        assert_eq!(
            earliest_from_us_with(&db, "alert-1").await.unwrap(),
            Some(T0 + 900 * SEC)
        );
    }
}
