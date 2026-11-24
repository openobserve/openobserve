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

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "secret_backend_identities")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub provider: String,
    pub principal: String,
    pub source: String,
    pub state: String,
    pub incarnation: String,
    pub next_principal: Option<String>,
    pub next_incarnation: Option<String>,
    pub id_account: Option<String>,
    pub policy_hash: String,
    pub desired_gen: i64,
    pub applied_gen: i64,
    pub rotate_requested: bool,
    pub delete_after: Option<i64>,
    pub lease_owner: Option<String>,
    pub lease_until: Option<i64>,
    pub last_verified_at: Option<i64>,
    pub last_error: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
