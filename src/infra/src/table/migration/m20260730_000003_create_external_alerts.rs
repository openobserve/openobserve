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
                    .table(ExternalAlerts::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ExternalAlerts::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ExternalAlerts::OrgId).string().not_null())
                    .col(
                        ColumnDef::new(ExternalAlerts::IntegrationId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ExternalAlerts::DetectedSource)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ExternalAlerts::DedupKey).string().not_null())
                    .col(ColumnDef::new(ExternalAlerts::Title).string().not_null())
                    .col(ColumnDef::new(ExternalAlerts::Severity).string().not_null())
                    .col(
                        ColumnDef::new(ExternalAlerts::State)
                            .string()
                            .not_null()
                            .default("firing"),
                    )
                    .col(
                        ColumnDef::new(ExternalAlerts::Labels)
                            .text()
                            .not_null()
                            .default("{}"),
                    )
                    .col(ColumnDef::new(ExternalAlerts::SourceUrl).string().null())
                    .col(
                        ColumnDef::new(ExternalAlerts::LastPayload)
                            .text()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(ExternalAlerts::FirstSeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ExternalAlerts::LastSeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ExternalAlerts::ResolvedAt)
                            .big_integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(ExternalAlerts::Table)
                    .name("idx_external_alerts_identity")
                    .col(ExternalAlerts::OrgId)
                    .col(ExternalAlerts::IntegrationId)
                    .col(ExternalAlerts::DetectedSource)
                    .col(ExternalAlerts::DedupKey)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(ExternalAlerts::Table)
                    .name("idx_external_alerts_org_state")
                    .col(ExternalAlerts::OrgId)
                    .col(ExternalAlerts::State)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ExternalAlerts::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ExternalAlerts {
    Table,
    Id,
    OrgId,
    IntegrationId,
    DetectedSource,
    DedupKey,
    Title,
    Severity,
    State,
    Labels,
    SourceUrl,
    LastPayload,
    FirstSeenAt,
    LastSeenAt,
    ResolvedAt,
}
