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

//! Durable alert run state — Part IV of `alerts.md`.
//!
//! The *decision* logic (whether to write, whether a transition occurred) lives
//! in `config::meta::alerts::state` so it is unit-testable without a database.
//! This module is the persistence layer only.

use config::meta::{
    alerts::{
        dispatch::DeliveryEpisode,
        grouping::GroupPlan,
        level::AlertLevel,
        state::{AlertState, EvalLedgerWrite, ROLLUP_GROUP_KEY, StateTransition, StateUpdate},
    },
    self_reporting::usage::RunOutcome,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};

use super::entity::{alert_state_transitions, alert_states, alerts};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Convert a stored row into the domain type. An unrecognised `last_outcome`
/// integer degrades to `None` ("never evaluated") rather than failing the read —
/// a value we cannot interpret is not worth taking the list endpoint down for.
impl From<alert_states::Model> for AlertState {
    fn from(m: alert_states::Model) -> Self {
        Self {
            alert_id: m.alert_id,
            group_key: m.group_key,
            last_outcome: m.last_outcome.and_then(RunOutcome::from_i32),
            last_outcome_at: m.last_outcome_at,
            since: m.since,
            // Like `last_outcome`, an uninterpretable level degrades to None
            // ("never classified") rather than failing the read.
            level: m.level.and_then(AlertLevel::from_i32),
            level_since: m.level_since,
            level_at: m.level_at,
            last_seen: m.last_seen,
            group_labels: m.group_labels,
            groups_observed: m.groups_observed.map(|c| c as usize),
            groups_firing: m.groups_firing.map(|c| c as usize),
            groups_observed_is_lower_bound: m.groups_observed_is_lower_bound,
            groups_firing_is_lower_bound: m.groups_firing_is_lower_bound,
            silenced_until: m.silenced_until,
            last_notified_level: m.last_notified_level.and_then(AlertLevel::from_i32),
        }
    }
}

/// Fetch the state row for one `(alert_id, group_key)`.
pub async fn get(alert_id: &str, group_key: &str) -> Result<Option<AlertState>, errors::Error> {
    let client = get_orm_client_ro().await;
    get_with(client, alert_id, group_key).await
}

/// [`get`] against a caller-supplied connection.
///
/// The `_with` variants exist so the state machine can be exercised against a
/// real schema in tests — the same shape `alerts::create`/`update` already use.
/// Everything public delegates here, so a test cannot accidentally verify a
/// different code path from the one production runs.
pub async fn get_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    group_key: &str,
) -> Result<Option<AlertState>, errors::Error> {
    Ok(
        alert_states::Entity::find_by_id((alert_id.to_string(), group_key.to_string()))
            .one(conn)
            .await?
            .map(Into::into),
    )
}

/// Fetch the rollup rows for a batch of alerts — what the alert list needs.
/// One query, not N.
pub async fn get_rollups(alert_ids: &[String]) -> Result<Vec<AlertState>, errors::Error> {
    if alert_ids.is_empty() {
        return Ok(vec![]);
    }
    let client = get_orm_client_ro().await;
    Ok(alert_states::Entity::find()
        .filter(alert_states::Column::AlertId.is_in(alert_ids.to_vec()))
        .filter(alert_states::Column::GroupKey.eq(ROLLUP_GROUP_KEY))
        .all(client)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// All per-group rows for one alert.
pub async fn list_groups(alert_id: &str) -> Result<Vec<AlertState>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_groups_with(client, alert_id).await
}

/// [`list_groups`] against a caller-supplied connection.
pub async fn list_groups_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<Vec<AlertState>, errors::Error> {
    Ok(alert_states::Entity::find()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .filter(alert_states::Column::GroupKey.ne(ROLLUP_GROUP_KEY))
        .all(conn)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Persist a [`StateUpdate`] produced by
/// `config::meta::alerts::state::apply_outcome`, plus this evaluation's
/// contribution to the availability ledger (S-16) when it has one.
///
/// The state upsert, its transition insert and the ledger extension go in one
/// transaction: a transition that is not reflected in current state (or vice
/// versa) would make recovery pairing unreliable, which is the whole reason
/// this is not on the lossy stream path — and a ledger that disagreed with the
/// state row about whether an evaluation happened would put fabricated coverage
/// and lost coverage one crash apart. A failure loses both together, and the
/// ledger consequence of that is a gap, which is the safe direction (D34).
pub async fn persist(
    update: &StateUpdate,
    ledger: Option<&EvalLedgerWrite>,
) -> Result<(), errors::Error> {
    if update.state.is_none() && ledger.is_none() {
        return Ok(());
    }
    let client = get_orm_client_rw().await;
    persist_with(client, update, ledger).await
}

/// [`persist`] against a caller-supplied connection.
pub async fn persist_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    update: &StateUpdate,
    ledger: Option<&EvalLedgerWrite>,
) -> Result<(), errors::Error> {
    if update.state.is_none() && ledger.is_none() {
        return Ok(());
    }

    let txn = conn.begin().await?;
    write_update(&txn, update).await?;
    if let Some(write) = ledger {
        crate::table::alert_eval_intervals::record_evaluation_with(&txn, write).await?;
    }
    txn.commit().await?;
    Ok(())
}

/// Persist one grouped evaluation's entire [`GroupPlan`] in a **single
/// transaction** (§7.2).
///
/// Atomicity is not incidental here: composites read the rollup row, so a
/// rollup committed alongside only some of its group rows would hand them a
/// state that never existed. The evictions go in the same transaction for the
/// same reason — a cap overflow that upserted the winners but failed to delete
/// the displaced rows would leave stored rows above the cap.
///
/// Returns `false` when the plan was dropped by the opt-out gate below rather
/// than written. The caller needs to be able to tell the two apart: the
/// super-cluster wrapper must not broadcast a plan this region refused, or a
/// region that has not yet seen the opt-out would materialise exactly the rows
/// the toggle promised to remove.
pub async fn persist_group_plan(plan: &GroupPlan, alert_id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    persist_group_plan_with(client, plan, alert_id).await
}

/// [`persist_group_plan`] against a caller-supplied connection.
pub async fn persist_group_plan_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    plan: &GroupPlan,
    alert_id: &str,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;

    // §5.3 opt-out race: this evaluation may have read the alert BEFORE a save
    // turned `multi_alert` off, in which case its group rows would be written
    // after the save-time cleanup already ran — resurrecting exactly the rows
    // the toggle promised to remove. Re-reading the flag inside the plan's own
    // transaction is what makes "the group table empties on save" hold: past
    // this point, no in-flight evaluation can put rows back.
    if !multi_alert_still_enabled(&txn, alert_id).await? {
        txn.commit().await?;
        log::debug!(
            "alert {alert_id}: per-group alerting was turned off mid-evaluation; dropping this \
             evaluation's group writes"
        );
        return Ok(false);
    }

    for update in &plan.updates {
        write_update(&txn, update).await?;
    }

    // Evicted rows are deleted outright with NO transition (M-6): an eviction
    // is bookkeeping, not a level change — the group may well still be firing,
    // so a recovery row would be a lie.
    if !plan.evicted.is_empty() {
        alert_states::Entity::delete_many()
            .filter(alert_states::Column::AlertId.eq(alert_id))
            .filter(alert_states::Column::GroupKey.is_in(plan.evicted.clone()))
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(true)
}

/// Record a per-group delivery outcome (§5.5 MN-6/MN-7), conditionally.
///
/// Writes **only** the columns the given kind owns, under a `WHERE level = ?
/// AND level_since = ?` predicate — the level-episode version the delivery
/// carried. One statement, so the check and the write cannot interleave:
/// a read-check-write in Rust would reintroduce exactly the race the column
/// split above exists to remove, and would also let a callback echo back
/// observation fields it read before the latest evaluation.
///
/// Returns `true` when the row was updated, `false` when the episode had moved
/// on and the callback was correctly dropped as stale.
pub async fn advance_delivery_state(
    alert_id: &str,
    group_key: &str,
    episode: DeliveryEpisode,
    outcome: DeliveryOutcome,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    advance_delivery_state_with(client, alert_id, group_key, episode, outcome).await
}

/// [`advance_delivery_state`] against a caller-supplied connection.
pub async fn advance_delivery_state_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    alert_id: &str,
    group_key: &str,
    episode: DeliveryEpisode,
    outcome: DeliveryOutcome,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;

    let Some(current) =
        alert_states::Entity::find_by_id((alert_id.to_string(), group_key.to_string()))
            .one(&txn)
            .await?
            .map(AlertState::from)
    else {
        txn.rollback().await?;
        return Ok(false);
    };

    // The DECISION comes from the pure contract — staleness guards, the
    // silence-window floor, the outcome-axis invariants all live in `dispatch`
    // and are unit-tested there rather than restated as SET clauses.
    //
    // The WRITE still carries the same guards in its `WHERE`, and every arm
    // checks `rows_affected`. Validating in Rust alone would leave a window
    // between the read and the write in which a concurrent evaluation can
    // commit a recovery or a new level — and the stale callback would then
    // silence (or resurrect) an episode that no longer exists.
    let guarded = || {
        alert_states::Entity::update_many()
            .filter(alert_states::Column::AlertId.eq(alert_id))
            .filter(alert_states::Column::GroupKey.eq(group_key))
            .filter(alert_states::Column::Level.eq(episode.level.to_i32()))
            .filter(alert_states::Column::LevelSince.eq(episode.level_since))
    };
    // TEMP

    let affected = match outcome {
        DeliveryOutcome::Delivered {
            silence_minutes,
            at,
        } => {
            let Some(next) = config::meta::alerts::dispatch::delivery_success_update(
                &current,
                episode,
                silence_minutes,
                at,
            ) else {
                txn.rollback().await?;
                return Ok(false);
            };

            // Targeted columns, NOT `write_update`: the upsert's conflict
            // clause deliberately excludes the delivery columns (one-writer
            // rule, §5.5 MN-2), so routing this through it would write nothing.
            guarded()
                .col_expr(
                    alert_states::Column::LastNotifiedLevel,
                    sea_orm::sea_query::Expr::value(next.last_notified_level.map(|l| l.to_i32())),
                )
                .col_expr(
                    alert_states::Column::SilencedUntil,
                    sea_orm::sea_query::Expr::value(next.silenced_until),
                )
                .exec(&txn)
                .await?
                .rows_affected
        }

        DeliveryOutcome::Failed { at } => {
            let Some(update) =
                config::meta::alerts::dispatch::delivery_failure_update(&current, episode, at)
            else {
                txn.rollback().await?;
                return Ok(false);
            };
            let Some(next) = update.state.as_ref() else {
                txn.rollback().await?;
                return Ok(false);
            };

            // A failure also carries the ATTEMPT anchor into the predicates: a
            // newer success in this episode has already moved delivery state,
            // and `eq(NULL)` is never true, so a never-delivered anchor must be
            // matched with IS NULL.
            let (notified_level, silenced_until) = episode.notified_at_enqueue;
            let mut stmt = match notified_level {
                Some(l) => guarded().filter(alert_states::Column::LastNotifiedLevel.eq(l.to_i32())),
                None => guarded().filter(alert_states::Column::LastNotifiedLevel.is_null()),
            };
            stmt = match silenced_until {
                Some(t) => stmt.filter(alert_states::Column::SilencedUntil.eq(t)),
                None => stmt.filter(alert_states::Column::SilencedUntil.is_null()),
            };

            let affected = stmt
                .col_expr(
                    alert_states::Column::LastOutcome,
                    sea_orm::sea_query::Expr::value(RunOutcome::NotifyFailed.to_i32()),
                )
                .col_expr(
                    alert_states::Column::LastOutcomeAt,
                    sea_orm::sea_query::Expr::value(next.last_outcome_at),
                )
                .col_expr(
                    alert_states::Column::Since,
                    sea_orm::sea_query::Expr::value(next.since),
                )
                .exec(&txn)
                .await?
                .rows_affected;

            // The transition only goes in if the state write actually landed,
            // and in the same transaction — history must never describe a
            // change that was not applied (MN-9).
            if affected > 0
                && let Some(t) = update.transition.as_ref()
            {
                write_transition(&txn, t).await?;
            }
            affected
        }
    };

    if affected == 0 {
        // The guard matched nothing: the episode moved on between the read and
        // the write. Correctly dropped rather than applied.
        txn.rollback().await?;
        return Ok(false);
    }
    txn.commit().await?;
    Ok(true)
}

/// Which delivery outcome [`advance_delivery_state`] should record.
///
/// Serializable because the advance replicates across a super cluster by
/// re-running the same guarded write in every other region.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DeliveryOutcome {
    Delivered {
        /// The alert's configured silence, in minutes. The window itself is
        /// computed by `dispatch::delivery_success_update` — one place, so the
        /// scheduler and the persistence layer cannot disagree about it.
        silence_minutes: i64,
        at: i64,
    },
    Failed {
        at: i64,
    },
}

/// Every alert that currently has at least one per-group state row.
///
/// The M-7 sweep's entry point. Distinct alert ids rather than all rows: the
/// sweep then pulls each alert's groups only if that alert passes the
/// completeness gate, so a cluster full of frozen alerts costs one query
/// instead of a full table read every tick.
pub async fn list_alert_ids_with_groups() -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    Ok(alert_states::Entity::find()
        .select_only()
        .column(alert_states::Column::AlertId)
        .filter(alert_states::Column::GroupKey.ne(ROLLUP_GROUP_KEY))
        .distinct()
        .into_tuple::<String>()
        .all(client)
        .await?)
}

/// Delete per-group state rows, for M-7 reaping and M-6 eviction.
///
/// Deletes only `alert_states`; the transition log is retained on purpose so
/// per-group history (M-8) survives the row it described — which is exactly why
/// transitions carry their own `group_labels`.
pub async fn delete_groups(alert_id: &str, group_keys: &[String]) -> Result<(), errors::Error> {
    if group_keys.is_empty() {
        return Ok(());
    }
    let client = get_orm_client_rw().await;
    delete_groups_with(client, alert_id, group_keys).await
}

/// [`delete_groups`] against a caller-supplied connection.
pub async fn delete_groups_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    group_keys: &[String],
) -> Result<(), errors::Error> {
    if group_keys.is_empty() {
        return Ok(());
    }

    alert_states::Entity::delete_many()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .filter(alert_states::Column::GroupKey.is_in(group_keys.to_vec()))
        .exec(conn)
        .await?;
    Ok(())
}

/// Whether the alert still has `multi_alert` set, read inside a caller's
/// transaction (§5.3).
///
/// Reads the two storage locations rather than rebuilding the whole `Alert`:
/// the question is a single boolean, and the intermediate-layer conversion
/// would pull in folder and destination lookups that have no business inside
/// the state transaction.
///
/// Two columns because the two alert families store the opt-in differently — a
/// SQL alert inside the `query_aggregation` JSON, a PromQL alert in its own
/// `query_promql_multi_alert` column (a PromQL alert has no aggregation). Read
/// only the JSON one and every PromQL multi-alert would answer `false` here and
/// have this evaluation's group writes silently dropped, every single time.
///
/// A missing alert row answers `false` — the alert was deleted mid-evaluation,
/// and writing group rows for it would strand them.
async fn multi_alert_still_enabled<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<bool, errors::Error> {
    let Some((agg, promql_multi)) = alerts::Entity::find_by_id(alert_id)
        .select_only()
        .column(alerts::Column::QueryAggregation)
        .column(alerts::Column::QueryPromqlMultiAlert)
        .into_tuple::<(Option<sea_orm::JsonValue>, Option<bool>)>()
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    if promql_multi.unwrap_or(false) {
        return Ok(true);
    }
    Ok(agg
        .as_ref()
        .and_then(|v| v.get("multi_alert"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

/// Delete every non-rollup row of an alert, for the opt-out cleanup (§5.3).
///
/// Turning `multi_alert` off is **configuration, not disappearance**: the
/// groups did not recover, they merely stopped being evaluated. So the rows go
/// transition-free — the same bookkeeping semantics as M-6 eviction — and the
/// rollup row (`group_key = ''`) is left exactly as it was. Draining them
/// through M-7 instead would fabricate a wave of `Ok` "recoveries" and leave
/// stale firing rows visible for K x interval plus the grace period, which is
/// the opposite of the immediate rollback the toggle promises.
pub async fn delete_all_groups(alert_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_all_groups_with(client, alert_id).await
}

/// [`delete_all_groups`] against a caller-supplied connection.
pub async fn delete_all_groups_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<u64, errors::Error> {
    let res = alert_states::Entity::delete_many()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .filter(alert_states::Column::GroupKey.ne(ROLLUP_GROUP_KEY))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// One state upsert plus its optional transition, inside a caller-owned
/// transaction. Split out so a whole plan can share one transaction.
async fn write_update<C>(txn: &C, update: &StateUpdate) -> Result<(), errors::Error>
where
    C: sea_orm::ConnectionTrait,
{
    let Some(state) = update.state.as_ref() else {
        return Ok(());
    };

    let model = alert_states::ActiveModel {
        alert_id: Set(state.alert_id.clone()),
        group_key: Set(state.group_key.clone()),
        last_outcome: Set(state.last_outcome.as_ref().map(|o| o.to_i32())),
        last_outcome_at: Set(state.last_outcome_at),
        since: Set(state.since),
        level: Set(state.level.map(|l| l.to_i32())),
        level_since: Set(state.level_since),
        level_at: Set(state.level_at),
        last_seen: Set(state.last_seen),
        group_labels: Set(state.group_labels.clone()),
        groups_observed: Set(state.groups_observed.map(|c| c as i32)),
        groups_firing: Set(state.groups_firing.map(|c| c as i32)),
        groups_observed_is_lower_bound: Set(state.groups_observed_is_lower_bound),
        groups_firing_is_lower_bound: Set(state.groups_firing_is_lower_bound),
        silenced_until: Set(state.silenced_until),
        last_notified_level: Set(state.last_notified_level.map(|l| l.to_i32())),
    };

    // Upsert on the composite primary key — rows are created lazily on an
    // alert's first evaluation, so there is no backfill.
    alert_states::Entity::insert(model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                alert_states::Column::AlertId,
                alert_states::Column::GroupKey,
            ])
            .update_columns([
                alert_states::Column::LastOutcome,
                alert_states::Column::LastOutcomeAt,
                alert_states::Column::Since,
                alert_states::Column::Level,
                alert_states::Column::LevelSince,
                alert_states::Column::LevelAt,
                alert_states::Column::LastSeen,
                alert_states::Column::GroupLabels,
                alert_states::Column::GroupsObserved,
                alert_states::Column::GroupsFiring,
                alert_states::Column::GroupsObservedIsLowerBound,
                alert_states::Column::GroupsFiringIsLowerBound,
                // `silenced_until` / `last_notified_level` are DELIBERATELY
                // absent (§5.5 MN-2, one-writer rule). An evaluation carries
                // stale copies — it read them before it ran — so listing them
                // here would let a slow evaluation overwrite a delivery
                // callback that landed in between, erasing a silence window
                // and re-paging the group. Only `advance_delivery_state`
                // writes those two columns, and only conditionally.
                //
                // They still appear in the INSERT above, which is correct: a
                // brand-new row has no delivery state to protect.
            ])
            .to_owned(),
        )
        .exec(txn)
        .await?;

    if let Some(t) = update.transition.as_ref() {
        write_transition(txn, t).await?;
    }

    Ok(())
}

/// Writes one state/transition update inside a caller-owned metadata
/// transaction. Composite evaluation uses this after renewing and fencing its
/// scheduler claim in the same transaction.
pub async fn persist_update_in_transaction<C>(
    txn: &C,
    update: &StateUpdate,
) -> Result<(), errors::Error>
where
    C: sea_orm::ConnectionTrait,
{
    write_update(txn, update).await
}

/// Append one transition row, inside a caller-owned transaction.
///
/// Split out so the delivery callbacks can write a transition alongside their
/// own guarded state update without going through the state upsert, whose
/// conflict clause deliberately excludes the delivery columns.
///
/// **Identified by `(alert_id, group_key, at)`**, and skipped if that identity
/// is already stored. The log is append-only with a surrogate key, so nothing
/// else stops a redelivered super-cluster message from writing the same change
/// twice — and a duplicated transition is not a cosmetic problem: M-8 history
/// would show the same recovery repeatedly, once per redelivery. One evaluation
/// emits at most one transition per group, so the triple cannot collide with a
/// genuinely different change. The check runs inside the caller's transaction
/// rather than as a database constraint: there is no unique index on those
/// columns, and adding one to a live table that may already hold duplicates is
/// a migration this change deliberately does not make.
async fn write_transition<C>(txn: &C, t: &StateTransition) -> Result<(), errors::Error>
where
    C: sea_orm::ConnectionTrait,
{
    if alert_state_transitions::Entity::find()
        .filter(alert_state_transitions::Column::AlertId.eq(t.alert_id.as_str()))
        .filter(alert_state_transitions::Column::GroupKey.eq(t.group_key.as_str()))
        .filter(alert_state_transitions::Column::At.eq(t.at))
        .one(txn)
        .await?
        .is_some()
    {
        return Ok(());
    }

    alert_state_transitions::ActiveModel {
        alert_id: Set(t.alert_id.clone()),
        group_key: Set(t.group_key.clone()),
        from_outcome: Set(t.from_outcome.as_ref().map(|o| o.to_i32())),
        to_outcome: Set(t.to_outcome.to_i32()),
        from_level: Set(t.from_level.map(|l| l.to_i32())),
        to_level: Set(t.to_level.map(|l| l.to_i32())),
        at: Set(t.at),
        value: Set(t.value),
        group_labels: Set(t.group_labels.clone()),
        ..Default::default()
    }
    .insert(txn)
    .await?;
    Ok(())
}

/// Transitions for one alert, newest first.
pub async fn list_transitions(
    alert_id: &str,
    limit: u64,
) -> Result<Vec<StateTransition>, errors::Error> {
    list_transitions_filtered(alert_id, None, limit).await
}

/// Transitions for one alert, newest first, optionally scoped to one group
/// (M-8: the history drawer's group filter).
///
/// `None` means "every group", which is NOT the same as `Some("")` — the empty
/// string is the rollup row's real key. Collapsing the two would silently turn
/// an unfiltered request into a rollup-only one.
pub async fn list_transitions_filtered(
    alert_id: &str,
    group_key: Option<&str>,
    limit: u64,
) -> Result<Vec<StateTransition>, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut query = alert_state_transitions::Entity::find()
        .filter(alert_state_transitions::Column::AlertId.eq(alert_id));
    if let Some(key) = group_key {
        query = query.filter(alert_state_transitions::Column::GroupKey.eq(key));
    }
    Ok(query
        .order_by_desc(alert_state_transitions::Column::At)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .filter_map(|m| {
            Some(StateTransition {
                alert_id: m.alert_id,
                group_key: m.group_key,
                from_outcome: m.from_outcome.and_then(RunOutcome::from_i32),
                to_outcome: RunOutcome::from_i32(m.to_outcome)?,
                from_level: m.from_level.and_then(AlertLevel::from_i32),
                to_level: m.to_level.and_then(AlertLevel::from_i32),
                at: m.at,
                value: m.value,
                group_labels: m.group_labels,
            })
        })
        .collect())
}

/// Transitions for one alert inside a time window, oldest first — the shape a
/// status-lane renderer needs (each row's `to_level` is in effect from `at` to
/// the next row). Unlike [`list_transitions_filtered`] this is bounded by `at`
/// and ordered ascending so the caller can paint forward in time.
pub async fn list_transitions_between(
    alert_id: &str,
    group_key: Option<&str>,
    from: i64,
    to: i64,
    limit: u64,
) -> Result<Vec<StateTransition>, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut query = alert_state_transitions::Entity::find()
        .filter(alert_state_transitions::Column::AlertId.eq(alert_id))
        .filter(alert_state_transitions::Column::At.gte(from))
        .filter(alert_state_transitions::Column::At.lte(to));
    if let Some(key) = group_key {
        query = query.filter(alert_state_transitions::Column::GroupKey.eq(key));
    }
    Ok(query
        .order_by_asc(alert_state_transitions::Column::At)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .filter_map(|m| {
            Some(StateTransition {
                alert_id: m.alert_id,
                group_key: m.group_key,
                from_outcome: m.from_outcome.and_then(RunOutcome::from_i32),
                to_outcome: RunOutcome::from_i32(m.to_outcome)?,
                from_level: m.from_level.and_then(AlertLevel::from_i32),
                to_level: m.to_level.and_then(AlertLevel::from_i32),
                at: m.at,
                value: m.value,
                group_labels: m.group_labels,
            })
        })
        .collect())
}

/// Batched counterpart to [`list_transitions_between`]: transitions for many
/// alerts inside one window, grouped by alert id, oldest first per alert. Each
/// lane is truncated to `per_alert_limit` in memory — the window itself bounds
/// the fetch, so no per-alert SQL limit (and no N per-child queries) is needed.
pub async fn list_transitions_between_many(
    alert_ids: &[String],
    group_key: Option<&str>,
    from: i64,
    to: i64,
    per_alert_limit: u64,
) -> Result<std::collections::HashMap<String, Vec<StateTransition>>, errors::Error> {
    let mut grouped: std::collections::HashMap<String, Vec<StateTransition>> =
        std::collections::HashMap::new();
    if alert_ids.is_empty() {
        return Ok(grouped);
    }
    let client = get_orm_client_ro().await;
    let mut query = alert_state_transitions::Entity::find()
        .filter(alert_state_transitions::Column::AlertId.is_in(alert_ids.iter().cloned()))
        .filter(alert_state_transitions::Column::At.gte(from))
        .filter(alert_state_transitions::Column::At.lte(to));
    if let Some(key) = group_key {
        query = query.filter(alert_state_transitions::Column::GroupKey.eq(key));
    }
    let rows = query
        .order_by_asc(alert_state_transitions::Column::At)
        .limit(per_alert_limit.saturating_mul(alert_ids.len() as u64))
        .all(client)
        .await?;
    for m in rows {
        let Some(to_outcome) = RunOutcome::from_i32(m.to_outcome) else {
            continue;
        };
        let transition = StateTransition {
            alert_id: m.alert_id,
            group_key: m.group_key,
            from_outcome: m.from_outcome.and_then(RunOutcome::from_i32),
            to_outcome,
            from_level: m.from_level.and_then(AlertLevel::from_i32),
            to_level: m.to_level.and_then(AlertLevel::from_i32),
            at: m.at,
            value: m.value,
            group_labels: m.group_labels,
        };
        let lane = grouped.entry(transition.alert_id.clone()).or_default();
        if lane.len() < per_alert_limit as usize {
            lane.push(transition);
        }
    }
    Ok(grouped)
}

/// Remove all state for an alert. Called when the alert itself is deleted —
/// unlike `scheduled_jobs`, these rows are owned by the alert's lifecycle.
pub async fn delete_by_alert(alert_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_alert_with(client, alert_id).await
}

/// [`delete_by_alert`] against a caller-supplied connection.
pub async fn delete_by_alert_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    alert_states::Entity::delete_many()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .exec(&txn)
        .await?;
    alert_state_transitions::Entity::delete_many()
        .filter(alert_state_transitions::Column::AlertId.eq(alert_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Retention for the append-only transition log. Governed by audit needs, set
/// independently of the `triggers` stream retention.
pub async fn delete_transitions_before(cutoff: i64) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    alert_state_transitions::Entity::delete_many()
        .filter(alert_state_transitions::Column::At.lt(cutoff))
        .exec(client)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::PaginatorTrait;

    use super::*;

    fn model(last_outcome: Option<i32>) -> alert_states::Model {
        alert_states::Model {
            alert_id: "alert-1".to_string(),
            group_key: ROLLUP_GROUP_KEY.to_string(),
            last_outcome,
            last_outcome_at: Some(1_750_000_000_000_000),
            since: Some(1_749_000_000_000_000),
            level: None,
            level_since: None,
            level_at: None,
            last_seen: Some(1_750_000_000_000_000),
            group_labels: None,
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until: None,
            last_notified_level: None,
        }
    }

    #[test]
    fn test_model_converts_to_domain() {
        let s: AlertState = model(Some(RunOutcome::Firing.to_i32())).into();
        assert_eq!(s.alert_id, "alert-1");
        assert_eq!(s.group_key, ROLLUP_GROUP_KEY);
        assert_eq!(s.last_outcome, Some(RunOutcome::Firing));
        assert_eq!(s.last_outcome_at, Some(1_750_000_000_000_000));
        assert_eq!(s.since, Some(1_749_000_000_000_000));
        assert!(s.is_firing());
    }

    #[test]
    fn test_null_outcome_means_never_evaluated() {
        let s: AlertState = model(None).into();
        assert_eq!(s.last_outcome, None);
        assert!(!s.is_firing());
    }

    /// A stored integer we cannot interpret must not fail the read.
    #[test]
    fn test_unknown_outcome_integer_degrades_to_none() {
        let s: AlertState = model(Some(999)).into();
        assert_eq!(s.last_outcome, None);
        assert!(!s.is_firing());
    }

    #[test]
    fn test_every_outcome_survives_the_column_roundtrip() {
        for outcome in [
            RunOutcome::Firing,
            RunOutcome::Normal,
            RunOutcome::Succeeded,
            RunOutcome::Error,
            RunOutcome::Skipped,
            RunOutcome::NotifyFailed,
        ] {
            let s: AlertState = model(Some(outcome.to_i32())).into();
            assert_eq!(s.last_outcome, Some(outcome));
        }
    }

    #[test]
    fn test_notify_failed_reads_back_as_firing() {
        let s: AlertState = model(Some(RunOutcome::NotifyFailed.to_i32())).into();
        assert!(
            s.is_firing(),
            "a delivery failure must still count as a firing"
        );
    }

    // ── Group lifecycle columns (Feature 3) ─────────────────────────────────
    // These carry everything the group UI renders. A column added to the
    // migration and the entity but dropped in this conversion fails silently:
    // the write succeeds, the read returns None, and the feature just looks
    // broken with nothing in the logs.

    #[test]
    fn test_group_lifecycle_columns_survive_the_roundtrip() {
        let mut m = model(Some(RunOutcome::Firing.to_i32()));
        m.group_key = "abc123".to_string();
        m.last_seen = Some(1_750_000_000_000_000);
        m.group_labels = Some("host=web-1,env=prod".to_string());
        m.level = Some(AlertLevel::Critical.to_i32());
        m.level_since = Some(1_749_000_000_000_000);
        m.level_at = Some(1_750_000_000_000_000);

        let s: AlertState = m.into();
        assert_eq!(s.group_key, "abc123");
        assert_eq!(s.last_seen, Some(1_750_000_000_000_000));
        assert_eq!(s.group_labels.as_deref(), Some("host=web-1,env=prod"));
        assert_eq!(s.level, Some(AlertLevel::Critical));
        assert_eq!(s.level_since, Some(1_749_000_000_000_000));
        assert_eq!(s.level_at, Some(1_750_000_000_000_000));
    }

    #[test]
    fn test_group_counts_survive_the_roundtrip() {
        let mut m = model(Some(RunOutcome::Firing.to_i32()));
        m.groups_observed = Some(900);
        m.groups_firing = Some(120);

        let s: AlertState = m.into();
        assert_eq!(s.groups_observed, Some(900));
        assert_eq!(
            s.groups_firing,
            Some(120),
            "the chip reads this straight off the stored row"
        );
    }

    #[test]
    fn test_lower_bound_markers_survive_the_roundtrip_independently() {
        // They must not collapse into one another: the divergent case — a full
        // page that reached healthy groups — is exactly `observed = true,
        // firing = false`, and it is the common one.
        let mut m = model(Some(RunOutcome::Firing.to_i32()));
        m.groups_observed_is_lower_bound = Some(true);
        m.groups_firing_is_lower_bound = Some(false);

        let s: AlertState = m.into();
        assert_eq!(s.groups_observed_is_lower_bound, Some(true));
        assert_eq!(s.groups_firing_is_lower_bound, Some(false));
    }

    #[test]
    fn test_delivery_state_columns_survive_the_roundtrip() {
        // §5.5 MN-2. `last_notified_level` stores AlertLevel::to_i32 like the
        // `level` column; an unknown integer degrades to None the same way.
        let mut m = model(Some(RunOutcome::Firing.to_i32()));
        m.silenced_until = Some(1_750_000_600_000_000);
        m.last_notified_level = Some(AlertLevel::Warning.to_i32());

        let s: AlertState = m.into();
        assert_eq!(s.silenced_until, Some(1_750_000_600_000_000));
        assert_eq!(s.last_notified_level, Some(AlertLevel::Warning));

        let mut unknown = model(None);
        unknown.last_notified_level = Some(999);
        let s: AlertState = unknown.into();
        assert_eq!(
            s.last_notified_level, None,
            "an uninterpretable stored level degrades, not errors"
        );
    }

    // ── Replicated apply (PR 0) ─────────────────────────────────────────────
    // These tables now replicate across a super cluster. Publishing lives one
    // layer up in `db` — this module cannot reach the enterprise crate — so the
    // queue processor applies through the functions below and nothing it writes
    // is broadcast again. A queue redelivers, so every apply runs at least once
    // and may run again: the state upsert is last-write-wins by primary key,
    // and the transition insert is made replay-idempotent by the
    // `(alert_id, group_key, at)` identity.

    /// The three tables the write path touches, built straight from their
    /// entities so a column the code writes but the fixture lacks fails loudly
    /// here rather than passing against a hand-rolled subset.
    ///
    /// Columns and primary keys only — `create_table_from_entity` emits no
    /// secondary indexes, and neither state entity declares one. That is
    /// faithful for the transition log, whose only key IS its autoincrement id:
    /// there is no unique constraint on `(alert_id, group_key, at)` in the real
    /// schema either, so replay identity cannot be delegated to the database.
    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(alert_states::Entity),
            schema.create_table_from_entity(alert_state_transitions::Entity),
            // The group-plan write re-reads the alert's `multi_alert` opt-in
            // inside its own transaction (§5.3), so the plan tests need the
            // alert row — and `folders` before it, because the alert entity's
            // FK is emitted and sqlx turns `PRAGMA foreign_keys` on.
            schema.create_table_from_entity(crate::table::entity::folders::Entity),
            schema.create_table_from_entity(alerts::Entity),
            // The availability ledger shares this write's transaction (S-16).
            schema.create_table_from_entity(crate::table::entity::alert_eval_intervals::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    /// The same fixture without the ledger table, so a ledger write is
    /// guaranteed to fail. The only way to prove the two writes really share
    /// one transaction is to break one of them.
    async fn db_without_the_ledger_table() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(alert_states::Entity),
            schema.create_table_from_entity(alert_state_transitions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn ledger_write_at(at: i64) -> EvalLedgerWrite {
        EvalLedgerWrite {
            org: "myorg".to_string(),
            alert_id: "alert-1".to_string(),
            level: AlertLevel::Critical,
            frequency_secs: 60,
            tolerance_secs: 0,
            at,
        }
    }

    async fn count_intervals<C: sea_orm::ConnectionTrait>(conn: &C) -> u64 {
        crate::table::entity::alert_eval_intervals::Entity::find()
            .count(conn)
            .await
            .unwrap()
    }

    /// Insert the alert row the group-plan gate reads. Only the columns the
    /// schema requires plus the opt-in itself — everything else is nullable and
    /// irrelevant to `multi_alert_still_enabled`.
    async fn insert_alert<C: sea_orm::ConnectionTrait>(conn: &C, alert_id: &str, multi: bool) {
        use crate::table::entity::folders;

        folders::ActiveModel {
            id: Set("folder-1".to_string()),
            org: Set("myorg".to_string()),
            folder_id: Set("default".to_string()),
            name: Set("default".to_string()),
            description: Set(None),
            r#type: Set(0),
            icon: Set(None),
        }
        .insert(conn)
        .await
        .unwrap();

        alerts::ActiveModel {
            id: Set(alert_id.to_string()),
            org: Set("myorg".to_string()),
            folder_id: Set("folder-1".to_string()),
            name: Set("Test Alert".to_string()),
            stream_type: Set("logs".to_string()),
            stream_name: Set("default".to_string()),
            is_real_time: Set(false),
            destinations: Set(serde_json::json!([])),
            row_template_type: Set(0),
            enabled: Set(true),
            tz_offset: Set(0),
            query_type: Set(0),
            query_promql_multi_alert: Set(Some(multi)),
            trigger_threshold_operator: Set(">".to_string()),
            trigger_period_seconds: Set(900),
            trigger_threshold_count: Set(1),
            trigger_frequency_type: Set(0),
            trigger_frequency_seconds: Set(60),
            trigger_silence_seconds: Set(0),
            align_time: Set(false),
            dedup_enabled: Set(false),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap();
    }

    async fn count_states<C: sea_orm::ConnectionTrait>(conn: &C) -> u64 {
        alert_states::Entity::find().count(conn).await.unwrap()
    }

    async fn count_transitions<C: sea_orm::ConnectionTrait>(conn: &C) -> u64 {
        alert_state_transitions::Entity::find()
            .count(conn)
            .await
            .unwrap()
    }

    fn state_row(alert_id: &str, group_key: &str, at: i64) -> AlertState {
        let mut s = AlertState::empty(alert_id, group_key);
        s.last_outcome = Some(RunOutcome::Firing);
        s.last_outcome_at = Some(at);
        s.since = Some(at);
        s.level = Some(AlertLevel::Critical);
        s.level_since = Some(at);
        s.level_at = Some(at);
        s.last_seen = Some(at);
        s
    }

    fn update_at(group_key: &str, at: i64) -> StateUpdate {
        update_for("alert-1", group_key, at)
    }

    fn update_for(alert_id: &str, group_key: &str, at: i64) -> StateUpdate {
        StateUpdate {
            state: Some(state_row(alert_id, group_key, at)),
            transition: Some(StateTransition {
                alert_id: alert_id.to_string(),
                group_key: group_key.to_string(),
                from_outcome: None,
                to_outcome: RunOutcome::Firing,
                from_level: None,
                to_level: Some(AlertLevel::Critical),
                at,
                value: Some(9.5),
                group_labels: None,
            }),
        }
    }

    #[tokio::test]
    async fn a_replayed_state_update_writes_exactly_one_transition() {
        let db = db().await;
        let update = update_at("host=web-1", 1_000);

        persist_with(&db, &update, None).await.unwrap();
        persist_with(&db, &update, None).await.unwrap();

        assert_eq!(count_states(&db).await, 1);
        assert_eq!(
            count_transitions(&db).await,
            1,
            "a redelivered message must not append the same transition twice"
        );
    }

    #[tokio::test]
    async fn apply_is_last_write_wins_by_primary_key() {
        let db = db().await;

        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-1", 2_000), None)
            .await
            .unwrap();
        // The older message redelivered after the newer one has landed.
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();

        assert_eq!(count_states(&db).await, 1);
        let stored = get_with(&db, "alert-1", "host=web-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.last_outcome_at,
            Some(1_000),
            "apply is last-write-wins by primary key, not merge-by-timestamp"
        );
    }

    /// The dedup must key on the instant, not on the alert: real history is two
    /// changes at two times, and swallowing the second would erase it.
    #[tokio::test]
    async fn transitions_at_different_instants_both_land() {
        let db = db().await;
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-1", 2_000), None)
            .await
            .unwrap();
        assert_eq!(count_transitions(&db).await, 2);
    }

    /// ...and on the group. One evaluation writes every group's transition at
    /// the same `at`; collapsing them by `(alert_id, at)` would keep one group's
    /// history and drop the rest.
    #[tokio::test]
    async fn transitions_for_different_groups_at_one_instant_all_land() {
        let db = db().await;
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-2", 1_000), None)
            .await
            .unwrap();
        assert_eq!(count_transitions(&db).await, 2);
    }

    /// ...and on the alert. Every alert's rollup transition carries the SAME
    /// group key — the empty string — so an identity that dropped `alert_id`
    /// would let the first alert to transition in a given microsecond swallow
    /// every other alert's rollup history.
    #[tokio::test]
    async fn transitions_for_different_alerts_at_one_instant_all_land() {
        let db = db().await;
        persist_with(&db, &update_for("alert-1", ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_for("alert-2", ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();
        assert_eq!(count_transitions(&db).await, 2);
    }

    #[tokio::test]
    async fn a_replayed_delivery_advance_does_not_move_the_silence_window() {
        let db = db().await;
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();

        let episode = DeliveryEpisode {
            level: AlertLevel::Critical,
            level_since: 1_000,
            notified_at_enqueue: (None, None),
        };
        let outcome = DeliveryOutcome::Delivered {
            silence_minutes: 10,
            at: 2_000,
        };

        assert!(
            advance_delivery_state_with(&db, "alert-1", "host=web-1", episode, outcome)
                .await
                .unwrap()
        );
        let after_first = get_with(&db, "alert-1", "host=web-1")
            .await
            .unwrap()
            .unwrap();

        // The replay must still be *applied*, not rejected as stale: a guard
        // that its own success invalidates would mean the advance lands on
        // exactly one cluster and every other one silently keeps paging.
        assert!(
            advance_delivery_state_with(&db, "alert-1", "host=web-1", episode, outcome)
                .await
                .unwrap(),
            "the delivery guard must stay satisfiable after the write it guards"
        );
        let after_replay = get_with(&db, "alert-1", "host=web-1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            after_first.silenced_until,
            Some(2_000 + 10 * 60 * 1_000_000)
        );
        assert_eq!(after_replay.silenced_until, after_first.silenced_until);
        assert_eq!(after_replay.last_notified_level, Some(AlertLevel::Critical));
    }

    #[tokio::test]
    async fn a_replayed_failed_delivery_appends_exactly_one_transition() {
        let db = db().await;
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();
        assert_eq!(count_transitions(&db).await, 1);

        let episode = DeliveryEpisode {
            level: AlertLevel::Critical,
            level_since: 1_000,
            notified_at_enqueue: (None, None),
        };
        let outcome = DeliveryOutcome::Failed { at: 3_000 };

        advance_delivery_state_with(&db, "alert-1", "host=web-1", episode, outcome)
            .await
            .unwrap();
        advance_delivery_state_with(&db, "alert-1", "host=web-1", episode, outcome)
            .await
            .unwrap();

        assert_eq!(
            count_transitions(&db).await,
            2,
            "the failure adds one transition; the replay adds none — the outcome \
             has already moved, so no second transition is even proposed"
        );
        let stored = get_with(&db, "alert-1", "host=web-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.last_outcome, Some(RunOutcome::NotifyFailed));
    }

    #[tokio::test]
    async fn a_replayed_group_delete_is_a_no_op_and_spares_the_rollup() {
        let db = db().await;
        persist_with(&db, &update_at(ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();

        let keys = vec!["host=web-1".to_string()];
        delete_groups_with(&db, "alert-1", &keys).await.unwrap();
        delete_groups_with(&db, "alert-1", &keys).await.unwrap();

        assert_eq!(count_states(&db).await, 1);
        assert!(
            get_with(&db, "alert-1", ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_some(),
            "reaping groups must never take the rollup row with it"
        );
        assert_eq!(
            count_transitions(&db).await,
            2,
            "deleting group rows retains their history (M-8)"
        );
    }

    #[tokio::test]
    async fn a_replayed_opt_out_cleanup_is_a_no_op_and_spares_the_rollup() {
        let db = db().await;
        persist_with(&db, &update_at(ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-2", 1_000), None)
            .await
            .unwrap();

        assert_eq!(delete_all_groups_with(&db, "alert-1").await.unwrap(), 2);
        assert_eq!(
            delete_all_groups_with(&db, "alert-1").await.unwrap(),
            0,
            "the replay finds nothing left to delete"
        );
        assert_eq!(count_states(&db).await, 1);
        assert!(
            get_with(&db, "alert-1", ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn a_replayed_group_plan_lands_once_with_its_evictions() {
        let db = db().await;
        insert_alert(&db, "alert-1", true).await;
        // The row the plan evicts, written by an earlier evaluation.
        persist_with(&db, &update_at("host=web-9", 500), None)
            .await
            .unwrap();

        let plan = GroupPlan {
            updates: vec![update_at("host=web-1", 1_000)],
            evicted: vec!["host=web-9".to_string()],
        };
        persist_group_plan_with(&db, &plan, "alert-1")
            .await
            .unwrap();
        persist_group_plan_with(&db, &plan, "alert-1")
            .await
            .unwrap();

        assert_eq!(
            list_groups_with(&db, "alert-1").await.unwrap().len(),
            1,
            "the plan's row lands, the evicted one stays gone on replay"
        );
        assert!(
            get_with(&db, "alert-1", "host=web-9")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            count_transitions(&db).await,
            2,
            "the evicted row's earlier transition, plus the plan's — the replay adds none"
        );
    }

    /// The forward-only consequence, recorded deliberately: the gate re-reads
    /// the alert on the *receiving* cluster, so a plan that outruns its alert
    /// row is dropped rather than stranding group rows under an alert that
    /// cluster has never heard of. It converges on the next evaluation.
    #[tokio::test]
    async fn a_group_plan_for_an_unknown_alert_writes_nothing() {
        let db = db().await;
        let plan = GroupPlan {
            updates: vec![update_at("host=web-1", 1_000)],
            evicted: vec![],
        };
        assert!(
            !persist_group_plan_with(&db, &plan, "alert-1")
                .await
                .unwrap(),
            "the drop must be reported, not silently reported as a write — the \
             super-cluster wrapper decides whether to broadcast on this"
        );
        assert_eq!(count_states(&db).await, 0);
        assert_eq!(count_transitions(&db).await, 0);
    }

    /// Alert deletion runs on whichever cluster served the API, so this is the
    /// one replicated write the job cluster does not originate. It must be
    /// safe to apply on a cluster that has already deleted the rows itself.
    #[tokio::test]
    async fn a_replayed_alert_delete_is_a_no_op() {
        let db = db().await;
        persist_with(&db, &update_at(ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();
        persist_with(&db, &update_at("host=web-1", 1_000), None)
            .await
            .unwrap();

        delete_by_alert_with(&db, "alert-1").await.unwrap();
        delete_by_alert_with(&db, "alert-1").await.unwrap();

        assert_eq!(count_states(&db).await, 0);
        assert_eq!(
            count_transitions(&db).await,
            0,
            "an alert's deletion takes its history with it, unlike a group reap"
        );
    }

    #[test]
    fn a_delivery_outcome_survives_the_super_cluster_round_trip() {
        // The advance replicates by re-running the same guarded write, so the
        // outcome it carries decides which columns move on every cluster.
        for outcome in [
            DeliveryOutcome::Delivered {
                silence_minutes: 10,
                at: 2_000,
            },
            DeliveryOutcome::Failed { at: 3_000 },
        ] {
            let bytes = config::utils::json::to_vec(&outcome).unwrap();
            let back: DeliveryOutcome = config::utils::json::from_slice(&bytes).unwrap();
            assert_eq!(back, outcome);
        }
    }

    #[test]
    fn test_legacy_rows_read_back_as_unknown_not_as_false() {
        // NULL on these columns means "written before the column existed". It
        // must stay `None` rather than degrading to `Some(false)`: `last_seen`
        // in particular is read as *unknown* by `group_fate`, and reading it as
        // a real value would resolve or reap every legacy row on the first
        // sweep after upgrade.
        let s: AlertState = model(Some(RunOutcome::Firing.to_i32())).into();
        assert_eq!(s.groups_observed, None);
        assert_eq!(s.groups_firing, None);
        assert_eq!(s.groups_observed_is_lower_bound, None);
        assert_eq!(s.groups_firing_is_lower_bound, None);
        assert_eq!(s.group_labels, None);
    }

    // ── The availability ledger rides this transaction (S-16, PR 1) ─────────

    #[tokio::test]
    async fn a_ledger_write_lands_alongside_the_state_row() {
        let db = db().await;

        persist_with(
            &db,
            &update_at(ROLLUP_GROUP_KEY, 1_000),
            Some(&ledger_write_at(1_000)),
        )
        .await
        .unwrap();

        assert_eq!(count_states(&db).await, 1);
        assert_eq!(count_intervals(&db).await, 1);
    }

    /// Most evaluations carry no ledger write at all — every grouped alert, and
    /// every unmeasured run. Those must leave the ledger untouched rather than
    /// writing a zero-width interval.
    #[tokio::test]
    async fn a_state_write_without_a_ledger_write_leaves_the_ledger_empty() {
        let db = db().await;

        persist_with(&db, &update_at(ROLLUP_GROUP_KEY, 1_000), None)
            .await
            .unwrap();

        assert_eq!(count_states(&db).await, 1);
        assert_eq!(count_intervals(&db).await, 0);
    }

    /// One transaction, not two calls in a row: a ledger failure must take the
    /// state write down with it. The alternative — state committed, ledger lost
    /// — is an evaluation the SLI can never see, and the reverse is coverage
    /// with no state behind it.
    #[tokio::test]
    async fn a_failing_ledger_write_rolls_the_state_write_back() {
        let db = db_without_the_ledger_table().await;

        let err = persist_with(
            &db,
            &update_at(ROLLUP_GROUP_KEY, 1_000),
            Some(&ledger_write_at(1_000)),
        )
        .await
        .unwrap_err();
        assert!(
            err.to_string()
                .to_lowercase()
                .contains("alert_eval_intervals"),
            "expected the ledger write to be what failed, got: {err}"
        );

        assert_eq!(
            count_states(&db).await,
            0,
            "the state row must not survive a failed ledger write"
        );
        assert_eq!(count_transitions(&db).await, 0);
    }

    /// The queue redelivers, so the bundled apply runs at least once and may run
    /// again. Neither half may double up.
    #[tokio::test]
    async fn a_redelivered_persist_writes_neither_a_second_transition_nor_a_second_interval() {
        let db = db().await;
        let update = update_at(ROLLUP_GROUP_KEY, 1_000);
        let ledger = ledger_write_at(1_000);

        persist_with(&db, &update, Some(&ledger)).await.unwrap();
        persist_with(&db, &update, Some(&ledger)).await.unwrap();

        assert_eq!(count_states(&db).await, 1);
        assert_eq!(count_transitions(&db).await, 1);
        assert_eq!(count_intervals(&db).await, 1);
    }
}
