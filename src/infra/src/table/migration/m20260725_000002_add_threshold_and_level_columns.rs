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

//! Multi-level thresholds — Feature 1 of `alerts_2.md` (decision D1 = Option B).
//!
//! Three additive, nullable changes:
//!
//! 1. `alerts.trigger_thresholds` — JSON config for the level/threshold axis. A blob rather than
//!    one column per knob because SLO alerting brings a cluster of them at once (burn-rate
//!    warning/critical, long/short windows, error-budget threshold) on top of recovery thresholds
//!    and `notify_on_warning`. Scope rule: this column holds **threshold and level configuration
//!    only** — not routing, not scheduling.
//! 2. `alert_states` — the level axis, deliberately separate from the outcome axis shipped in
//!    `m20260725_000001`.
//! 3. `alert_state_transitions` — level before/after, so an escalation is recorded even when the
//!    outcome is unchanged.
//!
//! Everything is nullable with no backfill: absent = single-level alert with no
//! level ever classified, which is exactly the pre-existing behaviour (G5).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Two SQLite constraints shape this, both learned the hard way:
        //
        // 1. Only ONE alter option per ALTER TABLE — sea-query *panics* (not errors) when a
        //    statement carries more, taking the node down mid-migration. Hence one `add_column` per
        //    statement.
        // 2. `add_column_if_not_exists` is NOT idempotent on SQLite: it emits a plain ADD COLUMN,
        //    so re-running after a partial failure dies with "duplicate column name" and can never
        //    recover. Hence the explicit `has_column` guard below.
        //
        // NOTE: no index on any of the state columns. `alert_states` is
        // high-churn (one upsert per evaluation per alert) and indexing a
        // mutable column defeats HOT updates — same discipline as
        // `scheduled_jobs`.
        add_column(manager, ALERTS, Alerts::TriggerThresholds, ColType::Json).await?;

        add_column(manager, ALERT_STATES, AlertStates::Level, ColType::Int).await?;
        add_column(
            manager,
            ALERT_STATES,
            AlertStates::LevelSince,
            ColType::BigInt,
        )
        .await?;
        add_column(manager, ALERT_STATES, AlertStates::LevelAt, ColType::BigInt).await?;

        add_column(
            manager,
            ALERT_TRANSITIONS,
            AlertStateTransitions::FromLevel,
            ColType::Int,
        )
        .await?;
        add_column(
            manager,
            ALERT_TRANSITIONS,
            AlertStateTransitions::ToLevel,
            ColType::Int,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same one-per-statement rule as `up`.
        for col in [
            AlertStateTransitions::FromLevel,
            AlertStateTransitions::ToLevel,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertStateTransitions::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        for col in [
            AlertStates::Level,
            AlertStates::LevelSince,
            AlertStates::LevelAt,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertStates::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::TriggerThresholds)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

const ALERTS: &str = "alerts";
const ALERT_STATES: &str = "alert_states";
const ALERT_TRANSITIONS: &str = "alert_state_transitions";

#[derive(Clone, Copy)]
enum ColType {
    Int,
    BigInt,
    Json,
}

/// Add one nullable column, skipping it if already present.
///
/// Genuinely idempotent, unlike `add_column_if_not_exists` on SQLite, so a
/// migration interrupted partway can be retried.
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
        ColType::Json => def.json(),
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

#[derive(DeriveIden, Clone)]
enum Alerts {
    Table,
    TriggerThresholds,
}

#[derive(DeriveIden, Clone)]
enum AlertStates {
    Table,
    Level,
    LevelSince,
    LevelAt,
}

#[derive(DeriveIden, Clone)]
enum AlertStateTransitions {
    Table,
    FromLevel,
    ToLevel,
}
