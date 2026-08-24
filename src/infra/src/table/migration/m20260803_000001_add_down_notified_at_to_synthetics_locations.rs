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

//! Make the "location down" one-shot cluster-wide instead of per-process.
//!
//! The staleness watcher runs on every scheduler node and suppressed repeat
//! notifications with an in-memory `HashSet<String>`. That set is process-local,
//! so N schedulers sent N notifications for the same outage — and did it
//! again on every down → recover → down cycle.
//!
//! One column, defaulted, so existing rows need no backfill:
//!   - `down_notified_at` — when this location's "down" notification was sent, in microseconds. 0
//!     means "not currently notified as down", which is also the correct value for every existing
//!     row: a location that is genuinely down will be re-detected on the next 60 s tick and
//!     notified once.
//!
//! The column is claimed with a compare-and-swap (`WHERE down_notified_at = 0`)
//! rather than read-then-write, so exactly one node sends the notification —
//! the same primitive `synthetics_jobs::lease_batch` and
//! `synthetics_checks::try_claim_slot` use.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLE: &str = "synthetics_locations";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // On a fresh database the table is created from the entity definition,
        // so the column already exists by the time this runs. SQLite ignores the
        // `IF NOT EXISTS` guard on `ADD COLUMN`, so guard explicitly with
        // `has_column` to stay idempotent across backends.
        if !manager.has_column(TABLE, "down_notified_at").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(SyntheticsLocations::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(SyntheticsLocations::DownNotifiedAt)
                                .big_integer()
                                .not_null()
                                .default(0i64),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, "down_notified_at").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(SyntheticsLocations::Table)
                        .drop_column(SyntheticsLocations::DownNotifiedAt)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SyntheticsLocations {
    Table,
    DownNotifiedAt,
}
