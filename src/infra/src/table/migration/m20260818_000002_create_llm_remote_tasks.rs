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
        manager.create_index(unique_version_index()).await?;
        manager.create_index(org_name_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmRemoteTasks::Table).to_owned())
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmRemoteTasks::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmRemoteTasks::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::EntityId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::Name)
                .string_len(256)
                .not_null(),
        )
        // Version 0 is the head's single mutable draft; 1..N are the immutable
        // published versions an Experiment may pin.
        .col(
            ColumnDef::new(LlmRemoteTasks::Version)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmRemoteTasks::Description).text().null())
        .col(ColumnDef::new(LlmRemoteTasks::Endpoint).text().not_null())
        .col(
            ColumnDef::new(LlmRemoteTasks::HttpMethod)
                .string_len(16)
                .not_null(),
        )
        // Secret references only. The material behind a reference lives in the
        // secret store and rotates without touching a Task Version.
        .col(ColumnDef::new(LlmRemoteTasks::Auth).json().not_null())
        .col(
            ColumnDef::new(LlmRemoteTasks::CustomHeaders)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::ContentType)
                .string_len(128)
                .not_null(),
        )
        .col(ColumnDef::new(LlmRemoteTasks::RequestTemplate).text().null())
        .col(
            ColumnDef::new(LlmRemoteTasks::ResponseSchema)
                .string_len(512)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::TimeoutMs)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmRemoteTasks::RetryPolicy).json().not_null())
        .col(
            ColumnDef::new(LlmRemoteTasks::MaxConcurrency)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmRemoteTasks::Signing).json().not_null())
        // Only a passing test connection publishes a version, so every row at
        // version >= 1 is verified. Storing it keeps the rule checkable at the
        // read seam instead of merely intended.
        .col(
            ColumnDef::new(LlmRemoteTasks::VerificationStatus)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::VerificationError)
                .text()
                .null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::VerifiedAt)
                .big_integer()
                .null(),
        )
        // Which published version the draft was copied from, so a
        // description-only edit can be told from a structural one.
        .col(
            ColumnDef::new(LlmRemoteTasks::DraftSourceVersion)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::IsActive)
                .boolean()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmRemoteTasks::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// One row per version per head. Because the draft is version 0, this is also
/// what makes "a head owns exactly one mutable draft" a storage guarantee
/// rather than a convention the service layer has to remember.
fn unique_version_index() -> IndexCreateStatement {
    Index::create()
        .name("uq_llm_remote_tasks_entity_version")
        .table(LlmRemoteTasks::Table)
        .col(LlmRemoteTasks::OrgId)
        .col(LlmRemoteTasks::EntityId)
        .col(LlmRemoteTasks::Version)
        .unique()
        .to_owned()
}

fn org_name_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_remote_tasks_org_name")
        .table(LlmRemoteTasks::Table)
        .col(LlmRemoteTasks::OrgId)
        .col(LlmRemoteTasks::Name)
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmRemoteTasks {
    Table,
    Id,
    OrgId,
    EntityId,
    Name,
    Version,
    Description,
    Endpoint,
    HttpMethod,
    Auth,
    CustomHeaders,
    ContentType,
    RequestTemplate,
    ResponseSchema,
    TimeoutMs,
    RetryPolicy,
    MaxConcurrency,
    Signing,
    VerificationStatus,
    VerificationError,
    VerifiedAt,
    DraftSourceVersion,
    IsActive,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_every_field_the_request_contract_is_built_from() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"endpoint\" text NOT NULL"));
        assert!(sql.contains("\"http_method\" varchar(16) NOT NULL"));
        assert!(sql.contains("\"auth\" json NOT NULL"));
        assert!(sql.contains("\"custom_headers\" json NOT NULL"));
        assert!(sql.contains("\"content_type\" varchar(128) NOT NULL"));
        assert!(sql.contains("\"request_template\" text NULL"));
        assert!(sql.contains("\"response_schema\" varchar(512) NOT NULL"));
        assert!(sql.contains("\"timeout_ms\" bigint NOT NULL"));
        assert!(sql.contains("\"retry_policy\" json NOT NULL"));
        assert!(sql.contains("\"max_concurrency\" integer NOT NULL"));
        assert!(sql.contains("\"signing\" json NOT NULL"));
    }

    #[test]
    fn carries_the_verification_outcome_a_publish_depends_on() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"verification_status\" varchar(32) NOT NULL"));
        assert!(sql.contains("\"verification_error\" text NULL"));
        assert!(sql.contains("\"verified_at\" bigint NULL"));
        assert!(sql.contains("\"draft_source_version\" integer NULL"));
    }

    #[test]
    fn a_head_cannot_hold_two_rows_at_the_same_version() {
        let sql = unique_version_index().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"));
        assert!(sql.contains("\"org_id\""));
        assert!(sql.contains("\"entity_id\""));
        assert!(sql.contains("\"version\""));
    }
}
