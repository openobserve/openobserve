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

use crate::service::traces::otel::attributes::{GenAiAttributes, LangfuseAttributes};

pub struct PromptExtractor;

impl PromptExtractor {
    /// Extract prompt name from AI SDK metadata
    pub fn extract_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        // Check Gen-AI attributes first
        if let Some(value) = attributes.get(GenAiAttributes::PROMPT_NAME) {
            return value.as_str().map(|s| s.to_string());
        }

        // Check Langfuse attributes (support both dot and underscore formats)
        if let Some(value) = attributes
            .get(LangfuseAttributes::OBSERVATION_PROMPT_NAME)
            .or_else(|| attributes.get(LangfuseAttributes::OBSERVATION_PROMPT_NAME_UNDERSCORE))
        {
            return value.as_str().map(|s| s.to_string());
        }

        None
    }
}
