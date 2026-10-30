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

//! Creates `ai_chat_turns` (one row per submitted chat turn) and adds the
//! nullable `replica_purged_at` column to `ai_chat_sessions`.

use sea_orm_migration::prelude::*;

const SESSIONS: &str = "ai_chat_sessions";
const REPLICA_PURGED_AT: &str = "replica_purged_at";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(status_index()).await?;
        // SQLite: `add_column_if_not_exists` is not idempotent.
        if manager.has_column(SESSIONS, REPLICA_PURGED_AT).await? {
            return Ok(());
        }
        manager.alter_table(add_purged_column()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(SESSIONS, REPLICA_PURGED_AT).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(SESSIONS))
                        .drop_column(Alias::new(REPLICA_PURGED_AT))
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(Table::drop().table(AiChatTurns::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatTurns {
    Table,
    OrgId,
    SessionId,
    TurnId,
    Status,
    ErrorCode,
    StartSeq,
    EndSeq,
    StartedAt,
    EndedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiChatTurns::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiChatTurns::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatTurns::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatTurns::TurnId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatTurns::Status)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatTurns::ErrorCode).string_len(64).null())
        .col(ColumnDef::new(AiChatTurns::StartSeq).big_integer().null())
        .col(ColumnDef::new(AiChatTurns::EndSeq).big_integer().null())
        .col(
            ColumnDef::new(AiChatTurns::StartedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(AiChatTurns::EndedAt).big_integer().null())
        .primary_key(
            Index::create()
                .name("pk_ai_chat_turns")
                .col(AiChatTurns::OrgId)
                .col(AiChatTurns::SessionId)
                .col(AiChatTurns::TurnId),
        )
        .to_owned()
}

/// The chat list looks up running turns per org.
fn status_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_chat_turns_status")
        .if_not_exists()
        .table(AiChatTurns::Table)
        .col(AiChatTurns::OrgId)
        .col(AiChatTurns::Status)
        .to_owned()
}

fn add_purged_column() -> TableAlterStatement {
    Table::alter()
        .table(Alias::new(SESSIONS))
        .add_column(
            ColumnDef::new(Alias::new(REPLICA_PURGED_AT))
                .big_integer()
                .null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn turns_are_keyed_per_chat_and_seq_columns_are_nullable() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("PRIMARY KEY (\"org_id\", \"session_id\", \"turn_id\")"));
        assert!(sql.contains("\"end_seq\" bigint NULL"));
        assert!(sql.contains("\"started_at\" bigint NOT NULL"));
        let sql = add_purged_column().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"replica_purged_at\" bigint NULL"));
    }

    #[tokio::test]
    async fn up_and_down_are_idempotent_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE ai_chat_sessions (org_id TEXT NOT NULL, session_id TEXT NOT NULL)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("ai_chat_turns").await.unwrap());
        assert!(
            manager
                .has_column(SESSIONS, REPLICA_PURGED_AT)
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_chat_turns").await.unwrap());
        assert!(
            !manager
                .has_column(SESSIONS, REPLICA_PURGED_AT)
                .await
                .unwrap()
        );
    }
}
