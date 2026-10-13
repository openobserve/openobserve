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

//! Chat installs, person links and page messages; enums are stored as i32 like `oncall_responses`.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_installs()).await?;
        manager.create_table(create_identities()).await?;
        manager.create_table(create_messages()).await?;
        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            OncallChatMessages::Table.into_iden(),
            OncallChatIdentities::Table.into_iden(),
            OncallChatInstalls::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum OncallChatInstalls {
    Table,
    Id,
    OrgId,
    Platform,
    WorkspaceId,
    WorkspaceName,
    EnterpriseId,
    AppId,
    BotUserId,
    BotTokenCipher,
    Scopes,
    Status,
    InstalledBy,
    InstalledAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallChatIdentities {
    Table,
    Id,
    OrgId,
    Platform,
    WorkspaceId,
    PlatformUserId,
    EnterpriseUserId,
    UserEmail,
    LinkedAt,
    UnlinkedAt,
    ChangedAt,
}

#[derive(DeriveIden)]
enum OncallChatMessages {
    Table,
    Id,
    OrgId,
    ResponseId,
    TeamId,
    LadderRun,
    Platform,
    WorkspaceId,
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

/// Builds `oncall_chat_installs`.
fn create_installs() -> TableCreateStatement {
    use OncallChatInstalls as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::Id).string().not_null().primary_key())
        .col(ColumnDef::new(T::OrgId).string().not_null())
        .col(ColumnDef::new(T::Platform).integer().not_null())
        .col(ColumnDef::new(T::WorkspaceId).string().not_null())
        .col(ColumnDef::new(T::WorkspaceName).string().not_null())
        .col(ColumnDef::new(T::EnterpriseId).string().null())
        .col(ColumnDef::new(T::AppId).string().not_null())
        .col(ColumnDef::new(T::BotUserId).string().not_null())
        .col(
            ColumnDef::new(T::BotTokenCipher)
                .custom(Alias::new(get_text_type()))
                .not_null(),
        )
        .col(ColumnDef::new(T::Scopes).string().not_null())
        .col(ColumnDef::new(T::Status).integer().not_null())
        .col(ColumnDef::new(T::InstalledBy).string().not_null())
        .col(ColumnDef::new(T::InstalledAt).big_integer().not_null())
        .col(ColumnDef::new(T::UpdatedAt).big_integer().not_null())
        .to_owned()
}

/// Builds `oncall_chat_identities`.
fn create_identities() -> TableCreateStatement {
    use OncallChatIdentities as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::Id).string().not_null().primary_key())
        .col(ColumnDef::new(T::OrgId).string().not_null())
        .col(ColumnDef::new(T::Platform).integer().not_null())
        .col(ColumnDef::new(T::WorkspaceId).string().not_null())
        .col(ColumnDef::new(T::PlatformUserId).string().not_null())
        .col(ColumnDef::new(T::EnterpriseUserId).string().null())
        .col(ColumnDef::new(T::UserEmail).string().not_null())
        .col(ColumnDef::new(T::LinkedAt).big_integer().not_null())
        .col(ColumnDef::new(T::UnlinkedAt).big_integer().null())
        .col(ColumnDef::new(T::ChangedAt).big_integer().not_null())
        .to_owned()
}

/// Builds `oncall_chat_messages`.
fn create_messages() -> TableCreateStatement {
    use OncallChatMessages as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::Id).string().not_null().primary_key())
        .col(ColumnDef::new(T::OrgId).string().not_null())
        .col(ColumnDef::new(T::ResponseId).string().not_null())
        .col(ColumnDef::new(T::TeamId).string().not_null())
        .col(ColumnDef::new(T::LadderRun).integer().not_null())
        .col(ColumnDef::new(T::Platform).integer().not_null())
        .col(ColumnDef::new(T::WorkspaceId).string().not_null())
        .col(ColumnDef::new(T::ChannelId).string().not_null())
        .col(ColumnDef::new(T::MessageTs).string().null())
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
        .to_owned()
}

/// Section 9's unique keys and the page index.
fn indexes() -> Vec<IndexCreateStatement> {
    vec![
        Index::create()
            .if_not_exists()
            .table(OncallChatInstalls::Table)
            .name("idx_oncall_chat_installs_workspace")
            .col(OncallChatInstalls::Platform)
            .col(OncallChatInstalls::WorkspaceId)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .table(OncallChatInstalls::Table)
            .name("idx_oncall_chat_installs_org")
            .col(OncallChatInstalls::OrgId)
            .col(OncallChatInstalls::Platform)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .table(OncallChatIdentities::Table)
            .name("idx_oncall_chat_identities_email")
            .col(OncallChatIdentities::OrgId)
            .col(OncallChatIdentities::Platform)
            .col(OncallChatIdentities::WorkspaceId)
            .col(OncallChatIdentities::UserEmail)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .table(OncallChatIdentities::Table)
            .name("idx_oncall_chat_identities_user")
            .col(OncallChatIdentities::OrgId)
            .col(OncallChatIdentities::Platform)
            .col(OncallChatIdentities::WorkspaceId)
            .col(OncallChatIdentities::PlatformUserId)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .table(OncallChatMessages::Table)
            .name("idx_oncall_chat_messages_ts")
            .col(OncallChatMessages::Platform)
            .col(OncallChatMessages::ChannelId)
            .col(OncallChatMessages::MessageTs)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .table(OncallChatMessages::Table)
            .name("idx_oncall_chat_messages_response")
            .col(OncallChatMessages::ResponseId)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait, sea_query::MysqlQueryBuilder};

    use super::*;

    const TABLES: [&str; 3] = [
        "oncall_chat_installs",
        "oncall_chat_identities",
        "oncall_chat_messages",
    ];

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

    #[tokio::test]
    async fn test_up_creates_the_tables_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert_eq!(
            columns(&db, "oncall_chat_installs").await,
            vec![
                "app_id",
                "bot_token_cipher",
                "bot_user_id",
                "enterprise_id",
                "id",
                "installed_at",
                "installed_by",
                "org_id",
                "platform",
                "scopes",
                "status",
                "updated_at",
                "workspace_id",
                "workspace_name",
            ]
        );
        assert_eq!(
            columns(&db, "oncall_chat_identities").await,
            vec![
                "changed_at",
                "enterprise_user_id",
                "id",
                "linked_at",
                "org_id",
                "platform",
                "platform_user_id",
                "unlinked_at",
                "user_email",
                "workspace_id",
            ]
        );
        assert_eq!(
            columns(&db, "oncall_chat_messages").await,
            vec![
                "channel_id",
                "created_at",
                "id",
                "kind",
                "ladder_run",
                "message_ts",
                "org_id",
                "permalink",
                "platform",
                "recipient",
                "rendered",
                "response_id",
                "status",
                "team_id",
                "updated_at",
                "workspace_id",
            ]
        );
        assert!(
            manager
                .has_index("oncall_chat_messages", "idx_oncall_chat_messages_response")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_down_drops_the_tables() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        for table in TABLES {
            assert!(!manager.has_table(table).await.unwrap(), "{table}");
        }
        Migration.down(&manager).await.unwrap();
    }

    /// MySQL refuses an index on a TEXT column without a key length.
    #[test]
    fn test_indexed_columns_are_varchar_on_mysql() {
        let installs = create_installs().to_string(MysqlQueryBuilder);
        let identities = create_identities().to_string(MysqlQueryBuilder);
        let messages = create_messages().to_string(MysqlQueryBuilder);
        for (table, column) in [
            (&installs, "org_id"),
            (&installs, "workspace_id"),
            (&identities, "org_id"),
            (&identities, "workspace_id"),
            (&identities, "user_email"),
            (&identities, "platform_user_id"),
            (&messages, "response_id"),
            (&messages, "channel_id"),
            (&messages, "message_ts"),
        ] {
            assert!(table.contains(&format!("`{column}` varchar(")), "{table}");
        }
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261014_000001_create_oncall_chat_tables"
        );
    }
}
