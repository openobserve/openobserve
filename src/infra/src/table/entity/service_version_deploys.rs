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
#[sea_orm(table_name = "service_version_deploys")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub deploy_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub scope_key: String,
    pub cluster: String,
    pub to_version: String,
    pub to_image: Option<String>,
    pub to_version_key: String,
    pub from_version: Option<String>,
    pub from_image: Option<String>,
    pub from_version_key: Option<String>,
    pub kind: String,
    pub entry_source: String,
    pub at: i64,
    pub share_at_entry: f64,
    pub serving_versions: String,
    pub overflow_count: i32,
    pub full_serving: String,
    pub source_streams: String,
    pub source_streams_overflow: bool,
    pub superseded_at: Option<i64>,
    pub verdict_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Model {
    pub fn to_identity(&self) -> config::meta::service_identity::VersionImage {
        config::meta::service_identity::VersionImage {
            version: self.to_version.clone(),
            image: self.to_image.clone(),
        }
    }

    pub fn from_identity(&self) -> Option<config::meta::service_identity::VersionImage> {
        self.from_version
            .as_ref()
            .map(|version| config::meta::service_identity::VersionImage {
                version: version.clone(),
                image: self.from_image.clone(),
            })
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
