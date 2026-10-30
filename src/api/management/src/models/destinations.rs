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
use db::alerts::destinations::DestinationError;
use hashbrown::HashMap;
use openobserve_core::alerts::destination_usage;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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
                    destination_type: DestinationType::Http,
                    template,
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
                meta_dest::DestinationType::SlackApp(target) => Self {
                    name: value.name,
                    template,
                    destination_type: DestinationType::SlackApp,
                    ..Default::default()
                }
                .with_slack_app(target),
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
                    output_format: self.output_format,
                    destination_type: self.destination_type_name,
                    metadata: self.metadata,
                }),
                DestinationType::Sns => meta_dest::DestinationType::Sns(meta_dest::AwsSns {
                    sns_topic_arn: self.sns_topic_arn.ok_or(DestinationError::InvalidSns)?,
                    aws_region: self.aws_region.ok_or(DestinationError::InvalidSns)?,
                }),
                DestinationType::SlackApp => {
                    meta_dest::DestinationType::SlackApp(self.slack_app.into_target())
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

        // Shared rule lives in `config::prebuilt_loader` so the HTTP DTO and
        // the service-layer guards can't drift apart.
        let is_prebuilt = config::prebuilt_loader::is_prebuilt_template_name(&value.name)
            || openobserve_core::alerts::templates::is_downtime_template_name(&value.name);

        Self {
            name: value.name,
            body: value.body,
            is_default: value.is_default.then_some(true),
            is_prebuilt,
            template_type,
            title,
            kind: Some(value.kind.to_string()),
        }
    }
}

impl Template {
    pub fn into(self, org_id: &str) -> meta_dest::Template {
        let template_type = match self.template_type {
            DestinationType::Email => meta_dest::TemplateType::Email { title: self.title },
            DestinationType::Sns => meta_dest::TemplateType::Sns,
            DestinationType::Http | DestinationType::SlackApp => meta_dest::TemplateType::Http,
        };
        meta_dest::Template {
            id: None,
            org_id: org_id.to_string(),
            name: self.name,
            is_default: self.is_default.unwrap_or_default(),
            template_type,
            body: self.body,
            kind: meta_dest::TemplateKind::default(),
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
    /// Output format for HTTP destinations (json or text). Default is json.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<meta_dest::HTTPOutputFormat>,
    /// Specific destination type identifier (e.g., "openobserve", "splunk", "elasticsearch").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_type_name: Option<String>,
    /// Optional key-value metadata for the destination.
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    /// The `slack_app` fields, flat on the body; absent for every other type.
    #[serde(flatten)]
    pub slack_app: SlackAppFields,
    /// Every consumer referencing this destination; present only when `include_usage=true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<Vec<DestinationUseResponse>>,
}

impl Destination {
    fn with_slack_app(mut self, target: meta_dest::SlackAppTarget) -> Self {
        self.slack_app = SlackAppFields::from_target(target);
        self
    }
}

/// `SlackAppTarget` with every field optional, so an omitted one takes the type's default.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct SlackAppFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(example = "C0FAKE00001")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    /// Acknowledge, Mute and Investigate on each message; default true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buttons: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mention: Option<meta_dest::MentionRule>,
    /// 0 to 240; default 30.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refire_reuse_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_investigate: Option<meta_dest::AutoInvestigate>,
    /// Required true when the channel is shared with another company.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_channel_confirmed: Option<bool>,
    /// Required true when an on-call team pages into this channel through a Slack webhook.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oncall_room_confirmed: Option<bool>,
    /// The webhook a switch replaced, kept so it can be switched back; never sent to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub previous_webhook: Option<meta_dest::Endpoint>,
}

impl SlackAppFields {
    fn from_target(t: meta_dest::SlackAppTarget) -> Self {
        Self {
            installation_id: Some(t.installation_id),
            channel_id: Some(t.channel_id),
            channel_name: Some(t.channel_name),
            buttons: Some(t.buttons),
            mention: Some(t.mention),
            refire_reuse_minutes: Some(t.refire_reuse_minutes),
            auto_investigate: Some(t.auto_investigate),
            shared_channel_confirmed: Some(t.shared_channel_confirmed),
            oncall_room_confirmed: Some(t.oncall_room_confirmed),
            previous_webhook: t.previous_webhook,
        }
    }

    pub fn into_target(self) -> meta_dest::SlackAppTarget {
        let d = meta_dest::SlackAppTarget::default();
        meta_dest::SlackAppTarget {
            installation_id: self.installation_id.unwrap_or_default().trim().to_string(),
            channel_id: self.channel_id.unwrap_or_default().trim().to_string(),
            channel_name: self
                .channel_name
                .unwrap_or_default()
                .trim()
                .trim_start_matches('#')
                .to_string(),
            buttons: self.buttons.unwrap_or(d.buttons),
            mention: self.mention.unwrap_or(d.mention),
            refire_reuse_minutes: self.refire_reuse_minutes.unwrap_or(d.refire_reuse_minutes),
            auto_investigate: self.auto_investigate.unwrap_or(d.auto_investigate),
            shared_channel_confirmed: self.shared_channel_confirmed.unwrap_or_default(),
            oncall_room_confirmed: self.oncall_room_confirmed.unwrap_or_default(),
            previous_webhook: self.previous_webhook,
        }
    }
}

#[derive(Serialize, Debug, Default, PartialEq, Eq, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    #[default]
    Http,
    Email,
    Sns,
    SlackApp,
}

impl From<&str> for DestinationType {
    fn from(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "email" => DestinationType::Email,
            "sns" => DestinationType::Sns,
            "slack_app" => DestinationType::SlackApp,
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
            DestinationType::SlackApp => write!(f, "slack_app"),
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
    /// True for system-managed prebuilt templates (those whose name starts
    /// with `prebuilt_`). The public API refuses updates and deletes for
    /// these, so the UI should render them as read-only.
    #[serde(rename = "isPrebuilt")]
    #[serde(default)]
    pub is_prebuilt: bool,
    /// Indicates whether the body is
    /// http or email body
    #[serde(rename = "type")]
    #[serde(default)]
    pub template_type: DestinationType,
    #[serde(default)]
    pub title: String,
    /// Template kind: "custom" (default) or "content". Absent on write means
    /// "unspecified" — create defaults to custom, update preserves the
    /// stored kind (sticky-kind rule, design §6.2).
    #[serde(default)]
    pub kind: Option<String>,
}

/// Wire form of `DestinationConsumer`; no wildcard arm, so a new consumer must compile here too.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DestinationConsumerKind {
    Alert,
    CompositeAlert,
    Pipeline,
    SyntheticCheck,
    OncallPolicy,
    OncallTeamChannel,
    #[cfg(feature = "enterprise")]
    Workflow,
    #[cfg(feature = "enterprise")]
    AnomalyDetection,
    #[cfg(feature = "enterprise")]
    IncidentIntegration,
    #[cfg(feature = "enterprise")]
    Downtime,
}

impl From<destination_usage::DestinationConsumer> for DestinationConsumerKind {
    fn from(value: destination_usage::DestinationConsumer) -> Self {
        match value {
            destination_usage::DestinationConsumer::Alert => Self::Alert,
            destination_usage::DestinationConsumer::CompositeAlert => Self::CompositeAlert,
            destination_usage::DestinationConsumer::Pipeline => Self::Pipeline,
            destination_usage::DestinationConsumer::SyntheticCheck => Self::SyntheticCheck,
            destination_usage::DestinationConsumer::OncallPolicy => Self::OncallPolicy,
            destination_usage::DestinationConsumer::OncallTeamChannel => Self::OncallTeamChannel,
            #[cfg(feature = "enterprise")]
            destination_usage::DestinationConsumer::Workflow => Self::Workflow,
            #[cfg(feature = "enterprise")]
            destination_usage::DestinationConsumer::AnomalyDetection => Self::AnomalyDetection,
            #[cfg(feature = "enterprise")]
            destination_usage::DestinationConsumer::IncidentIntegration => {
                Self::IncidentIntegration
            }
            #[cfg(feature = "enterprise")]
            destination_usage::DestinationConsumer::Downtime => Self::Downtime,
        }
    }
}

/// One consumer's reference to a destination — `Destination.uses`, when `include_usage=true`.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct DestinationUseResponse {
    pub consumer: DestinationConsumerKind,
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
}

impl From<destination_usage::DestinationUse> for DestinationUseResponse {
    fn from(value: destination_usage::DestinationUse) -> Self {
        Self {
            consumer: value.consumer.into(),
            id: value.id,
            name: value.name,
            folder_id: value.folder_id,
        }
    }
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
            kind: meta_dest::TemplateKind::default(),
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
            kind: meta_dest::TemplateKind::default(),
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
            kind: meta_dest::TemplateKind::default(),
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
            is_prebuilt: false,
            template_type: DestinationType::Http,
            title: String::new(),
            kind: None,
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
            is_prebuilt: false,
            template_type: DestinationType::Email,
            title: "My Alert".to_string(),
            kind: None,
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
            is_prebuilt: false,
            template_type: DestinationType::Sns,
            title: String::new(),
            kind: None,
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

    /// The body `buildSlackAppDestination` and `switchToSlackApp` (web) send.
    fn web_slack_app_body() -> serde_json::Value {
        serde_json::json!({
            "name": "sre-prod-slack",
            "type": "slack_app",
            "installation_id": "I0FAKE00001",
            "channel_id": "C0FAKE00001",
            "channel_name": "#sre-prod",
            "mention": {"subteam_id": "S0FAKE00001", "handle": "sre"},
            "refire_reuse_minutes": 15,
            "auto_investigate": "critical",
            "shared_channel_confirmed": false,
            "oncall_room_confirmed": true,
            "template": "prebuilt_slack",
            "previous_webhook": {
                "url": "https://hooks.slack.com/services/T0FAKE/B0FAKE/x",
                "method": "post",
                "metadata": {"prebuilt_type": "slack", "slack_channel_id": "C0FAKE00001"}
            }
        })
    }

    #[test]
    fn the_web_slack_app_body_saves_as_a_slack_app_target_with_defaults_for_omitted_fields() {
        let d: Destination = serde_json::from_value(web_slack_app_body()).unwrap();
        assert_eq!(d.destination_type, DestinationType::SlackApp);
        let meta = d.into("prod".to_string(), true).unwrap();
        let meta_dest::Module::Alert {
            template,
            destination_type: meta_dest::DestinationType::SlackApp(t),
        } = meta.module
        else {
            panic!("expected an alert SlackApp module");
        };
        assert_eq!(template.as_deref(), Some("prebuilt_slack"));
        assert_eq!(t.installation_id, "I0FAKE00001");
        assert_eq!(t.channel_name, "sre-prod", "the leading # is the UI's");
        assert!(t.buttons, "an omitted buttons field is on");
        assert_eq!(t.refire_reuse_minutes, 15);
        assert_eq!(t.auto_investigate, meta_dest::AutoInvestigate::Critical);
        assert!(t.oncall_room_confirmed && !t.shared_channel_confirmed);
        assert_eq!(
            t.mention,
            meta_dest::MentionRule::Subteam {
                subteam_id: "S0FAKE00001".into(),
                handle: "sre".into()
            }
        );
        let previous = t.previous_webhook.as_ref().expect("kept for Switch back");
        assert_eq!(
            previous
                .metadata
                .get("slack_channel_id")
                .map(String::as_str),
            Some("C0FAKE00001")
        );
    }

    #[test]
    fn a_slack_app_destination_reads_back_flat_and_an_http_one_carries_no_slack_fields() {
        let d: Destination = serde_json::from_value(web_slack_app_body()).unwrap();
        let meta = d.into("prod".to_string(), true).unwrap();
        let json = serde_json::to_value(Destination::from(meta)).unwrap();
        assert_eq!(json["type"], "slack_app");
        assert_eq!(json["channel_id"], "C0FAKE00001");
        assert_eq!(json["buttons"], true);
        assert_eq!(json["mention"]["handle"], "sre");
        assert_eq!(
            json["previous_webhook"]["url"],
            "https://hooks.slack.com/services/T0FAKE/B0FAKE/x"
        );
        let http = meta_dest::Destination {
            name: "hook".into(),
            module: meta_dest::Module::Alert {
                template: None,
                destination_type: meta_dest::DestinationType::Http(meta_dest::Endpoint {
                    url: "https://example.com/hook".into(),
                    ..Default::default()
                }),
            },
            ..Default::default()
        };
        let json = serde_json::to_value(Destination::from(http)).unwrap();
        let obj = json.as_object().unwrap();
        assert_eq!(json["type"], "http");
        for field in [
            "installation_id",
            "channel_id",
            "buttons",
            "previous_webhook",
        ] {
            assert!(!obj.contains_key(field), "{field} leaked onto an http row");
        }
    }

    #[test]
    fn slack_app_type_names_round_trip() {
        assert_eq!(
            DestinationType::from("slack_app"),
            DestinationType::SlackApp
        );
        assert_eq!(
            DestinationType::from("SLACK_APP"),
            DestinationType::SlackApp
        );
        assert_eq!(DestinationType::SlackApp.to_string(), "slack_app");
    }
}
