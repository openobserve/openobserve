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

//! Creates `ai_actions`, the append-only ledger of what the assistant changed and its undos.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AiActions::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiActions {
    Table,
    Id,
    OrgId,
    SessionId,
    TurnId,
    ApprovalId,
    ApprovalKind,
    ApprovedBy,
    UserEmail,
    Tool,
    Op,
    ResourceType,
    ResourceId,
    ResourceName,
    Before,
    After,
    Status,
    Message,
    Undoable,
    UndoReason,
    UndoUntil,
    UndoneBy,
    UndoneAt,
    UndoOf,
    CreatedAt,
}

fn create_statement() -> TableCreateStatement {
    let text = |column: AiActions| ColumnDef::new(column).text().null().to_owned();
    let string =
        |column: AiActions, len: u32| ColumnDef::new(column).string_len(len).null().to_owned();
    Table::create()
        .table(AiActions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiActions::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(AiActions::OrgId).string_len(256).not_null())
        .col(string(AiActions::SessionId, 64))
        .col(string(AiActions::TurnId, 64))
        .col(string(AiActions::ApprovalId, 128))
        .col(
            ColumnDef::new(AiActions::ApprovalKind)
                .string_len(16)
                .not_null(),
        )
        .col(string(AiActions::ApprovedBy, 256))
        .col(
            ColumnDef::new(AiActions::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiActions::Tool).string_len(256).not_null())
        .col(ColumnDef::new(AiActions::Op).string_len(16).not_null())
        .col(
            ColumnDef::new(AiActions::ResourceType)
                .string_len(64)
                .not_null(),
        )
        .col(string(AiActions::ResourceId, 256))
        .col(string(AiActions::ResourceName, 256))
        .col(text(AiActions::Before))
        .col(text(AiActions::After))
        .col(ColumnDef::new(AiActions::Status).string_len(16).not_null())
        .col(string(AiActions::Message, 256))
        .col(ColumnDef::new(AiActions::Undoable).boolean().not_null())
        .col(string(AiActions::UndoReason, 64))
        .col(ColumnDef::new(AiActions::UndoUntil).big_integer().null())
        .col(string(AiActions::UndoneBy, 256))
        .col(ColumnDef::new(AiActions::UndoneAt).big_integer().null())
        .col(string(AiActions::UndoOf, 64))
        .col(
            ColumnDef::new(AiActions::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 2] {
    [
        Index::create()
            .name("idx_ai_actions_org_created")
            .if_not_exists()
            .table(AiActions::Table)
            .col(AiActions::OrgId)
            .col(AiActions::CreatedAt)
            .to_owned(),
        Index::create()
            .name("idx_ai_actions_org_user")
            .if_not_exists()
            .table(AiActions::Table)
            .col(AiActions::OrgId)
            .col(AiActions::UserEmail)
            .to_owned(),
    ]
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
        assert!(manager.has_table("ai_actions").await.unwrap());
        assert!(
            manager
                .has_column("ai_actions", "undo_until")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_actions").await.unwrap());
    }
}
