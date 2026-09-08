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
            .alter_table(
                Table::alter()
                    .table(Providers::Table)
                    .add_column(ColumnDef::new(Providers::RateLimits).json().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Providers::Table)
                    .drop_column(Providers::RateLimits)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Providers {
    Table,
    RateLimits,
}

#[cfg(test)]
mod tests {
    use sea_query::{PostgresQueryBuilder, SqliteQueryBuilder};

    use super::*;

    #[test]
    fn adds_nullable_json_rate_limits_column() {
        let statement = Table::alter()
            .table(Providers::Table)
            .add_column(ColumnDef::new(Providers::RateLimits).json().null())
            .to_owned();

        let postgres = statement.build(PostgresQueryBuilder);
        let sqlite = statement.build(SqliteQueryBuilder);
        assert!(postgres.contains("rate_limits"));
        assert!(postgres.to_ascii_lowercase().contains("json"));
        assert!(sqlite.contains("rate_limits"));
    }
}
