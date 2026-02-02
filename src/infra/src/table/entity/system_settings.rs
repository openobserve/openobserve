// Copyright 2025 OpenObserve Inc.
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

//! SeaORM Entity for system_settings table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "system_settings")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub scope: String,
    pub org_id: Option<String>,
    pub user_id: Option<String>,
    pub setting_key: String,
    pub setting_category: Option<String>,
    #[sea_orm(column_type = "JsonBinary")]
    pub setting_value: serde_json::Value,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
