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

//! Per-series alerting for PromQL alerts (M-9 extended to `QueryType::PromQL`).
//!
//! One additive, nullable boolean. It needs a column of its own because the two
//! obvious existing homes are both wrong:
//!
//! * `query_aggregation` holds `Aggregation::multi_alert` for SQL alerts, but a PromQL alert has no
//!   aggregation at all — its grouping lives in the expression (`sum by (pod) (…)`).
//! * `trigger_thresholds` already carries `promql_warning`, so it looks like the established home
//!   for PromQL-specific knobs. It deserializes into `ThresholdConfig`, whose documented scope is
//!   threshold and level configuration only (D1). An opt-in to per-series dispatch is neither, and
//!   putting it there would make the type's name a lie for every future reader.
//!
//! No backfill. NULL and `false` both mean "collapsed evaluation", which is
//! every alert that predates this feature — the same backward-compatibility
//! guarantee `Aggregation::multi_alert` gets from `#[serde(default)]`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        add_column(manager, ALERTS, Alerts::QueryPromqlMultiAlert).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::QueryPromqlMultiAlert)
                    .to_owned(),
            )
            .await
    }
}

const ALERTS: &str = "alerts";

/// Add one nullable boolean column, skipping it if already present.
///
/// Genuinely idempotent, unlike `add_column_if_not_exists` on SQLite, which
/// emits a plain ADD COLUMN and so dies with "duplicate column name" forever
/// after a partial failure.
async fn add_column<C>(manager: &SchemaManager<'_>, table: &str, column: C) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(ColumnDef::new(column).boolean().null().to_owned())
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden, Clone)]
enum Alerts {
    Table,
    QueryPromqlMultiAlert,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::prelude::*;

    use super::*;

    /// The column must be NULLABLE. A `NOT NULL` add would need a default, and
    /// a defaulted backfill is exactly what this migration must not do — every
    /// existing row has to keep evaluating collapsed.
    #[test]
    fn the_column_is_nullable_so_existing_alerts_are_untouched() {
        let sql = Table::alter()
            .table(Alerts::Table)
            .add_column(
                ColumnDef::new(Alerts::QueryPromqlMultiAlert)
                    .boolean()
                    .null()
                    .to_owned(),
            )
            .to_owned()
            .to_string(SqliteQueryBuilder);
        assert!(sql.contains("query_promql_multi_alert"), "{sql}");
        assert!(!sql.contains("NOT NULL"), "{sql}");
        assert!(!sql.to_uppercase().contains("DEFAULT"), "{sql}");
    }
}
