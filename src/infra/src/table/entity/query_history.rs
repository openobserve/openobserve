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

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "query_history")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub user_email: String,
    #[sea_orm(column_type = "Text")]
    pub query: String,
    pub context: Json,
    pub starred: bool,
    /// First run of this row; never changed after insert.
    pub created_at: i64,
    #[sea_orm(column_type = "Text")]
    pub source: String,
    /// Hex sha256 of the merge key; NULL on rows written before the key existed.
    pub query_key: Option<String>,
    /// Comma-wrapped stream list (`,a,b,`), empty when there are none.
    #[sea_orm(column_type = "Text")]
    pub streams: String,
    pub run_count: i64,
    /// Last run of this row.
    pub updated_at: i64,
    #[sea_orm(column_type = "Text")]
    pub status: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
