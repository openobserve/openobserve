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

//! Keys `alert_dedup_state` by `(org_id, fingerprint)`: the fingerprint carries no org.

use sea_orm::{ConnectionTrait, DbBackend, TransactionTrait};
use sea_orm_migration::prelude::*;

const OLD_TABLE: &str = "alert_dedup_state_old";
const ORG_INDEX: &str = "idx_alert_dedup_org_id";
const COLUMNS: &str = "fingerprint, alert_id, org_id, first_seen_at, last_seen_at, \
                       occurrence_count, notification_sent, created_at";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        set_primary_key(
            manager,
            &[AlertDedupState::OrgId, AlertDedupState::Fingerprint],
        )
        .await?;
        // The key now leads with org_id, so this index only adds write cost.
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(ORG_INDEX)
                    .table(AlertDedupState::Table)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Orgs may now share a fingerprint; the rows are a short-lived cache, so drop them all.
        manager
            .get_connection()
            .execute_unprepared("DELETE FROM alert_dedup_state")
            .await?;
        set_primary_key(manager, &[AlertDedupState::Fingerprint]).await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(ORG_INDEX)
                    .table(AlertDedupState::Table)
                    .col(AlertDedupState::OrgId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AlertDedupState {
    Table,
    Fingerprint,
    AlertId,
    OrgId,
    FirstSeenAt,
    LastSeenAt,
    OccurrenceCount,
    NotificationSent,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    Id,
}

async fn set_primary_key(
    manager: &SchemaManager<'_>,
    key: &[AlertDedupState],
) -> Result<(), DbErr> {
    if manager.get_database_backend() == DbBackend::Postgres {
        let columns = key
            .iter()
            .map(|column| column.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE alert_dedup_state DROP CONSTRAINT alert_dedup_state_pkey, \
                 ADD PRIMARY KEY ({columns})"
            ))
            .await?;
        return Ok(());
    }

    // SQLite can't alter a PK; rebuild in a transaction, which the migrator gives only Postgres.
    let txn = manager.get_connection().begin().await?;
    let schema = SchemaManager::new(&txn);
    schema
        .rename_table(
            Table::rename()
                .table(AlertDedupState::Table, Alias::new(OLD_TABLE))
                .to_owned(),
        )
        .await?;
    schema.create_table(create_table(key)).await?;
    txn.execute_unprepared(&format!(
        "INSERT INTO alert_dedup_state ({COLUMNS}) SELECT {COLUMNS} FROM {OLD_TABLE}"
    ))
    .await?;
    schema
        .drop_table(Table::drop().table(Alias::new(OLD_TABLE)).to_owned())
        .await?;
    for (name, column) in [
        ("idx_alert_dedup_alert_id", AlertDedupState::AlertId),
        ("idx_alert_dedup_last_seen", AlertDedupState::LastSeenAt),
    ] {
        schema
            .create_index(
                Index::create()
                    .name(name)
                    .table(AlertDedupState::Table)
                    .col(column)
                    .to_owned(),
            )
            .await?;
    }
    txn.commit().await
}

fn create_table(key: &[AlertDedupState]) -> TableCreateStatement {
    let mut primary_key = Index::create();
    for column in key {
        primary_key.col(*column);
    }
    Table::create()
        .table(AlertDedupState::Table)
        .col(
            ColumnDef::new(AlertDedupState::Fingerprint)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertDedupState::AlertId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertDedupState::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertDedupState::FirstSeenAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertDedupState::LastSeenAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertDedupState::OccurrenceCount)
                .big_integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(AlertDedupState::NotificationSent)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AlertDedupState::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(&mut primary_key)
        .foreign_key(
            ForeignKey::create()
                .name("fk_alert_dedup_alert")
                .from(AlertDedupState::Table, AlertDedupState::AlertId)
                .to(Alerts::Table, Alerts::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, EntityTrait, Statement};

    use super::*;
    use crate::table::entity::alert_dedup_state;

    type ColumnInfo = (String, String, i32, Option<String>);

    async fn db_with_original_table() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE alerts (id CHAR(27) PRIMARY KEY)",
            "INSERT INTO alerts (id) VALUES ('alert_a'), ('alert_b')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        super::super::m20251024_000001_add_alert_deduplication::Migration
            .up(&SchemaManager::new(&db))
            .await
            .unwrap();
        db
    }

    async fn insert(db: &DatabaseConnection, org: &str, alert: &str) -> Result<(), DbErr> {
        db.execute_unprepared(&format!(
            "INSERT INTO alert_dedup_state ({COLUMNS}) \
             VALUES ('fp', '{alert}', '{org}', 1, 2, 3, true, 4)"
        ))
        .await
        .map(|_| ())
    }

    async fn columns(db: &DatabaseConnection) -> Vec<ColumnInfo> {
        db.query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name, type, \"notnull\", dflt_value \
             FROM pragma_table_info('alert_dedup_state') ORDER BY cid",
        ))
        .await
        .unwrap()
        .iter()
        .map(|row| {
            (
                row.try_get_by_index(0).unwrap(),
                row.try_get_by_index(1).unwrap(),
                row.try_get_by_index(2).unwrap(),
                row.try_get_by_index(3).unwrap(),
            )
        })
        .collect()
    }

    #[tokio::test]
    async fn test_up_lets_two_orgs_share_a_fingerprint() {
        let db = db_with_original_table().await;
        insert(&db, "org_a", "alert_a").await.unwrap();
        assert!(insert(&db, "org_b", "alert_b").await.is_err());

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        insert(&db, "org_b", "alert_b").await.unwrap();
        assert!(insert(&db, "org_a", "alert_a").await.is_err());
        let kept = alert_dedup_state::Entity::find_by_id(("org_a".to_string(), "fp".to_string()))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                kept.alert_id.as_str(),
                kept.first_seen_at,
                kept.last_seen_at,
                kept.occurrence_count,
                kept.notification_sent,
                kept.created_at
            ),
            ("alert_a", 1, 2, 3, true, 4)
        );
    }

    #[tokio::test]
    async fn test_up_keeps_columns_indexes_and_foreign_key() {
        let db = db_with_original_table().await;
        let manager = SchemaManager::new(&db);
        let original = columns(&db).await;

        Migration.up(&manager).await.unwrap();

        assert_eq!(columns(&db).await, original);
        for index in ["idx_alert_dedup_alert_id", "idx_alert_dedup_last_seen"] {
            assert!(manager.has_index("alert_dedup_state", index).await.unwrap());
        }
        assert!(
            !manager
                .has_index("alert_dedup_state", ORG_INDEX)
                .await
                .unwrap()
        );
        assert!(!manager.has_table(OLD_TABLE).await.unwrap());
        assert!(insert(&db, "org_a", "no_such_alert").await.is_err());
    }

    #[tokio::test]
    async fn test_down_restores_fingerprint_key() {
        let db = db_with_original_table().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        insert(&db, "org_a", "alert_a").await.unwrap();
        insert(&db, "org_b", "alert_b").await.unwrap();

        Migration.down(&manager).await.unwrap();

        insert(&db, "org_a", "alert_a").await.unwrap();
        assert!(insert(&db, "org_b", "alert_b").await.is_err());
        assert!(
            manager
                .has_index("alert_dedup_state", ORG_INDEX)
                .await
                .unwrap()
        );
    }
}
