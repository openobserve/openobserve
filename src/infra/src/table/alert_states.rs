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

use super::entity::{alert_state_transitions, alert_states};
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
        }
    }
}

/// Fetch the state row for one `(alert_id, group_key)`.
pub async fn get(alert_id: &str, group_key: &str) -> Result<Option<AlertState>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(
        alert_states::Entity::find_by_id((alert_id.to_string(), group_key.to_string()))
            .one(client)
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
    Ok(alert_states::Entity::find()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .filter(alert_states::Column::GroupKey.ne(ROLLUP_GROUP_KEY))
        .all(client)
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
    let txn = client.begin().await?;
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
    let txn = client.begin().await?;

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
    alert_states::Entity::delete_many()
        .filter(alert_states::Column::AlertId.eq(alert_id))
        .filter(alert_states::Column::GroupKey.is_in(group_keys.to_vec()))
        .exec(client)
        .await?;
    Ok(())
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
            ])
            .to_owned(),
        )
        .exec(txn)
        .await?;

    if let Some(t) = update.transition.as_ref() {
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
    }

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
}
