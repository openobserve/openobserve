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

//! An alert send to a Slack app becomes one keyed `slack_outbound` event; the leader posts it.

use std::sync::LazyLock;

use async_trait::async_trait;
use base64::Engine;
use bytes::Bytes;
use config::meta::{
    alerts::{
        level::AlertLevel,
        recovery::RecoveryEvent,
        state::{AlertState, ROLLUP_GROUP_KEY},
    },
    destinations::{DestinationType, Module, SlackAppTarget, Template, TemplateKind},
    slack::{
        ALERT_SLACK_EVENT_VERSION, AlertSlackEvent, AlertSlackEventKind, RenderedWire,
        SLACK_OUTBOUND_TOPIC, SlackAlertMessageKey,
    },
};
use dashmap::DashMap;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::alerts::notifications::{
    apply_custom_template,
    context::NotificationContext,
    render::markdown::{escape_mrkdwn, markdown_to_mrkdwn},
    resolve::{RenderedContent, resolve_content},
};

/// A larger chart is dropped and the message goes out without it (§7.4).
pub const MAX_CHART_PNG_BYTES: usize = 512 * 1024;
/// `slack_alert_messages.content` holds at most this much JSON (Q6).
pub const MAX_CONTENT_BYTES: usize = 16 * 1024;
/// A predicted single-row firing start older than this belongs to a run that never persisted.
const PENDING_START_TTL_MICROS: i64 = 60 * 60 * 1_000_000;

/// Single-row firing starts handed to a send before the run's state commit writes them.
static PENDING_STARTS: LazyLock<DashMap<String, i64>> = LazyLock::new(DashMap::new);

/// Where an event goes; the queue in production, a recorder in tests.
#[async_trait]
pub trait OutboundSink: Send + Sync {
    async fn publish(&self, message_id: &str, payload: Bytes) -> anyhow::Result<()>;
}

/// The firing one send belongs to; `prior` is the level its message showed before this send.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FiringRef {
    pub group_key: String,
    pub firing_started_at: i64,
    pub prior: Option<AlertLevel>,
}

impl FiringRef {
    /// A hint for the leader, which decides by the message row: Fire posts, Repeat replies.
    pub fn kind(&self, message_exists: bool, level: Option<AlertLevel>) -> AlertSlackEventKind {
        match (message_exists, self.prior, level) {
            (false, ..) => AlertSlackEventKind::Fire,
            (true, Some(prior), Some(level))
                if prior.is_firing() && level.severity_rank() > prior.severity_rank() =>
            {
                AlertSlackEventKind::LevelUp
            }
            _ => AlertSlackEventKind::Repeat,
        }
    }
}

/// The process-wide `slack_outbound` stream of the cluster-local queue.
pub struct QueueSink;

#[async_trait]
impl OutboundSink for QueueSink {
    async fn publish(&self, message_id: &str, payload: Bytes) -> anyhow::Result<()> {
        infra::queue::get_queue()
            .await
            .publish_with_id(SLACK_OUTBOUND_TOPIC, payload, message_id)
            .await
            .map_err(|e| anyhow::anyhow!("Slack outbound queue publish failed: {e}"))
    }
}

/// One alert send to one Slack app destination.
pub struct AlertSend<'a> {
    pub org_id: &'a str,
    pub alert_id: Option<&'a str>,
    pub is_real_time: bool,
    pub destination_id: &'a str,
    pub template: &'a Template,
}

/// Every send fails visibly where Slack cannot run, with the message the form uses (§3.1, §4).
pub fn unavailable_reason(org_id: &str) -> Option<String> {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::slack::DisabledReason;
        o2_enterprise::enterprise::slack::disabled_reason(org_id).map(|reason| match reason {
            DisabledReason::SuperCluster => {
                "Slack is not available on super-cluster deployments".to_string()
            }
            DisabledReason::Edition => "Slack app needs Enterprise".to_string(),
            DisabledReason::Flag | DisabledReason::MasterKey => {
                "Slack is turned off on this deployment".to_string()
            }
        })
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        Some("Slack app needs Enterprise".to_string())
    }
}

/// Broker dedup key: a retried scheduler run publishes the same id, so Slack sees it once.
pub fn event_id(e: &AlertSlackEvent) -> String {
    let kind = serde_json::to_string(&e.kind).unwrap_or_default();
    let mut h = Sha256::new();
    for part in [
        e.destination_id.as_str(),
        e.alert_id.as_str(),
        e.group_key.as_str(),
        &e.firing_started_at.to_string(),
        kind.trim_matches('"'),
        &e.seq.to_string(),
    ] {
        h.update(part.len().to_le_bytes());
        h.update(part.as_bytes());
    }
    format!("{:x}", h.finalize())
}

/// Who and what one event is about; a Post has no firing, so its key fields are empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventTarget<'a> {
    pub org_id: &'a str,
    pub destination_id: &'a str,
    pub alert_id: &'a str,
    pub group_key: &'a str,
    pub firing_started_at: i64,
    pub kind: AlertSlackEventKind,
    pub seq: u64,
}

/// Builds the event of one send; only Fire, LevelUp and Post carry a chart.
pub fn build_event(
    t: &EventTarget<'_>,
    level: AlertLevel,
    rendered: RenderedWire,
    chart_png: Option<&[u8]>,
    at: i64,
) -> AlertSlackEvent {
    let carries_chart = matches!(
        t.kind,
        AlertSlackEventKind::Fire | AlertSlackEventKind::LevelUp | AlertSlackEventKind::Post
    );
    AlertSlackEvent {
        v: ALERT_SLACK_EVENT_VERSION,
        kind: t.kind,
        destination_id: t.destination_id.to_string(),
        org_id: t.org_id.to_string(),
        alert_id: t.alert_id.to_string(),
        group_key: t.group_key.to_string(),
        firing_started_at: t.firing_started_at,
        seq: t.seq,
        rendered: Some(fit_wire(rendered)),
        chart_png_b64: chart_png
            .filter(|_| carries_chart)
            .and_then(|png| chart_b64(t.alert_id, png)),
        level,
        at,
    }
}

/// Publishes one event; a failed publish is a failed send, so the run records NotifyFailed.
pub async fn publish(sink: &dyn OutboundSink, event: &AlertSlackEvent) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(&event.org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    publish_unchecked(sink, event).await
}

/// [`publish`] after the caller has checked that Slack runs here.
pub async fn publish_unchecked(
    sink: &dyn OutboundSink,
    event: &AlertSlackEvent,
) -> anyhow::Result<String> {
    let id = event_id(event);
    let payload = Bytes::from(serde_json::to_vec(event)?);
    sink.publish(&id, payload).await?;
    Ok(format!("queued for Slack ({:?})", event.kind))
}

/// The SlackApp arm of an alert send: the firing's Fire, Repeat or LevelUp, else a one-off Post.
pub async fn send_alert(
    sink: &dyn OutboundSink,
    send: &AlertSend<'_>,
    ctx: &NotificationContext,
) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(send.org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let rendered = render_wire(send.template, ctx)?;
    let now = config::utils::time::now_micros();
    let firing = match send.alert_id {
        Some(alert_id) if !send.is_real_time && !is_manual_trigger(ctx) => {
            firing_of(alert_id, ctx, now).await
        }
        _ => None,
    };
    let alert_id = send.alert_id.unwrap_or_default();
    let seq = window_seq(ctx);
    let event = match firing {
        Some(f) => {
            let exists = message_exists(&message_key(send.destination_id, alert_id, &f)).await;
            let target = EventTarget {
                org_id: send.org_id,
                destination_id: send.destination_id,
                alert_id,
                group_key: &f.group_key,
                firing_started_at: f.firing_started_at,
                kind: f.kind(exists, ctx.level),
                seq,
            };
            build_event(&target, level_of(ctx), rendered, chart(ctx), now)
        }
        None => {
            let target = post_target(send.org_id, send.destination_id, alert_id, seq);
            build_event(&target, level_of(ctx), rendered, chart(ctx), now)
        }
    };
    publish_unchecked(sink, &event).await
}

/// A one-off message with no lifecycle: downtime notices, synthetics, incident notifications.
pub async fn send_post(
    sink: &dyn OutboundSink,
    org_id: &str,
    target: &SlackAppTarget,
    subject: &str,
    msg: &str,
) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let destination_id = destination_id_for(org_id, target).await?;
    let ctx = NotificationContext {
        alert_name: subject.to_string(),
        ..Default::default()
    };
    let rendered = wire_from_custom(msg, &ctx);
    let now = config::utils::time::now_micros();
    let target = post_target(org_id, &destination_id, "", now.max(0) as u64);
    let event = build_event(&target, AlertLevel::Warning, rendered, None, now);
    publish_unchecked(sink, &event).await
}

/// An incident notification to a Slack app destination: its template rendered as a one-off Post.
pub async fn send_templated_post(
    sink: &dyn OutboundSink,
    org_id: &str,
    target: &SlackAppTarget,
    template: &Template,
    ctx: &NotificationContext,
) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let destination_id = destination_id_for(org_id, target).await?;
    let now = config::utils::time::now_micros();
    let event = templated_post_event(org_id, &destination_id, template, ctx, now)?;
    publish_unchecked(sink, &event).await
}

/// The Post event of [`send_templated_post`]. [pure]
fn templated_post_event(
    org_id: &str,
    destination_id: &str,
    template: &Template,
    ctx: &NotificationContext,
    now: i64,
) -> anyhow::Result<AlertSlackEvent> {
    let rendered = render_wire(template, ctx)?;
    let target = post_target(org_id, destination_id, "", now.max(0) as u64);
    Ok(build_event(
        &target,
        level_of(ctx),
        rendered,
        chart(ctx),
        now,
    ))
}

/// The short thread reply of a recovery a downtime did not mute; the green edit is the clear's.
pub async fn send_recovered(
    sink: &dyn OutboundSink,
    destinations: &[(String, String)],
    event: &RecoveryEvent,
) -> anyhow::Result<usize> {
    let Some(firing_started_at) = event.firing_started_at else {
        return Ok(0);
    };
    if destinations.is_empty() {
        return Ok(0);
    }
    if let Some(reason) = unavailable_reason(&event.org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let mut sent = 0;
    for (destination_id, _) in destinations {
        let target = EventTarget {
            org_id: &event.org_id,
            destination_id,
            alert_id: &event.alert_id,
            group_key: &event.group_key,
            firing_started_at,
            kind: AlertSlackEventKind::Recovered,
            seq: 0,
        };
        let mut e = build_event(
            &target,
            AlertLevel::Ok,
            RenderedWire::default(),
            None,
            event.emitted_at,
        );
        e.rendered = None;
        publish_unchecked(sink, &e).await?;
        sent += 1;
    }
    Ok(sent)
}

/// The destination form's Send test and a content template's test-send, posted now.
pub async fn send_test_now(
    org_id: &str,
    target: &SlackAppTarget,
    title: &str,
    body: &str,
) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let ctx = NotificationContext {
        alert_name: title.to_string(),
        ..Default::default()
    };
    let mut wire = wire_from_custom(body, &ctx);
    if !wire
        .title
        .starts_with(crate::alerts::notifications::TEST_MARKER)
    {
        wire.title = format!(
            "{}{}",
            crate::alerts::notifications::TEST_MARKER,
            wire.title
        );
    }
    test_outcome(org_id, target, fit_wire(wire)).await
}

/// The destination form's Send test: the template on a sample alert, posted now, marked Test.
pub async fn send_form_test(
    org_id: &str,
    target: &SlackAppTarget,
    template_name: Option<&str>,
) -> anyhow::Result<String> {
    if let Some(reason) = unavailable_reason(org_id) {
        return Err(anyhow::anyhow!(reason));
    }
    let explicit = match template_name.filter(|n| !n.is_empty()) {
        Some(name) => Some(
            db::alerts::templates::get(org_id, name)
                .await
                .map_err(|_| anyhow::anyhow!("Template {name} not found"))?,
        ),
        None => None,
    };
    let effective =
        crate::alerts::notifications::org_default::resolve_effective_template(org_id, explicit)
            .await;
    let ctx = crate::alerts::notifications::preview::synthetic_context(None);
    let mut wire = render_wire(effective.template(), &ctx)?;
    wire.title = format!(
        "{}{}",
        crate::alerts::notifications::TEST_MARKER,
        wire.title
    );
    test_outcome(org_id, target, fit_wire(wire)).await
}

/// Renders a template for Slack: mrkdwn body, the template's links, the alert link apart.
pub fn render_wire(template: &Template, ctx: &NotificationContext) -> anyhow::Result<RenderedWire> {
    match template.kind {
        TemplateKind::Custom => Ok(wire_from_custom(
            &apply_custom_template(&template.body, ctx, false),
            ctx,
        )),
        TemplateKind::Content => {
            let spec = db::alerts::templates::get_parsed_content(template)
                .map_err(|e| anyhow::anyhow!("Invalid content template {}: {e}", template.name))?;
            Ok(wire_from_content(
                &resolve_content(&spec, ctx, "slack"),
                ctx,
            ))
        }
    }
}

/// The alert's Slack app destinations as `(id, name)`; a lookup failure leaves one out.
pub async fn slack_app_destinations(org_id: &str, names: &[String]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for name in names {
        if let Ok(d) = db::alerts::destinations::get(org_id, name).await
            && let Module::Alert {
                destination_type: DestinationType::SlackApp(_),
                ..
            } = d.module
        {
            out.push((d.id.map(|id| id.to_string()).unwrap_or_default(), d.name));
        }
    }
    out
}

/// The base64 chart, or nothing when it is over the cap.
pub fn chart_b64(alert_id: &str, png: &[u8]) -> Option<String> {
    if png.len() > MAX_CHART_PNG_BYTES {
        log::warn!(
            "[SLACK_PUBLISH] alert {alert_id}: chart of {} bytes is over {MAX_CHART_PNG_BYTES}; \
             the message goes out without it",
            png.len()
        );
        return None;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(png))
}

/// A content template's resolved parts; the alert link becomes Open in OpenObserve.
pub fn wire_from_content(c: &RenderedContent, ctx: &NotificationContext) -> RenderedWire {
    let mut body = markdown_to_mrkdwn(&c.body_markdown);
    if let Some(lines) = c.row_lines.as_ref().filter(|l| !l.is_empty()) {
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(&lines.join("\n"));
    }
    let links = c
        .links
        .iter()
        .filter(|(label, url)| !(label.is_empty() && *url == ctx.alert_url))
        .cloned()
        .collect();
    RenderedWire {
        title: c.title.clone(),
        body,
        fields: c.fields.clone(),
        links,
        open_url: ctx.alert_url.clone(),
    }
}

/// A custom template's output: a Slack webhook body is read for its parts, anything else is text.
pub fn wire_from_custom(msg: &str, ctx: &NotificationContext) -> RenderedWire {
    let mut wire = RenderedWire {
        title: ctx.alert_name.clone(),
        open_url: ctx.alert_url.clone(),
        ..Default::default()
    };
    let Ok(Value::Object(doc)) = serde_json::from_str::<Value>(msg) else {
        wire.body = msg.trim().to_string();
        return wire;
    };
    let mut body = Vec::new();
    for block in doc
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        read_block(block, ctx, &mut wire, &mut body);
    }
    let text = doc
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let has_header = wire.title != ctx.alert_name;
    match text {
        Some(t) if !has_header => wire.title = t.to_string(),
        Some(t) if body.is_empty() && t != wire.title => body.push(t.to_string()),
        _ => {}
    }
    for attachment in doc
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        read_attachment(attachment, ctx, &mut wire, &mut body);
    }
    wire.body = body.join("\n");
    wire
}

/// Clamps the body, then fields, then links, so the stored content fits its column.
pub fn fit_wire(mut wire: RenderedWire) -> RenderedWire {
    while wire_len(&wire) > MAX_CONTENT_BYTES {
        if wire.body.len() > 256 {
            let keep = floor_char_boundary(&wire.body, wire.body.len() / 2);
            wire.body.truncate(keep);
            wire.body.push('…');
        } else if wire.fields.pop().is_some() || wire.links.pop().is_some() {
        } else if wire.title.len() > 150 {
            let keep = floor_char_boundary(&wire.title, 150);
            wire.title.truncate(keep);
        } else {
            wire.body.clear();
            break;
        }
    }
    wire
}

/// The message row a send of this firing would touch.
pub fn message_key(
    destination_id: &str,
    alert_id: &str,
    firing: &FiringRef,
) -> SlackAlertMessageKey {
    SlackAlertMessageKey {
        destination_id: destination_id.to_string(),
        alert_id: alert_id.to_string(),
        group_key: firing.group_key.clone(),
        firing_started_at: firing.firing_started_at,
    }
}

/// The firing a send is about, read from the state row; `None` is a one-off Post.
pub async fn firing_of(alert_id: &str, ctx: &NotificationContext, now: i64) -> Option<FiringRef> {
    let grouped = ctx.group_labels.is_some();
    let group_key = match ctx.group_labels.as_ref() {
        Some(labels) => config::meta::alerts::grouping::group_key(labels),
        None => ROLLUP_GROUP_KEY.to_string(),
    };
    let state = match infra::table::alert_states::get(alert_id, &group_key).await {
        Ok(state) => state,
        Err(e) => {
            log::warn!("[SLACK_PUBLISH] could not read the state of {alert_id}/{group_key}: {e}");
            None
        }
    };
    let (firing_started_at, prior) = firing_start(alert_id, grouped, state.as_ref(), now)?;
    Some(FiringRef {
        group_key,
        firing_started_at,
        prior,
    })
}

/// A persisted start wins; a single-row firing this run opens gets one predicted start.
pub fn firing_start(
    alert_id: &str,
    grouped: bool,
    state: Option<&AlertState>,
    now: i64,
) -> Option<(i64, Option<AlertLevel>)> {
    if let Some(started) = state.and_then(|s| s.firing_started_at) {
        let prior = state.and_then(|s| {
            if grouped {
                s.last_notified_level
            } else {
                s.level
            }
        });
        return Some((started, prior));
    }
    if grouped {
        return None;
    }
    let mut entry = PENDING_STARTS.entry(alert_id.to_string()).or_insert(now);
    if *entry > now || now - *entry > PENDING_START_TTL_MICROS {
        *entry = now;
    }
    Some((*entry, None))
}

/// The start a send handed out for this alert's new single-row firing; consumed by the commit.
pub fn take_pending_start(alert_id: &str, now: i64) -> Option<i64> {
    PENDING_STARTS
        .remove(alert_id)
        .map(|(_, at)| at)
        .filter(|at| *at <= now && now - *at <= PENDING_START_TTL_MICROS)
}

#[cfg(feature = "enterprise")]
async fn test_outcome(
    org_id: &str,
    target: &SlackAppTarget,
    wire: RenderedWire,
) -> anyhow::Result<String> {
    let outcome =
        o2_enterprise::enterprise::slack::alerts::test_send::send_test(org_id, target, wire)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if outcome.posted {
        Ok(outcome.detail)
    } else {
        Err(anyhow::anyhow!(outcome.detail))
    }
}

#[cfg(not(feature = "enterprise"))]
async fn test_outcome(
    _org_id: &str,
    _target: &SlackAppTarget,
    _wire: RenderedWire,
) -> anyhow::Result<String> {
    Err(anyhow::anyhow!("Slack app needs Enterprise"))
}

fn post_target<'a>(
    org_id: &'a str,
    destination_id: &'a str,
    alert_id: &'a str,
    seq: u64,
) -> EventTarget<'a> {
    EventTarget {
        org_id,
        destination_id,
        alert_id,
        group_key: "",
        firing_started_at: 0,
        kind: AlertSlackEventKind::Post,
        seq,
    }
}

/// The evaluation time in ms: the rows' end stays put on unchanged data, so repeats would collide.
fn window_seq(ctx: &NotificationContext) -> u64 {
    match u64::try_from(ctx.alert_trigger_time / 1000) {
        Ok(at) if at > 0 => at,
        _ => ctx.alert_end_time_millis.parse::<u64>().unwrap_or_default(),
    }
}

fn level_of(ctx: &NotificationContext) -> AlertLevel {
    ctx.level.unwrap_or(AlertLevel::Critical)
}

fn chart(ctx: &NotificationContext) -> Option<&[u8]> {
    ctx.chart_png.as_deref().map(Vec::as_slice)
}

fn is_manual_trigger(ctx: &NotificationContext) -> bool {
    ctx.rows
        .first()
        .and_then(|r| r.get("trigger_type"))
        .and_then(Value::as_str)
        == Some("manual")
}

async fn message_exists(key: &SlackAlertMessageKey) -> bool {
    match infra::table::slack_alert_messages::get_by_key(key).await {
        Ok(row) => row.is_some(),
        Err(e) => {
            log::warn!("[SLACK_PUBLISH] could not read the message of {key:?}: {e}");
            false
        }
    }
}

/// Posts carry only a destination id; same-target destinations post to the same channel.
async fn destination_id_for(org_id: &str, target: &SlackAppTarget) -> anyhow::Result<String> {
    let all = db::alerts::destinations::list(org_id, Some("alert")).await?;
    all.into_iter()
        .find_map(|d| match d.module {
            Module::Alert {
                destination_type: DestinationType::SlackApp(t),
                ..
            } if t.installation_id == target.installation_id
                && t.channel_id == target.channel_id =>
            {
                d.id.map(|id| id.to_string())
            }
            _ => None,
        })
        .ok_or_else(|| anyhow::anyhow!("Slack app destination for {} not found", target.channel_id))
}

fn read_attachment(
    attachment: &Value,
    ctx: &NotificationContext,
    wire: &mut RenderedWire,
    body: &mut Vec<String>,
) {
    // Slack formats an attachment field only when `mrkdwn_in` lists it; the body is mrkdwn.
    let marked = |key: &str| {
        attachment
            .get("mrkdwn_in")
            .and_then(Value::as_array)
            .is_some_and(|keys| keys.iter().any(|k| k.as_str() == Some(key)))
    };
    for key in ["pretext", "author_name", "title", "text"] {
        let Some(text) = attachment
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let as_body = if matches!(key, "pretext" | "text") && marked(key) {
            text.to_string()
        } else {
            escape_mrkdwn(text)
        };
        if key == "title"
            && let Some(url) = attachment.get("title_link").and_then(Value::as_str)
        {
            if url != ctx.alert_url {
                wire.links.push((text.to_string(), url.to_string()));
            } else {
                body.push(as_body);
            }
        } else {
            body.push(as_body);
        }
    }
    for field in attachment
        .get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let title = field
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let value = field
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !title.is_empty() || !value.is_empty() {
            wire.fields.push((title.to_string(), value.to_string()));
        }
    }
    for block in attachment
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if block.get("type").and_then(Value::as_str) == Some("header") {
            if let Some(text) = block
                .get("text")
                .and_then(|t| t.get("text"))
                .and_then(Value::as_str)
            {
                body.push(escape_mrkdwn(text));
            }
        } else {
            read_block(block, ctx, wire, body);
        }
    }
    if let Some(footer) = attachment
        .get("footer")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        body.push(escape_mrkdwn(footer));
    }
}

fn read_block(
    block: &Value,
    ctx: &NotificationContext,
    wire: &mut RenderedWire,
    body: &mut Vec<String>,
) {
    // Block Kit nests a text object ({type, text}) where a context element has the string.
    let text_of = |v: Option<&Value>| {
        let text = v?.get("text")?;
        text.as_str()
            .or_else(|| text.get("text").and_then(Value::as_str))
            .map(str::to_string)
    };
    let body_text_of = |v: &Value| {
        let plain = v
            .get("text")
            .and_then(|t| t.get("type"))
            .and_then(Value::as_str)
            == Some("plain_text");
        text_of(Some(v)).map(|t| if plain { escape_mrkdwn(&t) } else { t })
    };
    match block.get("type").and_then(Value::as_str) {
        Some("header") => {
            if let Some(t) = text_of(Some(block)) {
                wire.title = t;
            }
        }
        Some("section") => {
            if let Some(t) = body_text_of(block) {
                body.push(t);
            }
            for f in block
                .get("fields")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(t) = f.get("text").and_then(Value::as_str) {
                    wire.fields.push(split_field(t));
                }
            }
        }
        Some("actions") => {
            for el in block
                .get("elements")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (Some(label), Some(url)) =
                    (text_of(Some(el)), el.get("url").and_then(Value::as_str))
                else {
                    continue;
                };
                if url != ctx.alert_url {
                    wire.links.push((label, url.to_string()));
                }
            }
        }
        Some("context") => {
            for el in block
                .get("elements")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(t) = el.get("text").and_then(Value::as_str) {
                    let plain = el.get("type").and_then(Value::as_str) == Some("plain_text");
                    body.push(if plain {
                        escape_mrkdwn(t)
                    } else {
                        t.to_string()
                    });
                }
            }
        }
        _ => {}
    }
}

/// `*Label:*\nvalue`, the webhook template's field shape, into its label and value.
fn split_field(text: &str) -> (String, String) {
    match text.split_once('\n') {
        Some((label, value)) => (
            label
                .trim()
                .trim_matches('*')
                .trim_end_matches(':')
                .to_string(),
            value.trim().to_string(),
        ),
        None => (String::new(), text.trim().to_string()),
    }
}

fn wire_len(wire: &RenderedWire) -> usize {
    serde_json::to_vec(wire)
        .map(|v| v.len())
        .unwrap_or(usize::MAX)
}

fn floor_char_boundary(s: &str, mut at: usize) -> usize {
    while at > 0 && !s.is_char_boundary(at) {
        at -= 1;
    }
    at
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use config::meta::alerts::state::AlertState;
    use serde_json::json;

    use super::*;

    const PREBUILT_SLACK: &str = r#"{
  "text": "[{alert_status}] {alert_name}",
  "blocks": [
    {"type": "header", "text": {"type": "plain_text", "text": "[{alert_status}] {alert_name}"}},
    {"type": "section", "fields": [
      {"type": "mrkdwn", "text": "*Stream:*\n{stream_name}"},
      {"type": "mrkdwn", "text": "*Type:*\n{stream_type}"},
      {"type": "mrkdwn", "text": "*Count:*\n{alert_count}"}
    ]},
    {"type": "section", "text": {"type": "mrkdwn", "text": "*Status:* {alert_status}"}},
    {"type": "actions", "elements": [
      {"type": "button", "text": {"type": "plain_text", "text": "View in OpenObserve"}, "url": "{alert_url}"}
    ]}
  ]
}"#;

    const PLAIN_ATTACHMENTS: &str = r#"{"blocks":[{"type":"section","text":{"type":"plain_text","text":"Top <!here>"}}],"attachments":[{"pretext":"Heads up <!channel>","title":"A & B","text":"<https://evil.test|click> *now*","blocks":[{"type":"header","text":{"type":"plain_text","text":"<!everyone>"}}]},{"text":"Ping <!subteam^S0TEST>","mrkdwn_in":["text"]}]}"#;

    const LIVE_ATTACHMENT: &str = r#"{"attachments":[{"author_name":"Bot <!channel>","title":"Runbook <!channel> <http://x|y>","title_link":"https://example.test/runbook","fields":[{"title":"Host <!channel>","value":"<http://x|y> db-test"}],"footer":"Footer <http://x|y>"}]}"#;

    #[derive(Default)]
    struct Recorder {
        sent: Mutex<Vec<(String, AlertSlackEvent)>>,
        down: bool,
    }

    #[async_trait]
    impl OutboundSink for Recorder {
        async fn publish(&self, message_id: &str, payload: Bytes) -> anyhow::Result<()> {
            if self.down {
                anyhow::bail!("TopicNotFound: slack_outbound");
            }
            let event = serde_json::from_slice(&payload)?;
            self.sent
                .lock()
                .unwrap()
                .push((message_id.to_string(), event));
            Ok(())
        }
    }

    fn ctx() -> NotificationContext {
        NotificationContext {
            org_name: "Prod".into(),
            alert_name: "checkout-errors".into(),
            stream_name: "checkout".into(),
            stream_type: "logs".into(),
            alert_count: "42".into(),
            alert_status: "firing".into(),
            alert_url: "https://o2.test/short/abc".into(),
            alert_end_time_millis: "1760000000000".into(),
            level: Some(AlertLevel::Critical),
            ..Default::default()
        }
    }

    fn target<'a>(kind: AlertSlackEventKind, seq: u64) -> EventTarget<'a> {
        EventTarget {
            org_id: "prod",
            destination_id: "d0fake",
            alert_id: "a0fake",
            group_key: "",
            firing_started_at: 1_760_000_000_000_000,
            kind,
            seq,
        }
    }

    fn event(t: &EventTarget<'_>) -> AlertSlackEvent {
        build_event(t, AlertLevel::Critical, RenderedWire::default(), None, 1)
    }

    #[test]
    fn each_evaluation_has_its_own_seq_even_on_unchanged_data() {
        let first = NotificationContext {
            alert_trigger_time: 1_760_000_060_000_000,
            ..ctx()
        };
        let next = NotificationContext {
            alert_trigger_time: 1_760_000_120_000_000,
            ..ctx()
        };
        assert_eq!(first.alert_end_time_millis, next.alert_end_time_millis);
        assert_eq!(window_seq(&first), 1_760_000_060_000);
        assert_ne!(
            window_seq(&first),
            window_seq(&next),
            "a repeat is a new event"
        );
        assert_eq!(
            window_seq(&first.clone()),
            window_seq(&first),
            "a re-send is the same one"
        );
        assert_eq!(
            window_seq(&ctx()),
            1_760_000_000_000,
            "no evaluation time: the rows' end"
        );
    }

    #[test]
    fn a_retried_send_has_the_same_id_and_every_key_part_changes_it() {
        let base = target(AlertSlackEventKind::Fire, 7);
        let id = event_id(&event(&base));
        let mut later = event(&base);
        later.at = 99;
        later.rendered = Some(RenderedWire {
            title: "re-rendered".into(),
            ..Default::default()
        });
        assert_eq!(event_id(&later), id, "only the key decides the id");
        let variants = [
            EventTarget {
                destination_id: "d1fake",
                ..base.clone()
            },
            EventTarget {
                alert_id: "a1fake",
                ..base.clone()
            },
            EventTarget {
                group_key: "g1",
                ..base.clone()
            },
            EventTarget {
                firing_started_at: 1,
                ..base.clone()
            },
            target(AlertSlackEventKind::Repeat, 7),
            target(AlertSlackEventKind::Fire, 8),
        ];
        for v in variants {
            assert_ne!(event_id(&event(&v)), id, "{v:?}");
        }
        assert_eq!(id.len(), 64);
    }

    #[test]
    fn attachment_only_template_preserves_content() {
        let wire = wire_from_custom(
            r#"{"attachments":[{"pretext":"Before","title":"Details","title_link":"https://example.test/details","text":"Attachment body","fields":[{"title":"Host","value":"db-test"}],"blocks":[{"type":"section","text":{"type":"mrkdwn","text":"Nested body"}}]}]}"#,
            &ctx(),
        );
        for text in ["Before", "Attachment body", "Nested body"] {
            assert!(wire.body.contains(text), "missing {text}: {wire:?}");
        }
        assert!(wire.fields.contains(&("Host".into(), "db-test".into())));
        assert!(
            wire.links
                .contains(&("Details".into(), "https://example.test/details".into()))
        );
    }

    #[test]
    fn plain_attachment_text_cannot_ping_or_link() {
        let wire = wire_from_custom(PLAIN_ATTACHMENTS, &ctx());
        for live in [
            "<!here>",
            "<!channel>",
            "<https://evil.test|click>",
            "<!everyone>",
            "A & B",
        ] {
            assert!(!wire.body.contains(live), "{live} stayed live: {wire:?}");
        }
        for text in [
            "Top &lt;!here&gt;",
            "Heads up &lt;!channel&gt;",
            "A &amp; B",
            "&lt;https://evil.test|click&gt; *now*",
            "&lt;!everyone&gt;",
            "Ping <!subteam^S0TEST>",
        ] {
            assert!(wire.body.contains(text), "missing {text}: {wire:?}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_final_slack_payload_keeps_plain_attachment_text_plain() {
        let wire = fit_wire(wire_from_custom(PLAIN_ATTACHMENTS, &ctx()));
        let payload = o2_enterprise::enterprise::slack::alerts::blocks::test_message(
            &wire,
            AlertLevel::Critical,
        );
        let json = serde_json::to_string(&payload).unwrap();
        for live in ["<!here>", "<!channel>", "<https://evil.test", "<!everyone>"] {
            assert!(!json.contains(live), "{live} reached Slack live: {json}");
        }
        assert!(json.contains("Heads up &lt;!channel&gt;"), "{json}");
        assert!(json.contains("Ping <!subteam^S0TEST>"), "{json}");
    }

    #[cfg(feature = "enterprise")]
    fn texts_of(v: &Value, kind: &str, out: &mut Vec<String>) {
        match v {
            Value::Object(m) => {
                if m.get("type").and_then(Value::as_str) == Some(kind)
                    && let Some(t) = m.get("text").and_then(Value::as_str)
                {
                    out.push(t.to_string());
                }
                m.values().for_each(|v| texts_of(v, kind, out));
            }
            Value::Array(a) => a.iter().for_each(|v| texts_of(v, kind, out)),
            _ => {}
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_final_payload_keeps_attachment_fields_and_linked_titles_plain() {
        use o2_enterprise::enterprise::slack::alerts::blocks;

        let ctx = ctx();
        let wire = wire_from_custom(&apply_custom_template(LIVE_ATTACHMENT, &ctx, false), &ctx);
        let rendered = build_event(
            &target(AlertSlackEventKind::Fire, 1),
            AlertLevel::Critical,
            wire,
            None,
            1,
        )
        .rendered
        .unwrap();
        let view = crate::alerts::slack_view::view_from(
            "prod",
            "a0fake",
            "",
            1_760_000_000_000_000,
            crate::alerts::slack_view::ViewInputs {
                alert: Some(Default::default()),
                ..Default::default()
            },
        );
        let opts = blocks::MessageOpts {
            buttons: true,
            ..Default::default()
        };
        for payload in [
            blocks::message(&view, &rendered, &opts),
            blocks::test_message(&rendered, AlertLevel::Critical),
        ] {
            let json = serde_json::to_value(&payload).unwrap();
            let mut texts = vec![payload.text.clone()];
            texts_of(&json, "mrkdwn", &mut texts);
            for live in ["<!channel>", "<http://x|y>"] {
                assert!(
                    texts.iter().all(|t| !t.contains(live)),
                    "{live} reached Slack as mrkdwn: {texts:?}"
                );
            }
            let all = texts.join("\n");
            assert!(all.contains("Host &lt;!channel&gt;"), "{all}");
            assert!(all.contains("&lt;http://x|y&gt; db-test"), "{all}");
        }
        let test =
            serde_json::to_value(blocks::test_message(&rendered, AlertLevel::Critical)).unwrap();
        let mut labels = Vec::new();
        texts_of(&test, "plain_text", &mut labels);
        assert!(
            labels.contains(&"Runbook <!channel> <http://x|y>".to_string()),
            "the linked title is a plain_text button label: {labels:?}"
        );
    }

    #[test]
    fn attachment_author_and_footer_are_plain_text_lines() {
        let wire = wire_from_custom(LIVE_ATTACHMENT, &ctx());
        for text in ["Bot &lt;!channel&gt;", "Footer &lt;http://x|y&gt;"] {
            assert!(wire.body.contains(text), "missing {text}: {wire:?}");
        }
        assert!(!wire.body.contains("<!channel>"), "{wire:?}");
    }

    #[test]
    fn the_trim_runs_after_attachment_extraction() {
        let long = "x".repeat(MAX_CONTENT_BYTES * 2);
        let msg = json!({"attachments": [{"text": long}]}).to_string();
        let ctx = ctx();
        let wire = wire_from_custom(&apply_custom_template(&msg, &ctx, false), &ctx);
        assert!(
            wire_len(&wire) > MAX_CONTENT_BYTES,
            "the attachment text was read"
        );
        let event = build_event(
            &target(AlertSlackEventKind::Fire, 1),
            AlertLevel::Critical,
            wire,
            None,
            1,
        );
        let rendered = event.rendered.unwrap();
        assert!(
            wire_len(&rendered) <= MAX_CONTENT_BYTES,
            "{}",
            wire_len(&rendered)
        );
        assert!(rendered.body.starts_with("xxx"));
    }

    #[test]
    fn mixed_template_preserves_both_sources() {
        let wire = wire_from_custom(
            r#"{"text":"Alert title","blocks":[{"type":"section","text":{"type":"mrkdwn","text":"Top body"}}],"attachments":[{"title":"Attachment title","text":"Attachment body"}]}"#,
            &ctx(),
        );
        assert_eq!(wire.title, "Alert title");
        for text in ["Top body", "Attachment title", "Attachment body"] {
            assert!(wire.body.contains(text), "missing {text}: {wire:?}");
        }
    }

    #[test]
    fn the_prebuilt_slack_webhook_body_reads_as_title_fields_and_text() {
        let ctx = ctx();
        let msg = apply_custom_template(PREBUILT_SLACK, &ctx, false);
        let wire = wire_from_custom(&msg, &ctx);
        assert!(wire.title.contains("checkout-errors"), "{wire:?}");
        assert!(
            wire.fields
                .iter()
                .any(|(k, v)| k == "Stream" && v == "checkout"),
            "{wire:?}"
        );
        assert!(
            wire.links.iter().all(|(_, url)| url != &ctx.alert_url),
            "the alert link is Open in OpenObserve, not a template button"
        );
        assert_eq!(wire.open_url, ctx.alert_url);
        assert_eq!(wire.title, "[firing] checkout-errors");
        assert_eq!(wire.body, "*Status:* firing");
        let plain = wire_from_custom("disk full on db-1", &ctx);
        assert_eq!(plain.title, "checkout-errors");
        assert_eq!(plain.body, "disk full on db-1");
        let built_in = config::prebuilt_loader::get_prebuilt_template("slack").expect("built in");
        let wire = wire_from_custom(&apply_custom_template(&built_in.body, &ctx, false), &ctx);
        assert!(wire.title.contains("checkout-errors"), "{wire:?}");
        assert_ne!(
            wire.body, wire.title,
            "the text is not repeated as the body"
        );
    }

    #[test]
    fn a_content_template_body_becomes_mrkdwn_and_the_alert_link_becomes_open() {
        let ctx = ctx();
        let content = RenderedContent {
            title: "Errors on checkout".into(),
            body_markdown: "**6.8%** of requests failed".into(),
            fields: vec![("env".into(), "prod".into())],
            links: vec![
                ("Dashboard".into(), "https://o2.test/d/1".into()),
                (String::new(), ctx.alert_url.clone()),
            ],
            rows: vec![],
            row_lines: Some(vec!["host=web-1".into()]),
            severity: None,
            unknown_variables: vec![],
        };
        let wire = wire_from_content(&content, &ctx);
        assert_eq!(wire.body, "*6.8%* of requests failed\nhost=web-1");
        assert_eq!(
            wire.links,
            vec![("Dashboard".to_string(), "https://o2.test/d/1".to_string())]
        );
        assert_eq!(wire.open_url, ctx.alert_url);
    }

    #[test]
    fn an_oversized_wire_is_trimmed_under_the_content_cap() {
        let wire = RenderedWire {
            title: "t".repeat(400),
            body: "é".repeat(40_000),
            fields: (0..200)
                .map(|i| (format!("k{i}"), "v".repeat(100)))
                .collect(),
            links: (0..50)
                .map(|i| (format!("l{i}"), format!("https://o2.test/{i}")))
                .collect(),
            open_url: "https://o2.test/a".into(),
        };
        let fitted = fit_wire(wire);
        assert!(serde_json::to_vec(&fitted).unwrap().len() <= MAX_CONTENT_BYTES);
        assert_eq!(fitted.open_url, "https://o2.test/a");
        let small = RenderedWire {
            title: "ok".into(),
            ..Default::default()
        };
        assert_eq!(fit_wire(small.clone()), small);
    }

    #[test]
    fn a_chart_over_512_kb_is_dropped_and_a_small_one_rides_only_on_fire_and_level_up() {
        let small = vec![1u8; 1024];
        let big = vec![1u8; MAX_CHART_PNG_BYTES + 1];
        let fire = target(AlertSlackEventKind::Fire, 1);
        let with = build_event(
            &fire,
            AlertLevel::Critical,
            RenderedWire::default(),
            Some(&small),
            1,
        );
        assert!(with.chart_png_b64.is_some());
        let dropped = build_event(
            &fire,
            AlertLevel::Critical,
            RenderedWire::default(),
            Some(&big),
            1,
        );
        assert!(dropped.chart_png_b64.is_none());
        let repeat = target(AlertSlackEventKind::Repeat, 1);
        let none = build_event(
            &repeat,
            AlertLevel::Critical,
            RenderedWire::default(),
            Some(&small),
            1,
        );
        assert!(none.chart_png_b64.is_none());
    }

    #[test]
    fn the_kind_hint_follows_the_message_row_and_the_level() {
        let firing = |prior| FiringRef {
            group_key: String::new(),
            firing_started_at: 1,
            prior,
        };
        let crit = Some(AlertLevel::Critical);
        let warn = Some(AlertLevel::Warning);
        assert_eq!(firing(warn).kind(false, crit), AlertSlackEventKind::Fire);
        assert_eq!(firing(warn).kind(true, crit), AlertSlackEventKind::LevelUp);
        assert_eq!(firing(crit).kind(true, crit), AlertSlackEventKind::Repeat);
        assert_eq!(firing(crit).kind(true, warn), AlertSlackEventKind::Repeat);
        assert_eq!(firing(None).kind(true, crit), AlertSlackEventKind::Repeat);
    }

    #[test]
    fn a_new_single_row_firing_gets_one_start_until_its_commit_takes_it() {
        let id = "a0fake-predicted";
        let (first, _) = firing_start(id, false, None, 1_000).unwrap();
        let (second, _) = firing_start(id, false, None, 2_000).unwrap();
        assert_eq!(first, 1_000);
        assert_eq!(second, 1_000, "every destination and a retry share it");
        assert_eq!(take_pending_start(id, 3_000), Some(1_000));
        assert_eq!(take_pending_start(id, 3_000), None, "taken once");
        let mut state = AlertState::empty(id, ROLLUP_GROUP_KEY);
        state.firing_started_at = Some(500);
        state.level = Some(AlertLevel::Warning);
        assert_eq!(
            firing_start(id, false, Some(&state), 9_000),
            Some((500, Some(AlertLevel::Warning))),
            "a persisted start wins"
        );
        assert_eq!(take_pending_start(id, 9_000), None);
        assert_eq!(
            firing_start("g", true, None, 9_000),
            None,
            "a group is never guessed"
        );
        let stale = PENDING_START_TTL_MICROS + 10_000;
        firing_start(id, false, None, 1);
        assert_eq!(firing_start(id, false, None, stale).unwrap().0, stale);
        assert_eq!(
            take_pending_start(id, stale + PENDING_START_TTL_MICROS + 1),
            None
        );
    }

    #[test]
    fn an_incident_notification_posts_its_rendered_template() {
        let template = Template {
            body: "{alert_name} opened an incident".to_string(),
            ..Default::default()
        };
        let event = templated_post_event("acme", "dest-1", &template, &ctx(), 5).unwrap();
        assert_eq!(event.kind, AlertSlackEventKind::Post);
        assert_eq!(event.destination_id, "dest-1");
        assert_eq!(
            event.rendered.map(|r| r.body).as_deref(),
            Some("checkout-errors opened an incident")
        );
    }

    #[tokio::test]
    async fn a_failed_publish_is_a_failed_send_and_a_good_one_is_keyed() {
        let down = Recorder {
            down: true,
            ..Default::default()
        };
        let e = event(&target(AlertSlackEventKind::Fire, 1));
        let err = publish_unchecked(&down, &e).await.unwrap_err();
        assert!(err.to_string().contains("TopicNotFound"), "{err}");
        let up = Recorder::default();
        publish_unchecked(&up, &e).await.unwrap();
        let sent = up.sent.lock().unwrap();
        assert_eq!(sent[0].0, event_id(&e));
        assert_eq!(sent[0].1, e);
    }

    #[tokio::test]
    async fn where_slack_cannot_run_a_send_fails_with_the_reason_and_publishes_nothing() {
        let rec = Recorder::default();
        let e = event(&target(AlertSlackEventKind::Fire, 1));
        let err = publish(&rec, &e).await.unwrap_err().to_string();
        assert!(
            err == "Slack app needs Enterprise" || err == "Slack is turned off on this deployment",
            "{err}"
        );
        assert!(rec.sent.lock().unwrap().is_empty());
    }
}
