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

//! Creates `ai_access_requests`, members asking their admins for assistant access.

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
            .drop_table(Table::drop().table(AiAccessRequests::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AiAccessRequests {
    Table,
    Id,
    OrgId,
    UserEmail,
    Message,
    Day,
    CreatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(AiAccessRequests::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiAccessRequests::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AiAccessRequests::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiAccessRequests::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AiAccessRequests::Message).text().null())
        .col(
            ColumnDef::new(AiAccessRequests::Day)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiAccessRequests::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Unique, so concurrent requests on any node store one row per member per org per UTC day.
fn index_statement() -> IndexCreateStatement {
    Index::create()
        .name("uq_ai_access_requests_org_user_day")
        .if_not_exists()
        .table(AiAccessRequests::Table)
        .col(AiAccessRequests::OrgId)
        .col(AiAccessRequests::UserEmail)
        .col(AiAccessRequests::Day)
        .unique()
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
        assert!(manager.has_table("ai_access_requests").await.unwrap());
        assert!(
            manager
                .has_index("ai_access_requests", "uq_ai_access_requests_org_user_day")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("ai_access_requests").await.unwrap());
    }
}
