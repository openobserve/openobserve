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

//! `SeaORM` Entity for the `alert_leases` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_leases")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub alert_id: String,
    pub kind: String,
    pub set_value: bool,
    pub prior_enabled: Option<bool>,
    pub prior_creates_incident: Option<bool>,
    pub alert_version_us: i64,
    pub end_version_us: Option<i64>,
    pub starts_at_us: i64,
    pub ends_at_us: i64,
    pub set_by: String,
    #[sea_orm(column_type = "Text")]
    pub reason: String,
    pub origin_ref: Option<String>,
    pub state: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub state_reason: Option<String>,
    pub ended_at_us: Option<i64>,
    pub claimed_at_us: Option<i64>,
    pub region: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
