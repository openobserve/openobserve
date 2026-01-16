// Copyright 2025 OpenObserve Inc.
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

use std::fmt;

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
#[serde(rename_all = "snake_case")]
pub struct Destination {
    pub id: Option<svix_ksuid::Ksuid>,
    pub org_id: String,
    pub name: String,
    pub module: Module,
}

impl Destination {
    pub fn is_alert_destinations(&self) -> bool {
        matches!(&self.module, Module::Alert { .. })
    }
}

#[derive(Serialize, Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum Module {
    Alert {
        /// Optional template name. When None, the alert must specify a template
        /// at the alert level.
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        template: Option<String>,
        destination_type: DestinationType,
    },
    Pipeline {
        endpoint: Endpoint,
    },
}

impl Default for Module {
    fn default() -> Self {
        Module::Alert {
            template: None,
            destination_type: DestinationType::Http(Endpoint::default()),
        }
    }
}
impl std::fmt::Display for Module {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Module::Alert { .. } => "alert",
            Module::Pipeline { .. } => "pipeline",
        };
        write!(f, "{s}")
    }
}

#[derive(Serialize, Debug, Deserialize, Clone)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    Http(Endpoint),
    Email(Email),
    Sns(AwsSns),
}

impl Default for DestinationType {
    fn default() -> Self {
        DestinationType::Http(Endpoint::default())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Email {
    pub recipients: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Endpoint {
    pub url: String,
    #[serde(default)]
    pub method: HTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<HTTPOutputFormat>,
    /// Destination type (e.g., "openobserve", "splunk", "elasticsearch", "custom")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_type: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AwsSns {
    pub sns_topic_arn: String,
    pub aws_region: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum HTTPType {
    #[default]
    POST,
    PUT,
    GET,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum HTTPOutputFormat {
    #[default]
    JSON,
    NDJSON,
    NestedEvent,
    ESBulk {
        index: String,
    },
}

impl HTTPOutputFormat {
    pub fn get_content_type(&self) -> &'static str {
        match self {
            Self::JSON => "application/json",
            Self::NDJSON => "application/x-ndjson",
            Self::NestedEvent => "application/x-ndjson",
            Self::ESBulk { .. } => "application/x-ndjson",
        }
    }

    pub fn get_body_from_data<T: AsRef<Value> + Serialize>(
        &self,
        data: &[T],
        metadata: &HashMap<String, String>,
    ) -> Vec<u8> {
        let data = data
            .iter()
            .map(|val| {
                let mut t = val.as_ref().clone();
                if let Some(obj) = t.as_object_mut() {
                    for (k, v) in metadata.iter() {
                        obj.insert(k.clone(), Value::String(v.clone()));
                    }
                }
                t
            })
            .collect::<Vec<_>>();

        match self {
            Self::JSON => serde_json::to_vec(&data).unwrap(),
            Self::NDJSON => data
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join("\n")
                .into_bytes(),
            Self::NestedEvent => data
                .iter()
                .map(|v| serde_json::json!({"event":v}).to_string())
                .collect::<Vec<_>>()
                .join("\n")
                .into_bytes(),
            Self::ESBulk { index } => {
                let expected_count = data.len();
                let mut ret = Vec::with_capacity(expected_count * 2);
                data.iter().for_each(|v| {
                    ret.push(serde_json::json!({ "index": { "_index": index } }).to_string());
                    ret.push(v.to_string());
                });
                let mut temp = ret.join("\n").into_bytes();
                // for ES Bulk format, the payload must end with a newline
                temp.push(b'\n');
                temp
            }
        }
    }
}

impl fmt::Display for HTTPType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::POST => write!(f, "post"),
            Self::PUT => write!(f, "put"),
            Self::GET => write!(f, "get"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[serde(default)]
#[serde(rename_all = "snake_case")]
pub struct Template {
    #[schema(value_type = Option<String>)]
    pub id: Option<svix_ksuid::Ksuid>,
    pub org_id: String,
    pub name: String,
    pub is_default: bool,
    #[serde(rename = "type")]
    pub template_type: TemplateType,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TemplateType {
    #[default]
    Http,
    Email {
        title: String,
    },
    Sns,
}

impl fmt::Display for TemplateType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TemplateType::Http => write!(f, "http"),
            TemplateType::Email { .. } => write!(f, "email"),
            TemplateType::Sns => write!(f, "sns"),
        }
    }
}

impl Destination {
    /// Get prebuilt destination configurations for common services
    ///
    /// This provides predefined configurations for popular notification services
    /// that users can customize with their own URLs and credentials.
    pub fn prebuilt_destinations() -> Vec<Self> {
        vec![
            // Slack webhook destination
            Self {
                id: None,
                org_id: String::new(), // Will be set by caller
                name: "Slack Webhook".to_string(),
                module: Module::Alert {
                    template: None, // Can be set at alert level
                    destination_type: DestinationType::Http(Endpoint {
                        url: "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK".to_string(),
                        method: HTTPType::POST,
                        skip_tls_verify: false,
                        headers: Some(HashMap::from([
                            ("Content-Type".to_string(), "application/json".to_string()),
                        ])),
                        action_id: None,
                        output_format: Some(HTTPOutputFormat::JSON),
                        destination_type: Some("slack".to_string()),
                        metadata: HashMap::from([
                            ("service".to_string(), "slack".to_string()),
                            ("description".to_string(), "Slack webhook for team notifications".to_string()),
                        ]),
                    }),
                },
            },
            // Microsoft Teams webhook destination
            Self {
                id: None,
                org_id: String::new(),
                name: "Microsoft Teams Webhook".to_string(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Http(Endpoint {
                        url: "https://your-tenant.webhook.office.com/webhookb2/YOUR-TEAMS-WEBHOOK-URL".to_string(),
                        method: HTTPType::POST,
                        skip_tls_verify: false,
                        headers: Some(HashMap::from([
                            ("Content-Type".to_string(), "application/json".to_string()),
                        ])),
                        action_id: None,
                        output_format: Some(HTTPOutputFormat::JSON),
                        destination_type: Some("teams".to_string()),
                        metadata: HashMap::from([
                            ("service".to_string(), "teams".to_string()),
                            ("description".to_string(), "Microsoft Teams webhook for team notifications".to_string()),
                        ]),
                    }),
                },
            },
            // PagerDuty Events API destination
            Self {
                id: None,
                org_id: String::new(),
                name: "PagerDuty Events API".to_string(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Http(Endpoint {
                        url: "https://events.pagerduty.com/v2/enqueue".to_string(),
                        method: HTTPType::POST,
                        skip_tls_verify: false,
                        headers: Some(HashMap::from([
                            ("Content-Type".to_string(), "application/json".to_string()),
                            ("Authorization".to_string(), "Token YOUR_INTEGRATION_KEY".to_string()),
                        ])),
                        action_id: None,
                        output_format: Some(HTTPOutputFormat::JSON),
                        destination_type: Some("pagerduty".to_string()),
                        metadata: HashMap::from([
                            ("service".to_string(), "pagerduty".to_string()),
                            ("description".to_string(), "PagerDuty incident management".to_string()),
                        ]),
                    }),
                },
            },
            // Discord webhook destination
            Self {
                id: None,
                org_id: String::new(),
                name: "Discord Webhook".to_string(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Http(Endpoint {
                        url: "https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK".to_string(),
                        method: HTTPType::POST,
                        skip_tls_verify: false,
                        headers: Some(HashMap::from([
                            ("Content-Type".to_string(), "application/json".to_string()),
                        ])),
                        action_id: None,
                        output_format: Some(HTTPOutputFormat::JSON),
                        destination_type: Some("discord".to_string()),
                        metadata: HashMap::from([
                            ("service".to_string(), "discord".to_string()),
                            ("description".to_string(), "Discord webhook for community notifications".to_string()),
                        ]),
                    }),
                },
            },
            // Generic webhook destination
            Self {
                id: None,
                org_id: String::new(),
                name: "Generic Webhook".to_string(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Http(Endpoint {
                        url: "https://your-service.com/webhook".to_string(),
                        method: HTTPType::POST,
                        skip_tls_verify: false,
                        headers: Some(HashMap::from([
                            ("Content-Type".to_string(), "application/json".to_string()),
                        ])),
                        action_id: None,
                        output_format: Some(HTTPOutputFormat::JSON),
                        destination_type: Some("webhook".to_string()),
                        metadata: HashMap::from([
                            ("service".to_string(), "webhook".to_string()),
                            ("description".to_string(), "Generic webhook destination".to_string()),
                        ]),
                    }),
                },
            },
            // Email destination
            Self {
                id: None,
                org_id: String::new(),
                name: "Email Notification".to_string(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Email(Email {
                        recipients: vec!["admin@your-domain.com".to_string()],
                    }),
                },
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike;

    use super::*;

    #[test]
    fn test_destination_is_alert_destinations() {
        let alert_dest = Destination {
            id: None,
            org_id: "test_org".to_string(),
            name: "alert_dest".to_string(),
            module: Module::Alert {
                template: Some("template".to_string()),
                destination_type: DestinationType::Http(Endpoint::default()),
            },
        };
        assert!(alert_dest.is_alert_destinations());

        let pipeline_dest = Destination {
            id: None,
            org_id: "test_org".to_string(),
            name: "pipeline_dest".to_string(),
            module: Module::Pipeline {
                endpoint: Endpoint::default(),
            },
        };
        assert!(!pipeline_dest.is_alert_destinations());
    }

    #[test]
    fn test_module_default() {
        let module = Module::default();
        match module {
            Module::Alert {
                template,
                destination_type,
            } => {
                assert_eq!(template, None);
                assert!(matches!(destination_type, DestinationType::Http(_)));
            }
            _ => panic!("Default should be Alert"),
        }
    }

    #[test]
    fn test_module_display() {
        let alert_module = Module::Alert {
            template: Some("test".to_string()),
            destination_type: DestinationType::Http(Endpoint::default()),
        };
        assert_eq!(alert_module.to_string(), "alert");

        let pipeline_module = Module::Pipeline {
            endpoint: Endpoint::default(),
        };
        assert_eq!(pipeline_module.to_string(), "pipeline");
    }

    #[test]
    fn test_destination_type_default() {
        let dest_type = DestinationType::default();
        assert!(matches!(dest_type, DestinationType::Http(_)));
    }

    #[test]
    fn test_endpoint_with_headers() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        let endpoint = Endpoint {
            url: "https://api.example.com".to_string(),
            method: HTTPType::POST,
            skip_tls_verify: false,
            headers: Some(headers.clone()),
            action_id: Some("action_123".to_string()),
            output_format: Some(HTTPOutputFormat::JSON),
            destination_type: Some("custom".to_string()),
            metadata: HashMap::new(),
        };

        assert_eq!(endpoint.url, "https://api.example.com");
        assert_eq!(endpoint.method, HTTPType::POST);
        assert!(!endpoint.skip_tls_verify);
        assert_eq!(endpoint.headers, Some(headers));
        assert_eq!(endpoint.action_id, Some("action_123".to_string()));
        assert_eq!(endpoint.output_format, Some(HTTPOutputFormat::JSON));
        assert_eq!(endpoint.destination_type, Some("custom".to_string()));
    }

    #[test]
    fn test_template_with_id() {
        let id = svix_ksuid::Ksuid::new(None, None);
        let template = Template {
            id: Some(id),
            org_id: "test_org".to_string(),
            name: "test_template".to_string(),
            is_default: true,
            template_type: TemplateType::Email {
                title: "Test Email".to_string(),
            },
            body: "Hello {{name}}!".to_string(),
        };

        assert_eq!(template.id, Some(id));
        assert_eq!(template.org_id, "test_org");
        assert_eq!(template.name, "test_template");
        assert!(template.is_default);
        assert!(matches!(template.template_type, TemplateType::Email { .. }));
        assert_eq!(template.body, "Hello {{name}}!");
    }

    #[test]
    fn test_template_type_display() {
        assert_eq!(TemplateType::Http.to_string(), "http");
        assert_eq!(
            TemplateType::Email {
                title: "Test".to_string()
            }
            .to_string(),
            "email"
        );
        assert_eq!(TemplateType::Sns.to_string(), "sns");
    }

    #[test]
    fn test_serialization_deserialization() {
        let destination = Destination {
            id: Some(svix_ksuid::Ksuid::new(None, None)),
            org_id: "test_org".to_string(),
            name: "test_dest".to_string(),
            module: Module::Alert {
                template: Some("alert_template".to_string()),
                destination_type: DestinationType::Email(Email {
                    recipients: vec!["user@example.com".to_string()],
                }),
            },
        };

        let serialized = serde_json::to_string(&destination).unwrap();
        let deserialized: Destination = serde_json::from_str(&serialized).unwrap();

        assert_eq!(destination.org_id, deserialized.org_id);
        assert_eq!(destination.name, deserialized.name);
        assert!(matches!(deserialized.module, Module::Alert { .. }));
    }

    #[test]
    fn test_destination_type_http() {
        let endpoint = Endpoint {
            url: "https://webhook.example.com".to_string(),
            method: HTTPType::POST,
            skip_tls_verify: true,
            headers: None,
            action_id: None,
            output_format: None,
            destination_type: Some("openobserve".to_string()),
            metadata: HashMap::new(),
        };

        let dest_type = DestinationType::Http(endpoint.clone());
        assert!(matches!(dest_type, DestinationType::Http(_)));
    }

    #[test]
    fn test_destination_type_email() {
        let email = Email {
            recipients: vec![
                "admin@example.com".to_string(),
                "user@example.com".to_string(),
            ],
        };

        let dest_type = DestinationType::Email(email.clone());
        assert!(matches!(dest_type, DestinationType::Email(_)));
    }

    #[test]
    fn test_destination_type_sns() {
        let sns = AwsSns {
            sns_topic_arn: "arn:aws:sns:us-east-1:123456789012:my-topic".to_string(),
            aws_region: "us-east-1".to_string(),
        };

        let dest_type = DestinationType::Sns(sns.clone());
        assert!(matches!(dest_type, DestinationType::Sns(_)));
    }

    #[test]
    fn test_module_alert() {
        let module = Module::Alert {
            template: Some("alert_template".to_string()),
            destination_type: DestinationType::Http(Endpoint::default()),
        };

        match module {
            Module::Alert {
                template,
                destination_type,
            } => {
                assert_eq!(template, Some("alert_template".to_string()));
                assert!(matches!(destination_type, DestinationType::Http(_)));
            }
            _ => panic!("Should be Alert module"),
        }
    }

    #[test]
    fn test_module_pipeline() {
        let endpoint = Endpoint {
            url: "https://pipeline.example.com".to_string(),
            method: HTTPType::PUT,
            skip_tls_verify: false,
            headers: None,
            action_id: None,
            output_format: None,
            destination_type: Some("splunk".to_string()),
            metadata: HashMap::new(),
        };

        let module = Module::Pipeline {
            endpoint: endpoint.clone(),
        };

        match module {
            Module::Pipeline {
                endpoint: pipeline_endpoint,
            } => {
                assert_eq!(pipeline_endpoint.url, "https://pipeline.example.com");
                assert_eq!(pipeline_endpoint.method, HTTPType::PUT);
                assert_eq!(
                    pipeline_endpoint.destination_type,
                    Some("splunk".to_string())
                );
            }
            _ => panic!("Should be Pipeline module"),
        }
    }

    #[test]
    fn test_template_type_email_with_title() {
        let template_type = TemplateType::Email {
            title: "Welcome Email".to_string(),
        };

        match template_type {
            TemplateType::Email { title } => {
                assert_eq!(title, "Welcome Email");
            }
            _ => panic!("Should be Email template type"),
        }
    }

    #[test]
    fn test_prebuilt_destinations() {
        let prebuilt = Destination::prebuilt_destinations();

        // Should have 6 prebuilt destinations: Slack, Teams, PagerDuty, Discord, Generic Webhook,
        // Email
        assert_eq!(prebuilt.len(), 6);

        // Check that each destination has expected properties
        let slack = prebuilt.iter().find(|d| d.name == "Slack Webhook").unwrap();
        assert_eq!(slack.org_id, "");
        match &slack.module {
            Module::Alert {
                template,
                destination_type,
            } => {
                assert!(template.is_none()); // Template should be optional
                match destination_type {
                    DestinationType::Http(endpoint) => {
                        assert!(endpoint.url.contains("slack.com"));
                        assert_eq!(endpoint.method, HTTPType::POST);
                        assert_eq!(endpoint.destination_type.as_ref().unwrap(), "slack");
                    }
                    _ => panic!("Slack destination should be HTTP type"),
                }
            }
            _ => panic!("Should be Alert module"),
        }

        // Check Teams destination
        let teams = prebuilt
            .iter()
            .find(|d| d.name == "Microsoft Teams Webhook")
            .unwrap();
        match &teams.module {
            Module::Alert {
                destination_type, ..
            } => match destination_type {
                DestinationType::Http(endpoint) => {
                    assert!(endpoint.url.contains("webhook.office.com"));
                    assert_eq!(endpoint.destination_type.as_ref().unwrap(), "teams");
                }
                _ => panic!("Teams destination should be HTTP type"),
            },
            _ => panic!("Should be Alert module"),
        }

        // Check Email destination
        let email = prebuilt
            .iter()
            .find(|d| d.name == "Email Notification")
            .unwrap();
        match &email.module {
            Module::Alert {
                destination_type, ..
            } => match destination_type {
                DestinationType::Email(email_config) => {
                    assert!(!email_config.recipients.is_empty());
                    assert!(email_config.recipients[0].contains("@"));
                }
                _ => panic!("Email destination should be Email type"),
            },
            _ => panic!("Should be Alert module"),
        }
    }
}
