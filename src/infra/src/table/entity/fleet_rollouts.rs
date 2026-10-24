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

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "fleet_rollouts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub config_id: String,
    pub from_version: Option<i64>,
    pub to_version: i64,
    pub fleet_id: String,
    pub strategy: String,
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub phases: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub failure: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub events: String,
    pub started_at: i64,
    pub started_by: String,
    #[sea_orm(default_value = 0)]
    pub rev: i64,
    #[sea_orm(default_value = false)]
    pub auto_rollback: bool,
    pub scheduled_for: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub gates: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
