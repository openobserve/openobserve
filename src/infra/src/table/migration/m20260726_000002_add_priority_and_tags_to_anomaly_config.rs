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

//! Priority & tags for anomaly-detection configs — Feature 2 (PT-1, PT-6).
//!
//! Anomaly configs are listed in the SAME alert list as scheduled and realtime
//! alerts, so they need the same triage metadata. Without these columns a
//! priority or tag filter had to exclude anomalies wholesale — they carried
//! neither field, so any filter would have returned them all unfiltered.
//!
//! Columns mirror `alerts.priority` / `alerts.tags` exactly, including the
//! storage ids (1..=5, P1 = 1), so one `AlertPriority` and one
//! `tags::normalize_tags` serve both tables.
//!
//! Additive and nullable: absent priority = unset, absent tags = none, which
//! is the behaviour of every existing anomaly config.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Same two SQLite constraints as the alerts migration: ONE alter
        // option per statement (sea-query panics otherwise), and an explicit
        // `has_column` guard because `add_column_if_not_exists` is not
        // idempotent on SQLite.
        add_column(manager, TABLE, AnomalyConfig::Priority, ColType::Int).await?;
        add_column(manager, TABLE, AnomalyConfig::Tags, ColType::Json).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for col in [AnomalyConfig::Tags, AnomalyConfig::Priority] {
            manager
                .alter_table(
                    Table::alter()
                        .table(AnomalyConfig::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const TABLE: &str = "anomaly_detection_config";

#[derive(Clone, Copy)]
enum ColType {
    Int,
    Json,
}

/// Add one nullable column, skipping it if already present.
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
enum AnomalyConfig {
    #[sea_orm(iden = "anomaly_detection_config")]
    Table,
    Priority,
    Tags,
}
