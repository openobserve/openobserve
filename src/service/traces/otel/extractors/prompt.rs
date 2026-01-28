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

//! Prompt information extraction

use std::collections::HashMap;

use config::utils::json;

use super::utils::extract_i64;

pub struct PromptExtractor;

impl PromptExtractor {
    /// Extract prompt name from AI SDK metadata
    pub fn extract_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        if let Some((name, _)) = parse_ai_sdk_prompt_metadata(attributes) {
            return Some(name);
        }
        None
    }

    /// Extract prompt version from AI SDK metadata
    pub fn extract_version(&self, attributes: &HashMap<String, json::Value>) -> Option<i32> {
        if let Some((_, version)) = parse_ai_sdk_prompt_metadata(attributes) {
            return Some(version);
        }
        None
    }
}

/// Parses prompt metadata from Vercel AI SDK attributes
/// Supports ai.telemetry.metadata.langfusePrompt (common from Vercel AI SDK)
fn parse_ai_sdk_prompt_metadata(
    attributes: &HashMap<String, json::Value>,
) -> Option<(String, i32)> {
    // Check for langfusePrompt from Vercel AI SDK
    if let Some(value) = attributes.get("ai.telemetry.metadata.langfusePrompt")
        && let Some(s) = value.as_str()
        && let Ok(parsed) = serde_json::from_str::<json::Value>(s)
        && let Some(name) = parsed.get("name").and_then(|v| v.as_str())
        && let Some(version) = parsed.get("version").and_then(extract_i64)
    {
        return Some((name.to_string(), version as i32));
    }

    None
}
