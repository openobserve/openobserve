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

//! Creates `ai_memory` and `ai_memory_revisions`.

use sea_orm_migration::prelude::*;

const MEMORY_SCOPE_UNIQ_IDX: &str = "ai_memory_org_scope_key_uniq_idx";
const REVISIONS_OP_ID_UNIQ_IDX: &str = "ai_memory_revisions_op_id_uniq_idx";
const REVISIONS_MEMORY_CREATED_IDX: &str = "ai_memory_revisions_memory_created_idx";
const REVISIONS_MEMORY_STATE_IDX: &str = "ai_memory_revisions_memory_state_idx";
const REVISIONS_ORG_STATE_IDX: &str = "ai_memory_revisions_org_state_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_memory_table_stmt()).await?;
        manager.create_table(create_revisions_table_stmt()).await?;
        for index in create_index_stmts() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            AiMemoryRevisions::Table.into_iden(),
            AiMemory::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AiMemory {
    Table,
    Id,
    Org,
    Scope,
    ScopeKey,
    Content,
    Rev,
    OpId,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
    AgentMemoryWrites,
    MaxBytes,
    UserMaxBytes,
}

#[derive(DeriveIden)]
enum AiMemoryRevisions {
    Table,
    Id,
    MemoryId,
    Org,
    Rev,
    State,
    BaseRev,
    Edits,
    Content,
    UpdatedBy,
    Reason,
    Evidence,
    OriginRegion,
    OpId,
    CreatedAt,
}

fn create_memory_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(AiMemory::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiMemory::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(AiMemory::Org).string_len(100).not_null())
        .col(ColumnDef::new(AiMemory::Scope).string_len(16).not_null())
        .col(
            ColumnDef::new(AiMemory::ScopeKey)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiMemory::Content).text().not_null())
        .col(
            ColumnDef::new(AiMemory::Rev)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(AiMemory::OpId).char_len(27).null())
        .col(
            ColumnDef::new(AiMemory::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiMemory::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(AiMemory::UpdatedAt).big_integer().not_null())
        .col(
            ColumnDef::new(AiMemory::AgentMemoryWrites)
                .string_len(16)
                .null(),
        )
        .col(ColumnDef::new(AiMemory::MaxBytes).big_integer().null())
        .col(ColumnDef::new(AiMemory::UserMaxBytes).big_integer().null())
        .to_owned()
}

fn create_revisions_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(AiMemoryRevisions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiMemoryRevisions::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AiMemoryRevisions::MemoryId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryRevisions::Org)
                .string_len(100)
                .not_null(),
        )
        .col(ColumnDef::new(AiMemoryRevisions::Rev).big_integer().null())
        .col(
            ColumnDef::new(AiMemoryRevisions::State)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryRevisions::BaseRev)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(AiMemoryRevisions::Edits).text().null())
        .col(ColumnDef::new(AiMemoryRevisions::Content).text().null())
        .col(
            ColumnDef::new(AiMemoryRevisions::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiMemoryRevisions::Reason).text().null())
        .col(ColumnDef::new(AiMemoryRevisions::Evidence).text().null())
        .col(
            ColumnDef::new(AiMemoryRevisions::OriginRegion)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryRevisions::OpId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryRevisions::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_index_stmts() -> [IndexCreateStatement; 5] {
    [
        Index::create()
            .if_not_exists()
            .name(MEMORY_SCOPE_UNIQ_IDX)
            .table(AiMemory::Table)
            .col(AiMemory::Org)
            .col(AiMemory::Scope)
            .col(AiMemory::ScopeKey)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(REVISIONS_OP_ID_UNIQ_IDX)
            .table(AiMemoryRevisions::Table)
            .col(AiMemoryRevisions::OpId)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(REVISIONS_MEMORY_CREATED_IDX)
            .table(AiMemoryRevisions::Table)
            .col(AiMemoryRevisions::MemoryId)
            .col(AiMemoryRevisions::CreatedAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(REVISIONS_MEMORY_STATE_IDX)
            .table(AiMemoryRevisions::Table)
            .col(AiMemoryRevisions::MemoryId)
            .col(AiMemoryRevisions::State)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(REVISIONS_ORG_STATE_IDX)
            .table(AiMemoryRevisions::Table)
            .col(AiMemoryRevisions::Org)
            .col(AiMemoryRevisions::State)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_memory_table_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "ai_memory" (
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "scope" varchar(16) NOT NULL,
                "scope_key" varchar(256) NOT NULL,
                "content" text NOT NULL,
                "rev" bigint NOT NULL DEFAULT 0,
                "op_id" char(27) NULL,
                "updated_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "agent_memory_writes" varchar(16) NULL,
                "max_bytes" bigint NULL,
                "user_max_bytes" bigint NULL
            )"#
        );
        collapsed_eq!(
            &create_revisions_table_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "ai_memory_revisions" (
                "id" char(27) NOT NULL PRIMARY KEY,
                "memory_id" char(27) NOT NULL,
                "org" varchar(100) NOT NULL,
                "rev" bigint NULL,
                "state" varchar(16) NOT NULL,
                "base_rev" bigint NOT NULL,
                "edits" text NULL,
                "content" text NULL,
                "updated_by" varchar(256) NOT NULL,
                "reason" text NULL,
                "evidence" text NULL,
                "origin_region" varchar(100) NOT NULL,
                "op_id" char(27) NOT NULL,
                "created_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            create_index_stmts().map(|i| i.to_string(PostgresQueryBuilder)),
            [
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "ai_memory_org_scope_key_uniq_idx" ON "ai_memory" ("org", "scope", "scope_key")"#,
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "ai_memory_revisions_op_id_uniq_idx" ON "ai_memory_revisions" ("op_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "ai_memory_revisions_memory_created_idx" ON "ai_memory_revisions" ("memory_id", "created_at")"#,
                r#"CREATE INDEX IF NOT EXISTS "ai_memory_revisions_memory_state_idx" ON "ai_memory_revisions" ("memory_id", "state")"#,
                r#"CREATE INDEX IF NOT EXISTS "ai_memory_revisions_org_state_idx" ON "ai_memory_revisions" ("org", "state")"#,
            ]
        );
    }

    #[test]
    fn sqlite() {
        assert_eq!(
            create_index_stmts()[0].to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "ai_memory_org_scope_key_uniq_idx" ON "ai_memory" ("org", "scope", "scope_key")"#
        );
    }

    #[tokio::test]
    async fn up_twice_and_down_leave_sqlite_consistent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        for table in ["ai_memory", "ai_memory_revisions"] {
            assert!(manager.has_table(table).await.unwrap(), "{table}");
        }
        db.execute_unprepared(
            "INSERT INTO ai_memory (id, org, scope, scope_key, content, updated_by, created_at, updated_at) \
             VALUES ('a', 'o', 'org', '', 'c', 'system', 1, 1)",
        )
        .await
        .unwrap();
        let duplicate = db
            .execute_unprepared(
                "INSERT INTO ai_memory (id, org, scope, scope_key, content, updated_by, created_at, updated_at) \
                 VALUES ('b', 'o', 'org', '', 'c', 'system', 1, 1)",
            )
            .await;
        assert!(duplicate.is_err(), "(org, scope, scope_key) is unique");
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_memory").await.unwrap());
    }
}
