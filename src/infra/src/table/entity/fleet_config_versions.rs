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
#[sea_orm(table_name = "fleet_config_versions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub config_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: i64,
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(column_type = "Text")]
    pub yaml: String,
    pub hash: Vec<u8>,
    #[sea_orm(column_type = "Text")]
    pub message: String,
    pub author: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
