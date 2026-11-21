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

//! Adds `branched_from` to `ai_chat_sessions`: the source of a chat branched at an answer.

use sea_orm_migration::prelude::*;

const SESSIONS: &str = "ai_chat_sessions";
const BRANCHED_FROM: &str = "branched_from";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // `add_column_if_not_exists` is not idempotent on SQLite.
        if !manager.has_column(SESSIONS, BRANCHED_FROM).await? {
            manager.alter_table(add_statement()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(SESSIONS, BRANCHED_FROM).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(AiChatSessions::Table)
                        .drop_column(AiChatSessions::BranchedFrom)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AiChatSessions {
    Table,
    BranchedFrom,
}

fn add_statement() -> TableAlterStatement {
    Table::alter()
        .table(AiChatSessions::Table)
        .add_column(
            ColumnDef::new(AiChatSessions::BranchedFrom)
                .text()
                .null()
                .to_owned(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_chats_are_no_branches() {
        let sql = add_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"branched_from\" text NULL"), "{sql}");
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE ai_chat_sessions (org_id text, session_id text)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(SESSIONS, BRANCHED_FROM).await.unwrap());
        db.execute_unprepared(
            "INSERT INTO ai_chat_sessions (org_id, session_id) VALUES ('o', 's')",
        )
        .await
        .unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(SESSIONS, BRANCHED_FROM).await.unwrap());
    }
}
