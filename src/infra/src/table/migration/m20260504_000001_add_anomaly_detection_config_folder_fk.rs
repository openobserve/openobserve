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
//! Before adding the constraint, any rows whose `folder_id` no longer exists in `folders`
//! (orphaned due to folder deletion after m20260317 ran) are re-pointed to the org's default
//! Alerts folder — auto-creating that folder if needed. This mirrors m20260317's approach and
//! ensures `ALTER TABLE ADD CONSTRAINT` never encounters an orphaned row.
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
use svix_ksuid::{Ksuid, KsuidLike};

const FK_NAME: &str = "fk_anomaly_config_folder_id";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }

        // Repair any orphaned folder_id values before adding the FK constraint.
        // Postgres rejects ALTER TABLE ADD CONSTRAINT FOREIGN KEY if any existing row
        // has a folder_id that doesn't exist in folders.
        repair_orphaned_folder_ids(manager).await?;

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

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }
        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE anomaly_detection_config \
                 DROP CONSTRAINT IF EXISTS {FK_NAME}"
            ))
            .await?;
        Ok(())
    }
}

/// Re-points any `anomaly_detection_config` rows whose `folder_id` no longer exists in
/// `folders` to the org's default Alerts folder (type = 1, folder_id = 'default').
/// Auto-creates the default folder for any org that is missing one.
async fn repair_orphaned_folder_ids(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let db = manager.get_connection();
    let db_backend = manager.get_database_backend();

    // Find all orgs that have at least one orphaned anomaly config row.
    let orphaned_orgs = db
        .query_all(Statement::from_string(
            db_backend,
            "SELECT DISTINCT ac.org_id \
             FROM anomaly_detection_config ac \
             WHERE NOT EXISTS (\
               SELECT 1 FROM folders f WHERE f.id = ac.folder_id\
             )",
        ))
        .await?;

    for row in orphaned_orgs {
        let org_id: String = row.try_get("", "org_id")?;
        let org_id_escaped = org_id.replace('\'', "''");

        // Ensure the org has a default Alerts folder (type = 1).
        let existing_folder = db
            .query_one(Statement::from_string(
                db_backend,
                format!(
                    "SELECT id FROM folders \
                     WHERE org = '{org_id_escaped}' \
                     AND folder_id = 'default' AND type = 1 LIMIT 1"
                ),
            ))
            .await?;

        let default_folder_id = if let Some(r) = existing_folder {
            r.try_get::<String>("", "id")?
        } else {
            let ksuid = Ksuid::new(None, None).to_string();
            db.execute_unprepared(&format!(
                "INSERT INTO folders (id, org, folder_id, name, type) \
                 VALUES ('{ksuid}', '{org_id_escaped}', 'default', 'Default', 1)"
            ))
            .await?;
            ksuid
        };

        // Re-point all orphaned rows for this org to the default folder.
        db.execute_unprepared(&format!(
            "UPDATE anomaly_detection_config \
             SET folder_id = '{default_folder_id}' \
             WHERE org_id = '{org_id_escaped}' \
             AND NOT EXISTS (\
               SELECT 1 FROM folders f WHERE f.id = anomaly_detection_config.folder_id\
             )"
        ))
        .await?;
    }

    Ok(())
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
