// Copyright 2024 OpenObserve Inc.
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

//! Drops the folder's created_at column since Sea ORM maps this column's data
//! type to different Rust types creating runtime errors when running on a
//! non-PostgreSQL database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_folder_id_column(manager).await?;
        rename_folder_uuid_column(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

async fn drop_folder_id_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .drop_column(Folders::Id)
                .to_owned(),
        )
        .await?;
    Ok(())
}

async fn rename_folder_uuid_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .rename_column(Folders::FolderUuid, Folders::Id)
                .to_owned(),
        )
        .await?;
    Ok(())
}

#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
    FolderUuid,
}
