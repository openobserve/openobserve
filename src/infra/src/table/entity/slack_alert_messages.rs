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

//! `SeaORM` Entity for the `slack_alert_messages` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "slack_alert_messages")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub destination_id: String,
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub group_key: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub firing_started_at: i64,
    pub installation_id: String,
    pub channel_id: String,
    pub message_ts: Option<String>,
    pub digest_ts: Option<String>,
    pub reuses_firing_started_at: Option<i64>,
    pub refire_count: i32,
    pub first_fired_at: i64,
    pub state: String,
    pub wanted_seq: i64,
    pub rendered_seq: i64,
    pub pending_since: Option<i64>,
    pub posting_since: Option<i64>,
    pub last_auto_investigated_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub content: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub origin_region: String,
    pub deleted_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
