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

//! Adds the live progress columns of an RCA run to `rca_runs`: the current stage,
//! the context the agent was given, the number of continuation turns, and the pending
//! on-call records of an alert run.

use sea_orm_migration::prelude::*;

const RCA_RUNS: &str = "rca_runs";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite allows one alter option per ALTER TABLE, so one guarded statement per column.
        for column in COLUMNS {
            if manager.has_column(RCA_RUNS, &column.to_string()).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(RCA_RUNS))
                        .add_column(column_def(column))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS.into_iter().rev() {
            if manager.has_column(RCA_RUNS, &column.to_string()).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(RCA_RUNS))
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum RcaRuns {
    Stage,
    StageIndex,
    ContextUsed,
    Continuations,
    OncallSubjects,
}

const COLUMNS: [RcaRuns; 5] = [
    RcaRuns::Stage,
    RcaRuns::StageIndex,
    RcaRuns::ContextUsed,
    RcaRuns::Continuations,
    RcaRuns::OncallSubjects,
];

fn column_def(column: RcaRuns) -> ColumnDef {
    let mut def = ColumnDef::new(column);
    match column {
        RcaRuns::Stage => def.text().null(),
        RcaRuns::StageIndex => def.small_integer().null(),
        RcaRuns::ContextUsed | RcaRuns::OncallSubjects => def.json_binary().null(),
        RcaRuns::Continuations => def.small_integer().not_null().default(0),
    };
    def
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;
    use crate::table::migration::m20261016_000001_create_rca_runs as create_rca_runs;

    const NEW_COLUMNS: [&str; 5] = [
        "stage",
        "stage_index",
        "context_used",
        "continuations",
        "oncall_subjects",
    ];

    async fn columns_present(manager: &SchemaManager<'_>) -> Vec<bool> {
        let mut present = Vec::new();
        for column in NEW_COLUMNS {
            present.push(manager.has_column(RCA_RUNS, column).await.unwrap());
        }
        present
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261017_000001_add_rca_run_progress_columns"
        );
    }

    /// TH1 (7.1), TH10: up adds the columns once (a rerun is a no-op), an existing run reads
    /// `continuations = 0`, and down removes them, also twice.
    #[tokio::test]
    async fn up_twice_is_idempotent_and_down_removes_the_columns_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        create_rca_runs::Migration.up(&manager).await.unwrap();
        db.execute_unprepared(
            "INSERT INTO rca_runs (run_id, org_id, subject_type, subject_id, trigger, mode, \
             started_by, state, started_at, updated_at) VALUES ('r1', 'acme', 'incident', 'i1', \
             'manual', 'fresh', 'a.rao', 'completed', 1, 2)",
        )
        .await
        .unwrap();
        assert_eq!(columns_present(&manager).await, [false; 5]);

        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must skip the columns it added");
        assert_eq!(columns_present(&manager).await, [true; 5]);

        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT continuations, stage, stage_index, context_used, oncall_subjects \
                 FROM rca_runs WHERE run_id = 'r1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i16>("", "continuations").unwrap(), 0);
        assert_eq!(row.try_get::<Option<String>>("", "stage").unwrap(), None);
        assert_eq!(row.try_get::<Option<i16>>("", "stage_index").unwrap(), None);

        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("re-running down must skip the dropped columns");
        assert_eq!(columns_present(&manager).await, [false; 5]);
    }
}
