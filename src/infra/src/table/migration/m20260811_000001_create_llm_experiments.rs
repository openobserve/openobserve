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

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

/// One Baseline per organization and Dataset (A2.1, A9).
///
/// Postgres and SQLite express that directly as a partial unique index, which
/// makes a second Baseline impossible no matter which writer attempts it.
/// MySQL has no partial index, so it gets a plain lookup index and relies on
/// the single transaction that clears the old flag and sets the new one.
const BASELINE_INDEX_NAME: &str = "llm_experiments_baseline_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager
            .create_index(
                Index::create()
                    .name("uq_llm_experiments_org_idempotency")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::IdempotencyKey)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_experiments_org_created")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("llm_experiments_deleted_at_idx")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::DeletedAt)
                    .to_owned(),
            )
            .await?;
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        db.execute(Statement::from_string(backend, baseline_index_sql(backend)))
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmExperiments::Table).to_owned())
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmExperiments::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmExperiments::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmExperiments::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::Description).text().null())
        .col(
            ColumnDef::new(LlmExperiments::DatasetId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::DatasetVersion)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::DatasetFilter).json().null())
        .col(ColumnDef::new(LlmExperiments::TaskConfig).json().not_null())
        .col(ColumnDef::new(LlmExperiments::Scorers).json().not_null())
        .col(
            ColumnDef::new(LlmExperiments::TrialCount)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::Metadata).json().null())
        .col(
            ColumnDef::new(LlmExperiments::Status)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::StatusReason).text().null())
        .col(
            ColumnDef::new(LlmExperiments::DeadlineAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(LlmExperiments::CompletedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::LifecycleVersion)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(LlmExperiments::RetryCount)
                .integer()
                .not_null()
                .default(0),
        )
        // Nullable with no backfill on purpose: an Experiment starts unsettled,
        // gets swept once, and settles on that first pass.
        .col(
            ColumnDef::new(LlmExperiments::ScoresSettledAt)
                .big_integer()
                .null(),
        )
        // The organization's Baseline for this Dataset; at most one row per
        // (org, dataset) may set it, enforced by `baseline_index_sql`.
        .col(
            ColumnDef::new(LlmExperiments::IsBaseline)
                .boolean()
                .not_null()
                .default(false),
        )
        // Early deletion marker (A2.6). Deletion is not a single transaction
        // across PostgreSQL and the streams, so the row has to be able to say
        // "this Experiment is gone, cleanup is still running". Every read
        // filters on this column.
        .col(
            ColumnDef::new(LlmExperiments::DeletedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::IdempotencyKey)
                .string_len(255)
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn baseline_index_sql(backend: DatabaseBackend) -> String {
    match backend {
        DatabaseBackend::Postgres => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {BASELINE_INDEX_NAME} ON llm_experiments (org_id, \
             dataset_id) WHERE is_baseline"
        ),
        DatabaseBackend::Sqlite => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {BASELINE_INDEX_NAME} ON llm_experiments (org_id, \
             dataset_id) WHERE is_baseline = 1"
        ),
        DatabaseBackend::MySql => format!(
            "CREATE INDEX {BASELINE_INDEX_NAME} ON llm_experiments (org_id, dataset_id, is_baseline)"
        ),
    }
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    DatasetId,
    DatasetVersion,
    DatasetFilter,
    TaskConfig,
    Scorers,
    TrialCount,
    Metadata,
    Status,
    StatusReason,
    DeadlineAt,
    CompletedAt,
    LifecycleVersion,
    RetryCount,
    ScoresSettledAt,
    IsBaseline,
    DeletedAt,
    IdempotencyKey,
    CreatedBy,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn experiment_schema_contains_only_immutable_definition_and_audit_fields() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"dataset_version\" bigint NOT NULL"));
        assert!(sql.contains("\"task_config\" json NOT NULL"));
        assert!(sql.contains("\"scorers\" json NOT NULL"));
        assert!(sql.contains("\"created_by\" varchar(256) NOT NULL"));
        assert!(sql.contains("\"status_reason\" text NULL"));
        assert!(sql.contains("\"deadline_at\" bigint NOT NULL DEFAULT 0"));
        assert!(sql.contains("\"completed_at\" bigint NULL"));
        assert!(sql.contains("\"lifecycle_version\" bigint NOT NULL DEFAULT 0"));
        assert!(sql.contains("\"retry_count\" integer NOT NULL DEFAULT 0"));
        assert!(sql.contains("\"scores_settled_at\" bigint NULL"));
        assert!(sql.contains("\"is_baseline\" bool NOT NULL DEFAULT FALSE"));
        assert!(sql.contains("\"deleted_at\" bigint NULL"));
        assert!(!sql.contains("updated_at"));
        assert!(!sql.contains("updated_by"));
    }

    #[test]
    fn only_one_baseline_row_can_exist_per_org_and_dataset() {
        let postgres = baseline_index_sql(DatabaseBackend::Postgres);
        assert!(postgres.contains("UNIQUE"));
        assert!(postgres.ends_with("WHERE is_baseline"));

        let sqlite = baseline_index_sql(DatabaseBackend::Sqlite);
        assert!(sqlite.contains("UNIQUE"));
        assert!(sqlite.ends_with("WHERE is_baseline = 1"));

        // MySQL has no partial index; the transactional swap is the guarantee
        // there, so the index exists only to make the lookup cheap.
        let mysql = baseline_index_sql(DatabaseBackend::MySql);
        assert!(!mysql.contains("UNIQUE"));
    }
}
