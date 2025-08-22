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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // set default value for existing rows
        set_updated_at_for_existing_rows(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

/// Set updated_at for existing rows. use the value of min_ts field to set the updated_at field.
async fn set_updated_at_for_existing_rows(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    // Update existing rows with updated_at = min_ts where updated_at = 0
    let db = manager.get_connection();
    let backend = db.get_database_backend();

    log::debug!("[FILE_LIST_MIGRATION] db backend: {backend:?}");

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
    log::debug!("[FILE_LIST_MIGRATION] updated {} rows", ret.rows_affected());

    Ok(())
}

/// Identifiers used in queries on the alerts table.
#[derive(DeriveIden)]
enum FileList {
    Table,
    UpdatedAt,
    MinTs,
}
