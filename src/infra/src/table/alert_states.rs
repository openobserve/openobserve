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
    alerts::state::{AlertState, ROLLUP_GROUP_KEY, StateTransition, StateUpdate},
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
        }
    }
}

/// Fetch the state row for one `(alert_id, group_key)`.
pub async fn get(alert_id: &str, group_key: &str) -> Result<Option<AlertState>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(alert_states::Entity::find_by_id((
        alert_id.to_string(),
        group_key.to_string(),
    ))
    .one(client)
    .await?
    .map(Into::into))
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
    let Some(state) = update.state.as_ref() else {
        return Ok(());
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;

    let model = alert_states::ActiveModel {
        alert_id: Set(state.alert_id.clone()),
        group_key: Set(state.group_key.clone()),
        last_outcome: Set(state.last_outcome.as_ref().map(|o| o.to_i32())),
        last_outcome_at: Set(state.last_outcome_at),
        since: Set(state.since),
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
            ])
            .to_owned(),
        )
        .exec(&txn)
        .await?;

    if let Some(t) = update.transition.as_ref() {
        alert_state_transitions::ActiveModel {
            alert_id: Set(t.alert_id.clone()),
            group_key: Set(t.group_key.clone()),
            from_outcome: Set(t.from_outcome.as_ref().map(|o| o.to_i32())),
            to_outcome: Set(t.to_outcome.to_i32()),
            at: Set(t.at),
            ..Default::default()
        }
        .insert(&txn)
        .await?;
    }

    txn.commit().await?;
    Ok(())
}

/// Transitions for one alert, newest first.
pub async fn list_transitions(
    alert_id: &str,
    limit: u64,
) -> Result<Vec<StateTransition>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(alert_state_transitions::Entity::find()
        .filter(alert_state_transitions::Column::AlertId.eq(alert_id))
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
                at: m.at,
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
}
