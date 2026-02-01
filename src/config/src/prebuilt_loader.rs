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

use std::collections::HashMap;

use hashbrown;
use serde::{Deserialize, Serialize};

use crate::meta::destinations::{
    Destination, DestinationType, Email, Endpoint, HTTPOutputFormat, HTTPType, Module, Template,
    TemplateType,
};

/// Configuration structure for prebuilt destinations loaded from JSON
#[derive(Debug, Deserialize, Serialize)]
pub struct PrebuiltDestinationsConfig {
    pub destinations: Vec<PrebuiltDestinationConfig>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PrebuiltDestinationConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub destination_type: String,
    pub icon: String,
    pub popular: bool,
    pub category: String,
    pub endpoint: Option<EndpointConfig>,
    pub template: TemplateConfig,
    #[serde(default)]
    pub credential_fields: Vec<CredentialFieldConfig>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EndpointConfig {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub output_format: String,
    pub destination_type: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TemplateConfig {
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub title: Option<String>, // For email templates
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CredentialFieldConfig {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub hint: String,
}

/// Load prebuilt destinations from configuration file
pub fn load_prebuilt_destinations() -> Vec<Destination> {
    // Try to load from config file first
    if let Ok(config_str) = std::fs::read_to_string("config/prebuilt-destinations.json")
        && let Ok(config) = serde_json::from_str::<PrebuiltDestinationsConfig>(&config_str)
    {
        return config
            .destinations
            .into_iter()
            .filter_map(|dest| convert_to_destination(dest).ok())
            .collect();
    }

    // Fallback to built-in defaults if config file doesn't exist or can't be parsed
    load_builtin_destinations()
}

/// Load prebuilt configuration from file or fallback to built-in
fn load_prebuilt_config() -> PrebuiltDestinationsConfig {
    if let Ok(config_str) = std::fs::read_to_string("config/prebuilt-destinations.json")
        && let Ok(config) = serde_json::from_str::<PrebuiltDestinationsConfig>(&config_str)
    {
        return config;
    }

    // Fallback to built-in config
    load_builtin_config()
}

/// Get a specific prebuilt template by type (e.g., "slack", "teams", "email")
pub fn get_prebuilt_template(prebuilt_type: &str) -> Option<Template> {
    let config = load_prebuilt_config();

    for dest_config in config.destinations {
        // Match by ID or destination_type in endpoint
        let matches = dest_config.id == prebuilt_type
            || dest_config
                .endpoint
                .as_ref()
                .map(|e| e.destination_type.as_str())
                == Some(prebuilt_type)
            || (prebuilt_type == "email" && dest_config.destination_type == "email");

        if matches {
            return Some(convert_template_config(
                &dest_config.template,
                &dest_config.destination_type,
            ));
        }
    }

    None
}

/// Convert TemplateConfig to Template
fn convert_template_config(config: &TemplateConfig, dest_type: &str) -> Template {
    let template_type = if dest_type == "email" {
        TemplateType::Email {
            title: config
                .title
                .clone()
                .unwrap_or_else(|| "OpenObserve Alert".to_string()),
        }
    } else {
        TemplateType::Http
    };

    Template {
        id: None,
        org_id: String::new(), // Will be set by caller
        name: config.name.clone(),
        is_default: false,
        template_type,
        body: config.body.clone(),
    }
}

/// Load built-in config (fallback when JSON file is not available)
fn load_builtin_config() -> PrebuiltDestinationsConfig {
    // Return built-in configuration with templates embedded
    // This ensures the system works even if the JSON file is missing
    PrebuiltDestinationsConfig {
        destinations: vec![
            PrebuiltDestinationConfig {
                id: "slack".to_string(),
                name: "Slack".to_string(),
                description: "Send notifications to Slack channels".to_string(),
                destination_type: "http".to_string(),
                icon: "slack-icon".to_string(),
                popular: true,
                category: "messaging".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "slack".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_slack".to_string(),
                    body: r#"{"text": "🚨 Alert: {alert_name}"}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "email".to_string(),
                name: "Email".to_string(),
                description: "Send email notifications".to_string(),
                destination_type: "email".to_string(),
                icon: "email-icon".to_string(),
                popular: true,
                category: "email".to_string(),
                endpoint: None,
                template: TemplateConfig {
                    name: "prebuilt_email".to_string(),
                    body: "<h2>🚨 Alert: {alert_name}</h2>".to_string(),
                    title: Some("OpenObserve Alert: {alert_name}".to_string()),
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "msteams".to_string(),
                name: "Microsoft Teams".to_string(),
                description: "Send notifications to Teams".to_string(),
                destination_type: "http".to_string(),
                icon: "teams-icon".to_string(),
                popular: true,
                category: "messaging".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://webhook.office.com/webhookb2/YOUR-TEAMS-WEBHOOK".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "teams".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_msteams".to_string(),
                    body: r#"{"@type": "MessageCard", "text": "🚨 Alert: {alert_name}"}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "pagerduty".to_string(),
                name: "PagerDuty".to_string(),
                description: "Create incidents in PagerDuty".to_string(),
                destination_type: "http".to_string(),
                icon: "pagerduty-icon".to_string(),
                popular: true,
                category: "incident".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://events.pagerduty.com/v2/enqueue".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "pagerduty".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_pagerduty".to_string(),
                    body: r#"{"event_action": "trigger", "payload": {"summary": "Alert: {alert_name}"}}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "discord".to_string(),
                name: "Discord".to_string(),
                description: "Send notifications to Discord".to_string(),
                destination_type: "http".to_string(),
                icon: "discord-icon".to_string(),
                popular: true,
                category: "messaging".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "discord".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_discord".to_string(),
                    body: r#"{"content": "🚨 Alert: {alert_name}"}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "webhook".to_string(),
                name: "Generic Webhook".to_string(),
                description: "Generic webhook for any HTTP endpoint".to_string(),
                destination_type: "http".to_string(),
                icon: "webhook-icon".to_string(),
                popular: false,
                category: "generic".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://your-service.com/webhook".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "webhook".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_webhook".to_string(),
                    body: r#"{"alert": {"name": "{alert_name}"}}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "opsgenie".to_string(),
                name: "Opsgenie".to_string(),
                description: "Create alerts in Opsgenie".to_string(),
                destination_type: "http".to_string(),
                icon: "opsgenie-icon".to_string(),
                popular: true,
                category: "incident".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://api.opsgenie.com/v2/alerts".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "opsgenie".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_opsgenie".to_string(),
                    body: r#"{"message": "Alert: {alert_name}"}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
            PrebuiltDestinationConfig {
                id: "servicenow".to_string(),
                name: "ServiceNow".to_string(),
                description: "Create incidents in ServiceNow".to_string(),
                destination_type: "http".to_string(),
                icon: "servicenow-icon".to_string(),
                popular: true,
                category: "incident".to_string(),
                endpoint: Some(EndpointConfig {
                    url: "https://YOUR_INSTANCE.service-now.com/api/now/table/incident".to_string(),
                    method: "POST".to_string(),
                    skip_tls_verify: false,
                    headers: HashMap::from([("Content-Type".to_string(), "application/json".to_string())]),
                    output_format: "JSON".to_string(),
                    destination_type: "servicenow".to_string(),
                }),
                template: TemplateConfig {
                    name: "prebuilt_servicenow".to_string(),
                    body: r#"{"short_description": "Alert: {alert_name}"}"#.to_string(),
                    title: None,
                },
                credential_fields: vec![],
                metadata: HashMap::new(),
            },
        ],
    }
}

fn convert_to_destination(config: PrebuiltDestinationConfig) -> Result<Destination, String> {
    let module = match config.destination_type.as_str() {
        "http" => {
            let endpoint_config = config.endpoint.ok_or_else(|| {
                "HTTP destination must have an endpoint configuration".to_string()
            })?;

            // Parse HTTP method
            let method = match endpoint_config.method.to_uppercase().as_str() {
                "POST" => HTTPType::POST,
                "PUT" => HTTPType::PUT,
                "GET" => HTTPType::GET,
                _ => {
                    return Err(format!(
                        "Unsupported HTTP method: {}",
                        endpoint_config.method
                    ));
                }
            };

            // Parse output format
            let output_format = match endpoint_config.output_format.as_str() {
                "JSON" => HTTPOutputFormat::JSON,
                "NDJSON" => HTTPOutputFormat::NDJSON,
                "NestedEvent" => HTTPOutputFormat::NestedEvent,
                _ => {
                    return Err(format!(
                        "Unsupported output format: {}",
                        endpoint_config.output_format
                    ));
                }
            };

            // Convert headers
            let headers: hashbrown::HashMap<String, String> =
                endpoint_config.headers.into_iter().collect();

            let mut endpoint_metadata: hashbrown::HashMap<String, String> = config
                .metadata
                .iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect();

            // Fix: service and description were nested in metadata field
            if let Some(serde_json::Value::Object(meta_obj)) = config.metadata.get("metadata") {
                if let Some(serde_json::Value::String(service)) = meta_obj.get("service") {
                    endpoint_metadata.insert("service".to_string(), service.clone());
                }
                if let Some(serde_json::Value::String(description)) = meta_obj.get("description") {
                    endpoint_metadata.insert("description".to_string(), description.clone());
                }
            } else {
                // Direct metadata fields
                for (k, v) in &config.metadata {
                    if let Some(s) = v.as_str() {
                        endpoint_metadata.insert(k.clone(), s.to_string());
                    }
                }
            }

            Module::Alert {
                template: Some(config.template.name),
                destination_type: DestinationType::Http(Endpoint {
                    url: endpoint_config.url,
                    method,
                    skip_tls_verify: endpoint_config.skip_tls_verify,
                    headers: if headers.is_empty() {
                        None
                    } else {
                        Some(headers)
                    },
                    action_id: None,
                    output_format: Some(output_format),
                    destination_type: Some(endpoint_config.destination_type),
                    metadata: endpoint_metadata,
                }),
            }
        }
        "email" => {
            // Parse recipients from metadata
            let recipients = if let Some(serde_json::Value::Array(recip_array)) =
                config.metadata.get("recipients")
            {
                recip_array
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            } else if let Some(serde_json::Value::String(default_email)) =
                config.metadata.get("recipients")
            {
                vec![default_email.clone()]
            } else {
                vec!["admin@your-domain.com".to_string()]
            };

            Module::Alert {
                template: Some(config.template.name),
                destination_type: DestinationType::Email(Email { recipients }),
            }
        }
        _ => {
            return Err(format!(
                "Unsupported destination type: {}",
                config.destination_type
            ));
        }
    };

    Ok(Destination {
        id: None,
        org_id: String::new(), // Will be set by caller
        name: config.name,
        module,
    })
}

/// Built-in fallback destinations in case config file is not available
fn load_builtin_destinations() -> Vec<Destination> {
    use hashbrown::HashMap;

    use crate::meta::destinations::{
        DestinationType, Email, Endpoint, HTTPOutputFormat, HTTPType, Module,
    };

    vec![
        Destination {
            id: None,
            org_id: String::new(),
            name: "Slack Webhook".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_slack".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([(
                        "Content-Type".to_string(),
                        "application/json".to_string(),
                    )])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("slack".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "slack".to_string()),
                        (
                            "description".to_string(),
                            "Slack webhook for team notifications".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "Microsoft Teams Webhook".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_msteams".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://your-tenant.webhook.office.com/webhookb2/YOUR-TEAMS-WEBHOOK-URL"
                        .to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([(
                        "Content-Type".to_string(),
                        "application/json".to_string(),
                    )])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("teams".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "teams".to_string()),
                        (
                            "description".to_string(),
                            "Microsoft Teams webhook for team notifications".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "PagerDuty Events API".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_pagerduty".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://events.pagerduty.com/v2/enqueue".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([
                        ("Content-Type".to_string(), "application/json".to_string()),
                        (
                            "Authorization".to_string(),
                            "Token YOUR_INTEGRATION_KEY".to_string(),
                        ),
                    ])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("pagerduty".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "pagerduty".to_string()),
                        (
                            "description".to_string(),
                            "PagerDuty incident management".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "Discord Webhook".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_discord".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([(
                        "Content-Type".to_string(),
                        "application/json".to_string(),
                    )])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("discord".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "discord".to_string()),
                        (
                            "description".to_string(),
                            "Discord webhook for community notifications".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "Generic Webhook".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_webhook".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://your-service.com/webhook".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([(
                        "Content-Type".to_string(),
                        "application/json".to_string(),
                    )])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("webhook".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "webhook".to_string()),
                        (
                            "description".to_string(),
                            "Generic webhook destination".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "Opsgenie".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_opsgenie".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://api.opsgenie.com/v2/alerts".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([
                        ("Content-Type".to_string(), "application/json".to_string()),
                        (
                            "Authorization".to_string(),
                            "GenieKey YOUR_API_KEY".to_string(),
                        ),
                    ])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("opsgenie".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "opsgenie".to_string()),
                        (
                            "description".to_string(),
                            "Opsgenie incident management and alerting".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "ServiceNow".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_servicenow".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://YOUR_INSTANCE.service-now.com/api/now/table/incident".to_string(),
                    method: HTTPType::POST,
                    skip_tls_verify: false,
                    headers: Some(HashMap::from([
                        ("Content-Type".to_string(), "application/json".to_string()),
                        (
                            "Authorization".to_string(),
                            "Basic YOUR_AUTH_TOKEN".to_string(),
                        ),
                    ])),
                    action_id: None,
                    output_format: Some(HTTPOutputFormat::JSON),
                    destination_type: Some("servicenow".to_string()),
                    metadata: HashMap::from([
                        ("service".to_string(), "servicenow".to_string()),
                        (
                            "description".to_string(),
                            "ServiceNow incident management".to_string(),
                        ),
                    ]),
                }),
            },
        },
        Destination {
            id: None,
            org_id: String::new(),
            name: "Email Notification".to_string(),
            module: Module::Alert {
                template: Some("prebuilt_email".to_string()),
                destination_type: DestinationType::Email(Email {
                    recipients: vec!["admin@your-domain.com".to_string()],
                }),
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn test_load_prebuilt_destinations() {
        let destinations = load_prebuilt_destinations();
        assert!(
            !destinations.is_empty(),
            "Should load at least some destinations"
        );

        // Should have 8 destinations
        assert_eq!(destinations.len(), 8);

        // Check for specific destinations
        let names: Vec<&str> = destinations.iter().map(|d| d.name.as_str()).collect();

        // Check that we have all 8 expected destination types
        // Names may vary between JSON config and built-in defaults
        let has_slack = names.iter().any(|n| n.contains("Slack"));
        let has_teams = names.iter().any(|n| n.contains("Teams"));
        let has_pagerduty = names.iter().any(|n| n.contains("PagerDuty"));
        let has_discord = names.iter().any(|n| n.contains("Discord"));
        let has_webhook = names.iter().any(|n| {
            n.contains("Webhook")
                && !n.contains("Slack")
                && !n.contains("Discord")
                && !n.contains("Teams")
        });
        let has_opsgenie = names.iter().any(|n| n.contains("Opsgenie"));
        let has_servicenow = names.iter().any(|n| n.contains("ServiceNow"));
        let has_email = names.iter().any(|n| n.contains("Email"));

        assert!(has_slack, "Missing Slack destination");
        assert!(has_teams, "Missing Teams destination");
        assert!(has_pagerduty, "Missing PagerDuty destination");
        assert!(has_discord, "Missing Discord destination");
        assert!(has_webhook, "Missing Generic Webhook destination");
        assert!(has_opsgenie, "Missing Opsgenie destination");
        assert!(has_servicenow, "Missing ServiceNow destination");
        assert!(has_email, "Missing Email destination");
    }

    #[test]
    fn test_config_file_loading() {
        // Create a temporary config file for testing
        let test_config = r#"{
  "destinations": [
    {
      "id": "test",
      "name": "Test Destination",
      "description": "Test",
      "type": "http",
      "icon": "test",
      "popular": false,
      "category": "test",
      "endpoint": {
        "url": "https://example.com/webhook",
        "method": "POST",
        "skip_tls_verify": false,
        "headers": {},
        "output_format": "JSON",
        "destination_type": "test"
      },
      "template": {
        "name": "test-template",
        "body": "{\"test\": \"data\"}"
      },
      "credential_fields": [],
      "metadata": {}
    }
  ]
}"#;

        // Ensure config directory exists for test
        fs::create_dir_all("config").ok();

        let config_path = "config/test-prebuilt-destinations.json";
        fs::write(config_path, test_config).unwrap();

        // Temporarily replace the main config path
        if let Ok(config_str) = fs::read_to_string(config_path) {
            if let Ok(config) = serde_json::from_str::<PrebuiltDestinationsConfig>(&config_str) {
                let destinations: Vec<Destination> = config
                    .destinations
                    .into_iter()
                    .filter_map(|dest| convert_to_destination(dest).ok())
                    .collect();

                assert_eq!(destinations.len(), 1);
                assert_eq!(destinations[0].name, "Test Destination");
            }
        }

        // Clean up
        fs::remove_file(config_path).ok();
    }

    #[test]
    fn test_get_prebuilt_template_slack() {
        let template = get_prebuilt_template("slack");
        assert!(template.is_some(), "Slack template should exist");

        let template = template.unwrap();
        assert_eq!(template.name, "prebuilt_slack");
        assert!(
            !template.body.is_empty(),
            "Template body should not be empty"
        );
        assert!(matches!(template.template_type, TemplateType::Http));
    }

    #[test]
    fn test_get_prebuilt_template_email() {
        let template = get_prebuilt_template("email");
        assert!(template.is_some(), "Email template should exist");

        let template = template.unwrap();
        assert_eq!(template.name, "prebuilt_email");
        assert!(
            !template.body.is_empty(),
            "Template body should not be empty"
        );

        // Email template should have title
        if let TemplateType::Email { title } = template.template_type {
            assert!(!title.is_empty(), "Email template should have title");
            assert!(title.contains("Alert"), "Email title should mention Alert");
        } else {
            panic!("Email template should be of type Email");
        }
    }

    #[test]
    fn test_get_prebuilt_template_all_types() {
        let types = vec![
            "slack",
            "msteams",
            "pagerduty",
            "discord",
            "webhook",
            "opsgenie",
            "servicenow",
            "email",
        ];

        for prebuilt_type in types {
            let template = get_prebuilt_template(prebuilt_type);
            assert!(
                template.is_some(),
                "Template should exist for type: {}",
                prebuilt_type
            );

            let template = template.unwrap();
            assert_eq!(
                template.name,
                format!("prebuilt_{}", prebuilt_type),
                "Template name should match convention for type: {}",
                prebuilt_type
            );
            assert!(
                !template.body.is_empty(),
                "Template body should not be empty for type: {}",
                prebuilt_type
            );
        }
    }

    #[test]
    fn test_get_prebuilt_template_invalid_type() {
        let template = get_prebuilt_template("nonexistent");
        assert!(template.is_none(), "Should return None for invalid type");
    }
}
