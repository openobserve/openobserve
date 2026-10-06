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

//! Creates `ai_chat_shares` and adds the nullable fork columns to `ai_chat_sessions`.

use sea_orm_migration::prelude::*;

const SESSIONS: &str = "ai_chat_sessions";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        for index in indexes() {
            manager.create_index(index).await?;
        }
        add_session_column(manager, AiChatSessions::ForkedFromShare).await?;
        add_session_column(manager, AiChatSessions::ForkSeedSeq).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_session_column(manager, AiChatSessions::ForkSeedSeq).await?;
        drop_session_column(manager, AiChatSessions::ForkedFromShare).await?;
        manager
            .drop_table(Table::drop().table(AiChatShares::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatShares {
    Table,
    Id,
    OrgId,
    SessionId,
    CreatedBy,
    Token,
    Mode,
    SnapshotSeq,
    Visibility,
    ExpiresAt,
    RevokedAt,
    AccessCount,
    LastAccessedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum AiChatSessions {
    ForkedFromShare,
    ForkSeedSeq,
}

/// One row per share link; the token is the bearer secret of a public link.
fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiChatShares::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiChatShares::Id)
                .string_len(32)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AiChatShares::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatShares::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatShares::CreatedBy)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatShares::Token)
                .string_len(64)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatShares::Mode).string_len(16).not_null())
        .col(
            ColumnDef::new(AiChatShares::SnapshotSeq)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiChatShares::Visibility)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatShares::ExpiresAt).big_integer().null())
        .col(ColumnDef::new(AiChatShares::RevokedAt).big_integer().null())
        .col(
            ColumnDef::new(AiChatShares::AccessCount)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AiChatShares::LastAccessedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiChatShares::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatShares::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 3] {
    [
        Index::create()
            .name("idx_ai_chat_shares_token")
            .if_not_exists()
            .table(AiChatShares::Table)
            .col(AiChatShares::Token)
            .unique()
            .to_owned(),
        Index::create()
            .name("idx_ai_chat_shares_session")
            .if_not_exists()
            .table(AiChatShares::Table)
            .col(AiChatShares::OrgId)
            .col(AiChatShares::SessionId)
            .to_owned(),
        Index::create()
            .name("idx_ai_chat_shares_creator")
            .if_not_exists()
            .table(AiChatShares::Table)
            .col(AiChatShares::OrgId)
            .col(AiChatShares::CreatedBy)
            .to_owned(),
    ]
}

fn session_column_def(column: AiChatSessions) -> ColumnDef {
    let mut def = ColumnDef::new(column);
    match column {
        AiChatSessions::ForkedFromShare => def.string_len(32),
        AiChatSessions::ForkSeedSeq => def.big_integer(),
    }
    .null()
    .to_owned()
}

// SQLite: one alter option per statement, and `add_column_if_not_exists` is not idempotent.
async fn add_session_column(
    manager: &SchemaManager<'_>,
    column: AiChatSessions,
) -> Result<(), DbErr> {
    if manager
        .has_column(SESSIONS, &column.into_iden().to_string())
        .await?
    {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(SESSIONS))
                .add_column(session_column_def(column))
                .to_owned(),
        )
        .await
}

async fn drop_session_column(
    manager: &SchemaManager<'_>,
    column: AiChatSessions,
) -> Result<(), DbErr> {
    if !manager
        .has_column(SESSIONS, &column.into_iden().to_string())
        .await?
    {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(SESSIONS))
                .drop_column(column)
                .to_owned(),
        )
        .await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn token_is_unique_and_lookups_are_indexed() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"id\" varchar(32) NOT NULL PRIMARY KEY"));
        assert!(sql.contains("\"access_count\" bigint NOT NULL DEFAULT 0"));
        assert!(sql.contains("\"snapshot_seq\" bigint NULL"));
        let [token, session, creator] = indexes().map(|i| i.to_string(PostgresQueryBuilder));
        assert!(token.contains("CREATE UNIQUE INDEX"));
        assert!(token.contains("(\"token\")"));
        assert!(session.contains("(\"org_id\", \"session_id\")"));
        assert!(creator.contains("(\"org_id\", \"created_by\")"));
    }

    #[test]
    fn fork_columns_are_nullable() {
        let sql = Table::alter()
            .table(Alias::new(SESSIONS))
            .add_column(session_column_def(AiChatSessions::ForkSeedSeq))
            .to_owned()
            .to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"fork_seed_seq\" bigint NULL"));
        let sql = Table::alter()
            .table(Alias::new(SESSIONS))
            .add_column(session_column_def(AiChatSessions::ForkedFromShare))
            .to_owned()
            .to_string(SqliteQueryBuilder);
        assert!(sql.contains("\"forked_from_share\" varchar(32) NULL"));
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
        assert!(manager.has_table("ai_chat_shares").await.unwrap());
        assert!(
            manager
                .has_column(SESSIONS, "forked_from_share")
                .await
                .unwrap()
        );
        assert!(manager.has_column(SESSIONS, "fork_seed_seq").await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_chat_shares").await.unwrap());
        assert!(!manager.has_column(SESSIONS, "fork_seed_seq").await.unwrap());
    }
}
