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

//! Adds `version_of` and the recorded approval `decisions` to `ai_chat_turns`.

use sea_orm_migration::prelude::*;

const TURNS: &str = "ai_chat_turns";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite: one column per ALTER, and `add_column_if_not_exists` is not idempotent.
        for (name, column) in columns() {
            if !manager.has_column(TURNS, name).await? {
                manager.alter_table(add_statement(column)).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, _) in columns() {
            if manager.has_column(TURNS, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(AiChatTurns::Table)
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
enum AiChatTurns {
    Table,
    VersionOf,
    Decisions,
}

fn columns() -> [(&'static str, ColumnDef); 2] {
    [
        (
            "version_of",
            ColumnDef::new(AiChatTurns::VersionOf)
                .string_len(64)
                .null()
                .to_owned(),
        ),
        (
            "decisions",
            ColumnDef::new(AiChatTurns::Decisions)
                .text()
                .null()
                .to_owned(),
        ),
    ]
}

fn add_statement(mut column: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(AiChatTurns::Table)
        .add_column(&mut column)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_turns_are_originals_without_decisions() {
        let sql: Vec<String> = columns()
            .into_iter()
            .map(|(_, c)| add_statement(c).to_string(PostgresQueryBuilder))
            .collect();
        assert!(
            sql[0].contains("\"version_of\" varchar(64) NULL"),
            "{sql:?}"
        );
        assert!(sql[1].contains("\"decisions\" text NULL"), "{sql:?}");
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
        for name in ["version_of", "decisions"] {
            assert!(manager.has_column(TURNS, name).await.unwrap(), "{name}");
        }
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TURNS, "version_of").await.unwrap());
    }
}
