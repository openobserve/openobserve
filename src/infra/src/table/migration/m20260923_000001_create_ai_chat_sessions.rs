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
        manager.create_index(user_list_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AiChatSessions::Table).to_owned())
            .await
    }
}

/// The AI chat session index (server-side chat persistence).
///
/// One small row per conversation. It answers who owns the chat, when it was
/// active, and how far the durable history is committed — nothing more. The
/// conversation content (opencode's durable events, tool calls and results
/// included) lives in the protected per-org `_o2_ai_chat_events` stream; this
/// table is a derived index over it and is never allowed to grow with the
/// number of messages.
///
/// `last_committed_seq` is the highest **contiguous** opencode event sequence
/// durably accepted by the stream — not the highest observed. opencode's `seq`
/// is 0-based, so "nothing committed" is `-1`. `session_epoch` fences writers:
/// it increments when the chat is re-bound to a different opencode session
/// (a replica rebuilt after losing its local copy), and a stale epoch can never
/// advance the watermark.
///
/// `user_id` is the owner's stable `users.id` (a KSUID): an email can be
/// removed and later re-registered by someone else, who must not inherit the
/// chats. `user_email` is kept for audit/display only. `last_turn_id` lets a
/// retried request be recognized instead of starting a second model run.
fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiChatSessions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiChatSessions::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::UserId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::OpencodeSessionId)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::AgentType)
                .string_len(64)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatSessions::Title).text().not_null())
        .col(
            ColumnDef::new(AiChatSessions::Status)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::FirstEventAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::LastEventAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::LastCommittedSeq)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::SessionEpoch)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatSessions::LastTurnId)
                .string_len(64)
                .null(),
        )
        .primary_key(
            Index::create()
                .col(AiChatSessions::OrgId)
                .col(AiChatSessions::SessionId),
        )
        .to_owned()
}

/// Backs the per-user chat list, newest activity first, with keyset
/// pagination on `(updated_at, session_id)`.
fn user_list_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_chat_sessions_user_list")
        .if_not_exists()
        .table(AiChatSessions::Table)
        .col(AiChatSessions::OrgId)
        .col(AiChatSessions::UserId)
        .col(AiChatSessions::UpdatedAt)
        .col(AiChatSessions::SessionId)
        .to_owned()
}

#[derive(DeriveIden)]
enum AiChatSessions {
    Table,
    OrgId,
    SessionId,
    UserId,
    UserEmail,
    OpencodeSessionId,
    AgentType,
    Title,
    Status,
    CreatedAt,
    UpdatedAt,
    FirstEventAt,
    LastEventAt,
    LastCommittedSeq,
    SessionEpoch,
    LastTurnId,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_an_index_not_a_message_store() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"last_committed_seq\" bigint NOT NULL"));
        assert!(sql.contains("\"session_epoch\" bigint NOT NULL"));
        assert!(sql.contains("PRIMARY KEY (\"org_id\", \"session_id\")"));
        // No content columns: bodies live in the protected stream.
        assert!(!sql.contains("payload"));
        assert!(!sql.contains("message"));
    }

    #[test]
    fn builds_on_sqlite_as_well_as_postgres() {
        let sqlite = create_statement().to_string(SqliteQueryBuilder);
        assert!(sqlite.contains("\"last_committed_seq\" bigint NOT NULL"));
        assert!(sqlite.contains("\"opencode_session_id\" varchar(64) NULL"));
        assert!(
            user_list_index()
                .to_string(SqliteQueryBuilder)
                .contains("CREATE INDEX")
        );
    }

    #[test]
    fn user_list_index_supports_keyset_pagination() {
        let sql = user_list_index().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"org_id\", \"user_id\", \"updated_at\", \"session_id\""));
    }
}
