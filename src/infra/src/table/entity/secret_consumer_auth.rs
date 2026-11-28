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

//! `SeaORM` Entity for the `secret_consumer_auth` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "secret_consumer_auth")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub consumer_type: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub consumer_id: String,
    pub consumer_name: String,
    pub consumer_rev: i64,
    pub delivery_digest: String,
    #[sea_orm(column_type = "Text")]
    pub dep_digests: String,
    pub authorized_by: String,
    pub via: String,
    pub auth_tag: String,
    pub auth_state: AuthState,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(32))")]
pub enum AuthState {
    #[sea_orm(string_value = "ok")]
    Ok,
    #[sea_orm(string_value = "stale")]
    Stale,
}
