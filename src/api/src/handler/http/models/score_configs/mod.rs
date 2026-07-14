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

use infra::table::score_configs::ScoreConfigDataType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP request body for creating a Score Config.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScoreConfigRequestBody {
    pub name: String,
    #[schema(value_type = String)]
    pub data_type: ScoreConfigDataType,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub numeric_range: Option<serde_json::Value>,
    #[serde(default)]
    pub categories: Option<serde_json::Value>,
    #[serde(default)]
    pub healthy_threshold: Option<serde_json::Value>,
}

/// HTTP request body for updating a Score Config (version bump).
/// If provided, `name` is updated by creating a new version.
/// `data_type` is immutable across versions.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScoreConfigUpdateRequestBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub numeric_range: Option<serde_json::Value>,
    #[serde(default)]
    pub categories: Option<serde_json::Value>,
    #[serde(default)]
    pub healthy_threshold: Option<serde_json::Value>,
}

/// HTTP response body for a Score Config.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScoreConfigResponseBody {
    pub id: String,
    pub entity_id: String,
    pub org_id: String,
    pub name: String,
    pub version: i32,
    #[schema(value_type = String)]
    pub data_type: ScoreConfigDataType,
    pub description: Option<String>,
    pub numeric_range: Option<serde_json::Value>,
    pub categories: Option<serde_json::Value>,
    pub healthy_threshold: Option<serde_json::Value>,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// HTTP response body for listing Score Configs.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListScoreConfigsResponseBody {
    pub list: Vec<ScoreConfigResponseBody>,
}

/// HTTP response body for listing Score Config versions.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListScoreConfigVersionsResponseBody {
    pub versions: Vec<ScoreConfigResponseBody>,
}

impl From<ScoreConfigRequestBody> for infra::table::score_configs::ScoreConfig {
    fn from(value: ScoreConfigRequestBody) -> Self {
        Self {
            id: String::new(),
            entity_id: String::new(),
            org_id: String::new(),
            name: value.name,
            version: 0,
            data_type: value.data_type,
            description: value.description,
            numeric_range: value.numeric_range,
            categories: value.categories,
            healthy_threshold: value.healthy_threshold,
            is_active: true,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl From<ScoreConfigUpdateRequestBody> for infra::table::score_configs::ScoreConfig {
    fn from(value: ScoreConfigUpdateRequestBody) -> Self {
        Self {
            id: String::new(),
            entity_id: String::new(),
            org_id: String::new(),
            name: value.name.unwrap_or_default(),
            version: 0,
            data_type: ScoreConfigDataType::default(),
            description: value.description,
            numeric_range: value.numeric_range,
            categories: value.categories,
            healthy_threshold: value.healthy_threshold,
            is_active: true,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl From<infra::table::score_configs::ScoreConfig> for ScoreConfigResponseBody {
    fn from(value: infra::table::score_configs::ScoreConfig) -> Self {
        Self {
            id: value.id,
            entity_id: value.entity_id,
            org_id: value.org_id,
            name: value.name,
            version: value.version,
            data_type: value.data_type,
            description: value.description,
            numeric_range: value.numeric_range,
            categories: value.categories,
            healthy_threshold: value.healthy_threshold,
            is_active: value.is_active,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<infra::table::score_configs::ScoreConfig>> for ListScoreConfigsResponseBody {
    fn from(value: Vec<infra::table::score_configs::ScoreConfig>) -> Self {
        Self {
            list: value
                .into_iter()
                .map(ScoreConfigResponseBody::from)
                .collect(),
        }
    }
}

impl From<Vec<infra::table::score_configs::ScoreConfig>> for ListScoreConfigVersionsResponseBody {
    fn from(value: Vec<infra::table::score_configs::ScoreConfig>) -> Self {
        Self {
            versions: value
                .into_iter()
                .map(ScoreConfigResponseBody::from)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_config_response_body_from_entity() {
        let config = infra::table::score_configs::ScoreConfig {
            id: "abc".to_string(),
            entity_id: "scfg-entity-1".to_string(),
            org_id: "org1".to_string(),
            name: "faithfulness".to_string(),
            version: 1,
            data_type: ScoreConfigDataType::Numeric,
            description: Some("Measures faithfulness".to_string()),
            numeric_range: Some(serde_json::json!({"min": 0.0, "max": 1.0})),
            categories: None,
            healthy_threshold: Some(serde_json::json!({"direction": "gte", "value": 0.7})),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        };
        let resp = ScoreConfigResponseBody::from(config);
        assert_eq!(resp.entity_id, "scfg-entity-1");
        assert_eq!(resp.name, "faithfulness");
        assert_eq!(resp.version, 1);
        assert_eq!(resp.data_type, ScoreConfigDataType::Numeric);
        assert!(resp.is_active);
    }

    #[test]
    fn test_score_config_request_body_conversion() {
        let body = ScoreConfigRequestBody {
            name: "accuracy".to_string(),
            data_type: ScoreConfigDataType::Numeric,
            description: Some("Accuracy score".to_string()),
            numeric_range: Some(serde_json::json!({"min": 0.0, "max": 100.0})),
            categories: None,
            healthy_threshold: Some(serde_json::json!({"direction": "gte", "value": 80.0})),
        };
        let config = infra::table::score_configs::ScoreConfig::from(body);
        assert!(config.id.is_empty());
        assert_eq!(config.name, "accuracy");
        assert_eq!(config.data_type, ScoreConfigDataType::Numeric);
        assert_eq!(config.version, 0);
    }

    #[test]
    fn test_score_config_request_rejects_catalog_metadata() {
        let result: Result<ScoreConfigRequestBody, _> = serde_json::from_value(serde_json::json!({
            "name": "accuracy",
            "displayName": "Accuracy",
            "category": "Safety & Quality",
            "level": "span",
            "dataType": "numeric",
            "numericRange": {"min": 0.0, "max": 1.0}
        }));

        assert!(result.is_err());
    }

    #[test]
    fn test_list_response_body_from_vec() {
        let configs = vec![
            infra::table::score_configs::ScoreConfig {
                id: "1".to_string(),
                entity_id: "scfg-entity-1".to_string(),
                org_id: "org1".to_string(),
                name: "a".to_string(),
                version: 1,
                data_type: ScoreConfigDataType::Numeric,
                description: None,
                numeric_range: None,
                categories: None,
                healthy_threshold: None,
                is_active: true,
                created_at: 1000,
                updated_at: 2000,
            },
            infra::table::score_configs::ScoreConfig {
                id: "2".to_string(),
                entity_id: "scfg-entity-2".to_string(),
                org_id: "org1".to_string(),
                name: "b".to_string(),
                version: 1,
                data_type: ScoreConfigDataType::Categorical,
                description: None,
                numeric_range: None,
                categories: None,
                healthy_threshold: None,
                is_active: true,
                created_at: 1000,
                updated_at: 2000,
            },
        ];
        let list = ListScoreConfigsResponseBody::from(configs);
        assert_eq!(list.list.len(), 2);
        assert_eq!(list.list[0].name, "a");
        assert_eq!(list.list[1].name, "b");
    }
}
