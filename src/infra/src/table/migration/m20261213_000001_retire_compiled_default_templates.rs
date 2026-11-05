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

//! Folds the retired compiled default rows into `prebuilt_default`; the seeder repeats it on boot.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        use crate::table::templates::{
            MIGRATION_SEEDS, record_pending_renames, rename_reserved_collisions,
        };
        // A user row named prebuilt_default moves aside before the retired rows take the name.
        let renames = rename_reserved_collisions(db, &MIGRATION_SEEDS, true).await?;
        record_pending_renames(db, &renames).await?;
        for r in crate::table::templates::retire_default_templates(db).await? {
            log::info!("[TEMPLATES] retired template '{}' into '{}'", r.from, r.to);
        }
        Ok(())
    }

    /// The retired rows are reseeded by no binary, so the fold is not undone.
    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
