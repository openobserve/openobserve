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

//! SLO alerts — Feature 5 Phase 5b (`alerts_2.md` §6b.3, D28, D42, D60).
//!
//! An SLO alert is an **ordinary `alerts` row** with `query_type = slo`, not a
//! new entity (D28). That is what lets it inherit destinations, silence,
//! levels, tags, RBAC and the whole scheduler path unchanged. Two additive,
//! nullable columns carry what is specific to it:
//!
//! 1. `slo_id` — the reference, as its own **indexed** column rather than a key inside the JSON
//!    payload (D60). It has to support reverse lookup: "which alerts point at this SLO" is asked on
//!    every SLO delete (S-12) and on every ingest pass that precomputes burn windows (SA-19), and a
//!    JSON key cannot be indexed portably across SQLite, MySQL and Postgres.
//! 2. `query_slo_condition` — the payload (`SloCondition`). Follows the `query_aggregation`
//!    precedent, deliberately NOT `trigger_thresholds`, whose documented scope is threshold and
//!    level configuration only (D1/D42).
//!
//! No backfill: absent means "not an SLO alert", which is every existing row.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement: sea-query PANICS (not errors) when a
        // statement carries more on SQLite, taking the node down mid-migration.
        add_column(manager, ALERTS, Alerts::SloId, ColType::Text).await?;
        add_column(manager, ALERTS, Alerts::QuerySloCondition, ColType::Json).await?;

        // The index is the reason `slo_id` is a column at all — see the module
        // note. Created after both columns so a retry cannot index a column
        // that does not exist yet.
        if !manager.has_index(ALERTS, SLO_ID_IDX).await? {
            manager
                .create_index(
                    Index::create()
                        .if_not_exists()
                        .name(SLO_ID_IDX)
                        .table(Alerts::Table)
                        .col(Alerts::SloId)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(SLO_ID_IDX).table(Alerts::Table).to_owned())
            .await?;
        for col in [Alerts::QuerySloCondition, Alerts::SloId] {
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
const SLO_ID_IDX: &str = "alerts_slo_id_idx";

#[derive(Clone, Copy)]
enum ColType {
    Text,
    Json,
}

/// Add one nullable column, skipping it if already present.
///
/// Genuinely idempotent, unlike `add_column_if_not_exists` on SQLite, which
/// emits a plain ADD COLUMN and so dies with "duplicate column name" forever
/// after a partial failure.
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
        ColType::Text => def.string_len(27),
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
    SloId,
    QuerySloCondition,
}
