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

//! `SeaORM` entity for `slo_status` — the SLO read path and commit state
//! (`alerts_2.md` §6b.4c, §6b.8).
//!
//! Two jobs in one table, both deliberate:
//!
//! * **The read path.** Running window aggregates per `(slo_id, group_key)`, so status and every
//!   alert evaluation are O(1) rather than a window scan. Everything stored here is **target-free**
//!   (D56) — SLI, error budget and burn rate are derived at read time with the *current* target,
//!   which is what lets a target edit take effect without a rebuild.
//! * **The watermark.** The rollup row (`group_key = ''`) carries it. A forward clamp only — it
//!   stops readers seeing the currently-filling slice, which for a time-slice SLI would classify
//!   against a partial bucket. It is deliberately NOT a commit barrier: slices publish
//!   at-least-once like every other stream, and a batch whose delta never landed is repaired by
//!   reconciliation rather than hidden (D64).

use sea_orm::entity::prelude::*;

/// The rollup row's `group_key`. Also the row that owns the commit state.
pub const ROLLUP_GROUP_KEY: &str = "";

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "slo_status")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub slo_id: String,
    /// `""` is the rollup row — the EXACT overall (S-9), and the only row that
    /// carries commit state.
    #[sea_orm(primary_key, auto_increment = false)]
    pub group_key: String,
    /// The definition these numbers were measured under. Also the CAS fence
    /// for writer commits (D59): a writer whose generation was superseded
    /// mid-flight must fail rather than advance the new generation's marks
    /// with the old generation's arithmetic.
    pub definition_generation: i32,

    // ---- running window aggregate (§6b.4c) — target-free by rule (D56) ----
    pub good: Option<f64>,
    pub total: Option<f64>,
    pub covered_slices: Option<i32>,
    pub coverage: Option<f64>,
    /// Raw `(good, total, covered)` per `(long, short)` burn pair, computed
    /// once per SLO per pass and shared by every alert on it (SA-19 caps the
    /// number of distinct pairs).
    pub burn_windows: Option<Json>,
    /// Last emitted values for the trailing recompute slices, so
    /// write-on-change can compare without re-reading the stream (D55).
    pub trailing_slices: Option<Json>,

    // ---- the watermark: rollup row only -----------------------------------
    /// Forward clamp — readers ignore slices at or after this (§6b.4a).
    pub watermark_end: Option<i64>,

    // ---- group bookkeeping (S-10) -----------------------------------------
    pub groups_observed: Option<i64>,
    pub groups_observed_is_lower_bound: Option<bool>,
    pub active_set: Option<Json>,
    pub group_roster: Option<Json>,
    pub group_labels: Option<String>,
    pub computed_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
