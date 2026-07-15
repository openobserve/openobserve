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

use infra::table::scorers::ScorerType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::service::llm_evaluations::scorers::schema_derivation::ExtraMetadataField;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LlmJudgeScorerParams {
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_parsing: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_reasoning: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_metadata_fields: Option<Vec<ExtraMetadataField>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct RemoteScorerParams {
    pub endpoint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<RemoteScorerAuth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_headers: Option<Vec<RemoteScorerHeader>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RemoteScorerAuth {
    None,
    Bearer { token: String },
    Basic { username: String, password: String },
    ApiKey { token: String, header_name: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RemoteScorerHeader {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScorerCreateConfig {
    LlmJudge(LlmJudgeScorerRequest),
    Remote(RemoteScorerRequest),
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmJudgeScorerRequest {
    #[serde(default)]
    pub produces_score_config_id: Option<String>,
    #[serde(default)]
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    #[serde(default)]
    pub output_schema: Option<Value>,
    pub params: LlmJudgeScorerParams,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteScorerRequest {
    #[serde(default)]
    pub produces_score_config_id: Option<String>,
    #[serde(default)]
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    pub params: RemoteScorerParams,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScorerUpdateConfig {
    LlmJudge(LlmJudgeScorerUpdateRequest),
    Remote(RemoteScorerUpdateRequest),
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmJudgeScorerUpdateRequest {
    #[serde(default)]
    pub produces_score_config_id: Option<String>,
    #[serde(default)]
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    #[serde(default)]
    pub output_schema: Option<Value>,
    pub params: LlmJudgeScorerParams,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteScorerUpdateRequest {
    #[serde(default)]
    pub produces_score_config_id: Option<String>,
    #[serde(default)]
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    pub params: RemoteScorerParams,
}

fn params_to_value<T: Serialize>(params: T) -> Value {
    serde_json::to_value(params).unwrap_or_else(|_| serde_json::json!({}))
}

/// HTTP request body for creating a Scorer.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScorerRequestBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub scorer: ScorerCreateConfig,
}

/// HTTP request body for updating a Scorer (version bump).
/// `scorer_type` and `produces_score_config_id` are immutable.
/// If provided, `name` is updated by creating a new version.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScorerUpdateRequestBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub scorer: ScorerUpdateConfig,
}

/// HTTP response body for a Scorer.
#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScorerResponseBody {
    pub id: String,
    pub entity_id: String,
    pub org_id: String,
    pub name: String,
    pub version: i32,
    #[schema(value_type = String)]
    pub scorer_type: ScorerType,
    pub description: Option<String>,
    pub produces_score_config_id: Option<String>,
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    pub variables: Vec<String>,
    pub output_schema: Option<Value>,
    pub params: Value,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// HTTP response body for listing Scorers.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListScorersResponseBody {
    pub list: Vec<ScorerResponseBody>,
}

/// HTTP response body for listing Scorer versions.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListScorerVersionsResponseBody {
    pub versions: Vec<ScorerResponseBody>,
}

/// Query string params for listing scorers.
#[derive(Clone, Debug, Deserialize, Default, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListScorersQuery {
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub scorer_type: Option<ScorerType>,
}

/// HTTP request body for testing a scorer.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScorerTestRequestBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub scorer: ScorerCreateConfig,
    /// Values for the variables referenced by the template.
    #[serde(alias = "input_variables")]
    pub input_variables: Value,
}

/// Request body for previewing the derived LLM Judge output schema.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmJudgeOutputSchemaRequestBody {
    #[serde(default)]
    pub produces_score_config_id: Option<String>,
    #[serde(default)]
    pub produces_score_config_version: Option<i32>,
    #[serde(default)]
    pub include_reasoning: Option<bool>,
    #[serde(default)]
    pub extra_metadata_fields: Vec<ExtraMetadataField>,
}

/// Response body for a derived LLM Judge output schema preview.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LlmJudgeOutputSchemaResponseBody {
    pub output_schema: Value,
}

pub fn extract_template_variables(template: &str) -> Vec<String> {
    let mut variables = Vec::new();
    let mut start = 0;
    while let Some(open) = template[start..].find("{{") {
        let abs_open = start + open;
        if let Some(close) = template[abs_open + 2..].find("}}") {
            let abs_close = abs_open + 2 + close;
            let variable = template[abs_open + 2..abs_close].trim();
            if !variable.is_empty() && !variables.iter().any(|v| v == variable) {
                variables.push(variable.to_string());
            }
            start = abs_close + 2;
        } else {
            break;
        }
    }
    variables
}

/// HTTP response body for scorer test results.
#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScorerTestResponseBody {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_numeric: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_categorical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_boolean: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_used: Option<String>,
    pub latency_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

impl From<ScorerRequestBody> for infra::table::scorers::Scorer {
    fn from(value: ScorerRequestBody) -> Self {
        let (
            scorer_type,
            produces_score_config_id,
            produces_score_config_version,
            template,
            output_schema,
            params,
        ) = match value.scorer {
            ScorerCreateConfig::LlmJudge(scorer) => (
                ScorerType::LlmJudge,
                scorer.produces_score_config_id,
                scorer.produces_score_config_version,
                scorer.template,
                None,
                params_to_value(scorer.params),
            ),
            ScorerCreateConfig::Remote(scorer) => (
                ScorerType::Remote,
                scorer.produces_score_config_id,
                scorer.produces_score_config_version,
                scorer.template,
                None,
                params_to_value(scorer.params),
            ),
        };

        Self {
            id: String::new(),
            entity_id: String::new(),
            org_id: String::new(),
            name: value.name,
            version: 0,
            scorer_type,
            description: value.description,
            produces_score_config_id,
            produces_score_config_version,
            template,
            output_schema,
            params,
            is_active: true,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl From<ScorerUpdateRequestBody> for infra::table::scorers::Scorer {
    fn from(value: ScorerUpdateRequestBody) -> Self {
        let (
            scorer_type,
            produces_score_config_id,
            produces_score_config_version,
            template,
            output_schema,
            params,
        ) = match value.scorer {
            ScorerUpdateConfig::LlmJudge(scorer) => (
                ScorerType::LlmJudge,
                scorer.produces_score_config_id,
                scorer.produces_score_config_version,
                scorer.template,
                None,
                params_to_value(scorer.params),
            ),
            ScorerUpdateConfig::Remote(scorer) => (
                ScorerType::Remote,
                scorer.produces_score_config_id,
                scorer.produces_score_config_version,
                scorer.template,
                None,
                params_to_value(scorer.params),
            ),
        };

        Self {
            id: String::new(),
            entity_id: String::new(),
            org_id: String::new(),
            name: value.name.unwrap_or_default(),
            version: 0,
            scorer_type,
            description: value.description,
            produces_score_config_id,
            produces_score_config_version,
            template,
            output_schema,
            params,
            is_active: true,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl From<infra::table::scorers::Scorer> for ScorerResponseBody {
    fn from(value: infra::table::scorers::Scorer) -> Self {
        Self {
            id: value.id,
            entity_id: value.entity_id,
            org_id: value.org_id,
            name: value.name,
            version: value.version,
            scorer_type: value.scorer_type,
            description: value.description,
            produces_score_config_id: value.produces_score_config_id,
            produces_score_config_version: value.produces_score_config_version,
            template: value.template.clone(),
            variables: extract_template_variables(&value.template),
            output_schema: value.output_schema,
            params: value.params,
            is_active: value.is_active,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<infra::table::scorers::Scorer>> for ListScorersResponseBody {
    fn from(value: Vec<infra::table::scorers::Scorer>) -> Self {
        Self {
            list: value.into_iter().map(ScorerResponseBody::from).collect(),
        }
    }
}

impl From<Vec<infra::table::scorers::Scorer>> for ListScorerVersionsResponseBody {
    fn from(value: Vec<infra::table::scorers::Scorer>) -> Self {
        Self {
            versions: value.into_iter().map(ScorerResponseBody::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scorer() -> infra::table::scorers::Scorer {
        infra::table::scorers::Scorer {
            id: "abc".to_string(),
            entity_id: "scorer-entity-1".to_string(),
            org_id: "org1".to_string(),
            name: "faithfulness_judge".to_string(),
            version: 1,
            scorer_type: ScorerType::LlmJudge,
            description: Some("Judge faithfulness".to_string()),
            produces_score_config_id: Some("scfg-entity-1".to_string()),
            produces_score_config_version: Some(1),
            template: "Judge {{input}} and {{output}}".to_string(),
            output_schema: None,
            params: serde_json::json!({"provider_id": "p1", "model": "gpt-4"}),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_scorer_response_body_from_entity() {
        let s = sample_scorer();
        let resp = ScorerResponseBody::from(s);
        assert_eq!(resp.entity_id, "scorer-entity-1");
        assert_eq!(resp.name, "faithfulness_judge");
        assert_eq!(resp.scorer_type, "llm_judge");
        assert_eq!(resp.version, 1);
        assert_eq!(resp.produces_score_config_version, Some(1));
        assert_eq!(
            resp.variables,
            vec!["input".to_string(), "output".to_string()]
        );
        assert!(resp.is_active);
    }

    #[test]
    fn test_scorer_request_body_conversion() {
        let body = ScorerRequestBody {
            name: "acc_judge".to_string(),
            description: None,
            scorer: ScorerCreateConfig::LlmJudge(LlmJudgeScorerRequest {
                produces_score_config_id: Some("scfg-entity-1".to_string()),
                produces_score_config_version: Some(1),
                template: "Judge {{input}}".to_string(),
                output_schema: Some(serde_json::json!({"type": "object"})),
                params: LlmJudgeScorerParams {
                    provider_id: "p1".to_string(),
                    model: Some("gpt-4o".to_string()),
                    temperature: Some(0.0),
                    max_tokens: None,
                    timeout_ms: None,
                    output_parsing: None,
                    include_reasoning: Some(true),
                    extra_metadata_fields: None,
                },
            }),
        };
        let scorer = infra::table::scorers::Scorer::from(body);
        assert!(scorer.id.is_empty());
        assert_eq!(scorer.name, "acc_judge");
        assert_eq!(scorer.scorer_type, "llm_judge");
        assert_eq!(scorer.produces_score_config_version, Some(1));
        assert_eq!(scorer.template, "Judge {{input}}");
        assert_eq!(scorer.params["provider_id"], "p1");
    }

    #[test]
    fn test_scorer_test_request_body_matches_create_payload_plus_input_variables() {
        let body: ScorerTestRequestBody = serde_json::from_value(serde_json::json!({
            "name": "draft scorer",
            "description": "Draft test scorer",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": "scfg-entity-1",
                "producesScoreConfigVersion": 2,
                "template": "Judge {{input}}",
                "params": {
                    "provider_id": "p1"
                }
            },
            "inputVariables": {
                "input": "hello"
            }
        }))
        .unwrap();

        assert_eq!(body.name, "draft scorer");
        assert_eq!(body.description.as_deref(), Some("Draft test scorer"));
        assert_eq!(body.input_variables["input"], "hello");
        match body.scorer {
            ScorerCreateConfig::LlmJudge(scorer) => {
                assert_eq!(
                    scorer.produces_score_config_id.as_deref(),
                    Some("scfg-entity-1")
                );
                assert_eq!(scorer.produces_score_config_version, Some(2));
                assert_eq!(scorer.params.provider_id, "p1");
            }
            ScorerCreateConfig::Remote(_) => panic!("expected llm_judge scorer"),
        }
    }

    #[test]
    fn test_scorer_test_request_rejects_score_config_details() {
        let result: Result<ScorerTestRequestBody, _> = serde_json::from_value(serde_json::json!({
            "name": "draft scorer",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": "scfg-entity-1",
                "template": "Judge {{input}}",
                "params": {
                    "provider_id": "p1"
                }
            },
            "scoreConfig": {"dataType": "numeric"},
            "inputVariables": {
                "input": "hello"
            }
        }));

        assert!(result.is_err());
    }

    #[test]
    fn test_llm_judge_request_deserialize_without_output_schema() {
        let body: ScorerRequestBody = serde_json::from_value(serde_json::json!({
            "name": "acc_judge",
            "scorer": {
                "type": "llm_judge",
                "producesScoreConfigId": "scfg-entity-1",
                "template": "Judge {{input}}",
                "params": {
                    "provider_id": "p1",
                    "include_reasoning": true,
                    "extra_metadata_fields": [
                        {
                            "name": "failure_mode",
                            "type": "string",
                            "description": "Reason the score is low"
                        }
                    ]
                }
            }
        }))
        .unwrap();

        let scorer = infra::table::scorers::Scorer::from(body);
        assert_eq!(scorer.scorer_type, "llm_judge");
        assert!(scorer.output_schema.is_none());
        assert_eq!(
            scorer.params["extra_metadata_fields"][0]["name"],
            "failure_mode"
        );
        assert_eq!(scorer.params["extra_metadata_fields"][0]["type"], "string");
        assert_eq!(
            scorer.params["extra_metadata_fields"][0]["description"],
            "Reason the score is low"
        );
    }

    #[test]
    fn test_remote_scorer_request_deserialize_rejects_response_paths() {
        let result: Result<ScorerRequestBody, _> = serde_json::from_value(serde_json::json!({
            "name": "remote",
            "scorer": {
                "type": "remote",
                "producesScoreConfigId": null,
                "template": "{\"input\": \"{{input}}\"}",
                "params": {
                    "endpoint": "http://localhost:8000/evaluate",
                    "http_method": "POST",
                    "auth": {"type": "bearer", "token": "token-1"},
                    "content_type": "application/json",
                    "response_value_path": "value",
                    "timeout_ms": 60000,
                    "max_retries": 1
                }
            }
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_remote_scorer_request_deserialize() {
        let body: ScorerRequestBody = serde_json::from_value(serde_json::json!({
            "name": "remote",
            "scorer": {
                "type": "remote",
                "producesScoreConfigId": null,
                "template": "{\"input\": \"{{input}}\"}",
                "params": {
                    "endpoint": "http://localhost:8000/evaluate",
                    "http_method": "POST",
                    "auth": {"type": "bearer", "token": "token-1"},
                    "content_type": "application/json",
                    "timeout_ms": 60000,
                    "max_retries": 1
                }
            }
        }))
        .unwrap();

        match body.scorer {
            ScorerCreateConfig::Remote(remote) => {
                assert_eq!(remote.params.endpoint, "http://localhost:8000/evaluate");
                assert_eq!(remote.params.http_method.as_deref(), Some("POST"));
            }
            ScorerCreateConfig::LlmJudge(_) => panic!("expected remote scorer"),
        }
    }

    #[test]
    fn test_scorer_update_request_body_omits_immutable_fields() {
        let body = ScorerUpdateRequestBody {
            description: Some("Updated".to_string()),
            name: None,
            scorer: ScorerUpdateConfig::LlmJudge(LlmJudgeScorerUpdateRequest {
                produces_score_config_id: Some("scfg-entity-1".to_string()),
                produces_score_config_version: Some(2),
                template: "Judge {{input}}".to_string(),
                output_schema: None,
                params: LlmJudgeScorerParams {
                    provider_id: "p1".to_string(),
                    model: Some("gpt-4o".to_string()),
                    temperature: None,
                    max_tokens: None,
                    timeout_ms: None,
                    output_parsing: None,
                    include_reasoning: None,
                    extra_metadata_fields: None,
                },
            }),
        };
        let scorer = infra::table::scorers::Scorer::from(body);
        assert!(scorer.name.is_empty());
        assert_eq!(
            scorer.produces_score_config_id,
            Some("scfg-entity-1".to_string())
        );
        assert_eq!(scorer.produces_score_config_version, Some(2));
    }

    #[test]
    fn test_list_scorers_response_body() {
        let s = sample_scorer();
        let list = ListScorersResponseBody::from(vec![s]);
        assert_eq!(list.list.len(), 1);
        assert_eq!(list.list[0].name, "faithfulness_judge");
    }
}
