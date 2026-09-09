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

//! Raman per-org configuration and the digests its scheduled runs produce.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(configs_statement()).await?;
        for index in config_indexes() {
            manager.create_index(index).await?;
        }
        manager.create_table(digests_statement()).await?;
        for index in digest_indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RamanDigests::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(RamanConfigs::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

pub(super) fn configs_statement() -> TableCreateStatement {
    Table::create()
        .table(RamanConfigs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RamanConfigs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(RamanConfigs::Org).string_len(100).not_null())
        .col(
            ColumnDef::new(RamanConfigs::Enabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(RamanConfigs::FrequencyMinutes)
                .integer()
                .not_null()
                .default(1440),
        )
        .col(
            ColumnDef::new(RamanConfigs::WindowMinutes)
                .integer()
                .not_null()
                .default(43200),
        )
        .col(ColumnDef::new(RamanConfigs::CreatedAt).big_integer().null())
        .col(ColumnDef::new(RamanConfigs::UpdatedAt).big_integer().null())
        .to_owned()
}

pub(super) fn digests_statement() -> TableCreateStatement {
    Table::create()
        .table(RamanDigests::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RamanDigests::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(RamanDigests::Org).string_len(100).not_null())
        .col(
            ColumnDef::new(RamanDigests::ConfigId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(RamanDigests::Cluster)
                .string_len(100)
                .not_null()
                .default(""),
        )
        .col(
            ColumnDef::new(RamanDigests::WindowStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RamanDigests::WindowEnd)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RamanDigests::GeneratedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RamanDigests::FindingCount)
                .integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(RamanDigests::Findings).json().not_null())
        .col(
            ColumnDef::new(RamanDigests::CoverageGap)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

pub(super) fn config_indexes() -> [IndexCreateStatement; 1] {
    // One row per org, so nothing composite leading with `org` can narrow further.
    [Index::create()
        .name("idx_raman_configs_org")
        .table(RamanConfigs::Table)
        .col(RamanConfigs::Org)
        .unique()
        .if_not_exists()
        .to_owned()]
}

pub(super) fn digest_indexes() -> [IndexCreateStatement; 3] {
    [
        // A re-pulled overrunning run must not write a second digest for the window.
        Index::create()
            .name("idx_raman_digests_config_cluster_window")
            .table(RamanDigests::Table)
            .col(RamanDigests::ConfigId)
            .col(RamanDigests::Cluster)
            .col(RamanDigests::WindowStart)
            .col(RamanDigests::WindowEnd)
            .unique()
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_raman_digests_org_window_end")
            .table(RamanDigests::Table)
            .col(RamanDigests::Org)
            .col(RamanDigests::WindowEnd)
            .if_not_exists()
            .to_owned(),
        // The hourly retention sweep carries no org, so an `org`-leading index cannot serve it.
        Index::create()
            .name("idx_raman_digests_window_end")
            .table(RamanDigests::Table)
            .col(RamanDigests::WindowEnd)
            .if_not_exists()
            .to_owned(),
    ]
}

#[derive(DeriveIden)]
enum RamanConfigs {
    Table,
    Id,
    Org,
    Enabled,
    FrequencyMinutes,
    WindowMinutes,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RamanDigests {
    Table,
    Id,
    Org,
    ConfigId,
    Cluster,
    WindowStart,
    WindowEnd,
    GeneratedAt,
    FindingCount,
    Findings,
    CoverageGap,
}
