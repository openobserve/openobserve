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

//! `SeaORM` entity for `slo_batch_manifest` — the write-ahead intent that
//! makes torn batches recoverable (`alerts_2.md` §6b.4a, D62/D63).
//!
//! A row here means "a batch was *started*". It is written in its own
//! transaction **before** any columnar row, and cleared in the same
//! transaction that commits the batch. So a manifest row surviving into the
//! next pass is exactly the signature of a crash between write and commit.
//!
//! Without it, recovery cannot know which range a crashed attempt touched: the
//! natural ingest range slides forward with the clock, so a recovery slower
//! than the K-slice recompute window would never revisit the affected slices,
//! and the next successful commit would advance the mark past the torn
//! batch — retroactively publishing its rows.
//!
//! One row per `(slo_id, writer)`: a writer must resolve its torn batch before
//! starting another, which is what bounds the abandoned set.

use sea_orm::entity::prelude::*;

/// Storage ids for the two writers. Never reorder — they are persisted.
pub const WRITER_INCREMENTAL: i16 = 0;
pub const WRITER_BACKFILL: i16 = 1;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "slo_batch_manifest")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub slo_id: String,
    /// [`WRITER_INCREMENTAL`] or [`WRITER_BACKFILL`].
    #[sea_orm(primary_key, auto_increment = false)]
    pub writer: i16,
    /// The batch number this attempt is writing under.
    pub batch_rev: i64,
    /// The range the attempt intends to cover, `[start, end)`. Recovery must
    /// widen to at least this, however far the clock has moved.
    pub range_start: i64,
    pub range_end: i64,
    /// The generation the attempt was planned under. A manifest from a
    /// superseded generation is abandoned outright rather than repaired —
    /// its arithmetic no longer describes the current definition.
    pub definition_generation: i32,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
