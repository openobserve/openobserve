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

//! `SeaORM` entity for `slo_backfill_jobs` — chunked, resumable historical
//! fill (`alerts_2.md` §6b.8, S-11).
//!
//! Keyed by `(slo_id, definition_generation)` rather than `slo_id` alone: a
//! generation bump starts a *different* backfill, and the old one's progress
//! must not be mistaken for the new one's.
//!
//! `done_through` is the resume point. Backfill re-emitting a chunk it already
//! wrote is harmless — slices are keyed and deduped by revision — so this is a
//! progress marker, not a correctness barrier.

use sea_orm::entity::prelude::*;

/// Where a backfill job is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum BackfillState {
    Queued = 1,
    Running = 2,
    Done = 3,
    Failed = 4,
    Cancelled = 5,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "slo_backfill_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub slo_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub definition_generation: i32,
    /// `BackfillState` as i32.
    pub state: i32,
    /// The range to fill. Strictly BEFORE the generation's `reset_time`, which
    /// is what keeps backfill off the incremental writer's slices (§6b.9).
    pub range_start: i64,
    pub range_end: i64,
    /// Resume point — everything at or before this is written.
    pub done_through: Option<i64>,
    pub rows_written: i64,
    pub error: Option<String>,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
