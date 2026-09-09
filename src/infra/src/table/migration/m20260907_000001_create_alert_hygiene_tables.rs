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

//! Alert hygiene per-org configuration.

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
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertHygieneConfigs::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

pub(super) fn configs_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertHygieneConfigs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertHygieneConfigs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::Enabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::FrequencyMinutes)
                .integer()
                .not_null()
                .default(1440),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::WindowMinutes)
                .integer()
                .not_null()
                .default(43200),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::CreatedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::UpdatedAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

pub(super) fn config_indexes() -> [IndexCreateStatement; 1] {
    // One row per org, so nothing composite leading with `org` can narrow further.
    [Index::create()
        .name("idx_alert_hygiene_configs_org")
        .table(AlertHygieneConfigs::Table)
        .col(AlertHygieneConfigs::Org)
        .unique()
        .if_not_exists()
        .to_owned()]
}

#[derive(DeriveIden)]
enum AlertHygieneConfigs {
    Table,
    Id,
    Org,
    Enabled,
    FrequencyMinutes,
    WindowMinutes,
    CreatedAt,
    UpdatedAt,
}
