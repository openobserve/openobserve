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

//! Tokens and signing secrets of HTTP triggers; key material lives in `llm_secrets`, never here.

use sea_orm_migration::prelude::*;

const TRIGGER_ID_IDX: &str = "workflow_http_trigger_credentials_trigger_id_idx";
const ORG_ID_IDX: &str = "workflow_http_trigger_credentials_org_id_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_workflow_http_trigger_credentials_statement())
            .await?;
        for index in create_indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [TRIGGER_ID_IDX, ORG_ID_IDX] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(WorkflowHttpTriggerCredentials::Table)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(WorkflowHttpTriggerCredentials::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum WorkflowHttpTriggerCredentials {
    Table,
    Id,
    TriggerId,
    OrgId,
    Kind,
    DisplayPrefix,
    #[sea_orm(iden = "token_sha256")]
    TokenSha256,
    SecretRef,
    State,
    ExpiresAt,
    RevokedAt,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
    LastUsedAt,
}

fn create_workflow_http_trigger_credentials_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowHttpTriggerCredentials::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::Id)
                .string_len(32)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::TriggerId)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::Kind)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::DisplayPrefix)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::TokenSha256)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::SecretRef)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::State)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::ExpiresAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::RevokedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerCredentials::LastUsedAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

fn create_indexes() -> Vec<IndexCreateStatement> {
    vec![
        Index::create()
            .if_not_exists()
            .name(TRIGGER_ID_IDX)
            .table(WorkflowHttpTriggerCredentials::Table)
            .col(WorkflowHttpTriggerCredentials::TriggerId)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(ORG_ID_IDX)
            .table(WorkflowHttpTriggerCredentials::Table)
            .col(WorkflowHttpTriggerCredentials::OrgId)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_workflow_http_trigger_credentials() {
        collapsed_eq!(
            &create_workflow_http_trigger_credentials_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_http_trigger_credentials" (
                "id" varchar(32) NOT NULL PRIMARY KEY,
                "trigger_id" varchar(32) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "kind" varchar(16) NOT NULL,
                "display_prefix" varchar(32) NOT NULL,
                "token_sha256" varchar(64) NULL,
                "secret_ref" varchar(64) NULL,
                "state" varchar(16) NOT NULL,
                "expires_at" bigint NULL,
                "revoked_at" bigint NULL,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "last_used_at" bigint NULL
            )"#
        );
        let indexes: Vec<String> = create_indexes()
            .iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            indexes,
            [
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_trigger_credentials_trigger_id_idx" ON "workflow_http_trigger_credentials" ("trigger_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_trigger_credentials_org_id_idx" ON "workflow_http_trigger_credentials" ("org_id")"#,
            ]
        );
    }

    #[test]
    fn every_statement_builds_on_both_backends() {
        let table = create_workflow_http_trigger_credentials_statement();
        for sql in [
            table.to_string(PostgresQueryBuilder),
            table.to_string(SqliteQueryBuilder),
        ] {
            assert!(sql.starts_with("CREATE TABLE IF NOT EXISTS"), "{sql}");
            assert!(!sql.contains("FOREIGN KEY"), "{sql}");
        }
        for index in create_indexes() {
            for sql in [
                index.to_string(PostgresQueryBuilder),
                index.to_string(SqliteQueryBuilder),
            ] {
                assert!(sql.contains("IF NOT EXISTS"), "{sql}");
            }
        }
    }

    #[tokio::test]
    async fn down_then_up_is_idempotent() {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = sea_orm::Database::connect(opts).await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first up");
        Migration.up(&manager).await.expect("second up");
        Migration.down(&manager).await.expect("first down");
        assert!(
            !manager
                .has_table("workflow_http_trigger_credentials")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.expect("second down");
        Migration.up(&manager).await.expect("up after down");
        assert!(
            manager
                .has_table("workflow_http_trigger_credentials")
                .await
                .unwrap()
        );
        for index in [
            "workflow_http_trigger_credentials_trigger_id_idx",
            "workflow_http_trigger_credentials_org_id_idx",
        ] {
            assert!(
                manager
                    .has_index("workflow_http_trigger_credentials", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
    }
}
