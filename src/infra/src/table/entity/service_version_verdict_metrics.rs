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

#[derive(
    Clone, Debug, Default, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize,
)]
#[sea_orm(table_name = "service_version_verdict_metrics")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub verdict_key: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub metric: String,
    pub new_value: Option<f64>,
    pub base_value: Option<f64>,
    pub delta: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub ci_kind: String,
    pub badge: String,
    pub band_new: Option<String>,
    pub band_base: Option<String>,
    pub n_new: i64,
    pub n_base: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
