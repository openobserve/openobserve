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
#[sea_orm(table_name = "llm_secrets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub secret_ref: String,
    pub org_id: String,
    pub owner_kind: String,
    pub owner_id: String,
    pub purpose: String,
    pub key_id: Option<String>,
    pub state: String,
    /// AES-256-SIV ciphertext encoded as base64. Plaintext never belongs in
    /// an entity or API response.
    pub ciphertext: String,
    pub last_verified_at: Option<i64>,
    pub grace_expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entity_contains_ciphertext_and_not_plaintext() {
        let model = Model {
            id: "value-1".to_string(),
            secret_ref: "secret-1".to_string(),
            org_id: "org".to_string(),
            owner_kind: "task".to_string(),
            owner_id: "task-1".to_string(),
            purpose: "signing".to_string(),
            key_id: Some("key-1".to_string()),
            state: "current".to_string(),
            ciphertext: "encrypted-base64".to_string(),
            last_verified_at: None,
            grace_expires_at: None,
            created_at: 1,
            updated_at: 1,
        };
        assert_eq!(model.ciphertext, "encrypted-base64");
        assert_eq!(model.secret_ref, "secret-1");
    }
}
