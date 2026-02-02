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

//! Adds expires_at column to sessions table for proper session expiration handling

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add expires_at column to sessions table
        // Default expiry is configurable via ZO_SESSION_DEFAULT_EXPIRY_HOURS (default: 24 hours)
        // This gives existing sessions time to refresh while preventing indefinite persistence
        // New sessions will have proper expiry set based on JWT token expiry
        let cfg = config::get_config();
        let default_expiry_hours = cfg.auth.session_default_expiry_hours;
        let default_expiry =
            chrono::Utc::now().timestamp_micros() + (default_expiry_hours * 60 * 60 * 1_000_000);

        // MySQL doesn't support IF NOT EXISTS in ALTER TABLE
        // So we use add_column for MySQL and add_column_if_not_exists for others
        if matches!(manager.get_database_backend(), sea_orm::DbBackend::MySql) {
            // For MySQL, we need to check if column exists first to make migration idempotent
            let result = manager
                .alter_table(
                    Table::alter()
                        .table(Sessions::Table)
                        .add_column(
                            ColumnDef::new(Sessions::ExpiresAt)
                                .big_integer()
                                .not_null()
                                .default(default_expiry),
                        )
                        .to_owned(),
                )
                .await;

            // Ignore "Duplicate column" error for idempotency (test retries)
            if let Err(e) = result {
                let err_msg = e.to_string();
                if !err_msg.contains("Duplicate column") {
                    return Err(e);
                }
            }
        } else {
            manager
                .alter_table(
                    Table::alter()
                        .table(Sessions::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Sessions::ExpiresAt)
                                .big_integer()
                                .not_null()
                                .default(default_expiry),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // Create index on expires_at for efficient cleanup queries
        // Use if_not_exists for idempotency
        let result = manager
            .create_index(
                Index::create()
                    .name("idx_sessions_expires_at")
                    .table(Sessions::Table)
                    .col(Sessions::ExpiresAt)
                    .if_not_exists()
                    .to_owned(),
            )
            .await;

        // Ignore "Duplicate key" or "already exists" errors for idempotency (test retries)
        if let Err(e) = result {
            let err_msg = e.to_string();
            if !err_msg.contains("Duplicate key")
                && !err_msg.contains("already exists")
                && !err_msg.contains("duplicate key value")
            {
                return Err(e);
            }
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the index first
        manager
            .drop_index(
                Index::drop()
                    .name("idx_sessions_expires_at")
                    .table(Sessions::Table)
                    .to_owned(),
            )
            .await?;

        // Drop the expires_at column
        manager
            .alter_table(
                Table::alter()
                    .table(Sessions::Table)
                    .drop_column(Sessions::ExpiresAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Sessions {
    Table,
    ExpiresAt,
}
