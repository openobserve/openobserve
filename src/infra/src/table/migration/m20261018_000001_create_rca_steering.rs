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

//! Create responder steering rows and persisted RCA question/deadline state.

use sea_orm_migration::prelude::*;

const RCA_RUNS: &str = "rca_runs";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(run_index()).await?;
        manager.create_index(incident_index()).await?;
        // SQLite allows one alter option per ALTER TABLE, so one guarded statement per column.
        for column in RUN_COLUMNS {
            if manager.has_column(RCA_RUNS, &column.to_string()).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(RCA_RUNS))
                        .add_column(run_column_def(column))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in RUN_COLUMNS.into_iter().rev() {
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
        manager
            .drop_table(
                Table::drop()
                    .table(RcaSteering::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RcaSteering {
    Table,
    OrgId,
    SteerId,
    RunId,
    IncidentId,
    AuthorEmail,
    Kind,
    Action,
    HypothesisId,
    QuestionId,
    Text,
    Status,
    StatusReason,
    CreatedAt,
    DeliveredAt,
    ReadAt,
    ActedAt,
    AgentNote,
    OpencodeMessageId,
}

#[derive(DeriveIden, Clone, Copy)]
enum RcaRuns {
    InputDeadlineAt,
    PendingQuestionId,
    QuestionsAsked,
    DeadlineClosedAt,
}

const RUN_COLUMNS: [RcaRuns; 4] = [
    RcaRuns::InputDeadlineAt,
    RcaRuns::PendingQuestionId,
    RcaRuns::QuestionsAsked,
    RcaRuns::DeadlineClosedAt,
];

fn run_column_def(column: RcaRuns) -> ColumnDef {
    let mut def = ColumnDef::new(column);
    match column {
        RcaRuns::InputDeadlineAt | RcaRuns::DeadlineClosedAt => def.big_integer().null(),
        RcaRuns::PendingQuestionId => def.string_len(64).null(),
        RcaRuns::QuestionsAsked => def.integer().not_null().default(0),
    };
    def
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(RcaSteering::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaSteering::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSteering::SteerId)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(RcaSteering::RunId).string_len(32).not_null())
        .col(
            ColumnDef::new(RcaSteering::IncidentId)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSteering::AuthorEmail)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(RcaSteering::Kind).string_len(24).not_null())
        .col(ColumnDef::new(RcaSteering::Action).string_len(16).null())
        .col(
            ColumnDef::new(RcaSteering::HypothesisId)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSteering::QuestionId)
                .string_len(64)
                .null(),
        )
        .col(ColumnDef::new(RcaSteering::Text).text().not_null())
        .col(
            ColumnDef::new(RcaSteering::Status)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSteering::StatusReason)
                .string_len(32)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSteering::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSteering::DeliveredAt)
                .big_integer()
                .null(),
        )
        .col(ColumnDef::new(RcaSteering::ReadAt).big_integer().null())
        .col(ColumnDef::new(RcaSteering::ActedAt).big_integer().null())
        .col(ColumnDef::new(RcaSteering::AgentNote).text().null())
        .col(
            ColumnDef::new(RcaSteering::OpencodeMessageId)
                .string_len(64)
                .null(),
        )
        .primary_key(
            Index::create()
                .col(RcaSteering::OrgId)
                .col(RcaSteering::SteerId),
        )
        .to_owned()
}

/// The rows of one run in send order, and the rate limits (SG10).
fn run_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_steering_run_idx")
        .if_not_exists()
        .table(RcaSteering::Table)
        .col(RcaSteering::OrgId)
        .col(RcaSteering::RunId)
        .col(RcaSteering::CreatedAt)
        .to_owned()
}

/// The rows of one incident.
fn incident_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_steering_incident_idx")
        .if_not_exists()
        .table(RcaSteering::Table)
        .col(RcaSteering::OrgId)
        .col(RcaSteering::IncidentId)
        .col(RcaSteering::CreatedAt)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;
    use crate::table::migration::{
        m20261016_000001_create_rca_runs as create_rca_runs,
        m20261017_000001_add_rca_run_progress_columns as progress_columns,
    };

    const NEW_RUN_COLUMNS: [&str; 4] = [
        "input_deadline_at",
        "pending_question_id",
        "questions_asked",
        "deadline_closed_at",
    ];

    async fn run_columns_present(manager: &SchemaManager<'_>) -> Vec<bool> {
        let mut present = Vec::new();
        for column in NEW_RUN_COLUMNS {
            present.push(manager.has_column(RCA_RUNS, column).await.unwrap());
        }
        present
    }

    async fn index_names(db: &sea_orm::DatabaseConnection) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rca_steering' \
                 AND name NOT LIKE 'sqlite_%' ORDER BY name",
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261018_000001_create_rca_steering");
    }

    #[tokio::test]
    async fn up_twice_is_idempotent_and_down_removes_everything_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        create_rca_runs::Migration.up(&manager).await.unwrap();
        progress_columns::Migration.up(&manager).await.unwrap();
        db.execute_unprepared(
            "INSERT INTO rca_runs (run_id, org_id, subject_type, subject_id, trigger, mode, \
             started_by, state, started_at, updated_at) VALUES ('r1', 'acme', 'incident', 'i1', \
             'manual', 'fresh', 'a.rao', 'completed', 1, 2)",
        )
        .await
        .unwrap();
        assert_eq!(run_columns_present(&manager).await, [false; 4]);
        assert!(!manager.has_table("rca_steering").await.unwrap());

        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must skip what it created");
        assert!(manager.has_table("rca_steering").await.unwrap());
        assert_eq!(run_columns_present(&manager).await, [true; 4]);
        assert_eq!(
            index_names(&db).await,
            ["rca_steering_incident_idx", "rca_steering_run_idx"]
        );
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT questions_asked, input_deadline_at, pending_question_id, \
                 deadline_closed_at FROM rca_runs WHERE run_id = 'r1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "questions_asked").unwrap(), 0);
        assert_eq!(
            row.try_get::<Option<i64>>("", "input_deadline_at").unwrap(),
            None
        );
        assert_eq!(
            row.try_get::<Option<String>>("", "pending_question_id")
                .unwrap(),
            None
        );
        assert_eq!(
            row.try_get::<Option<i64>>("", "deadline_closed_at")
                .unwrap(),
            None
        );
        db.execute_unprepared(
            "INSERT INTO rca_steering (org_id, steer_id, run_id, incident_id, author_email, kind, \
             text, status, created_at) VALUES ('acme', 'stg_1', 'r1', 'i1', 'a.rao@acme.io', \
             'message', 't', 'queued', 1)",
        )
        .await
        .unwrap();
        assert!(
            db.execute_unprepared(
                "INSERT INTO rca_steering (org_id, steer_id, run_id, incident_id, author_email, \
                 kind, text, status, created_at) VALUES ('acme', 'stg_1', 'r2', 'i1', 'b', \
                 'message', 't', 'queued', 2)",
            )
            .await
            .is_err(),
            "(org_id, steer_id) is the primary key"
        );

        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("re-running down must skip what it dropped");
        assert!(!manager.has_table("rca_steering").await.unwrap());
        assert_eq!(run_columns_present(&manager).await, [false; 4]);
        assert!(manager.has_table(RCA_RUNS).await.unwrap());
    }
}
