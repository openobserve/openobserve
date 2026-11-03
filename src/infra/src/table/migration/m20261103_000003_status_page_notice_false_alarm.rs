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

//! Who marked an auto-incident as a false alarm, when, and why.

use sea_orm_migration::prelude::*;

const TABLE: &str = "status_page_notices";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum StatusPageNotices {
    Table,
    FalseAlarmBy,
    FalseAlarmAt,
    FalseAlarmReason,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
        if manager.has_column(TABLE, "false_alarm_at").await? {
            return Ok(());
        }
        // SQLite takes one ADD COLUMN per ALTER TABLE.
        for stmt in add_column_stmts() {
            manager.alter_table(stmt).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, "false_alarm_at").await? {
            return Ok(());
        }
        for col in [
            StatusPageNotices::FalseAlarmBy,
            StatusPageNotices::FalseAlarmAt,
            StatusPageNotices::FalseAlarmReason,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(StatusPageNotices::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

fn add_column_stmts() -> Vec<TableAlterStatement> {
    [
        ColumnDef::new(StatusPageNotices::FalseAlarmBy)
            .string_len(256)
            .null()
            .to_owned(),
        ColumnDef::new(StatusPageNotices::FalseAlarmAt)
            .big_integer()
            .null()
            .to_owned(),
        ColumnDef::new(StatusPageNotices::FalseAlarmReason)
            .text()
            .null()
            .to_owned(),
    ]
    .into_iter()
    .map(|mut col| {
        Table::alter()
            .table(StatusPageNotices::Table)
            .add_column(&mut col)
            .to_owned()
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        let sql: Vec<String> = add_column_stmts()
            .iter()
            .map(|s| s.to_string(PostgresQueryBuilder))
            .collect();
        collapsed_eq!(
            &sql.join("; "),
            r#"ALTER TABLE "status_page_notices" ADD COLUMN "false_alarm_by" varchar(256) NULL; ALTER TABLE "status_page_notices" ADD COLUMN "false_alarm_at" bigint NULL; ALTER TABLE "status_page_notices" ADD COLUMN "false_alarm_reason" text NULL"#
        );
    }

    #[test]
    fn mysql() {
        let sql: Vec<String> = add_column_stmts()
            .iter()
            .map(|s| s.to_string(MysqlQueryBuilder))
            .collect();
        collapsed_eq!(
            &sql.join("; "),
            r#"ALTER TABLE `status_page_notices` ADD COLUMN `false_alarm_by` varchar(256) NULL; ALTER TABLE `status_page_notices` ADD COLUMN `false_alarm_at` bigint NULL; ALTER TABLE `status_page_notices` ADD COLUMN `false_alarm_reason` text NULL"#
        );
    }
}
