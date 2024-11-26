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

//* Replaces the created_at "date time" column with a created_at column that
//* stores a Unix timestamp.

use sea_orm::{ActiveModelTrait, EntityTrait, PaginatorTrait, Set, TransactionTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_created_at_tmp_column(manager).await?;
        populate_created_at_tmp(manager).await?;
        drop_created_at_column(manager).await?;
        rename_created_at_tmp_column(manager).await?;
        make_created_at_column_not_null(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

// Create the new created_at_tmp column into which a created_at Unix timestamp
// will be stored.
async fn create_created_at_tmp_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .add_column(ColumnDef::new(Folders::CreatedAtTmp).big_integer().null())
                .to_owned(),
        )
        .await?;
    Ok(())
}

// Copies the timestamp from the created_at column into a Unix timestamp in the
// created_at_tmp column.
async fn populate_created_at_tmp(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let txn = manager.get_connection().begin().await?;

    // Migrate pages of 100 records at a time to avoid loading too many
    // records into memory.
    let mut folder_pages = folders_mysql::Entity::find().paginate(&txn, 100);
    while let Some(folders) = folder_pages.fetch_and_next().await? {
        for f in folders {
            let mut am: folders_mysql::ActiveModel = f.into();
            let unix_timestamp = if let Some(value) = am.created_at.take() {
                value.timestamp()
            } else {
                chrono::offset::Utc::now().timestamp()
            };
            am.created_at_tmp = Set(Some(unix_timestamp));
            am.update(&txn).await?;
        }
    }

    txn.commit().await?;
    Ok(())
}

// Removes the old created_at column.
async fn drop_created_at_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .drop_column(Folders::CreatedAt)
                .to_owned(),
        )
        .await?;
    Ok(())
}

// Renames the new created_at_tmp column to created_at.
async fn rename_created_at_tmp_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .rename_column(Folders::CreatedAtTmp, Folders::CreatedAt)
                .to_owned(),
        )
        .await?;
    Ok(())
}

// Renames the new created_at_tmp column to created_at.
async fn make_created_at_column_not_null(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .modify_column(ColumnDef::new(Folders::CreatedAt).big_integer().not_null())
                .to_owned(),
        )
        .await?;
    Ok(())
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
enum Folders {
    Table,
    CreatedAt,
    CreatedAtTmp,
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the folder table for MySQL during the time this migration
/// executes, after the created_at_tmp column is created and before the old
/// created_at column is deleted.
mod folders_mysql {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        #[sea_orm(column_type = "Text", nullable)]
        pub description: Option<String>,
        pub r#type: i16,
        pub created_at: DateTimeUtc,
        pub created_at_tmp: Option<i64>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the folder table for PostgreSQL during the time this
/// migration executes, after the created_at_tmp column is created and before
/// the old created_at column is deleted.
mod folders_psql {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        #[sea_orm(column_type = "Text", nullable)]
        pub description: Option<String>,
        pub r#type: i16,
        pub created_at: DateTime,
        pub created_at_tmp: Option<i64>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
