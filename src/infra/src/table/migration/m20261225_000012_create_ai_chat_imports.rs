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

//! Creates `ai_chat_imports`: browser-recorded chats moved to the server, once per `client_id`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(index_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AiChatImports::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatImports {
    Table,
    OrgId,
    UserId,
    ClientId,
    SessionId,
    Origin,
    Turns,
    CreatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiChatImports::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiChatImports::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatImports::UserId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatImports::ClientId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatImports::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiChatImports::Origin)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(AiChatImports::Turns).text().not_null())
        .col(
            ColumnDef::new(AiChatImports::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AiChatImports::OrgId)
                .col(AiChatImports::UserId)
                .col(AiChatImports::ClientId),
        )
        .to_owned()
}

fn index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_chat_imports_org_session")
        .if_not_exists()
        .table(AiChatImports::Table)
        .col(AiChatImports::OrgId)
        .col(AiChatImports::SessionId)
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
        assert!(manager.has_table("ai_chat_imports").await.unwrap());
        assert!(
            manager
                .has_index("ai_chat_imports", "idx_ai_chat_imports_org_session")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_chat_imports").await.unwrap());
    }
}
