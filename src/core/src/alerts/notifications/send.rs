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

//! Renders one template for one destination and sends it; the alert loop and `notify` share it.

use std::time::Duration;

use config::meta::destinations::{DestinationType, Email, Template, TemplateKind, TemplateType};

use super::{
    NotificationContext, RenderedMessage, apply_custom_template, derive_channel_format,
    format::ChannelFormat,
    jira,
    platform::{self, platform_of},
    render, resolve_content,
};
use crate::alerts::{
    alert::{
        send_discord_with_attachment, send_email_notification,
        send_email_notification_with_inline_png, send_http_notification, send_sns_notification,
    },
    destinations::{note_skipped, org_member_split},
};

const CONNECT_TIMEOUT_SECS: u64 = 10;

/// Where the subject of an email or SNS message comes from (Backend section 5, subject rule).
#[derive(Clone, Copy, Debug)]
pub enum Subject<'a> {
    /// The alert paths: SNS takes the alert name, email keeps the template's own title.
    Alert(&'a str),
    /// The other kinds: the producer's subject, else the email title, name or rendered title.
    Kind(Option<&'a str>),
}

/// A failed send the shared path can classify; each message is the text alerts showed before.
#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("{0}")]
    Blocked(String),
    #[error("sent error status: {status}{}", body.as_deref().map(|b| format!(", err: {b}")).unwrap_or_default())]
    Rejected {
        status: reqwest::StatusCode,
        body: Option<String>,
    },
    #[error("Email not sent: no recipient is part of this org (skipped: {})", .0.join(", "))]
    NoOrgMemberRecipient(Vec<String>),
    #[error("{0}")]
    Render(String),
}

/// A hanging endpoint must not stall the alert that sends to it.
pub(crate) fn destination_client_builder(skip_tls_verify: bool) -> reqwest::ClientBuilder {
    let timeout = config::get_config().limit.alert_notification_timeout;
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .danger_accept_invalid_certs(skip_tls_verify)
}

/// Carry the episode id into a platform's own correlation field, so the resolve
/// this module sends later can find what the firing opened.
///
/// A body we cannot parse is left alone and logged: saving the alert already
/// refused this combination, so reaching here means the template changed after
/// the fact, and dropping the firing would be the worse failure.
pub(crate) fn stamp_platform_key(
    dest_type: &DestinationType,
    ctx: &NotificationContext,
    msg: String,
) -> String {
    let (Some(platform), Some(episode_id)) = (platform_of(dest_type), ctx.episode_id.as_deref())
    else {
        return msg;
    };
    let empty = hashbrown::HashMap::new();
    let metadata = match dest_type {
        DestinationType::Http(endpoint) => &endpoint.metadata,
        _ => &empty,
    };
    match platform::stamp_key(platform, &msg, episode_id, metadata) {
        Ok(stamped) => stamped,
        Err(e) => {
            log::warn!(
                "[ALERT] {} payload has no place for {}: {e} — it will not be resolvable",
                ctx.alert_name,
                platform.key_field()
            );
            msg
        }
    }
}

/// Every destination type except the Slack app, which the caller sends through `slack_publish`.
pub async fn send_to_destination(
    org_id: &str,
    subject: Subject<'_>,
    dest_type: &DestinationType,
    template: &Template,
    ctx: &mut NotificationContext,
) -> Result<String, anyhow::Error> {
    // Jira builds its own text and keeps one issue per alert, so no template is rendered for it.
    if let DestinationType::Http(endpoint) = dest_type
        && jira::is_jira(endpoint)
    {
        return jira::send(endpoint, ctx).await;
    }
    let is_email = matches!(dest_type, DestinationType::Email(_));
    let empty_meta = hashbrown::HashMap::new();
    let metadata: &hashbrown::HashMap<String, String> = match dest_type {
        DestinationType::Http(endpoint) => &endpoint.metadata,
        _ => &empty_meta,
    };
    ctx.metadata = metadata
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    match template.kind {
        TemplateKind::Custom => {
            // Unchanged legacy path — byte-identical output.
            let msg = apply_custom_template(&template.body, ctx, is_email);
            let msg = stamp_platform_key(dest_type, ctx, msg);
            let title = custom_title(template, ctx, is_email);
            let (email_subject, sns_subject) = custom_subjects(subject, title);
            match dest_type {
                DestinationType::Http(endpoint) => send_http_notification(endpoint, msg).await,
                DestinationType::Email(email) => {
                    let (email, skipped) = org_member_email(org_id, email).await?;
                    send_email_notification(&email_subject, &email, None, msg)
                        .await
                        .map(|resp| note_skipped(resp, &skipped))
                }
                DestinationType::Sns(aws_sns) => {
                    send_sns_notification(&sns_subject, aws_sns, msg).await
                }
                DestinationType::SlackApp(_) => Err(anyhow::anyhow!(
                    "a Slack app destination is sent through slack_publish"
                )),
            }
        }
        TemplateKind::Content => send_content(org_id, subject, dest_type, template, ctx).await,
    }
}

async fn send_content(
    org_id: &str,
    subject: Subject<'_>,
    dest_type: &DestinationType,
    template: &Template,
    ctx: &NotificationContext,
) -> Result<String, anyhow::Error> {
    let spec = db::alerts::templates::get_parsed_content(template).map_err(|e| {
        SendError::Render(format!("Invalid content template {}: {e}", template.name))
    })?;
    let format = derive_channel_format(dest_type);
    let content = resolve_content(&spec, ctx, format.channel_family());
    let rendered = render(format, &content, ctx)
        .map_err(|e| SendError::Render(format!("Renderer failed: {e}")))?;

    match (rendered, dest_type) {
        (RenderedMessage::Http { body }, DestinationType::Http(endpoint)) => {
            // Discord with a rendered chart: upload the PNG in the
            // same webhook POST (the embed references it as
            // `attachment://`).
            if matches!(format, ChannelFormat::Discord)
                && let Some(png) = ctx.chart_png.clone()
            {
                send_discord_with_attachment(endpoint, body, png).await
            } else {
                let body = stamp_platform_key(dest_type, ctx, body);
                send_http_notification(endpoint, body).await
            }
        }
        (
            RenderedMessage::Email {
                subject: rendered_subject,
                html,
                text,
            },
            DestinationType::Email(email),
        ) => {
            let (email_subject, _) = content_subjects(subject, rendered_subject, "");
            let (email, skipped) = org_member_email(org_id, email).await?;
            send_email_notification_with_inline_png(
                &email_subject,
                &email,
                Some(text),
                html,
                ctx.chart_png.clone(),
            )
            .await
            .map(|resp| note_skipped(resp, &skipped))
        }
        (RenderedMessage::Sns { message, .. }, DestinationType::Sns(aws_sns)) => {
            let (_, sns_subject) = content_subjects(subject, String::new(), &content.title);
            send_sns_notification(&sns_subject, aws_sns, message).await
        }
        (rendered, dest_type) => Err(SendError::Render(format!(
            "Rendered message {rendered:?} does not match destination type {dest_type:?}"
        ))
        .into()),
    }
}

/// `(email, SNS)` subjects of a Custom template send; `title` is its email title or fallback.
fn custom_subjects(subject: Subject<'_>, title: String) -> (String, String) {
    match subject {
        Subject::Alert(name) => (title, name.to_string()),
        Subject::Kind(given) => {
            let s = given.map(str::to_string).unwrap_or(title);
            (s.clone(), s)
        }
    }
}

/// `(email, SNS)` subjects of a Content template send, from its rendered subject and title.
fn content_subjects(subject: Subject<'_>, rendered: String, title: &str) -> (String, String) {
    match subject {
        Subject::Alert(name) => (rendered, name.to_string()),
        Subject::Kind(Some(given)) => (given.to_string(), given.to_string()),
        Subject::Kind(None) => (rendered, title.to_string()),
    }
}

/// Narrows an email destination to org members and returns the skipped ones. [strong]
pub(crate) async fn org_member_email(
    org_id: &str,
    email: &Email,
) -> Result<(Email, Vec<String>), anyhow::Error> {
    let (kept, skipped) = org_member_split(org_id, &email.recipients).await?;
    Ok((members_to_send(kept, &skipped)?, skipped))
}

/// Email to the kept members, or an error naming the skipped when none is left. [pure]
fn members_to_send(kept: Vec<String>, skipped: &[String]) -> Result<Email, SendError> {
    if kept.is_empty() && !skipped.is_empty() {
        return Err(SendError::NoOrgMemberRecipient(skipped.to_vec()));
    }
    Ok(Email { recipients: kept })
}

/// The subject of a Custom template; alerts never set a fallback, so their subjects are unchanged.
fn custom_title(template: &Template, ctx: &NotificationContext, is_email: bool) -> String {
    let title = custom_title_unmarked(template, ctx, is_email);
    if ctx.render_hints.test_marker {
        return format!("{}{title}", super::TEST_MARKER);
    }
    title
}

fn custom_title_unmarked(template: &Template, ctx: &NotificationContext, is_email: bool) -> String {
    let fallback = ctx.render_hints.fallback_subject.as_ref();
    match &template.template_type {
        TemplateType::Email { title } if !(title.is_empty() && fallback.is_some()) => {
            // A subject is plain text: no HTML entities, and is_email keeps JSON escaping off too.
            let mut plain = ctx.clone();
            plain.render_hints.escape_email_attributes = false;
            apply_custom_template(title, &plain, is_email)
        }
        _ => fallback.cloned().unwrap_or_else(|| template.name.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_custom_email_subject_is_plain_text_where_the_body_is_escaped() {
        let template = Template {
            name: "check-mail".into(),
            template_type: TemplateType::Email {
                title: "{check_name} is down".into(),
            },
            ..Default::default()
        };
        let mut ctx = NotificationContext {
            context_attributes: vec![("check_name".into(), "API \"edge\" & Bob's worker".into())],
            ..Default::default()
        };
        ctx.render_hints.escape_email_attributes = true;
        assert_eq!(
            custom_title(&template, &ctx, true),
            "API \"edge\" & Bob's worker is down"
        );
    }

    #[test]
    fn a_test_send_marks_a_custom_email_subject_and_its_fallback() {
        let titled = Template {
            name: "check-mail".into(),
            template_type: TemplateType::Email {
                title: "{check_name} is down".into(),
            },
            ..Default::default()
        };
        let untitled = Template {
            name: "plain".into(),
            ..Default::default()
        };
        let mut ctx = NotificationContext {
            context_attributes: vec![("check_name".into(), "api".into())],
            ..Default::default()
        };
        ctx.render_hints.fallback_subject = Some("Nightly started".into());
        assert_eq!(custom_title(&titled, &ctx, true), "api is down");
        assert_eq!(custom_title(&untitled, &ctx, false), "Nightly started");
        ctx.render_hints.test_marker = true;
        assert_eq!(custom_title(&titled, &ctx, true), "[TEST] api is down");
        assert_eq!(
            custom_title(&untitled, &ctx, false),
            "[TEST] Nightly started"
        );
    }

    #[test]
    fn the_subject_rule_per_template_kind() {
        let s = |a: &str, b: &str| (a.to_string(), b.to_string());
        let title = || "Email title".to_string();
        assert_eq!(
            custom_subjects(Subject::Alert("cpu"), title()),
            s("Email title", "cpu")
        );
        assert_eq!(
            custom_subjects(Subject::Kind(Some("[opened] db")), title()),
            s("[opened] db", "[opened] db")
        );
        assert_eq!(
            custom_subjects(Subject::Kind(None), title()),
            s("Email title", "Email title")
        );
        let rendered = || "Rendered".to_string();
        assert_eq!(
            content_subjects(Subject::Alert("cpu"), rendered(), "Card"),
            s("Rendered", "cpu")
        );
        assert_eq!(
            content_subjects(Subject::Kind(Some("[opened] db")), rendered(), "Card"),
            s("[opened] db", "[opened] db")
        );
        assert_eq!(
            content_subjects(Subject::Kind(None), rendered(), "Card"),
            s("Rendered", "Card")
        );
    }

    #[test]
    fn test_members_to_send() {
        let to = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        type Expected = Result<Vec<String>, String>;
        let cases: Vec<(Vec<String>, Vec<String>, Expected)> = vec![
            (to(&["a@x.com"]), vec![], Ok(to(&["a@x.com"]))),
            (to(&["a@x.com"]), to(&["gone@x.com"]), Ok(to(&["a@x.com"]))),
            (vec![], vec![], Ok(vec![])),
            (
                vec![],
                to(&["gone@x.com", "left@x.com"]),
                Err("Email not sent: no recipient is part of this org (skipped: gone@x.com, left@x.com)".to_string()),
            ),
        ];
        for (kept, skipped, expected) in cases {
            let got = members_to_send(kept, &skipped)
                .map(|email| email.recipients)
                .map_err(|e| e.to_string());
            assert_eq!(got, expected, "skipped {skipped:?}");
        }
    }
}
