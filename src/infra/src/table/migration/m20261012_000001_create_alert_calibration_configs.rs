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

//! Per-org alert calibration configuration.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(table_statement()).await?;
        manager.create_index(org_index_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertCalibrationConfigs::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

fn table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertCalibrationConfigs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertCalibrationConfigs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::Enabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::FrequencyMinutes)
                .integer()
                .not_null()
                .default(1440),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::WindowMinutes)
                .integer()
                .not_null()
                .default(43200),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertCalibrationConfigs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn org_index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_alert_calibration_configs_org")
        .table(AlertCalibrationConfigs::Table)
        .col(AlertCalibrationConfigs::Org)
        .unique()
        .if_not_exists()
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertCalibrationConfigs {
    Table,
    Id,
    Org,
    Enabled,
    FrequencyMinutes,
    WindowMinutes,
    CreatedAt,
    UpdatedAt,
}
