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

//! Change the column type for mysql db enrichment_tables table created_at column

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        increase_data_column_size(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

// Increase the data column size.
async fn increase_data_column_size(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    if !matches!(manager.get_database_backend(), sea_orm::DbBackend::MySql) {
        log::debug!("[Migration] Non-mysql db does not need this migration");
        return Ok(());
    }
    manager
        .alter_table(increase_data_column_size_statement())
        .await?;
    Ok(())
}

fn increase_data_column_size_statement() -> TableAlterStatement {
    Table::alter()
        .table(EnrichmentTables::Table)
        .modify_column(
            ColumnDef::new(EnrichmentTables::CreatedAt)
                .big_integer()
                .not_null()
                .to_owned(),
        )
        .to_owned()
}

/// Identifiers used in queries on the enrichment tables table.
#[derive(DeriveIden)]
enum EnrichmentTables {
    Table,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mysql() {
        let statement = increase_data_column_size_statement();
        assert_eq!(
            statement.to_string(MysqlQueryBuilder),
            "ALTER TABLE `enrichment_tables` MODIFY COLUMN `created_at` bigint NOT NULL"
        );
    }
}
