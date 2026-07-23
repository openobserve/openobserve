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
const TARGET_AGENT_FIELDS: &[&str] = &[
    "target_agent_name",
    "target_agent_id",
    "attributes.target_agent_name",
    "attributes.target_agent_id",
    "attributes_target_agent_name",
    "attributes_target_agent_id",
];

/// Org-level fallback mapping for normalizing Gen-AI agent identity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct GenAiAgentMappingConfig {
    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.name`.
    #[serde(default)]
    pub agent_name_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for `gen_ai.agent.id`.
    #[serde(default)]
    pub agent_id_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for the agent's environment.
    #[serde(default)]
    pub env_fields: Vec<String>,

    /// Incoming telemetry attribute names to use as fallbacks for the agent's version.
    #[serde(default)]
    pub version_fields: Vec<String>,
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

        self.env_fields = normalize_fields(self.env_fields);
        self.version_fields = normalize_fields(self.version_fields);

        validate_fields(
            "env_fields",
            &self.env_fields,
            "deployment.environment.name",
        )?;
        validate_fields("version_fields", &self.version_fields, "gen_ai.agent.version")?;

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
        if field.is_empty() {
            return Err(format!("{label} field names cannot be empty"));
        }
        if field.len() > MAX_AGENT_MAPPING_FIELD_LEN {
            return Err(format!(
                "{label} field '{field}' cannot exceed {MAX_AGENT_MAPPING_FIELD_LEN} characters"
            ));
        }
        if !is_safe_mapping_field(field) {
            return Err(format!(
                "{label} field '{field}' contains invalid characters"
            ));
        }
        if field == redundant_target {
            return Err(format!(
                "{label} must not include redundant target field '{field}'"
            ));
        }
        if TARGET_AGENT_FIELDS.contains(&field.as_str()) {
            return Err(format!(
                "{label} must not include target-agent field '{field}'"
            ));
        }
        if !seen.insert(field.as_str()) {
            return Err(format!("{label} contains duplicate field '{field}'"));
        }
    }

    Ok(())
}

fn is_safe_mapping_field(field: &str) -> bool {
    let Some(first) = field.chars().next() else {
        return false;
    };

    (first.is_ascii_alphabetic() || first == '_')
        && field
            .chars()
            .skip(1)
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_mapping_normalizes_env_and_version_fields() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec![],
            agent_id_fields: vec![],
            env_fields: vec!["  custom.env  ".to_string()],
            version_fields: vec!["app.build\t".to_string()],
        }
        .normalize_and_validate()
        .unwrap();

        assert_eq!(config.env_fields, vec!["custom.env"]);
        assert_eq!(config.version_fields, vec!["app.build"]);
    }

    #[test]
    fn test_agent_mapping_rejects_redundant_env_version_targets() {
        let err = GenAiAgentMappingConfig {
            env_fields: vec!["deployment.environment.name".to_string()],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("redundant target"));
    }

    #[test]
    fn test_agent_mapping_normalizes_field_names() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["  agent.name  ".to_string()],
            agent_id_fields: vec!["agent.id\t".to_string()],
            ..Default::default()
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
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("duplicate"));
    }

    #[test]
    fn test_agent_mapping_rejects_empty_field_names() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["   ".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("empty"));
    }

    #[test]
    fn test_agent_mapping_rejects_unsafe_field_names() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent.name;DROP".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("invalid characters"));
    }

    #[test]
    fn test_agent_mapping_allows_same_field_in_both_lists() {
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["agent".to_string()],
            agent_id_fields: vec!["agent".to_string()],
            ..Default::default()
        };

        assert!(config.normalize_and_validate().is_ok());
    }

    #[test]
    fn test_agent_mapping_rejects_redundant_target_fields() {
        let err = GenAiAgentMappingConfig {
            agent_name_fields: vec!["gen_ai.agent.name".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        }
        .normalize_and_validate()
        .unwrap_err();

        assert!(err.contains("redundant target"));
    }

    #[test]
    fn test_agent_mapping_rejects_target_agent_fields() {
        for field in TARGET_AGENT_FIELDS {
            let err = GenAiAgentMappingConfig {
                agent_name_fields: vec![field.to_string()],
                agent_id_fields: vec![],
                ..Default::default()
            }
            .normalize_and_validate()
            .unwrap_err();

            assert!(err.contains("target-agent"));
        }
    }
}
