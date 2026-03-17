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

//! Adds folder_id, owner, total_evaluations, and firing_count columns to the
//! anomaly_detection_config table so that anomaly configs can be managed
//! alongside alerts (folders, ownership, and evaluation statistics).

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
                                .big_integer()
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
                            ColumnDef::new(AnomalyDetectionConfig::TotalEvaluations)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::FiringCount)
                                .big_integer()
                                .not_null()
                                .default(0),
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
                                .big_integer()
                                .null(),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::Owner)
                                .string_len(256)
                                .null(),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::TotalEvaluations)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .add_column_if_not_exists(
                            ColumnDef::new(AnomalyDetectionConfig::FiringCount)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        }

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
            .drop_index(
                Index::drop()
                    .name(ANOMALY_CONFIG_FOLDER_ID_IDX)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(AnomalyDetectionConfig::Table)
                    .drop_column(AnomalyDetectionConfig::FolderId)
                    .drop_column(AnomalyDetectionConfig::Owner)
                    .drop_column(AnomalyDetectionConfig::TotalEvaluations)
                    .drop_column(AnomalyDetectionConfig::FiringCount)
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
    TotalEvaluations,
    FiringCount,
}
