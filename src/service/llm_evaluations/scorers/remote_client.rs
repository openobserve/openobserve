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

//! Remote scorer HTTP client.

use std::{collections::HashMap, time::Duration};

use anyhow::Result;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteScorerOutput {
    pub value: Value,
    pub reasoning: Option<String>,
    pub metadata: Option<Value>,
    pub raw_response: String,
    pub latency_ms: i64,
}

#[derive(Debug, Clone)]
pub struct RemoteScorerConfig {
    pub endpoint: String,
    pub http_method: String,
    pub auth_type: String,
    pub auth_token: Option<String>,
    pub auth_username: Option<String>,
    pub auth_password: Option<String>,
    pub api_key_header: Option<String>,
    pub custom_headers: Vec<(String, String)>,
    pub content_type: String,
    pub request_body_template: Option<String>,
    pub timeout_ms: u64,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct RemoteScorerParams {
    pub endpoint: String,
    pub http_method: Option<String>,
    pub auth: Option<RemoteScorerAuth>,
    pub custom_headers: Option<Vec<RemoteScorerHeader>>,
    pub content_type: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_retries: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RemoteScorerAuth {
    None,
    Bearer { token: String },
    Basic { username: String, password: String },
    ApiKey { token: String, header_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteScorerHeader {
    pub key: String,
    pub value: String,
}

pub fn parse_remote_config(params: &Value) -> Result<RemoteScorerConfig> {
    let params: RemoteScorerParams = serde_json::from_value(params.clone())
        .map_err(|e| anyhow::anyhow!("Invalid remote scorer params: {e}"))?;

    let (auth_type, auth_token, auth_username, auth_password, api_key_header) = match params.auth {
        Some(RemoteScorerAuth::Bearer { token }) => {
            ("bearer".to_string(), Some(token), None, None, None)
        }
        Some(RemoteScorerAuth::Basic { username, password }) => (
            "basic".to_string(),
            None,
            Some(username),
            Some(password),
            None,
        ),
        Some(RemoteScorerAuth::ApiKey { token, header_name }) => (
            "api_key".to_string(),
            Some(token),
            None,
            None,
            Some(header_name),
        ),
        Some(RemoteScorerAuth::None) | None => ("none".to_string(), None, None, None, None),
    };

    Ok(RemoteScorerConfig {
        endpoint: params.endpoint,
        http_method: params
            .http_method
            .unwrap_or_else(|| "POST".to_string())
            .to_uppercase(),
        auth_type,
        auth_token,
        auth_username,
        auth_password,
        api_key_header,
        custom_headers: params
            .custom_headers
            .unwrap_or_default()
            .into_iter()
            .map(|h| (h.key, h.value))
            .collect(),
        content_type: params
            .content_type
            .unwrap_or_else(|| "application/json".to_string()),
        request_body_template: None,
        timeout_ms: params.timeout_ms.unwrap_or(30_000),
        max_retries: params.max_retries.unwrap_or(3),
    })
}

pub async fn run_remote_scorer(
    config: &RemoteScorerConfig,
    span_attributes: &HashMap<String, Value>,
) -> Result<RemoteScorerOutput> {
    let start = std::time::Instant::now();
    let body_template = config.request_body_template.as_deref().unwrap_or("{}");
    let rendered_body = render_template(body_template, span_attributes);
    let mut last_error: Option<anyhow::Error> = None;

    for attempt in 0..=config.max_retries {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(compute_backoff_ms(attempt))).await;
        }

        match execute_request(config, &rendered_body).await {
            Ok((output, raw_response)) => {
                let latency = start.elapsed();
                let parsed = parse_remote_response(output)?;
                return Ok(RemoteScorerOutput {
                    value: parsed.value,
                    reasoning: parsed.reason,
                    metadata: parsed.metadata,
                    raw_response,
                    latency_ms: latency.as_millis() as i64,
                });
            }
            Err(e) => {
                log::warn!(
                    "[REMOTE-SCORER] Attempt {}/{} failed for {}: {}",
                    attempt + 1,
                    config.max_retries + 1,
                    config.endpoint,
                    e
                );
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("remote scorer request failed")))
}

fn render_template(template: &str, attrs: &HashMap<String, Value>) -> String {
    let mut result = template.to_string();
    let mut start = 0;
    while let Some(open) = result[start..].find("{{") {
        let abs_open = start + open;
        if let Some(close) = result[abs_open..].find("}}") {
            let abs_close = abs_open + close + 2;
            let path = result[abs_open + 2..abs_close - 2].trim();
            let mut value = get_attr(attrs, path);
            if is_inside_string_literal(&result, abs_open) {
                value = escape_json_string_content(&value);
            }
            result.replace_range(abs_open..abs_close, &value);
            start = abs_open + value.len();
        } else {
            break;
        }
    }
    result
}

fn get_attr(attrs: &HashMap<String, Value>, path: &str) -> String {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = attrs.get(parts[0]);
    for part in &parts[1..] {
        current = current.and_then(|v| v.get(part));
    }
    match current {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => path.to_string(),
    }
}

fn is_inside_string_literal(template: &str, pos: usize) -> bool {
    let mut in_string = false;
    let mut escaped = false;

    for ch in template[..pos].chars() {
        if escaped {
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => in_string = !in_string,
            _ => {}
        }
    }

    in_string
}

fn escape_json_string_content(value: &str) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| value.to_string())
        .trim_matches('"')
        .to_string()
}

async fn execute_request(config: &RemoteScorerConfig, body: &str) -> Result<(Value, String)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()?;

    let mut req = match config.http_method.as_str() {
        "GET" => client.get(&config.endpoint),
        "PUT" => client.put(&config.endpoint),
        "PATCH" => client.patch(&config.endpoint),
        "DELETE" => client.delete(&config.endpoint),
        _ => client.post(&config.endpoint),
    };

    match config.auth_type.as_str() {
        "bearer" => {
            if let Some(token) = &config.auth_token {
                req = req.header("Authorization", format!("Bearer {token}"));
            }
        }
        "basic" => {
            if let (Some(user), Some(pass)) = (&config.auth_username, &config.auth_password) {
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!("{user}:{pass}"),
                );
                req = req.header("Authorization", format!("Basic {encoded}"));
            }
        }
        "api_key" => {
            if let (Some(header_name), Some(token)) = (&config.api_key_header, &config.auth_token) {
                req = req.header(header_name, token);
            }
        }
        _ => {}
    }

    for (key, val) in &config.custom_headers {
        req = req.header(key, val);
    }

    if !body.is_empty() && config.http_method != "GET" {
        req = req.header("Content-Type", &config.content_type);
        req = req.body(body.to_string());
    }

    let resp = req.send().await?;
    let status = resp.status();
    let raw_body = resp.text().await?;
    let parsed = serde_json::from_str(&raw_body).map_err(|e| {
        anyhow::anyhow!(
            "Failed to parse remote scorer response as JSON (HTTP {}): {e}",
            status
        )
    })?;
    Ok((parsed, raw_body))
}

#[derive(Debug)]
struct ParsedRemoteResponse {
    value: Value,
    reason: Option<String>,
    metadata: Option<Value>,
}

fn parse_remote_response(response: Value) -> Result<ParsedRemoteResponse> {
    let mut obj = match response {
        Value::Object(obj) => obj,
        _ => anyhow::bail!("Remote scorer response must be a JSON object"),
    };

    let code = obj
        .remove("code")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| anyhow::anyhow!("Remote scorer response missing string field 'code'"))?;

    let reason = obj
        .remove("reason")
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    if code != "OK" {
        anyhow::bail!(
            "Remote scorer returned code '{}': {}",
            code,
            reason.as_deref().unwrap_or("no reason provided")
        );
    }

    let value = obj.remove("value").ok_or_else(|| {
        anyhow::anyhow!("Remote scorer response missing field 'value' for code OK")
    })?;

    Ok(ParsedRemoteResponse {
        value,
        reason,
        metadata: object_to_metadata(obj),
    })
}

fn object_to_metadata(obj: Map<String, Value>) -> Option<Value> {
    if obj.is_empty() {
        None
    } else {
        Some(Value::Object(obj))
    }
}

fn compute_backoff_ms(attempt: u32) -> u64 {
    let base = 200u64.saturating_mul(1u64 << (attempt - 1).min(4));
    let mut rng = rand::rng();
    base + rng.random_range(0..=base / 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_remote_response_ok_with_metadata() {
        let parsed = parse_remote_response(serde_json::json!({
            "code": "OK",
            "value": 0.85,
            "reason": "good",
            "confidence": "high"
        }))
        .unwrap();

        assert_eq!(parsed.value, serde_json::json!(0.85));
        assert_eq!(parsed.reason.as_deref(), Some("good"));
        assert_eq!(parsed.metadata.unwrap()["confidence"], "high");
    }

    #[test]
    fn test_parse_remote_response_error_code_fails() {
        let err = parse_remote_response(serde_json::json!({
            "code": "INPUT_TOO_LONG",
            "reason": "too long"
        }))
        .unwrap_err();

        assert!(err.to_string().contains("INPUT_TOO_LONG"));
    }

    #[test]
    fn test_parse_remote_response_ok_requires_value() {
        let err = parse_remote_response(serde_json::json!({
            "code": "OK",
            "reason": "missing value"
        }))
        .unwrap_err();

        assert!(err.to_string().contains("missing field 'value'"));
    }

    #[test]
    fn test_render_template_escapes_values_inside_json_strings() {
        let attrs = HashMap::from([
            (
                "input".to_string(),
                serde_json::json!(r#"[{"content":"hello \"world\"","role":"user"}]"#),
            ),
            ("output".to_string(), serde_json::json!("line 1\nline 2")),
        ]);

        let result = render_template(r#"{"input":"{{ input }}","output":"{{ output }}"}"#, &attrs);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["input"], attrs["input"]);
        assert_eq!(parsed["output"], attrs["output"]);
    }

    #[test]
    fn test_render_template_preserves_free_text_values() {
        let attrs = HashMap::from([(
            "span".to_string(),
            serde_json::json!({"name": "test-span", "kind": "internal"}),
        )]);

        let result = render_template("Span: {{ span.name }} ({{ span.kind }})", &attrs);

        assert_eq!(result, "Span: test-span (internal)");
    }

    #[test]
    fn test_remote_params_reject_response_paths() {
        let err = parse_remote_config(&serde_json::json!({
            "endpoint": "http://localhost:8000/evaluate",
            "response_value_path": "value"
        }))
        .unwrap_err();

        assert!(err.to_string().contains("response_value_path"));
    }
}
