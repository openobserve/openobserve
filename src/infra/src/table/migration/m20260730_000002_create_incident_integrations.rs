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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(IncidentIntegrations::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(IncidentIntegrations::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::Name)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::SourceType)
                            .string()
                            .not_null()
                            .default("auto"),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::Token)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::Config)
                            .text()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::CreatedBy)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrations::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(IncidentIntegrations::Table)
                    .name("idx_incident_integrations_org_id")
                    .col(IncidentIntegrations::OrgId)
                    .to_owned(),
            )
            .await?;

        // Unique (org_id, name) so `ensure_default_for_org`'s get-or-create is
        // race-safe across nodes — the DB constraint is what actually closes
        // the race; the app-level find-then-insert alone cannot.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(IncidentIntegrations::Table)
                    .name("idx_incident_integrations_org_name")
                    .col(IncidentIntegrations::OrgId)
                    .col(IncidentIntegrations::Name)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(IncidentIntegrationSenders::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::IntegrationId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::DetectedSource)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::SenderLabel)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::FirstReceivedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::LastReceivedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::AcceptedCount)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::RejectedCount)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(IncidentIntegrationSenders::ResolvedSeen)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(IncidentIntegrationSenders::Table)
                    .name("idx_incident_integration_senders_unique")
                    .col(IncidentIntegrationSenders::IntegrationId)
                    .col(IncidentIntegrationSenders::DetectedSource)
                    .col(IncidentIntegrationSenders::SenderLabel)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(IncidentIntegrationSenders::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(IncidentIntegrations::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum IncidentIntegrations {
    Table,
    Id,
    OrgId,
    Name,
    SourceType,
    Token,
    Enabled,
    Config,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum IncidentIntegrationSenders {
    Table,
    Id,
    IntegrationId,
    DetectedSource,
    SenderLabel,
    FirstReceivedAt,
    LastReceivedAt,
    AcceptedCount,
    RejectedCount,
    ResolvedSeen,
}
