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

//! Priority & tags — Feature 2 of `alerts_2.md` (PT-2, PT-6; decisions D17/D18).
//!
//! Two additive, nullable columns on `alerts`:
//!
//! 1. `priority` — INTEGER, storage ids 1..=5 (P1 = 1, most urgent). A dedicated column rather than
//!    a key inside `trigger_thresholds` for two reasons: that blob's scope rule is *threshold and
//!    level configuration only* (D1), and priority has to be SQL-sortable and SQL-filterable
//!    (PT-3), which a JSON key is not, portably.
//! 2. `tags` — JSON array (D18). Alert bodies are already cached per org in memory, so tag
//!    filtering resolves to an ID predicate app-side and a normalized `alert_tags` join table would
//!    buy SQL reverse-lookup we do not need yet, at the cost of dual-write consistency.
//!
//! No backfill and no index. Absent priority = unset and empty tags = the
//! pre-Feature-2 behaviour for every existing row (G5). No index on `priority`
//! because `alerts` is a small, frequently-updated table and list queries are
//! already org- and folder-scoped before the sort applies; revisit only if a
//! deployment shows the sort actually hurting.

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
        add_column(manager, ALERTS, Alerts::Priority, ColType::Int).await?;
        add_column(manager, ALERTS, Alerts::Tags, ColType::Json).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same one-per-statement rule as `up`.
        for col in [Alerts::Tags, Alerts::Priority] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const ALERTS: &str = "alerts";

#[derive(Clone, Copy)]
enum ColType {
    Int,
    Json,
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
        ColType::Int => def.integer(),
        ColType::Json => def.json(),
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
enum Alerts {
    Table,
    Priority,
    Tags,
}
