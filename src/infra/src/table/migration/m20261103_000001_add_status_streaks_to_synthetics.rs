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
//! Adds the status page run streaks to `synthetics` and the index the stuck-run sweep reads.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Plain `ADD COLUMN`: MySQL rejects `IF NOT EXISTS`, and `has_column` keeps this
        // idempotent.
        for (name, column, big) in columns() {
            if manager.has_column(TABLE, name).await? {
                continue;
            }
            let mut def = ColumnDef::new(column);
            if big {
                def.big_integer();
            } else {
                def.integer();
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column(def.not_null().default(0))
                        .to_owned(),
                )
                .await?;
        }
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(RUNS_OPEN_IDX)
                    .table(SyntheticsRuns::Table)
                    .col(SyntheticsRuns::CompletedAt)
                    .col(SyntheticsRuns::CreatedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(RUNS_OPEN_IDX)
                    .table(SyntheticsRuns::Table)
                    .to_owned(),
            )
            .await?;
        for (name, column, _) in columns() {
            if manager.has_column(TABLE, name).await? {
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
        Ok(())
    }
}

const TABLE: &str = "synthetics";
const RUNS_OPEN_IDX: &str = "synthetics_runs_completed_created_idx";

#[derive(DeriveIden)]
enum Synthetics {
    Table,
    StatusDownRuns,
    StatusUpRuns,
    StatusRunTs,
}

#[derive(DeriveIden)]
enum SyntheticsRuns {
    Table,
    CompletedAt,
    CreatedAt,
}

fn columns() -> [(&'static str, Synthetics, bool); 3] {
    [
        ("status_down_runs", Synthetics::StatusDownRuns, false),
        ("status_up_runs", Synthetics::StatusUpRuns, false),
        ("status_run_ts", Synthetics::StatusRunTs, true),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[tokio::test]
    async fn existing_rows_get_zero_and_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE synthetics (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared(
            "CREATE TABLE synthetics_runs (id TEXT PRIMARY KEY, completed_at BIGINT NULL, created_at BIGINT NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared("INSERT INTO synthetics (id) VALUES ('mon-1')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT status_down_runs, status_up_runs, status_run_ts FROM synthetics",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "status_down_runs").unwrap(), 0);
        assert_eq!(row.try_get::<i32>("", "status_up_runs").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "status_run_ts").unwrap(), 0);
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, "status_run_ts").await.unwrap());
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261103_000001_add_status_streaks_to_synthetics"
        );
    }
}
