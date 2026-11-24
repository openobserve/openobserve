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

//! `SeaORM` Entity for the `org_secrets` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "org_secrets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub kind: String,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    #[sea_orm(column_type = "Text")]
    pub allowed_hosts: String,
    pub pin_mode: PinMode,
    #[sea_orm(column_type = "Text")]
    pub pin_override_reason: String,
    pub pin_override_by: String,
    pub pin_override_at: i64,
    pub private_locations: PrivateLocations,
    #[sea_orm(column_type = "Text")]
    pub private_locations_reason: String,
    pub private_locations_by: String,
    pub private_locations_at: i64,
    pub state: String,
    pub policy_rev: String,
    pub policy_version: i64,
    pub policy_stamp: i64,
    pub origin_region: String,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: i64,
    pub purge_after: i64,
    pub purged_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum PinMode {
    #[sea_orm(string_value = "none")]
    None,
    #[sea_orm(string_value = "hosts")]
    Hosts,
    #[sea_orm(string_value = "any")]
    Any,
    #[sea_orm(string_value = "legacy")]
    Legacy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))")]
pub enum PrivateLocations {
    #[sea_orm(string_value = "off")]
    Off,
    #[sea_orm(string_value = "on")]
    On,
    #[sea_orm(string_value = "legacy")]
    Legacy,
}
