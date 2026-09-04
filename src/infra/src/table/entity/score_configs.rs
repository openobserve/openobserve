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
#[sea_orm(table_name = "score_configs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    pub data_type: String,
    pub description: Option<String>,
    pub numeric_range: Option<Json>,
    pub categories: Option<Json>,
    pub healthy_threshold: Option<Json>,
    pub is_active: bool,
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
            id: "sc-1".to_string(),
            org_id: "org".to_string(),
            entity_id: "scfg-entity-1".to_string(),
            name: "faithfulness".to_string(),
            version: 1,
            data_type: "numeric".to_string(),
            description: Some("Measures factual accuracy".to_string()),
            numeric_range: Some(serde_json::json!({"min": 0.0, "max": 1.0})),
            categories: None,
            healthy_threshold: Some(serde_json::json!({"direction": "gte", "value": 0.7})),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.entity_id, "scfg-entity-1");
        assert_eq!(m.name, "faithfulness");
        assert_eq!(m.version, 1);
        assert_eq!(m.data_type, "numeric");
        assert!(m.is_active);
    }
}
