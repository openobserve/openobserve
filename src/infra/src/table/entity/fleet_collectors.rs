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

#[derive(Clone, Debug, Default, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "fleet_collectors")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub ip: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub distribution: Option<String>,
    pub version: Option<String>,
    pub capabilities: Option<i64>,
    pub capabilities_at: Option<i64>,
    pub healthy: Option<bool>,
    #[sea_orm(column_type = "Text", nullable)]
    pub health: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub effective_config: Option<String>,
    pub effective_hash: Option<Vec<u8>>,
    pub remote_status: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub remote_error: Option<String>,
    pub remote_hash: Option<Vec<u8>>,
    pub description_at: Option<i64>,
    pub health_at: Option<i64>,
    pub effective_at: Option<i64>,
    pub remote_status_at: Option<i64>,
    pub enrolled_at: i64,
    pub last_seen_at: i64,
    pub token_id: Option<String>,
    #[sea_orm(default_value = 0)]
    pub assignment_rev: i64,
    pub config_id: Option<String>,
    pub config_version: Option<i64>,
    pub desired_hash: Option<Vec<u8>>,
    pub assigned_at: Option<i64>,
    pub active_rollout_id: Option<String>,
    pub applied_at: Option<i64>,
    pub sent_rev: Option<i64>,
    pub sent_at: Option<i64>,
    pub effective_config_id: Option<String>,
    pub effective_config_version: Option<i64>,
    #[sea_orm(default_value = 0)]
    pub heartbeats: i64,
    #[sea_orm(default_value = "default")]
    pub fleet_id: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
