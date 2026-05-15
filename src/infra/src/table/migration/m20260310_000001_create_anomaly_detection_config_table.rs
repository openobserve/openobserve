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
            ColumnDef::new(AnomalyDetectionConfig::AnomalyId)
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
            ColumnDef::new(AnomalyDetectionConfig::HistogramInterval)
                .string_len(10)
                .not_null()
                .default("5m"),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::ScheduleInterval)
                .string_len(10)
                .not_null()
                .default("1h"),
        )
        .col(
            // How far back each detection run queries, stored as seconds (mirrors alerts'
            // trigger_period_seconds). Required — caller must supply this.
            ColumnDef::new(AnomalyDetectionConfig::DetectionWindowSeconds)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::TrainingWindowDays)
                .integer()
                .not_null()
                .default(7),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::RetrainIntervalDays)
                .integer()
                .not_null()
                .default(7),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Threshold)
                .integer()
                .not_null()
                .default(97),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Seasonality)
                .string_len(20)
                .not_null()
                .default("none"),
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
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::TrainingCompletedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastError)
                .text()
                .null(),
        )
        // Detection State
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastProcessedTimestamp)
                .big_integer()
                .null(),
        )
        // Note: last_detection_run and last_anomaly_detected_at are intentionally absent.
        // These are sourced at query time from scheduled_jobs (trigger.start_time and
        // trigger.data.last_satisfied_at) — the same pattern used by alerts.
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
        // Status stored as integer: 0=waiting, 1=active, 2=training, 3=failed, 4=disabled
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Status)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::Retries)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::LastUpdated)
                .big_integer()
                .not_null(),
        )
        // Note: processing_node removed — distributed locking is handled by scheduled_jobs status.
        // Note: created_by removed — was always NULL; can be added back when auth context is wired.
        .col(
            ColumnDef::new(AnomalyDetectionConfig::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AnomalyDetectionConfig::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_anomaly_config_pull_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANOMALY_CONFIG_PULL_IDX)
        .table(AnomalyDetectionConfig::Table)
        .col(AnomalyDetectionConfig::Status)
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
    AnomalyId,
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
    HistogramInterval,
    ScheduleInterval,
    DetectionWindowSeconds,
    TrainingWindowDays,
    RetrainIntervalDays,
    Threshold,
    Seasonality,
    IsTrained,
    TrainingStartedAt,
    TrainingCompletedAt,
    LastError,
    LastProcessedTimestamp,
    CurrentModelVersion,
    RcfNumTrees,
    RcfTreeSize,
    RcfShingleSize,
    AlertEnabled,
    AlertDestinationId,
    Status,
    Retries,
    LastUpdated,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_pull_idx_name() {
        let sql = create_anomaly_config_pull_idx_stmt().build(SqliteQueryBuilder);
        assert!(sql.contains(ANOMALY_CONFIG_PULL_IDX));
    }

    #[test]
    fn test_org_idx_name() {
        let sql = create_anomaly_config_org_idx_stmt().build(SqliteQueryBuilder);
        assert!(sql.contains(ANOMALY_CONFIG_ORG_IDX));
    }

    #[test]
    fn test_timeout_idx_name() {
        let sql = create_anomaly_config_timeout_idx_stmt().build(SqliteQueryBuilder);
        assert!(sql.contains(ANOMALY_CONFIG_TIMEOUT_IDX));
    }

    #[test]
    fn test_table_stmt_contains_table_name() {
        let sql = create_anomaly_detection_config_table_stmt().build(SqliteQueryBuilder);
        assert!(sql.contains("anomaly_detection_config"));
    }
}
