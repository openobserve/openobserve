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

//! `SeaORM` entity for `slo_budget_charges` — per-charge detail behind the
//! `slo_budget` totals (`alerts_2.md` §6b.8, S-14c).
//!
//! The totals alone cannot be un-charged correctly. When a retired
//! generation's slices finally age out, the amount to release is what *that*
//! generation reserved — which may differ from what the SLO reserves now, and
//! is unrecoverable from a running total. Hence a row per
//! `(org, slo_id, generation)`.

use sea_orm::entity::prelude::*;

/// A charge against the org's row budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ChargeState {
    /// The generation is currently being written.
    Active = 1,
    /// The generation is retired but its slices are still within retention,
    /// so the storage is still occupied.
    Residual = 2,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "slo_budget_charges")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub slo_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub generation: i32,
    pub rows_charged: i64,
    /// `ChargeState` as i32.
    pub state: i32,
    /// Residual charges only: `last_write + retention`, after which the rows
    /// are genuinely gone and the charge can be released.
    pub expires_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
