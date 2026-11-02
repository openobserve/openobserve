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

//! The shared send path every non-alert producer calls: resolve, render, send (Backend section 5).

use config::meta::{
    alerts::notification_kind::{NotificationKind, PlatformEvent},
    destinations::{DestinationType, Module, Template},
};
use db::alerts::destinations::DestinationError;

use super::{
    NotificationContext,
    format::{ChannelFormat, derive_channel_format},
    org_default::{EffectiveTemplate, TemplateSource, resolve_effective_template_for},
    platform::{Platform, ResolveAnswer, platform_of},
    record::{ReplayRecord, render_record},
};
use crate::alerts::{
    alert::{HttpAttempt, send_discord_attempt, send_http_attempt, send_sns_notification},
    destinations::{self, note_skipped, org_member_split},
};

/// Must stay under the ledger lease so a hung transport never outlives its claim.
pub const TRANSPORT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// The destination metadata key that forces the legacy body or the rendered envelope (D1).
pub const PAYLOAD_FORMAT_KEY: &str = "payload_format";

/// The `template_source` of a row whose body is the producer's legacy JSON.
pub const SOURCE_LEGACY: &str = "legacy";
pub const SOURCE_PLATFORM_RESOLVE: &str = "platform_resolve";

#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    #[error("destination {0} not found")]
    DestinationNotFound(String),
    #[error("destination {0} is not an alert destination")]
    NotAlertDestination(String),
    #[error("destination {destination} names template {template}, which does not exist")]
    TemplateNotFound {
        destination: String,
        template: String,
    },
    #[error("render failed: {0}")]
    Render(String),
    #[error("{0}")]
    Blocked(String),
    #[error("HTTP {status}: {body}")]
    Rejected { status: u16, body: String },
    #[error("{0}")]
    Transport(String),
    #[error("skipped: {0:?}")]
    Skipped(SkipReason),
}

impl NotifyError {
    /// Worth another attempt: no answer, or an answer that says try later.
    pub fn is_retryable(&self) -> bool {
        match self {
            NotifyError::Rejected { status, .. } => matches!(status, 408 | 429) || *status >= 500,
            NotifyError::Transport(_) => true,
            _ => false,
        }
    }

    pub fn status_code(&self) -> Option<u16> {
        match self {
            NotifyError::Rejected { status, .. } => Some(*status),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipReason {
    AlreadyDelivered,
    InFlight,
    RetryScheduled,
    Exhausted,
    NoOrgMemberRecipient,
    PlatformNoAck,
    PlatformNotForKind,
    NoTriggerRecorded,
    Superseded,
    DestinationChanged,
}

impl SkipReason {
    pub fn outcome(self) -> SkipOutcome {
        match self {
            SkipReason::AlreadyDelivered => SkipOutcome::Delivered,
            SkipReason::InFlight | SkipReason::RetryScheduled => SkipOutcome::Pending,
            SkipReason::PlatformNoAck
            | SkipReason::PlatformNotForKind
            | SkipReason::NoTriggerRecorded
            | SkipReason::Superseded => SkipOutcome::Handled,
            SkipReason::Exhausted
            | SkipReason::NoOrgMemberRecipient
            | SkipReason::DestinationChanged => SkipOutcome::Unsuccessful,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::AlreadyDelivered => "AlreadyDelivered",
            SkipReason::InFlight => "InFlight",
            SkipReason::RetryScheduled => "RetryScheduled",
            SkipReason::Exhausted => "Exhausted",
            SkipReason::NoOrgMemberRecipient => "NoOrgMemberRecipient",
            SkipReason::PlatformNoAck => "PlatformNoAck",
            SkipReason::PlatformNotForKind => "PlatformNotForKind",
            SkipReason::NoTriggerRecorded => "NoTriggerRecorded",
            SkipReason::Superseded => "Superseded",
            SkipReason::DestinationChanged => "DestinationChanged",
        }
    }

    pub fn parse(s: &str) -> Option<SkipReason> {
        [
            SkipReason::AlreadyDelivered,
            SkipReason::InFlight,
            SkipReason::RetryScheduled,
            SkipReason::Exhausted,
            SkipReason::NoOrgMemberRecipient,
            SkipReason::PlatformNoAck,
            SkipReason::PlatformNotForKind,
            SkipReason::NoTriggerRecorded,
            SkipReason::Superseded,
            SkipReason::DestinationChanged,
        ]
        .into_iter()
        .find(|r| r.as_str() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipOutcome {
    Delivered,
    Pending,
    Handled,
    Unsuccessful,
}

#[derive(Clone, Debug)]
pub struct Resolved {
    pub destination: config::meta::destinations::Destination,
    pub destination_type: DestinationType,
    pub effective: EffectiveTemplate,
    pub channel: ChannelFormat,
}

/// The finished delivery row as the producer sees it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeliveryRow {
    pub id: String,
    pub status: String,
    pub status_code: Option<u16>,
    pub attempt: i32,
}

/// What `send` decided to put on the wire before the ledger sees it.
pub struct Prepared {
    pub record: ReplayRecord,
    pub template_source: String,
    pub template_name: String,
    pub template_skipped: String,
    pub platform: Option<Platform>,
}

/// Find the destination and the template that renders this send.
pub async fn resolve(
    org_id: &str,
    dest_name: &str,
    explicit: &[Template],
    kind: NotificationKind,
) -> Result<Resolved, NotifyError> {
    let (destination, dest_template) = destinations::get_with_template(org_id, dest_name)
        .await
        .map_err(|e| match e {
            DestinationError::NotFound => NotifyError::DestinationNotFound(dest_name.to_string()),
            DestinationError::TemplateNotFound => NotifyError::TemplateNotFound {
                destination: dest_name.to_string(),
                template: String::new(),
            },
            other => NotifyError::Transport(other.to_string()),
        })?;
    let Module::Alert {
        destination_type, ..
    } = &destination.module
    else {
        return Err(NotifyError::NotAlertDestination(dest_name.to_string()));
    };
    let destination_type = destination_type.clone();
    let effective = resolve_effective_template_for(
        org_id,
        kind,
        explicit,
        dest_template,
        Some(&destination_type),
    )
    .await;
    let channel = derive_channel_format(&destination_type);
    Ok(Resolved {
        destination,
        destination_type,
        effective,
        channel,
    })
}

/// Render and send one notification to one resolved destination through the delivery ledger.
pub async fn send(
    org_id: &str,
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<DeliveryRow, NotifyError> {
    apply_destination_metadata(&resolved.destination_type, ctx);
    if sends_outside_ledger(resolved, ctx) {
        return send_outside_ledger(org_id, resolved, subject, ctx).await;
    }
    super::delivery::send_on_ledger(org_id, resolved, subject, ctx).await
}

/// Send through the Slack app outbox or Jira and record a finished row that is never replayed.
async fn send_outside_ledger(
    org_id: &str,
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<DeliveryRow, NotifyError> {
    let new = super::delivery::new_delivery(org_id, resolved, ctx, subject);
    if super::delivery::already_sent_outside(&new).await {
        return Err(NotifyError::Skipped(SkipReason::AlreadyDelivered));
    }
    let sent = match &resolved.destination_type {
        DestinationType::SlackApp(target) => {
            crate::alerts::slack_publish::send_templated_post(
                &crate::alerts::slack_publish::QueueSink,
                org_id,
                target,
                resolved.effective.template(),
                ctx,
            )
            .await
        }
        DestinationType::Http(endpoint) => super::jira::send(endpoint, ctx).await,
        _ => Err(anyhow::anyhow!("not an outside-ledger destination")),
    }
    .map_err(|e| NotifyError::Transport(e.to_string()));
    super::delivery::record_outside(&new, &sent).await;
    sent.map(|_| DeliveryRow {
        status: "sent".into(),
        attempt: 1,
        ..Default::default()
    })
}

/// The Slack app outbox and Jira issues keep no body the ledger could resend.
pub fn sends_outside_ledger(resolved: &Resolved, ctx: &NotificationContext) -> bool {
    match &resolved.destination_type {
        DestinationType::SlackApp(_) => true,
        DestinationType::Http(endpoint) => {
            super::jira::is_jira(endpoint) && ctx.kind == NotificationKind::Incident
        }
        _ => false,
    }
}

/// Resolve, then send.
pub async fn notify(
    org_id: &str,
    dest_name: &str,
    explicit: &[Template],
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<DeliveryRow, NotifyError> {
    let resolved = resolve(org_id, dest_name, explicit, ctx.kind).await?;
    send(org_id, &resolved, subject, ctx).await
}

/// The platform rule, the legacy rule (D1), then the render; nothing here touches the network.
pub fn prepare(
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &NotificationContext,
) -> Result<Prepared, NotifyError> {
    let effective = &resolved.effective;
    let platform = platform_of(&resolved.destination_type);
    if let Some(platform) = platform {
        let episode_id = ctx.episode_id.as_deref().unwrap_or_default();
        match ctx.kind.platform_event(&ctx.event) {
            PlatformEvent::NoAck => return Err(NotifyError::Skipped(SkipReason::PlatformNoAck)),
            PlatformEvent::NotForKind => {
                return Err(NotifyError::Skipped(SkipReason::PlatformNotForKind));
            }
            PlatformEvent::Resolve | PlatformEvent::Trigger if episode_id.is_empty() => {
                return Err(NotifyError::Render(
                    "episode_id empty on a platform send".to_string(),
                ));
            }
            PlatformEvent::Resolve => {
                return Ok(Prepared {
                    record: ReplayRecord::platform_resolve(platform, episode_id),
                    template_source: SOURCE_PLATFORM_RESOLVE.into(),
                    template_name: String::new(),
                    template_skipped: "[]".into(),
                    platform: Some(platform),
                });
            }
            PlatformEvent::Trigger => {}
        }
    }
    if let Some(legacy) = legacy_body(resolved, ctx) {
        return Ok(Prepared {
            record: ReplayRecord::http(
                &method_name(&resolved.destination_type),
                legacy.to_string(),
                None,
            ),
            template_source: SOURCE_LEGACY.into(),
            template_name: String::new(),
            template_skipped: effective.skipped_json(),
            platform,
        });
    }
    let record = render_record(
        &resolved.destination_type,
        effective.template(),
        ctx,
        subject,
    )
    .map_err(NotifyError::Render)?;
    Ok(Prepared {
        record,
        template_source: effective.source.as_str().into(),
        template_name: effective.template().name.clone(),
        template_skipped: effective.skipped_json(),
        platform,
    })
}

/// D1: a generic webhook with no user template at any level keeps the producer's JSON.
fn legacy_body(resolved: &Resolved, ctx: &NotificationContext) -> Option<serde_json::Value> {
    let legacy = ctx.legacy_payload.as_ref()?;
    if !matches!(
        ctx.kind,
        NotificationKind::Anomaly | NotificationKind::Synthetics | NotificationKind::OnCall
    ) || resolved.channel != ChannelFormat::Webhook
    {
        return None;
    }
    let forced = match &resolved.destination_type {
        DestinationType::Http(endpoint) => endpoint.metadata.get(PAYLOAD_FORMAT_KEY).cloned(),
        _ => None,
    };
    let use_legacy = match forced.as_deref() {
        Some("legacy") => true,
        Some("rendered") => false,
        _ => resolved.effective.source == TemplateSource::Compiled,
    };
    use_legacy.then(|| legacy.build())
}

fn method_name(dest_type: &DestinationType) -> String {
    match dest_type {
        DestinationType::Http(endpoint) => format!("{:?}", endpoint.method),
        _ => "POST".into(),
    }
}

pub(crate) fn apply_destination_metadata(
    dest_type: &DestinationType,
    ctx: &mut NotificationContext,
) {
    ctx.metadata = match dest_type {
        DestinationType::Http(endpoint) => endpoint
            .metadata
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        _ => Vec::new(),
    };
}

/// Put `record` on the wire with the destination's current URL, headers, recipients or topic.
pub async fn transport(
    org_id: &str,
    dest_type: &DestinationType,
    record: &ReplayRecord,
) -> Result<String, NotifyError> {
    if record.truncated {
        return Err(NotifyError::Render(
            "replay record was truncated; nothing to resend".into(),
        ));
    }
    match (record.transport(), dest_type) {
        ("platform_resolve", DestinationType::Http(endpoint)) => {
            let platform = record
                .platform
                .as_ref()
                .and_then(|p| super::record::parse_platform(&p.kind))
                .ok_or_else(|| NotifyError::Render("platform record has no kind".into()))?;
            let episode_id = record
                .platform
                .as_ref()
                .map(|p| p.episode_id.as_str())
                .unwrap_or_default();
            platform_resolve(platform, endpoint, episode_id).await
        }
        ("http", DestinationType::Http(endpoint)) => {
            let http = record.http.as_ref().ok_or_else(missing)?;
            let attempt = match record.png() {
                Some(png) if !http.parts.is_empty() => {
                    send_discord_attempt(
                        endpoint,
                        http.body.clone(),
                        std::sync::Arc::new(png),
                        Some(TRANSPORT_TIMEOUT),
                    )
                    .await
                }
                _ => send_http_attempt(endpoint, http.body.clone(), Some(TRANSPORT_TIMEOUT)).await,
            }
            .map_err(|e| NotifyError::Render(e.to_string()))?;
            http_outcome(attempt)
        }
        ("http", DestinationType::SlackApp(target)) => {
            let http = record.http.as_ref().ok_or_else(missing)?;
            crate::alerts::slack_publish::send_post(
                &crate::alerts::slack_publish::QueueSink,
                org_id,
                target,
                "",
                &http.body,
            )
            .await
            .map_err(|e| NotifyError::Transport(e.to_string()))
        }
        ("email", DestinationType::Email(email)) => {
            let rec = record.email.as_ref().ok_or_else(missing)?;
            let (kept, skipped) = org_member_split(org_id, &email.recipients)
                .await
                .map_err(|e| NotifyError::Transport(e.to_string()))?;
            if kept.is_empty() {
                return Err(NotifyError::Skipped(SkipReason::NoOrgMemberRecipient));
            }
            let to = config::meta::destinations::Email { recipients: kept };
            bounded(
                crate::alerts::alert::send_email_notification_with_inline_png(
                    &rec.subject,
                    &to,
                    rec.text.clone(),
                    rec.html.clone(),
                    record.png().map(std::sync::Arc::new),
                ),
            )
            .await?
            .map(|resp| note_skipped(resp, &skipped))
            .map_err(|e| NotifyError::Transport(e.to_string()))
        }
        ("sns", DestinationType::Sns(aws_sns)) => {
            let rec = record.sns.as_ref().ok_or_else(missing)?;
            bounded(send_sns_notification(
                &rec.subject,
                aws_sns,
                rec.message.clone(),
            ))
            .await?
            .map_err(|e| NotifyError::Transport(e.to_string()))
        }
        _ => Err(NotifyError::Skipped(SkipReason::DestinationChanged)),
    }
}

/// Caps a transport without its own overall deadline, so no send outlives the ledger lease.
async fn bounded<T>(send: impl std::future::Future<Output = T>) -> Result<T, NotifyError> {
    tokio::time::timeout(TRANSPORT_TIMEOUT, send)
        .await
        .map_err(|_| NotifyError::Transport(format!("timed out after {TRANSPORT_TIMEOUT:?}")))
}

fn missing() -> NotifyError {
    NotifyError::Render("replay record has no body for its transport".into())
}

fn http_outcome(attempt: HttpAttempt) -> Result<String, NotifyError> {
    match attempt {
        HttpAttempt::Answered {
            note: Some(note), ..
        } => Ok(note),
        HttpAttempt::Answered { status, body, .. } if status.is_success() => {
            Ok(format!("sent status: {status}, body: {body}"))
        }
        HttpAttempt::Answered {
            status,
            body,
            hide_body,
            ..
        } => Err(NotifyError::Rejected {
            status: status.as_u16(),
            body: if hide_body { String::new() } else { cap(&body) },
        }),
        HttpAttempt::Blocked(e) => Err(NotifyError::Blocked(e)),
        HttpAttempt::NoAnswer(e) => Err(NotifyError::Transport(e)),
    }
}

async fn platform_resolve(
    platform: Platform,
    endpoint: &config::meta::destinations::Endpoint,
    episode_id: &str,
) -> Result<String, NotifyError> {
    let answer = super::platform::resolve_for_ledger(
        platform,
        endpoint,
        episode_id,
        Some(TRANSPORT_TIMEOUT),
    )
    .await
    .map_err(|e| NotifyError::Render(e.to_string()))?;
    match answer {
        ResolveAnswer::Closed(text) | ResolveAnswer::NothingToClose(text) => Ok(text),
        ResolveAnswer::Rejected { status, body } => Err(NotifyError::Rejected {
            status,
            body: cap(&body),
        }),
        ResolveAnswer::Blocked(e) => Err(NotifyError::Blocked(e)),
        ResolveAnswer::NoAnswer(e) => Err(NotifyError::Transport(e)),
    }
}

/// Error text stored on a row is capped at 2 KB.
pub fn cap(s: &str) -> String {
    const MAX: usize = 2048;
    if s.len() <= MAX {
        return s.to_string();
    }
    let mut end = MAX;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{Destination, Endpoint, TemplateKind, TemplateType};

    use super::*;
    use crate::alerts::notifications::{LegacyPayload, org_default::compiled_fallback_for};

    fn resolved_for(dest_type: DestinationType, source: TemplateSource) -> Resolved {
        let channel = derive_channel_format(&dest_type);
        Resolved {
            destination: Destination {
                name: "d1".into(),
                ..Default::default()
            },
            destination_type: dest_type,
            effective: EffectiveTemplate {
                template: compiled_fallback_for("acme", NotificationKind::Anomaly),
                source,
                skipped: vec![],
            },
            channel,
        }
    }

    fn http(destination_type: &str, payload_format: Option<&str>) -> DestinationType {
        let mut endpoint = Endpoint {
            destination_type: (!destination_type.is_empty()).then(|| destination_type.to_string()),
            url: "https://hooks.example/x".into(),
            ..Default::default()
        };
        if let Some(f) = payload_format {
            endpoint
                .metadata
                .insert(PAYLOAD_FORMAT_KEY.into(), f.into());
        }
        DestinationType::Http(endpoint)
    }

    fn anomaly_ctx(event: &str) -> NotificationContext {
        let mut ctx = crate::alerts::notifications::examples::example_context(
            NotificationKind::Anomaly,
            event == "resolved",
        );
        ctx.event = event.into();
        ctx.legacy_payload = Some(LegacyPayload::new(|| serde_json::json!({"text": "legacy"})));
        ctx
    }

    fn body(p: &Prepared) -> serde_json::Value {
        serde_json::from_str(&p.record.http.as_ref().unwrap().body).unwrap()
    }

    #[test]
    fn a_generic_webhook_with_no_user_template_keeps_the_legacy_body() {
        let r = resolved_for(http("", None), TemplateSource::Compiled);
        let p = prepare(&r, None, &anomaly_ctx("firing:1")).unwrap();
        assert_eq!(p.template_source, SOURCE_LEGACY);
        assert_eq!(body(&p), serde_json::json!({"text": "legacy"}));
    }

    #[test]
    fn payload_format_rendered_sends_the_envelope_with_the_kind() {
        let r = resolved_for(http("", Some("rendered")), TemplateSource::Compiled);
        let p = prepare(&r, None, &anomaly_ctx("firing:1")).unwrap();
        assert_eq!(p.template_source, "compiled");
        assert_eq!(body(&p)["context"]["kind"], "anomaly");
    }

    #[test]
    fn a_user_template_on_a_generic_webhook_renders() {
        let r = resolved_for(http("", None), TemplateSource::Destination);
        let p = prepare(&r, None, &anomaly_ctx("firing:1")).unwrap();
        assert_eq!(p.template_source, "destination");
        assert_eq!(body(&p)["version"], 1);
    }

    #[test]
    fn slack_never_gets_the_legacy_body() {
        let r = resolved_for(http("slack", Some("legacy")), TemplateSource::Compiled);
        let p = prepare(&r, None, &anomaly_ctx("firing:1")).unwrap();
        assert_eq!(p.template_source, "compiled");
        assert!(body(&p)["attachments"].is_array());
    }

    #[test]
    fn a_platform_resolve_is_a_protocol_record_with_the_episode_key() {
        let r = resolved_for(http("pagerduty", None), TemplateSource::Compiled);
        let p = prepare(&r, None, &anomaly_ctx("resolved")).unwrap();
        assert_eq!(p.template_source, SOURCE_PLATFORM_RESOLVE);
        let platform = p.record.platform.unwrap();
        assert_eq!(platform.kind, "pagerduty");
        assert_eq!(platform.episode_id, "a1b2c3:1762077900000000");
    }

    #[test]
    fn a_platform_trigger_carries_the_dedup_key() {
        let r = resolved_for(http("pagerduty", None), TemplateSource::Compiled);
        let p = prepare(&r, None, &anomaly_ctx("firing:1")).unwrap();
        assert_eq!(body(&p)["dedup_key"], "a1b2c3:1762077900000000");
        assert_eq!(body(&p)["event_action"], "trigger");
    }

    #[test]
    fn an_empty_episode_on_a_platform_send_is_a_render_error() {
        let r = resolved_for(http("pagerduty", None), TemplateSource::Compiled);
        let mut ctx = anomaly_ctx("resolved");
        ctx.episode_id = None;
        assert!(matches!(
            prepare(&r, None, &ctx),
            Err(NotifyError::Render(_))
        ));
    }

    #[test]
    fn platform_skips_follow_the_rule_table() {
        let r = resolved_for(http("opsgenie", None), TemplateSource::Compiled);
        let mut ctx = anomaly_ctx("firing:1");
        ctx.kind = NotificationKind::OnCall;
        ctx.event = "acknowledged".into();
        assert!(matches!(
            prepare(&r, None, &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNoAck))
        ));
        ctx.kind = NotificationKind::Downtime;
        ctx.event = "started".into();
        assert!(matches!(
            prepare(&r, None, &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
        ));
    }

    #[test]
    fn email_and_sns_render_from_the_compiled_card() {
        let email = DestinationType::Email(config::meta::destinations::Email {
            recipients: vec!["a@acme.com".into()],
        });
        let p = prepare(
            &resolved_for(email, TemplateSource::Compiled),
            None,
            &anomaly_ctx("firing:1"),
        )
        .unwrap();
        let rec = p.record.email.unwrap();
        assert!(rec.subject.contains("Anomaly firing"));
        assert!(rec.html.contains("342.00"));
        assert!(rec.text.unwrap().contains("342.00"));

        let sns = DestinationType::Sns(config::meta::destinations::AwsSns {
            sns_topic_arn: "arn:x".into(),
            aws_region: "us-east-1".into(),
        });
        let p = prepare(
            &resolved_for(sns, TemplateSource::Compiled),
            Some("subject"),
            &anomaly_ctx("firing:1"),
        )
        .unwrap();
        assert_eq!(p.record.sns.unwrap().subject, "subject");
    }

    #[test]
    fn retryable_errors() {
        assert!(
            NotifyError::Rejected {
                status: 503,
                body: String::new()
            }
            .is_retryable()
        );
        assert!(
            NotifyError::Rejected {
                status: 429,
                body: String::new()
            }
            .is_retryable()
        );
        assert!(
            !NotifyError::Rejected {
                status: 400,
                body: String::new()
            }
            .is_retryable()
        );
        assert!(NotifyError::Transport("t".into()).is_retryable());
        assert!(!NotifyError::Blocked("b".into()).is_retryable());
    }

    #[test]
    fn skip_outcomes() {
        assert_eq!(
            SkipReason::AlreadyDelivered.outcome(),
            SkipOutcome::Delivered
        );
        assert_eq!(SkipReason::RetryScheduled.outcome(), SkipOutcome::Pending);
        assert_eq!(
            SkipReason::NoTriggerRecorded.outcome(),
            SkipOutcome::Handled
        );
        assert_eq!(
            SkipReason::DestinationChanged.outcome(),
            SkipOutcome::Unsuccessful
        );
        assert_eq!(
            SkipReason::parse("Superseded"),
            Some(SkipReason::Superseded)
        );
    }

    #[test]
    fn custom_templates_fall_through_on_the_wrong_transport() {
        let custom_http = Template {
            name: "hook".into(),
            kind: TemplateKind::Custom,
            template_type: TemplateType::Http,
            ..Default::default()
        };
        assert!(super::super::org_default::fits_transport(
            &custom_http,
            &http("slack", None)
        ));
        assert!(!super::super::org_default::fits_transport(
            &custom_http,
            &DestinationType::Email(Default::default())
        ));
    }
}
