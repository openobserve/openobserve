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

//! `SeaORM` Entity for the `slack_link_requests` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "slack_link_requests")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub installation_id: String,
    pub external_user_id: String,
    pub workspace_user_id: String,
    pub channel_id: Option<String>,
    pub thread_ts: Option<String>,
    pub message_ts: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub question_enc: Option<String>,
    pub oidc_nonce: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub redeemed_at: Option<i64>,
    pub discarded_at: Option<i64>,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub held_action: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
