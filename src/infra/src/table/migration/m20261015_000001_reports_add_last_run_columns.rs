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

//! `last_run_at`, `last_run_status`, `last_run_error`: the outcome of a report's latest run.

use sea_orm_migration::prelude::*;

const TABLE: &str = "reports";
/// One ALTER per column: SQLite rejects an ALTER that carries more than one change.
const COLUMNS: [Reports; 3] = [
    Reports::LastRunAt,
    Reports::LastRunStatus,
    Reports::LastRunError,
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone, Copy)]
enum Reports {
    Table,
    LastRunAt,
    LastRunStatus,
    LastRunError,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS {
            // add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
            if manager.has_column(TABLE, &column_name(column)).await? {
                continue;
            }
            manager.alter_table(add_column_stmt(column)).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS {
            if !manager.has_column(TABLE, &column_name(column)).await? {
                continue;
            }
            manager.alter_table(drop_column_stmt(column)).await?;
        }
        Ok(())
    }
}

fn column_name(column: Reports) -> String {
    column.into_iden().to_string()
}

fn add_column_stmt(column: Reports) -> TableAlterStatement {
    let mut def = ColumnDef::new(column);
    match column {
        Reports::LastRunAt => def.big_integer(),
        Reports::LastRunStatus => def.string_len(16),
        _ => def.text(),
    };
    Table::alter()
        .table(Reports::Table)
        .add_column(def.null())
        .to_owned()
}

fn drop_column_stmt(column: Reports) -> TableAlterStatement {
    Table::alter()
        .table(Reports::Table)
        .drop_column(column)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunAt).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "reports" ADD COLUMN "last_run_at" bigint NULL"#
        );
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunStatus).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "reports" ADD COLUMN "last_run_status" varchar(16) NULL"#
        );
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunError).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "reports" ADD COLUMN "last_run_error" text NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunAt).to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `reports` ADD COLUMN `last_run_at` bigint NULL"#
        );
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunStatus).to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `reports` ADD COLUMN `last_run_status` varchar(16) NULL"#
        );
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunError).to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `reports` ADD COLUMN `last_run_error` text NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunAt).to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "reports" ADD COLUMN "last_run_at" bigint NULL"#
        );
        collapsed_eq!(
            &add_column_stmt(Reports::LastRunError).to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "reports" ADD COLUMN "last_run_error" text NULL"#
        );
    }

    #[test]
    fn down_drops_the_same_columns() {
        for column in COLUMNS {
            let up = add_column_stmt(column).to_string(SqliteQueryBuilder);
            let down = drop_column_stmt(column).to_string(SqliteQueryBuilder);
            assert!(up.contains(&column_name(column)));
            assert!(down.contains(&column_name(column)));
            assert_eq!(up.matches("ADD COLUMN").count(), 1);
            assert_eq!(down.matches("DROP COLUMN").count(), 1);
        }
    }
}
