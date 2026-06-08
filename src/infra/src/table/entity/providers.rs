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
#[sea_orm(table_name = "providers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub provider_type: String,
    pub endpoint: Option<String>,
    pub default_model: String,
    pub available_models: Json,
    pub auth_config: Option<String>,
    pub is_default: bool,
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
    fn test_model_construction() {
        let m = Model {
            id: "prov-1".to_string(),
            org_id: "org".to_string(),
            name: "openai".to_string(),
            provider_type: "openai".to_string(),
            endpoint: None,
            default_model: "gpt-4o".to_string(),
            available_models: serde_json::json!(["gpt-4o", "gpt-4o-mini"]),
            auth_config: Some("ciphertext-base64".to_string()),
            is_default: false,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.name, "openai");
        assert!(!m.is_default);
    }
}
