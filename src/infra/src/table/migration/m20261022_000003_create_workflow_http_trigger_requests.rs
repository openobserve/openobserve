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

//! Region-local ledger of HTTP trigger runs; never replicated, so it has no `version`.

use sea_orm_migration::prelude::*;

const TRIGGER_IDEM_IDX: &str = "workflow_http_trigger_requests_trigger_idem_idx";
const RUN_ID_IDX: &str = "workflow_http_trigger_requests_run_id_idx";
const STATUS_ORG_RECEIVED_IDX: &str = "workflow_http_trigger_requests_status_org_received_idx";
const WORKFLOW_RECEIVED_IDX: &str = "workflow_http_trigger_requests_workflow_received_idx";
const RECEIVED_IDX: &str = "workflow_http_trigger_requests_received_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_workflow_http_trigger_requests_statement())
            .await?;
        for index in create_indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [
            TRIGGER_IDEM_IDX,
            RUN_ID_IDX,
            STATUS_ORG_RECEIVED_IDX,
            WORKFLOW_RECEIVED_IDX,
            RECEIVED_IDX,
        ] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(WorkflowHttpTriggerRequests::Table)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(WorkflowHttpTriggerRequests::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum WorkflowHttpTriggerRequests {
    Table,
    Id,
    TriggerId,
    OrgId,
    WorkflowId,
    RunId,
    IdemKey,
    #[sea_orm(iden = "body_sha256")]
    BodySha256,
    BodyBytes,
    ContentType,
    Meta,
    Status,
    ClaimedBy,
    ClaimedAt,
    Error,
    CredentialId,
    CredentialPrefix,
    CallerIp,
    ReceivedAt,
    FinishedAt,
}

fn create_workflow_http_trigger_requests_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowHttpTriggerRequests::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::Id)
                .big_integer()
                .not_null()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::TriggerId)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::WorkflowId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::RunId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::IdemKey)
                .string_len(255)
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::BodySha256)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::BodyBytes)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::ContentType)
                .string_len(128)
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::Meta)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::Status)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::ClaimedBy)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::ClaimedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::Error)
                .text()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::CredentialId)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::CredentialPrefix)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::CallerIp)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::ReceivedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggerRequests::FinishedAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

fn create_indexes() -> Vec<IndexCreateStatement> {
    vec![
        // NULL keys never collide on either backend, so keyless requests share no slot.
        Index::create()
            .if_not_exists()
            .name(TRIGGER_IDEM_IDX)
            .table(WorkflowHttpTriggerRequests::Table)
            .col(WorkflowHttpTriggerRequests::TriggerId)
            .col(WorkflowHttpTriggerRequests::IdemKey)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUN_ID_IDX)
            .table(WorkflowHttpTriggerRequests::Table)
            .col(WorkflowHttpTriggerRequests::RunId)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(STATUS_ORG_RECEIVED_IDX)
            .table(WorkflowHttpTriggerRequests::Table)
            .col(WorkflowHttpTriggerRequests::Status)
            .col(WorkflowHttpTriggerRequests::OrgId)
            .col(WorkflowHttpTriggerRequests::ReceivedAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(WORKFLOW_RECEIVED_IDX)
            .table(WorkflowHttpTriggerRequests::Table)
            .col(WorkflowHttpTriggerRequests::WorkflowId)
            .col(WorkflowHttpTriggerRequests::ReceivedAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RECEIVED_IDX)
            .table(WorkflowHttpTriggerRequests::Table)
            .col(WorkflowHttpTriggerRequests::ReceivedAt)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_workflow_http_trigger_requests() {
        collapsed_eq!(
            &create_workflow_http_trigger_requests_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_http_trigger_requests" (
                "id" bigserial NOT NULL PRIMARY KEY,
                "trigger_id" varchar(32) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "workflow_id" varchar(100) NOT NULL,
                "run_id" varchar(100) NOT NULL,
                "idem_key" varchar(255) NULL,
                "body_sha256" varchar(64) NOT NULL,
                "body_bytes" bigint NOT NULL,
                "content_type" varchar(128) NULL,
                "meta" text NOT NULL,
                "status" varchar(16) NOT NULL,
                "claimed_by" varchar(64) NULL,
                "claimed_at" bigint NULL,
                "error" text NULL,
                "credential_id" varchar(32) NOT NULL,
                "credential_prefix" varchar(32) NOT NULL,
                "caller_ip" varchar(64) NOT NULL,
                "received_at" bigint NOT NULL,
                "finished_at" bigint NULL
            )"#
        );
        let indexes: Vec<String> = create_indexes()
            .iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            indexes,
            [
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "workflow_http_trigger_requests_trigger_idem_idx" ON "workflow_http_trigger_requests" ("trigger_id", "idem_key")"#,
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "workflow_http_trigger_requests_run_id_idx" ON "workflow_http_trigger_requests" ("run_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_trigger_requests_status_org_received_idx" ON "workflow_http_trigger_requests" ("status", "org_id", "received_at")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_trigger_requests_workflow_received_idx" ON "workflow_http_trigger_requests" ("workflow_id", "received_at")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_trigger_requests_received_idx" ON "workflow_http_trigger_requests" ("received_at")"#,
            ]
        );
    }

    #[test]
    fn every_statement_builds_on_both_backends() {
        let table = create_workflow_http_trigger_requests_statement();
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
                .has_table("workflow_http_trigger_requests")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.expect("second down");
        Migration.up(&manager).await.expect("up after down");
        assert!(
            manager
                .has_table("workflow_http_trigger_requests")
                .await
                .unwrap()
        );
        for index in [
            "workflow_http_trigger_requests_trigger_idem_idx",
            "workflow_http_trigger_requests_run_id_idx",
            "workflow_http_trigger_requests_status_org_received_idx",
            "workflow_http_trigger_requests_workflow_received_idx",
            "workflow_http_trigger_requests_received_idx",
        ] {
            assert!(
                manager
                    .has_index("workflow_http_trigger_requests", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
    }
}
