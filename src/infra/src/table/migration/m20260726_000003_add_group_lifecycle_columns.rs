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

//! Per-group lifecycle columns — Feature 3 (M-2, M-4, M-6, M-7, M-8).
//!
//! `alert_states`:
//! - `last_seen`      — last evaluation that actually *included* this group. A separate clock from
//!   `last_outcome_at` on purpose: resolving a vanished group records a real outcome *now*, so
//!   `last_outcome_at` advances, while the group was not seen then, so `last_seen` must not. The
//!   gap between them is what makes "already resolved" derivable without a fourth state column.
//! - `group_labels`   — rendered labels for UI and templates (M-4).
//! - `groups_observed`— rollup row only: the true pre-cap group count, so the M-6 overflow warning
//!   can render from stored state on list/detail views.
//!
//! `alert_state_transitions`:
//! - `value`          — observed value at transition time; the source for per-group history (M-8).
//!   NULL on a disappearance transition — the group stopped being returned, so there is no
//!   observation, and 0.0 would render as a real measurement of zero.
//! - `group_labels`   — duplicated from the state row deliberately: state rows are reaped after the
//!   grace period while transitions are retained, and `group_key` is a hash. Without this, history
//!   outlives the only thing that could say which host it was about.
//!
//! All additive and nullable. NULL `last_seen` means "written before this
//! migration" and is treated as *unknown*, never as epoch — reading it as
//! epoch would resolve or reap every legacy row on the first sweep after
//! upgrade. No index: these are mutable columns on the hottest alert write
//! path (`alerts.md` Part IV).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same two SQLite constraints as every other alter in this directory:
        // ONE alter option per statement (sea-query panics otherwise, taking
        // the node down mid-migration), and an explicit `has_column` guard
        // because `add_column_if_not_exists` is not idempotent on SQLite.
        add_column(manager, STATES, AlertStates::LastSeen, ColType::BigInt).await?;
        add_column(manager, STATES, AlertStates::GroupLabels, ColType::Text).await?;
        add_column(manager, STATES, AlertStates::GroupsObserved, ColType::Int).await?;
        add_column(manager, STATES, AlertStates::GroupsFiring, ColType::Int).await?;
        add_column(
            manager,
            STATES,
            AlertStates::GroupsObservedIsLowerBound,
            ColType::Boolean,
        )
        .await?;
        add_column(
            manager,
            STATES,
            AlertStates::GroupsFiringIsLowerBound,
            ColType::Boolean,
        )
        .await?;

        add_column(
            manager,
            TRANSITIONS,
            AlertStateTransitions::Value,
            ColType::Double,
        )
        .await?;
        add_column(
            manager,
            TRANSITIONS,
            AlertStateTransitions::GroupLabels,
            ColType::Text,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for col in [
            AlertStateTransitions::GroupLabels,
            AlertStateTransitions::Value,
        ] {
            drop_column(manager, TRANSITIONS, col).await?;
        }
        for col in [
            AlertStates::GroupsFiringIsLowerBound,
            AlertStates::GroupsObservedIsLowerBound,
            AlertStates::GroupsFiring,
            AlertStates::GroupsObserved,
            AlertStates::GroupLabels,
            AlertStates::LastSeen,
        ] {
            drop_column(manager, STATES, col).await?;
        }
        Ok(())
    }
}

const STATES: &str = "alert_states";
const TRANSITIONS: &str = "alert_state_transitions";

#[derive(Clone, Copy)]
enum ColType {
    Int,
    BigInt,
    Double,
    Text,
    Boolean,
}

/// Add one nullable column, skipping it if already present.
async fn add_column<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    ty: ColType,
) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    let mut def = ColumnDef::new(column);
    let def = match ty {
        ColType::Int => def.integer(),
        ColType::BigInt => def.big_integer(),
        ColType::Double => def.double(),
        ColType::Text => def.text(),
        ColType::Boolean => def.boolean(),
    }
    .null()
    .to_owned();

    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(def)
                .to_owned(),
        )
        .await
}

async fn drop_column<C>(manager: &SchemaManager<'_>, table: &str, column: C) -> Result<(), DbErr>
where
    C: IntoIden,
{
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .drop_column(column)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden, Clone)]
enum AlertStates {
    LastSeen,
    GroupLabels,
    GroupsObserved,
    GroupsFiring,
    GroupsObservedIsLowerBound,
    GroupsFiringIsLowerBound,
}

#[derive(DeriveIden, Clone)]
enum AlertStateTransitions {
    Value,
    GroupLabels,
}
