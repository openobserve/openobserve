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

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "synthetics_variables")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// `synthetics_environments.id`, or None for "every environment".
    ///
    /// A `kind = 'secret'` row can never be None — the table's CHECK constraint
    /// enforces it, because the environment is a secret's access boundary.
    pub env: Option<String>,
    /// Stored upper-cased, so `{{base_url}}` and `{{BASE_URL}}` bind the same row.
    pub name: String,
    /// `AESenc:<base64>` under the org DEK, exactly as check secrets are stored.
    pub value: String,
    /// "plain" | "secret"
    pub kind: String,
    pub description: String,
    /// Non-secret hint at the value's shape, shown wherever the value is withheld.
    pub example: String,
    pub tags: Json,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
