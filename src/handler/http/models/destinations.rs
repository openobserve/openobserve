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

//! These models define the schemas of HTTP request and response JSON bodies in
//! destinations and templates API endpoints.

use std::fmt;

use config::meta::destinations as meta_dest;
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::actions::action_manager::ActionEndpoint;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::service::db::alerts::destinations::DestinationError;

impl From<meta_dest::Destination> for Destination {
    fn from(value: meta_dest::Destination) -> Self {
        match value.module {
            meta_dest::Module::Alert {
                template,
                destination_type,
            } => match destination_type {
                meta_dest::DestinationType::Email(email) => Self {
                    name: value.name,
                    emails: email.recipients,
                    template,
                    destination_type: DestinationType::Email,
                    ..Default::default()
                },
                meta_dest::DestinationType::Http(endpoint) => Self {
                    name: value.name,
                    url: endpoint.url,
                    method: endpoint.method,
                    skip_tls_verify: endpoint.skip_tls_verify,
                    headers: endpoint.headers,
                    #[cfg(feature = "enterprise")]
                    destination_type: if endpoint.action_id.is_some() {
                        DestinationType::Action
                    } else {
                        DestinationType::Http
                    },
                    #[cfg(not(feature = "enterprise"))]
                    destination_type: DestinationType::Http,
                    template,
                    #[cfg(feature = "enterprise")]
                    action_id: endpoint.action_id,
                    output_format: endpoint.output_format,
                    destination_type_name: endpoint.destination_type,
                    metadata: endpoint.metadata,
                    ..Default::default()
                },
                meta_dest::DestinationType::Sns(aws_sns) => Self {
                    name: value.name,
                    template,
                    sns_topic_arn: Some(aws_sns.sns_topic_arn),
                    aws_region: Some(aws_sns.aws_region),
                    destination_type: DestinationType::Sns,
                    ..Default::default()
                },
            },
            meta_dest::Module::Pipeline { endpoint } => Self {
                name: value.name,
                url: endpoint.url,
                method: endpoint.method,
                skip_tls_verify: endpoint.skip_tls_verify,
                headers: endpoint.headers,
                destination_type: DestinationType::Http,
                output_format: endpoint.output_format,
                destination_type_name: endpoint.destination_type,
                metadata: endpoint.metadata,
                ..Default::default()
            },
        }
    }
}

impl Destination {
    /// Convert HTTP Destination model to meta Destination.
    /// For alert destinations, template is now optional - can be set at alert level instead.
    pub fn into(
        self,
        org_id: String,
        is_alert: bool,
    ) -> Result<meta_dest::Destination, DestinationError> {
        // Template is optional - filter out empty strings
        let template = self.template.filter(|t| !t.is_empty());

        if is_alert {
            // Alert destination - template is optional (can be set at alert level)
            let destination_type = match self.destination_type {
                DestinationType::Email => meta_dest::DestinationType::Email(meta_dest::Email {
                    recipients: self.emails,
                }),
                DestinationType::Http => meta_dest::DestinationType::Http(meta_dest::Endpoint {
                    url: self.url,
                    method: self.method,
                    skip_tls_verify: self.skip_tls_verify,
                    headers: self.headers,
                    action_id: None,
                    output_format: self.output_format,
                    destination_type: self.destination_type_name,
                    metadata: self.metadata,
                }),
                DestinationType::Sns => meta_dest::DestinationType::Sns(meta_dest::AwsSns {
                    sns_topic_arn: self.sns_topic_arn.ok_or(DestinationError::InvalidSns)?,
                    aws_region: self.aws_region.ok_or(DestinationError::InvalidSns)?,
                }),
                #[cfg(feature = "enterprise")]
                DestinationType::Action => {
                    if let Some(action_id) = self.action_id {
                        let action_endpoint = ActionEndpoint::new(&org_id, &action_id)
                            .map_err(DestinationError::InvalidActionId)?;
                        meta_dest::DestinationType::Http(meta_dest::Endpoint {
                            url: action_endpoint.url,
                            method: if action_endpoint.method == reqwest::Method::POST {
                                meta_dest::HTTPType::POST
                            } else {
                                meta_dest::HTTPType::GET
                            },
                            skip_tls_verify: action_endpoint.skip_tls,
                            headers: None,
                            action_id: Some(action_id),
                            output_format: self.output_format,
                            destination_type: self.destination_type_name,
                            metadata: self.metadata,
                        })
                    } else {
                        return Err(DestinationError::InvalidActionId(anyhow::anyhow!(
                            "Action id is required for action destination"
                        )));
                    }
                }
            };
            Ok(meta_dest::Destination {
                id: None,
                org_id,
                name: self.name,
                module: meta_dest::Module::Alert {
                    template,
                    destination_type,
                },
            })
        } else {
            // Pipeline destination
            let endpoint = meta_dest::Endpoint {
                url: self.url,
                method: self.method,
                skip_tls_verify: self.skip_tls_verify,
                headers: self.headers,
                action_id: None,
                output_format: self.output_format,
                destination_type: self.destination_type_name,
                metadata: self.metadata,
            };
            Ok(meta_dest::Destination {
                id: None,
                org_id,
                name: self.name,
                module: meta_dest::Module::Pipeline { endpoint },
            })
        }
    }
}

impl From<meta_dest::Template> for Template {
    fn from(value: meta_dest::Template) -> Self {
        let (title, template_type) = match value.template_type {
            meta_dest::TemplateType::Email { title } => (title, DestinationType::Email),
            meta_dest::TemplateType::Http => (String::new(), DestinationType::Http),
            meta_dest::TemplateType::Sns => (String::new(), DestinationType::Sns),
        };

        Self {
            name: value.name,
            body: value.body,
            is_default: value.is_default.then_some(true),
            template_type,
            title,
        }
    }
}

impl Template {
    pub fn into(self, org_id: &str) -> meta_dest::Template {
        let template_type = match self.template_type {
            DestinationType::Email => meta_dest::TemplateType::Email { title: self.title },
            DestinationType::Sns => meta_dest::TemplateType::Sns,
            DestinationType::Http => meta_dest::TemplateType::Http,
            #[cfg(feature = "enterprise")]
            DestinationType::Action => meta_dest::TemplateType::Http,
        };
        meta_dest::Template {
            id: None,
            org_id: org_id.to_string(),
            name: self.name,
            is_default: self.is_default.unwrap_or_default(),
            template_type,
            body: self.body,
        }
    }
}

/// Alert destination configuration for sending notifications when alerts trigger.
///
/// IMPORTANT: The `template` field is REQUIRED to create an alert destination.
/// Without a template, the destination becomes a pipeline destination and cannot be used with
/// alerts.
///
/// # Example - Creating an HTTP alert destination
/// ```json
/// {
///   "name": "my_alert_webhook",
///   "url": "https://example.com/webhook",
///   "method": "post",
///   "type": "http",
///   "template": "Default",
///   "skip_tls_verify": false
/// }
/// ```
///
/// # Example - Creating an Email alert destination
/// ```json
/// {
///   "name": "my_email_dest",
///   "type": "email",
///   "emails": ["alerts@example.com", "team@example.com"],
///   "template": "Default"
/// }
/// ```
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct Destination {
    /// Unique name for this destination. Must be unique within the organization.
    #[serde(default)]
    #[schema(example = "my_alert_webhook")]
    pub name: String,
    /// Webhook URL for HTTP destinations. Required when `type` is `http`.
    #[serde(default)]
    #[schema(example = "https://example.com/webhook")]
    pub url: String,
    /// HTTP method for HTTP destinations. Typically "post" for webhooks.
    #[serde(default)]
    #[schema(example = "post")]
    pub method: meta_dest::HTTPType,
    /// Whether to skip TLS certificate verification for HTTP destinations.
    #[serde(default)]
    pub skip_tls_verify: bool,
    /// Optional HTTP headers to include with webhook requests.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /// REQUIRED for alert destinations. Name of the template to use for formatting alert messages.
    /// Use "Default" for the built-in default template. Without a template, the destination
    /// becomes a pipeline destination and cannot be used with alerts.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(example = "Default")]
    pub template: Option<String>,
    /// Email recipients for Email destinations. Required when `type` is `email`.
    #[serde(default)]
    pub emails: Vec<String>,
    /// SNS topic ARN for SNS destinations. Required when `type` is `sns`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sns_topic_arn: Option<String>,
    /// AWS region for SNS destinations. Required when `type` is `sns`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aws_region: Option<String>,
    /// Destination type: `http` (webhook), `email`, or `sns`. Default is `http`.
    #[serde(rename = "type")]
    #[serde(default)]
    #[schema(example = "http")]
    pub destination_type: DestinationType,
    /// Action ID for enterprise Action destinations. Required when `type` is `action`.
    #[cfg(feature = "enterprise")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    /// Output format for HTTP destinations (json or text). Default is json.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<meta_dest::HTTPOutputFormat>,
    /// Specific destination type identifier (e.g., "openobserve", "splunk", "elasticsearch").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_type_name: Option<String>,
    /// Optional key-value metadata for the destination.
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Serialize, Debug, Default, PartialEq, Eq, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    #[default]
    Http,
    Email,
    Sns,
    #[cfg(feature = "enterprise")]
    Action,
}

impl From<&str> for DestinationType {
    fn from(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "email" => DestinationType::Email,
            "sns" => DestinationType::Sns,
            #[cfg(feature = "enterprise")]
            "action" => DestinationType::Action,
            _ => DestinationType::Http,
        }
    }
}

impl fmt::Display for DestinationType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            DestinationType::Email => write!(f, "email"),
            DestinationType::Http => write!(f, "http"),
            DestinationType::Sns => write!(f, "sns"),
            #[cfg(feature = "enterprise")]
            DestinationType::Action => write!(f, "action"),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct Template {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub body: String,
    #[serde(rename = "isDefault")]
    #[serde(default)]
    pub is_default: Option<bool>,
    /// Indicates whether the body is
    /// http or email body
    #[serde(rename = "type")]
    #[serde(default)]
    pub template_type: DestinationType,
    #[serde(default)]
    pub title: String,
}

#[cfg(test)]
mod tests {
    use config::meta::destinations as meta_dest;

    use super::*;

    #[test]
    fn test_destination_type_from_str_email() {
        assert_eq!(DestinationType::from("email"), DestinationType::Email);
    }

    #[test]
    fn test_destination_type_from_str_sns() {
        assert_eq!(DestinationType::from("sns"), DestinationType::Sns);
    }

    #[test]
    fn test_destination_type_from_str_http() {
        assert_eq!(DestinationType::from("http"), DestinationType::Http);
    }

    #[test]
    fn test_destination_type_from_str_unknown_defaults_to_http() {
        assert_eq!(DestinationType::from("webhook"), DestinationType::Http);
        assert_eq!(DestinationType::from(""), DestinationType::Http);
    }

    #[test]
    fn test_destination_type_from_str_case_insensitive() {
        assert_eq!(DestinationType::from("EMAIL"), DestinationType::Email);
        assert_eq!(DestinationType::from("SNS"), DestinationType::Sns);
        assert_eq!(DestinationType::from("HTTP"), DestinationType::Http);
    }

    #[test]
    fn test_destination_type_display_email() {
        assert_eq!(DestinationType::Email.to_string(), "email");
    }

    #[test]
    fn test_destination_type_display_http() {
        assert_eq!(DestinationType::Http.to_string(), "http");
    }

    #[test]
    fn test_destination_type_display_sns() {
        assert_eq!(DestinationType::Sns.to_string(), "sns");
    }

    #[test]
    fn test_template_from_meta_email_preserves_title() {
        let meta = meta_dest::Template {
            id: None,
            org_id: "org1".to_string(),
            name: "my_template".to_string(),
            is_default: false,
            template_type: meta_dest::TemplateType::Email {
                title: "Alert Title".to_string(),
            },
            body: "body content".to_string(),
        };
        let t = Template::from(meta);
        assert_eq!(t.name, "my_template");
        assert_eq!(t.body, "body content");
        assert_eq!(t.title, "Alert Title");
        assert_eq!(t.template_type, DestinationType::Email);
    }

    #[test]
    fn test_template_from_meta_http_has_empty_title() {
        let meta = meta_dest::Template {
            id: None,
            org_id: "org1".to_string(),
            name: "http_tmpl".to_string(),
            is_default: true,
            template_type: meta_dest::TemplateType::Http,
            body: "{}".to_string(),
        };
        let t = Template::from(meta);
        assert_eq!(t.template_type, DestinationType::Http);
        assert_eq!(t.title, "");
        assert_eq!(t.is_default, Some(true));
    }

    #[test]
    fn test_template_from_meta_sns_has_empty_title() {
        let meta = meta_dest::Template {
            id: None,
            org_id: "org1".to_string(),
            name: "sns_tmpl".to_string(),
            is_default: false,
            template_type: meta_dest::TemplateType::Sns,
            body: "sns body".to_string(),
        };
        let t = Template::from(meta);
        assert_eq!(t.template_type, DestinationType::Sns);
        assert_eq!(t.title, "");
        assert!(t.is_default.is_none());
    }

    #[test]
    fn test_template_into_http_produces_correct_meta() {
        let t = Template {
            name: "tmpl".to_string(),
            body: "body".to_string(),
            is_default: None,
            template_type: DestinationType::Http,
            title: String::new(),
        };
        let meta = t.into("myorg");
        assert_eq!(meta.org_id, "myorg");
        assert_eq!(meta.name, "tmpl");
        assert!(!meta.is_default);
        assert!(matches!(meta.template_type, meta_dest::TemplateType::Http));
    }

    #[test]
    fn test_template_into_email_preserves_title() {
        let t = Template {
            name: "email_tmpl".to_string(),
            body: "hi".to_string(),
            is_default: Some(true),
            template_type: DestinationType::Email,
            title: "My Alert".to_string(),
        };
        let meta = t.into("org");
        assert!(meta.is_default);
        match meta.template_type {
            meta_dest::TemplateType::Email { title } => assert_eq!(title, "My Alert"),
            _ => panic!("expected Email template type"),
        }
    }

    #[test]
    fn test_template_into_sns_produces_sns_type() {
        let t = Template {
            name: "s".to_string(),
            body: "b".to_string(),
            is_default: None,
            template_type: DestinationType::Sns,
            title: String::new(),
        };
        let meta = t.into("org");
        assert!(matches!(meta.template_type, meta_dest::TemplateType::Sns));
    }

    #[test]
    fn test_destination_optional_fields_absent_when_none() {
        let d = Destination::default();
        let json = serde_json::to_value(&d).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("headers"));
        assert!(!obj.contains_key("template"));
        assert!(!obj.contains_key("sns_topic_arn"));
        assert!(!obj.contains_key("aws_region"));
        assert!(!obj.contains_key("output_format"));
        assert!(!obj.contains_key("destination_type_name"));
    }

    #[test]
    fn test_destination_optional_fields_present_when_some() {
        let mut hdrs = HashMap::new();
        hdrs.insert("X-Token".to_string(), "abc".to_string());
        let d = Destination {
            headers: Some(hdrs),
            template: Some("Default".to_string()),
            sns_topic_arn: Some("arn:aws:sns:us-east-1:123:topic".to_string()),
            aws_region: Some("us-east-1".to_string()),
            output_format: Some(meta_dest::HTTPOutputFormat::JSON),
            destination_type_name: Some("openobserve".to_string()),
            ..Destination::default()
        };
        let json = serde_json::to_value(&d).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("headers"));
        assert!(obj.contains_key("template"));
        assert!(obj.contains_key("sns_topic_arn"));
        assert!(obj.contains_key("aws_region"));
        assert!(obj.contains_key("output_format"));
        assert!(obj.contains_key("destination_type_name"));
    }

    #[test]
    fn test_destination_into_alert_email() {
        let d = Destination {
            name: "email_dest".to_string(),
            destination_type: DestinationType::Email,
            emails: vec!["a@b.com".to_string()],
            template: Some("Default".to_string()),
            ..Destination::default()
        };
        let result = d.into("myorg".to_string(), true);
        assert!(result.is_ok());
        let meta = result.unwrap();
        assert_eq!(meta.name, "email_dest");
        assert_eq!(meta.org_id, "myorg");
        match meta.module {
            meta_dest::Module::Alert {
                template,
                destination_type: meta_dest::DestinationType::Email(email),
            } => {
                assert_eq!(email.recipients, vec!["a@b.com"]);
                assert_eq!(template, Some("Default".to_string()));
            }
            _ => panic!("expected Alert Email module"),
        }
    }

    #[test]
    fn test_destination_into_alert_http() {
        let d = Destination {
            name: "http_dest".to_string(),
            destination_type: DestinationType::Http,
            url: "https://example.com/hook".to_string(),
            method: meta_dest::HTTPType::POST,
            ..Destination::default()
        };
        let result = d.into("org1".to_string(), true);
        assert!(result.is_ok());
        let meta = result.unwrap();
        match meta.module {
            meta_dest::Module::Alert {
                destination_type: meta_dest::DestinationType::Http(ep),
                ..
            } => {
                assert_eq!(ep.url, "https://example.com/hook");
            }
            _ => panic!("expected Alert Http module"),
        }
    }

    #[test]
    fn test_destination_into_alert_sns_missing_arn_returns_error() {
        let d = Destination {
            name: "sns_dest".to_string(),
            destination_type: DestinationType::Sns,
            sns_topic_arn: None, // missing → error
            aws_region: Some("us-east-1".to_string()),
            ..Destination::default()
        };
        let result = d.into("org1".to_string(), true);
        assert!(result.is_err());
    }

    #[test]
    fn test_destination_into_pipeline() {
        let d = Destination {
            name: "pipeline_dest".to_string(),
            url: "https://pipeline.example.com".to_string(),
            method: meta_dest::HTTPType::POST,
            ..Destination::default()
        };
        let result = d.into("orgx".to_string(), false);
        assert!(result.is_ok());
        let meta = result.unwrap();
        match meta.module {
            meta_dest::Module::Pipeline { endpoint } => {
                assert_eq!(endpoint.url, "https://pipeline.example.com");
            }
            _ => panic!("expected Pipeline module"),
        }
    }
}
