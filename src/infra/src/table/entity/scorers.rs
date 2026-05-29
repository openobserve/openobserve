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
use serde::{Deserialize, Serialize};

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    Hash,
    EnumIter,
    DeriveActiveEnum,
    Serialize,
    Deserialize,
)]
#[serde(rename_all = "snake_case")]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(50))")]
pub enum ScorerType {
    #[default]
    #[sea_orm(string_value = "llm_judge")]
    LlmJudge,
    #[sea_orm(string_value = "remote")]
    Remote,
}

impl ScorerType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::LlmJudge => "llm_judge",
            Self::Remote => "remote",
        }
    }
}

impl std::str::FromStr for ScorerType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "llm_judge" => Ok(Self::LlmJudge),
            "remote" => Ok(Self::Remote),
            _ => Err(value.to_string()),
        }
    }
}

impl std::fmt::Display for ScorerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PartialEq<&str> for ScorerType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "scorers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    #[sea_orm(column_type = "String(StringLen::N(50))")]
    pub scorer_type: ScorerType,
    pub description: Option<String>,
    pub produces_score_config_id: Option<String>,
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    pub output_schema: Option<Json>,
    pub params: Json,
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
    fn test_model_construction_llm_judge() {
        let m = Model {
            id: "scorer-1".to_string(),
            org_id: "org".to_string(),
            entity_id: "scorer-entity-1".to_string(),
            name: "faithfulness_judge".to_string(),
            version: 1,
            scorer_type: ScorerType::LlmJudge,
            description: Some("LLM-based faithfulness scoring".to_string()),
            produces_score_config_id: Some("scfg-entity-1".to_string()),
            produces_score_config_version: Some(1),
            template: "Evaluate {{input}} and {{output}}".to_string(),
            output_schema: None,
            params: serde_json::json!({
                "provider_id": "prov-1",
                "model": "gpt-4o",
                "temperature": 0.0,
                "max_tokens": 256,
                "output_parsing": "structured",
                "include_reasoning": true,
                "extra_metadata_fields": []
            }),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.scorer_type, "llm_judge");
        assert_eq!(m.version, 1);
        assert!(m.is_active);
    }

    #[test]
    fn test_model_construction_remote() {
        let m = Model {
            id: "scorer-2".to_string(),
            org_id: "org".to_string(),
            entity_id: "scorer-entity-2".to_string(),
            name: "compliance_remote".to_string(),
            version: 1,
            scorer_type: ScorerType::Remote,
            description: None,
            produces_score_config_id: None,
            produces_score_config_version: None,
            template: "Evaluate {{input}}".to_string(),
            output_schema: None,
            params: serde_json::json!({
                "endpoint": "https://api.internal/compliance",
                "http_method": "POST",
                "auth": {"type": "bearer", "token": "xxx"},
                "custom_headers": [],
                "content_type": "application/json",
                "response_content_type": "application/json",
                "timeout_ms": 5000
            }),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.scorer_type, "remote");
        assert!(m.is_active);
    }
}
