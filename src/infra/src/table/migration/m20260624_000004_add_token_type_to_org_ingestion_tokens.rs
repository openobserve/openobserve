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

//! Adds `token_type TEXT NOT NULL DEFAULT 'ingest'` to `org_ingestion_tokens`.
//!
//! Allows the table to store both regular ingestion tokens (`o2oi_` prefix,
//! type = `'ingest'`) and synthetics agent tokens (`o2syn_` prefix,
//! type = `'synthetics'`) in the same table without ambiguity.
//!
//! SQLite: `ADD COLUMN … NOT NULL DEFAULT` is supported since SQLite 3.37.
//! The column is added as-is on all backends.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE org_ingestion_tokens \
                 ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'ingest'",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == sea_orm::DbBackend::Sqlite {
            return Ok(());
        }
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE org_ingestion_tokens DROP COLUMN IF EXISTS token_type",
            )
            .await?;
        Ok(())
    }
}
