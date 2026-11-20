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
    alerts::notification_kind::{NotificationKind, PlatformAction},
    destinations::{Destination, DestinationType, Module, Template},
};
use db::alerts::destinations::DestinationError;

use super::{
    NotificationContext,
    format::{ChannelFormat, derive_channel_format},
    jira,
    org_default::{EffectiveTemplate, TemplateSource, resolve_effective_template_for},
    platform::{self, NOTHING_TO_CLOSE, Platform, PlatformRejected, platform_of},
    send::{SendError, Subject, send_to_destination},
};
use crate::alerts::{alert::send_http_notification, destinations, slack_publish};

/// The destination metadata key that forces the legacy body or the rendered envelope (D1).
pub const PAYLOAD_FORMAT_KEY: &str = "payload_format";

/// The `template_source` of a send whose body is the producer's legacy JSON.
pub const SOURCE_LEGACY: &str = "legacy";
pub const SOURCE_PLATFORM_RESOLVE: &str = "platform_resolve";

#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    #[error("destination {0} not found")]
    DestinationNotFound(String),
    #[error("destination {0} is not an alert destination")]
    NotAlertDestination(String),
    #[error("destination {destination} names a template that does not exist")]
    TemplateNotFound { destination: String },
    #[error("render failed: {0}")]
    Render(String),
    #[error("{0}")]
    Blocked(String),
    #[error("HTTP {status}: {body}")]
    Rejected { status: u16, body: String },
    #[error("{0}")]
    Transport(String),
    #[error("skipped: {}", .0.as_str())]
    Skipped(SkipReason),
}

impl NotifyError {
    /// Advice for the producer's own retry policy; `notify` never retries.
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

    pub(crate) fn from_send(e: anyhow::Error) -> Self {
        if let Some(rejected) = e.downcast_ref::<jira::JiraRejected>() {
            return NotifyError::Rejected {
                status: rejected.status,
                body: rejected.message.clone(),
            };
        }
        match e.downcast_ref::<SendError>() {
            Some(SendError::Blocked(m)) => NotifyError::Blocked(m.clone()),
            Some(SendError::Rejected { status, body }) => NotifyError::Rejected {
                status: status.as_u16(),
                body: body.clone().unwrap_or_default(),
            },
            Some(SendError::NoOrgMemberRecipient(_)) => {
                NotifyError::Skipped(SkipReason::NoOrgMemberRecipient)
            }
            Some(SendError::Render(m)) => NotifyError::Render(m.clone()),
            None => NotifyError::Transport(e.to_string()),
        }
    }
}

/// A rule decided that nothing is sent to this destination for this event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipReason {
    NoOrgMemberRecipient,
    PlatformNotForKind,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::NoOrgMemberRecipient => "NoOrgMemberRecipient",
            SkipReason::PlatformNotForKind => "PlatformNotForKind",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Resolved {
    pub destination: Destination,
    pub destination_type: DestinationType,
    pub effective: EffectiveTemplate,
    pub channel: ChannelFormat,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SendOutcome {
    pub response: String,
    pub template_source: String,
    pub template_name: String,
    pub platform_action: Option<PlatformAction>,
}

/// What `send` puts on the wire, decided before any network call.
#[derive(Debug, PartialEq)]
pub enum Route {
    PlatformResolve(Platform),
    Legacy(serde_json::Value),
    Render,
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
    );
    let channel = derive_channel_format(&destination_type);
    Ok(Resolved {
        destination,
        destination_type,
        effective,
        channel,
    })
}

/// Render and send one notification to one resolved destination, then log one line.
pub async fn send(
    org_id: &str,
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<SendOutcome, NotifyError> {
    let result = send_routed(org_id, resolved, subject, ctx).await;
    log_send(resolved, ctx, &result);
    result
}

/// Resolve, then send.
pub async fn notify(
    org_id: &str,
    dest_name: &str,
    explicit: &[Template],
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<SendOutcome, NotifyError> {
    let resolved = resolve(org_id, dest_name, explicit, ctx.kind).await?;
    send(org_id, &resolved, subject, ctx).await
}

/// The platform rule (D8), the Jira rule and the legacy rule (D1), with no network call.
pub fn route(resolved: &Resolved, ctx: &NotificationContext) -> Result<Route, NotifyError> {
    let dest_type = &resolved.destination_type;
    if let Some(platform) = platform_of(dest_type) {
        let action = ctx.kind.platform_action(ctx.event);
        if action == PlatformAction::Skip {
            return Err(NotifyError::Skipped(SkipReason::PlatformNotForKind));
        }
        if ctx.episode_id.as_deref().unwrap_or_default().is_empty() {
            return Err(NotifyError::Render(
                "episode_id empty on a platform send".to_string(),
            ));
        }
        if action == PlatformAction::Resolve {
            return Ok(Route::PlatformResolve(platform));
        }
    }
    if let DestinationType::Http(endpoint) = dest_type
        && jira::is_jira(endpoint)
    {
        if !matches!(
            ctx.kind,
            NotificationKind::Alert | NotificationKind::Incident | NotificationKind::Anomaly
        ) {
            return Err(NotifyError::Blocked(jira::UNSUPPORTED_SENDER.to_string()));
        }
        // Jira builds its own text, so an anomaly's legacy webhook body never applies.
        return Ok(Route::Render);
    }
    Ok(match legacy_body(resolved, ctx) {
        Some(body) => Route::Legacy(body),
        None => Route::Render,
    })
}

/// D1: a generic webhook with no user template at any level keeps the producer's JSON.
fn legacy_body(resolved: &Resolved, ctx: &NotificationContext) -> Option<serde_json::Value> {
    let legacy = ctx.legacy_payload.as_ref()?;
    let DestinationType::Http(endpoint) = &resolved.destination_type else {
        return None;
    };
    if !matches!(
        ctx.kind,
        NotificationKind::Anomaly
            | NotificationKind::Synthetics
            | NotificationKind::OnCall
            | NotificationKind::Downtime
    ) || resolved.channel != ChannelFormat::Webhook
    {
        return None;
    }
    let use_legacy = match endpoint
        .metadata
        .get(PAYLOAD_FORMAT_KEY)
        .map(String::as_str)
    {
        Some("legacy") => true,
        Some("rendered") => false,
        _ => resolved.effective.source == TemplateSource::Compiled,
    };
    use_legacy.then(|| legacy.build())
}

async fn send_routed(
    org_id: &str,
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &mut NotificationContext,
) -> Result<SendOutcome, NotifyError> {
    let route = route(resolved, ctx)?;
    let dest_type = &resolved.destination_type;
    let template = resolved.effective.template();
    let (template_source, template_name) = match &route {
        Route::PlatformResolve(_) => (SOURCE_PLATFORM_RESOLVE, String::new()),
        Route::Legacy(_) => (SOURCE_LEGACY, String::new()),
        Route::Render => (resolved.effective.source.as_str(), template.name.clone()),
    };
    let response = match (route, dest_type) {
        (Route::PlatformResolve(platform), DestinationType::Http(endpoint)) => {
            let key = ctx.episode_id.as_deref().unwrap_or_default();
            platform_resolve(platform, endpoint, key).await?
        }
        (Route::Legacy(body), DestinationType::Http(endpoint)) => {
            send_http_notification(endpoint, body.to_string())
                .await
                .map_err(NotifyError::from_send)?
        }
        (_, DestinationType::SlackApp(target)) => slack_publish::send_templated_post(
            &slack_publish::QueueSink,
            org_id,
            target,
            template,
            ctx,
        )
        .await
        .map_err(NotifyError::from_send)?,
        _ => send_to_destination(org_id, Subject::Kind(subject), dest_type, template, ctx)
            .await
            .map_err(NotifyError::from_send)?,
    };
    Ok(SendOutcome {
        response,
        template_source: template_source.to_string(),
        template_name,
        platform_action: platform_of(dest_type).map(|_| ctx.kind.platform_action(ctx.event)),
    })
}

/// Best effort (D8): a key the platform never opened, or closed already, is a success.
async fn platform_resolve(
    platform: Platform,
    endpoint: &config::meta::destinations::Endpoint,
    key: &str,
) -> Result<String, NotifyError> {
    platform::send_resolve(platform, endpoint, key)
        .await
        .or_else(|e| resolve_answer(platform, e))
}

/// A rejected resolve as `notify` reports it; Opsgenie's 404 on close means nothing to close.
fn resolve_answer(platform: Platform, e: anyhow::Error) -> Result<String, NotifyError> {
    match e.downcast_ref::<PlatformRejected>() {
        Some(r) if platform == Platform::Opsgenie && r.status == reqwest::StatusCode::NOT_FOUND => {
            Ok(format!("{NOTHING_TO_CLOSE}: {e}"))
        }
        Some(r) => Err(NotifyError::Rejected {
            status: r.status.as_u16(),
            body: r.body.clone().unwrap_or_default(),
        }),
        None => Err(NotifyError::Transport(e.to_string())),
    }
}

/// The only record of a send in this feature (Backend section 8).
fn log_send(
    resolved: &Resolved,
    ctx: &NotificationContext,
    result: &Result<SendOutcome, NotifyError>,
) {
    let (source, name, action, status) = match result {
        Ok(o) => (
            o.template_source.as_str(),
            o.template_name.as_str(),
            o.platform_action,
            "sent".to_string(),
        ),
        Err(e) => ("", "", None, e.to_string()),
    };
    let line = format!(
        "[NOTIFY] kind={} event={} destination={} channel={} template_source={source} \
         template_name={name} template_skipped={} platform_action={action:?} status={status}",
        ctx.kind,
        ctx.event,
        resolved.destination.name,
        resolved.channel.wire_name(),
        resolved.effective.skipped_json(),
    );
    match result {
        Ok(_) | Err(NotifyError::Skipped(_)) => log::info!("{line}"),
        Err(_) => log::warn!("{line}"),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::notification_kind::NotificationEvent,
        destinations::{Endpoint, TemplateKind, TemplateType},
    };

    use super::*;
    use crate::alerts::notifications::{LegacyPayload, org_default::compiled_fallback};

    fn resolved_for(dest_type: DestinationType, source: TemplateSource) -> Resolved {
        let channel = derive_channel_format(&dest_type);
        Resolved {
            destination: Destination {
                name: "d1".into(),
                ..Default::default()
            },
            destination_type: dest_type,
            effective: EffectiveTemplate {
                template: compiled_fallback("acme"),
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

    fn anomaly_ctx(event: NotificationEvent) -> NotificationContext {
        let mut ctx = crate::alerts::notifications::examples::example_context(
            NotificationKind::Anomaly,
            event == NotificationEvent::Resolved,
        );
        ctx.event = event;
        ctx.legacy_payload = Some(LegacyPayload::new(|| serde_json::json!({"text": "legacy"})));
        ctx
    }

    fn route_of(
        dest_type: DestinationType,
        source: TemplateSource,
        ctx: &NotificationContext,
    ) -> Route {
        route(&resolved_for(dest_type, source), ctx).unwrap()
    }

    #[test]
    fn a_generic_webhook_with_no_user_template_keeps_the_legacy_body() {
        let ctx = anomaly_ctx(NotificationEvent::Firing);
        assert_eq!(
            route_of(http("", None), TemplateSource::Compiled, &ctx),
            Route::Legacy(serde_json::json!({"text": "legacy"}))
        );
    }

    #[test]
    fn payload_format_and_user_templates_render() {
        let ctx = anomaly_ctx(NotificationEvent::Firing);
        let cases = [
            (http("", Some("rendered")), TemplateSource::Compiled),
            (http("", None), TemplateSource::Destination),
            (http("slack", Some("legacy")), TemplateSource::Compiled),
        ];
        for (dest_type, source) in cases {
            assert_eq!(route_of(dest_type, source, &ctx), Route::Render);
        }
        let forced = route_of(http("", Some("legacy")), TemplateSource::Destination, &ctx);
        assert!(matches!(forced, Route::Legacy(_)));
    }

    #[test]
    fn alerts_and_incidents_never_get_the_legacy_body() {
        let mut ctx = anomaly_ctx(NotificationEvent::Firing);
        ctx.kind = NotificationKind::Incident;
        assert_eq!(
            route_of(http("", None), TemplateSource::Compiled, &ctx),
            Route::Render
        );
    }

    #[test]
    fn a_platform_resolve_renders_nothing() {
        let ctx = anomaly_ctx(NotificationEvent::Resolved);
        assert_eq!(
            route_of(http("pagerduty", None), TemplateSource::Compiled, &ctx),
            Route::PlatformResolve(Platform::PagerDuty)
        );
        assert_eq!(
            route_of(http("", None), TemplateSource::Destination, &ctx),
            Route::Render,
            "other destinations get the resolved card"
        );
    }

    #[test]
    fn an_empty_key_on_a_platform_send_is_a_render_error() {
        for event in [NotificationEvent::Firing, NotificationEvent::Resolved] {
            let mut ctx = anomaly_ctx(event);
            ctx.episode_id = Some(String::new());
            let r = resolved_for(http("opsgenie", None), TemplateSource::Compiled);
            assert!(matches!(route(&r, &ctx), Err(NotifyError::Render(_))));
        }
    }

    #[test]
    fn platform_skips_follow_the_rule_table() {
        let r = resolved_for(http("servicenow", None), TemplateSource::Compiled);
        let mut ctx = anomaly_ctx(NotificationEvent::Informational);
        ctx.kind = NotificationKind::Synthetics;
        assert!(matches!(
            route(&r, &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
        ));
        ctx.kind = NotificationKind::Downtime;
        ctx.event = NotificationEvent::Firing;
        assert!(matches!(
            route(&r, &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
        ));
    }

    #[test]
    fn a_slack_app_destination_gets_the_card_not_the_legacy_text() {
        let ctx = anomaly_ctx(NotificationEvent::Firing);
        let r = resolved_for(
            DestinationType::SlackApp(Default::default()),
            TemplateSource::Compiled,
        );
        assert_eq!(route(&r, &ctx).unwrap(), Route::Render);
    }

    #[test]
    fn jira_takes_alerts_incidents_and_anomalies() {
        let mut ctx = anomaly_ctx(NotificationEvent::Firing);
        let r = resolved_for(http("jira", None), TemplateSource::Compiled);
        assert_eq!(route(&r, &ctx).unwrap(), Route::Render);
        ctx.kind = NotificationKind::Synthetics;
        assert!(matches!(route(&r, &ctx), Err(NotifyError::Blocked(_))));
    }

    #[test]
    fn a_jira_refusal_keeps_its_status_and_only_try_later_retries() {
        let mapped = |status| {
            NotifyError::from_send(
                jira::JiraRejected {
                    status,
                    message: "refused".into(),
                }
                .into(),
            )
        };
        for status in [400, 401, 404] {
            let e = mapped(status);
            assert!(
                matches!(&e, NotifyError::Rejected { status: s, body } if *s == status && body == "refused")
            );
            assert!(!e.is_retryable(), "{status}");
        }
        for status in [408, 429, 503] {
            assert!(mapped(status).is_retryable(), "{status}");
        }
    }

    #[test]
    fn send_errors_classify() {
        let rejected = SendError::Rejected {
            status: reqwest::StatusCode::SERVICE_UNAVAILABLE,
            body: Some("busy".into()),
        };
        assert_eq!(
            rejected.to_string(),
            "sent error status: 503 Service Unavailable, err: busy"
        );
        let e = NotifyError::from_send(rejected.into());
        assert!(matches!(&e, NotifyError::Rejected { status: 503, body } if body == "busy"));
        assert!(e.is_retryable());
        let e = NotifyError::from_send(SendError::NoOrgMemberRecipient(vec!["x@y".into()]).into());
        assert!(matches!(
            e,
            NotifyError::Skipped(SkipReason::NoOrgMemberRecipient)
        ));
        let e = NotifyError::from_send(SendError::Blocked("ssrf".into()).into());
        assert!(!e.is_retryable());
        assert!(NotifyError::from_send(anyhow::anyhow!("smtp down")).is_retryable());
    }

    #[test]
    fn a_resolve_with_nothing_to_close_is_a_success() {
        let rejected = |status: u16| {
            anyhow::Error::from(PlatformRejected {
                status: reqwest::StatusCode::from_u16(status).unwrap(),
                body: Some("no alert".into()),
            })
        };
        assert!(resolve_answer(Platform::Opsgenie, rejected(404)).is_ok());
        for platform in [Platform::PagerDuty, Platform::ServiceNow] {
            assert!(matches!(
                resolve_answer(platform, rejected(404)),
                Err(NotifyError::Rejected { status: 404, .. })
            ));
        }
        assert!(matches!(
            resolve_answer(Platform::Opsgenie, rejected(500)),
            Err(NotifyError::Rejected { status: 500, .. })
        ));
        assert!(matches!(
            resolve_answer(Platform::PagerDuty, anyhow::anyhow!("timeout")),
            Err(NotifyError::Transport(_))
        ));
    }

    #[test]
    fn retryable_errors() {
        let rejected = |status| NotifyError::Rejected {
            status,
            body: String::new(),
        };
        assert!(rejected(503).is_retryable());
        assert!(rejected(429).is_retryable());
        assert!(rejected(408).is_retryable());
        assert!(!rejected(400).is_retryable());
        assert!(!NotifyError::Skipped(SkipReason::PlatformNotForKind).is_retryable());
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
