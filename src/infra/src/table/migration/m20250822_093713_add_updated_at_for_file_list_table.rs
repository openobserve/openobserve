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

use sea_orm::Statement;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const UPDATED_AT_DELETED_IDX: &str = "file_list_updated_at_deleted_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // create field first
        manager.alter_table(add_updated_at_column_stmnt()).await?;
        // create index first
        manager.create_index(create_updated_at_idx_stmnt()).await?;
        // set default value for existing rows
        set_updated_at_for_existing_rows(manager).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(UPDATED_AT_DELETED_IDX).to_owned())
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(FileList::Table)
                    .drop_column(FileList::UpdatedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

/// Statement to add updated_at column to the file_list table.
fn add_updated_at_column_stmnt() -> TableAlterStatement {
    Table::alter()
        .table(FileList::Table)
        .add_column(
            ColumnDef::new(FileList::UpdatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// Statement to create index on the updated_at and deleted columns of the file_list table.
fn create_updated_at_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(UPDATED_AT_DELETED_IDX)
        .table(FileList::Table)
        .col(FileList::UpdatedAt)
        .col(FileList::Deleted)
        .to_owned()
}

/// Set updated_at for existing rows. use the value of min_ts field to set the updated_at field.
async fn set_updated_at_for_existing_rows(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    // Update existing rows with updated_at = min_ts where updated_at = 0
    let db = manager.get_connection();
    let backend = db.get_database_backend();

    log::info!("[FILE_LIST_MIGRATION] db backend: {backend:?}");

    let update_query = Query::update()
        .table(FileList::Table)
        .value(FileList::UpdatedAt, Expr::col(FileList::MinTs))
        .and_where(Expr::col(FileList::UpdatedAt).eq(0))
        .to_owned();

    let (sql, values) = match backend {
        sea_orm::DatabaseBackend::MySql => update_query.build(MysqlQueryBuilder),
        sea_orm::DatabaseBackend::Postgres => update_query.build(PostgresQueryBuilder),
        sea_orm::DatabaseBackend::Sqlite => update_query.build(SqliteQueryBuilder),
    };
    let statement = Statement::from_sql_and_values(backend, sql, values);
    let ret = db.execute(statement).await?;
    log::info!("[FILE_LIST_MIGRATION] updated {} rows", ret.rows_affected());

    Ok(())
}

/// Identifiers used in queries on the alerts table.
#[derive(DeriveIden)]
enum FileList {
    Table,
    UpdatedAt,
    Deleted,
    MinTs,
}
