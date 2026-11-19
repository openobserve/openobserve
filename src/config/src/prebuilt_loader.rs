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
    TemplateKind, TemplateType,
};

/// Configuration structure for prebuilt destinations loaded from JSON
#[derive(Debug, Deserialize, Serialize)]
pub struct PrebuiltDestinationsConfig {
    /// Monotonic revision of the shipped prebuilt definitions. Bumped whenever a
    /// shipped body/type is corrected; gates the startup reseed (design §6.3).
    #[serde(default)]
    pub revision: u32,
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

/// Prefix that marks system-managed template names. The full reserved set is
/// `prebuilt_<type>` where `<type>` is one of the registered prebuilt
/// destination types — see `is_prebuilt_template_name` below.
pub const PREBUILT_TEMPLATE_PREFIX: &str = "prebuilt_";

/// True only for template names the system actually manages: the name must be
/// `prebuilt_<type>` where `<type>` is a registered prebuilt destination type
/// (slack, opsgenie, servicenow, ...).
///
/// Lives next to `get_prebuilt_template` so the API models
/// (`openobserve_api_management::models`), the service-layer guards
/// (`openobserve_core::alerts::templates`), and any future caller all derive
/// the "is system template" answer from the same source of truth.
///
/// User-created templates whose names happen to start with `prebuilt_` but
/// don't match a registered type stay freely editable and deletable.
pub fn is_prebuilt_template_name(name: &str) -> bool {
    name.strip_prefix(PREBUILT_TEMPLATE_PREFIX)
        .is_some_and(|t| get_prebuilt_template(t).is_some())
}

/// Get a specific prebuilt template by type (e.g., "slack", "teams", "email")
pub fn get_prebuilt_template(prebuilt_type: &str) -> Option<Template> {
    find_template(&load_prebuilt_config(), prebuilt_type)
}

fn find_template(config: &PrebuiltDestinationsConfig, prebuilt_type: &str) -> Option<Template> {
    for dest_config in &config.destinations {
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

/// Get the revision number of the prebuilt configuration
pub fn get_prebuilt_revision() -> u32 {
    load_prebuilt_config().revision
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
        kind: TemplateKind::default(),
        applies_to: Vec::new(),
    }
}

/// The shipped `config/prebuilt-destinations.json`, compiled into the binary.
///
/// Release images copy only the binary into a distroless runtime, so the
/// relative path that `load_prebuilt_config` reads never exists there. Before
/// this was embedded, every real deployment fell back to a hand-written copy
/// whose bodies were one line (`[{alert_status}] {alert_name}`).
const EMBEDDED_CONFIG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../config/prebuilt-destinations.json"
));

/// Bodies the old hand-written fallback shipped for the chat and email templates, as
/// `(template name, body)`. These templates only change how a message looks, so a row that still
/// holds one of these bodies is sent with the shipped body.
pub const LEGACY_BUILTIN_BODIES: &[(&str, &str)] = &[
    (
        "prebuilt_slack",
        r#"{"text": "[{alert_status}] {alert_name}"}"#,
    ),
    ("prebuilt_email", "<h2>[{alert_status}] {alert_name}</h2>"),
    (
        "prebuilt_msteams",
        r#"{"@type": "MessageCard", "text": "[{alert_status}] {alert_name}"}"#,
    ),
    // A destination of type `teams` saves its copy under the endpoint type's name.
    (
        "prebuilt_teams",
        r#"{"@type": "MessageCard", "text": "[{alert_status}] {alert_name}"}"#,
    ),
    (
        "prebuilt_discord",
        r#"{"content": "[{alert_status}] {alert_name}"}"#,
    ),
];

/// Bodies the old hand-written fallback shipped for templates that open tickets or feed other
/// systems. The shipped bodies add fields (urgency, impact, caller, links) that change what the
/// receiving system creates, so a row that holds one of these bodies keeps it: it is not upgraded
/// on read and the startup reseed does not overwrite it.
pub const KEPT_LEGACY_BODIES: &[(&str, &str)] = &[
    (
        "prebuilt_pagerduty",
        r#"{"payload": {"summary": "OpenObserve [{alert_status}]: {alert_name}", "severity": "{severity}", "source": "{source}"}, "routing_key": "{routing_key}", "event_action": "trigger"}"#,
    ),
    (
        "prebuilt_webhook",
        r#"{"alert": {"name": "{alert_name}", "status": "{alert_status}"}}"#,
    ),
    (
        "prebuilt_opsgenie",
        r#"{"message": "[{alert_status}] {alert_name}", "priority": "{credential_priority}"}"#,
    ),
    (
        "prebuilt_servicenow",
        r#"{"short_description": "[{alert_status}] {alert_name}", "assignment_group": "{credential_assignmentGroup}"}"#,
    ),
];

/// Chat and email bodies that earlier versions of `config/prebuilt-destinations.json` shipped,
/// keyed by template name. Deployments that had the file on disk saved rows with these bodies.
const PREVIOUS_SHIPPED_BODIES: &str = include_str!("prebuilt_previous_bodies.json");

fn previous_shipped_bodies() -> &'static HashMap<String, Vec<String>> {
    static BODIES: std::sync::OnceLock<HashMap<String, Vec<String>>> = std::sync::OnceLock::new();
    BODIES.get_or_init(|| {
        serde_json::from_str(PREVIOUS_SHIPPED_BODIES)
            .expect("prebuilt_previous_bodies.json is valid; a test parses it")
    })
}

/// True when `body` is a body that the system once shipped for the chat or email template `name`
/// and that the read path replaces with the shipped body.
pub fn is_legacy_builtin_body(name: &str, body: &str) -> bool {
    LEGACY_BUILTIN_BODIES
        .iter()
        .any(|(n, b)| *n == name && *b == body)
        || previous_shipped_bodies()
            .get(name)
            .is_some_and(|bodies| bodies.iter().any(|b| b == body))
}

/// True when `body` is the old fallback body of a ticketing or webhook template `name`, which the
/// startup reseed must leave in place.
pub fn is_kept_legacy_body(name: &str, body: &str) -> bool {
    KEPT_LEGACY_BODIES
        .iter()
        .any(|(n, b)| *n == name && *b == body)
}

/// Replaces `body` with the shipped body when it is an earlier system body of the chat or email
/// template `name`. Every stored row goes through this on read, so a row an old node or a lagging
/// replica still holds is sent with the shipped body. Returns true when it changed `body`.
pub fn upgrade_legacy_body(name: &str, body: &mut String) -> bool {
    if !is_legacy_builtin_body(name, body) {
        return false;
    }
    let Some(shipped) = name
        .strip_prefix(PREBUILT_TEMPLATE_PREFIX)
        .and_then(get_prebuilt_template)
    else {
        return false;
    };
    if shipped.body == *body {
        return false;
    }
    *body = shipped.body;
    true
}

/// True when `body` is exactly the body this binary ships for the system template `name`, so the
/// system, not a user or an operator's override file, wrote every placeholder in it.
pub fn is_shipped_prebuilt_body(name: &str, body: &str) -> bool {
    let Some(prebuilt_type) = name.strip_prefix(PREBUILT_TEMPLATE_PREFIX) else {
        return false;
    };
    find_template(&load_builtin_config(), prebuilt_type).is_some_and(|t| t.body == body)
}

/// Built-in config: the embedded copy of the shipped JSON.
fn load_builtin_config() -> PrebuiltDestinationsConfig {
    serde_json::from_str(EMBEDDED_CONFIG)
        .expect("config/prebuilt-destinations.json is valid; a test parses it")
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

/// Built-in destinations, from the embedded config.
fn load_builtin_destinations() -> Vec<Destination> {
    load_builtin_config()
        .destinations
        .into_iter()
        .filter_map(|dest| convert_to_destination(dest).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn builtin_prebuilt_config_is_revised_and_clean() {
        let cfg = load_builtin_config();
        assert!(cfg.revision >= 1, "builtin config must carry revision >= 1");
        for d in &cfg.destinations {
            assert!(
                !d.template.body.contains("{alert_time}"),
                "dangling {{alert_time}} in builtin body: {}",
                d.id
            );
        }
    }

    /// CUSTOM bodies: nothing can be injected into the author's raw JSON, so one without
    /// `{alert_status}` would render a resolve byte-identical to the firing.
    #[test]
    fn every_shipped_prebuilt_template_can_announce_a_recovery() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../config/prebuilt-destinations.json"
        );
        let cfg: PrebuiltDestinationsConfig =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        // The builtin is not a copy of the file, it is the fallback used
        // whenever the process does not run from the repo root — which is every
        // real deployment. Checking only the file passed green while the
        // fallback shipped a body that its own validation refuses.
        let builtin = load_builtin_config();
        for d in cfg.destinations.iter().chain(builtin.destinations.iter()) {
            assert!(
                d.template.body.contains("{alert_status}"),
                "prebuilt '{}' cannot say a recovery is a recovery",
                d.id
            );
            assert!(
                !d.template.body.to_lowercase().contains("firing")
                    || d.template.body.contains("{alert_status}"),
                "prebuilt '{}' hardcodes a status that lies on recovery",
                d.id
            );
        }
    }

    #[test]
    fn shipped_prebuilt_json_is_revised_and_clean() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../config/prebuilt-destinations.json"
        );
        let raw = std::fs::read_to_string(path).unwrap();
        let cfg: PrebuiltDestinationsConfig = serde_json::from_str(&raw).unwrap();
        assert!(cfg.revision >= 1);
        for d in &cfg.destinations {
            assert!(
                !d.template.body.contains("{alert_time}"),
                "dangling in JSON body: {}",
                d.id
            );
        }
    }

    #[test]
    fn test_load_prebuilt_destinations() {
        let destinations = load_prebuilt_destinations();
        assert!(
            !destinations.is_empty(),
            "Should load at least some destinations"
        );

        // Should have 9 destinations
        assert_eq!(destinations.len(), 9);

        // Check for specific destinations
        let names: Vec<&str> = destinations.iter().map(|d| d.name.as_str()).collect();

        // Check that we have all 9 expected destination types
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
        let has_jira = names.iter().any(|n| n.contains("Jira"));
        let has_email = names.iter().any(|n| n.contains("Email"));

        assert!(has_slack, "Missing Slack destination");
        assert!(has_teams, "Missing Teams destination");
        assert!(has_pagerduty, "Missing PagerDuty destination");
        assert!(has_discord, "Missing Discord destination");
        assert!(has_webhook, "Missing Generic Webhook destination");
        assert!(has_opsgenie, "Missing Opsgenie destination");
        assert!(has_servicenow, "Missing ServiceNow destination");
        assert!(has_jira, "Missing Jira destination");
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
        if let Ok(config_str) = fs::read_to_string(config_path)
            && let Ok(config) = serde_json::from_str::<PrebuiltDestinationsConfig>(&config_str)
        {
            let destinations: Vec<Destination> = config
                .destinations
                .into_iter()
                .filter_map(|dest| convert_to_destination(dest).ok())
                .collect();

            assert_eq!(destinations.len(), 1);
            assert_eq!(destinations[0].name, "Test Destination");
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
            "jira",
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

    #[test]
    fn test_convert_template_config_http_type() {
        let config = TemplateConfig {
            name: "my_template".to_string(),
            body: "alert body".to_string(),
            title: None,
        };
        let result = convert_template_config(&config, "http");
        assert_eq!(result.name, "my_template");
        assert_eq!(result.body, "alert body");
        assert!(matches!(result.template_type, TemplateType::Http));
    }

    #[test]
    fn test_convert_template_config_email_with_title() {
        let config = TemplateConfig {
            name: "email_tpl".to_string(),
            body: "email body".to_string(),
            title: Some("Custom Subject".to_string()),
        };
        let result = convert_template_config(&config, "email");
        assert_eq!(result.name, "email_tpl");
        match result.template_type {
            TemplateType::Email { title } => assert_eq!(title, "Custom Subject"),
            _ => panic!("Expected Email template type"),
        }
    }

    #[test]
    fn test_convert_template_config_email_uses_default_title_when_none() {
        let config = TemplateConfig {
            name: "email_tpl2".to_string(),
            body: "body".to_string(),
            title: None,
        };
        let result = convert_template_config(&config, "email");
        match result.template_type {
            TemplateType::Email { title } => assert_eq!(title, "OpenObserve Alert"),
            _ => panic!("Expected Email template type"),
        }
    }
    /// Tests run from the crate dir, where `config/prebuilt-destinations.json` does not exist,
    /// which is the same as a release image: the template must still be the shipped one.
    #[test]
    fn slack_template_without_a_config_dir_is_the_shipped_blocks_body() {
        assert!(!std::path::Path::new("config/prebuilt-destinations.json").exists());
        let body = get_prebuilt_template("slack").unwrap().body;
        assert!(body.contains("\"blocks\""), "{body}");
        assert!(body.contains("{alert_url}"), "{body}");
        assert!(!is_legacy_builtin_body("prebuilt_slack", &body));
    }

    /// Slack rejects a header block over 150 characters, and an alert name has no such limit.
    #[test]
    fn slack_body_has_no_header_block() {
        let body = get_prebuilt_template("slack").unwrap().body;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        for block in v["blocks"].as_array().unwrap() {
            assert_ne!(block["type"], "header", "{block}");
        }
    }

    #[test]
    fn legacy_bodies_upgrade_and_other_bodies_stay() {
        let mut slack = r#"{"text": "[{alert_status}] {alert_name}"}"#.to_string();
        assert!(upgrade_legacy_body("prebuilt_slack", &mut slack));
        assert!(slack.contains("\"blocks\""), "{slack}");

        let mut teams =
            r#"{"@type": "MessageCard", "text": "[{alert_status}] {alert_name}"}"#.to_string();
        assert!(upgrade_legacy_body("prebuilt_teams", &mut teams));
        assert_eq!(teams, get_prebuilt_template("msteams").unwrap().body);

        let mut email = "<h2>[{alert_status}] {alert_name}</h2>".to_string();
        assert!(upgrade_legacy_body("prebuilt_email", &mut email));
        assert_ne!(email, "<h2>[{alert_status}] {alert_name}</h2>");

        let mut edited = r#"{"text": "custom {alert_status}"}"#.to_string();
        assert!(!upgrade_legacy_body("prebuilt_slack", &mut edited));
        let mut other_name = r#"{"text": "[{alert_status}] {alert_name}"}"#.to_string();
        assert!(!upgrade_legacy_body("my_slack", &mut other_name));
        assert_eq!(other_name, r#"{"text": "[{alert_status}] {alert_name}"}"#);

        let mut shipped = get_prebuilt_template("slack").unwrap().body;
        assert!(!upgrade_legacy_body("prebuilt_slack", &mut shipped));
    }

    #[test]
    fn ticketing_and_webhook_legacy_bodies_are_kept() {
        for (name, body) in KEPT_LEGACY_BODIES {
            let mut stored = body.to_string();
            assert!(!upgrade_legacy_body(name, &mut stored), "{name}");
            assert_eq!(stored, *body);
            assert!(is_kept_legacy_body(name, body), "{name}");
            assert!(!is_legacy_builtin_body(name, body), "{name}");
        }
        let servicenow = get_prebuilt_template("servicenow").unwrap().body;
        assert!(!is_kept_legacy_body("prebuilt_servicenow", &servicenow));
    }

    #[test]
    fn earlier_shipped_chat_bodies_upgrade_to_the_shipped_body() {
        let previous = previous_shipped_bodies();
        let old_slack = &previous["prebuilt_slack"];
        assert!(
            old_slack.iter().any(|b| b.contains("\"header\"")),
            "the rich Slack body with a header block is listed"
        );
        let shipped = get_prebuilt_template("slack").unwrap().body;
        for body in old_slack {
            let mut stored = body.clone();
            assert!(upgrade_legacy_body("prebuilt_slack", &mut stored));
            assert_eq!(stored, shipped);
        }
        for (name, bodies) in previous {
            let prebuilt_type = name.strip_prefix(PREBUILT_TEMPLATE_PREFIX).unwrap();
            assert!(
                matches!(
                    prebuilt_type,
                    "slack" | "msteams" | "teams" | "discord" | "email"
                ),
                "only chat and email bodies upgrade, found {name}"
            );
            let shipped = get_prebuilt_template(prebuilt_type).unwrap().body;
            assert!(!bodies.contains(&shipped), "{name} lists its shipped body");
        }
    }

    #[test]
    fn only_an_unchanged_shipped_body_counts_as_shipped() {
        let body = get_prebuilt_template("slack").unwrap().body;
        assert!(is_shipped_prebuilt_body("prebuilt_slack", &body));
        assert!(!is_shipped_prebuilt_body(
            "prebuilt_slack",
            r#"{"text": "x"}"#
        ));
        assert!(!is_shipped_prebuilt_body("my_slack", &body));
        // An operator's override file is not the body this binary ships.
        assert!(!is_shipped_prebuilt_body(
            "prebuilt_webhook",
            r#"{"payload":{alert_description}}"#
        ));
        let teams = get_prebuilt_template("teams").unwrap().body;
        assert!(is_shipped_prebuilt_body("prebuilt_teams", &teams));
    }

    #[test]
    fn opsgenie_body_leaves_the_alias_to_the_episode_stamp() {
        let body = get_prebuilt_template("opsgenie").unwrap().body;
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v.get("alias").is_none(), "{body}");
    }

    #[test]
    fn teams_alias_resolves_to_the_msteams_template() {
        let teams = get_prebuilt_template("teams").unwrap();
        assert_eq!(teams.body, get_prebuilt_template("msteams").unwrap().body);
    }

    #[test]
    fn builtin_config_is_the_shipped_json() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../config/prebuilt-destinations.json"
        );
        let file: PrebuiltDestinationsConfig =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let builtin = load_builtin_config();
        assert_eq!(builtin.revision, file.revision);
        assert_eq!(
            serde_json::to_value(&builtin.destinations).unwrap(),
            serde_json::to_value(&file.destinations).unwrap()
        );
    }

    #[test]
    fn no_shipped_body_is_a_legacy_one_liner() {
        for d in load_builtin_config().destinations {
            assert!(
                !is_legacy_builtin_body(&d.template.name, &d.template.body),
                "'{}' still ships the old one-line body, so the reseed would loop",
                d.id
            );
        }
    }
}
