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

//! Moves user templates out of the reserved `o2_default_` prefix; the seeder repeats it on boot.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use crate::table::templates::{
            MIGRATION_SEEDS, record_pending_renames, rename_reserved_collisions,
        };
        let db = manager.get_connection();
        // The override columns arrive in 138 to 140, after this migration.
        let renames = rename_reserved_collisions(db, &MIGRATION_SEEDS, false).await?;
        // The ownership tuples live outside the meta store, so boot moves them.
        record_pending_renames(db, &renames).await?;
        for r in renames {
            log::info!(
                "[TEMPLATES] renamed reserved template '{}' in org {} to '{}'",
                r.from,
                r.org,
                r.to
            );
        }
        Ok(())
    }

    /// The old names are reserved now, so a rename is not undone.
    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
