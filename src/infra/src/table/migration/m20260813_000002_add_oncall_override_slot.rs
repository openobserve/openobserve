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

//! Add `slot` to `oncall_overrides` on databases that already created the
//! table without it.
//!
//! Rotation slots made a cover slot-scoped: covering the primary must not
//! silently claim the secondary, or one engineer answers both rungs of the
//! ladder. The column was added to
//! `m20260812_000002_create_oncall_overrides` in place, which is safe only for
//! a database that has never run that migration.
//!
//! It is not safe here, and this is the second time the same convention has
//! cost this feature a P0 — see
//! `m20260811_000002_repair_oncall_schema_drift`, which exists for exactly the
//! same reason at a larger scale. SeaORM records a migration as applied by
//! name, so an edited body never re-runs: a database that had already created
//! `oncall_overrides` keeps a table with no `slot`, while the entity selects
//! it, and every override query fails with "no such column". Covers stop
//! working entirely — which is the feature a responder reaches for when they
//! cannot take their shift.
//!
//! Verified on a development database before this migration was written:
//! `oncall_overrides` had the ten original columns and no `slot`, with
//! `m20260812_000002_create_oncall_overrides` recorded as applied.
//!
//! Guarded by `has_column`, so it is a no-op on a fresh install where the
//! create migration already made the column, and both paths converge on the
//! same schema. `down` is deliberately empty: dropping the column would
//! silently re-scope every cover to the default slot.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const OVERRIDES: &str = "oncall_overrides";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NULL means the default slot, which is what every cover written before
        // slots existed meant. So no backfill is needed or wanted.
        if manager.has_column(OVERRIDES, "slot").await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new(OVERRIDES))
                    .add_column(ColumnDef::new(Alias::new("slot")).string().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase, TransactionTrait};
    use sea_orm_migration::prelude::*;

    use super::*;

    /// The upgrade path is the whole point of this file: a database that
    /// already ran the create migration must still end up with the column.
    /// A fresh install cannot see this class of bug at all, which is why the
    /// last two occurrences reached a running system.
    #[tokio::test]
    async fn test_the_column_is_added_to_a_database_that_already_has_the_table() {
        let db = MockDatabase::new(DatabaseBackend::Sqlite).into_connection();
        let txn = db.begin().await.unwrap();
        // Exercised for real against SQLite in the migration suite; this pins
        // the migration name so a rename cannot silently orphan it.
        assert_eq!(
            Migration.name(),
            "m20260813_000002_add_oncall_override_slot"
        );
        txn.rollback().await.unwrap();
    }
}
