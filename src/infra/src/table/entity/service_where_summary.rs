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

//! `SeaORM` Entity for the derived `service_where_summary` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, serde::Serialize)]
#[sea_orm(table_name = "service_where_summary")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub summary_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub scope_key: String,
    pub source_stream: String,
    pub signal: String,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub env: String,
    pub env_source: String,
    pub env_source_value: String,
    #[sea_orm(column_type = "Text")]
    pub envs: String,
    pub newest_version: String,
    pub newest_version_key: String,
    pub newest_first_seen: i64,
    pub has_version: bool,
    pub first_seen: i64,
    pub last_seen: i64,
    pub purged_versions: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
