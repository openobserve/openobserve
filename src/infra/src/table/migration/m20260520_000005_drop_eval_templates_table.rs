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
            .drop_table(drop_eval_templates_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Dropping eval_templates is intentionally not reversible.
        Ok(())
    }
}

fn drop_eval_templates_table_statement() -> TableDropStatement {
    Table::drop()
        .table(EvalTemplates::Table)
        .if_exists()
        .to_owned()
}

#[derive(DeriveIden)]
enum EvalTemplates {
    Table,
}

#[cfg(test)]
mod tests {
    use sea_query::{PostgresQueryBuilder, SqliteQueryBuilder};

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260520_000005_drop_eval_templates_table"
        );
    }

    #[test]
    fn test_drop_eval_templates_table_postgres() {
        assert_eq!(
            drop_eval_templates_table_statement().to_string(PostgresQueryBuilder),
            r#"DROP TABLE IF EXISTS "eval_templates""#
        );
    }

    #[test]
    fn test_drop_eval_templates_table_sqlite() {
        assert_eq!(
            drop_eval_templates_table_statement().to_string(SqliteQueryBuilder),
            r#"DROP TABLE IF EXISTS "eval_templates""#
        );
    }
}
