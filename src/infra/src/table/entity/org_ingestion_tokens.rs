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
#[sea_orm(table_name = "org_ingestion_tokens")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub token: String,
    pub description: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
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
            id: "test-id".to_string(),
            org_id: "org-1".to_string(),
            name: "default".to_string(),
            token: "o2oi_test123".to_string(),
            description: "Default token".to_string(),
            is_default: true,
            enabled: true,
            created_by: "admin@test.com".to_string(),
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.id, "test-id");
        assert_eq!(m.org_id, "org-1");
        assert_eq!(m.name, "default");
        assert!(m.is_default);
        assert!(m.enabled);
    }

    #[test]
    fn test_model_disabled_token() {
        let m = Model {
            id: "test-id".to_string(),
            org_id: "org-1".to_string(),
            name: "test".to_string(),
            token: "o2oi_abc".to_string(),
            description: String::new(),
            is_default: false,
            enabled: false,
            created_by: "admin@test.com".to_string(),
            created_at: 1000,
            updated_at: 2000,
        };
        assert!(!m.is_default);
        assert!(!m.enabled);
        assert_eq!(m.description, "");
    }
}
