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

//! `SeaORM` Entity for the `autoresolve` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "autoresolve")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub region: String,
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub goal: String,
    #[sea_orm(column_type = "Text")]
    pub connection_ids: String,
    /// A JSON object of connection id to its name at the last save.
    #[sea_orm(column_type = "Text")]
    pub connection_names: String,
    pub trigger_kind: String,
    pub trigger_alert_id: Option<String>,
    pub trigger_enabled: bool,
    pub trigger_approved_by: Option<String>,
    pub trigger_approved_at_us: Option<i64>,
    pub created_by: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
    pub from_run_id: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
