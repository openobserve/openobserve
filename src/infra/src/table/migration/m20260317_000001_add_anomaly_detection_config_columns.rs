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

//! Adds folder_id and owner columns to the anomaly_detection_config table.
//!
//! - folder_id (varchar 256, NOT NULL): stores the folders.id PK (same FK as alerts table).
//!   Existing rows are backfilled from the "default" Alerts folder for each org. Then the column
//!   is made NOT NULL, consistent with the alerts table.
//! - owner (varchar 256): nullable, attributed owner of the config.
//!
//! Note: alert_destinations is already present in the CREATE TABLE statement
//! (m20260310_000001_create_anomaly_detection_config_table), so it is not added here.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

const ANOMALY_CONFIG_FOLDER_ID_IDX: &str = "idx_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();

        // --- Add folder_id and owner columns ---
        // alert_destinations is already created by m20260310_000001_create_anomaly_detection_config_table.
        if matches!(db_backend, sea_orm::DbBackend::Sqlite) {
            // SQLite requires separate ALTER TABLE statements per column.
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::FolderId)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::Owner)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        } else {
            // PostgreSQL and MySQL support multiple ADD COLUMN IF NOT EXISTS in one statement.
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::FolderId)
                                .string_len(256)
                                .null(),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::Owner)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // Backfill folder_id: resolve "default" slug to the folder PK.
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE anomaly_detection_config \
                 SET folder_id = (\
                   SELECT id FROM folders \
                   WHERE folders.org = anomaly_detection_config.org_id \
                   AND folders.folder_id = 'default' \
                   AND folders.type = 1\
                 ) \
                 WHERE folder_id IS NULL",
            )
            .await?;

        // Index on folder_id for fast folder-based filtering.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(ANOMALY_CONFIG_FOLDER_ID_IDX)
                    .table(AnomalyDetectionConfig::Table)
                    .col(AnomalyDetectionConfig::FolderId)
                    .to_owned(),
            )
            .await?;

        // Make folder_id NOT NULL, consistent with the alerts table.
        // The backfill above ensures no NULLs remain.
        // SQLite does not support changing nullability in-place; the backfill is
        // sufficient for SQLite dev environments.
        match db_backend {
            sea_orm::DbBackend::Postgres => {
                manager
                    .get_connection()
                    .execute_unprepared(
                        "ALTER TABLE anomaly_detection_config \
                         ALTER COLUMN folder_id SET NOT NULL",
                    )
                    .await?;
            }
            sea_orm::DbBackend::MySql => {
                manager
                    .get_connection()
                    .execute_unprepared(
                        "ALTER TABLE anomaly_detection_config \
                         MODIFY COLUMN folder_id VARCHAR(256) NOT NULL",
                    )
                    .await?;
            }
            sea_orm::DbBackend::Sqlite => {}
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(ANOMALY_CONFIG_FOLDER_ID_IDX).to_owned())
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .drop_column(AnomalyDetectionConfig::FolderId)
                    .drop_column(AnomalyDetectionConfig::Owner)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum AnomalyDetectionConfig {
    Table,
    FolderId,
    Owner,
}
