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

//! `SeaORM` Entity for the `service_versions` registry.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, serde::Serialize)]
#[sea_orm(table_name = "service_versions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub version_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub where_kind: String,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
    pub scope_key: String,
    pub env: String,
    pub version: String,
    pub raw_version: Option<String>,
    pub version_source: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub env_source: String,
    pub env_source_value: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub traces_first_seen: Option<i64>,
    pub traces_last_seen: Option<i64>,
    pub rum_first_seen: Option<i64>,
    pub rum_last_seen: Option<i64>,
    pub deleted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
