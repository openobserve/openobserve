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

//! `SeaORM` Entity for the `slack_installations` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "slack_installations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub app_id: String,
    pub enterprise_id: String,
    pub team_id: String,
    pub team_name: String,
    pub is_enterprise_install: bool,
    pub bot_user_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub bot_token_enc: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub refresh_token_enc: Option<String>,
    pub token_expires_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub signing_secret_enc: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub app_token_enc: Option<String>,
    pub client_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub client_secret_enc: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub config_refresh_token_enc: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub manifest_options: String,
    pub auto_link_enabled: bool,
    #[sea_orm(column_type = "Text")]
    pub auto_link_domains: String,
    pub mode: String,
    pub scope: String,
    pub org_access: String,
    pub home_region: String,
    pub installed_by: String,
    pub installed_org_id: String,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
