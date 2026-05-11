// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Service name extraction from various sources

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::LangfuseAttributes;

pub struct ServiceNameExtractor;

impl ServiceNameExtractor {
    /// Extract service name from span attributes when not set in resource attributes
    /// Checks multiple sources in priority order and returns the first non-empty value
    pub fn extract_from_span_attributes(
        &self,
        span_attributes: &HashMap<String, json::Value>,
    ) -> Option<String> {
        // Priority order for service name sources
        let service_name_sources = [
            // Langfuse source metadata
            LangfuseAttributes::METADATA_SOURCE,
            // Add more sources here as needed
        ];

        for source_key in &service_name_sources {
            if let Some(value) = span_attributes.get(*source_key)
                && let Some(s) = value.as_str()
                && !s.is_empty()
            {
                return Some(s.to_string());
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_extract_service_name_from_langfuse_metadata_source() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.source".to_string(),
            config::utils::json::json!("my_service"),
        );
        let result = ServiceNameExtractor.extract_from_span_attributes(&attrs);
        assert_eq!(result, Some("my_service".to_string()));
    }

    #[test]
    fn test_extract_service_name_empty_string_returns_none() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.source".to_string(),
            config::utils::json::json!(""),
        );
        let result = ServiceNameExtractor.extract_from_span_attributes(&attrs);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_service_name_absent_returns_none() {
        let result = ServiceNameExtractor.extract_from_span_attributes(&HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_non_string_value_returns_none() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.source".to_string(),
            config::utils::json::json!(123),
        );
        let result = ServiceNameExtractor.extract_from_span_attributes(&attrs);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_whitespace_only_returns_some() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.metadata.source".to_string(),
            config::utils::json::json!("  "),
        );
        let result = ServiceNameExtractor.extract_from_span_attributes(&attrs);
        assert_eq!(result, Some("  ".to_string()));
    }
}
