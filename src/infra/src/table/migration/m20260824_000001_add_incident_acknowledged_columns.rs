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

//! Incident acknowledgement attribution.
//!
//! Two additive, nullable columns on `alert_incidents`:
//!
//! 1. `acknowledged_by` — TEXT, the user id/email that acknowledged the incident.
//! 2. `acknowledged_at` — BIGINT, microsecond timestamp of that acknowledgement.
//!
//! Mirrors `oncall_responses.acked_by`/`acked_at` (see
//! `m20260806_000001_create_oncall_tables.rs`): before this, "who
//! acknowledged this incident" was only answerable by reading the side
//! -channel `incident_events` timeline, unlike on-call's primary record.
//!
//! No backfill and no index. Absent = never acknowledged, which is correct
//! for every existing row.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Two SQLite constraints shape this, both learned the hard way and
        // repeated here because the next migration author will hit them too:
        //
        // 1. Only ONE alter option per ALTER TABLE — sea-query *panics* (not errors) when a
        //    statement carries more, taking the node down mid-migration. Hence one `add_column`
        //    call per statement.
        // 2. `add_column_if_not_exists` is NOT idempotent on SQLite: it emits a plain ADD COLUMN,
        //    so re-running after a partial failure dies with "duplicate column name" forever. Hence
        //    the explicit `has_column` guard in the helper below.
        add_column(
            manager,
            ALERT_INCIDENTS,
            AlertIncidents::AcknowledgedBy,
            ColType::Text,
        )
        .await?;
        add_column(
            manager,
            ALERT_INCIDENTS,
            AlertIncidents::AcknowledgedAt,
            ColType::BigInt,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same one-per-statement rule as `up`.
        for col in [
            AlertIncidents::AcknowledgedAt,
            AlertIncidents::AcknowledgedBy,
        ] {
            if manager
                .has_column(ALERT_INCIDENTS, &col.to_string())
                .await?
            {
                manager
                    .alter_table(
                        Table::alter()
                            .table(AlertIncidents::Table)
                            .drop_column(col)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

const ALERT_INCIDENTS: &str = "alert_incidents";

#[derive(Clone, Copy)]
enum ColType {
    Text,
    BigInt,
}

/// Add one nullable column, skipping it if already present.
///
/// Genuinely idempotent, unlike `add_column_if_not_exists` on SQLite, so a
/// migration interrupted partway can be retried.
async fn add_column<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    ty: ColType,
) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    let mut def = ColumnDef::new(column);
    let def = match ty {
        ColType::Text => def.string(),
        ColType::BigInt => def.big_integer(),
    }
    .null()
    .to_owned();

    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(def)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden, Clone)]
enum AlertIncidents {
    Table,
    AcknowledgedBy,
    AcknowledgedAt,
}
