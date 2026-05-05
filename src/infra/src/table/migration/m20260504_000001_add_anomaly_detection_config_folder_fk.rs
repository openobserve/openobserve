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

//! Adds the missing FOREIGN KEY constraint on `anomaly_detection_config.folder_id → folders.id`.
//!
//! `alerts` and `dashboards` both define this FK at table-creation time. This migration
//! retrofits the same referential-integrity guarantee for anomaly detection configs.
//!
//! - No `ON DELETE` action → defaults to RESTRICT (same as alerts, dashboards). Folder deletion is
//!   blocked while any anomaly configs still reference it.
//!
//! - SQLite: cannot add FK constraints to existing tables via ALTER TABLE. SQLite is dev-only; this
//!   migration is a no-op there.
//!
//! - Idempotent: checks `information_schema.table_constraints` before adding.

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;

const FK_NAME: &str = "fk_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        match manager.get_database_backend() {
            sea_orm::DbBackend::Sqlite => {
                // SQLite does not support ALTER TABLE ADD CONSTRAINT FOREIGN KEY.
            }
            sea_orm::DbBackend::Postgres => {
                if !fk_exists(manager).await? {
                    manager
                        .get_connection()
                        .execute_unprepared(&format!(
                            "ALTER TABLE anomaly_detection_config \
                             ADD CONSTRAINT {FK_NAME} \
                             FOREIGN KEY (folder_id) REFERENCES folders(id)"
                        ))
                        .await?;
                }
            }
            sea_orm::DbBackend::MySql => {}
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        match manager.get_database_backend() {
            sea_orm::DbBackend::Sqlite | sea_orm::DbBackend::MySql => {}
            sea_orm::DbBackend::Postgres => {
                manager
                    .get_connection()
                    .execute_unprepared(&format!(
                        "ALTER TABLE anomaly_detection_config \
                         DROP CONSTRAINT IF EXISTS {FK_NAME}"
                    ))
                    .await?;
            }
        }
        Ok(())
    }
}

async fn fk_exists(manager: &SchemaManager<'_>) -> Result<bool, DbErr> {
    let row = manager
        .get_connection()
        .query_one(Statement::from_string(
            sea_orm::DbBackend::Postgres,
            format!(
                "SELECT COUNT(*) AS cnt FROM information_schema.table_constraints \
                 WHERE constraint_name = '{FK_NAME}' \
                 AND table_name = 'anomaly_detection_config'"
            ),
        ))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0) > 0)
        .unwrap_or(false))
}
