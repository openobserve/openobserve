// Copyright 2025 OpenObserve Inc.
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

//! Simplifies alert deduplication schema for semantic field groups
//!
//! This migration:
//! 1. Drops `dedup_time_window_minutes` column from alerts table (now in JSON)
//! 2. Drops `notification_sent`, `created_at`, `org_id` columns from alert_dedup_state table
//! 3. Drops related indexes that are no longer needed

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop columns from alerts table
        drop_alerts_columns(manager).await?;

        // Drop columns and indexes from alert_dedup_state table
        drop_alert_dedup_state_columns(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Re-add dedup_time_window_minutes to alerts table
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::DedupTimeWindowMinutes)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Re-add dropped columns to alert_dedup_state
        let db_backend = manager.get_database_backend();

        if matches!(db_backend, sea_orm::DbBackend::Sqlite) {
            // SQLite requires separate ALTER statements
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertDedupState::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::OrgId)
                                .string_len(100)
                                .not_null()
                                .default(""),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(AlertDedupState::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::NotificationSent)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(AlertDedupState::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::CreatedAt)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        } else {
            // MySQL and PostgreSQL can add multiple columns
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertDedupState::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::OrgId)
                                .string_len(100)
                                .not_null()
                                .default(""),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::NotificationSent)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AlertDedupState::CreatedAt)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // Re-create org_id index
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_alert_dedup_org_id")
                    .table(AlertDedupState::Table)
                    .col(AlertDedupState::OrgId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

/// Drops dedup_time_window_minutes column from alerts table
async fn drop_alerts_columns(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let db_backend = manager.get_database_backend();

    // Check if column exists before dropping (for idempotency)
    if matches!(db_backend, sea_orm::DbBackend::Sqlite) {
        // SQLite doesn't support DROP COLUMN directly
        // We need to recreate the table without the column
        // For now, we'll skip this for SQLite (column will remain but unused)
        log::warn!("SQLite detected: dedup_time_window_minutes column will remain but is unused");
    } else {
        // MySQL and PostgreSQL support DROP COLUMN
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::DedupTimeWindowMinutes)
                    .to_owned(),
            )
            .await?;
    }

    Ok(())
}

/// Drops unnecessary columns and indexes from alert_dedup_state table
async fn drop_alert_dedup_state_columns(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let db_backend = manager.get_database_backend();

    // Drop org_id index first (if it exists)
    let _ = manager
        .drop_index(
            Index::drop()
                .name("idx_alert_dedup_org_id")
                .table(AlertDedupState::Table)
                .to_owned(),
        )
        .await;

    if matches!(db_backend, sea_orm::DbBackend::Sqlite) {
        // SQLite doesn't support DROP COLUMN directly
        // We need to recreate the table
        log::warn!("SQLite detected: alert_dedup_state columns will remain but are unused");
    } else {
        // MySQL and PostgreSQL support DROP COLUMN
        manager
            .alter_table(
                Table::alter()
                    .table(AlertDedupState::Table)
                    .drop_column(AlertDedupState::OrgId)
                    .drop_column(AlertDedupState::NotificationSent)
                    .drop_column(AlertDedupState::CreatedAt)
                    .to_owned(),
            )
            .await?;
    }

    Ok(())
}

/// Identifiers used in queries on the alerts table
#[derive(DeriveIden)]
enum Alerts {
    Table,
    DedupTimeWindowMinutes,
}

/// Identifiers used in queries on the alert_dedup_state table
#[derive(DeriveIden)]
enum AlertDedupState {
    Table,
    OrgId,
    NotificationSent,
    CreatedAt,
}
