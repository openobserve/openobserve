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

//! Adds `destinations JSONB NOT NULL DEFAULT '[]'` to `synthetics_monitors`.
//!
//! Stores the list of alert destination names to notify on every check
//! completion. Defaults to an empty array so existing monitors send no
//! notifications until explicitly configured.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            "ALTER TABLE synthetics_monitors ADD COLUMN destinations TEXT NOT NULL DEFAULT '[]'"
        } else {
            "ALTER TABLE synthetics_monitors \
             ADD COLUMN IF NOT EXISTS destinations JSONB NOT NULL DEFAULT '[]'"
        };
        manager.get_connection().execute_unprepared(sql).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE synthetics_monitors DROP COLUMN IF EXISTS destinations",
            )
            .await?;
        Ok(())
    }
}
