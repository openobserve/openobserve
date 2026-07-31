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

//! Add the alert state that `alert_if_fails` and `cooldown_mins` need in order
//! to mean anything.
//!
//! Both settings are validated on save, stored, and delivered to the probe —
//! and were read by nothing. Every completed run with a destination notified,
//! so `alert_if_fails: 3` alerted on the first failure and a `cooldown_mins` of
//! 30 sent thirty notifications in thirty minutes.
//!
//! Answering "is this the third consecutive failure?" and "have thirty minutes
//! passed since I last spoke?" needs memory BETWEEN runs; a single ack knows
//! only its own outcome. Three columns, all defaulted so existing rows need no
//! backfill:
//!   - `consecutive_failures` — runs that failed back to back, reset by a pass. Compared against
//!     `alert_if_fails`.
//!   - `last_alert_at` — when a notification was last sent, in microseconds. Compared against
//!     `cooldown_mins`. 0 = never.
//!   - `alerting` — whether the check is currently in the alerting state. This is what makes a
//!     recovery notification possible: without it "recovered" cannot be told from "was never
//!     alerting", and once a cooldown exists, silence stops meaning recovery.
//!   - `degraded_notified_at` — when a degradation was last reported, in microseconds. 0 = not
//!     currently degraded. Degradation needs TRANSITION-based suppression, not time-based: a
//!     certificate inside a 30-day warning window is `warning` on every single run, so notifying
//!     per run is unusable while treating it as healthy means it never notifies at all until the
//!     certificate actually expires — after the outage it existed to prevent.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // `synthetics` is created from the entity definition, so on a fresh
        // database these columns already exist by the time this runs. SQLite
        // ignores the `IF NOT EXISTS` guard on `ADD COLUMN`, so guard
        // explicitly with `has_column` to stay idempotent across backends.
        if !manager.has_column(TABLE, "consecutive_failures").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Synthetics::ConsecutiveFailures)
                                .integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column(TABLE, "last_alert_at").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Synthetics::LastAlertAt)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column(TABLE, "alerting").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Synthetics::Alerting)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column(TABLE, "degraded_notified_at").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Synthetics::DegradedNotifiedAt)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // sea-query has no `drop_column_if_exists`, so the same guard applies in
        // reverse — a partially-applied `up` must still roll back cleanly.
        for (name, column) in [
            ("consecutive_failures", Synthetics::ConsecutiveFailures),
            ("last_alert_at", Synthetics::LastAlertAt),
            ("alerting", Synthetics::Alerting),
            ("degraded_notified_at", Synthetics::DegradedNotifiedAt),
        ] {
            if manager.has_column(TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Synthetics::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

const TABLE: &str = "synthetics";

// The table is `synthetics`, NOT `synthetics_monitors` — the entity module is
// named after the concept but declares `table_name = "synthetics"`. DeriveIden
// renders the variant name, so this enum must match the create migration's
// (m20260707_000001), or the ALTER hits a table that does not exist.
#[derive(DeriveIden)]
enum Synthetics {
    Table,
    ConsecutiveFailures,
    LastAlertAt,
    Alerting,
    DegradedNotifiedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260730_000001_add_alert_state_to_synthetics_monitors"
        );
    }
}
