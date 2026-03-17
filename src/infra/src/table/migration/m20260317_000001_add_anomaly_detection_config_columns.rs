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

//! Adds folder_id and owner columns to the anomaly_detection_config table so
//! that anomaly configs can be organised into folders and attributed to an owner,
//! consistent with the alerts table.
//!
//! folder_id is stored as a varchar slug (e.g. "default"), matching how the rest
//! of the codebase identifies folders. Existing rows are backfilled to "default".

use sea_orm_migration::prelude::*;

const ANOMALY_CONFIG_FOLDER_ID_IDX: &str = "idx_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();

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

        // Backfill existing rows: any config without a folder gets the default folder.
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE anomaly_detection_config SET folder_id = 'default' WHERE folder_id IS NULL",
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
