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

//! Adds `pinned`, `pinned_at`, the fork `seed` and `search_text` to `ai_chat_sessions`.

use sea_orm_migration::prelude::*;

const SESSIONS: &str = "ai_chat_sessions";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite: one column per ALTER, and `add_column_if_not_exists` is not idempotent.
        for (name, column) in columns() {
            if !manager.has_column(SESSIONS, name).await? {
                manager.alter_table(add_statement(column)).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, _) in columns() {
            if manager.has_column(SESSIONS, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(AiChatSessions::Table)
                            .drop_column(Alias::new(name))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AiChatSessions {
    Table,
    Pinned,
    PinnedAt,
    Seed,
    SearchText,
}

fn columns() -> [(&'static str, ColumnDef); 4] {
    [
        (
            "pinned",
            ColumnDef::new(AiChatSessions::Pinned)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
        ),
        (
            "pinned_at",
            ColumnDef::new(AiChatSessions::PinnedAt)
                .big_integer()
                .null()
                .to_owned(),
        ),
        (
            "seed",
            ColumnDef::new(AiChatSessions::Seed)
                .text()
                .null()
                .to_owned(),
        ),
        (
            "search_text",
            ColumnDef::new(AiChatSessions::SearchText)
                .text()
                .null()
                .to_owned(),
        ),
    ]
}

fn add_statement(mut column: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(AiChatSessions::Table)
        .add_column(&mut column)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_chats_are_unpinned_and_unseeded() {
        let sql: Vec<String> = columns()
            .into_iter()
            .map(|(_, c)| add_statement(c).to_string(PostgresQueryBuilder))
            .collect();
        assert!(
            sql[0].contains("\"pinned\" bool NOT NULL DEFAULT FALSE"),
            "{sql:?}"
        );
        assert!(sql[1].contains("\"pinned_at\" bigint NULL"), "{sql:?}");
        assert!(sql[2].contains("\"seed\" text NULL"), "{sql:?}");
        assert!(sql[3].contains("\"search_text\" text NULL"), "{sql:?}");
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
        for name in ["pinned", "pinned_at", "seed", "search_text"] {
            assert!(manager.has_column(SESSIONS, name).await.unwrap(), "{name}");
        }
        db.execute_unprepared(
            "INSERT INTO ai_chat_sessions (org_id, session_id) VALUES ('o', 's')",
        )
        .await
        .unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(SESSIONS, "pinned").await.unwrap());
    }
}
