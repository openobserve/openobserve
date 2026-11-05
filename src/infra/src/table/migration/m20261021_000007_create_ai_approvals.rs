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
        manager.create_index(session_index()).await?;
        manager.create_index(sweep_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AiApprovals::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiApprovals {
    Table,
    Id,
    OrgId,
    SessionId,
    UserEmail,
    Tool,
    Status,
    Scope,
    Card,
    Resolved,
    ExpiresAt,
    CreatedAt,
    DecidedAt,
}

fn create_statement() -> TableCreateStatement {
    let text = super::get_text_type();
    Table::create()
        .table(AiApprovals::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiApprovals::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AiApprovals::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiApprovals::SessionId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiApprovals::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiApprovals::Tool).string_len(256).null())
        .col(
            ColumnDef::new(AiApprovals::Status)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(AiApprovals::Scope).string_len(16).null())
        .col(
            ColumnDef::new(AiApprovals::Card)
                .custom(Alias::new(text))
                .not_null(),
        )
        .col(
            ColumnDef::new(AiApprovals::Resolved)
                .custom(Alias::new(text))
                .null(),
        )
        .col(
            ColumnDef::new(AiApprovals::ExpiresAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiApprovals::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(AiApprovals::DecidedAt).big_integer().null())
        .to_owned()
}

fn session_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_approvals_org_session")
        .if_not_exists()
        .table(AiApprovals::Table)
        .col(AiApprovals::OrgId)
        .col(AiApprovals::SessionId)
        .to_owned()
}

// The purge walks pending cards past expiry and decided ones past retention.
fn sweep_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_ai_approvals_status_expires")
        .if_not_exists()
        .table(AiApprovals::Table)
        .col(AiApprovals::Status)
        .col(AiApprovals::ExpiresAt)
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
        for index in [
            "idx_ai_approvals_org_session",
            "idx_ai_approvals_status_expires",
        ] {
            assert!(manager.has_index("ai_approvals", index).await.unwrap());
        }
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_approvals").await.unwrap());
    }
}
