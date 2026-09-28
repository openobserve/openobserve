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

//! Firing-episode columns for alert recovery — additive and nullable, so NULL reads as "no
//! episode".

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
