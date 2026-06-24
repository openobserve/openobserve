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

//! Fixes the `dedup_uq` unique constraint on `synthetics_pending_checks` by
//! adding `location` to the key.
//!
//! The original constraint `(monitor_id, pool, device, scheduled_ts)` is missing
//! `location`. A monitor with multiple locations would produce rows with identical
//! constraint values but different locations — only the first insert would succeed;
//! the rest would be silently dropped via `ON CONFLICT DO NOTHING`.
//!
//! The corrected constraint is `(monitor_id, location, pool, device, scheduled_ts)`.
//!
//! SQLite: cannot drop/recreate a named UNIQUE constraint via ALTER TABLE. SQLite is
//! dev-only and single-location testing is fine, so this migration is a no-op there.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const OLD_CONSTRAINT: &str = "dedup_uq";
const NEW_CONSTRAINT: &str = "dedup_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }

        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE synthetics_pending_checks DROP CONSTRAINT IF EXISTS {OLD_CONSTRAINT}"
            ))
            .await?;

        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE synthetics_pending_checks \
                 ADD CONSTRAINT {NEW_CONSTRAINT} \
                 UNIQUE (monitor_id, location, pool, device, scheduled_ts)"
            ))
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }

        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE synthetics_pending_checks DROP CONSTRAINT IF EXISTS {NEW_CONSTRAINT}"
            ))
            .await?;

        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE synthetics_pending_checks \
                 ADD CONSTRAINT {OLD_CONSTRAINT} \
                 UNIQUE (monitor_id, pool, device, scheduled_ts)"
            ))
            .await?;

        Ok(())
    }
}
