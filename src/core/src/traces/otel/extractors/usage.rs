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

//! Usage and cost details extraction

use std::collections::HashMap;

use config::utils::json;

use super::utils::{extract_f64, extract_i64};
use crate::traces::otel::{
    attributes::{
        GenAiAttributes, LLMAttributes, LangfuseAttributes, OpenInferenceAttributes,
        VercelAiSdkAttributes,
    },
    extractors::{parse_json_value, set_val_if_not_zero},
};

#[derive(Clone, Debug, Default)]
pub struct UsageDetails {
    pub usage: HashMap<String, i64>,
    /// Whether the extracted `input` token count already includes cache-read/cache-creation
    /// tokens. Current GenAI semconv says it should; provider-native legacy fields often do not.
    pub input_includes_cache: bool,
}

pub struct UsageExtractor;

impl UsageExtractor {
    /// Extract usage details (token counts)
    #[cfg(test)]
    pub fn extract_usage(
        &self,
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> HashMap<String, i64> {
        self.extract_usage_details(attributes, instrumentation_scope_name)
            .usage
    }

    pub fn extract_usage_details(
        &self,
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> UsageDetails {
        let mut usage = HashMap::new();
        let mut input_includes_cache = false;

        // LLM Usage Total Tokens
        if let Some(num) = extract_i64_any(
            attributes,
            &[LLMAttributes::USAGE_TOTAL_TOKENS, "llm_usage_total_tokens"],
        ) {
            set_val_if_not_zero(&mut usage, "total".to_string(), num);
        }

        // Standard Gen-AI attributes
        let token_keys = [
            (
                &[
                    GenAiAttributes::USAGE_INPUT_TOKENS,
                    "gen_ai_usage_input_tokens",
                ][..],
                "input",
            ),
            (
                &[
                    GenAiAttributes::USAGE_OUTPUT_TOKENS,
                    "gen_ai_usage_output_tokens",
                ][..],
                "output",
            ),
            (
                &[
                    GenAiAttributes::USAGE_TOTAL_TOKENS,
                    "gen_ai_usage_total_tokens",
                ][..],
                "total",
            ),
            (
                &[
                    GenAiAttributes::USAGE_PROMPT_TOKENS,
                    "gen_ai_usage_prompt_tokens",
                ][..],
                "input",
            ),
            (
                &[
                    GenAiAttributes::USAGE_COMPLETION_TOKENS,
                    "gen_ai_usage_completion_tokens",
                ][..],
                "output",
            ),
        ];

        for (keys, usage_key) in &token_keys {
            if let Some(num) = extract_i64_any(attributes, keys) {
                if *usage_key == "input" {
                    input_includes_cache = true;
                }
                set_val_if_not_zero(&mut usage, usage_key.to_string(), num);
            }
        }

        // Official GenAI cache-token fields are included in gen_ai.usage.input_tokens.
        if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_CACHE_READ_INPUT_TOKENS,
                "gen_ai_usage_cache_read_input_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = true;
        } else if let Some(num) = extract_i64_any(attributes, &["cache_read_input_tokens"]) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = false;
        } else if let Some(num) = extract_i64_any(
            attributes,
            &[
                "gen_ai.usage.prompt_tokens_details.cached_tokens",
                "gen_ai_usage_prompt_tokens_details_cached_tokens",
                "prompt_tokens_details.cached_tokens",
                "prompt_tokens_details_cached_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = true;
        } else if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_CACHE_READ_TOKENS,
                "gen_ai_usage_cache_read_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = false;
        } else if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_CACHED_TOKENS,
                "gen_ai_usage_cached_tokens",
                "cached_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = false;
        } else if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_PROMPT_CACHE_HIT_TOKENS,
                "gen_ai_usage_prompt_cache_hit_tokens",
                "prompt_cache_hit_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
            input_includes_cache = false;
        }

        if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_CACHE_CREATION_INPUT_TOKENS,
                "gen_ai_usage_cache_creation_input_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_creation_input_tokens".to_string(), num);
            input_includes_cache = true;
        } else if let Some(num) = extract_i64_any(attributes, &["cache_creation_input_tokens"]) {
            set_val_if_not_zero(&mut usage, "cache_creation_input_tokens".to_string(), num);
            input_includes_cache = false;
        } else if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_CACHE_WRITE_TOKENS,
                "gen_ai_usage_cache_write_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "cache_creation_input_tokens".to_string(), num);
            input_includes_cache = false;
        }

        if let Some(num) = extract_i64_any(
            attributes,
            &[
                GenAiAttributes::USAGE_PROMPT_CACHE_MISS_TOKENS,
                "gen_ai_usage_prompt_cache_miss_tokens",
                "prompt_cache_miss_tokens",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "input".to_string(), num);
            input_includes_cache = false;
        }

        // OpenInference
        if let Some(num) = extract_i64_any(
            attributes,
            &[
                OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT,
                "llm_token_count_prompt",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "input".to_string(), num);
            if !has_provider_native_cache_tokens(attributes) {
                input_includes_cache = true;
            }
        }
        if let Some(num) = extract_i64_any(
            attributes,
            &[
                OpenInferenceAttributes::LLM_TOKEN_COUNT_COMPLETION,
                "llm_token_count_completion",
            ],
        ) {
            set_val_if_not_zero(&mut usage, "output".to_string(), num);
        }
        // OpenInference cache details are part of `llm.token_count.prompt`.
        let oi_cache_keys = [
            (
                &[
                    OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT_CACHE_READ,
                    "llm_token_count_prompt_details_cache_read",
                ][..],
                "cache_read_input_tokens",
            ),
            (
                &[
                    OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT_CACHE_WRITE,
                    "llm_token_count_prompt_details_cache_write",
                ][..],
                "cache_creation_input_tokens",
            ),
        ];
        for (keys, usage_key) in &oi_cache_keys {
            if let Some(num) = extract_i64_any(attributes, keys) {
                set_val_if_not_zero(&mut usage, usage_key.to_string(), num);
                input_includes_cache = true;
            }
        }

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            if let Some(num) = extract_i64_any(
                attributes,
                &[
                    GenAiAttributes::USAGE_INPUT_TOKENS,
                    "gen_ai_usage_input_tokens",
                    GenAiAttributes::USAGE_PROMPT_TOKENS,
                    "gen_ai_usage_prompt_tokens",
                ],
            ) {
                set_val_if_not_zero(&mut usage, "input".to_string(), num);
                input_includes_cache = true;
            }
            if let Some(num) = extract_i64_any(
                attributes,
                &[
                    GenAiAttributes::USAGE_OUTPUT_TOKENS,
                    "gen_ai_usage_output_tokens",
                    GenAiAttributes::USAGE_COMPLETION_TOKENS,
                    "gen_ai_usage_completion_tokens",
                ],
            ) {
                set_val_if_not_zero(&mut usage, "output".to_string(), num);
            }
            // ai@4 (`promptTokens`) and ai@5+ (`inputTokens`) names.
            if let Some(num) = extract_i64_any(
                attributes,
                &[
                    VercelAiSdkAttributes::USAGE_INPUT_TOKENS,
                    VercelAiSdkAttributes::USAGE_PROMPT_TOKENS,
                ],
            ) {
                set_val_if_not_zero(&mut usage, "input".to_string(), num);
                input_includes_cache = true;
            }
            if let Some(num) = extract_i64_any(
                attributes,
                &[
                    VercelAiSdkAttributes::USAGE_OUTPUT_TOKENS,
                    VercelAiSdkAttributes::USAGE_COMPLETION_TOKENS,
                ],
            ) {
                set_val_if_not_zero(&mut usage, "output".to_string(), num);
            }
            if let Some(num) = extract_i64_any(
                attributes,
                &[
                    VercelAiSdkAttributes::USAGE_TOTAL_TOKENS,
                    VercelAiSdkAttributes::USAGE_TOKENS,
                ],
            ) {
                set_val_if_not_zero(&mut usage, "total".to_string(), num);
            }
            // `ai.usage.tokens` is the embedding call's input token count.
            if !usage.contains_key("input")
                && let Some(num) =
                    extract_i64_any(attributes, &[VercelAiSdkAttributes::USAGE_TOKENS])
            {
                set_val_if_not_zero(&mut usage, "input".to_string(), num);
            }

            // ai@6+ splits `inputTokens` (which includes the cache) into details.
            let cache_read = extract_i64_any(
                attributes,
                &[VercelAiSdkAttributes::USAGE_INPUT_CACHE_READ_TOKENS],
            );
            let cache_write = extract_i64_any(
                attributes,
                &[VercelAiSdkAttributes::USAGE_INPUT_CACHE_WRITE_TOKENS],
            );
            if cache_read.is_some() || cache_write.is_some() {
                if let Some(num) = cache_read {
                    set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
                }
                if let Some(num) = cache_write {
                    set_val_if_not_zero(&mut usage, "cache_creation_input_tokens".to_string(), num);
                }
                input_includes_cache = true;
            } else if let Some(num) = extract_i64_any(
                attributes,
                &[VercelAiSdkAttributes::USAGE_CACHED_INPUT_TOKENS],
            ) {
                // ai@5 passes through the provider's input count, which may include cache reads.
                set_val_if_not_zero(&mut usage, "cache_read_input_tokens".to_string(), num);
                input_includes_cache = !vercel_provider_reports_cache_separately(attributes);
            }
        }

        // Langfuse usage_details (support both dot and underscore formats)
        if let Some(val) = attributes.get(LangfuseAttributes::USAGE_DETAILS)
            && let Some(parsed) = parse_json_value(val)
        {
            for (k, v) in parsed {
                if let Some(v) = v.as_i64() {
                    let k = if k == "prompt_tokens" {
                        "input"
                    } else if k == "completion_tokens" {
                        "output"
                    } else if k == "total_tokens" {
                        "total"
                    } else {
                        &k
                    };
                    set_val_if_not_zero(&mut usage, k.to_string(), v);
                } else if let Some(s) = v.as_object() {
                    for (sk, sv) in s {
                        if let Some(v) = sv.as_i64() {
                            // OpenAI usage nests cache reads; `prompt_tokens` includes them.
                            if k == "prompt_tokens_details" && sk == "cached_tokens" {
                                set_val_if_not_zero(
                                    &mut usage,
                                    "cache_read_input_tokens".to_string(),
                                    v,
                                );
                                input_includes_cache = true;
                            } else {
                                set_val_if_not_zero(&mut usage, format!("{}_{}", k, sk), v);
                            }
                        }
                    }
                }
            }
        }

        UsageDetails {
            usage,
            input_includes_cache,
        }
    }

    /// Extract cost details
    pub fn extract_cost(&self, attributes: &HashMap<String, json::Value>) -> HashMap<String, f64> {
        let mut cost = HashMap::new();

        if let Some(v) = attributes.get(GenAiAttributes::USAGE_COST)
            && let Some(num) = extract_f64(v)
        {
            set_val_if_not_zero(&mut cost, "total".to_string(), num);
        }

        // Langfuse cost_details (support both dot and underscore formats)
        if let Some(val) = attributes.get(LangfuseAttributes::COST_DETAILS)
            && let Some(parsed) = parse_json_value(val)
        {
            for (k, v) in parsed {
                if let Some(s) = v.as_f64() {
                    set_val_if_not_zero(&mut cost, k.clone(), s);
                } else if let Some(s) = v.as_object() {
                    for (sk, sv) in s {
                        if let Some(v) = sv.as_f64() {
                            set_val_if_not_zero(&mut cost, format!("{}_{}", k, sk), v);
                        }
                    }
                }
            }
        }

        cost
    }
}

fn extract_i64_any(attributes: &HashMap<String, json::Value>, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| attributes.get(*key).and_then(extract_i64))
}

fn has_provider_native_cache_tokens(attributes: &HashMap<String, json::Value>) -> bool {
    [
        GenAiAttributes::USAGE_CACHED_TOKENS,
        "gen_ai_usage_cached_tokens",
        "cached_tokens",
        GenAiAttributes::USAGE_PROMPT_CACHE_HIT_TOKENS,
        "gen_ai_usage_prompt_cache_hit_tokens",
        "prompt_cache_hit_tokens",
        GenAiAttributes::USAGE_PROMPT_CACHE_MISS_TOKENS,
        "gen_ai_usage_prompt_cache_miss_tokens",
        "prompt_cache_miss_tokens",
    ]
    .iter()
    .any(|key| attributes.contains_key(*key))
}

/// Vercel AI SDK providers whose ai@5 `inputTokens` excludes cache reads (e.g. Anthropic, Bedrock).
fn vercel_provider_reports_cache_separately(attributes: &HashMap<String, json::Value>) -> bool {
    attributes
        .get(VercelAiSdkAttributes::MODEL_PROVIDER)
        .and_then(|v| v.as_str())
        .is_some_and(|provider| {
            provider.contains("anthropic") || provider.starts_with("amazon-bedrock")
        })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_extract_usage_gen_ai_input_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(100i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("input"), Some(&100i64));
    }

    #[test]
    fn test_extract_usage_gen_ai_output_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(50i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("output"), Some(&50i64));
    }

    #[test]
    fn test_extract_usage_gen_ai_total_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.total_tokens".to_string(), json::json!(150i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("total"), Some(&150i64));
    }

    #[test]
    fn test_extract_usage_llm_usage_total_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("llm.usage.total_tokens".to_string(), json::json!(200i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("total"), Some(&200i64));
    }

    #[test]
    fn test_extract_usage_open_inference_prompt_and_completion() {
        let mut attrs = HashMap::new();
        attrs.insert("llm.token_count.prompt".to_string(), json::json!(30i64));
        attrs.insert("llm.token_count.completion".to_string(), json::json!(20i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("input"), Some(&30i64));
        assert_eq!(usage.get("output"), Some(&20i64));
    }

    #[test]
    fn test_extract_usage_zero_value_not_inserted() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(0i64));
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert!(!usage.contains_key("input"));
    }

    #[test]
    fn test_extract_usage_vercel_ai_scope_total_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("ai.usage.tokens".to_string(), json::json!(300i64));
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("total"), Some(&300i64));
    }

    #[test]
    fn test_extract_usage_vercel_ai_scope_input_output() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(40i64));
        attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(60i64));
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("input"), Some(&40i64));
        assert_eq!(usage.get("output"), Some(&60i64));
    }

    #[test]
    fn test_extract_usage_langfuse_usage_details_renames_keys() {
        let mut attrs = HashMap::new();
        let details = json::json!({
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30
        });
        attrs.insert(
            "langfuse.observation.usage_details".to_string(),
            json::Value::String(details.to_string()),
        );
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("input"), Some(&10i64));
        assert_eq!(usage.get("output"), Some(&20i64));
        assert_eq!(usage.get("total"), Some(&30i64));
    }

    #[test]
    fn test_extract_cost_gen_ai_usage_cost() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.cost".to_string(), json::json!(0.05f64));
        let cost = UsageExtractor.extract_cost(&attrs);
        assert_eq!(cost.get("total"), Some(&0.05f64));
    }

    #[test]
    fn test_extract_cost_zero_not_inserted() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.cost".to_string(), json::json!(0.0f64));
        let cost = UsageExtractor.extract_cost(&attrs);
        assert!(!cost.contains_key("total"));
    }

    #[test]
    fn test_extract_cost_langfuse_cost_details() {
        let mut attrs = HashMap::new();
        let details = json::json!({ "input": 0.01, "output": 0.02 });
        attrs.insert(
            "langfuse.observation.cost_details".to_string(),
            json::Value::String(details.to_string()),
        );
        let cost = UsageExtractor.extract_cost(&attrs);
        assert_eq!(cost.get("input"), Some(&0.01f64));
        assert_eq!(cost.get("output"), Some(&0.02f64));
    }

    #[test]
    fn test_extract_usage_empty_attributes_returns_empty_map() {
        let usage = UsageExtractor.extract_usage(&HashMap::new(), "");
        assert!(usage.is_empty());
    }

    #[test]
    fn test_extract_cost_empty_attributes_returns_empty_map() {
        let cost = UsageExtractor.extract_cost(&HashMap::new());
        assert!(cost.is_empty());
    }

    #[test]
    fn test_extract_usage_cache_read_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.usage.cache_read_tokens".to_string(),
            json::json!(25i64),
        );
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("cache_read_input_tokens"), Some(&25i64));
    }

    #[test]
    fn test_extract_usage_cache_write_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.usage.cache_write_tokens".to_string(),
            json::json!(10i64),
        );
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("cache_creation_input_tokens"), Some(&10i64));
    }

    #[test]
    fn test_extract_usage_official_cache_input_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(100i64));
        attrs.insert(
            "gen_ai.usage.cache_read.input_tokens".to_string(),
            json::json!(70i64),
        );
        attrs.insert(
            "gen_ai.usage.cache_creation.input_tokens".to_string(),
            json::json!(10i64),
        );

        let details = UsageExtractor.extract_usage_details(&attrs, "");

        assert_eq!(details.usage.get("input"), Some(&100i64));
        assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&70i64));
        assert_eq!(
            details.usage.get("cache_creation_input_tokens"),
            Some(&10i64)
        );
        assert!(details.input_includes_cache);
    }

    #[test]
    fn test_extract_usage_deepseek_cache_hit_miss_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.usage.prompt_cache_hit_tokens".to_string(),
            json::json!(70i64),
        );
        attrs.insert(
            "gen_ai.usage.prompt_cache_miss_tokens".to_string(),
            json::json!(30i64),
        );

        let details = UsageExtractor.extract_usage_details(&attrs, "");

        assert_eq!(details.usage.get("input"), Some(&30i64));
        assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&70i64));
        assert!(!details.input_includes_cache);
    }

    #[test]
    fn test_extract_usage_prompt_completion_tokens_alias() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.usage.prompt_tokens".to_string(), json::json!(80i64));
        attrs.insert(
            "gen_ai.usage.completion_tokens".to_string(),
            json::json!(120i64),
        );
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("input"), Some(&80i64));
        assert_eq!(usage.get("output"), Some(&120i64));
    }

    #[test]
    fn test_extract_usage_vercel_prompt_tokens_fallback() {
        let mut attrs = HashMap::new();
        // No input_tokens present; prompt_tokens is the or_else fallback
        attrs.insert("gen_ai.usage.prompt_tokens".to_string(), json::json!(60i64));
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("input"), Some(&60i64));
    }

    #[test]
    fn test_extract_usage_langfuse_nested_object() {
        // Tests the `else if let Some(s) = v.as_object()` branch in usage_details
        let mut attrs = HashMap::new();
        let details = json::json!({
            "tokens": {
                "input": 100,
                "output": 50
            }
        });
        attrs.insert(
            "langfuse.observation.usage_details".to_string(),
            json::Value::String(details.to_string()),
        );
        let usage = UsageExtractor.extract_usage(&attrs, "");
        assert_eq!(usage.get("tokens_input"), Some(&100i64));
        assert_eq!(usage.get("tokens_output"), Some(&50i64));
    }

    #[test]
    fn test_extract_cost_langfuse_nested_object() {
        // Tests the `else if let Some(s) = v.as_object()` branch in cost_details
        let mut attrs = HashMap::new();
        let details = json::json!({
            "tokens": {
                "input": 0.01,
                "output": 0.005
            }
        });
        attrs.insert(
            "langfuse.observation.cost_details".to_string(),
            json::Value::String(details.to_string()),
        );
        let cost = UsageExtractor.extract_cost(&attrs);
        assert_eq!(cost.get("tokens_input"), Some(&0.01f64));
        assert_eq!(cost.get("tokens_output"), Some(&0.005f64));
    }

    fn attrs_of(pairs: &[(&str, json::Value)]) -> HashMap<String, json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn test_extract_usage_vercel_v5_usage_keys() {
        let attrs = attrs_of(&[
            ("ai.usage.inputTokens", json::json!(30)),
            ("ai.usage.outputTokens", json::json!(12)),
            ("ai.usage.totalTokens", json::json!(42)),
        ]);
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("input"), Some(&30));
        assert_eq!(usage.get("output"), Some(&12));
        assert_eq!(usage.get("total"), Some(&42));
    }

    #[test]
    fn test_extract_usage_vercel_v4_usage_keys() {
        let attrs = attrs_of(&[
            ("ai.usage.promptTokens", json::json!(30)),
            ("ai.usage.completionTokens", json::json!(12)),
        ]);
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("input"), Some(&30));
        assert_eq!(usage.get("output"), Some(&12));
    }

    #[test]
    fn test_extract_usage_vercel_embedding_tokens_are_input() {
        let attrs = attrs_of(&[("ai.usage.tokens", json::json!(5))]);
        let usage = UsageExtractor.extract_usage(&attrs, "ai");
        assert_eq!(usage.get("input"), Some(&5));
        assert_eq!(usage.get("total"), Some(&5));
        assert!(!usage.contains_key("output"));
    }

    #[test]
    fn test_extract_usage_vercel_input_token_details_cache() {
        let attrs = attrs_of(&[
            ("ai.model.provider", json::json!("anthropic.messages")),
            ("ai.usage.inputTokens", json::json!(1000)),
            (
                "ai.usage.inputTokenDetails.cacheReadTokens",
                json::json!(700),
            ),
            (
                "ai.usage.inputTokenDetails.cacheWriteTokens",
                json::json!(100),
            ),
            ("ai.usage.cachedInputTokens", json::json!(700)),
        ]);
        let details = UsageExtractor.extract_usage_details(&attrs, "ai");
        assert_eq!(details.usage.get("input"), Some(&1000));
        assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&700));
        assert_eq!(details.usage.get("cache_creation_input_tokens"), Some(&100));
        assert!(details.input_includes_cache);
    }

    #[test]
    fn test_extract_usage_vercel_v5_cached_input_tokens_by_provider() {
        for (provider, includes) in [
            ("openai.chat", true),
            ("google.generative-ai", true),
            ("anthropic.messages", false),
            ("amazon-bedrock", false),
        ] {
            let attrs = attrs_of(&[
                ("ai.model.provider", json::json!(provider)),
                ("ai.usage.inputTokens", json::json!(300)),
                ("ai.usage.cachedInputTokens", json::json!(200)),
            ]);
            let details = UsageExtractor.extract_usage_details(&attrs, "ai");
            assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&200));
            assert_eq!(details.input_includes_cache, includes, "{provider}");
        }
    }

    #[test]
    fn test_extract_usage_openinference_cache_details() {
        let attrs = attrs_of(&[
            ("llm.token_count.prompt", json::json!(1000)),
            ("llm.token_count.completion", json::json!(100)),
            (
                "llm.token_count.prompt_details.cache_read",
                json::json!(700),
            ),
            (
                "llm.token_count.prompt_details.cache_write",
                json::json!(100),
            ),
        ]);
        let details = UsageExtractor.extract_usage_details(&attrs, "");
        assert_eq!(details.usage.get("input"), Some(&1000));
        assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&700));
        assert_eq!(details.usage.get("cache_creation_input_tokens"), Some(&100));
        assert!(details.input_includes_cache);
    }

    #[test]
    fn test_extract_usage_langfuse_nested_cached_tokens() {
        let details = json::json!({
            "prompt_tokens": 1000,
            "completion_tokens": 100,
            "total_tokens": 1100,
            "prompt_tokens_details": {"cached_tokens": 700, "audio_tokens": 0}
        });
        let attrs = attrs_of(&[(
            "langfuse.observation.usage_details",
            json::Value::String(details.to_string()),
        )]);
        let details = UsageExtractor.extract_usage_details(&attrs, "");
        assert_eq!(details.usage.get("input"), Some(&1000));
        assert_eq!(details.usage.get("cache_read_input_tokens"), Some(&700));
        assert!(
            !details
                .usage
                .contains_key("prompt_tokens_details_cached_tokens")
        );
        assert!(details.input_includes_cache);
    }
}
