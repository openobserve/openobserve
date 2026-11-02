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

//! The replay record: a rendered message any node can resend with the destination's current URL.

use base64::Engine as _;
use config::meta::destinations::{DestinationType, Template, TemplateKind, TemplateType};
use serde::{Deserialize, Serialize};

use super::{
    NotificationContext, RenderedMessage, apply_custom_template,
    format::{ChannelFormat, derive_channel_format},
    platform::Platform,
    render::{discord::CHART_ATTACHMENT_NAME, email::CHART_CONTENT_ID, render},
    resolve::resolve_content,
};

/// A record larger than this drops its images, then is truncated if it is still over.
pub const RECORD_CAP_BYTES: usize = 256 * 1024;
pub const IMAGE_DROPPED: &str = "image dropped from replay";

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayRecord {
    pub v: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http: Option<HttpRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<EmailRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sns: Option<SnsRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<PlatformRecord>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpRecord {
    pub method: String,
    pub body: String,
    pub content_type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<Attachment>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailRecord {
    pub subject: String,
    pub html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inline: Vec<Attachment>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attachment {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub filename: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub cid: String,
    pub content_type: String,
    pub bytes_b64: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnsRecord {
    pub subject: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformRecord {
    pub kind: String,
    pub episode_id: String,
}

impl ReplayRecord {
    pub fn http(method: &str, body: String, png: Option<&[u8]>) -> Self {
        Self {
            v: 1,
            transport: Some("http".into()),
            http: Some(HttpRecord {
                method: method.to_string(),
                body,
                content_type: "application/json".into(),
                parts: png
                    .map(|png| {
                        vec![Attachment {
                            name: "files[0]".into(),
                            filename: CHART_ATTACHMENT_NAME.into(),
                            content_type: "image/png".into(),
                            bytes_b64: B64.encode(png),
                            ..Default::default()
                        }]
                    })
                    .unwrap_or_default(),
            }),
            ..Default::default()
        }
    }

    pub fn email(subject: String, html: String, text: Option<String>, png: Option<&[u8]>) -> Self {
        Self {
            v: 1,
            transport: Some("email".into()),
            email: Some(EmailRecord {
                subject,
                html,
                text,
                inline: png
                    .map(|png| {
                        vec![Attachment {
                            cid: CHART_CONTENT_ID.into(),
                            content_type: "image/png".into(),
                            bytes_b64: B64.encode(png),
                            ..Default::default()
                        }]
                    })
                    .unwrap_or_default(),
            }),
            ..Default::default()
        }
    }

    pub fn sns(subject: String, message: String) -> Self {
        Self {
            v: 1,
            transport: Some("sns".into()),
            sns: Some(SnsRecord { subject, message }),
            ..Default::default()
        }
    }

    pub fn platform_resolve(platform: Platform, episode_id: &str) -> Self {
        Self {
            v: 1,
            transport: Some("platform_resolve".into()),
            platform: Some(PlatformRecord {
                kind: platform_name(platform).into(),
                episode_id: episode_id.to_string(),
            }),
            ..Default::default()
        }
    }

    pub fn truncated() -> Self {
        Self {
            v: 1,
            truncated: true,
            ..Default::default()
        }
    }

    /// The transport family this record was rendered for: http, email, sns or platform_resolve.
    pub fn transport(&self) -> &str {
        self.transport.as_deref().unwrap_or_default()
    }

    /// The chart PNG of a Discord multipart or email inline record, if it still carries one.
    pub fn png(&self) -> Option<Vec<u8>> {
        let part = self
            .http
            .as_ref()
            .and_then(|h| h.parts.first())
            .or_else(|| self.email.as_ref().and_then(|e| e.inline.first()))?;
        B64.decode(&part.bytes_b64).ok()
    }

    /// The stored form under the cap, and whether the images had to be dropped to get there.
    pub fn to_stored(&self) -> (String, bool) {
        let full = serde_json::to_string(self).unwrap_or_default();
        if full.len() <= RECORD_CAP_BYTES {
            return (full, false);
        }
        let mut lean = self.clone();
        if let Some(http) = lean.http.as_mut() {
            http.parts.clear();
        }
        if let Some(email) = lean.email.as_mut() {
            email.inline.clear();
        }
        let lean_json = serde_json::to_string(&lean).unwrap_or_default();
        if lean_json.len() <= RECORD_CAP_BYTES {
            return (lean_json, true);
        }
        (
            serde_json::to_string(&ReplayRecord::truncated()).unwrap_or_default(),
            true,
        )
    }

    pub fn parse(stored: &str) -> Option<Self> {
        serde_json::from_str(stored).ok()
    }
}

pub fn platform_name(platform: Platform) -> &'static str {
    match platform {
        Platform::PagerDuty => "pagerduty",
        Platform::Opsgenie => "opsgenie",
        Platform::ServiceNow => "servicenow",
    }
}

pub fn parse_platform(name: &str) -> Option<Platform> {
    match name {
        "pagerduty" => Some(Platform::PagerDuty),
        "opsgenie" => Some(Platform::Opsgenie),
        "servicenow" => Some(Platform::ServiceNow),
        _ => None,
    }
}

/// The transport family a destination type sends through.
pub fn transport_of(dest_type: &DestinationType) -> &'static str {
    match dest_type {
        DestinationType::Http(_) | DestinationType::SlackApp(_) => "http",
        DestinationType::Email(_) => "email",
        DestinationType::Sns(_) => "sns",
    }
}

/// Render `template` for `dest_type` into a record, the same way the alert send path renders.
pub fn render_record(
    dest_type: &DestinationType,
    template: &Template,
    ctx: &NotificationContext,
    subject: Option<&str>,
) -> Result<ReplayRecord, String> {
    let is_email = matches!(dest_type, DestinationType::Email(_));
    match template.kind {
        TemplateKind::Custom => {
            let msg = apply_custom_template(&template.body, ctx, is_email);
            let msg = crate::alerts::alert::stamp_platform_key(dest_type, ctx, msg);
            let title = match &template.template_type {
                TemplateType::Email { title } => apply_custom_template(title, ctx, is_email),
                _ => template.name.clone(),
            };
            let subject = subject.map(str::to_string).unwrap_or(title);
            Ok(match dest_type {
                DestinationType::Email(_) => ReplayRecord::email(subject, msg, None, None),
                DestinationType::Sns(_) => ReplayRecord::sns(subject, msg),
                _ => ReplayRecord::http(&method_of(dest_type), msg, None),
            })
        }
        TemplateKind::Content => render_content_record(dest_type, template, ctx, subject),
    }
}

fn render_content_record(
    dest_type: &DestinationType,
    template: &Template,
    ctx: &NotificationContext,
    subject: Option<&str>,
) -> Result<ReplayRecord, String> {
    let spec = db::alerts::templates::get_parsed_content(template)
        .map_err(|e| format!("Invalid content template {}: {e}", template.name))?;
    let format = derive_channel_format(dest_type);
    let content = resolve_content(&spec, ctx, format.channel_family());
    let title = content.title.clone();
    let rendered = render(format, &content, ctx).map_err(|e| format!("Renderer failed: {e}"))?;
    let png = ctx.chart_png.as_deref().map(|p| p.as_slice());
    match (rendered, dest_type) {
        (
            RenderedMessage::Http { body },
            DestinationType::Http(_) | DestinationType::SlackApp(_),
        ) => {
            if matches!(format, ChannelFormat::Discord) && png.is_some() {
                return Ok(ReplayRecord::http(&method_of(dest_type), body, png));
            }
            let body = crate::alerts::alert::stamp_platform_key(dest_type, ctx, body);
            Ok(ReplayRecord::http(&method_of(dest_type), body, None))
        }
        (
            RenderedMessage::Email {
                subject: rendered_subject,
                html,
                text,
            },
            DestinationType::Email(_),
        ) => Ok(ReplayRecord::email(
            subject.map(str::to_string).unwrap_or(rendered_subject),
            html,
            Some(text),
            png,
        )),
        (RenderedMessage::Sns { message, .. }, DestinationType::Sns(_)) => Ok(ReplayRecord::sns(
            subject.map(str::to_string).unwrap_or(title),
            message,
        )),
        (rendered, dest_type) => Err(format!(
            "Rendered message {rendered:?} does not match destination type {dest_type:?}"
        )),
    }
}

fn method_of(dest_type: &DestinationType) -> String {
    match dest_type {
        DestinationType::Http(endpoint) => format!("{:?}", endpoint.method),
        _ => "POST".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_records_store_whole() {
        let rec = ReplayRecord::http("POST", "{}".into(), Some(&[1, 2, 3]));
        let (stored, dropped) = rec.to_stored();
        assert!(!dropped);
        let back = ReplayRecord::parse(&stored).unwrap();
        assert_eq!(back, rec);
        assert_eq!(back.png(), Some(vec![1, 2, 3]));
    }

    #[test]
    fn an_oversized_record_drops_its_image_first() {
        let png = vec![7u8; RECORD_CAP_BYTES];
        let rec = ReplayRecord::http("POST", "{\"x\":1}".into(), Some(&png));
        let (stored, dropped) = rec.to_stored();
        assert!(dropped);
        let back = ReplayRecord::parse(&stored).unwrap();
        assert!(!back.truncated);
        assert_eq!(back.http.unwrap().body, "{\"x\":1}");
        assert_eq!(ReplayRecord::parse(&stored).unwrap().png(), None);
    }

    #[test]
    fn a_body_still_over_the_cap_is_truncated() {
        let rec = ReplayRecord::email("s".into(), "x".repeat(RECORD_CAP_BYTES + 1), None, None);
        let (stored, dropped) = rec.to_stored();
        assert!(dropped);
        assert_eq!(stored, r#"{"v":1,"truncated":true}"#);
    }

    #[test]
    fn email_inline_png_round_trips() {
        let rec = ReplayRecord::email("s".into(), "<p>h</p>".into(), Some("t".into()), Some(&[9]));
        let back = ReplayRecord::parse(&rec.to_stored().0).unwrap();
        assert_eq!(back.email.as_ref().unwrap().inline[0].cid, CHART_CONTENT_ID);
        assert_eq!(back.png(), Some(vec![9]));
    }
}
