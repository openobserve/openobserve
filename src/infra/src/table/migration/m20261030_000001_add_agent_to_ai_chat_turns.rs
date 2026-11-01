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

//! Adds the agent that answered each turn and the agent it took over from to `ai_chat_turns`.

use sea_orm_migration::prelude::*;

const TURNS: &str = "ai_chat_turns";
const AGENT_TYPE: &str = "agent_type";
const HANDOFF_FROM: &str = "handoff_from";

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
    AgentType,
    HandoffFrom,
}

fn columns() -> [(&'static str, ColumnDef); 2] {
    [
        (
            AGENT_TYPE,
            ColumnDef::new(AiChatTurns::AgentType)
                .text()
                .null()
                .to_owned(),
        ),
        (
            HANDOFF_FROM,
            ColumnDef::new(AiChatTurns::HandoffFrom)
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
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, FromQueryResult, Statement};

    use super::*;
    use crate::table::ai_chat_sessions::hand_off_with;

    #[derive(Debug, FromQueryResult, PartialEq)]
    struct Row {
        turn_id: String,
        agent_type: Option<String>,
        handoff_from: Option<String>,
    }

    async fn turn_tables() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE ai_chat_sessions
                 (org_id text, session_id text, agent_type text, status text);
             CREATE TABLE ai_chat_turns (org_id text, session_id text, turn_id text);",
        )
        .await
        .unwrap();
        db
    }

    async fn rows(db: &DatabaseConnection) -> Vec<Row> {
        let sql = "SELECT turn_id, agent_type, handoff_from FROM ai_chat_turns ORDER BY turn_id";
        let statement = Statement::from_string(db.get_database_backend(), sql);
        Row::find_by_statement(statement).all(db).await.unwrap()
    }

    fn row(turn_id: &str, agent_type: Option<&str>, handoff_from: Option<&str>) -> Row {
        Row {
            turn_id: turn_id.to_string(),
            agent_type: agent_type.map(str::to_string),
            handoff_from: handoff_from.map(str::to_string),
        }
    }

    #[test]
    fn both_columns_are_nullable_text() {
        let sql: Vec<String> = columns()
            .into_iter()
            .map(|(_, c)| add_statement(c).to_string(PostgresQueryBuilder))
            .collect();
        assert!(sql[0].contains("\"agent_type\" text NULL"), "{sql:?}");
        assert!(sql[1].contains("\"handoff_from\" text NULL"), "{sql:?}");
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = turn_tables().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        for name in [AGENT_TYPE, HANDOFF_FROM] {
            assert!(manager.has_column(TURNS, name).await.unwrap(), "{name}");
        }
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TURNS, AGENT_TYPE).await.unwrap());
        assert!(!manager.has_column(TURNS, HANDOFF_FROM).await.unwrap());
    }

    /// Old and rollout turns stay NULL until the first hand-off, which fixes them to the old agent.
    #[tokio::test]
    async fn a_mixed_chat_keeps_every_turn_s_agent_across_its_first_hand_off() {
        let db = turn_tables().await;
        db.execute_unprepared(
            "INSERT INTO ai_chat_sessions VALUES ('o', 'ask', 'o2-ai', 'active'),
                                                 ('o', 'other', 'sre', 'active');
             INSERT INTO ai_chat_turns VALUES ('o', 'ask', 't1'), ('o', 'other', 't9');",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        assert_eq!(rows(&db).await[0], row("t1", None, None), "no backfill");

        db.execute_unprepared(
            "INSERT INTO ai_chat_turns (org_id, session_id, turn_id) VALUES ('o', 'ask', 't2');
             INSERT INTO ai_chat_turns VALUES ('o', 'ask', 't3', 'sre', 'o2-ai');",
        )
        .await
        .unwrap();
        assert!(hand_off_with(&db, "o", "ask", "sre").await.unwrap());
        assert_eq!(
            rows(&db).await,
            [
                row("t1", Some("o2-ai"), None),
                row("t2", Some("o2-ai"), None),
                row("t3", Some("sre"), Some("o2-ai")),
                row("t9", None, None),
            ]
        );

        assert!(
            !hand_off_with(&db, "o", "ask", "sre").await.unwrap(),
            "no second move"
        );
        assert!(!hand_off_with(&db, "o", "gone", "sre").await.unwrap());
    }
}
