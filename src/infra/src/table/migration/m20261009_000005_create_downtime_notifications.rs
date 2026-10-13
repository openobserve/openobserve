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

use sea_orm_migration::prelude::*;

const WINDOW_EVENT_IDX: &str = "downtime_notifications_window_event_idx";
const ORG_DOWNTIME_IDX: &str = "downtime_notifications_org_downtime_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_statement()).await?;
        manager.create_index(create_window_event_idx()).await?;
        manager.create_index(create_org_downtime_idx()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [ORG_DOWNTIME_IDX, WINDOW_EVENT_IDX] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(DowntimeNotifications::Table)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(DowntimeNotifications::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum DowntimeNotifications {
    Table,
    Id,
    Org,
    DowntimeId,
    WindowStart,
    Event,
    SentAt,
    Destinations,
    Result,
}

fn create_table_statement() -> TableCreateStatement {
    Table::create()
        .table(DowntimeNotifications::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(DowntimeNotifications::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::DowntimeId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::WindowStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::Event)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::SentAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(DowntimeNotifications::Destinations)
                .json()
                .not_null(),
        )
        .col(ColumnDef::new(DowntimeNotifications::Result).text().null())
        .to_owned()
}

fn create_window_event_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .unique()
        .name(WINDOW_EVENT_IDX)
        .table(DowntimeNotifications::Table)
        .col(DowntimeNotifications::DowntimeId)
        .col(DowntimeNotifications::WindowStart)
        .col(DowntimeNotifications::Event)
        .to_owned()
}

fn create_org_downtime_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ORG_DOWNTIME_IDX)
        .table(DowntimeNotifications::Table)
        .col(DowntimeNotifications::Org)
        .col(DowntimeNotifications::DowntimeId)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectionTrait, Database};
    use sea_orm_migration::MigrationName;

    use super::*;

    const TABLE: &str = "downtime_notifications";

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "downtime_notifications" (
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "downtime_id" char(27) NOT NULL,
                "window_start" bigint NOT NULL,
                "event" varchar(16) NOT NULL,
                "sent_at" bigint NOT NULL,
                "destinations" json NOT NULL,
                "result" text NULL
            )"#
        );
        assert_eq!(
            &create_window_event_idx().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "downtime_notifications_window_event_idx" ON "downtime_notifications" ("downtime_id", "window_start", "event")"#
        );
        assert_eq!(
            &create_org_downtime_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "downtime_notifications_org_downtime_idx" ON "downtime_notifications" ("org", "downtime_id")"#
        );
    }

    #[tokio::test]
    async fn test_up_reruns_and_the_unique_index_refuses_a_second_send() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_table(TABLE).await.unwrap());

        let insert = |id: &str| {
            format!(
                "INSERT INTO downtime_notifications \
                 (id, org, downtime_id, window_start, event, sent_at, destinations) \
                 VALUES ('{id}', 'acme', 'd1', 1, 'start', 2, '[]')"
            )
        };
        db.execute_unprepared(&insert("n1")).await.unwrap();
        assert!(db.execute_unprepared(&insert("n2")).await.is_err());
    }

    #[tokio::test]
    async fn test_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table(TABLE).await.unwrap());
        Migration.down(&manager).await.unwrap();
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261009_000005_create_downtime_notifications"
        );
    }
}
