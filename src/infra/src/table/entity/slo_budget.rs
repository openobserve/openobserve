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

//! `SeaORM` entity for `slo_budget` — the per-org row-budget accounting row
//! (`alerts_2.md` §6b.8, S-14d).
//!
//! One row per org, and `version` is the point of it. Every charge mutation
//! compare-and-swaps `version` inside the same transaction that changes the
//! counters, so two SLO creates racing to reserve the last of an org's
//! headroom cannot both succeed by each reading the pre-charge total.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "slo_budget")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    /// The CAS token. Read with the counters, asserted on write.
    pub version: i64,
    /// Rows reserved by SLOs that are currently writing.
    pub active_rows: i64,
    /// Rows still occupied by retired generations whose slices have not aged
    /// out of retention yet. Real storage, so it must stay charged (S-14c).
    pub residual_rows: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
