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

//! One migration for on-call in Slack: `oncall_chat_messages` and the team's Slack room columns.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

use super::get_text_type;

const MESSAGE_IDX: &str = "oncall_chat_messages_message_idx";
const RESPONSE_IDX: &str = "oncall_chat_messages_response_idx";
const ONCALL_TEAMS: &str = "oncall_teams";
/// The team's Slack room columns, in the order they are added.
const TEAM_COLUMNS: [&str; 5] = [
    "slack_enterprise_id",
    "slack_workspace_id",
    "slack_channel_id",
    "slack_channel_name",
    "slack_same_room_destination",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_messages(manager.get_connection()).await?;
        // One alter option per statement, plus a `has_column` guard, so a rerun is a no-op.
        for column in TEAM_COLUMNS {
            if !manager.has_column(ONCALL_TEAMS, column).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(ONCALL_TEAMS))
                            .add_column(ColumnDef::new(Alias::new(column)).string().null())
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in TEAM_COLUMNS.into_iter().rev() {
            if manager.has_column(ONCALL_TEAMS, column).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(ONCALL_TEAMS))
                            .drop_column(Alias::new(column))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        manager
            .drop_table(
                Table::drop()
                    .table(OncallChatMessages::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum OncallChatMessages {
    Table,
    Id,
    OrgId,
    ResponseId,
    TeamId,
    LadderRun,
    InstallationId,
    ChannelId,
    MessageTs,
    Permalink,
    Kind,
    Recipient,
    Status,
    Rendered,
    CreatedAt,
    UpdatedAt,
}

/// Creates `oncall_chat_messages` and its keys; shared by the migration and the test helper.
pub(super) async fn create_messages<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    use OncallChatMessages as T;
    let backend = conn.get_database_backend();
    let table = Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::Id).string().not_null().primary_key())
        .col(ColumnDef::new(T::OrgId).string().not_null())
        .col(ColumnDef::new(T::ResponseId).string().not_null())
        .col(ColumnDef::new(T::TeamId).string().not_null())
        .col(ColumnDef::new(T::LadderRun).integer().not_null())
        .col(ColumnDef::new(T::InstallationId).string_len(27).not_null())
        .col(ColumnDef::new(T::ChannelId).string_len(32).not_null())
        .col(ColumnDef::new(T::MessageTs).string_len(32).null())
        .col(ColumnDef::new(T::Permalink).string().null())
        .col(ColumnDef::new(T::Kind).integer().not_null())
        .col(ColumnDef::new(T::Recipient).string().null())
        .col(ColumnDef::new(T::Status).integer().not_null())
        .col(
            ColumnDef::new(T::Rendered)
                .custom(Alias::new(get_text_type()))
                .not_null(),
        )
        .col(ColumnDef::new(T::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(T::UpdatedAt).big_integer().not_null())
        .to_owned();
    conn.execute(backend.build(&table)).await?;
    let message = Index::create()
        .if_not_exists()
        .name(MESSAGE_IDX)
        .table(T::Table)
        .col(T::InstallationId)
        .col(T::ChannelId)
        .col(T::MessageTs)
        .unique()
        .to_owned();
    let response = Index::create()
        .if_not_exists()
        .name(RESPONSE_IDX)
        .table(T::Table)
        .col(T::ResponseId)
        .to_owned();
    for index in [message, response] {
        conn.execute(backend.build(&index)).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("SELECT name FROM pragma_table_info('{table}') ORDER BY name"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    /// RO-1, §10: the messages table and its keys, and the team's four Slack columns; twice.
    #[tokio::test]
    async fn test_up_creates_the_table_and_columns_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE oncall_teams (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert_eq!(
            columns(&db, "oncall_chat_messages").await,
            vec![
                "channel_id",
                "created_at",
                "id",
                "installation_id",
                "kind",
                "ladder_run",
                "message_ts",
                "org_id",
                "permalink",
                "recipient",
                "rendered",
                "response_id",
                "status",
                "team_id",
                "updated_at",
            ]
        );
        for index in [MESSAGE_IDX, RESPONSE_IDX] {
            assert!(
                manager
                    .has_index("oncall_chat_messages", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
        assert_eq!(
            columns(&db, "oncall_teams").await,
            vec![
                "id",
                "slack_channel_id",
                "slack_channel_name",
                "slack_enterprise_id",
                "slack_same_room_destination",
                "slack_workspace_id",
            ]
        );

        Migration.down(&manager).await.expect("first down");
        Migration.down(&manager).await.expect("second down");
        assert!(!manager.has_table("oncall_chat_messages").await.unwrap());
        assert_eq!(columns(&db, "oncall_teams").await, vec!["id"]);
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261101_000001_create_oncall_slack");
    }
}
