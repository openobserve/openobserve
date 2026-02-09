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
use crate::service::traces::otel::{
    attributes::{
        GenAiAttributes, LLMAttributes, LangfuseAttributes, OpenInferenceAttributes,
        VercelAiSdkAttributes,
    },
    extractors::{parse_json_value, set_val_if_not_zero},
};

pub struct UsageExtractor;

impl UsageExtractor {
    /// Extract usage details (token counts)
    pub fn extract_usage(
        &self,
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> HashMap<String, i64> {
        let mut usage = HashMap::new();

        // LLM Usage Total Tokens
        if let Some(v) = attributes.get(LLMAttributes::USAGE_TOTAL_TOKENS)
            && let Some(num) = extract_i64(v)
        {
            set_val_if_not_zero(&mut usage, "total".to_string(), num);
        }

        // Standard Gen-AI attributes
        let token_keys = [
            (GenAiAttributes::USAGE_INPUT_TOKENS, "input"),
            (GenAiAttributes::USAGE_OUTPUT_TOKENS, "output"),
            (GenAiAttributes::USAGE_TOTAL_TOKENS, "total"),
            (GenAiAttributes::USAGE_PROMPT_TOKENS, "input"),
            (GenAiAttributes::USAGE_COMPLETION_TOKENS, "output"),
            (
                GenAiAttributes::USAGE_CACHE_READ_TOKENS,
                "input_cached_tokens",
            ),
            (
                GenAiAttributes::USAGE_CACHE_WRITE_TOKENS,
                "input_cache_creation",
            ),
        ];

        for (key, usage_key) in &token_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(num) = extract_i64(value)
            {
                set_val_if_not_zero(&mut usage, usage_key.to_string(), num);
            }
        }

        // OpenInference
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT)
            && let Some(num) = extract_i64(v)
        {
            set_val_if_not_zero(&mut usage, "input".to_string(), num);
        }
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_COMPLETION)
            && let Some(num) = extract_i64(v)
        {
            set_val_if_not_zero(&mut usage, "output".to_string(), num);
        }

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_PROMPT_TOKENS))
                && let Some(num) = extract_i64(v)
            {
                set_val_if_not_zero(&mut usage, "input".to_string(), num);
            }
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_COMPLETION_TOKENS))
                && let Some(num) = extract_i64(v)
            {
                set_val_if_not_zero(&mut usage, "output".to_string(), num);
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::USAGE_TOKENS)
                && let Some(num) = extract_i64(v)
            {
                set_val_if_not_zero(&mut usage, "total".to_string(), num);
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
                            set_val_if_not_zero(&mut usage, format!("{}_{}", k, sk), v);
                        }
                    }
                }
            }
        }

        usage
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
