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

//! Adds alert deduplication columns and creates alert_dedup_state table
//!
//! Note: These columns exist in all builds but the deduplication logic
//! is only available in the enterprise edition. The columns default to disabled.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add deduplication columns to alerts table
        add_dedup_columns(manager).await?;

        // Create alert_dedup_state table
        create_alert_dedup_state_table(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop alert_dedup_state table
        manager
            .drop_table(Table::drop().table(AlertDedupState::Table).to_owned())
            .await?;

        // Drop columns from alerts table
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::DedupEnabled)
                    .drop_column(Alerts::DedupTimeWindowMinutes)
                    .drop_column(Alerts::DedupConfig)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

/// Adds deduplication columns to the alerts table
async fn add_dedup_columns(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let db_backend = manager.get_database_backend();

    if matches!(db_backend, sea_orm::DbBackend::Sqlite) {
        // SQLite doesn't support multiple ALTER operations in one statement
        // Add each column separately
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::DedupEnabled)
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
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::DedupTimeWindowMinutes)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(ColumnDef::new(Alerts::DedupConfig).json().null())
                    .to_owned(),
            )
            .await?;
    } else if matches!(db_backend, sea_orm::DbBackend::MySql) {
        // MySQL doesn't support IF NOT EXISTS in ALTER TABLE
        // But it supports multiple column additions
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column(
                        ColumnDef::new(Alerts::DedupEnabled)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .add_column(
                        ColumnDef::new(Alerts::DedupTimeWindowMinutes)
                            .integer()
                            .null(),
                    )
                    .add_column(ColumnDef::new(Alerts::DedupConfig).json().null())
                    .to_owned(),
            )
            .await?;
    } else {
        // PostgreSQL supports both IF NOT EXISTS and multiple columns
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::DedupEnabled)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::DedupTimeWindowMinutes)
                            .integer()
                            .null(),
                    )
                    .add_column_if_not_exists(ColumnDef::new(Alerts::DedupConfig).json().null())
                    .to_owned(),
            )
            .await?;
    }

    // Create index on dedup_enabled for fast filtering
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alerts_dedup_enabled")
                .table(Alerts::Table)
                .col(Alerts::DedupEnabled)
                .to_owned(),
        )
        .await?;

    Ok(())
}

/// Creates the alert_dedup_state table
async fn create_alert_dedup_state_table(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(AlertDedupState::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(AlertDedupState::Fingerprint)
                        .string_len(64)
                        .not_null()
                        .primary_key(),
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
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_alert_dedup_alert")
                        .from(AlertDedupState::Table, AlertDedupState::AlertId)
                        .to(Alerts::Table, Alerts::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await?;

    // Create index on alert_id for fast lookups
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_dedup_alert_id")
                .table(AlertDedupState::Table)
                .col(AlertDedupState::AlertId)
                .to_owned(),
        )
        .await?;

    // Create index on last_seen_at for cleanup queries
    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name("idx_alert_dedup_last_seen")
                .table(AlertDedupState::Table)
                .col(AlertDedupState::LastSeenAt)
                .to_owned(),
        )
        .await?;

    // Create index on org_id for org-level queries
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

/// Identifiers used in queries on the alerts table
#[derive(DeriveIden)]
enum Alerts {
    Table,
    Id,
    DedupEnabled,
    DedupTimeWindowMinutes,
    DedupConfig,
}

/// Identifiers used in queries on the alert_dedup_state table
#[derive(DeriveIden)]
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
