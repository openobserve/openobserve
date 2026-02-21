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

use sea_orm_migration::prelude::*;

use super::m20260216_000001_create_anomaly_detection_config_table::AnomalyDetectionConfig;

const ANOMALY_MODELS_LATEST_IDX: &str = "idx_models_latest";
const ANOMALY_MODELS_CONFIG_FK: &str = "fk_anomaly_models_config";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_anomaly_detection_models_table_stmt())
            .await?;
        manager
            .create_index(create_anomaly_models_latest_idx_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(ANOMALY_MODELS_LATEST_IDX).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(AnomalyDetectionModels::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_anomaly_detection_models_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(AnomalyDetectionModels::Table)
        .if_not_exists()
        // Primary Key (composite)
        .col(
            ColumnDef::new(AnomalyDetectionModels::ConfigId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionModels::Version)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AnomalyDetectionModels::ConfigId)
                .col(AnomalyDetectionModels::Version),
        )
        // S3 Storage
        .col(
            ColumnDef::new(AnomalyDetectionModels::S3Path)
                .string_len(500)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionModels::S3Bucket)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionModels::ModelSizeBytes)
                .big_integer()
                .not_null(),
        )
        // Training Metadata
        .col(
            ColumnDef::new(AnomalyDetectionModels::TrainingStartTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionModels::TrainingEndTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionModels::TrainingDataPoints)
                .integer()
                .not_null(),
        )
        // Audit
        .col(
            ColumnDef::new(AnomalyDetectionModels::CreatedAt)
                .timestamp()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        // Foreign Key
        .foreign_key(
            ForeignKey::create()
                .name(ANOMALY_MODELS_CONFIG_FK)
                .from(
                    AnomalyDetectionModels::Table,
                    AnomalyDetectionModels::ConfigId,
                )
                .to(
                    AnomalyDetectionConfig::Table,
                    AnomalyDetectionConfig::ConfigId,
                )
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn create_anomaly_models_latest_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANOMALY_MODELS_LATEST_IDX)
        .table(AnomalyDetectionModels::Table)
        .col(AnomalyDetectionModels::ConfigId)
        .col((AnomalyDetectionModels::Version, IndexOrder::Desc))
        .to_owned()
}

#[derive(DeriveIden)]
enum AnomalyDetectionModels {
    Table,
    ConfigId,
    Version,
    S3Path,
    S3Bucket,
    ModelSizeBytes,
    TrainingStartTime,
    TrainingEndTime,
    TrainingDataPoints,
    CreatedAt,
}
