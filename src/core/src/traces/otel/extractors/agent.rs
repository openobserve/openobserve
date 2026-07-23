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

//! Gen-AI agent identity extraction.

use std::collections::HashMap;

use config::{meta::gen_ai::GenAiAgentMappingConfig, utils::json};

use crate::traces::otel::attributes::GenAiAttributes;

pub struct AgentExtractor;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentIdentity {
    pub name: Option<String>,
    pub id: Option<String>,
}

impl AgentExtractor {
    pub fn extract(
        &self,
        attributes: &HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        config: &GenAiAgentMappingConfig,
    ) -> AgentIdentity {
        AgentIdentity {
            name: first_non_empty_string(
                attributes,
                GenAiAttributes::AGENT_NAME,
                BUILT_IN_AGENT_NAME_FIELDS,
                &config.agent_name_fields,
            )
            .or_else(|| {
                first_non_empty_resource_string(
                    resource_attributes,
                    GenAiAttributes::AGENT_NAME,
                    BUILT_IN_AGENT_NAME_FIELDS,
                    &config.agent_name_fields,
                )
            }),
            id: first_non_empty_string(
                attributes,
                GenAiAttributes::AGENT_ID,
                BUILT_IN_AGENT_ID_FIELDS,
                &config.agent_id_fields,
            )
            .or_else(|| {
                first_non_empty_resource_string(
                    resource_attributes,
                    GenAiAttributes::AGENT_ID,
                    BUILT_IN_AGENT_ID_FIELDS,
                    &config.agent_id_fields,
                )
            }),
        }
    }
}

// Built-in agent-name keys across the tracing conventions OpenObserve documents,
// so agent nodes render out-of-the-box regardless of framework:
//  - Gen-AI / OpenInference: agent.name, llm.agent.name
//  - Google ADK (Vertex):    gcp.vertex.agent.name
//  - CrewAI (traceloop):     crewai.task.agent
// service.name is deliberately NOT here — it is the app tier, not agent identity
// (guarded by test_service_name_is_not_span_agent_fallback).
const BUILT_IN_AGENT_NAME_FIELDS: &[&str] = &[
    "agent.name",
    "llm.agent.name",
    "gcp.vertex.agent.name",
    "crewai.task.agent",
];

const BUILT_IN_AGENT_ID_FIELDS: &[&str] = &["agent.id", "agent_id", "llm.agent.id", "llm.agent_id"];

fn first_non_empty_string(
    attributes: &HashMap<String, json::Value>,
    standard_field: &str,
    built_in_fields: &[&str],
    configured_fields: &[String],
) -> Option<String> {
    attribute_string(attributes, standard_field)
        .or_else(|| first_from_static_fields(attributes, built_in_fields))
        .or_else(|| first_from_configured_fields(attributes, configured_fields))
}

fn first_non_empty_resource_string(
    attributes: &HashMap<String, json::Value>,
    standard_field: &str,
    built_in_fields: &[&str],
    configured_fields: &[String],
) -> Option<String> {
    resource_attribute_string(attributes, standard_field)
        .or_else(|| first_from_static_resource_fields(attributes, built_in_fields))
        .or_else(|| first_from_configured_resource_fields(attributes, configured_fields))
}

fn first_from_static_fields(
    attributes: &HashMap<String, json::Value>,
    fields: &[&str],
) -> Option<String> {
    fields
        .iter()
        .find_map(|field| attribute_string(attributes, field))
}

fn first_from_configured_fields(
    attributes: &HashMap<String, json::Value>,
    fields: &[String],
) -> Option<String> {
    fields
        .iter()
        .find_map(|field| attribute_string(attributes, field))
}

fn first_from_static_resource_fields(
    attributes: &HashMap<String, json::Value>,
    fields: &[&str],
) -> Option<String> {
    fields
        .iter()
        .find_map(|field| resource_attribute_string(attributes, field))
}

fn first_from_configured_resource_fields(
    attributes: &HashMap<String, json::Value>,
    fields: &[String],
) -> Option<String> {
    fields
        .iter()
        .find_map(|field| resource_attribute_string(attributes, field))
}

fn resource_attribute_string(
    attributes: &HashMap<String, json::Value>,
    field: &str,
) -> Option<String> {
    attribute_string(attributes, field).or_else(|| {
        let service_field = format!("service_{field}");
        attribute_string(attributes, &service_field)
    })
}

fn attribute_string(attributes: &HashMap<String, json::Value>, field: &str) -> Option<String> {
    let value = attributes.get(field)?.as_str()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_attributes(pairs: Vec<(&str, json::Value)>) -> HashMap<String, json::Value> {
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    #[test]
    fn test_standard_agent_fields_win_over_fallbacks() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![
            ("gen_ai.agent.name", json::json!("standard-agent")),
            ("agent.name", json::json!("builtin-agent")),
            ("custom.agent", json::json!("custom-agent")),
        ]);
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["custom.agent".to_string()],
            agent_id_fields: vec![],
            ..Default::default()
        };

        assert_eq!(
            extractor.extract(&attrs, &HashMap::new(), &config).name,
            Some("standard-agent".to_string())
        );
    }

    #[test]
    fn test_whitespace_only_standard_field_falls_back() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![
            ("gen_ai.agent.name", json::json!("  \t")),
            ("agent.name", json::json!("builtin-agent")),
        ]);

        assert_eq!(
            extractor
                .extract(&attrs, &HashMap::new(), &GenAiAgentMappingConfig::default())
                .name,
            Some("builtin-agent".to_string())
        );
    }

    #[test]
    fn test_trims_non_empty_value() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![("agent.name", json::json!("  agent with spaces  "))]);

        assert_eq!(
            extractor
                .extract(&attrs, &HashMap::new(), &GenAiAgentMappingConfig::default())
                .name,
            Some("agent with spaces".to_string())
        );
    }

    #[test]
    fn test_service_name_is_not_span_agent_fallback() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![("service.name", json::json!("svc-a"))]);

        assert_eq!(
            extractor
                .extract(&attrs, &HashMap::new(), &GenAiAgentMappingConfig::default())
                .name,
            None
        );
    }

    #[test]
    fn test_name_and_id_resolve_independently() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![
            ("custom.agent_name", json::json!("agent-a")),
            ("custom.agent_id", json::json!("agent-1")),
        ]);
        let config = GenAiAgentMappingConfig {
            agent_name_fields: vec!["custom.agent_name".to_string()],
            agent_id_fields: vec!["custom.agent_id".to_string()],
            ..Default::default()
        };
        let identity = extractor.extract(&attrs, &HashMap::new(), &config);

        assert_eq!(identity.name, Some("agent-a".to_string()));
        assert_eq!(identity.id, Some("agent-1".to_string()));
    }

    #[test]
    fn test_resource_agent_fields_are_fallback() {
        let extractor = AgentExtractor;
        let attrs = HashMap::new();
        let resource_attrs = make_attributes(vec![
            ("service_gen_ai.agent.name", json::json!("resource-agent")),
            ("service_gen_ai.agent.id", json::json!("resource-id")),
        ]);
        let identity =
            extractor.extract(&attrs, &resource_attrs, &GenAiAgentMappingConfig::default());

        assert_eq!(identity.name, Some("resource-agent".to_string()));
        assert_eq!(identity.id, Some("resource-id".to_string()));
    }

    #[test]
    fn test_span_agent_fields_win_over_resource_agent_fields() {
        let extractor = AgentExtractor;
        let attrs = make_attributes(vec![
            ("gen_ai.agent.name", json::json!("span-agent")),
            ("gen_ai.agent.id", json::json!("span-id")),
        ]);
        let resource_attrs = make_attributes(vec![
            ("service_gen_ai.agent.name", json::json!("resource-agent")),
            ("service_gen_ai.agent.id", json::json!("resource-id")),
        ]);
        let identity =
            extractor.extract(&attrs, &resource_attrs, &GenAiAgentMappingConfig::default());

        assert_eq!(identity.name, Some("span-agent".to_string()));
        assert_eq!(identity.id, Some("span-id".to_string()));
    }
}
