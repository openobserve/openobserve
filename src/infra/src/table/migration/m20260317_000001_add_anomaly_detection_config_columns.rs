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

//! Upgrades anomaly_detection_config from the P1 schema to the P2 schema.
//!
//! m20260310 creates the table with `alert_destination_id` (varchar). This migration:
//! - Adds `folder_id` (varchar 256): backfilled from the "default" Alerts folder for each org. If
//!   an org has anomaly configs but no default Alerts folder, one is auto-created so the backfill
//!   always succeeds and folder_id can be set NOT NULL.
//! - Adds `owner` (varchar 256): nullable attributed owner.
//! - Adds `alert_destinations` (jsonb): wraps the old `alert_destination_id` value in a JSON array,
//!   then drops the old column.
//!
//! All three steps are guarded by column-existence checks so the migration is idempotent.

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;
use svix_ksuid::{Ksuid, KsuidLike};

const ANOMALY_CONFIG_FOLDER_ID_IDX: &str = "idx_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Returns `true` when the named column exists in `anomaly_detection_config`.
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

        // --- Add folder_id (always) ---
        if !column_exists(manager, "folder_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column(
                            ColumnDef::new(AnomalyDetectionConfig::FolderId)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // --- Add owner (always) ---
        if !column_exists(manager, "owner").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyDetectionConfig::Table)
                        .add_column(
                            ColumnDef::new(AnomalyDetectionConfig::Owner)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // --- Migrate alert_destination_id → alert_destinations ---
        let has_old_col = column_exists(manager, "alert_destination_id").await?;
        let has_new_col = column_exists(manager, "alert_destinations").await?;

        if !has_new_col {
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
        }

        if has_old_col {
            // Copy old single-value column into a JSON array, then drop it.
            let migrate_sql = match db_backend {
                sea_orm::DbBackend::Sqlite => {
                    "UPDATE anomaly_detection_config \
                     SET alert_destinations = json_array(alert_destination_id) \
                     WHERE alert_destination_id IS NOT NULL AND alert_destinations IS NULL"
                }
                sea_orm::DbBackend::Postgres => {
                    "UPDATE anomaly_detection_config \
                     SET alert_destinations = json_build_array(alert_destination_id) \
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

        // Ensure every org with anomaly configs has a default Alerts folder (type=1).
        // If not, auto-create one so the backfill below never leaves a NULL.
        let db = manager.get_connection();
        let orgs_rows = db
            .query_all(Statement::from_string(
                db_backend,
                "SELECT DISTINCT org_id FROM anomaly_detection_config WHERE folder_id IS NULL",
            ))
            .await?;
        for row in orgs_rows {
            let org_id: String = row.try_get("", "org_id")?;
            // Escape single quotes in org_id to prevent SQL issues.
            let org_id_escaped = org_id.replace('\'', "''");
            let check_sql = format!(
                "SELECT id FROM folders \
                 WHERE org = '{org_id_escaped}' \
                 AND folder_id = 'default' AND type = 1 LIMIT 1"
            );
            let existing = db
                .query_one(Statement::from_string(db_backend, check_sql))
                .await?;
            if existing.is_none() {
                let ksuid = Ksuid::new(None, None).to_string();
                let insert_sql = format!(
                    "INSERT INTO folders (id, org, folder_id, name, type) \
                     VALUES ('{ksuid}', '{org_id_escaped}', 'default', 'Default', 1)"
                );
                db.execute_unprepared(&insert_sql).await?;
            }
        }

        // Backfill folder_id from the "default" Alerts folder for each org.
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

        // Make folder_id NOT NULL on databases that support it in-place.
        // SQLite: the backfill is sufficient for dev environments.
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
    AlertDestinations,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anomaly_config_folder_id_idx_constant_value() {
        assert_eq!(ANOMALY_CONFIG_FOLDER_ID_IDX, "idx_anomaly_config_folder_id");
    }
}
