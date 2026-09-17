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
        manager.create_table(create_statement()).await?;
        manager.create_index(unique_request_index()).await?;
        manager.create_index(unique_active_slot_index()).await?;
        manager.create_index(active_index()).await?;
        manager.create_index(projection_index()).await?;
        manager.create_index(expiry_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(LlmExperimentSlotRetries::Table)
                    .to_owned(),
            )
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmExperimentSlotRetries::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::ExperimentId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::RowId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::TrialIndex)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::IdempotencyKey)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::State)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::Execution)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::ActiveMarker)
                .string_len(16)
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::ProjectedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperimentSlotRetries::ExpiresAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_experiment_slot_retries_experiment")
                .from(
                    LlmExperimentSlotRetries::Table,
                    LlmExperimentSlotRetries::ExperimentId,
                )
                .to(LlmExperiments::Table, LlmExperiments::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn unique_request_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("uq_llm_experiment_slot_retries_request")
        .table(LlmExperimentSlotRetries::Table)
        .col(LlmExperimentSlotRetries::OrgId)
        .col(LlmExperimentSlotRetries::ExperimentId)
        .col(LlmExperimentSlotRetries::IdempotencyKey)
        .unique()
        .to_owned()
}

fn unique_active_slot_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("uq_llm_experiment_slot_retries_active_slot")
        .table(LlmExperimentSlotRetries::Table)
        .col(LlmExperimentSlotRetries::OrgId)
        .col(LlmExperimentSlotRetries::ExperimentId)
        .col(LlmExperimentSlotRetries::RowId)
        .col(LlmExperimentSlotRetries::TrialIndex)
        .col(LlmExperimentSlotRetries::ActiveMarker)
        .unique()
        .to_owned()
}

fn active_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("idx_llm_experiment_slot_retries_active")
        .table(LlmExperimentSlotRetries::Table)
        .col(LlmExperimentSlotRetries::ActiveMarker)
        .col(LlmExperimentSlotRetries::CreatedAt)
        .to_owned()
}

fn projection_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("idx_llm_experiment_slot_retries_projection")
        .table(LlmExperimentSlotRetries::Table)
        .col(LlmExperimentSlotRetries::State)
        .col(LlmExperimentSlotRetries::ProjectedAt)
        .col(LlmExperimentSlotRetries::UpdatedAt)
        .to_owned()
}

fn expiry_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("idx_llm_experiment_slot_retries_expiry")
        .table(LlmExperimentSlotRetries::Table)
        .col(LlmExperimentSlotRetries::ExpiresAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmExperimentSlotRetries {
    Table,
    Id,
    OrgId,
    ExperimentId,
    RowId,
    TrialIndex,
    IdempotencyKey,
    State,
    Execution,
    ActiveMarker,
    ProjectedAt,
    CreatedAt,
    UpdatedAt,
    ExpiresAt,
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    Id,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_retry_state_and_replayable_execution() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"idempotency_key\" varchar(256) NOT NULL"));
        assert!(sql.contains("\"state\" varchar(16) NOT NULL"));
        assert!(sql.contains("\"execution\" json NOT NULL"));
        assert!(sql.contains("\"active_marker\" varchar(16)"));
        assert!(sql.contains("\"projected_at\" bigint"));
        assert!(sql.contains("ON DELETE CASCADE"));
    }

    #[test]
    fn enforces_request_replay_and_one_active_retry_per_slot() {
        let request_sql = unique_request_index().to_string(PostgresQueryBuilder);
        assert!(request_sql.contains("UNIQUE"));
        assert!(request_sql.contains("\"org_id\", \"experiment_id\", \"idempotency_key\""));

        let active_sql = unique_active_slot_index().to_string(PostgresQueryBuilder);
        assert!(active_sql.contains("UNIQUE"));
        assert!(active_sql.contains(
            "\"org_id\", \"experiment_id\", \"row_id\", \"trial_index\", \"active_marker\""
        ));

        let active_lookup_sql = active_index().to_string(PostgresQueryBuilder);
        assert!(active_lookup_sql.contains("\"active_marker\", \"created_at\""));
        let projection_sql = projection_index().to_string(PostgresQueryBuilder);
        assert!(projection_sql.contains("\"state\", \"projected_at\", \"updated_at\""));
        let expiry_sql = expiry_index().to_string(PostgresQueryBuilder);
        assert!(expiry_sql.contains("\"expires_at\""));
    }
}
