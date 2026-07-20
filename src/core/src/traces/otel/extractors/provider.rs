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

//! Provider name extraction

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{
    GenAiAttributes, LangfuseAttributes, VercelAiSdkAttributes,
};

pub struct ProviderExtractor;

impl ProviderExtractor {
    /// Extract provider name from attributes
    pub fn extract(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let provider_name_keys = [
            GenAiAttributes::PROVIDER_NAME,        // gen_ai.provider.name
            GenAiAttributes::SYSTEM,               // gen_ai.system
            VercelAiSdkAttributes::MODEL_PROVIDER, // ai.model.provider
        ];

        for key in &provider_name_keys {
            if let Some(value) = attributes.get(*key) {
                return value.as_str().map(|s| s.to_string());
            }
        }

        // Langfuse metadata ls_provider
        if let Some(value) = attributes.get(LangfuseAttributes::METADATA_LS_PROVIDER) {
            return value.as_str().map(|s| s.to_string());
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_attributes(pairs: Vec<(&str, json::Value)>) -> HashMap<String, json::Value> {
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    #[test]
    fn test_extract_provider_name() {
        let extractor = ProviderExtractor;
        let attrs = make_attributes(vec![("gen_ai.provider.name", json::json!("openai"))]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("openai".to_string()));
    }

    #[test]
    fn test_extract_provider_from_system() {
        let extractor = ProviderExtractor;
        let attrs = make_attributes(vec![("gen_ai.system", json::json!("anthropic"))]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("anthropic".to_string()));
    }

    #[test]
    fn test_extract_provider_from_vercel_ai() {
        let extractor = ProviderExtractor;
        let attrs = make_attributes(vec![("ai.model.provider", json::json!("google"))]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("google".to_string()));
    }

    #[test]
    fn test_extract_provider_priority() {
        let extractor = ProviderExtractor;
        // gen_ai.provider.name should have priority over gen_ai.system
        let attrs = make_attributes(vec![
            ("gen_ai.provider.name", json::json!("openai")),
            ("gen_ai.system", json::json!("anthropic")),
        ]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("openai".to_string()));
    }

    #[test]
    fn test_extract_provider_from_langfuse_metadata_ls_provider() {
        let extractor = ProviderExtractor;
        let attrs = make_attributes(vec![(
            "langfuse.observation.metadata.ls_provider",
            json::json!("openai"),
        )]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("openai".to_string()));
    }

    #[test]
    fn test_extract_provider_no_match() {
        let extractor = ProviderExtractor;
        let attrs = make_attributes(vec![("other.attribute", json::json!("value"))]);

        let result = extractor.extract(&attrs);
        assert_eq!(result, None);
    }
}
