// Copyright 2025 OpenObserve Inc.
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

//! Alert correlation schema from scratch
//!
//! This migration creates:
//! 1. alert_incidents table
//! 2. alert_incident_alerts junction table
//!
//! NOTE: Org-level configs use the existing key-value DB interface.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_alert_incidents_table(manager).await?;
        create_alert_incident_alerts_table(manager).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertIncidentAlerts::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(AlertIncidents::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

async fn create_alert_incidents_table(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(AlertIncidents::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(AlertIncidents::IncidentId)
                        .char_len(27)
                        .not_null()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::OrgId)
                        .string_len(255)
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::Status)
                        .string_len(20)
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::CreatedAt)
                        .big_integer()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::UpdatedAt)
                        .big_integer()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::ResolvedAt)
                        .big_integer()
                        .null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::CanonicalDimensions)
                        .json()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::AlertCount)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .col(
                    ColumnDef::new(AlertIncidents::TemporalOnlyCount)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .col(
                    ColumnDef::new(AlertIncidents::PrimaryCorrelationType)
                        .string_len(20)
                        .null(),
                )
                .col(
                    ColumnDef::new(AlertIncidents::CorrelationConfidence)
                        .string_len(20)
                        .null(),
                )
                .col(ColumnDef::new(AlertIncidents::RootCause).text().null())
                .col(
                    ColumnDef::new(AlertIncidents::RecommendedActions)
                        .json()
                        .null(),
                )
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incidents_org_id")
                .table(AlertIncidents::Table)
                .col(AlertIncidents::OrgId)
                .to_owned(),
        )
        .await?;
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incidents_status")
                .table(AlertIncidents::Table)
                .col(AlertIncidents::Status)
                .to_owned(),
        )
        .await?;
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incidents_created_at")
                .table(AlertIncidents::Table)
                .col(AlertIncidents::CreatedAt)
                .to_owned(),
        )
        .await?;
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incidents_org_status_time")
                .table(AlertIncidents::Table)
                .col(AlertIncidents::OrgId)
                .col(AlertIncidents::Status)
                .col(AlertIncidents::CreatedAt)
                .to_owned(),
        )
        .await?;

    Ok(())
}

async fn create_alert_incident_alerts_table(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(AlertIncidentAlerts::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(AlertIncidentAlerts::IncidentId)
                        .char_len(27)
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidentAlerts::AlertId)
                        .char_len(27)
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidentAlerts::TriggerId)
                        .string_len(64)
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidentAlerts::TriggeredAt)
                        .big_integer()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidentAlerts::AddedAt)
                        .big_integer()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(AlertIncidentAlerts::MatchType)
                        .string_len(20)
                        .not_null(),
                )
                .primary_key(
                    Index::create()
                        .col(AlertIncidentAlerts::IncidentId)
                        .col(AlertIncidentAlerts::TriggerId),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_alert_incident_alerts_incident")
                        .from(AlertIncidentAlerts::Table, AlertIncidentAlerts::IncidentId)
                        .to(AlertIncidents::Table, AlertIncidents::IncidentId)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_alert_incident_alerts_alert")
                        .from(AlertIncidentAlerts::Table, AlertIncidentAlerts::AlertId)
                        .to(Alerts::Table, Alerts::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incident_alerts_incident_id")
                .table(AlertIncidentAlerts::Table)
                .col(AlertIncidentAlerts::IncidentId)
                .to_owned(),
        )
        .await?;
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incident_alerts_alert_id")
                .table(AlertIncidentAlerts::Table)
                .col(AlertIncidentAlerts::AlertId)
                .to_owned(),
        )
        .await?;
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_incident_alerts_triggered_at")
                .table(AlertIncidentAlerts::Table)
                .col(AlertIncidentAlerts::TriggeredAt)
                .to_owned(),
        )
        .await?;

    Ok(())
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    IncidentId,
    OrgId,
    Status,
    CreatedAt,
    UpdatedAt,
    ResolvedAt,
    CanonicalDimensions,
    AlertCount,
    TemporalOnlyCount,
    PrimaryCorrelationType,
    CorrelationConfidence,
    RootCause,
    RecommendedActions,
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    IncidentId,
    AlertId,
    TriggerId,
    TriggeredAt,
    AddedAt,
    MatchType,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    Id,
}
