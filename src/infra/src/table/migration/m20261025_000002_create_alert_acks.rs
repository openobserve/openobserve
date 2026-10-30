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

const ORG_ALERT_IDX: &str = "alert_acks_org_alert_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AlertAcks::Table).if_exists().to_owned())
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AlertAcks {
    Table,
    OrgId,
    AlertId,
    GroupKey,
    FiringStartedAt,
    AckedBy,
    AckedAt,
    AckSource,
    TakenOverFrom,
    UnackedAt,
    UnackedBy,
    UpdatedAt,
}

/// Creates `alert_acks` and its index; shared by the migration and the test helper.
pub(super) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    conn.execute(backend.build(&table())).await?;
    conn.execute(backend.build(&org_alert_index())).await?;
    Ok(())
}

fn table() -> TableCreateStatement {
    use AlertAcks as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(T::AlertId).string_len(27).not_null())
        .col(ColumnDef::new(T::GroupKey).string_len(256).not_null())
        .col(ColumnDef::new(T::FiringStartedAt).big_integer().not_null())
        .col(ColumnDef::new(T::AckedBy).string_len(256).not_null())
        .col(ColumnDef::new(T::AckedAt).big_integer().not_null())
        .col(ColumnDef::new(T::AckSource).string_len(16).not_null())
        .col(ColumnDef::new(T::TakenOverFrom).string_len(256).null())
        .col(ColumnDef::new(T::UnackedAt).big_integer().null())
        .col(ColumnDef::new(T::UnackedBy).string_len(256).null())
        .col(ColumnDef::new(T::UpdatedAt).big_integer().not_null())
        .primary_key(
            Index::create()
                .name("pk_alert_acks")
                .col(T::OrgId)
                .col(T::AlertId)
                .col(T::GroupKey),
        )
        .to_owned()
}

fn org_alert_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ORG_ALERT_IDX)
        .table(AlertAcks::Table)
        .col(AlertAcks::OrgId)
        .col(AlertAcks::AlertId)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::Database;

    use super::*;

    #[test]
    fn postgres_table_and_index_match_the_spec() {
        collapsed_eq!(
            &table().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_acks" (
                "org_id" varchar(256) NOT NULL,
                "alert_id" varchar(27) NOT NULL,
                "group_key" varchar(256) NOT NULL,
                "firing_started_at" bigint NOT NULL,
                "acked_by" varchar(256) NOT NULL,
                "acked_at" bigint NOT NULL,
                "ack_source" varchar(16) NOT NULL,
                "taken_over_from" varchar(256) NULL,
                "unacked_at" bigint NULL,
                "unacked_by" varchar(256) NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "pk_alert_acks" PRIMARY KEY ("org_id", "alert_id", "group_key")
            )"#
        );
        assert_eq!(
            org_alert_index().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "alert_acks_org_alert_idx" ON "alert_acks" ("org_id", "alert_id")"#
        );
    }

    #[tokio::test]
    async fn up_is_rerunnable_and_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_table("alert_acks").await.unwrap());
        assert!(
            manager
                .has_index("alert_acks", ORG_ALERT_IDX)
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("alert_acks").await.unwrap());
    }
}
