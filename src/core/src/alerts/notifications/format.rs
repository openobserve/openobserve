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

//! ChannelFormat derivation from a destination type.
//!
//! This module applies the priority rules from §4.3 to derive the wire format
//! for rendering notifications. It is a pure function with no I/O.

use config::meta::destinations::DestinationType;

/// Wire format for rendering notifications.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelFormat {
    Slack,
    TeamsAdaptiveCard,
    TeamsMessageCard,
    Discord,
    PagerDuty,
    Opsgenie,
    ServiceNow,
    Email,
    Sns,
    Webhook,
}

impl ChannelFormat {
    /// The `*_overrides` key this format resolves against
    /// ([`resolve_content`](super::resolve::resolve_content)).
    ///
    /// Both Teams formats share the family `"teams"` — an author overriding
    /// the Teams title should not have to know whether the destination URL is
    /// an O365 connector or a Power Automate flow.
    pub fn channel_family(&self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::TeamsAdaptiveCard | Self::TeamsMessageCard => "teams",
            Self::Discord => "discord",
            Self::PagerDuty => "pagerduty",
            Self::Opsgenie => "opsgenie",
            Self::ServiceNow => "servicenow",
            Self::Email => "email",
            Self::Sns => "sns",
            Self::Webhook => "webhook",
        }
    }
}

/// Derive the channel format for a destination type.
///
/// Priority order (§4.3):
/// 1. `DestinationType::Email` → `Email`; `Sns` → `Sns`
/// 2. `Http` with `action_id` set → **always `Webhook`**, and `render_format` is IGNORED.
/// 3. `endpoint.metadata["render_format"]` when present and not `"auto"`.
/// 4. `endpoint.destination_type` match.
/// 5. Everything else → `Webhook`.
pub fn derive_channel_format(dest_type: &DestinationType) -> ChannelFormat {
    match dest_type {
        DestinationType::Email(_) => ChannelFormat::Email,
        DestinationType::Sns(_) => ChannelFormat::Sns,
        DestinationType::Http(endpoint) => {
            // Rule 2: action_id set always overrides to Webhook
            if endpoint.action_id.is_some() {
                return ChannelFormat::Webhook;
            }

            // Rule 3: render_format metadata override
            if let Some(render_format) = endpoint.metadata.get("render_format") {
                match render_format.as_str() {
                    "auto" => {
                        // Fall through to destination_type match
                    }
                    "slack" => return ChannelFormat::Slack,
                    "teams_adaptivecard" => return ChannelFormat::TeamsAdaptiveCard,
                    "teams_messagecard" => return ChannelFormat::TeamsMessageCard,
                    "discord" => return ChannelFormat::Discord,
                    "pagerduty" => return ChannelFormat::PagerDuty,
                    "opsgenie" => return ChannelFormat::Opsgenie,
                    "servicenow" => return ChannelFormat::ServiceNow,
                    "webhook" => return ChannelFormat::Webhook,
                    // Unknown value treated as "auto" (fall through to destination_type match)
                    _ => {}
                }
            }

            // Rule 4: destination_type match
            if let Some(dest_type_str) = &endpoint.destination_type {
                match dest_type_str.as_str() {
                    "slack" => return ChannelFormat::Slack,
                    "teams" => return teams_format_for_url(&endpoint.url),
                    "discord" => return ChannelFormat::Discord,
                    "pagerduty" => return ChannelFormat::PagerDuty,
                    "opsgenie" => return ChannelFormat::Opsgenie,
                    "servicenow" => return ChannelFormat::ServiceNow,
                    // "custom", "openobserve", "splunk", "elasticsearch", unknown → fall through
                    _ => {}
                }
            }

            // Rule 5: fallback
            ChannelFormat::Webhook
        }
    }
}

/// Determine Teams format from URL.
///
/// Returns `TeamsMessageCard` for deprecated O365 connectors, `TeamsAdaptiveCard`
/// for Power Automate / Workflows and any other URL (proxy, custom domain, gov cloud).
pub fn teams_format_for_url(url: &str) -> ChannelFormat {
    match url::Url::parse(url) {
        Ok(parsed_url) => {
            if let Some(host) = parsed_url.host_str() {
                // Check for deprecated O365 connectors
                if host == "outlook.office.com" || host == "webhook.office.com" {
                    return ChannelFormat::TeamsMessageCard;
                }

                // Check for Power Automate / Workflows (host suffix matches)
                if host.ends_with(".logic.azure.com") || host.ends_with(".api.powerplatform.com") {
                    return ChannelFormat::TeamsAdaptiveCard;
                }
            }

            // Default: AdaptiveCard for any other URL
            ChannelFormat::TeamsAdaptiveCard
        }
        Err(_) => {
            // If URL parsing fails, default to AdaptiveCard
            ChannelFormat::TeamsAdaptiveCard
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{AwsSns, Email, Endpoint};
    use hashbrown::HashMap;

    use super::*;

    fn http_dest(
        url: &str,
        dtype: Option<&str>,
        meta: &[(&str, &str)],
        action: bool,
    ) -> DestinationType {
        let mut metadata = HashMap::new();
        for (k, v) in meta {
            metadata.insert(k.to_string(), v.to_string());
        }

        let action_id = if action {
            Some("test_action".to_string())
        } else {
            None
        };

        DestinationType::Http(Endpoint {
            url: url.to_string(),
            action_id,
            destination_type: dtype.map(String::from),
            metadata,
            ..Default::default()
        })
    }

    #[test]
    fn test_email_direct() {
        let dest = DestinationType::Email(Email {
            recipients: vec!["test@example.com".to_string()],
        });
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Email);
    }

    #[test]
    fn test_sns_direct() {
        let dest = DestinationType::Sns(AwsSns {
            sns_topic_arn: "arn:aws:sns:us-east-1:123456789012:my-topic".to_string(),
            aws_region: "us-east-1".to_string(),
        });
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Sns);
    }

    #[test]
    fn test_action_id_overrides_render_format() {
        // action_id set → Webhook even with render_format=slack
        let dest = http_dest(
            "https://x",
            Some("slack"),
            &[("render_format", "slack")],
            true,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_slack_destination_type() {
        let dest = http_dest("https://hooks.slack.com/x", Some("slack"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Slack);
    }

    #[test]
    fn test_discord_destination_type() {
        let dest = http_dest("https://x", Some("discord"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Discord);
    }

    #[test]
    fn test_pagerduty_destination_type() {
        let dest = http_dest("https://x", Some("pagerduty"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::PagerDuty);
    }

    #[test]
    fn test_opsgenie_destination_type() {
        let dest = http_dest("https://x", Some("opsgenie"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Opsgenie);
    }

    #[test]
    fn test_servicenow_destination_type() {
        let dest = http_dest("https://x", Some("servicenow"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::ServiceNow);
    }

    #[test]
    fn test_custom_to_webhook() {
        let dest = http_dest("https://x", Some("custom"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_openobserve_to_webhook() {
        let dest = http_dest("https://x", Some("openobserve"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_splunk_to_webhook() {
        let dest = http_dest("https://x", Some("splunk"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_elasticsearch_to_webhook() {
        let dest = http_dest("https://x", Some("elasticsearch"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_unknown_type_to_webhook() {
        let dest = http_dest("https://x", Some("zzz"), &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_none_type_to_webhook() {
        let dest = http_dest("https://x", None, &[], false);
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_render_format_override_beats_derivation() {
        // Mattermost case: custom type with render_format=slack should output Slack
        let dest = http_dest(
            "https://mattermost.corp/hook",
            Some("custom"),
            &[("render_format", "slack")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Slack);
    }

    #[test]
    fn test_render_format_auto_falls_through() {
        // render_format=auto should fall through to destination_type
        let dest = http_dest(
            "https://x",
            Some("slack"),
            &[("render_format", "auto")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Slack);
    }

    #[test]
    fn test_render_format_unknown_falls_through() {
        // Unknown render_format value should fall through to destination_type
        let dest = http_dest(
            "https://x",
            Some("slack"),
            &[("render_format", "unknown")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Slack);
    }

    #[test]
    fn test_render_format_discord() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "discord")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Discord);
    }

    #[test]
    fn test_render_format_pagerduty() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "pagerduty")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::PagerDuty);
    }

    #[test]
    fn test_render_format_opsgenie() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "opsgenie")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Opsgenie);
    }

    #[test]
    fn test_render_format_servicenow() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "servicenow")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::ServiceNow);
    }

    #[test]
    fn test_render_format_teams_adaptivecard() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "teams_adaptivecard")],
            false,
        );
        assert_eq!(
            derive_channel_format(&dest),
            ChannelFormat::TeamsAdaptiveCard
        );
    }

    #[test]
    fn test_render_format_teams_messagecard() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "teams_messagecard")],
            false,
        );
        assert_eq!(
            derive_channel_format(&dest),
            ChannelFormat::TeamsMessageCard
        );
    }

    #[test]
    fn test_render_format_webhook() {
        let dest = http_dest(
            "https://x",
            Some("custom"),
            &[("render_format", "webhook")],
            false,
        );
        assert_eq!(derive_channel_format(&dest), ChannelFormat::Webhook);
    }

    #[test]
    fn test_teams_format_outlook_office() {
        assert_eq!(
            teams_format_for_url("https://outlook.office.com/webhook/x"),
            ChannelFormat::TeamsMessageCard
        );
    }

    #[test]
    fn test_teams_format_webhook_office() {
        assert_eq!(
            teams_format_for_url("https://webhook.office.com/x"),
            ChannelFormat::TeamsMessageCard
        );
    }

    #[test]
    fn test_teams_format_logic_azure() {
        assert_eq!(
            teams_format_for_url("https://prod-1.westus.logic.azure.com/workflows/x"),
            ChannelFormat::TeamsAdaptiveCard
        );
    }

    #[test]
    fn test_teams_format_powerplatform() {
        assert_eq!(
            teams_format_for_url("https://x.api.powerplatform.com/y"),
            ChannelFormat::TeamsAdaptiveCard
        );
    }

    #[test]
    fn test_teams_format_proxy_default() {
        assert_eq!(
            teams_format_for_url("https://teams-proxy.corp/x"),
            ChannelFormat::TeamsAdaptiveCard
        );
    }

    #[test]
    fn test_teams_destination_with_messagecard_override() {
        let dest = http_dest(
            "https://teams-proxy.corp/x",
            Some("teams"),
            &[("render_format", "teams_messagecard")],
            false,
        );
        assert_eq!(
            derive_channel_format(&dest),
            ChannelFormat::TeamsMessageCard
        );
    }

    #[test]
    fn test_teams_destination_without_override() {
        let dest = http_dest(
            "https://outlook.office.com/webhook/x",
            Some("teams"),
            &[],
            false,
        );
        assert_eq!(
            derive_channel_format(&dest),
            ChannelFormat::TeamsMessageCard
        );
    }

    #[test]
    fn test_teams_destination_with_adaptivecard_url() {
        let dest = http_dest(
            "https://prod-1.westus.logic.azure.com/workflows/x",
            Some("teams"),
            &[],
            false,
        );
        assert_eq!(
            derive_channel_format(&dest),
            ChannelFormat::TeamsAdaptiveCard
        );
    }
}
