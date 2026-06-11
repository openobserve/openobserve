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

//! Gen-AI telemetry configuration types.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const MAX_AGENT_MAPPING_FIELDS: usize = 10;
const MAX_AGENT_MAPPING_FIELD_LEN: usize = 256;

/// Org-level fallback mapping for normalizing Gen-AI agent identity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GenAiAgentMappingConfig {
    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.name`.
    #[serde(default)]
    pub agent_name_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.id`.
    #[serde(default)]
    pub agent_id_fields: Vec<String>,
}

impl GenAiAgentMappingConfig {
    /// Trim configured field names on save and validate the public API contract.
    pub fn normalize_and_validate(mut self) -> Result<Self, String> {
        self.agent_name_fields = normalize_fields(self.agent_name_fields);
        self.agent_id_fields = normalize_fields(self.agent_id_fields);

        validate_fields(
            "agent_name_fields",
            &self.agent_name_fields,
            "gen_ai.agent.name",
        )?;
        validate_fields("agent_id_fields", &self.agent_id_fields, "gen_ai.agent.id")?;

        Ok(self)
    }
}

fn normalize_fields(fields: Vec<String>) -> Vec<String> {
    fields
        .into_iter()
        .map(|field| field.trim().to_string())
        .collect()
}

fn validate_fields(label: &str, fields: &[String], redundant_target: &str) -> Result<(), String> {
    if fields.len() > MAX_AGENT_MAPPING_FIELDS {
        return Err(format!(
            "{label} cannot exceed {MAX_AGENT_MAPPING_FIELDS} fields"
        ));
    }

    let mut seen = HashSet::new();
    for field in fields {
        if field.len() > MAX_AGENT_MAPPING_FIELD_LEN {
            return Err(format!(
                "{label} field '{field}' cannot exceed {MAX_AGENT_MAPPING_FIELD_LEN} characters"
            ));
        }
        if field == redundant_target {
            return Err(format!(
                "{label} must not include redundant target field '{field}'"
            ));
        }
        if !seen.insert(field.as_str()) {
            return Err(format!("{label} contains duplicate field '{field}'"));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_mapping_normalizes_field_names() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["  agent.name  ".to_string()],
            agent_id_fields: vec!["agent.id\t".to_string()],
        }
        .normalize_and_validate()
        .unwrap();

        assert_eq!(config.agent_name_fields, vec!["agent.name"]);
        assert_eq!(config.agent_id_fields, vec!["agent.id"]);
    }

    #[test]
    fn test_agent_mapping_rejects_duplicate_within_same_list() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent".to_string(), "agent".to_string()],
            agent_id_fields: vec![],
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("duplicate"));
    }

    #[test]
    fn test_agent_mapping_allows_same_field_in_both_lists() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent".to_string()],
            agent_id_fields: vec!["agent".to_string()],
        };

        assert!(config.normalize_and_validate().is_ok());
    }

    #[test]
    fn test_agent_mapping_rejects_redundant_target_fields() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["gen_ai.agent.name".to_string()],
            agent_id_fields: vec![],
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("redundant target"));
    }
}
