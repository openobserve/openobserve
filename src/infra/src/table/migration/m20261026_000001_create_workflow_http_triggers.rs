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

//! One HTTP trigger per workflow; `version` and `origin_cluster` order replicated snapshots.

use sea_orm_migration::prelude::*;

const WORKFLOW_ID_IDX: &str = "workflow_http_triggers_workflow_id_idx";
const ORG_ID_IDX: &str = "workflow_http_triggers_org_id_idx";
const ORIGIN_CLUSTER_IDX: &str = "workflow_http_triggers_origin_cluster_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_workflow_http_triggers_statement())
            .await?;
        for index in create_indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [WORKFLOW_ID_IDX, ORG_ID_IDX, ORIGIN_CLUSTER_IDX] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(WorkflowHttpTriggers::Table)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(WorkflowHttpTriggers::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum WorkflowHttpTriggers {
    Table,
    Id,
    OrgId,
    WorkflowId,
    Enabled,
    AuthMode,
    MaxBodyBytes,
    RateLimitPerMinute,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
    Version,
    OriginCluster,
    DeletedAt,
    LastInvokedAt,
    Rejections,
}

fn create_workflow_http_triggers_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowHttpTriggers::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowHttpTriggers::Id)
                .string_len(32)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::WorkflowId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::Enabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::AuthMode)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::MaxBodyBytes)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::RateLimitPerMinute)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::Version)
                .big_integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::OriginCluster)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::DeletedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::LastInvokedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(WorkflowHttpTriggers::Rejections)
                .text()
                .null(),
        )
        .to_owned()
}

fn create_indexes() -> Vec<IndexCreateStatement> {
    vec![
        Index::create()
            .if_not_exists()
            .name(WORKFLOW_ID_IDX)
            .table(WorkflowHttpTriggers::Table)
            .col(WorkflowHttpTriggers::WorkflowId)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(ORG_ID_IDX)
            .table(WorkflowHttpTriggers::Table)
            .col(WorkflowHttpTriggers::OrgId)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(ORIGIN_CLUSTER_IDX)
            .table(WorkflowHttpTriggers::Table)
            .col(WorkflowHttpTriggers::OriginCluster)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_workflow_http_triggers() {
        collapsed_eq!(
            &create_workflow_http_triggers_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_http_triggers" (
                "id" varchar(32) NOT NULL PRIMARY KEY,
                "org_id" varchar(256) NOT NULL,
                "workflow_id" varchar(100) NOT NULL,
                "enabled" bool NOT NULL DEFAULT TRUE,
                "auth_mode" varchar(16) NOT NULL,
                "max_body_bytes" bigint NOT NULL,
                "rate_limit_per_minute" integer NOT NULL,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "version" bigint NOT NULL DEFAULT 1,
                "origin_cluster" varchar(64) NOT NULL,
                "deleted_at" bigint NULL,
                "last_invoked_at" bigint NULL,
                "rejections" text NULL
            )"#
        );
        let indexes: Vec<String> = create_indexes()
            .iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            indexes,
            [
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "workflow_http_triggers_workflow_id_idx" ON "workflow_http_triggers" ("workflow_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_triggers_org_id_idx" ON "workflow_http_triggers" ("org_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "workflow_http_triggers_origin_cluster_idx" ON "workflow_http_triggers" ("origin_cluster")"#,
            ]
        );
    }

    #[test]
    fn every_statement_builds_on_both_backends() {
        let table = create_workflow_http_triggers_statement();
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
        assert!(!manager.has_table("workflow_http_triggers").await.unwrap());
        Migration.down(&manager).await.expect("second down");
        Migration.up(&manager).await.expect("up after down");
        assert!(manager.has_table("workflow_http_triggers").await.unwrap());
        for index in [
            "workflow_http_triggers_workflow_id_idx",
            "workflow_http_triggers_org_id_idx",
            "workflow_http_triggers_origin_cluster_idx",
        ] {
            assert!(
                manager
                    .has_index("workflow_http_triggers", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
    }
}
