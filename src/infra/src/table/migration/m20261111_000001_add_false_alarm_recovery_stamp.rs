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

//! Adds the recovery stamp that ends a false alarm hold: `synthetics.status_recovered_at`, the
//! finish time of the run that started the current Up streak, and
//! `status_page_notices.false_alarm_recovered_at`, the stamp that a mark saved.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // `has_column` keeps this idempotent. SQLite takes one ADD COLUMN per ALTER TABLE.
        for (name, column) in check_columns() {
            if !manager.has_column(CHECKS, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Synthetics::Table)
                            .add_column(ColumnDef::new(column).big_integer().not_null().default(0))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        if !manager
            .has_column(NOTICES, "false_alarm_recovered_at")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(StatusPageNotices::Table)
                        .add_column(
                            ColumnDef::new(StatusPageNotices::FalseAlarmRecoveredAt)
                                .big_integer()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, column) in check_columns() {
            if manager.has_column(CHECKS, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Synthetics::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        if manager
            .has_column(NOTICES, "false_alarm_recovered_at")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(StatusPageNotices::Table)
                        .drop_column(StatusPageNotices::FalseAlarmRecoveredAt)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const CHECKS: &str = "synthetics";
const NOTICES: &str = "status_page_notices";

#[derive(DeriveIden)]
enum Synthetics {
    Table,
    StatusRecoveredAt,
    StatusStreakSig,
}

fn check_columns() -> [(&'static str, Synthetics); 2] {
    [
        ("status_recovered_at", Synthetics::StatusRecoveredAt),
        ("status_streak_sig", Synthetics::StatusStreakSig),
    ]
}

#[derive(DeriveIden)]
enum StatusPageNotices {
    Table,
    FalseAlarmRecoveredAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[tokio::test]
    async fn existing_rows_get_no_stamp_and_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE synthetics (id TEXT PRIMARY KEY)",
            "CREATE TABLE status_page_notices (id TEXT PRIMARY KEY)",
            "INSERT INTO synthetics (id) VALUES ('mon-1')",
            "INSERT INTO status_page_notices (id) VALUES ('n-1')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let backend = db.get_database_backend();
        let check = db
            .query_one(Statement::from_string(
                backend,
                "SELECT status_recovered_at, status_streak_sig FROM synthetics",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(check.try_get::<i64>("", "status_recovered_at").unwrap(), 0);
        assert_eq!(check.try_get::<i64>("", "status_streak_sig").unwrap(), 0);
        let notice = db
            .query_one(Statement::from_string(
                backend,
                "SELECT false_alarm_recovered_at FROM status_page_notices",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            notice
                .try_get::<Option<i64>>("", "false_alarm_recovered_at")
                .unwrap(),
            None
        );
        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_column(CHECKS, "status_streak_sig")
                .await
                .unwrap()
        );
        assert!(
            !manager
                .has_column(CHECKS, "status_recovered_at")
                .await
                .unwrap()
        );
        assert!(
            !manager
                .has_column(NOTICES, "false_alarm_recovered_at")
                .await
                .unwrap()
        );
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261111_000001_add_false_alarm_recovery_stamp"
        );
    }
}
