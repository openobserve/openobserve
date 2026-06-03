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

//! LLM Judge scorer execution.

use std::{collections::HashMap, time::Instant};

use anyhow::Result;
use infra::{
    provider::{PreparedProvider, ProviderRunParams},
    table::{score_configs::ScoreConfigDataType, scorers::ScorerType},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::schema_derivation::{REASONING_FIELD, derive_output_schema};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmJudgeOutput {
    pub value_numeric: Option<f64>,
    pub value_categorical: Option<String>,
    pub value_boolean: Option<bool>,
    pub reasoning: Option<String>,
    pub metadata: Option<Value>,
    pub raw_response: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub model_used: String,
    pub latency_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ScorerConfig {
    pub scorer_id: String,
    pub scorer_version: String,
    pub scorer_type: ScorerType,
    pub template: String,
    pub params: LlmJudgeParams,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmJudgeParams {
    pub provider_id: String,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub output_parsing: Option<String>,
    pub include_reasoning: Option<bool>,
    pub extra_metadata_fields: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default)]
pub struct ScoreConfigInfo {
    pub score_config_id: Option<String>,
    pub score_config_version: Option<String>,
    pub score_config_name: Option<String>,
    pub data_type: ScoreConfigDataType,
    pub numeric_range: Option<Value>,
    pub categories: Option<Value>,
}

impl From<&infra::table::score_configs::ScoreConfig> for ScoreConfigInfo {
    fn from(score_config: &infra::table::score_configs::ScoreConfig) -> Self {
        Self {
            score_config_id: Some(score_config.id.clone()),
            score_config_version: Some(score_config.version.to_string()),
            score_config_name: Some(score_config.name.clone()),
            data_type: score_config.data_type,
            numeric_range: score_config.numeric_range.clone(),
            categories: score_config.categories.clone(),
        }
    }
}

pub async fn run_llm_judge(
    provider: &PreparedProvider,
    scorer: &ScorerConfig,
    score_config: &ScoreConfigInfo,
    input_variables: &HashMap<String, Value>,
    extra_metadata_fields: &[String],
    include_reasoning: bool,
) -> Result<LlmJudgeOutput> {
    let system_prompt =
        "You are an impartial LLM evaluator. Follow the instructions and output ONLY valid JSON."
            .to_string();
    let user_prompt = render_template(&scorer.template, input_variables);
    let output_schema = derive_output_schema(
        score_config.data_type,
        score_config.numeric_range.as_ref(),
        score_config.categories.as_ref(),
        extra_metadata_fields,
        include_reasoning,
    )?;

    let call_params = ProviderRunParams {
        model: scorer.params.model.clone(),
        system_prompt,
        user_prompt,
        temperature: scorer.params.temperature.unwrap_or(0.0),
        max_tokens: scorer.params.max_tokens.unwrap_or(256),
        response_schema: output_schema.json_schema,
        timeout_ms: scorer.params.timeout_ms.unwrap_or(30_000),
    };

    let start = Instant::now();
    let result = provider.run(&call_params).await?;
    let latency = start.elapsed();

    let metadata = extract_metadata(&result.value, &output_schema.metadata_fields);

    let reasoning = result
        .value
        .get(REASONING_FIELD)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let value_field = &output_schema.value_field;
    let (value_numeric, value_categorical, value_boolean) =
        extract_score_value(&result.value, score_config.data_type, value_field);

    Ok(LlmJudgeOutput {
        value_numeric,
        value_categorical,
        value_boolean,
        reasoning,
        metadata,
        raw_response: result.raw_response,
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        total_tokens: result.total_tokens,
        model_used: result.model_used,
        latency_ms: latency.as_millis() as i64,
    })
}

fn extract_metadata(value: &Value, metadata_fields: &[String]) -> Option<Value> {
    if metadata_fields.is_empty() {
        return None;
    }

    let mut meta = serde_json::json!({});
    for field in metadata_fields {
        if let Some(val) = value.get(field) {
            meta[field] = val.clone();
        }
    }
    if meta.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        None
    } else {
        Some(meta)
    }
}

fn extract_score_value(
    value: &Value,
    data_type: ScoreConfigDataType,
    value_field: &str,
) -> (Option<f64>, Option<String>, Option<bool>) {
    match data_type {
        ScoreConfigDataType::Numeric => {
            (value.get(value_field).and_then(|v| v.as_f64()), None, None)
        }
        ScoreConfigDataType::Categorical => (
            None,
            value
                .get(value_field)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            None,
        ),
        ScoreConfigDataType::Boolean => {
            (None, None, value.get(value_field).and_then(|v| v.as_bool()))
        }
    }
}

pub(super) fn render_template(template: &str, input_variables: &HashMap<String, Value>) -> String {
    let mut result = template.to_string();
    let mut start = 0;
    while let Some(open) = result[start..].find("{{") {
        let abs_open = start + open;
        if let Some(close) = result[abs_open + 2..].find("}}") {
            let abs_close = abs_open + 2 + close;
            let variable = result[abs_open + 2..abs_close].trim();
            let value = get_nested_attr(input_variables, variable);
            result.replace_range(abs_open..abs_close + 2, &value);
            start = abs_open + value.len();
        } else {
            break;
        }
    }
    result
}

pub(super) fn get_nested_attr(attrs: &HashMap<String, Value>, path: &str) -> String {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = attrs.get(parts[0]);
    for part in &parts[1..] {
        current = current.and_then(|v| v.get(part));
    }
    match current {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => attrs
            .get(path)
            .map(|v| match v {
                Value::String(s) => s.clone(),
                v => v.to_string(),
            })
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_numeric_score_from_fixed_score_field() {
        let value = serde_json::json!({
            "score": 0.75,
            "reasoning": "grounded",
            "failure_mode": "none"
        });

        let (numeric, categorical, boolean) =
            extract_score_value(&value, ScoreConfigDataType::Numeric, "score");
        let metadata = extract_metadata(&value, &["failure_mode".to_string()]);

        assert_eq!(numeric, Some(0.75));
        assert_eq!(categorical, None);
        assert_eq!(boolean, None);
        assert_eq!(metadata, Some(serde_json::json!({"failure_mode": "none"})));
    }

    #[test]
    fn extracts_categorical_and_boolean_scores_from_fixed_score_field() {
        let categorical = serde_json::json!({"score": "high"});
        let boolean = serde_json::json!({"score": true});

        assert_eq!(
            extract_score_value(&categorical, ScoreConfigDataType::Categorical, "score"),
            (None, Some("high".to_string()), None)
        );
        assert_eq!(
            extract_score_value(&boolean, ScoreConfigDataType::Boolean, "score"),
            (None, None, Some(true))
        );
    }
}
