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

use crate::service::traces::otel::attributes::{
    GenAiAttributes, OpenInferenceAttributes, VercelAiSdkAttributes,
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

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_PROMPT_TOKENS))
                && let Some(num) = v.as_i64()
            {
                usage.insert("input".to_string(), num);
            }
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_COMPLETION_TOKENS))
                && let Some(num) = v.as_i64()
            {
                usage.insert("output".to_string(), num);
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::USAGE_TOKENS)
                && let Some(num) = v.as_i64()
            {
                usage.insert("total".to_string(), num);
            }
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
                && let Some(num) = value.as_i64()
            {
                usage.insert(usage_key.to_string(), num);
            }
        }

        // OpenInference
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT)
            && let Some(num) = v.as_i64()
        {
            usage.insert("input".to_string(), num);
        }
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_COMPLETION)
            && let Some(num) = v.as_i64()
        {
            usage.insert("output".to_string(), num);
        }

        usage
    }

    /// Extract cost details
    pub fn extract_cost(&self, attributes: &HashMap<String, json::Value>) -> HashMap<String, f64> {
        let mut cost = HashMap::new();

        if let Some(v) = attributes.get(GenAiAttributes::USAGE_COST)
            && let Some(num) = v.as_f64()
        {
            cost.insert("total".to_string(), num);
        }

        cost
    }
}
