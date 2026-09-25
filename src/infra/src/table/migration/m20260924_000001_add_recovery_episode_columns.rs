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

//! Firing-episode columns — alert recovery (o2-enterprise#2690, DR-1/DR-2).
//!
//! A firing episode is the span between the first notification an alert
//! actually delivered and the recovery that answers it. Its id is minted on
//! that first delivery and cleared in the same write that emits the recovery,
//! so a second emit has nothing left to reference — exactly-once is structural
//! rather than guarded.
//!
//! `alert_states`:
//! - `episode_id`          — the open episode, and the PagerDuty `dedup_key`. NULL = nothing
//!   delivered, so there is nothing to recover from. A firing suppressed by the silence window or
//!   the pending period never mints one, which is what makes "was this ever paged?" answerable
//!   without a second source of truth.
//! - `episode_opened_at`   — when the episode first delivered, for the recovery's duration.
//! - `episode_incident_id` — the incident that owned firing delivery, so the recovery is routed to
//!   whoever sent the trigger (DR-3). NULL = the alert path owns it. Stored at delivery time rather
//!   than recomputed at recovery time, because the incident may have changed shape in between.
//! - `recovering_since`    — when the condition first cleared, while `keep_firing_for` holds the
//!   episode open. NULL = not in the hold.
//!
//! `alert_incident_alerts`:
//! - `resolved_at`         — this firing recovered. The primary key already carries
//!   `alert_fired_at`, so a row is one firing and not one alert; the incident resolves once every
//!   linked alert's latest row has this set.
//!
//! `alerts`:
//! - `notify_on_recovery`  — per-alert opt-in (DR-4). NULL means the alert predates the feature,
//!   which is the same as `false`.
//! - `keep_firing_for_seconds` — resolution-side debounce (DR-5). NULL/0 recovers on the first
//!   clear evaluation, which is the behaviour every existing alert already has.
//!
//! All additive and nullable, so a newer node reading an older row sees NULL —
//! correctly "no episode" — and an older node ignores what it cannot see. No
//! index on the episode columns: they are mutable columns on the hottest alert
//! write path (`alerts.md` Part IV), and every read of them already has the
//! row in hand.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same two SQLite constraints as every other alter in this directory:
        // ONE alter option per statement, and an explicit `has_column` guard
        // because `add_column_if_not_exists` is not idempotent on SQLite.
        add_column(manager, STATES, AlertStates::EpisodeId, ColType::Text).await?;
        add_column(
            manager,
            STATES,
            AlertStates::EpisodeOpenedAt,
            ColType::BigInt,
        )
        .await?;
        add_column(
            manager,
            STATES,
            AlertStates::EpisodeIncidentId,
            ColType::Text,
        )
        .await?;
        add_column(
            manager,
            STATES,
            AlertStates::RecoveringSince,
            ColType::BigInt,
        )
        .await?;
        add_column(
            manager,
            INCIDENT_ALERTS,
            AlertIncidentAlerts::ResolvedAt,
            ColType::BigInt,
        )
        .await?;
        add_column(manager, ALERTS, Alerts::NotifyOnRecovery, ColType::Boolean).await?;
        add_column(
            manager,
            ALERTS,
            Alerts::KeepFiringForSeconds,
            ColType::BigInt,
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_column(manager, ALERTS, Alerts::KeepFiringForSeconds).await?;
        drop_column(manager, ALERTS, Alerts::NotifyOnRecovery).await?;
        drop_column(manager, INCIDENT_ALERTS, AlertIncidentAlerts::ResolvedAt).await?;
        drop_column(manager, STATES, AlertStates::RecoveringSince).await?;
        drop_column(manager, STATES, AlertStates::EpisodeIncidentId).await?;
        drop_column(manager, STATES, AlertStates::EpisodeOpenedAt).await?;
        drop_column(manager, STATES, AlertStates::EpisodeId).await
    }
}

const STATES: &str = "alert_states";
const INCIDENT_ALERTS: &str = "alert_incident_alerts";
const ALERTS: &str = "alerts";

#[derive(Clone, Copy)]
enum ColType {
    BigInt,
    Text,
    Boolean,
}

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
        ColType::BigInt => def.big_integer(),
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
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if !manager.has_column(table, &name).await? {
        return Ok(());
    }
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
    EpisodeId,
    EpisodeOpenedAt,
    EpisodeIncidentId,
    RecoveringSince,
}

#[derive(DeriveIden, Clone)]
enum AlertIncidentAlerts {
    ResolvedAt,
}

#[derive(DeriveIden, Clone)]
enum Alerts {
    NotifyOnRecovery,
    KeepFiringForSeconds,
}
