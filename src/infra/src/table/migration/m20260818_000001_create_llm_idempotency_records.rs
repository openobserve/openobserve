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
        manager.create_index(unique_key_index()).await?;
        manager.create_index(expiry_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmIdempotencyRecords::Table).to_owned())
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmIdempotencyRecords::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmIdempotencyRecords::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::Scope)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::IdempotencyKey)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::RequestHash)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::Response)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmIdempotencyRecords::ExpiresAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// The key is unique only inside its scope, which is what makes a Dataset
/// upsert key `(org_id, dataset_id)`-scoped rather than organization-wide.
fn unique_key_index() -> IndexCreateStatement {
    Index::create()
        .name("uq_llm_idempotency_records_scope_key")
        .table(LlmIdempotencyRecords::Table)
        .col(LlmIdempotencyRecords::OrgId)
        .col(LlmIdempotencyRecords::Scope)
        .col(LlmIdempotencyRecords::IdempotencyKey)
        .unique()
        .to_owned()
}

fn expiry_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_idempotency_records_expires_at")
        .table(LlmIdempotencyRecords::Table)
        .col(LlmIdempotencyRecords::ExpiresAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmIdempotencyRecords {
    Table,
    Id,
    OrgId,
    Scope,
    IdempotencyKey,
    RequestHash,
    Response,
    CreatedAt,
    ExpiresAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_the_key_the_request_hash_and_the_replayable_response() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"idempotency_key\" varchar(255) NOT NULL"));
        assert!(sql.contains("\"request_hash\" varchar(64) NOT NULL"));
        assert!(sql.contains("\"response\" json NOT NULL"));
        assert!(sql.contains("\"expires_at\" bigint NOT NULL"));
    }

    #[test]
    fn the_key_is_unique_only_within_its_scope() {
        let sql = unique_key_index().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"));
        assert!(sql.contains("\"org_id\""));
        assert!(sql.contains("\"scope\""));
        assert!(sql.contains("\"idempotency_key\""));
    }
}
