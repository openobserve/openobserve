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

//! Adds the alerts's align_time column

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        add_align_time_column(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

// Adds the alerts's align_time column.
async fn add_align_time_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    if matches!(manager.get_database_backend(), sea_orm::DbBackend::MySql) {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column(
                        ColumnDef::new(Alerts::AlignTime)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await?;
    } else {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::AlignTime)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await?;
    }

    Ok(())
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
enum Alerts {
    Table,
    AlignTime,
}
