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

//! Adds the nullable `first_event_at` to `ai_chat_turns`.

use sea_orm_migration::prelude::*;

const TURNS: &str = "ai_chat_turns";
const COLUMN: &str = "first_event_at";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite: `add_column_if_not_exists` is not idempotent.
        if manager.has_column(TURNS, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TURNS, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AiChatTurns::Table)
                    .drop_column(AiChatTurns::FirstEventAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AiChatTurns {
    Table,
    FirstEventAt,
}

fn add_statement() -> TableAlterStatement {
    Table::alter()
        .table(AiChatTurns::Table)
        .add_column(
            ColumnDef::new(AiChatTurns::FirstEventAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_turns_have_no_first_event() {
        let sql = add_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"first_event_at\" bigint NULL"), "{sql}");
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE ai_chat_turns (org_id text, session_id text, turn_id text)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(TURNS, COLUMN).await.unwrap());
        db.execute_unprepared(
            "INSERT INTO ai_chat_turns (org_id, session_id, turn_id) VALUES ('o', 's', 't')",
        )
        .await
        .unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TURNS, COLUMN).await.unwrap());
    }
}
