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
            LangfuseAttributes::OBSERVATION_METADATA_SOURCE,
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
