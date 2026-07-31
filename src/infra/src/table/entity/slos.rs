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

//! `SeaORM` entity for `slos` — the SLO definition (`alerts_2.md` §6b.8).
//!
//! Two fields deserve the note they carry below, because a reader will
//! otherwise assume they are ordinary metadata:
//!
//! * `definition_generation` is the **writing epoch**. Every slice is stamped with it, every read
//!   filters on it, and every writer commit compare-and-swaps on it (D59). Bumped by any
//!   computation-affecting edit — including a revert, because a revert is a third definition as far
//!   as in-flight passes are concerned. NOT bumped by a `target` edit: the target is applied at
//!   read time (D56), so changing it must not throw away 90 days of measurement.
//! * `groups_reserved` is a **budget reservation**, not an observation. It is charged at save time
//!   from the preflight estimate so that concurrent creates cannot collectively overcommit an org's
//!   row budget (S-14).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "slos")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub folder_id: String,
    pub name: String,
    pub description: Option<String>,
    /// Discriminant for `sli_config` — stored separately so a listing can
    /// filter by SLI type without parsing every JSON blob.
    pub sli_type: i32,
    pub sli_config: Json,
    /// Percentage in (0, 100). Applied at READ time (D56).
    pub target: f64,
    pub window_secs: i64,
    pub slice_interval_secs: i32,
    /// THE canonical location for grouping — never duplicated into
    /// `sli_config` (§6b.7).
    pub group_by: Option<Json>,
    pub tags: Option<Json>,
    pub enabled: bool,
    pub owner: Option<String>,
    /// The writing epoch and the CAS fence. See the module note.
    pub definition_generation: i32,
    /// When the current generation began. The incremental writer owns
    /// `[reset_time, ∞)` and backfill owns strictly before it, which is what
    /// keeps the two writers off each other's slices (§6b.9).
    pub generation_reset_time: Option<i64>,
    /// Preflight `COUNT(DISTINCT …)` estimate (§6b.4e).
    pub groups_estimate: Option<i64>,
    /// See the module note — a reservation, not an observation.
    pub groups_reserved: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_edited_by: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
