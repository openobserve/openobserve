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

//! Creates `ai_chat_feedback`: one vote and comment per member and turn, kept with the chat.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AiChatFeedback::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatFeedback {
    Table,
    OrgId,
    SessionId,
    TurnId,
    UserId,
    Rating,
    Comment,
    CreatedAt,
    UpdatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiChatFeedback::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiChatFeedback::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatFeedback::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatFeedback::TurnId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatFeedback::UserId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatFeedback::Rating)
                .string_len(8)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatFeedback::Comment).text().null())
        .col(
            ColumnDef::new(AiChatFeedback::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatFeedback::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AiChatFeedback::OrgId)
                .col(AiChatFeedback::SessionId)
                .col(AiChatFeedback::TurnId)
                .col(AiChatFeedback::UserId),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;

    #[tokio::test]
    async fn up_is_idempotent_and_down_drops() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("ai_chat_feedback").await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_chat_feedback").await.unwrap());
    }
}
