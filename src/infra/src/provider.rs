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

use std::{fmt, time::Duration};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ProviderStructuredOutputError {
    pub provider: &'static str,
    pub raw_response: String,
    pub parse_error: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub model_used: String,
    pub latency_ms: i64,
}

impl fmt::Display for ProviderStructuredOutputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Failed to parse structured output from {}: {}",
            self.provider, self.parse_error
        )
    }
}

impl std::error::Error for ProviderStructuredOutputError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    Ollama,
}

impl ProviderKind {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_lowercase().as_str() {
            "openai" => Ok(Self::OpenAi),
            "anthropic" => Ok(Self::Anthropic),
            "ollama" => Ok(Self::Ollama),
            other => anyhow::bail!("Unsupported provider type: {other}"),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Ollama => "ollama",
        }
    }

    fn default_run_endpoint(&self) -> &'static str {
        match self {
            Self::OpenAi => "https://api.openai.com/v1/chat/completions",
            Self::Anthropic => "https://api.anthropic.com/v1/messages",
            Self::Ollama => "http://localhost:11434/api/generate",
        }
    }

    fn default_test_endpoint(&self) -> &'static str {
        match self {
            Self::OpenAi => "https://api.openai.com/v1/models",
            Self::Anthropic => "https://api.anthropic.com/v1/messages",
            Self::Ollama => "http://localhost:11434/api/tags",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderAuth {
    ApiKey(String),
    None,
}

impl ProviderAuth {
    fn parse_for_kind(kind: ProviderKind, auth_config: &Value) -> Result<Self> {
        match kind {
            ProviderKind::OpenAi | ProviderKind::Anthropic => {
                let api_key = auth_config
                    .get("api_key")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "No API key found in auth_config for provider type {}",
                            kind.as_str()
                        )
                    })?;
                Ok(Self::ApiKey(api_key.to_string()))
            }
            ProviderKind::Ollama => Ok(Self::None),
        }
    }

    fn api_key(&self) -> &str {
        match self {
            Self::ApiKey(key) => key,
            Self::None => "",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RawProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub endpoint: Option<String>,
    pub default_model: String,
    pub available_models: Vec<String>,
    pub auth_config: Value,
}

impl From<&crate::table::providers::Provider> for RawProviderConfig {
    fn from(value: &crate::table::providers::Provider) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            provider_type: value.provider_type.clone(),
            endpoint: value.endpoint.clone(),
            default_model: value.default_model.clone(),
            available_models: value.available_models.clone(),
            auth_config: value.auth_config.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreparedProvider {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub endpoint: String,
    pub default_model: String,
    pub available_models: Vec<String>,
    pub auth: ProviderAuth,
}

impl PreparedProvider {
    pub fn parse(raw: RawProviderConfig) -> Result<Self> {
        let kind = ProviderKind::parse(&raw.provider_type)?;
        let default_model = raw.default_model.trim().to_string();
        if default_model.is_empty() {
            anyhow::bail!("Provider default_model cannot be empty");
        }

        let endpoint = raw
            .endpoint
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| kind.default_run_endpoint())
            .to_string();
        reqwest::Url::parse(&endpoint)
            .map_err(|e| anyhow::anyhow!("Invalid provider endpoint '{endpoint}': {e}"))?;

        let auth = ProviderAuth::parse_for_kind(kind, &raw.auth_config)?;

        Ok(Self {
            id: raw.id,
            name: raw.name,
            kind,
            endpoint,
            default_model,
            available_models: raw.available_models,
            auth,
        })
    }

    pub fn model_or_default(&self, model: Option<&str>) -> String {
        model
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(&self.default_model)
            .to_string()
    }

    pub async fn run(&self, params: &ProviderRunParams) -> Result<ProviderCallResult> {
        let call_params = ProviderCallParams {
            endpoint: self.endpoint.clone(),
            api_key: self.auth.api_key().to_string(),
            model: self.model_or_default(params.model.as_deref()),
            system_prompt: params.system_prompt.clone(),
            user_prompt: params.user_prompt.clone(),
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            response_schema: params.response_schema.clone(),
            timeout_ms: params.timeout_ms,
        };
        call_provider(self.kind, &call_params).await
    }

    pub async fn test_connection(&self) -> Result<String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;

        let response = match self.kind {
            ProviderKind::OpenAi => {
                client
                    .get(self.kind.default_test_endpoint())
                    .header("Authorization", format!("Bearer {}", self.auth.api_key()))
                    .send()
                    .await
            }
            ProviderKind::Anthropic => {
                client
                    .post(self.kind.default_test_endpoint())
                    .header("x-api-key", self.auth.api_key())
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json")
                    .json(&serde_json::json!({
                        "model": self.default_model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}]
                    }))
                    .send()
                    .await
            }
            ProviderKind::Ollama => client.get(self.kind.default_test_endpoint()).send().await,
        };

        match response {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    Ok(format!(
                        "Successfully connected to {} provider (status: {})",
                        self.kind.as_str(),
                        status
                    ))
                } else {
                    let body = resp.text().await.unwrap_or_default();
                    Ok(format!(
                        "Provider returned status {}: {}",
                        status,
                        &body[..body.len().min(200)]
                    ))
                }
            }
            Err(e) => Ok(format!("Connection failed: {e}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRunParams {
    pub model: Option<String>,
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub response_schema: Value,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCallParams {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub response_schema: Value,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCallResult {
    pub value: Value,
    pub raw_response: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub model_used: String,
    pub latency_ms: i64,
}

async fn call_openai(params: &ProviderCallParams) -> Result<ProviderCallResult> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(params.timeout_ms))
        .build()?;

    let start = std::time::Instant::now();

    let mut body = serde_json::json!({
        "model": params.model,
        "messages": [
            {"role": "system", "content": params.system_prompt},
            {"role": "user", "content": params.user_prompt},
        ],
        "temperature": params.temperature,
        "max_tokens": params.max_tokens,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "score_output",
                "strict": true,
                "schema": params.response_schema,
            }
        }
    });

    if params.max_tokens == 0 {
        body.as_object_mut().unwrap().remove("max_tokens");
    }

    let resp = client
        .post(&params.endpoint)
        .header("Authorization", format!("Bearer {}", params.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let latency = start.elapsed();
    let status = resp.status();

    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("OpenAI returned {}: {}", status, err_body);
    }

    let raw: Value = resp.json().await?;
    let content = raw["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    let parsed: Value =
        serde_json::from_str(content).map_err(|e| ProviderStructuredOutputError {
            provider: "OpenAI",
            raw_response: content.to_string(),
            parse_error: e.to_string(),
            prompt_tokens: raw["usage"]["prompt_tokens"].as_i64(),
            completion_tokens: raw["usage"]["completion_tokens"].as_i64(),
            total_tokens: raw["usage"]["total_tokens"].as_i64(),
            model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
            latency_ms: latency.as_millis() as i64,
        })?;

    Ok(ProviderCallResult {
        value: parsed,
        raw_response: content.to_string(),
        prompt_tokens: raw["usage"]["prompt_tokens"].as_i64(),
        completion_tokens: raw["usage"]["completion_tokens"].as_i64(),
        total_tokens: raw["usage"]["total_tokens"].as_i64(),
        model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
        latency_ms: latency.as_millis() as i64,
    })
}

async fn call_anthropic(params: &ProviderCallParams) -> Result<ProviderCallResult> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(params.timeout_ms))
        .build()?;

    let start = std::time::Instant::now();

    let mut body = serde_json::json!({
        "model": params.model,
        "max_tokens": if params.max_tokens > 0 { params.max_tokens } else { 1024 },
        "system": params.system_prompt,
        "messages": [
            {"role": "user", "content": params.user_prompt},
        ],
        "temperature": params.temperature,
    });

    if let Some(messages) = body.get_mut("messages")
        && let Some(last_msg) = messages.as_array_mut().and_then(|a| a.last_mut())
    {
        let schema_str = serde_json::to_string(&params.response_schema).unwrap_or_default();
        let original = last_msg["content"].as_str().unwrap_or("");
        let instr = format!(
            "{}\n\nYou MUST respond ONLY with a valid JSON object matching this schema: {}",
            original, schema_str
        );
        last_msg["content"] = Value::String(instr);
    }

    let resp = client
        .post(&params.endpoint)
        .header("x-api-key", &params.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let latency = start.elapsed();
    let status = resp.status();

    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Anthropic returned {}: {}", status, err_body);
    }

    let raw: Value = resp.json().await?;
    let content = raw["content"][0]["text"].as_str().unwrap_or("");

    let cleaned = strip_markdown_code_block(content);
    let parsed: Value =
        serde_json::from_str(&cleaned).map_err(|e| ProviderStructuredOutputError {
            provider: "Anthropic",
            raw_response: content.to_string(),
            parse_error: e.to_string(),
            prompt_tokens: raw["usage"]["input_tokens"].as_i64(),
            completion_tokens: raw["usage"]["output_tokens"].as_i64(),
            total_tokens: raw["usage"]["input_tokens"]
                .as_i64()
                .zip(raw["usage"]["output_tokens"].as_i64())
                .map(|(p, c)| p + c),
            model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
            latency_ms: latency.as_millis() as i64,
        })?;

    Ok(ProviderCallResult {
        value: parsed,
        raw_response: cleaned,
        prompt_tokens: raw["usage"]["input_tokens"].as_i64(),
        completion_tokens: raw["usage"]["output_tokens"].as_i64(),
        total_tokens: raw["usage"]["input_tokens"]
            .as_i64()
            .zip(raw["usage"]["output_tokens"].as_i64())
            .map(|(p, c)| p + c),
        model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
        latency_ms: latency.as_millis() as i64,
    })
}

async fn call_ollama(params: &ProviderCallParams) -> Result<ProviderCallResult> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(params.timeout_ms))
        .build()?;

    let start = std::time::Instant::now();

    let user_prompt = {
        let schema_str = serde_json::to_string(&params.response_schema).unwrap_or_default();
        format!(
            "{}\n\nRespond ONLY with a valid JSON object conforming to this JSON schema: {}",
            params.user_prompt, schema_str
        )
    };

    let body = serde_json::json!({
        "model": params.model,
        "system": params.system_prompt,
        "prompt": user_prompt,
        "stream": false,
        "format": "json",
        "options": {
            "temperature": params.temperature,
        }
    });

    let resp = client
        .post(&params.endpoint)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let latency = start.elapsed();
    let status = resp.status();

    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Ollama returned {}: {}", status, err_body);
    }

    let raw: Value = resp.json().await?;
    let content = raw["response"].as_str().unwrap_or("");

    let cleaned = strip_markdown_code_block(content);
    let parsed: Value =
        serde_json::from_str(&cleaned).map_err(|e| ProviderStructuredOutputError {
            provider: "Ollama",
            raw_response: content.to_string(),
            parse_error: e.to_string(),
            prompt_tokens: raw.get("prompt_eval_count").and_then(|v| v.as_i64()),
            completion_tokens: raw.get("eval_count").and_then(|v| v.as_i64()),
            total_tokens: None,
            model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
            latency_ms: latency.as_millis() as i64,
        })?;

    Ok(ProviderCallResult {
        value: parsed,
        raw_response: cleaned,
        prompt_tokens: raw.get("prompt_eval_count").and_then(|v| v.as_i64()),
        completion_tokens: raw.get("eval_count").and_then(|v| v.as_i64()),
        total_tokens: None,
        model_used: raw["model"].as_str().unwrap_or(&params.model).to_string(),
        latency_ms: latency.as_millis() as i64,
    })
}

async fn call_provider(
    provider_kind: ProviderKind,
    params: &ProviderCallParams,
) -> Result<ProviderCallResult> {
    match provider_kind {
        ProviderKind::OpenAi => call_openai(params).await,
        ProviderKind::Anthropic => call_anthropic(params).await,
        ProviderKind::Ollama => call_ollama(params).await,
    }
}

fn strip_markdown_code_block(text: &str) -> String {
    let text = text.trim();
    if text.starts_with("```") {
        let end = text.rfind("```").unwrap_or(text.len());
        let inner = &text[3..end].trim();
        if inner.starts_with("json") || inner.starts_with("JSON") {
            let trimmed = inner[4..].trim();
            return trimmed.to_string();
        }
        return inner.to_string();
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_provider(provider_type: &str, auth_config: Value) -> RawProviderConfig {
        RawProviderConfig {
            id: "prov-1".to_string(),
            name: "Test".to_string(),
            provider_type: provider_type.to_string(),
            endpoint: None,
            default_model: "model-1".to_string(),
            available_models: vec![],
            auth_config,
        }
    }

    #[test]
    fn parses_openai_provider_with_api_key() {
        let provider = PreparedProvider::parse(raw_provider(
            "openai",
            serde_json::json!({"api_key": "sk-test"}),
        ))
        .unwrap();

        assert_eq!(provider.kind, ProviderKind::OpenAi);
        assert_eq!(
            provider.endpoint,
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(provider.auth, ProviderAuth::ApiKey("sk-test".to_string()));
    }

    #[test]
    fn rejects_openai_provider_without_api_key() {
        let err = PreparedProvider::parse(raw_provider("openai", serde_json::json!({})))
            .unwrap_err()
            .to_string();

        assert!(err.contains("No API key"));
    }

    #[test]
    fn parses_ollama_provider_without_auth() {
        let provider = PreparedProvider::parse(raw_provider("ollama", Value::Null)).unwrap();

        assert_eq!(provider.kind, ProviderKind::Ollama);
        assert_eq!(provider.auth, ProviderAuth::None);
    }

    #[test]
    fn rejects_unsupported_provider_type() {
        let err = PreparedProvider::parse(raw_provider(
            "custom",
            serde_json::json!({"api_key": "test"}),
        ))
        .unwrap_err()
        .to_string();

        assert!(err.contains("Unsupported provider type"));
    }

    #[test]
    fn rejects_invalid_custom_endpoint() {
        let mut raw = raw_provider("openai", serde_json::json!({"api_key": "sk-test"}));
        raw.endpoint = Some("not a url".to_string());

        let err = PreparedProvider::parse(raw).unwrap_err().to_string();

        assert!(err.contains("Invalid provider endpoint"));
    }

    #[test]
    fn rejects_empty_default_model() {
        let mut raw = raw_provider("ollama", Value::Null);
        raw.default_model = "  ".to_string();

        let err = PreparedProvider::parse(raw).unwrap_err().to_string();

        assert!(err.contains("default_model"));
    }

    #[test]
    fn strips_markdown_code_block() {
        assert_eq!(strip_markdown_code_block("hello"), "hello");
        assert_eq!(
            strip_markdown_code_block("```json\n{\"x\":1}\n```"),
            "{\"x\":1}"
        );
        assert_eq!(strip_markdown_code_block("```\nplain\n```"), "plain");
    }

    #[test]
    fn provider_call_params_serializes() {
        let params = ProviderCallParams {
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
            system_prompt: "You are a judge.".to_string(),
            user_prompt: "Evaluate this.".to_string(),
            temperature: 0.0,
            max_tokens: 256,
            response_schema: serde_json::json!({"type": "object"}),
            timeout_ms: 30000,
        };
        let json = serde_json::to_string(&params).unwrap();
        let back: ProviderCallParams = serde_json::from_str(&json).unwrap();
        assert_eq!(back.model, "gpt-4o");
        assert_eq!(back.temperature, 0.0);
    }
}
