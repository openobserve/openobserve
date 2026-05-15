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
#[sea_orm(table_name = "eval_templates")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub response_type: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub dimensions: Json,
    pub version: i32,
    pub is_active: bool,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub updated_by: Option<String>,
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
            id: "tmpl-1".to_string(),
            org_id: "org".to_string(),
            response_type: "json".to_string(),
            name: "test_template".to_string(),
            description: None,
            content: "template content".to_string(),
            dimensions: serde_json::json!([]),
            version: 1,
            is_active: true,
            created_by: Some("user1".to_string()),
            created_at: 1000,
            updated_by: None,
            updated_at: 2000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.version, 1);
        assert!(m.is_active);
    }
}
