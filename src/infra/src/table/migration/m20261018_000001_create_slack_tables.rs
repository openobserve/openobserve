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

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

const LINKS_SLACK_USER_IDX: &str = "external_identity_links_slack_user_idx";
const LINKS_EMAIL_IDX: &str = "external_identity_links_user_email_idx";
const LINKS_INSTALLATION_IDX: &str = "external_identity_links_installation_idx";
const REQUESTS_RATE_IDX: &str = "slack_link_requests_rate_idx";
const REQUESTS_EXPIRES_IDX: &str = "slack_link_requests_expires_at_idx";
const INSTALLATIONS_TEAM_IDX: &str = "slack_installations_team_idx";
const INSTALLATIONS_ORG_IDX: &str = "slack_installations_installed_org_idx";
const CONNECTIONS_ORG_IDX: &str = "slack_org_connections_org_idx";
const CHANNELS_ORG_IDX: &str = "slack_channel_defaults_org_idx";
const THREADS_EXPIRES_IDX: &str = "slack_threads_expires_at_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            ExternalIdentityLinks::Table.into_iden(),
            SlackLinkRequests::Table.into_iden(),
            SlackInstallations::Table.into_iden(),
            SlackOrgConnections::Table.into_iden(),
            SlackChannelDefaults::Table.into_iden(),
            SlackThreads::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum ExternalIdentityLinks {
    Table,
    Id,
    Provider,
    InstallationId,
    ExternalEnterpriseId,
    ExternalTeamId,
    ExternalUserId,
    UserEmail,
    DefaultOrgId,
    LinkMethod,
    CreatedAt,
    LastUsedAt,
    RevokedAt,
    RevokedReason,
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackLinkRequests {
    Table,
    Id,
    InstallationId,
    ExternalUserId,
    WorkspaceUserId,
    ChannelId,
    ThreadTs,
    MessageTs,
    QuestionEnc,
    OidcNonce,
    CreatedAt,
    ExpiresAt,
    RedeemedAt,
    DiscardedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackInstallations {
    Table,
    Id,
    AppId,
    EnterpriseId,
    TeamId,
    TeamName,
    IsEnterpriseInstall,
    BotUserId,
    BotTokenEnc,
    RefreshTokenEnc,
    TokenExpiresAt,
    SigningSecretEnc,
    AppTokenEnc,
    ClientId,
    ClientSecretEnc,
    ConfigRefreshTokenEnc,
    ManifestOptions,
    AutoLinkEnabled,
    AutoLinkDomains,
    Mode,
    Scope,
    OrgAccess,
    HomeRegion,
    InstalledBy,
    InstalledOrgId,
    CreatedAt,
    RevokedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackOrgConnections {
    Table,
    InstallationId,
    OrgId,
    ConnectedBy,
    HelpContact,
    Source,
    CreatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackChannelDefaults {
    Table,
    InstallationId,
    ChannelId,
    ChannelName,
    OrgId,
    AnswerMode,
    SetFrom,
    UpdatedBy,
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackThreads {
    Table,
    InstallationId,
    ChannelId,
    ThreadTs,
    OrgId,
    Kind,
    AssistantSessionId,
    StartedByLinkId,
    SharedUrls,
    BotAnswers,
    CreatedAt,
    LastActivityAt,
    ExpiresAt,
    OrgRemovedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum Replication {
    UpdatedAt,
    OriginRegion,
    DeletedAt,
}

/// Creates the six tables and their indexes; shared by the migration and the test helper.
pub(super) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    for table in tables() {
        conn.execute(backend.build(&table)).await?;
    }
    for index in indexes() {
        conn.execute(backend.build(&index)).await?;
    }
    Ok(())
}

fn tables() -> [TableCreateStatement; 6] {
    [
        links_table(),
        link_requests_table(),
        installations_table(),
        org_connections_table(),
        channel_defaults_table(),
        threads_table(),
    ]
}

fn indexes() -> Vec<IndexCreateStatement> {
    vec![
        index(
            LINKS_SLACK_USER_IDX,
            ExternalIdentityLinks::Table,
            &[
                ExternalIdentityLinks::Provider,
                ExternalIdentityLinks::InstallationId,
                ExternalIdentityLinks::ExternalUserId,
            ],
        )
        .unique()
        .to_owned(),
        index(
            LINKS_EMAIL_IDX,
            ExternalIdentityLinks::Table,
            &[ExternalIdentityLinks::UserEmail],
        ),
        index(
            LINKS_INSTALLATION_IDX,
            ExternalIdentityLinks::Table,
            &[ExternalIdentityLinks::InstallationId],
        ),
        index(
            REQUESTS_RATE_IDX,
            SlackLinkRequests::Table,
            &[
                SlackLinkRequests::InstallationId,
                SlackLinkRequests::ExternalUserId,
                SlackLinkRequests::CreatedAt,
            ],
        ),
        index(
            REQUESTS_EXPIRES_IDX,
            SlackLinkRequests::Table,
            &[SlackLinkRequests::ExpiresAt],
        ),
        index(
            INSTALLATIONS_TEAM_IDX,
            SlackInstallations::Table,
            &[
                SlackInstallations::AppId,
                SlackInstallations::EnterpriseId,
                SlackInstallations::TeamId,
            ],
        )
        .unique()
        .to_owned(),
        index(
            INSTALLATIONS_ORG_IDX,
            SlackInstallations::Table,
            &[SlackInstallations::InstalledOrgId],
        ),
        index(
            CONNECTIONS_ORG_IDX,
            SlackOrgConnections::Table,
            &[SlackOrgConnections::OrgId],
        ),
        index(
            CHANNELS_ORG_IDX,
            SlackChannelDefaults::Table,
            &[SlackChannelDefaults::OrgId],
        ),
        index(
            THREADS_EXPIRES_IDX,
            SlackThreads::Table,
            &[SlackThreads::ExpiresAt],
        ),
    ]
}

fn index<T: IntoIden + Copy + 'static, C: IntoIden + Copy + 'static>(
    name: &str,
    table: T,
    cols: &[C],
) -> IndexCreateStatement {
    let mut stmt = Index::create();
    stmt.if_not_exists().name(name).table(table);
    for col in cols {
        stmt.col(*col);
    }
    stmt
}

fn varchar<T: IntoIden>(col: T, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).not_null().to_owned()
}

fn bigint<T: IntoIden>(col: T) -> ColumnDef {
    ColumnDef::new(col).big_integer().not_null().to_owned()
}

/// The three columns every Slack table keeps so replication needs no migration later.
fn with_replication_columns(table: &mut TableCreateStatement) -> TableCreateStatement {
    table
        .col(bigint(Replication::UpdatedAt))
        .col(varchar(Replication::OriginRegion, 64))
        .col(ColumnDef::new(Replication::DeletedAt).big_integer().null())
        .to_owned()
}

fn links_table() -> TableCreateStatement {
    use ExternalIdentityLinks as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::Id, 27).primary_key())
            .col(varchar(T::Provider, 32))
            .col(varchar(T::InstallationId, 27))
            .col(varchar(T::ExternalEnterpriseId, 32).default(""))
            .col(varchar(T::ExternalTeamId, 32))
            .col(varchar(T::ExternalUserId, 32))
            .col(varchar(T::UserEmail, 256))
            .col(varchar(T::DefaultOrgId, 256))
            .col(varchar(T::LinkMethod, 16))
            .col(bigint(T::CreatedAt))
            .col(bigint(T::LastUsedAt))
            .col(ColumnDef::new(T::RevokedAt).big_integer().null())
            .col(ColumnDef::new(T::RevokedReason).string_len(64).null()),
    )
}

fn link_requests_table() -> TableCreateStatement {
    use SlackLinkRequests as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::Id, 27).primary_key())
            .col(varchar(T::InstallationId, 27))
            .col(varchar(T::ExternalUserId, 32))
            .col(varchar(T::WorkspaceUserId, 32))
            .col(ColumnDef::new(T::ChannelId).string_len(32).null())
            .col(ColumnDef::new(T::ThreadTs).string_len(32).null())
            .col(ColumnDef::new(T::MessageTs).string_len(32).null())
            .col(ColumnDef::new(T::QuestionEnc).text().null())
            .col(ColumnDef::new(T::OidcNonce).string_len(64).null())
            .col(bigint(T::CreatedAt))
            .col(bigint(T::ExpiresAt))
            .col(ColumnDef::new(T::RedeemedAt).big_integer().null())
            .col(ColumnDef::new(T::DiscardedAt).big_integer().null()),
    )
}

fn installations_table() -> TableCreateStatement {
    use SlackInstallations as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::Id, 27).primary_key())
            .col(varchar(T::AppId, 32))
            .col(varchar(T::EnterpriseId, 32).default(""))
            .col(varchar(T::TeamId, 32))
            .col(varchar(T::TeamName, 256))
            .col(ColumnDef::new(T::IsEnterpriseInstall).boolean().not_null())
            .col(ColumnDef::new(T::BotUserId).string_len(32).null())
            .col(ColumnDef::new(T::BotTokenEnc).text().null())
            .col(ColumnDef::new(T::RefreshTokenEnc).text().null())
            .col(ColumnDef::new(T::TokenExpiresAt).big_integer().null())
            .col(ColumnDef::new(T::SigningSecretEnc).text().null())
            .col(ColumnDef::new(T::AppTokenEnc).text().null())
            .col(ColumnDef::new(T::ClientId).string_len(64).null())
            .col(ColumnDef::new(T::ClientSecretEnc).text().null())
            .col(ColumnDef::new(T::ConfigRefreshTokenEnc).text().null())
            .col(
                ColumnDef::new(T::ManifestOptions)
                    .text()
                    .not_null()
                    .default("{}"),
            )
            .col(ColumnDef::new(T::AutoLinkEnabled).boolean().not_null())
            .col(
                ColumnDef::new(T::AutoLinkDomains)
                    .text()
                    .not_null()
                    .default("[]"),
            )
            .col(varchar(T::Mode, 8))
            .col(varchar(T::Scope, 8).default("org"))
            .col(varchar(T::OrgAccess, 8).default(""))
            .col(varchar(T::HomeRegion, 64))
            .col(varchar(T::InstalledBy, 256))
            .col(varchar(T::InstalledOrgId, 256))
            .col(bigint(T::CreatedAt))
            .col(ColumnDef::new(T::RevokedAt).big_integer().null()),
    )
}

fn org_connections_table() -> TableCreateStatement {
    use SlackOrgConnections as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::InstallationId, 27))
            .col(varchar(T::OrgId, 256))
            .col(varchar(T::ConnectedBy, 256))
            .col(ColumnDef::new(T::HelpContact).string_len(256).null())
            .col(varchar(T::Source, 16).default("org"))
            .col(bigint(T::CreatedAt))
            .primary_key(
                Index::create()
                    .name("pk_slack_org_connections")
                    .col(T::InstallationId)
                    .col(T::OrgId),
            ),
    )
}

fn channel_defaults_table() -> TableCreateStatement {
    use SlackChannelDefaults as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::InstallationId, 27))
            .col(varchar(T::ChannelId, 32))
            .col(varchar(T::ChannelName, 128))
            .col(varchar(T::OrgId, 256))
            .col(varchar(T::AnswerMode, 8))
            .col(varchar(T::SetFrom, 16))
            .col(varchar(T::UpdatedBy, 256))
            .primary_key(
                Index::create()
                    .name("pk_slack_channel_defaults")
                    .col(T::InstallationId)
                    .col(T::ChannelId),
            ),
    )
}

fn threads_table() -> TableCreateStatement {
    use SlackThreads as T;
    with_replication_columns(
        Table::create()
            .table(T::Table)
            .if_not_exists()
            .col(varchar(T::InstallationId, 27))
            .col(varchar(T::ChannelId, 32))
            .col(varchar(T::ThreadTs, 32))
            .col(varchar(T::OrgId, 256))
            .col(varchar(T::Kind, 8))
            .col(varchar(T::AssistantSessionId, 36))
            .col(ColumnDef::new(T::StartedByLinkId).string_len(27).null())
            .col(ColumnDef::new(T::SharedUrls).text().null())
            .col(ColumnDef::new(T::BotAnswers).text().null())
            .col(bigint(T::CreatedAt))
            .col(bigint(T::LastActivityAt))
            .col(bigint(T::ExpiresAt))
            .col(ColumnDef::new(T::OrgRemovedAt).big_integer().null())
            .primary_key(
                Index::create()
                    .name("pk_slack_threads")
                    .col(T::InstallationId)
                    .col(T::ChannelId)
                    .col(T::ThreadTs),
            ),
    )
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{Database, DbBackend, Statement};

    use super::*;

    const TABLE_NAMES: [&str; 6] = [
        "external_identity_links",
        "slack_link_requests",
        "slack_installations",
        "slack_org_connections",
        "slack_channel_defaults",
        "slack_threads",
    ];

    #[test]
    fn postgres_tables_match_the_spec() {
        let [
            links,
            requests,
            installations,
            connections,
            channels,
            threads,
        ] = tables();
        collapsed_eq!(
            &links.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "external_identity_links" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "provider" varchar(32) NOT NULL,
                "installation_id" varchar(27) NOT NULL,
                "external_enterprise_id" varchar(32) NOT NULL DEFAULT '',
                "external_team_id" varchar(32) NOT NULL,
                "external_user_id" varchar(32) NOT NULL,
                "user_email" varchar(256) NOT NULL,
                "default_org_id" varchar(256) NOT NULL,
                "link_method" varchar(16) NOT NULL,
                "created_at" bigint NOT NULL,
                "last_used_at" bigint NOT NULL,
                "revoked_at" bigint NULL,
                "revoked_reason" varchar(64) NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL
            )"#
        );
        collapsed_eq!(
            &requests.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_link_requests" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "installation_id" varchar(27) NOT NULL,
                "external_user_id" varchar(32) NOT NULL,
                "workspace_user_id" varchar(32) NOT NULL,
                "channel_id" varchar(32) NULL,
                "thread_ts" varchar(32) NULL,
                "message_ts" varchar(32) NULL,
                "question_enc" text NULL,
                "oidc_nonce" varchar(64) NULL,
                "created_at" bigint NOT NULL,
                "expires_at" bigint NOT NULL,
                "redeemed_at" bigint NULL,
                "discarded_at" bigint NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL
            )"#
        );
        collapsed_eq!(
            &installations.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_installations" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "app_id" varchar(32) NOT NULL,
                "enterprise_id" varchar(32) NOT NULL DEFAULT '',
                "team_id" varchar(32) NOT NULL,
                "team_name" varchar(256) NOT NULL,
                "is_enterprise_install" bool NOT NULL,
                "bot_user_id" varchar(32) NULL,
                "bot_token_enc" text NULL,
                "refresh_token_enc" text NULL,
                "token_expires_at" bigint NULL,
                "signing_secret_enc" text NULL,
                "app_token_enc" text NULL,
                "client_id" varchar(64) NULL,
                "client_secret_enc" text NULL,
                "config_refresh_token_enc" text NULL,
                "manifest_options" text NOT NULL DEFAULT '{}',
                "auto_link_enabled" bool NOT NULL,
                "auto_link_domains" text NOT NULL DEFAULT '[]',
                "mode" varchar(8) NOT NULL,
                "scope" varchar(8) NOT NULL DEFAULT 'org',
                "org_access" varchar(8) NOT NULL DEFAULT '',
                "home_region" varchar(64) NOT NULL,
                "installed_by" varchar(256) NOT NULL,
                "installed_org_id" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "revoked_at" bigint NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL
            )"#
        );
        collapsed_eq!(
            &connections.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_org_connections" (
                "installation_id" varchar(27) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "connected_by" varchar(256) NOT NULL,
                "help_contact" varchar(256) NULL,
                "source" varchar(16) NOT NULL DEFAULT 'org',
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL,
                CONSTRAINT "pk_slack_org_connections" PRIMARY KEY ("installation_id", "org_id")
            )"#
        );
        collapsed_eq!(
            &channels.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_channel_defaults" (
                "installation_id" varchar(27) NOT NULL,
                "channel_id" varchar(32) NOT NULL,
                "channel_name" varchar(128) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "answer_mode" varchar(8) NOT NULL,
                "set_from" varchar(16) NOT NULL,
                "updated_by" varchar(256) NOT NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL,
                CONSTRAINT "pk_slack_channel_defaults" PRIMARY KEY ("installation_id", "channel_id")
            )"#
        );
        collapsed_eq!(
            &threads.to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_threads" (
                "installation_id" varchar(27) NOT NULL,
                "channel_id" varchar(32) NOT NULL,
                "thread_ts" varchar(32) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "kind" varchar(8) NOT NULL,
                "assistant_session_id" varchar(36) NOT NULL,
                "started_by_link_id" varchar(27) NULL,
                "shared_urls" text NULL,
                "bot_answers" text NULL,
                "created_at" bigint NOT NULL,
                "last_activity_at" bigint NOT NULL,
                "expires_at" bigint NOT NULL,
                "org_removed_at" bigint NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL,
                CONSTRAINT "pk_slack_threads" PRIMARY KEY ("installation_id", "channel_id", "thread_ts")
            )"#
        );
    }

    #[test]
    fn postgres_indexes_match_the_spec() {
        let sql: Vec<String> = indexes()
            .iter()
            .map(|i| i.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            sql,
            [
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "external_identity_links_slack_user_idx" ON "external_identity_links" ("provider", "installation_id", "external_user_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "external_identity_links_user_email_idx" ON "external_identity_links" ("user_email")"#,
                r#"CREATE INDEX IF NOT EXISTS "external_identity_links_installation_idx" ON "external_identity_links" ("installation_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_link_requests_rate_idx" ON "slack_link_requests" ("installation_id", "external_user_id", "created_at")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_link_requests_expires_at_idx" ON "slack_link_requests" ("expires_at")"#,
                r#"CREATE UNIQUE INDEX IF NOT EXISTS "slack_installations_team_idx" ON "slack_installations" ("app_id", "enterprise_id", "team_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_installations_installed_org_idx" ON "slack_installations" ("installed_org_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_org_connections_org_idx" ON "slack_org_connections" ("org_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_channel_defaults_org_idx" ON "slack_channel_defaults" ("org_id")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_threads_expires_at_idx" ON "slack_threads" ("expires_at")"#,
            ]
        );
    }

    #[tokio::test]
    async fn up_is_rerunnable_and_down_drops_every_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        for table in TABLE_NAMES {
            assert!(manager.has_table(table).await.unwrap(), "{table}");
            for column in ["updated_at", "origin_region", "deleted_at"] {
                assert!(manager.has_column(table, column).await.unwrap(), "{table}");
            }
        }
        Migration.down(&manager).await.unwrap();
        for table in TABLE_NAMES {
            assert!(!manager.has_table(table).await.unwrap(), "{table}");
        }
    }

    #[tokio::test]
    async fn sqlite_defaults_fill_the_optional_columns() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_all(&db).await.unwrap();
        db.execute_unprepared(
            "INSERT INTO slack_installations (id, app_id, team_id, team_name, \
             is_enterprise_install, auto_link_enabled, mode, home_region, installed_by, \
             installed_org_id, created_at, updated_at, origin_region) \
             VALUES ('i1', 'A1', 'T1', 'Acme', false, true, 'http', 'default', 'a@b.c', 'org', \
             1, 1, 'default')",
        )
        .await
        .unwrap();
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT enterprise_id, manifest_options, auto_link_domains, scope, org_access \
                 FROM slack_installations WHERE id = 'i1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "enterprise_id").unwrap(), "");
        assert_eq!(row.try_get::<String>("", "manifest_options").unwrap(), "{}");
        assert_eq!(
            row.try_get::<String>("", "auto_link_domains").unwrap(),
            "[]"
        );
        assert_eq!(row.try_get::<String>("", "scope").unwrap(), "org");
        assert_eq!(row.try_get::<String>("", "org_access").unwrap(), "");
        db.execute_unprepared(
            "INSERT INTO slack_org_connections (installation_id, org_id, connected_by, \
             created_at, updated_at, origin_region) VALUES ('i1', 'org', 'a@b.c', 1, 1, 'default')",
        )
        .await
        .unwrap();
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT source FROM slack_org_connections WHERE installation_id = 'i1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "source").unwrap(), "org");
    }
}
