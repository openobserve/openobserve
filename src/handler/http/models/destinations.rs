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
