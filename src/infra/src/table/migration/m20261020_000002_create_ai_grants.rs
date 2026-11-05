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

//! Creates `ai_grants`, a member's standing approvals for the assistant's tool calls.

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
            .drop_table(Table::drop().table(AiGrants::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiGrants {
    Table,
    Id,
    OrgId,
    UserEmail,
    Tool,
    Operation,
    Scope,
    ChatId,
    GrantedBy,
    GrantedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiGrants::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiGrants::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(AiGrants::OrgId).string_len(256).not_null())
        .col(
            ColumnDef::new(AiGrants::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiGrants::Tool).string_len(256).not_null())
        .col(
            ColumnDef::new(AiGrants::Operation)
                .string_len(128)
                .not_null(),
        )
        .col(ColumnDef::new(AiGrants::Scope).string_len(16).not_null())
        .col(ColumnDef::new(AiGrants::ChatId).string_len(64).null())
        .col(
            ColumnDef::new(AiGrants::GrantedBy)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiGrants::GrantedAt).big_integer().not_null())
        .to_owned()
}

fn index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_grants_org_user")
        .if_not_exists()
        .table(AiGrants::Table)
        .col(AiGrants::OrgId)
        .col(AiGrants::UserEmail)
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
        assert!(manager.has_table("ai_grants").await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_grants").await.unwrap());
    }
}
