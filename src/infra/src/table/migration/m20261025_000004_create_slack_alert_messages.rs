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

const FIRING_IDX: &str = "slack_alert_messages_firing_idx";
const PENDING_IDX: &str = "slack_alert_messages_pending_since_idx";
const STATE_IDX: &str = "slack_alert_messages_state_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SlackAlertMessages::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum SlackAlertMessages {
    Table,
    DestinationId,
    OrgId,
    AlertId,
    GroupKey,
    FiringStartedAt,
    InstallationId,
    ChannelId,
    MessageTs,
    DigestTs,
    ReusesFiringStartedAt,
    RefireCount,
    FirstFiredAt,
    State,
    WantedSeq,
    RenderedSeq,
    PendingSince,
    PostingSince,
    LastAutoInvestigatedAt,
    Content,
    CreatedAt,
    UpdatedAt,
    OriginRegion,
    DeletedAt,
}

/// Creates `slack_alert_messages` and its indexes; shared by the migration and the test helper.
pub(super) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    conn.execute(backend.build(&table())).await?;
    for index in indexes() {
        conn.execute(backend.build(&index)).await?;
    }
    Ok(())
}

fn table() -> TableCreateStatement {
    use SlackAlertMessages as T;
    let varchar = |col: T, len: u32| ColumnDef::new(col).string_len(len).not_null().to_owned();
    let bigint = |col: T| ColumnDef::new(col).big_integer().not_null().to_owned();
    let nullable_bigint = |col: T| ColumnDef::new(col).big_integer().null().to_owned();
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::DestinationId, 27))
        .col(varchar(T::OrgId, 256))
        .col(varchar(T::AlertId, 27))
        .col(varchar(T::GroupKey, 256))
        .col(bigint(T::FiringStartedAt))
        .col(varchar(T::InstallationId, 27))
        .col(varchar(T::ChannelId, 32))
        .col(ColumnDef::new(T::MessageTs).string_len(32).null())
        .col(ColumnDef::new(T::DigestTs).string_len(32).null())
        .col(nullable_bigint(T::ReusesFiringStartedAt))
        .col(
            ColumnDef::new(T::RefireCount)
                .integer()
                .not_null()
                .default(0),
        )
        .col(bigint(T::FirstFiredAt))
        .col(varchar(T::State, 16))
        .col(bigint(T::WantedSeq).default(0).to_owned())
        .col(bigint(T::RenderedSeq).default(0).to_owned())
        .col(nullable_bigint(T::PendingSince))
        .col(nullable_bigint(T::PostingSince))
        .col(nullable_bigint(T::LastAutoInvestigatedAt))
        .col(ColumnDef::new(T::Content).text().null())
        .col(bigint(T::CreatedAt))
        .col(bigint(T::UpdatedAt))
        .col(varchar(T::OriginRegion, 64))
        .col(nullable_bigint(T::DeletedAt))
        .primary_key(
            Index::create()
                .name("pk_slack_alert_messages")
                .col(T::DestinationId)
                .col(T::AlertId)
                .col(T::GroupKey)
                .col(T::FiringStartedAt),
        )
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 3] {
    use SlackAlertMessages as T;
    [
        Index::create()
            .if_not_exists()
            .name(FIRING_IDX)
            .table(T::Table)
            .col(T::AlertId)
            .col(T::GroupKey)
            .col(T::FiringStartedAt)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(PENDING_IDX)
            .table(T::Table)
            .col(T::PendingSince)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(STATE_IDX)
            .table(T::Table)
            .col(T::State)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{Database, DbBackend, Statement};

    use super::*;

    #[test]
    fn postgres_table_and_indexes_match_the_spec() {
        collapsed_eq!(
            &table().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "slack_alert_messages" (
                "destination_id" varchar(27) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "alert_id" varchar(27) NOT NULL,
                "group_key" varchar(256) NOT NULL,
                "firing_started_at" bigint NOT NULL,
                "installation_id" varchar(27) NOT NULL,
                "channel_id" varchar(32) NOT NULL,
                "message_ts" varchar(32) NULL,
                "digest_ts" varchar(32) NULL,
                "reuses_firing_started_at" bigint NULL,
                "refire_count" integer NOT NULL DEFAULT 0,
                "first_fired_at" bigint NOT NULL,
                "state" varchar(16) NOT NULL,
                "wanted_seq" bigint NOT NULL DEFAULT 0,
                "rendered_seq" bigint NOT NULL DEFAULT 0,
                "pending_since" bigint NULL,
                "posting_since" bigint NULL,
                "last_auto_investigated_at" bigint NULL,
                "content" text NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "origin_region" varchar(64) NOT NULL,
                "deleted_at" bigint NULL,
                CONSTRAINT "pk_slack_alert_messages" PRIMARY KEY ("destination_id", "alert_id", "group_key", "firing_started_at")
            )"#
        );
        let sql: Vec<String> = indexes()
            .iter()
            .map(|i| i.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            sql,
            [
                r#"CREATE INDEX IF NOT EXISTS "slack_alert_messages_firing_idx" ON "slack_alert_messages" ("alert_id", "group_key", "firing_started_at")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_alert_messages_pending_since_idx" ON "slack_alert_messages" ("pending_since")"#,
                r#"CREATE INDEX IF NOT EXISTS "slack_alert_messages_state_idx" ON "slack_alert_messages" ("state")"#,
            ]
        );
    }

    #[tokio::test]
    async fn up_is_rerunnable_defaults_fill_and_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        for index in [FIRING_IDX, PENDING_IDX, STATE_IDX] {
            assert!(
                manager
                    .has_index("slack_alert_messages", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
        db.execute_unprepared(
            "INSERT INTO slack_alert_messages (destination_id, org_id, alert_id, group_key, \
             firing_started_at, installation_id, channel_id, first_fired_at, state, created_at, \
             updated_at, origin_region) VALUES ('d1', 'acme', 'a1', '', 1, 'i1', 'C1', 1, \
             'firing', 1, 1, 'default')",
        )
        .await
        .unwrap();
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT refire_count, wanted_seq, rendered_seq FROM slack_alert_messages",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "refire_count").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "wanted_seq").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "rendered_seq").unwrap(), 0);
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("slack_alert_messages").await.unwrap());
    }
}
