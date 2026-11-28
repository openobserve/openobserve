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

//! `SeaORM` Entity for the `autoresolve_steps` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "autoresolve_steps")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub run_id: String,
    pub revision: i32,
    pub option_id: Option<String>,
    pub seq: i32,
    pub kind: String,
    pub connection_id: String,
    pub connection_name: String,
    pub tool: String,
    #[sea_orm(column_type = "Text")]
    pub arguments: String,
    #[sea_orm(column_type = "Text")]
    pub refs: String,
    pub args_hash: String,
    #[sea_orm(column_type = "Text")]
    pub reason: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub preview: Option<String>,
    pub tool_def_hash: String,
    pub connection_fingerprint: Option<String>,
    pub state: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub result: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub result_raw: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    pub consumed_at_us: Option<i64>,
    pub finished_at_us: Option<i64>,
    pub created_at_us: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
