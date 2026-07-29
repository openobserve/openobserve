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
        state::{AlertState, ROLLUP_GROUP_KEY, StateTransition, StateUpdate},
    },
    self_reporting::usage::RunOutcome,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};

use super::entity::{alert_state_transitions, alert_states, alerts};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
/// `config::meta::alerts::state::apply_outcome`.
///
/// The state upsert and its transition insert go in one transaction: a
/// transition that is not reflected in current state (or vice versa) would make
/// recovery pairing unreliable, which is the whole reason this is not on the
/// lossy stream path.
pub async fn persist(update: &StateUpdate) -> Result<(), errors::Error> {
    if update.state.is_none() {
        return Ok(());
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    persist_with(client, update).await
}

/// [`persist`] against a caller-supplied connection.
pub async fn persist_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    update: &StateUpdate,
) -> Result<(), errors::Error> {
    if update.state.is_none() {
        return Ok(());
    }
    let txn = conn.begin().await?;
    write_update(&txn, update).await?;
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
pub async fn persist_group_plan(plan: &GroupPlan, alert_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    persist_group_plan_with(client, plan, alert_id).await
}

/// [`persist_group_plan`] against a caller-supplied connection.
pub async fn persist_group_plan_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    plan: &GroupPlan,
    alert_id: &str,
) -> Result<(), errors::Error> {
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
        return Ok(());
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
    Ok(())
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
/// Reads the one JSON column rather than rebuilding the whole `Alert`: the
/// question is a single boolean, and the intermediate-layer conversion would
/// pull in folder and destination lookups that have no business inside the
/// state transaction.
///
/// A missing alert row answers `false` — the alert was deleted mid-evaluation,
/// and writing group rows for it would strand them.
async fn multi_alert_still_enabled<C: sea_orm::ConnectionTrait>(
    conn: &C,
    alert_id: &str,
) -> Result<bool, errors::Error> {
    let Some(agg) = alerts::Entity::find_by_id(alert_id)
        .select_only()
        .column(alerts::Column::QueryAggregation)
        .into_tuple::<Option<sea_orm::JsonValue>>()
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

/// Append one transition row, inside a caller-owned transaction.
///
/// Split out so the delivery callbacks can write a transition alongside their
/// own guarded state update without going through the state upsert, whose
/// conflict clause deliberately excludes the delivery columns.
async fn write_transition<C>(txn: &C, t: &StateTransition) -> Result<(), errors::Error>
where
    C: sea_orm::ConnectionTrait,
{
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

/// Remove all state for an alert. Called when the alert itself is deleted —
/// unlike `scheduled_jobs`, these rows are owned by the alert's lifecycle.
pub async fn delete_by_alert(alert_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;
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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    alert_state_transitions::Entity::delete_many()
        .filter(alert_state_transitions::Column::At.lt(cutoff))
        .exec(client)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
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

    // ═════════════════════════════════════════════════════════════════════
    // Database-backed tests (real schema, real SQL semantics)
    //
    // These cover what a pure test structurally cannot: that the migration
    // and the entity agree, and that the upsert's conflict clause overwrites
    // exactly the columns it should.
    // ═════════════════════════════════════════════════════════════════════

    use config::meta::alerts::state::StateUpdate;

    use crate::table::test_harness::{seed_alert, test_db, unique_alert_id};

    /// The silence window a `Delivered { silence_minutes: 10, at: 1_100 }`
    /// callback produces — computed by `dispatch::delivery_success_update`,
    /// which is the single place that rule lives.
    const DELIVERED_WINDOW: i64 = 1_100 + 10 * 60 * 1_000_000;

    /// A firing group row for the given alert.
    fn group_row(alert_id: &str, group_key: &str, level: AlertLevel, at: i64) -> AlertState {
        AlertState {
            alert_id: alert_id.to_string(),
            group_key: group_key.to_string(),
            last_outcome: Some(RunOutcome::Firing),
            last_outcome_at: Some(at),
            since: Some(at),
            level: Some(level),
            level_since: Some(at),
            level_at: Some(at),
            last_seen: Some(at),
            group_labels: Some("host=a".to_string()),
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
            silenced_until: None,
            last_notified_level: None,
        }
    }

    fn update_of(state: AlertState) -> StateUpdate {
        StateUpdate {
            state: Some(state),
            transition: None,
        }
    }

    #[tokio::test]
    async fn test_harness_applies_the_real_schema() {
        // The smoke test for the harness itself, and a genuine guard: it fails
        // if a column exists on the entity but no migration ever added it —
        // the drift that compiles cleanly and breaks on first write.
        let db = test_db().await;
        let alert_id = unique_alert_id("smoke");

        let mut row = group_row(&alert_id, "g1", AlertLevel::Critical, 1_000);
        row.groups_observed = Some(7);
        row.groups_firing = Some(3);
        row.groups_observed_is_lower_bound = Some(true);
        row.groups_firing_is_lower_bound = Some(false);
        row.silenced_until = Some(5_000);
        row.last_notified_level = Some(AlertLevel::Warning);

        persist_with(db, &update_of(row.clone()))
            .await
            .expect("every column must exist in the migrated schema");

        let read = get_with(db, &alert_id, "g1")
            .await
            .unwrap()
            .expect("the row was written");
        assert_eq!(read, row, "every column must survive a real round-trip");
    }

    #[tokio::test]
    async fn test_evaluation_never_clobbers_delivery_state() {
        // THE one-writer rule (§5.5 MN-2/MN-6), and the reason
        // `SilencedUntil`/`LastNotifiedLevel` are absent from the upsert's
        // conflict list. An evaluation carries a COPY of delivery state read
        // before it ran, so if the conflict clause wrote those columns, a
        // delivery callback landing mid-evaluation would be erased — the
        // silence window would vanish and the group would re-page next cycle.
        //
        // Only a real upsert can show this: the pure layer carries the values
        // forward correctly, and the bug lives entirely in the SQL.
        let db = test_db().await;
        let alert_id = unique_alert_id("one-writer");

        // 1. The group fires and its row is created.
        let first = group_row(&alert_id, "g1", AlertLevel::Critical, 1_000);
        persist_with(db, &update_of(first.clone())).await.unwrap();

        // 2. A delivery succeeds and records itself.
        let applied = advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            DeliveryEpisode { level: AlertLevel::Critical, level_since: 1_000, notified_at_enqueue: (None, None) },
            DeliveryOutcome::Delivered { silence_minutes: 10, at: 1_100 },
        )
        .await
        .unwrap();
        assert!(applied, "the episode matched, so the callback must apply");

        // 3. The NEXT evaluation writes observation state. It still carries
        //    the pre-delivery copy (None/None) — exactly the stale write.
        let mut second = group_row(&alert_id, "g1", AlertLevel::Critical, 2_000);
        second.silenced_until = None;
        second.last_notified_level = None;
        persist_with(db, &update_of(second)).await.unwrap();

        let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
        assert_eq!(
            read.silenced_until,
            Some(DELIVERED_WINDOW),
            "the evaluation must not erase a delivery that already happened"
        );
        assert_eq!(read.last_notified_level, Some(AlertLevel::Critical));
        // ...while observation state DID advance, proving the upsert still works.
        assert_eq!(read.last_outcome_at, Some(2_000));
    }

    #[tokio::test]
    async fn test_delivery_callback_is_refused_when_the_episode_moved_on() {
        // The versioned callback (§5.5 round-5/6) as the database sees it:
        // `UPDATE ... WHERE level = ? AND level_since = ?` either matched or it
        // did not, and no amount of pure logic can assert that.
        let db = test_db().await;
        let alert_id = unique_alert_id("stale-episode");

        // Firing since 1_000, then it escalates: a NEW level-episode.
        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Warning, 1_000)),
        )
        .await
        .unwrap();
        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 2_000)),
        )
        .await
        .unwrap();

        // A delivery enqueued during the Warning episode reports back late.
        let applied = advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            DeliveryEpisode { level: AlertLevel::Warning, level_since: 1_000, notified_at_enqueue: (None, None) },
            DeliveryOutcome::Delivered { silence_minutes: 10, at: 1_100 },
        )
        .await
        .unwrap();

        assert!(!applied, "a stale episode must not be recorded");
        let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
        assert_eq!(
            read.last_notified_level, None,
            "the late Warning delivery must not set a baseline on the Critical episode"
        );
        assert_eq!(read.silenced_until, None);
    }

    #[tokio::test]
    async fn test_failed_delivery_records_notify_failed_without_touching_delivery_state() {
        // MN-7 through real SQL: the outcome axis moves, delivery state does
        // NOT (so the group re-qualifies, MN-6), and `last_seen` is frozen --
        // a failed send is not an observation and must not postpone M-7.
        let db = test_db().await;
        let alert_id = unique_alert_id("notify-failed");

        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let applied = advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            DeliveryEpisode { level: AlertLevel::Critical, level_since: 1_000, notified_at_enqueue: (None, None) },
            DeliveryOutcome::Failed { at: 1_500 },
        )
        .await
        .unwrap();
        assert!(applied);

        let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
        assert_eq!(read.last_outcome, Some(RunOutcome::NotifyFailed));
        assert_eq!(read.last_outcome_at, Some(1_500));
        assert!(read.is_firing(), "a delivery failure is still firing");
        assert_eq!(read.silenced_until, None, "nothing advanced, so it re-qualifies");
        assert_eq!(read.last_notified_level, None);
        assert_eq!(read.last_seen, Some(1_000), "M-7's clock must not move");
    }

    #[tokio::test]
    async fn test_group_plan_applies_upserts_and_evictions_in_one_call() {
        // 7.2. Scope note, so this is not mistaken for more than it is: this
        // asserts both EFFECTS land -- the winners upserted, the displaced row
        // deleted, the rollup written. It does NOT prove atomicity, which
        // would need failure injection mid-transaction; a non-transactional
        // implementation would pass. The transaction is still the requirement
        // (composites read the rollup, so a rollup without its group rows
        // would hand them a state that never existed) -- it is simply asserted
        // by construction in `persist_group_plan_with`, not by this test.
        let db = test_db().await;
        let alert_id = unique_alert_id("group-plan");
        seed_alert(db, &alert_id, true).await;

        // An incumbent that this evaluation will evict.
        persist_with(
            db,
            &update_of(group_row(&alert_id, "old", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let plan = GroupPlan {
            updates: vec![
                update_of(group_row(&alert_id, "new", AlertLevel::Critical, 2_000)),
                update_of(group_row(&alert_id, ROLLUP_GROUP_KEY, AlertLevel::Critical, 2_000)),
            ],
            evicted: vec!["old".to_string()],
        };
        persist_group_plan_with(db, &plan, &alert_id).await.unwrap();

        assert!(
            get_with(db, &alert_id, "old").await.unwrap().is_none(),
            "the evicted row must be gone"
        );
        assert!(get_with(db, &alert_id, "new").await.unwrap().is_some());
        assert!(
            get_with(db, &alert_id, ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_some(),
            "the rollup row commits with its groups"
        );

        let groups = list_groups_with(db, &alert_id).await.unwrap();
        assert_eq!(groups.len(), 1, "list_groups excludes the rollup row");
        assert_eq!(groups[0].group_key, "new");
    }

    #[tokio::test]
    async fn test_group_plan_is_dropped_when_multi_alert_was_turned_off_mid_evaluation() {
        // §5.3 opt-out race: an evaluation that read the alert while it was
        // still a multi-alert must not commit group rows after the save-time
        // cleanup has run — otherwise the toggle-off leaves rows behind and
        // "rollback is immediate" is false. The re-check lives inside the
        // plan's own transaction precisely so this cannot interleave.
        let db = test_db().await;
        let alert_id = unique_alert_id("opt-out-race");
        seed_alert(db, &alert_id, false).await;

        let plan = GroupPlan {
            updates: vec![
                update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 2_000)),
                update_of(group_row(&alert_id, ROLLUP_GROUP_KEY, AlertLevel::Critical, 2_000)),
            ],
            evicted: vec![],
        };
        persist_group_plan_with(db, &plan, &alert_id).await.unwrap();

        assert!(
            list_groups_with(db, &alert_id).await.unwrap().is_empty(),
            "an evaluation past the opt-out must not resurrect group rows"
        );
        assert!(
            get_with(db, &alert_id, ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_none(),
            "and it writes no rollup either — the whole plan is dropped"
        );
    }

    #[tokio::test]
    async fn test_group_plan_is_dropped_when_the_alert_no_longer_exists() {
        // A deleted alert reads as opted-out: writing group rows for it would
        // strand them with nothing to reap them against.
        let db = test_db().await;
        let alert_id = unique_alert_id("deleted-alert");

        let plan = GroupPlan {
            updates: vec![update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 2_000))],
            evicted: vec![],
        };
        persist_group_plan_with(db, &plan, &alert_id).await.unwrap();

        assert!(list_groups_with(db, &alert_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_opt_out_delete_drops_groups_but_keeps_the_rollup_and_history() {
        // §5.3: turning the flag off is configuration, not disappearance. The
        // group rows go transition-free (they did not recover, they stopped
        // being evaluated), the rollup row is untouched, and per-group history
        // stays readable — which is why transitions carry their own labels.
        let db = test_db().await;
        let alert_id = unique_alert_id("opt-out-delete");
        seed_alert(db, &alert_id, true).await;

        for key in ["g1", "g2", ROLLUP_GROUP_KEY] {
            persist_with(
                db,
                &update_of(group_row(&alert_id, key, AlertLevel::Critical, 1_000)),
            )
            .await
            .unwrap();
        }
        let transitions_before = count_transitions(db, &alert_id).await;

        let deleted = delete_all_groups_with(db, &alert_id).await.unwrap();

        assert_eq!(deleted, 2, "both group rows, and only them");
        assert!(list_groups_with(db, &alert_id).await.unwrap().is_empty());
        assert!(
            get_with(db, &alert_id, ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_some(),
            "the rollup row survives the opt-out"
        );
        assert_eq!(
            count_transitions(db, &alert_id).await,
            transitions_before,
            "eviction is bookkeeping: it writes no transitions"
        );
    }

    async fn count_transitions(db: &sea_orm::DatabaseConnection, alert_id: &str) -> u64 {
        use sea_orm::PaginatorTrait;

        alert_state_transitions::Entity::find()
            .filter(alert_state_transitions::Column::AlertId.eq(alert_id))
            .count(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_delivery_callback_targets_one_group_only() {
        // The conditional update filters on (alert_id, group_key) as well as
        // the episode. Without the group filter a single delivery would
        // silence every group of the alert that happened to share a level.
        let db = test_db().await;
        let alert_id = unique_alert_id("scoped");

        for key in ["g1", "g2"] {
            persist_with(
                db,
                &update_of(group_row(&alert_id, key, AlertLevel::Critical, 1_000)),
            )
            .await
            .unwrap();
        }

        advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            DeliveryEpisode { level: AlertLevel::Critical, level_since: 1_000, notified_at_enqueue: (None, None) },
            DeliveryOutcome::Delivered { silence_minutes: 10, at: 1_100 },
        )
        .await
        .unwrap();

        assert_eq!(
            get_with(db, &alert_id, "g1").await.unwrap().unwrap().silenced_until,
            Some(DELIVERED_WINDOW)
        );
        assert_eq!(
            get_with(db, &alert_id, "g2").await.unwrap().unwrap().silenced_until,
            None,
            "host-a's delivery must not silence host-b"
        );
    }

    #[tokio::test]
    async fn test_an_older_same_episode_failure_cannot_land_after_a_newer_success() {
        // The attempt guard, in SQL. The pure layer rejects this pairing, but
        // the pure layer is not what writes the row — if the enqueue-time
        // anchor is missing from the UPDATE's predicates, the database happily
        // applies a stale `NotifyFailed` over a group that just delivered, and
        // the next evaluation re-pages it.
        //
        // Both attempts share one level-episode, so `(level, level_since)`
        // alone cannot separate them: only the delivery-state anchor can.
        let db = test_db().await;
        let alert_id = unique_alert_id("attempt-anchor");

        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let never_delivered = DeliveryEpisode {
            level: AlertLevel::Critical,
            level_since: 1_000,
            notified_at_enqueue: (None, None),
        };

        // Attempt B succeeds first.
        assert!(
            advance_delivery_state_with(
                db,
                &alert_id,
                "g1",
                never_delivered,
                DeliveryOutcome::Delivered { silence_minutes: 10, at: 1_100 },
            )
            .await
            .unwrap()
        );

        // Attempt A — enqueued when nothing had been delivered — now fails.
        let applied = advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            never_delivered,
            DeliveryOutcome::Failed { at: 2_000 },
        )
        .await
        .unwrap();

        assert!(
            !applied,
            "the anchor no longer matches, so the stale failure must not be written"
        );
        let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
        assert_eq!(
            read.last_outcome,
            Some(RunOutcome::Firing),
            "the group delivered; it must not read as NotifyFailed"
        );
        assert_eq!(read.silenced_until, Some(DELIVERED_WINDOW), "and stays silenced");
    }

    #[tokio::test]
    async fn test_a_current_attempt_failure_still_applies() {
        // The complement: with delivery state untouched since enqueue, this IS
        // the outstanding attempt. If the anchor predicates were too strict
        // (e.g. `= NULL` instead of `IS NULL`), every genuine first failure
        // would be silently swallowed and no group would ever record one.
        let db = test_db().await;
        let alert_id = unique_alert_id("attempt-current");

        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let applied = advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: 1_000,
                notified_at_enqueue: (None, None),
            },
            DeliveryOutcome::Failed { at: 1_500 },
        )
        .await
        .unwrap();

        assert!(applied, "a NULL anchor must match a never-delivered row");
        let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
        assert_eq!(read.last_outcome, Some(RunOutcome::NotifyFailed));
    }

    #[tokio::test]
    async fn test_an_older_success_cannot_shorten_an_active_silence_window() {
        // Success ignores the enqueue anchor by design, so BOTH attempts in an
        // episode reach the write. If the one computing the earlier window
        // commits second, the group would be un-silenced early and page again
        // while on-call is already handling it. The rule lives in
        // `delivery_success_update`; this proves the SQL path honours it.
        let db = test_db().await;
        let alert_id = unique_alert_id("window-regress");

        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let ep = DeliveryEpisode {
            level: AlertLevel::Critical,
            level_since: 1_000,
            notified_at_enqueue: (None, None),
        };
        let long_window = 1_000 + 100 * 60 * 1_000_000;

        // The NEWER delivery lands first, setting a far-out window.
        advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            ep,
            DeliveryOutcome::Delivered {
                silence_minutes: 100,
                at: 1_000,
            },
        )
        .await
        .unwrap();

        // An OLDER delivery from the same episode commits afterwards.
        advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            ep,
            DeliveryOutcome::Delivered {
                silence_minutes: 10,
                at: 1_000,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            get_with(db, &alert_id, "g1").await.unwrap().unwrap().silenced_until,
            Some(long_window),
            "the later window must survive, whatever order the callbacks commit in"
        );
    }

    #[tokio::test]
    async fn test_a_zero_silence_success_does_not_clear_a_live_window() {
        // `silence = 0` means "page every evaluation" and computes no window.
        // Arriving late it must not wipe one a sibling attempt already set:
        // absent is the EARLIEST window, not the newest.
        let db = test_db().await;
        let alert_id = unique_alert_id("zero-silence-late");

        persist_with(
            db,
            &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
        )
        .await
        .unwrap();

        let ep = DeliveryEpisode {
            level: AlertLevel::Critical,
            level_since: 1_000,
            notified_at_enqueue: (None, None),
        };
        let window = 1_000 + 100 * 60 * 1_000_000;

        advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            ep,
            DeliveryOutcome::Delivered {
                silence_minutes: 100,
                at: 1_000,
            },
        )
        .await
        .unwrap();
        advance_delivery_state_with(
            db,
            &alert_id,
            "g1",
            ep,
            DeliveryOutcome::Delivered {
                silence_minutes: 0,
                at: 1_000,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            get_with(db, &alert_id, "g1").await.unwrap().unwrap().silenced_until,
            Some(window),
            "a zero-silence callback must not clear a live window"
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // Concurrency
    //
    // These use `tokio::spawn` on a multi-threaded runtime, NOT `tokio::join!`.
    // That is not incidental: `join!` polls both futures on one task, and
    // measurement showed it produced the SAME ordering in 60 out of 60 rounds
    // — the evaluation always finished first, so the interleaving under test
    // never occurred and the "callback wins" path was dead code. Real tasks on
    // real threads produce both orderings within a handful of rounds.
    //
    // What these can and cannot establish, measured rather than assumed:
    //
    // * They CAN catch a write that is not confined to its own columns, which
    //   is the one-writer rule (MN-2) and holds on every backend.
    // * They CANNOT prove the `level`/`level_since` predicates on the delivery
    //   UPDATE are load-bearing. Deleting those predicates leaves this suite
    //   green, because the callback's transaction reads and writes under one
    //   SQLite write lock. Under Postgres READ COMMITTED the same read-then-
    //   write does not conflict — the UPDATE simply observes the newer row —
    //   so the guard is required for a backend this harness never runs
    //   against. Treat it as covered by review, not by test.
    //
    // A third test lived here and was deleted rather than fixed: it asserted
    // that a row at a new level-episode can never carry delivery state. Real
    // concurrency disproved it. A callback that records a delivery while its
    // episode IS current is legitimate, and a later evaluation moves the
    // episode without clearing delivery state — exactly as the one-writer rule
    // requires. The intended guarantee ("a callback whose episode has already
    // moved on is refused") is not visible in the final row at all, so it is
    // asserted deterministically by
    // `test_delivery_callback_is_refused_when_the_episode_moved_on` instead.
    // ═════════════════════════════════════════════════════════════════════

    /// Rounds per race test. High enough that a window of a few statements is
    /// hit reliably, low enough to stay quick.
    const RACE_ROUNDS: usize = 60;

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_racing_callbacks_leave_a_coherent_row() {
        // Two callbacks for one episode, racing.
        //
        // Named for what it can actually distinguish. It does NOT verify the
        // attempt anchor: measured by deleting the anchor predicates from the
        // SQL, this test still passes. Both orderings end at the same
        // observable row — success-then-failure with a BROKEN anchor looks
        // exactly like failure-then-success with a correct one — so the
        // guarantee is simply not recoverable from the final state. It is
        // asserted deterministically instead, in
        // `test_an_older_same_episode_failure_cannot_land_after_a_newer_success`.
        //
        // What it does establish: whatever the interleaving, the row is never
        // left internally inconsistent.
        let db = test_db().await;

        for round in 0..RACE_ROUNDS {
            let alert_id = unique_alert_id(&format!("race-attempt-{round}"));
            persist_with(
                db,
                &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
            )
            .await
            .unwrap();

            // Both attempts were enqueued before anything had been delivered.
            let episode = DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: 1_000,
                notified_at_enqueue: (None, None),
            };

            let s_id = alert_id.clone();
            let success = tokio::spawn(async move {
                advance_delivery_state_with(
                    db,
                    &s_id,
                    "g1",
                    episode,
                    DeliveryOutcome::Delivered {
                        silence_minutes: 10,
                        at: 1_500,
                    },
                )
                .await
            });
            let f_id = alert_id.clone();
            let failure = tokio::spawn(async move {
                advance_delivery_state_with(
                    db,
                    &f_id,
                    "g1",
                    episode,
                    DeliveryOutcome::Failed { at: 1_600 },
                )
                .await
            });
            success.await.unwrap().unwrap();
            failure.await.unwrap().unwrap();

            let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();

            // Delivery state is written as a PAIR by a success and by nothing
            // else, so a half-written pair means one writer clobbered part of
            // another's row. This holds under every ordering.
            assert_eq!(
                read.silenced_until.is_some(),
                read.last_notified_level.is_some(),
                "round {round}: delivery state was written by halves (row={read:?})"
            );

            // Deliberately NOT asserted: that a delivered group reads as
            // `Firing`. Failure-then-success is a legitimate ordering — the
            // failure records `NotifyFailed`, then the success records the
            // delivery WITHOUT clearing the outcome axis, which belongs to
            // evaluation (see
            // `dispatch::test_a_success_does_not_clear_a_previous_notify_failed_outcome`).
            // An earlier version of this test forbade that state and passed
            // only because `join!` never produced the ordering.
            assert!(
                matches!(
                    read.last_outcome,
                    Some(RunOutcome::Firing) | Some(RunOutcome::NotifyFailed)
                ),
                "round {round}: neither callback recorded an outcome (row={read:?})"
            );
            if read.last_notified_level.is_none() {
                assert_eq!(
                    read.last_outcome,
                    Some(RunOutcome::NotifyFailed),
                    "round {round}: nothing delivered, so the failure must be recorded \
                     (row={read:?})"
                );
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_an_evaluation_and_a_delivery_never_lose_each_others_writes() {
        // The one-writer rule under contention: the two writers touch disjoint
        // columns, so BOTH updates must survive whatever the interleaving.
        // Sequentially this is `test_evaluation_never_clobbers_delivery_state`;
        // concurrently it also catches a callback that echoed back observation
        // fields it had read before the evaluation committed.
        let db = test_db().await;

        for round in 0..RACE_ROUNDS {
            let alert_id = unique_alert_id(&format!("race-writers-{round}"));
            persist_with(
                db,
                &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
            )
            .await
            .unwrap();

            // Same episode, so the callback is always legitimate — only the
            // observation columns move.
            let episode = DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: 1_000,
                notified_at_enqueue: (None, None),
            };
            let mut refreshed = group_row(&alert_id, "g1", AlertLevel::Critical, 1_000);
            refreshed.last_outcome_at = Some(7_777);
            refreshed.last_seen = Some(7_777);

            let evaluation = tokio::spawn(async move { persist_with(db, &update_of(refreshed)).await });
            let cb_id = alert_id.clone();
            let callback = tokio::spawn(async move {
                advance_delivery_state_with(
                    db,
                    &cb_id,
                    "g1",
                    episode,
                    DeliveryOutcome::Delivered {
                        silence_minutes: 10,
                        at: 1_500,
                    },
                )
                .await
            });
            evaluation.await.unwrap().unwrap();
            assert!(
                callback.await.unwrap().unwrap(),
                "round {round}: the callback's episode was current"
            );

            let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();
            assert_eq!(
                read.last_notified_level,
                Some(AlertLevel::Critical),
                "round {round}: the evaluation erased the delivery (row={read:?})"
            );
            assert_eq!(
                read.last_seen,
                Some(7_777),
                "round {round}: the callback rolled the observation back (row={read:?})"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_a_failure_callback_never_rolls_back_a_concurrent_evaluation() {
        // The write-preservation invariant for the FAILURE path, which writes
        // different columns from the success path and so needs its own
        // coverage.
        //
        // The shape that has to stay correct: the callback decides from a row
        // it read, and the failure's contract is expressed as a whole
        // `AlertState`. Persisting that snapshot wholesale — which the ordinary
        // state upsert does — would write back `last_seen` and `level_at` as
        // they were before a concurrent evaluation committed. Rolling back
        // `last_seen` is not cosmetic: it is M-7's disappearance clock, so an
        // unlucky callback could age a live group toward resolution.
        //
        // Discriminating power, measured: LOW. Adding `last_seen` to the
        // failure path's SET clause does NOT make this fail, because the
        // callback's read and write share one SQLite transaction and the
        // stale-snapshot window never opens. What this pins is the INVARIANT
        // (observation columns survive a delivery callback) rather than the
        // mechanism enforcing it; it would catch a non-transactional
        // implementation, and it documents which columns each writer owns.
        let db = test_db().await;

        for round in 0..RACE_ROUNDS {
            let alert_id = unique_alert_id(&format!("race-failure-writes-{round}"));
            persist_with(
                db,
                &update_of(group_row(&alert_id, "g1", AlertLevel::Critical, 1_000)),
            )
            .await
            .unwrap();

            // Same episode, so the callback stays legitimate; only the
            // observation columns move underneath it.
            let episode = DeliveryEpisode {
                level: AlertLevel::Critical,
                level_since: 1_000,
                notified_at_enqueue: (None, None),
            };
            let mut refreshed = group_row(&alert_id, "g1", AlertLevel::Critical, 1_000);
            refreshed.last_seen = Some(8_888);
            refreshed.level_at = Some(8_888);

            let evaluation =
                tokio::spawn(async move { persist_with(db, &update_of(refreshed)).await });
            let cb_id = alert_id.clone();
            let callback = tokio::spawn(async move {
                advance_delivery_state_with(
                    db,
                    &cb_id,
                    "g1",
                    episode,
                    DeliveryOutcome::Failed { at: 1_600 },
                )
                .await
            });
            evaluation.await.unwrap().unwrap();
            assert!(
                callback.await.unwrap().unwrap(),
                "round {round}: the callback's episode was current"
            );

            let read = get_with(db, &alert_id, "g1").await.unwrap().unwrap();

            // Deliberately NOT asserted: that the row still reads
            // `NotifyFailed`. The outcome axis is EVALUATION's — it is in the
            // upsert's conflict list — so an evaluation landing after the
            // callback legitimately supersedes the failure with its own
            // observation. In production that is the cross-cycle reconciliation
            // the design relies on (a failure recorded this cycle is replaced by
            // next cycle's observed outcome). Only the columns the two writers
            // do NOT share are invariant, and those are what this checks.
            assert_eq!(
                read.last_seen,
                Some(8_888),
                "round {round}: the callback rolled M-7's clock back (row={read:?})"
            );
            assert_eq!(
                read.level_at,
                Some(8_888),
                "round {round}: the callback rolled the freshness clock back (row={read:?})"
            );
        }
    }

    // ================= §7.6: what a FROZEN evaluation must not touch =======
    //
    // These need a real database, and they deliberately drive the REAL
    // decision function rather than hand-building a noop. An earlier version
    // constructed `StateUpdate::noop()` directly and asserted the row was
    // untouched — which only proved that `write_update` returns early on
    // `state: None`, i.e. tested `if None { return }`. The property that
    // matters is that an evaluation which observed nothing DECIDES to write
    // nothing, and that the decision survives persistence.

    mod frozen {
        use config::meta::{
            alerts::{
                level::AlertLevel,
                state::{AlertState, apply_outcome},
            },
            self_reporting::usage::RunOutcome,
        };
        use sea_orm::{Database, DatabaseConnection};

        use super::super::*;
        use crate::table::migration::create_alert_state_tables_for_test;

        const ALERT: &str = "alert00000000000000000000";

        async fn db() -> DatabaseConnection {
            let db = Database::connect("sqlite::memory:")
                .await
                .expect("in-memory sqlite");
            create_alert_state_tables_for_test(&db)
                .await
                .expect("alert_states tables apply");
            db
        }

        async fn read(db: &DatabaseConnection) -> Option<alert_states::Model> {
            alert_states::Entity::find_by_id((ALERT.to_string(), ROLLUP_GROUP_KEY.to_string()))
                .one(db)
                .await
                .unwrap()
        }

        async fn persist(db: &DatabaseConnection, update: &StateUpdate) {
            let txn = db.begin().await.unwrap();
            write_update(&txn, update).await.unwrap();
            txn.commit().await.unwrap();
        }

        /// Establish a Critical alert at t=1000, through the real decision
        /// function so the stored clocks are the ones production would write.
        async fn seed_critical(db: &DatabaseConnection) -> AlertState {
            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                None,
                RunOutcome::Firing,
                Some(AlertLevel::Critical),
                1_000,
            );
            persist(db, &update).await;
            update.state.expect("a firing evaluation persists state")
        }

        /// The §7.6 rule for an evaluation that observed nothing: `error` must
        /// leave the entire level axis alone, `level_at` included, because
        /// composite staleness reads `level_at` as "when was this last
        /// *computed*" (§6.4). An alert erroring every minute must not look
        /// fresh.
        #[tokio::test]
        async fn an_errored_evaluation_persists_no_level_change() {
            let db = db().await;
            let prev = seed_critical(&db).await;

            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::Error,
                None, // nothing was observed
                5_000,
            );
            persist(&db, &update).await;

            let row = read(&db).await.expect("the row must still exist");
            assert_eq!(row.level, Some(AlertLevel::Critical.to_i32()));
            assert_eq!(row.level_since, Some(1_000), "level_since must not move");
            assert_eq!(
                row.level_at,
                Some(1_000),
                "level_at must NOT be refreshed by an evaluation that observed \
                 nothing — a composite would read a long-broken child as fresh"
            );
        }

        /// A `skipped` run writes nothing at all (the Part IV rule), so even
        /// the outcome clock stays put.
        #[tokio::test]
        async fn a_skipped_evaluation_writes_nothing_at_all() {
            let db = db().await;
            let prev = seed_critical(&db).await;
            let before = read(&db).await.unwrap();

            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::Skipped,
                None,
                5_000,
            );
            assert!(
                update.is_noop(),
                "a skipped run must decide to write nothing"
            );
            persist(&db, &update).await;

            assert_eq!(read(&db).await.unwrap(), before, "the row must be byte-identical");
        }

        /// The contrast case, so the tests above cannot pass vacuously: a real
        /// observation DOES refresh the freshness clock, while `level_since`
        /// still holds because the level itself did not change.
        #[tokio::test]
        async fn a_successful_evaluation_refreshes_freshness_but_not_level_since() {
            let db = db().await;
            let prev = seed_critical(&db).await;

            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::Firing,
                Some(AlertLevel::Critical),
                5_000,
            );
            persist(&db, &update).await;

            let row = read(&db).await.unwrap();
            assert_eq!(
                row.level_at,
                Some(5_000),
                "a real observation must refresh freshness"
            );
            assert_eq!(
                row.level_since,
                Some(1_000),
                "the level did not change, so level_since must not move"
            );
        }

        /// `notify_failed` is a delivery failure, not a measurement failure —
        /// the level was computed, so freshness advances (§7.6).
        #[tokio::test]
        async fn a_delivery_failure_still_counts_as_a_measurement() {
            let db = db().await;
            let prev = seed_critical(&db).await;

            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::NotifyFailed,
                Some(AlertLevel::Critical),
                5_000,
            );
            persist(&db, &update).await;

            let row = read(&db).await.unwrap();
            assert_eq!(
                row.level_at,
                Some(5_000),
                "delivery is irrelevant to whether the level was observed"
            );
            assert_eq!(row.level, Some(AlertLevel::Critical.to_i32()));
        }

        /// A freeze moves the **outcome** axis while leaving the **level**
        /// axis alone, and the transition row must show exactly that.
        ///
        /// This test was originally written asserting no transition at all,
        /// which was wrong and the suite caught it: `firing -> error` IS an
        /// outcome change, and transitions carry both axes. The invariant is
        /// not "a freeze writes nothing" — it is "a freeze writes nothing
        /// about the level".
        #[tokio::test]
        async fn a_frozen_evaluation_transitions_the_outcome_but_not_the_level() {
            let db = db().await;
            let prev = seed_critical(&db).await;

            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::Error,
                None,
                5_000,
            );
            persist(&db, &update).await;

            let rows = alert_state_transitions::Entity::find()
                .order_by_asc(alert_state_transitions::Column::At)
                .all(&db)
                .await
                .unwrap();
            let last = rows.last().expect("the outcome change is recorded");
            assert_eq!(last.to_outcome, RunOutcome::Error.to_i32());
            assert_eq!(last.from_outcome, Some(RunOutcome::Firing.to_i32()));
            assert_eq!(
                last.from_level,
                last.to_level,
                "the level axis must be unchanged across a freeze"
            );
            assert_eq!(last.to_level, Some(AlertLevel::Critical.to_i32()));
            assert_eq!(
                last.value, None,
                "a freeze observed nothing, so it records no value"
            );
        }

        /// A failed transaction must leave the previous state intact — a
        /// half-applied write would be worse than either outcome.
        #[tokio::test]
        async fn a_rolled_back_update_leaves_the_prior_state_intact() {
            let db = db().await;
            let prev = seed_critical(&db).await;

            // A recovery to Ok, rolled back part-way.
            let update = apply_outcome(
                ALERT,
                ROLLUP_GROUP_KEY,
                Some(&prev),
                RunOutcome::Normal,
                Some(AlertLevel::Ok),
                5_000,
            );
            let txn = db.begin().await.unwrap();
            write_update(&txn, &update).await.unwrap();
            txn.rollback().await.unwrap();

            let row = read(&db).await.unwrap();
            assert_eq!(
                row.level,
                Some(AlertLevel::Critical.to_i32()),
                "a rolled-back write must not have downgraded the level"
            );
            assert_eq!(row.level_at, Some(1_000));
            assert_eq!(
                alert_state_transitions::Entity::find()
                    .all(&db)
                    .await
                    .unwrap()
                    .len(),
                1,
                "the rolled-back transition must not have landed either"
            );
        }
    }
}
