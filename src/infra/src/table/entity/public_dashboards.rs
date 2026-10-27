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

//! `SeaORM` Entity for public_dashboards; `deleted_at` keeps a revoked link for 30 days.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "public_dashboards")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub dashboard_id: String,
    pub slug: String,
    pub name: String,
    // 0 draft, 1 public.
    pub visibility: i32,
    // JSON list of relative and absolute ranges.
    pub time_ranges: Option<String>,
    pub default_range_key: Option<String>,
    pub frozen_variables: Option<String>,
    pub refresh_secs: i32,
    pub dashboard_version: i32,
    pub published_by: String,
    pub enabled: bool,
    pub expires_at: Option<i64>,
    pub created_by: String,
    pub updated_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub rev: i64,
    pub deleted_at: Option<i64>,
    pub last_accessed_at: Option<i64>,
    pub access_count: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
