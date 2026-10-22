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

//! Eval job health tables shaped like `alert_states`: current state per job, plus an append-only
//! change log.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_eval_job_states_statement())
            .await?;
        manager
            .create_table(create_eval_job_state_transitions_statement())
            .await?;
        manager
            .create_index(create_transitions_job_at_idx_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(EvalJobStateTransitions::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(EvalJobStates::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_eval_job_states_statement() -> TableCreateStatement {
    Table::create()
        .table(EvalJobStates::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(EvalJobStates::JobId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(EvalJobStates::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(EvalJobStates::Health).integer().not_null())
        // When health last changed, not when it was last measured.
        .col(ColumnDef::new(EvalJobStates::Since).big_integer().not_null())
        .col(
            ColumnDef::new(EvalJobStates::EvaluatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStates::RecentRuns)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStates::RecentErrors)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStates::Scores24h)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStates::LastSuccessAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(EvalJobStates::LastErrorKind)
                .string_len(64)
                .null(),
        )
        .col(ColumnDef::new(EvalJobStates::LastErrorMessage).text().null())
        .col(
            ColumnDef::new(EvalJobStates::LastErrorAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

fn create_eval_job_state_transitions_statement() -> TableCreateStatement {
    Table::create()
        .table(EvalJobStateTransitions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(EvalJobStateTransitions::Id)
                .big_integer()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(EvalJobStateTransitions::JobId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStateTransitions::OrgId)
                .string_len(256)
                .not_null(),
        )
        // NULL on a job's first measurement.
        .col(
            ColumnDef::new(EvalJobStateTransitions::FromHealth)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(EvalJobStateTransitions::ToHealth)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalJobStateTransitions::At)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Serves delete-by-job and per-job history reads.
fn create_transitions_job_at_idx_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("eval_job_state_transitions_job_at_idx")
        .table(EvalJobStateTransitions::Table)
        .col(EvalJobStateTransitions::JobId)
        .col(EvalJobStateTransitions::At)
        .to_owned()
}

#[derive(DeriveIden)]
enum EvalJobStates {
    Table,
    JobId,
    OrgId,
    Health,
    Since,
    EvaluatedAt,
    RecentRuns,
    RecentErrors,
    #[sea_orm(iden = "scores_24h")]
    Scores24h,
    LastSuccessAt,
    LastErrorKind,
    LastErrorMessage,
    LastErrorAt,
}

#[derive(DeriveIden)]
enum EvalJobStateTransitions {
    Table,
    Id,
    JobId,
    OrgId,
    FromHealth,
    ToHealth,
    At,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_eval_job_states() {
        collapsed_eq!(
            &create_eval_job_states_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "eval_job_states" (
                "job_id" varchar(27) NOT NULL PRIMARY KEY,
                "org_id" varchar(256) NOT NULL,
                "health" integer NOT NULL,
                "since" bigint NOT NULL,
                "evaluated_at" bigint NOT NULL,
                "recent_runs" bigint NOT NULL,
                "recent_errors" bigint NOT NULL,
                "scores_24h" bigint NOT NULL,
                "last_success_at" bigint NULL,
                "last_error_kind" varchar(64) NULL,
                "last_error_message" text NULL,
                "last_error_at" bigint NULL
            )"#
        );
    }

    #[test]
    fn test_postgres_eval_job_state_transitions() {
        collapsed_eq!(
            &create_eval_job_state_transitions_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "eval_job_state_transitions" (
                "id" bigserial PRIMARY KEY,
                "job_id" varchar(27) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "from_health" integer NULL,
                "to_health" integer NOT NULL,
                "at" bigint NOT NULL
            )"#
        );
    }
}
