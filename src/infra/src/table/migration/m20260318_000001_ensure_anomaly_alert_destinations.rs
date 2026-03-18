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

//! Ensures the `alert_destinations` column exists on `anomaly_detection_config`.
//!
//! This migration exists because m20260317 was deployed in a broken intermediate form
//! that added folder_id/owner but skipped adding alert_destinations. Environments
//! that ran that intermediate migration will have the column missing even though
//! m20260317 is recorded as applied in sea_orm_migrations.
//!
//! This migration is idempotent: it is a no-op for fresh installs and for
//! environments that ran the corrected m20260317.

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn column_exists(manager: &SchemaManager<'_>, column: &str) -> Result<bool, DbErr> {
    let db_backend = manager.get_database_backend();
    let sql = match db_backend {
        sea_orm::DbBackend::Sqlite => format!(
            "SELECT COUNT(*) AS cnt FROM pragma_table_info('anomaly_detection_config') \
             WHERE name = '{column}'"
        ),
        sea_orm::DbBackend::Postgres => format!(
            "SELECT COUNT(*) AS cnt FROM information_schema.columns \
             WHERE table_name = 'anomaly_detection_config' AND column_name = '{column}'"
        ),
        sea_orm::DbBackend::MySql => format!(
            "SELECT COUNT(*) AS cnt FROM information_schema.columns \
             WHERE table_name = 'anomaly_detection_config' \
             AND column_name = '{column}' AND table_schema = DATABASE()"
        ),
    };
    let row = manager
        .get_connection()
        .query_one(Statement::from_string(db_backend, sql))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0) > 0)
        .unwrap_or(false))
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();

        let has_new_col = column_exists(manager, "alert_destinations").await?;
        let has_old_col = column_exists(manager, "alert_destination_id").await?;

        // Nothing to do — column already exists.
        if has_new_col {
            return Ok(());
        }

        // Add the column.
        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .add_column(
                        ColumnDef::new(AnomalyDetectionConfig::AlertDestinations)
                            .json_binary()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Migrate data from the old column if it still exists.
        if has_old_col {
            let migrate_sql = match db_backend {
                sea_orm::DbBackend::Sqlite => {
                    "UPDATE anomaly_detection_config \
                     SET alert_destinations = json_array(alert_destination_id) \
                     WHERE alert_destination_id IS NOT NULL"
                }
                sea_orm::DbBackend::Postgres => {
                    "UPDATE anomaly_detection_config \
                     SET alert_destinations = json_build_array(alert_destination_id) \
                     WHERE alert_destination_id IS NOT NULL"
                }
                sea_orm::DbBackend::MySql => {
                    "UPDATE anomaly_detection_config \
                     SET alert_destinations = JSON_ARRAY(alert_destination_id) \
                     WHERE alert_destination_id IS NOT NULL"
                }
            };
            manager
                .get_connection()
                .execute_unprepared(migrate_sql)
                .await?;

            let drop_sql = match db_backend {
                sea_orm::DbBackend::Sqlite => {
                    "ALTER TABLE anomaly_detection_config DROP COLUMN alert_destination_id"
                }
                sea_orm::DbBackend::Postgres | sea_orm::DbBackend::MySql => {
                    "ALTER TABLE anomaly_detection_config \
                     DROP COLUMN IF EXISTS alert_destination_id"
                }
            };
            manager
                .get_connection()
                .execute_unprepared(drop_sql)
                .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Only drop if the column exists (idempotent down).
        if column_exists(manager, "alert_destinations").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .drop_column(AnomalyDetectionConfig::AlertDestinations)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AnomalyDetectionConfig {
    Table,
    AlertDestinations,
}
