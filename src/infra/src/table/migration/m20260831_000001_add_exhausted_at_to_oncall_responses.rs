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

//! When a page's escalation ladder ran out with nobody answering.
//!
//! One additive, nullable column on `oncall_responses`: `exhausted_at`,
//! microseconds, absent while the ladder is still climbing.
//!
//! **Not a `ResponseState`.** An exhausted page can still be acknowledged and
//! resolved — somebody finds it an hour later and takes it — so a lifecycle
//! state would force a false either/or between "the ladder is spent" and "a
//! human has it". `ResponseState`'s durable ordering also has no room between
//! `Triaged` (2) and `Acknowledged` (3), and those ids may not be reordered.
//! Exhaustion is a property of the ladder; the state is a property of the
//! human.
//!
//! Why a column rather than reading the timeline: the `Exhausted` event has
//! been on the timeline all along, but the pages LIST is where the question is
//! asked, and answering it there meant one extra query per row. So a record
//! whose ladder had died went on reporting itself as `triggered` — which
//! `state.is_escalating()` reads as "still climbing" — beside a timeline that
//! said it was over.
//!
//! A separate migration rather than an edit to `m20260812_000003`, even though
//! on-call is unreleased: that migration is already applied in every
//! development database and in CI's persisted SQLite, so an in-place edit adds
//! the column for nobody who already has the table.
//!
//! No backfill. Absent = never exhausted, which is right for every existing
//! row: a ladder that ran out before this shipped left its `Exhausted` event on
//! the timeline, and the record simply does not carry the summary.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement, and an explicit `has_column` guard —
        // see `m20260824_000001` for why both matter on SQLite.
        add_column(
            manager,
            ONCALL_RESPONSES,
            OncallResponses::ExhaustedAt,
            ColType::BigInt,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column(ONCALL_RESPONSES, &OncallResponses::ExhaustedAt.to_string())
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallResponses::Table)
                        .drop_column(OncallResponses::ExhaustedAt)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const ONCALL_RESPONSES: &str = "oncall_responses";

#[derive(Clone, Copy)]
enum ColType {
    BigInt,
}

#[derive(DeriveIden, Clone, Copy)]
enum OncallResponses {
    Table,
    ExhaustedAt,
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

