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

//! Adds `hide_attachments` to `ai_chat_shares`.

use sea_orm_migration::prelude::*;

const SHARES: &str = "ai_chat_shares";
const COLUMN: &str = "hide_attachments";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite: `add_column_if_not_exists` is not idempotent.
        if manager.has_column(SHARES, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(SHARES, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AiChatShares::Table)
                    .drop_column(AiChatShares::HideAttachments)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatShares {
    Table,
    HideAttachments,
}

fn add_statement() -> TableAlterStatement {
    Table::alter()
        .table(AiChatShares::Table)
        .add_column(
            ColumnDef::new(AiChatShares::HideAttachments)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_shares_keep_showing_attachments() {
        let sql = add_statement().to_string(PostgresQueryBuilder);
        assert!(
            sql.contains("\"hide_attachments\" bool NOT NULL DEFAULT FALSE"),
            "{sql}"
        );
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE ai_chat_shares (id varchar(32) NOT NULL PRIMARY KEY, org_id text)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(SHARES, COLUMN).await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(SHARES, COLUMN).await.unwrap());
    }
}
