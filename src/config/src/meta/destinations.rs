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
        template: String,
        destination_type: DestinationType,
    },
    Pipeline {
        endpoint: Endpoint,
    },
}

impl Default for Module {
    fn default() -> Self {
        Module::Alert {
            template: "".to_string(),
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

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
#[serde(rename_all = "snake_case")]
pub struct Template {
    pub id: Option<svix_ksuid::Ksuid>,
    pub org_id: String,
    pub name: String,
    pub is_default: bool,
    #[serde(rename = "type")]
    pub template_type: TemplateType,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
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

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike;

    use super::*;

    #[test]
    fn test_destination_default() {
        let dest = Destination::default();
        assert!(dest.id.is_none());
        assert!(dest.org_id.is_empty());
        assert!(dest.name.is_empty());
        assert!(matches!(dest.module, Module::Alert { .. }));
    }

    #[test]
    fn test_destination_is_alert_destinations() {
        let alert_dest = Destination {
            id: None,
            org_id: "test_org".to_string(),
            name: "alert_dest".to_string(),
            module: Module::Alert {
                template: "template".to_string(),
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
                assert_eq!(template, "");
                assert!(matches!(destination_type, DestinationType::Http(_)));
            }
            _ => panic!("Default should be Alert"),
        }
    }

    #[test]
    fn test_module_display() {
        let alert_module = Module::Alert {
            template: "test".to_string(),
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
    fn test_email_default() {
        let email = Email::default();
        assert!(email.recipients.is_empty());
    }

    #[test]
    fn test_endpoint_default() {
        let endpoint = Endpoint::default();
        assert!(endpoint.url.is_empty());
        assert_eq!(endpoint.method, HTTPType::POST);
        assert!(!endpoint.skip_tls_verify);
        assert!(endpoint.headers.is_none());
        assert!(endpoint.action_id.is_none());
        assert!(endpoint.output_format.is_none());
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
        };

        assert_eq!(endpoint.url, "https://api.example.com");
        assert_eq!(endpoint.method, HTTPType::POST);
        assert!(!endpoint.skip_tls_verify);
        assert_eq!(endpoint.headers, Some(headers));
        assert_eq!(endpoint.action_id, Some("action_123".to_string()));
        assert_eq!(endpoint.output_format, Some(HTTPOutputFormat::JSON));
    }

    #[test]
    fn test_aws_sns_default() {
        let sns = AwsSns::default();
        assert!(sns.sns_topic_arn.is_empty());
        assert!(sns.aws_region.is_empty());
    }

    #[test]
    fn test_http_type_default() {
        assert_eq!(HTTPType::default(), HTTPType::POST);
    }

    #[test]
    fn test_http_type_display() {
        assert_eq!(HTTPType::POST.to_string(), "post");
        assert_eq!(HTTPType::PUT.to_string(), "put");
        assert_eq!(HTTPType::GET.to_string(), "get");
    }

    #[test]
    fn test_http_type_equality() {
        assert_eq!(HTTPType::POST, HTTPType::POST);
        assert_ne!(HTTPType::POST, HTTPType::PUT);
        assert_ne!(HTTPType::GET, HTTPType::POST);
    }

    #[test]
    fn test_http_output_format_default() {
        assert_eq!(HTTPOutputFormat::default(), HTTPOutputFormat::JSON);
    }

    #[test]
    fn test_http_output_format_equality() {
        assert_eq!(HTTPOutputFormat::JSON, HTTPOutputFormat::JSON);
        assert_ne!(HTTPOutputFormat::JSON, HTTPOutputFormat::NDJSON);
    }

    #[test]
    fn test_template_default() {
        let template = Template::default();
        assert!(template.id.is_none());
        assert!(template.org_id.is_empty());
        assert!(template.name.is_empty());
        assert!(!template.is_default);
        assert!(matches!(template.template_type, TemplateType::Http));
        assert!(template.body.is_empty());
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
    fn test_template_type_default() {
        assert!(matches!(TemplateType::default(), TemplateType::Http));
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
                template: "alert_template".to_string(),
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
            template: "alert_template".to_string(),
            destination_type: DestinationType::Http(Endpoint::default()),
        };

        match module {
            Module::Alert {
                template,
                destination_type,
            } => {
                assert_eq!(template, "alert_template");
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
    fn test_clone_implementations() {
        let destination = Destination {
            id: Some(svix_ksuid::Ksuid::new(None, None)),
            org_id: "test_org".to_string(),
            name: "test_dest".to_string(),
            module: Module::Alert {
                template: "template".to_string(),
                destination_type: DestinationType::Http(Endpoint::default()),
            },
        };

        let cloned = destination.clone();
        assert_eq!(destination.org_id, cloned.org_id);
        assert_eq!(destination.name, cloned.name);
    }

    #[test]
    fn test_debug_implementations() {
        let endpoint = Endpoint::default();
        let debug_output = format!("{:?}", endpoint);
        assert!(debug_output.contains("Endpoint"));
    }
}
