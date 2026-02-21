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

const ANOMALY_CONFIG_PULL_IDX: &str = "idx_anomaly_config_pull";
const ANOMALY_CONFIG_ORG_IDX: &str = "idx_anomaly_config_org";
const ANOMALY_CONFIG_TIMEOUT_IDX: &str = "idx_anomaly_config_timeout";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_anomaly_detection_config_table_stmt())
            .await?;
        manager
            .create_index(create_anomaly_config_pull_idx_stmt())
            .await?;
        manager
            .create_index(create_anomaly_config_org_idx_stmt())
            .await?;
        manager
            .create_index(create_anomaly_config_timeout_idx_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(ANOMALY_CONFIG_TIMEOUT_IDX).to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name(ANOMALY_CONFIG_ORG_IDX).to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name(ANOMALY_CONFIG_PULL_IDX).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(AnomalyDetectionConfig::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_anomaly_detection_config_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(AnomalyDetectionConfig::Table)
        .if_not_exists()
        // Primary Key
        .col(
            ColumnDef::new(AnomalyDetectionConfig::ConfigId)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        // Organization & Stream
        .col(
            ColumnDef::new(AnomalyDetectionConfig::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::StreamName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::StreamType)
                .string_len(20)
                .not_null(),
        )
        // Configuration
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Enabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Description)
                .text()
                .null(),
        )
        // Query Mode
        .col(
            ColumnDef::new(AnomalyDetectionConfig::QueryMode)
                .string_len(20)
                .not_null()
                .default("filters"),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Filters)
                .json_binary()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::CustomSql)
                .text()
                .null(),
        )
        // Detection Settings
        .col(
            ColumnDef::new(AnomalyDetectionConfig::DetectionFunction)
                .string_len(256)
                .not_null()
                .default("count(*)"),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::DetectionInterval)
                .string_len(10)
                .not_null()
                .default("1h"),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::TrainingWindowDays)
                .integer()
                .not_null()
                .default(7),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Sensitivity)
                .integer()
                .not_null()
                .default(5),
        )
        // Training State
        .col(
            ColumnDef::new(AnomalyDetectionConfig::IsTrained)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::TrainingStartedAt)
                .timestamp()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::TrainingCompletedAt)
                .timestamp()
                .null(),
        )
        // Detection State
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastProcessedTimestamp)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastDetectionRun)
                .timestamp()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::NextRunAt)
                .big_integer()
                .not_null(),
        )
        // Current Model Reference
        .col(
            ColumnDef::new(AnomalyDetectionConfig::CurrentModelVersion)
                .big_integer()
                .not_null()
                .default(0),
        )
        // RCF Parameters
        .col(
            ColumnDef::new(AnomalyDetectionConfig::RcfNumTrees)
                .integer()
                .not_null()
                .default(100),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::RcfTreeSize)
                .integer()
                .not_null()
                .default(256),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::RcfShingleSize)
                .integer()
                .not_null()
                .default(8),
        )
        // Alert Integration
        .col(
            ColumnDef::new(AnomalyDetectionConfig::AlertEnabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::AlertDestinationId)
                .string_len(100)
                .null(),
        )
        // Scheduler Integration (for locking)
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Status)
                .string_len(20)
                .not_null()
                .default("waiting"),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Retries)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastUpdated)
                .timestamp()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::ProcessingNode)
                .string_len(256)
                .null(),
        )
        // Audit
        .col(
            ColumnDef::new(AnomalyDetectionConfig::CreatedBy)
                .string_len(100)
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::CreatedAt)
                .timestamp()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::UpdatedAt)
                .timestamp()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .to_owned()
}

fn create_anomaly_config_pull_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANOMALY_CONFIG_PULL_IDX)
        .table(AnomalyDetectionConfig::Table)
        .col(AnomalyDetectionConfig::Status)
        .col(AnomalyDetectionConfig::NextRunAt)
        .col(AnomalyDetectionConfig::Enabled)
        .to_owned()
}

fn create_anomaly_config_org_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANOMALY_CONFIG_ORG_IDX)
        .table(AnomalyDetectionConfig::Table)
        .col(AnomalyDetectionConfig::OrgId)
        .col(AnomalyDetectionConfig::Enabled)
        .to_owned()
}

fn create_anomaly_config_timeout_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANOMALY_CONFIG_TIMEOUT_IDX)
        .table(AnomalyDetectionConfig::Table)
        .col(AnomalyDetectionConfig::Status)
        .col(AnomalyDetectionConfig::LastUpdated)
        .col(AnomalyDetectionConfig::IsTrained)
        .to_owned()
}

#[derive(DeriveIden)]
pub enum AnomalyDetectionConfig {
    Table,
    ConfigId,
    OrgId,
    StreamName,
    StreamType,
    Enabled,
    Name,
    Description,
    QueryMode,
    Filters,
    CustomSql,
    DetectionFunction,
    DetectionInterval,
    TrainingWindowDays,
    Sensitivity,
    IsTrained,
    TrainingStartedAt,
    TrainingCompletedAt,
    LastProcessedTimestamp,
    LastDetectionRun,
    NextRunAt,
    CurrentModelVersion,
    RcfNumTrees,
    RcfTreeSize,
    RcfShingleSize,
    AlertEnabled,
    AlertDestinationId,
    Status,
    Retries,
    LastUpdated,
    ProcessingNode,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}
