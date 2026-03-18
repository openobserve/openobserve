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

//! Adds folder_id, owner, and alert_destinations columns to the
//! anomaly_detection_config table and removes the old alert_destination_id column.
//!
//! - folder_id (varchar 256): stores the folders.id PK (same FK as alerts table).
//!   Existing rows are backfilled from the "default" folder for each org.
//! - owner (varchar 256): nullable, attributed owner of the config.
//! - alert_destinations (text): JSON array of destination names, replacing the
//!   old single-value alert_destination_id column. Existing rows are migrated
//!   by wrapping the old value in a JSON array.

use sea_orm_migration::prelude::*;

const ANOMALY_CONFIG_FOLDER_ID_IDX: &str = "idx_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();

        // --- Add folder_id, owner, alert_destinations columns ---
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

            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::AlertDestinations)
                                .text()
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
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::AlertDestinations)
                                .text()
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

        // Migrate alert_destination_id → alert_destinations JSON array.
        let migrate_sql = match db_backend {
            sea_orm::DbBackend::Sqlite => {
                "UPDATE anomaly_detection_config \
                 SET alert_destinations = json_array(alert_destination_id) \
                 WHERE alert_destination_id IS NOT NULL AND alert_destinations IS NULL"
            }
            sea_orm::DbBackend::Postgres => {
                "UPDATE anomaly_detection_config \
                 SET alert_destinations = json_build_array(alert_destination_id)::text \
                 WHERE alert_destination_id IS NOT NULL AND alert_destinations IS NULL"
            }
            sea_orm::DbBackend::MySql => {
                "UPDATE anomaly_detection_config \
                 SET alert_destinations = JSON_ARRAY(alert_destination_id) \
                 WHERE alert_destination_id IS NOT NULL AND alert_destinations IS NULL"
            }
        };
        manager
            .get_connection()
            .execute_unprepared(migrate_sql)
            .await?;

        // Drop the old single-destination column.
        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .drop_column(AnomalyDetectionConfig::AlertDestinationId)
                    .to_owned(),
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

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();

        manager
            .drop_index(Index::drop().name(ANOMALY_CONFIG_FOLDER_ID_IDX).to_owned())
            .await?;

        // Re-add the old column and restore the first destination.
        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AnomalyDetectionConfig::AlertDestinationId)
                            .string_len(100)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        let restore_sql = match db_backend {
            sea_orm::DbBackend::Sqlite => {
                "UPDATE anomaly_detection_config \
                 SET alert_destination_id = json_extract(alert_destinations, '$[0]') \
                 WHERE alert_destinations IS NOT NULL"
            }
            sea_orm::DbBackend::Postgres => {
                "UPDATE anomaly_detection_config \
                 SET alert_destination_id = alert_destinations::json->>0 \
                 WHERE alert_destinations IS NOT NULL"
            }
            sea_orm::DbBackend::MySql => {
                "UPDATE anomaly_detection_config \
                 SET alert_destination_id = JSON_UNQUOTE(JSON_EXTRACT(alert_destinations, '$[0]')) \
                 WHERE alert_destinations IS NOT NULL"
            }
        };
        manager
            .get_connection()
            .execute_unprepared(restore_sql)
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .drop_column(AnomalyDetectionConfig::FolderId)
                    .drop_column(AnomalyDetectionConfig::Owner)
                    .drop_column(AnomalyDetectionConfig::AlertDestinations)
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
    AlertDestinationId,
    AlertDestinations,
}
