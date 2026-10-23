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
#[sea_orm(table_name = "fleets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub fleet_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    pub config_id: Option<String>,
    pub config_version: Option<i64>,
    pub stable_config_id: Option<String>,
    pub stable_config_version: Option<i64>,
    pub updated_at: i64,
    pub updated_by: String,
    /// `config::meta::fleet::FleetSettings`; null inherits every org default.
    #[sea_orm(column_type = "Text", nullable)]
    pub settings: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
