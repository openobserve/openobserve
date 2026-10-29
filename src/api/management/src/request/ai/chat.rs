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

//! AI chat handlers: legacy `PromptRequest`s forwarded to the o2-ai agent service.

use axum::{
    Json,
    body::Body,
    extract::{FromRequestParts, Path},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use bytes::Bytes;
#[cfg(feature = "enterprise")]
use config::meta::oncall::rca::RcaContext;
use openobserve_api_common::{
    X_O2_ASSISTANT_SESSION_ID, X_O2_ASSISTANT_TURN_ID, extractors::Headers,
};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use serde_json::Value;
#[cfg(feature = "enterprise")]
use {
    futures::StreamExt,
    infra::table::ai_approvals,
    o2_enterprise::enterprise::{
        ai::{
            agent::meta::Role,
            chat::{
                OwnerCancel, PersistSettings, TurnCaps, TurnEnd, TurnIdentity, TurnSpec, spawn_turn,
            },
            client::{
                DEFAULT_AGENT_TYPE, ImageAttachment, QueryRequest, RCA_AGENT_TYPE,
                SESSION_OWNER_UNAVAILABLE, SRE_CHAT_AGENT_TYPE, TurnPolicy, get_agent_client,
                is_agent_unreachable, is_session_owner_unavailable, upstream_error_code,
                upstream_error_status, upstream_retry_after,
            },
        },
        common::{
            auditor::{AuditMessage, DelegatedAudit, Protocol, ResponseMeta},
            config::{Ai, get_config as get_o2_config},
        },
    },
    openobserve_api_common::auth::delegation::DelegatedCaller,
    std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use super::error::{self, AiErrorAction, AiErrorCode, AiErrorEnvelope};
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::ai::{Attachment, ChatMode, PromptRequest, PromptResponse},
};

/// Context flag telling o2-ai that `history` is a fork's or an import's transcript, not new turns.
#[cfg(any(feature = "enterprise", test))]
const FORK_SEED_CONTEXT_KEY: &str = "o2_fork_seed";
// Set only by the server, like the fork seed: o2-ai answers it from the history before that turn.
#[cfg(feature = "enterprise")]
const REPLACES_TURN_CONTEXT_KEY: &str = "o2_replaces_turn_id";
#[cfg(feature = "enterprise")]
const NOT_STORED_DISABLED: &str = "history_disabled";
#[cfg(feature = "enterprise")]
const NOT_STORED_NO_VOTE: &str = "not_a_vote";
#[cfg(feature = "enterprise")]
const NOT_STORED_NO_SESSION: &str = "no_session";
#[cfg(feature = "enterprise")]
const NOT_STORED_UNKNOWN_TURN: &str = "unknown_turn";
#[cfg(feature = "enterprise")]
const NOT_STORED_UNAVAILABLE: &str = "unavailable";
#[cfg(any(feature = "enterprise", test))]
const MAX_DECISION_ITEMS: usize = 32;
#[cfg(any(feature = "enterprise", test))]
const MAX_DECISION_ITEMS_BYTES: usize = 4096;
/// How long a cancel waits for o2-ai before stopping the turn on this node.
#[cfg(feature = "enterprise")]
const UPSTREAM_CANCEL_WAIT: std::time::Duration = std::time::Duration::from_secs(5);
/// How long a turn may keep settling after o2-ai accepted its abort.
#[cfg(feature = "enterprise")]
const CANCEL_GRACE: std::time::Duration = std::time::Duration::from_secs(15);

// Above o2-ai's longest approved apply (`O2_CONFIRM_APPLY_TIMEOUT`, at most 50 s) plus a margin.
#[cfg(feature = "enterprise")]
const CONFIRM_RELAY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

#[cfg(any(feature = "enterprise", test))]
const APPROVAL_RESOLVED: &str = "approval_resolved";
#[cfg(any(feature = "enterprise", test))]
const CONFIRM_REFUSAL_KEYS: [&str; 7] = [
    "id",
    "resolved_by",
    "at",
    "approved",
    "withdrawn",
    "pending_id",
    "extends",
];

#[cfg(any(feature = "enterprise", test))]
const CONFIRM_SCOPES: [&str; 3] = ["once", "chat", "always"];
// Older clients name the card `approval_id` or `call_id`; the relay forwards it as `id`.
#[cfg(any(feature = "enterprise", test))]
const CONFIRM_ID_KEYS: [&str; 3] = ["id", "approval_id", "call_id"];
// With o2-ai's health unknown, a turn waits this long at most for a replacement owner.
#[cfg(feature = "enterprise")]
const UNKNOWN_HEALTH_OWNER_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(feature = "enterprise")]
const RCA_MODE_REFUSED: &str = "mode \"rca\" is only accepted by the incident analysis route";

/// The RCA agent's context contract (`RcaContext`, `is_reanalysis`); o2-ai routes on key presence.
#[cfg(feature = "enterprise")]
const RCA_CONTEXT_KEYS: [&str; 10] = [
    "subject_type",
    "subject_id",
    "incident_id",
    "previous_analysis",
    "severity",
    "past_causes",
    "alert_name",
    "stream",
    "dimensions",
    "is_reanalysis",
];

/// Client keys an RCA chat keeps: display fields, timezone, locale and the door; never RCA inputs.
#[cfg(feature = "enterprise")]
const RCA_CHAT_CLIENT_KEYS: [&str; 10] = [
    "client",
    "locale",
    "incident_title",
    "incident_status",
    "incident_severity",
    "alert_count",
    "first_alert_at",
    "last_alert_at",
    "request_timestamp",
    "user_timezone",
];

/// Set by the Slack bridge as `<team>:<channel>:<event_id>`; trusted only on a delegated call.
pub const SLACK_EVENT_HEADER: &str = "x-o2-slack-event";
const SLACK_REDACTED: &str = "[REDACTED: slack]";
/// o2-ai refuses `confirm_timeout_secs` outside 1..=600 with a 422.
#[cfg(feature = "enterprise")]
const MAX_CONFIRM_TIMEOUT_SECS: u32 = 600;

/// Frames that only report progress; any other non-terminal frame shows the user something.
#[cfg(feature = "enterprise")]
const BOOKKEEPING_FRAMES: [&str; 9] = [
    "status",
    "title",
    "usage",
    "turn_started",
    "retrying",
    "compacting",
    "sync",
    "sync_state",
    "ping",
];
/// Frames after which a turn sends nothing; one before any content refunds the turn.
#[cfg(feature = "enterprise")]
const FINAL_FRAMES: [&str; 2] = ["complete", "cancelled"];
#[cfg(feature = "enterprise")]
const AUDIT_BODY_MAX_BYTES: usize = 8 << 10;
#[cfg(feature = "enterprise")]
const AUDIT_KEY_MAX_CHARS: usize = 64;
/// A line longer than this is passed on in pieces, classified by its head, not buffered further.
#[cfg(feature = "enterprise")]
const SSE_LINE_MAX_BYTES: usize = 4 << 20;
/// A `complete` frame carries the whole history, so it is held this far to add its credits.
#[cfg(feature = "enterprise")]
const SSE_COMPLETE_MAX_BYTES: usize = 64 << 20;
/// How much of an oversized line is read for its `type`.
#[cfg(feature = "enterprise")]
const SSE_HEAD_BYTES: usize = 1 << 10;
/// Bytes a persisted turn may queue for a slow browser before the browser is dropped.
#[cfg(feature = "enterprise")]
const BROWSER_MAX_PENDING_BYTES: usize = 8 << 20;

/// Where a turn stands on its credit as its frames go by.
#[cfg(feature = "enterprise")]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct TurnPhase {
    /// The credit is held and has not been refunded.
    charged: bool,
    content: bool,
}

#[cfg(feature = "enterprise")]
impl TurnPhase {
    /// A turn whose credit was taken before its stream was read.
    fn charged() -> Self {
        Self {
            charged: true,
            content: false,
        }
    }

    /// What one forwarded frame means for the charge; content is never forwarded uncharged.
    fn observe(&mut self, frame_type: &str) -> ChargeStep {
        if FINAL_FRAMES.contains(&frame_type) {
            return self.end();
        }
        // An error may still be followed by content, so only the final frame decides a refund.
        if self.content || frame_type == "error" || BOOKKEEPING_FRAMES.contains(&frame_type) {
            return ChargeStep::Nothing;
        }
        self.content = true;
        if self.charged {
            return ChargeStep::Settle;
        }
        self.charged = true;
        ChargeStep::ChargeAndSettle
    }

    /// The turn ended; one that never showed content gives its credit back.
    fn end(&mut self) -> ChargeStep {
        if self.charged && !self.content {
            self.charged = false;
            return ChargeStep::Refund;
        }
        ChargeStep::Nothing
    }
}

#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChargeStep {
    Nothing,
    /// Content arrived on a turn whose credit was refunded or never taken.
    ChargeAndSettle,
    Settle,
    Refund,
}

/// Splits an SSE byte stream into whole lines, so `data:` frames can be read and rewritten.
#[cfg(feature = "enterprise")]
#[derive(Debug, Default)]
struct SseLines {
    partial: Vec<u8>,
    /// The current line is over the cap and is being passed on piece by piece.
    passing: bool,
}

#[cfg(feature = "enterprise")]
impl SseLines {
    fn push(&mut self, chunk: &[u8]) -> Vec<SseLine> {
        let mut lines = Vec::new();
        let mut rest = chunk;
        while let Some(at) = rest.iter().position(|b| *b == b'\n') {
            let (line, tail) = rest.split_at(at + 1);
            if self.passing {
                self.passing = false;
                lines.push(SseLine::Piece {
                    bytes: Bytes::copy_from_slice(line),
                    head_type: None,
                });
            } else if self.partial.is_empty() {
                lines.push(SseLine::Whole(Bytes::copy_from_slice(line)));
            } else {
                self.partial.extend_from_slice(line);
                lines.push(SseLine::Whole(Bytes::from(std::mem::take(
                    &mut self.partial,
                ))));
            }
            rest = tail;
        }
        if self.passing {
            if !rest.is_empty() {
                lines.push(SseLine::Piece {
                    bytes: Bytes::copy_from_slice(rest),
                    head_type: None,
                });
            }
            return lines;
        }
        self.partial.extend_from_slice(rest);
        if self.partial.len() > SSE_LINE_MAX_BYTES {
            let head_type = head_frame_type(&self.partial);
            if head_type != "complete" || self.partial.len() > SSE_COMPLETE_MAX_BYTES {
                self.passing = true;
                lines.push(SseLine::Piece {
                    bytes: Bytes::from(std::mem::take(&mut self.partial)),
                    head_type: Some(head_type),
                });
            }
        }
        lines
    }

    /// An unterminated last line, closed so the browser's parser does not join it to the next.
    fn take_partial(&mut self) -> Option<Bytes> {
        if std::mem::take(&mut self.passing) {
            return Some(Bytes::from_static(b"\n\n"));
        }
        if self.partial.is_empty() {
            return None;
        }
        let mut line = std::mem::take(&mut self.partial);
        line.extend_from_slice(b"\n\n");
        Some(Bytes::from(line))
    }
}

/// What [`SseLines`] hands the meter.
#[cfg(feature = "enterprise")]
#[derive(Debug, PartialEq, Eq)]
enum SseLine {
    /// A whole line, newline included.
    Whole(Bytes),
    /// Part of an oversized line; its first piece carries the `type` read from the line's head.
    Piece {
        bytes: Bytes,
        head_type: Option<String>,
    },
}

/// Which turn a Stop goes to, decided by [`stop_target`] and [`direct_stop_target`].
#[cfg(feature = "enterprise")]
#[derive(Debug, PartialEq, Eq)]
enum StopTarget {
    Turn(String),
    /// Not known here; o2-ai routes it to the stream and checks the caller owns it.
    Elsewhere,
    /// Nothing the caller named runs.
    Nothing,
}

/// What a Stop answers, decided by [`cancel_reply`].
#[cfg(feature = "enterprise")]
#[derive(Debug, PartialEq, Eq)]
enum CancelReply {
    Body {
        cancelled: bool,
        owner_reached: bool,
    },
    /// o2-ai's refusal, kept typed.
    Relay,
    Failed,
}

/// A `/confirm` o2-ai accepted, as the relay records it.
#[cfg(feature = "enterprise")]
#[derive(Clone, Copy)]
struct Answered<'a> {
    org_id: &'a str,
    session_id: &'a str,
    caller: &'a str,
    request: &'a [u8],
    stored: Option<&'a ai_approvals::Model>,
}

/// One turn's credit: who pays, under which id it is refunded, and what it cost.
#[cfg(feature = "enterprise")]
struct TurnCharge {
    org_id: String,
    #[cfg(feature = "cloud")]
    user_id: String,
    #[cfg(feature = "cloud")]
    turn_id: String,
    #[cfg(feature = "cloud")]
    usage_ctx: openobserve_core::trial_quota::AiUsageContext,
    /// The charge taken and neither settled nor refunded yet.
    #[cfg(feature = "cloud")]
    held: Option<u64>,
    credits: u64,
}

#[cfg(feature = "enterprise")]
impl TurnCharge {
    #[cfg_attr(not(feature = "cloud"), allow(unused_variables))]
    fn new(
        org_id: &str,
        user_id: &str,
        trace_id: &str,
        session_id: Option<&str>,
        turn_id: &str,
    ) -> Self {
        Self {
            org_id: org_id.to_string(),
            #[cfg(feature = "cloud")]
            user_id: user_id.to_string(),
            #[cfg(feature = "cloud")]
            turn_id: turn_id.to_string(),
            #[cfg(feature = "cloud")]
            usage_ctx: openobserve_core::trial_quota::AiUsageContext {
                user_email: user_id.to_string(),
                trace_id: Some(trace_id.to_string()),
                session_id: session_id.map(str::to_string),
                incident_id: None,
            },
            #[cfg(feature = "cloud")]
            held: None,
            credits: 0,
        }
    }

    /// Takes the turn's credit; without metering the turn costs nothing.
    async fn charge(&mut self) -> Result<(), AiErrorEnvelope> {
        #[cfg(feature = "cloud")]
        {
            use openobserve_core::trial_quota::{TrialQuotaFeature, authorize_ai_turn};
            let feature = TrialQuotaFeature::AiChat;
            let permit = authorize_ai_turn(&self.org_id, feature, &self.usage_ctx, &self.turn_id)
                .await
                .map_err(post_upstream_authorization_error)?;
            self.held = permit.charge_id();
            self.credits = feature.cost();
        }
        Ok(())
    }

    fn settle(&mut self) {
        #[cfg(feature = "cloud")]
        if let Some(charge_id) = self.held.take() {
            openobserve_core::trial_quota::settle_ai_turn(&self.org_id, &self.turn_id, charge_id);
        }
    }

    async fn refund(&mut self) {
        #[cfg(feature = "cloud")]
        if let Some(charge_id) = self.held.take() {
            openobserve_core::trial_quota::refund_ai_usage(
                &self.org_id,
                &self.user_id,
                &self.turn_id,
                charge_id,
            )
            .await;
        }
        self.credits = 0;
    }
}

/// Dropped still held means no content was shown (the browser left first), so it is refunded.
#[cfg(feature = "cloud")]
impl Drop for TurnCharge {
    fn drop(&mut self) {
        let Some(charge_id) = self.held.take() else {
            return;
        };
        let (org_id, user_id, turn_id) = (
            std::mem::take(&mut self.org_id),
            std::mem::take(&mut self.user_id),
            std::mem::take(&mut self.turn_id),
        );
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            log::warn!("[AI-CHAT] no runtime to refund turn {turn_id}; its charge stands");
            openobserve_core::trial_quota::settle_ai_turn(&org_id, &turn_id, charge_id);
            return;
        };
        handle.spawn(async move {
            openobserve_core::trial_quota::refund_ai_usage(&org_id, &user_id, &turn_id, charge_id)
                .await;
        });
    }
}

/// What the audit trail keeps of a chat request: who, which chat and how much, never content.
#[cfg(feature = "enterprise")]
#[derive(Debug, Clone)]
struct TurnAudit {
    /// The route as it appears after `/api/{org_id}/ai/`.
    route: &'static str,
    org_id: String,
    user_id: String,
    trace_id: String,
    session_id: Option<String>,
    turn_id: Option<String>,
    message_count: usize,
    image_count: usize,
    bytes: usize,
    context_keys: Vec<String>,
    protocol: Protocol,
    /// The Slack link and token of a delegated call.
    delegated: Option<DelegatedAudit>,
    /// The Slack message a delegated turn answers.
    slack_event: Option<String>,
}

#[cfg(feature = "enterprise")]
impl TurnAudit {
    fn new(
        org_id: &str,
        user_id: &str,
        trace_id: &str,
        session_id: Option<&str>,
        turn_id: Option<&str>,
        prompt: Option<&PromptRequest>,
        bytes: usize,
    ) -> Self {
        Self {
            route: "chat_stream",
            org_id: org_id.to_string(),
            user_id: user_id.to_string(),
            trace_id: trace_id.to_string(),
            session_id: session_id.map(str::to_string),
            turn_id: turn_id.map(|id| id.chars().take(AUDIT_KEY_MAX_CHARS).collect()),
            message_count: prompt.map_or(0, |p| p.messages.len()),
            image_count: prompt.and_then(|p| p.images.as_ref()).map_or(0, Vec::len),
            bytes,
            context_keys: prompt
                .map(|p| {
                    p.context
                        .keys()
                        .map(|key| key.chars().take(AUDIT_KEY_MAX_CHARS).collect())
                        .collect()
                })
                .unwrap_or_default(),
            protocol: Protocol::Http,
            delegated: None,
            slack_event: None,
        }
    }

    fn on_route(mut self, route: &'static str) -> Self {
        self.route = route;
        self
    }

    /// A Slack bridge call; the event header is trusted only on a delegated call.
    fn delegated_by(
        mut self,
        caller: Option<&DelegatedCaller>,
        headers: &axum::http::HeaderMap,
    ) -> Self {
        let Some(caller) = caller else {
            return self;
        };
        self.protocol = Protocol::Slack;
        self.delegated = Some(DelegatedAudit {
            link_id: caller.link_id.clone(),
            jti: caller.jti.clone(),
        });
        self.slack_event = headers
            .get(SLACK_EVENT_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|event| event.chars().take(AUDIT_KEY_MAX_CHARS).collect());
        self
    }

    /// The record of a finished request; a refusal is named by its status only.
    async fn report_status(&self, status: StatusCode) {
        let failure = (!status.is_success()).then(|| status.canonical_reason().unwrap_or("failed"));
        self.report(status, failure).await;
    }

    /// The record as stored, at most [`AUDIT_BODY_MAX_BYTES`]: context keys are cut to fit.
    fn body(&self) -> String {
        let mut record = serde_json::json!({
            "org": self.org_id,
            "user": self.user_id,
            "session_id": self.session_id,
            "turn_id": self.turn_id,
            "message_count": self.message_count,
            "image_count": self.image_count,
            "bytes": self.bytes,
            "context_keys": [],
        });
        if let Some(event) = &self.slack_event {
            record["slack_event"] = event.as_str().into();
        }
        let mut size = record.to_string().len();
        let mut kept = Vec::new();
        for key in &self.context_keys {
            // A key costs its quotes and comma on top of its own bytes.
            size += serde_json::Value::from(key.as_str()).to_string().len() + 1;
            if size > AUDIT_BODY_MAX_BYTES {
                break;
            }
            kept.push(key.as_str());
        }
        record["context_keys"] = kept.into();
        let text = record.to_string();
        if text.len() <= AUDIT_BODY_MAX_BYTES {
            return text;
        }
        // Identity fields alone over the cap: keep the size; org and user are audit columns.
        serde_json::json!({"bytes": self.bytes, "truncated": true}).to_string()
    }

    /// Built here, not by `report_with_protocol`, which has no `delegated` parameter.
    fn message(&self, status: StatusCode, error_message: Option<&str>) -> AuditMessage {
        AuditMessage {
            user_email: self.user_id.clone(),
            org_id: self.org_id.clone(),
            _timestamp: config::utils::time::now_micros(),
            protocol: self.protocol.clone(),
            response_meta: ResponseMeta {
                http_method: "POST".to_string(),
                http_path: format!("/api/{}/ai/{}", self.org_id, self.route),
                http_query_params: String::new(),
                http_body: self.body(),
                http_response_code: status.as_u16(),
                error_msg: error_message.map(str::to_string),
                trace_id: Some(self.trace_id.clone()),
            },
            delegated: self.delegated.clone(),
        }
    }

    async fn report(&self, status: StatusCode, error_message: Option<&str>) {
        if get_o2_config().common.audit_enabled {
            audit::audit(self.message(status, error_message)).await;
        }
    }
}

/// One `chat_stream` turn, ready to go to o2-ai with or without persistence.
#[cfg(feature = "enterprise")]
struct StreamTurn {
    org_id: String,
    user_id: String,
    trace_id: String,
    /// The browser's `x-o2-assistant-turn-id`, unvalidated.
    turn_id: Option<String>,
    /// The stored turn this one regenerates or edits, unvalidated.
    replaces_turn_id: Option<String>,
    agent_type: &'static str,
    query: QueryRequest,
    auth: String,
    /// The browser login that sent the turn, so signing it out stops the turn.
    auth_session_id: Option<String>,
    forward_headers: Option<std::collections::HashMap<String, String>>,
    client: Arc<o2_enterprise::enterprise::ai::client::AiAgentClient>,
    span: Option<opentelemetry::Context>,
    audit: TurnAudit,
}

/// Meters one turn's SSE stream and gives its `error` and `complete` frames the envelope keys.
#[cfg(feature = "enterprise")]
struct TurnMeter {
    phase: TurnPhase,
    lines: SseLines,
    charge: TurnCharge,
    /// `(session_id, turn_id)` of a persisted turn, whose first event is stamped on its record.
    record: Option<(String, String)>,
    first_event: bool,
    refused: bool,
}

#[cfg(feature = "enterprise")]
impl TurnMeter {
    fn new(phase: TurnPhase, charge: TurnCharge, record: Option<(String, String)>) -> Self {
        Self {
            phase,
            lines: SseLines::default(),
            charge,
            record,
            first_event: false,
            refused: false,
        }
    }

    /// The bytes to forward for `chunk`; nothing once the turn's charge was refused.
    async fn feed(&mut self, chunk: &[u8]) -> Vec<Bytes> {
        let mut out = Vec::new();
        for line in self.lines.push(chunk) {
            if self.refused {
                break;
            }
            match line {
                SseLine::Whole(line) => out.push(self.on_line(line).await),
                SseLine::Piece { bytes, head_type } => {
                    if let Some(frame_type) = head_type
                        && let Err(refusal) = self.observe(&frame_type).await
                    {
                        self.refused = true;
                        out.push(refusal.to_sse_frame());
                        break;
                    }
                    out.push(bytes);
                }
            }
        }
        out
    }

    /// Ends a stream the transport broke: the partial line, then `frame`.
    async fn interrupt(&mut self, frame: Bytes) -> Vec<Bytes> {
        let mut out: Vec<Bytes> = self.lines.take_partial().into_iter().collect();
        out.extend(self.feed(&frame).await);
        out
    }

    async fn finish(&mut self) -> Vec<Bytes> {
        let out = self.lines.take_partial().into_iter().collect();
        if self.phase.end() == ChargeStep::Refund {
            self.charge.refund().await;
        }
        out
    }

    fn refused(&self) -> bool {
        self.refused
    }

    async fn on_line(&mut self, line: Bytes) -> Bytes {
        let Some(mut frame) = data_frame(&line) else {
            return line;
        };
        let frame_type = frame
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if let Err(refusal) = self.observe(&frame_type).await {
            self.refused = true;
            return refusal.to_sse_frame();
        }
        match frame_type.as_str() {
            "error" => error::normalize_error_frame(&mut frame),
            "complete" => {
                let usage = frame
                    .entry("usage")
                    .or_insert_with(|| Value::Object(Default::default()));
                if let Some(usage) = usage.as_object_mut() {
                    usage.insert("credits".into(), self.charge.credits.into());
                }
            }
            _ => return line,
        }
        Bytes::from(format!("data: {}\n", Value::Object(frame)))
    }

    /// Charges, settles or refunds for one frame, and stamps o2-ai's first event.
    async fn observe(&mut self, frame_type: &str) -> Result<(), AiErrorEnvelope> {
        // Error and final frames may be this node's own; o2-ai's first event is anything else.
        if !self.first_event && frame_type != "error" && !FINAL_FRAMES.contains(&frame_type) {
            self.first_event = true;
            self.stamp_first_event();
        }
        let step = self.phase.observe(frame_type);
        self.apply(step).await
    }

    async fn apply(&mut self, step: ChargeStep) -> Result<(), AiErrorEnvelope> {
        match step {
            ChargeStep::Nothing => {}
            ChargeStep::ChargeAndSettle => {
                self.charge.charge().await?;
                self.charge.settle();
            }
            ChargeStep::Settle => self.charge.settle(),
            ChargeStep::Refund => self.charge.refund().await,
        }
        Ok(())
    }

    fn stamp_first_event(&self) {
        let Some((session_id, turn_id)) = self.record.clone() else {
            return;
        };
        let org_id = self.charge.org_id.clone();
        let at = config::utils::time::now_micros();
        tokio::spawn(async move {
            if let Err(e) =
                infra::table::ai_chat_turns::set_first_event_at(&org_id, &session_id, &turn_id, at)
                    .await
            {
                log::warn!("[AI-CHAT] cannot stamp the first event of turn {turn_id}: {e}");
            }
        });
    }
}

/// The query helper never runs RCA; an explicit chat turn skips the stored agent, others keep it.
#[cfg(feature = "enterprise")]
async fn turn_agent_and_context(
    org_id: &str,
    user_id: &str,
    session_id: Option<&str>,
    context: serde_json::Value,
    mode: Option<ChatMode>,
) -> (&'static str, serde_json::Value) {
    match mode {
        Some(ChatMode::GenerateQuery) => agent_for_mode(mode, context, None),
        Some(ChatMode::Chat) => {
            let rca = incident_rca_context(org_id, user_id, &context).await;
            agent_for_mode(mode, context, rca)
        }
        _ => session_agent_and_context(org_id, user_id, session_id, context).await,
    }
}

/// The agent a turn runs, given the incident context the caller cleared the RCA bar for.
#[cfg(feature = "enterprise")]
fn agent_for_mode(
    mode: Option<ChatMode>,
    context: serde_json::Value,
    rca: Option<RcaContext>,
) -> (&'static str, serde_json::Value) {
    let rca = rca.filter(|_| mode != Some(ChatMode::GenerateQuery));
    let (agent, context) = select_chat_agent(context, rca);
    // The autonomous prompt writes a report and never answers, so a chat turn gets the sre agent.
    if mode == Some(ChatMode::Chat) && agent == RCA_AGENT_TYPE {
        return (SRE_CHAT_AGENT_TYPE, context);
    }
    (agent, context)
}

/// Picks the agent and its context; RCA only when the caller clears the RCA endpoint's own bar.
#[cfg(feature = "enterprise")]
async fn chat_agent_and_context(
    org_id: &str,
    user_id: &str,
    context: serde_json::Value,
) -> (&'static str, serde_json::Value) {
    let rca = incident_rca_context(org_id, user_id, &context).await;
    select_chat_agent(context, rca)
}

/// The incident's RCA context, only when the caller clears the RCA endpoint's own bar.
#[cfg(feature = "enterprise")]
async fn incident_rca_context(
    org_id: &str,
    user_id: &str,
    context: &serde_json::Value,
) -> Option<RcaContext> {
    let incident_id = context.get("incident_id").and_then(|v| v.as_str())?;
    if !can_run_incident_rca(org_id, user_id, incident_id).await {
        return None;
    }
    Some(
        o2_enterprise::enterprise::alerts::rca_service::build_incident_context(
            org_id,
            incident_id,
            None,
        )
        .await,
    )
}

/// An existing chat keeps its stored agent, so an Ask chat reopened over an incident never becomes
/// an RCA run.
#[cfg(feature = "enterprise")]
async fn session_agent_and_context(
    org_id: &str,
    user_id: &str,
    session_id: Option<&str>,
    context: serde_json::Value,
) -> (&'static str, serde_json::Value) {
    let stored = match session_id.and_then(openobserve_core::ai_chat::admission::normalize_uuid) {
        Some(id) => match infra::table::ai_chat_sessions::get(org_id, &id).await {
            Ok(row) => row.map(|row| row.agent_type),
            Err(e) => {
                log::warn!("[org_id:{org_id}] cannot read the agent of chat {id}: {e}");
                None
            }
        },
        None => None,
    };
    if keeps_default_agent(stored.as_deref()) {
        return select_chat_agent(context, None);
    }
    chat_agent_and_context(org_id, user_id, context).await
}

#[cfg(feature = "enterprise")]
fn keeps_default_agent(stored_agent_type: Option<&str>) -> bool {
    stored_agent_type.is_some_and(|agent| agent != RCA_AGENT_TYPE)
}

/// Matches the RCA endpoint: RCA enabled, incident in this org, and its `POST .../rca` permission.
#[cfg(feature = "enterprise")]
pub(crate) async fn can_run_incident_rca(org_id: &str, user_id: &str, incident_id: &str) -> bool {
    let incidents = &get_o2_config().incidents;
    if !incidents.enabled || !incidents.rca_enabled {
        return false;
    }
    match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return false,
        Err(e) => {
            log::error!("[org_id:{org_id}] failed to load incident for AI chat: {e}");
            return false;
        }
    }
    let Some(route) = incident_rca_route(org_id, incident_id) else {
        return false;
    };
    let Some((object_type, object_id)) = route.o2_type.split_once(':') else {
        return false;
    };
    openobserve_core::auth::check_permissions(
        object_id,
        &route.org_id,
        user_id,
        object_type,
        &route.method,
        Some(&route.parent_id),
        route.use_all_org,
        route.use_self_context,
        route.use_self_parent,
    )
    .await
}

#[cfg(feature = "enterprise")]
fn incident_rca_route(
    org_id: &str,
    incident_id: &str,
) -> Option<o2_openfga::meta::route_permissions::ResolvedRoute> {
    let path = ["v2", org_id, "alerts", "incidents", incident_id, "rca"];
    o2_openfga::meta::route_permissions::resolve_permission(&path, "POST", org_id, "", None)
}

/// RCA gets the server-built incident context plus display fields; other agents get no RCA keys.
#[cfg(feature = "enterprise")]
fn select_chat_agent(
    mut context: serde_json::Value,
    rca: Option<RcaContext>,
) -> (&'static str, serde_json::Value) {
    let Some(rca) = rca else {
        if let Some(obj) = context.as_object_mut() {
            for key in RCA_CONTEXT_KEYS {
                obj.remove(key);
            }
        }
        return (DEFAULT_AGENT_TYPE, context);
    };
    let mut rca_context = serde_json::to_value(rca).expect("RcaContext is plain data");
    if let (Some(obj), Some(client)) = (rca_context.as_object_mut(), context.as_object()) {
        for key in RCA_CHAT_CLIENT_KEYS {
            if let Some(value) = client.get(key) {
                obj.insert(key.to_string(), value.clone());
            }
        }
    }
    (RCA_AGENT_TYPE, rca_context)
}

/// The agent context: the path org, plus a fork seed only when the Slack bridge sent it.
#[cfg(feature = "enterprise")]
fn agent_context(
    context: &serde_json::Map<String, serde_json::Value>,
    org_id: &str,
    delegated: bool,
) -> serde_json::Value {
    let mut context = serde_json::Value::Object(context.clone());
    if let Some(obj) = context.as_object_mut() {
        obj.insert("org_id".to_string(), org_id.into());
        // Only the server sets the regenerated turn, from `replaces_turn_id`.
        obj.remove(REPLACES_TURN_CONTEXT_KEY);
        if !delegated {
            obj.remove(FORK_SEED_CONTEXT_KEY);
        }
    }
    context
}

#[cfg(feature = "enterprise")]
fn confirm_timeout(requested: Option<u32>) -> Option<u32> {
    requested
        .filter(|secs| *secs > 0)
        .map(|secs| secs.min(MAX_CONFIRM_TIMEOUT_SECS))
}

/// The typed chips o2-ai reads, already capped by `PromptRequest`.
#[cfg(feature = "enterprise")]
fn forwarded_attachments(
    attachments: Option<Vec<Attachment>>,
) -> Option<Vec<o2_enterprise::enterprise::ai::client::Attachment>> {
    attachments
        .filter(|list| !list.is_empty())
        .map(|list| list.into_iter().map(Into::into).collect())
}

/// Whether a turn is admitted and stored; an ephemeral one never is, so it leaves no row.
#[cfg(feature = "enterprise")]
fn persists_turn(persistence_enabled: bool, query: &QueryRequest) -> bool {
    persistence_enabled && !query.ephemeral
}

/// Why a turn's `mode`/`ephemeral` cannot run, or `None`; only the query helper skips storage.
#[cfg(feature = "enterprise")]
fn turn_mode_problem(mode: Option<ChatMode>, ephemeral: bool) -> Option<&'static str> {
    if mode == Some(ChatMode::Unsupported) {
        return Some("Unsupported mode");
    }
    if let Some(problem) = rca_mode_refused(mode) {
        return Some(problem);
    }
    (ephemeral && mode != Some(ChatMode::GenerateQuery))
        .then_some("An ephemeral turn must use mode generate_query")
}

/// The autonomous incident agent runs only from the analysis route, never from a chat turn.
#[cfg(feature = "enterprise")]
fn rca_mode_refused(mode: Option<ChatMode>) -> Option<&'static str> {
    (mode == Some(ChatMode::Rca)).then_some(RCA_MODE_REFUSED)
}

/// The org's tools a turn may carry: the query helper gets no CLI or third-party MCP tools.
#[cfg(feature = "enterprise")]
fn turn_tools<M, C>(mode: Option<ChatMode>, mcps: Vec<M>, clis: Vec<C>) -> (Vec<M>, Vec<C>) {
    if mode == Some(ChatMode::GenerateQuery) {
        return (Vec::new(), Vec::new());
    }
    (mcps, clis)
}

/// Refuses a turn whose mode is unknown, or an ephemeral one that is not a query or names a chat.
#[cfg(feature = "enterprise")]
async fn refuse_turn_mode(
    org_id: &str,
    prompt: &PromptRequest,
    session_id: Option<&str>,
) -> Result<(), Response> {
    if let Some(problem) = turn_mode_problem(prompt.mode, prompt.ephemeral) {
        return Err(error::invalid_request(problem));
    }
    if prompt.ephemeral {
        return refuse_saved_chat(org_id, session_id).await;
    }
    Ok(())
}

/// An ephemeral turn may not continue a saved chat: persistence is decided here, not by the client.
#[cfg(feature = "enterprise")]
async fn refuse_saved_chat(org_id: &str, session_id: Option<&str>) -> Result<(), Response> {
    let Some(session_id) = session_id else {
        return Ok(());
    };
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Ok(());
    }
    let found = infra::table::ai_chat_sessions::get(org_id, session_id)
        .await
        .map(|row| row.is_some());
    saved_chat_refusal(org_id, session_id, found)
}

/// Refuses an ephemeral turn whose session id names a saved chat; an unreadable store fails closed.
#[cfg(feature = "enterprise")]
fn saved_chat_refusal(
    org_id: &str,
    session_id: &str,
    found: Result<bool, impl std::fmt::Display>,
) -> Result<(), Response> {
    match found {
        Ok(false) => Ok(()),
        Ok(true) => Err(error::invalid_request(
            "An ephemeral turn cannot continue a saved chat",
        )),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read chat {org_id}/{session_id}: {e}");
            Err(error::history_unavailable(
                "Chat history is unavailable; please retry",
            ))
        }
    }
}

/// The server's policy replaces whatever `context.policy` the browser sent.
#[cfg(feature = "enterprise")]
fn with_policy(mut query: QueryRequest, policy: &TurnPolicy) -> QueryRequest {
    query.set_policy(policy);
    query
}

/// A hyphenated UUID only: the id lands in outbound URLs and routing keys (a URN would carry `:`).
fn is_valid_session_id(val: &str) -> bool {
    val.len() == 36 && uuid::Uuid::try_parse(val).is_ok()
}

/// Whether a `/confirm` body is an explicit decline (`approved: false`); anything else may approve.
#[cfg(any(feature = "enterprise", test))]
fn declines(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .is_ok_and(|body| body.get("approved") == Some(&Value::Bool(false)))
}

/// The body o2-ai gets: `org_id` is the authorized path org, `approved` true only for JSON `true`.
#[cfg(any(feature = "enterprise", test))]
fn bind_confirm_body_to_org(body: &[u8], org_id: &str) -> Option<Value> {
    let mut value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let object = value.as_object_mut()?;
    let approved = object.get("approved") == Some(&Value::Bool(true));
    object.insert("approved".to_string(), Value::Bool(approved));
    object.insert("org_id".to_string(), serde_json::Value::from(org_id));
    // The card the browser answers is relayed as `approval_record`, never taken from the body.
    object.remove("approval_record");
    object.remove("policy");
    if let Some(id) = confirm_id(&Value::Object(object.clone())) {
        object.insert("id".to_string(), Value::from(id));
    }
    Some(value)
}

/// The stored expiry (microseconds) and card frame after o2-ai's `{expires_at}` (ms) extension.
#[cfg(any(feature = "enterprise", test))]
fn extended_card(card: &str, answer: &Value) -> Option<(i64, String)> {
    let expires_at_ms = answer.get("expires_at")?.as_i64()?;
    let mut card: Value = serde_json::from_str(card).ok()?;
    card.as_object_mut()?
        .insert("expires_at".to_string(), Value::from(expires_at_ms));
    Some((expires_at_ms.saturating_mul(1000), card.to_string()))
}

/// The card a `/confirm` body names, under any of [`CONFIRM_ID_KEYS`].
#[cfg(any(feature = "enterprise", test))]
fn confirm_id(body: &Value) -> Option<String> {
    CONFIRM_ID_KEYS
        .iter()
        .find_map(|key| body.get(*key).and_then(Value::as_str))
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

/// Why a `/confirm` body is malformed: `id`, `scope`, `items`, `reply` and `extend` are typed.
#[cfg(any(feature = "enterprise", test))]
fn confirm_body_problem(body: &[u8]) -> Option<&'static str> {
    let Ok(Value::Object(body)) = serde_json::from_slice::<Value>(body) else {
        return Some("Confirmation body must be a JSON object");
    };
    let is = |key: &str, ok: fn(&Value) -> bool| body.get(key).is_none_or(ok);
    let ids_ok = CONFIRM_ID_KEYS.iter().all(|key| is(key, Value::is_string));
    if !ids_ok || !is("reply", Value::is_string) {
        return Some("id and reply must be strings");
    }
    if !is("extend", Value::is_boolean) {
        return Some("extend must be a boolean");
    }
    if !is("scope", |v| {
        v.as_str().is_some_and(|s| CONFIRM_SCOPES.contains(&s))
    }) {
        return Some("scope must be once, chat or always");
    }
    let items_ok = |v: &Value| v.as_array().is_some_and(|a| a.iter().all(Value::is_string));
    if !is("items", items_ok) {
        return Some("items must be a list of target ids");
    }
    None
}

/// `{id, extend: true}` only asks o2-ai for more time; nothing is decided.
#[cfg(any(feature = "enterprise", test))]
fn extends_only(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .is_ok_and(|body| body.get("extend") == Some(&Value::Bool(true)))
}

/// o2-ai's refusal of a decision keeps its status (404 unknown or expired, 409 decided, 410).
#[cfg(any(feature = "enterprise", test))]
fn confirm_refusal(status: u16, body: &str) -> Response {
    let upstream: Value = serde_json::from_str(body).unwrap_or_default();
    let upstream = match upstream.get("detail") {
        Some(detail) if detail.is_object() => detail.clone(),
        _ => upstream,
    };
    let reason = upstream
        .get("code")
        .and_then(Value::as_str)
        .filter(|c| c.len() <= 40 && c.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'));
    if status == 409 && reason == Some(SESSION_OWNER_UNAVAILABLE) {
        return AiErrorEnvelope::new(
            AiErrorCode::SessionOwnerUnavailable,
            "The assistant replica holding this chat is unavailable; please send it again",
        )
        .with("reason", SESSION_OWNER_UNAVAILABLE)
        .into_response();
    }
    let (code, message) = match status {
        404 => (
            AiErrorCode::NotFound,
            "The confirmation is no longer pending; nothing was changed",
        ),
        409 => (
            AiErrorCode::AlreadySubmitted,
            "The confirmation was already answered, or is not the one waiting",
        ),
        410 => (
            AiErrorCode::TurnExpired,
            "The confirmation has expired; nothing was changed",
        ),
        400 | 422 => (
            AiErrorCode::InvalidRequest,
            "The assistant refused the confirmation body",
        ),
        403 => (
            AiErrorCode::PermissionDenied,
            "This confirmation belongs to another user or organization",
        ),
        _ => {
            return AiErrorEnvelope::new(
                AiErrorCode::ApprovalDeliveryFailed,
                "The confirmation did not reach the assistant; please send it again",
            )
            .into_response();
        }
    };
    let mut envelope = AiErrorEnvelope::new(code, message)
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::CONFLICT));
    if let Some(reason) = reason {
        envelope = envelope.with("reason", reason);
    }
    for key in CONFIRM_REFUSAL_KEYS {
        if let Some(value) = upstream
            .get(key)
            .filter(|v| !v.is_object() && !v.is_array())
        {
            envelope = envelope.with(key, value.clone());
        }
    }
    envelope.into_response()
}

/// Cross-site forms cannot send JSON without a CORS preflight, so every state change requires it.
fn require_json(headers: &axum::http::HeaderMap) -> Result<(), Response> {
    let is_json = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"));
    if is_json {
        return Ok(());
    }
    Err(AiErrorEnvelope::new(
        AiErrorCode::InvalidRequest,
        "Content-Type must be application/json",
    )
    .status(StatusCode::UNSUPPORTED_MEDIA_TYPE)
    .into_response())
}

#[cfg(feature = "cloud")]
pub(crate) fn ai_authorization_error_response(
    error: openobserve_core::trial_quota::AiUsageAuthorizationError,
) -> Response {
    authorization_error(error).into_response()
}

/// The envelope of a refused usage authorization; `consent` and `remedy` ride along as before.
#[cfg(feature = "cloud")]
fn authorization_error(
    error: openobserve_core::trial_quota::AiUsageAuthorizationError,
) -> AiErrorEnvelope {
    use openobserve_core::trial_quota::AiUsageAuthorizationError;

    match error {
        AiUsageAuthorizationError::PaidOverageConsentRequired(consent) => {
            consent_required_error(serde_json::to_value(consent).unwrap_or_default())
        }
        AiUsageAuthorizationError::PaymentRequired {
            message,
            remedy,
            payer_org_id,
        } => {
            let remedy = serde_json::to_value(remedy).unwrap_or_default();
            payment_required_error(message, remedy.as_str().unwrap_or_default(), payer_org_id)
        }
        AiUsageAuthorizationError::Unavailable(detail) => {
            log::error!("[AI-CHAT] AI usage authorization unavailable: {detail}");
            authorization_unavailable_error()
        }
    }
}

/// Consent cannot be asked for once a turn runs, so a late refusal reads as a retryable 402.
#[cfg(feature = "cloud")]
fn post_upstream_authorization_error(
    error: openobserve_core::trial_quota::AiUsageAuthorizationError,
) -> AiErrorEnvelope {
    use openobserve_core::trial_quota::AiUsageAuthorizationError;

    match error {
        AiUsageAuthorizationError::PaidOverageConsentRequired(_) => {
            authorization_error(AiUsageAuthorizationError::PaymentRequired {
                message: "AI credit limit was reached while the request was running.".to_string(),
                remedy: openobserve_core::trial_quota::PaymentRemedy::Retry,
                payer_org_id: None,
            })
        }
        error => authorization_error(error),
    }
}

#[cfg(any(feature = "cloud", test))]
fn consent_required_error(consent: serde_json::Value) -> AiErrorEnvelope {
    AiErrorEnvelope::new(
        AiErrorCode::ConsentRequired,
        "Paid usage requires organization consent.",
    )
    .with("error_type", "paid_overage_consent_required")
    .with("consent", consent)
}

/// `subscribe` is a missing subscription; any other remedy means the credits ran out.
#[cfg(any(feature = "cloud", test))]
fn payment_required_error(
    message: String,
    remedy: &str,
    payer_org_id: Option<String>,
) -> AiErrorEnvelope {
    let code = if remedy == "subscribe" {
        AiErrorCode::SubscriptionRequired
    } else {
        AiErrorCode::CreditsExhausted
    };
    let retry = remedy == "retry";
    AiErrorEnvelope::new(code, message)
        .retryable(retry)
        .action(Some(if retry {
            AiErrorAction::Retry
        } else {
            AiErrorAction::ManageBilling
        }))
        .with("error_type", "ai_credits_exhausted")
        .with("remedy", remedy)
        .with("payer_org_id", payer_org_id)
}

#[cfg(any(feature = "cloud", test))]
fn authorization_unavailable_error() -> AiErrorEnvelope {
    AiErrorEnvelope::new(
        AiErrorCode::AuthorizationUnavailable,
        "AI credits could not be checked right now; please retry",
    )
}

/// A failed o2-ai request as the envelope; the upstream text stays in the logs.
#[cfg(feature = "enterprise")]
fn upstream_error(error: &anyhow::Error) -> AiErrorEnvelope {
    let owner_unavailable = is_session_owner_unavailable(error)
        || error.to_string().contains(SESSION_OWNER_UNAVAILABLE);
    let unreachable = is_agent_unreachable(error);
    if unreachable {
        super::capabilities::mark_unreachable();
    }
    let status = if unreachable {
        None
    } else {
        upstream_error_status(error)
    };
    upstream_failure(
        owner_unavailable,
        unreachable,
        status,
        upstream_retry_after(error),
        upstream_error_code(error).as_deref(),
    )
}

/// The ledger code of what o2-ai answered: a 429 is the provider's limit, never the turn limit.
#[cfg(feature = "enterprise")]
fn upstream_failure(
    owner_unavailable: bool,
    unreachable: bool,
    status: Option<u16>,
    retry_after: Option<u64>,
    upstream_code: Option<&str>,
) -> AiErrorEnvelope {
    if owner_unavailable {
        return AiErrorEnvelope::new(
            AiErrorCode::SessionOwnerUnavailable,
            "This conversation is unavailable right now; please retry",
        )
        .legacy_code(SESSION_OWNER_UNAVAILABLE);
    }
    let http = status.and_then(|s| StatusCode::from_u16(s).ok());
    let stored = upstream_code.and_then(AiErrorCode::from_stored);
    let envelope = match (http, stored) {
        (_, Some(AiErrorCode::TurnBusy)) => AiErrorEnvelope::new(
            AiErrorCode::TurnBusy,
            "A response is still running in this conversation",
        ),
        (Some(StatusCode::TOO_MANY_REQUESTS), _) => AiErrorEnvelope::new(
            AiErrorCode::RateLimited,
            "The AI provider is rate-limiting requests; please retry shortly",
        )
        .retry_after(retry_after),
        // OpenObserve already accepted the session, so o2-ai refusing it is a permission matter.
        (Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN), _) => AiErrorEnvelope::new(
            AiErrorCode::PermissionDenied,
            "The AI service refused this request",
        ),
        // The persisted path's split: only no answer at all or a gateway failure is retried.
        (None, _) if unreachable => AiErrorEnvelope::new(
            AiErrorCode::AgentUnavailable,
            "The AI assistant is unavailable right now; please retry",
        ),
        (Some(StatusCode::BAD_GATEWAY), _)
        | (Some(StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT), _) => {
            AiErrorEnvelope::new(
                AiErrorCode::AgentUnavailable,
                "The AI assistant is unavailable right now; please retry",
            )
            .retry_after(retry_after)
        }
        _ => AiErrorEnvelope::new(
            AiErrorCode::Internal,
            "The AI assistant could not answer this request",
        )
        .action(Some(AiErrorAction::None)),
    };
    let envelope = envelope.status(http.unwrap_or(StatusCode::BAD_GATEWAY));
    // The Slack bridge picks its reply from o2-ai's own code.
    match upstream_code {
        Some(code) => envelope.legacy_code(code),
        None => envelope,
    }
}

#[cfg(feature = "enterprise")]
fn not_enabled_error() -> Response {
    error::not_enabled("AI is not enabled")
}

/// An agent service that is not configured is the assistant being off for this deployment.
#[cfg(feature = "enterprise")]
fn agent_not_configured_error() -> Response {
    error::not_enabled("Agent service not configured")
}

/// The requested model is not echoed back: it is caller input and lands in Details.
#[cfg(feature = "enterprise")]
fn model_not_allowed_error() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::InvalidRequest,
        "This model is not allowed for AI chat",
    )
    .into_response()
}

/// Today's transport break mid-stream, as the frame the browser gets; the cause is logged.
#[cfg(feature = "enterprise")]
fn stream_interrupted_error() -> AiErrorEnvelope {
    AiErrorEnvelope::new(
        AiErrorCode::AgentUnavailable,
        "The response was interrupted. Please try again.",
    )
}

#[cfg(feature = "enterprise")]
fn approval_delivery_failed_error() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::ApprovalDeliveryFailed,
        "The confirmation did not reach the assistant; please send it again",
    )
    .into_response()
}

/// Stores an up or down vote with its turn of this chat, else says why it was not stored.
#[cfg(feature = "enterprise")]
async fn store_feedback(
    org_id: &str,
    session_id: &str,
    headers: &axum::http::HeaderMap,
    body: &Value,
) -> Result<(), &'static str> {
    use infra::table::ai_chat_feedback;

    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Err(NOT_STORED_DISABLED);
    }
    let Some(rating) = feedback_rating(body) else {
        return Err(NOT_STORED_NO_VOTE);
    };
    let email = headers
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let owner = openobserve_core::ai_chat::admission::resolve_owner(email)
        .await
        .map_err(|_| NOT_STORED_UNAVAILABLE)?;
    let raw_turn = body
        .get("turn_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let turn_id = voted_turn(org_id, session_id, raw_turn).await?;
    let vote = ai_chat_feedback::NewFeedback {
        org_id,
        session_id,
        turn_id: &turn_id,
        user_id: &owner,
        rating,
        comment: body.get("comment").and_then(Value::as_str),
    };
    ai_chat_feedback::upsert(&vote, config::utils::time::now_micros())
        .await
        .map_err(|e| {
            log::error!("[AI-CHAT] cannot store feedback on {org_id}/{session_id}: {e}");
            NOT_STORED_UNAVAILABLE
        })
}

/// The stored id of the turn a vote names: a recorded turn, or one the chat was imported with.
#[cfg(feature = "enterprise")]
async fn voted_turn(org_id: &str, session_id: &str, raw: &str) -> Result<String, &'static str> {
    use infra::table::{ai_chat_imports, ai_chat_turns};

    if let Some(turn_id) = openobserve_core::ai_chat::admission::normalize_uuid(raw) {
        match ai_chat_turns::get(org_id, session_id, &turn_id).await {
            Ok(Some(_)) => return Ok(turn_id),
            Ok(None) => {}
            Err(e) => {
                log::warn!("[AI-CHAT] cannot read turn {turn_id} of {org_id}/{session_id}: {e}");
                return Err(NOT_STORED_UNAVAILABLE);
            }
        }
    }
    let imported = ai_chat_imports::turns_for_session(org_id, session_id)
        .await
        .map_err(|_| NOT_STORED_UNAVAILABLE)?;
    let known = imported
        .as_ref()
        .and_then(Value::as_array)
        .is_some_and(|turns| !raw.is_empty() && turns.iter().any(|t| t["turn_id"] == raw));
    // A vote attaches to a turn the chat holds, so no id can grow the table for nothing.
    known
        .then(|| raw.to_string())
        .ok_or(NOT_STORED_UNKNOWN_TURN)
}

/// o2-ai's feedback answer with whether the vote was stored with the chat, and why not.
#[cfg(any(feature = "enterprise", test))]
fn with_stored(response: Value, stored: Result<(), &str>) -> Value {
    let mut body = match response {
        Value::Object(map) => map,
        other => serde_json::Map::from_iter([("result".to_string(), other)]),
    };
    body.insert("stored".into(), stored.is_ok().into());
    if let Err(reason) = stored {
        body.insert("stored_reason".into(), reason.into());
    }
    Value::Object(body)
}

/// `up` or `down` from `rating`, else from a thumbs `feedback_type`; a 1-5 rating is not a vote.
#[cfg(any(feature = "enterprise", test))]
fn feedback_rating(body: &serde_json::Value) -> Option<&'static str> {
    use infra::table::ai_chat_feedback::{RATING_DOWN, RATING_UP};

    let named = body
        .get("rating")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            body.get("feedback_type")
                .and_then(serde_json::Value::as_str)
        })?;
    match named.to_ascii_lowercase().as_str() {
        "up" | "thumbs_up" | "positive" => Some(RATING_UP),
        "down" | "thumbs_down" | "negative" => Some(RATING_DOWN),
        _ => None,
    }
}

/// Keeps a successful `/confirm` with the turn that asked, so the decision shows after a reload.
#[cfg(feature = "enterprise")]
async fn record_turn_decision(org_id: &str, session_id: &str, caller: &str, request: &[u8]) {
    let Some(decision) = decision_of(request, caller, config::utils::time::now_micros() / 1000)
    else {
        return;
    };
    if let Err(e) = infra::table::ai_chat_turns::add_decision(org_id, session_id, decision).await {
        log::warn!("[AI-CHAT] decision on {org_id}/{session_id} not recorded: {e}");
    }
}

/// The `confirmation_resolved` record of a `/confirm` body; `None` without an `approved` flag.
#[cfg(any(feature = "enterprise", test))]
fn decision_of(request: &[u8], caller: &str, at_ms: i64) -> Option<serde_json::Value> {
    let body: serde_json::Value = serde_json::from_slice(request).ok()?;
    let approved = body.get("approved")?.as_bool()?;
    let mut decision = serde_json::json!({"approved": approved, "by": caller, "at": at_ms});
    for key in ["id", "scope"] {
        if let Some(value) = body.get(key).and_then(serde_json::Value::as_str) {
            decision[key] = value.chars().take(128).collect::<String>().into();
        }
    }
    // Kept only while small: every detail and share read returns it.
    if let Some(items) = body
        .get("items")
        .and_then(serde_json::Value::as_array)
        .filter(|items| items.len() <= MAX_DECISION_ITEMS)
        .filter(|items| {
            serde_json::to_vec(items).is_ok_and(|b| b.len() <= MAX_DECISION_ITEMS_BYTES)
        })
    {
        decision["items"] = items.clone().into();
    }
    Some(decision)
}

/// The finished turn of the caller's chat a new version replaces; another member's chat is a 404.
#[cfg(feature = "enterprise")]
async fn replaced_turn(
    org_id: &str,
    user_email: &str,
    session_id: Option<&str>,
    replaces: Option<&str>,
) -> Result<Option<infra::table::ai_chat_turns::Model>, Response> {
    let Some(replaces) = replaces else {
        return Ok(None);
    };
    let (Some(session_id), Some(replaces)) = (
        session_id.and_then(openobserve_core::ai_chat::admission::normalize_uuid),
        openobserve_core::ai_chat::admission::normalize_uuid(replaces),
    ) else {
        return Err(error::invalid_request("Invalid replaces_turn_id"));
    };
    let owner = openobserve_core::ai_chat::admission::resolve_owner(user_email)
        .await
        .map_err(super::chats::admit_error_response)?;
    super::chats::owned_chat(org_id, &session_id, &owner).await?;
    match infra::table::ai_chat_turns::get(org_id, &session_id, &replaces).await {
        Ok(Some(turn)) if turn.status != infra::table::ai_chat_turns::TURN_RUNNING => {
            Ok(Some(turn))
        }
        Ok(_) => Err(error::invalid_request(
            "replaces_turn_id names no finished turn of this chat",
        )),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read turn {replaces} of {org_id}/{session_id}: {e}");
            Err(error::history_unavailable(
                "Chat persistence is unavailable; please retry",
            ))
        }
    }
}

/// A decision o2-ai accepted: record it, then relay the answer unchanged; `extend` decides nothing.
#[cfg(feature = "enterprise")]
async fn relay_confirm_answer(answered: &Answered<'_>, response_body: &str) -> Response {
    let Answered {
        org_id,
        session_id,
        caller,
        request,
        stored,
    } = *answered;
    let answer = serde_json::from_str::<Value>(response_body)
        .unwrap_or_else(|_| serde_json::json!({"ok": true}));
    if !extends_only(request) {
        let resolved = &answer["resolved"];
        let tool = resolved["tool"]
            .as_str()
            .or_else(|| stored.and_then(|row| row.tool.as_deref()));
        record_decision(org_id, resolved).await;
        super::grants::record_from_confirm(org_id, session_id, caller, resolved, tool).await;
        super::activity::record_confirm(org_id, session_id, caller, request, &answer).await;
        // The chat index stops reporting the confirmation as pending.
        super::turn_marks::mark_answered(org_id, session_id, caller).await;
        record_turn_decision(org_id, session_id, caller, request).await;
    } else if let Some(row) = stored {
        record_extension(org_id, row, &answer).await;
    }
    (StatusCode::OK, axum::Json(answer)).into_response()
}

/// Keeps OpenObserve's copy of an extended card pending as long as o2-ai holds it.
#[cfg(feature = "enterprise")]
async fn record_extension(org_id: &str, row: &ai_approvals::Model, answer: &Value) {
    let Some((expires_at, card)) = extended_card(&row.card, answer) else {
        return;
    };
    if let Err(e) = ai_approvals::extend(org_id, &row.id, expires_at, &card).await {
        log::warn!(
            "[org_id:{org_id}] extension of approval {} not stored: {e}",
            row.id
        );
    }
}

/// Checks and binds a `/confirm` body, handing o2-ai the stored card and the org's current policy.
#[cfg(feature = "enterprise")]
async fn prepare_confirm(
    org_id: &str,
    session_id: &str,
    caller: &str,
    body: &[u8],
) -> Result<(Vec<u8>, Option<ai_approvals::Model>), Response> {
    if let Some(problem) = confirm_body_problem(body) {
        return Err(error::invalid_request(problem));
    }
    // o2-ai refuses a card recorded for another org, so it gets the authorized path org.
    let Some(mut forward) = bind_confirm_body_to_org(body, org_id) else {
        return Err(error::invalid_request(
            "Confirmation body must be a JSON object",
        ));
    };
    let stored = stored_approval(org_id, session_id, caller, &forward).await;
    if let Some(row) = &stored {
        if row.status != ai_approvals::STATUS_PENDING {
            return Err(already_decided(row));
        }
        if let Ok(card) = serde_json::from_str::<Value>(&row.card) {
            forward["approval_record"] = card;
        }
    }
    let policy = super::settings::turn_policy(org_id, caller, Some(session_id)).await;
    if let Ok(policy) = serde_json::to_value(policy) {
        forward["policy"] = policy;
    }
    let bytes = serde_json::to_vec(&forward)
        .map_err(|_| error::invalid_request("Confirmation body must be a JSON object"))?;
    Ok((bytes, stored))
}

/// The caller's stored card the body names; `None` leaves the decision to o2-ai's store.
#[cfg(feature = "enterprise")]
async fn stored_approval(
    org_id: &str,
    session_id: &str,
    caller: &str,
    forward: &Value,
) -> Option<ai_approvals::Model> {
    let id = confirm_id(forward)?;
    match ai_approvals::get(org_id, &id).await {
        Ok(row) => row.filter(|row| {
            row.session_id == session_id && row.user_email.eq_ignore_ascii_case(caller)
        }),
        Err(e) => {
            log::warn!("[org_id:{org_id}] stored approval {id} unreadable: {e}");
            None
        }
    }
}

/// Marks the admitted turn a version and seeds o2-ai with the history before the replaced one.
#[cfg(feature = "enterprise")]
async fn version_turn(
    row: &infra::table::ai_chat_sessions::Model,
    turn_id: &str,
    replaced: &infra::table::ai_chat_turns::Model,
    query: &mut QueryRequest,
) {
    let (org_id, session_id) = (&row.org_id, &row.session_id);
    if let Err(e) =
        infra::table::ai_chat_turns::set_version_of(org_id, session_id, turn_id, &replaced.turn_id)
            .await
    {
        // The turn still runs; it lists as a turn of its own instead of a version.
        log::error!("[AI-CHAT] cannot mark {turn_id} of {org_id}/{session_id} as a version: {e}");
    }
    let before = replaced.start_seq.unwrap_or(row.last_committed_seq + 1);
    let Some(context) = query.context.as_object_mut() else {
        return;
    };
    context.insert(
        REPLACES_TURN_CONTEXT_KEY.to_string(),
        replaced.turn_id.clone().into(),
    );
    let built = super::shares::history_before(row, before).await.ok();
    if built.is_none() {
        log::warn!("[AI-CHAT] version {turn_id} of {session_id} has no seed");
    }
    set_version_history(&mut query.history, context, built);
}

/// Puts a version's server-built history on the query; when empty, only a first-turn seed stays.
#[cfg(any(feature = "enterprise", test))]
fn set_version_history(
    history: &mut Option<Vec<Value>>,
    context: &mut serde_json::Map<String, Value>,
    built: Option<(Vec<Value>, bool)>,
) {
    match built {
        Some((built, seeded)) if !built.is_empty() => {
            *history = Some(built);
            if seeded {
                context.insert(FORK_SEED_CONTEXT_KEY.to_string(), true.into());
            } else {
                context.remove(FORK_SEED_CONTEXT_KEY);
            }
        }
        // The seed flag is the server's own; any other history came from the client.
        _ if context.contains_key(FORK_SEED_CONTEXT_KEY) => {}
        _ => *history = None,
    }
}

/// The 409 o2-ai would give for a card decided on any replica, from OpenObserve's record.
#[cfg(feature = "enterprise")]
fn already_decided(row: &ai_approvals::Model) -> Response {
    let resolved: Value = row
        .resolved
        .as_deref()
        .and_then(|r| serde_json::from_str(r).ok())
        .unwrap_or_default();
    let mut upstream = serde_json::json!({
        "code": APPROVAL_RESOLVED,
        "id": row.id,
        "approved": row.status == ai_approvals::STATUS_APPROVED,
        "at": resolved.get("at").cloned().unwrap_or(Value::from(row.decided_at.unwrap_or(0))),
    });
    if let Some(by) = resolved.get("by") {
        upstream["resolved_by"] = by.clone();
    }
    confirm_refusal(409, &upstream.to_string())
}

/// Stores the decision a `confirmation_resolved` frame reports; a decided card stays as it was.
#[cfg(feature = "enterprise")]
async fn record_decision(org_id: &str, resolved: &Value) {
    let Some(id) = resolved["id"].as_str().filter(|id| id.starts_with("apr_")) else {
        return;
    };
    let text = resolved.to_string();
    let decision = super::turn_marks::decision_of(resolved, &text);
    let now = config::utils::time::now_micros();
    if let Err(e) = ai_approvals::decide(org_id, id, &decision, now).await {
        log::warn!("[org_id:{org_id}] decision on approval {id} not stored: {e}");
    }
}

/// o2-ai said the card was decided already (possibly on another replica): keep that decision.
#[cfg(feature = "enterprise")]
async fn record_known_decision(org_id: &str, body: &str) {
    let upstream: Value = serde_json::from_str(body).unwrap_or_default();
    let upstream = upstream.get("detail").cloned().unwrap_or(upstream);
    if upstream["code"] != APPROVAL_RESOLVED {
        return;
    }
    let mut resolved = serde_json::json!({
        "type": "confirmation_resolved",
        "id": upstream["id"],
        "approved": upstream["approved"] == true,
        "by": upstream["resolved_by"],
        "at": upstream["at"],
    });
    for flag in ["withdrawn", "expired"] {
        if upstream[flag] == true {
            resolved[flag] = Value::Bool(true);
        }
    }
    record_decision(org_id, &resolved).await;
}

/// The relay gave up waiting; the decision may still have been applied, so it says 504.
#[cfg(feature = "enterprise")]
fn confirm_timed_out() -> Response {
    log::warn!("Confirmation relay timed out");
    AiErrorEnvelope::new(
        AiErrorCode::ApprovalDeliveryFailed,
        "The assistant did not answer the confirmation in time; it may still apply",
    )
    .status(StatusCode::GATEWAY_TIMEOUT)
    .into_response()
}

#[cfg(feature = "enterprise")]
fn is_timeout(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(reqwest::Error::is_timeout)
    })
}

/// Refuses a stop or confirmation on someone else's or an unknown persisted chat.
#[cfg(feature = "enterprise")]
async fn check_chat_owner(
    headers: &axum::http::HeaderMap,
    org_id: &str,
    session_id: &str,
) -> Result<(), Response> {
    // Without persistence there is no index row; the session id the caller must know scopes it.
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Ok(());
    }
    let user_id = headers
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let owner = openobserve_core::ai_chat::admission::resolve_owner(user_id)
        .await
        .map_err(super::chats::admit_error_response)?;
    match infra::table::ai_chat_sessions::get(org_id, session_id).await {
        Ok(Some(row))
            if row.user_id == owner
                && row.status == infra::table::ai_chat_sessions::STATUS_ACTIVE =>
        {
            Ok(())
        }
        // Someone else's, deleted or unknown: indistinguishable to the caller.
        Ok(_) => Err(error::not_found("Unknown conversation")),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read session {org_id}/{session_id}: {e}");
            Err(error::internal("Could not read the conversation"))
        }
    }
}

/// Whether a Stop takes the persisted path; a turn without a row (ephemeral) is stopped as direct.
#[cfg(feature = "enterprise")]
async fn stop_route(
    headers: &axum::http::HeaderMap,
    org_id: &str,
    session_id: &str,
) -> Result<bool, Response> {
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Ok(false);
    }
    let row = match infra::table::ai_chat_sessions::get(org_id, session_id).await {
        Ok(row) => row,
        Err(e) => {
            log::error!("[AI-CHAT] cannot read session {org_id}/{session_id}: {e}");
            return Err(error::internal("Could not read the conversation"));
        }
    };
    let running_here =
        !o2_enterprise::enterprise::ai::chat::registry::turns(org_id, session_id).is_empty();
    if direct_stop(row.is_some(), running_here) {
        return Ok(false);
    }
    check_chat_owner(headers, org_id, session_id)
        .await
        .map(|()| true)
}

/// A Stop of a session with no row goes to this node's turns; the caller still stops only its own.
#[cfg(feature = "enterprise")]
fn direct_stop(row_exists: bool, running_here: bool) -> bool {
    !row_exists && running_here
}

/// Asks o2-ai to abort first so the partial reply is still stored, else stops the turn on its node.
#[cfg(feature = "enterprise")]
async fn cancel_turn(
    org_id: String,
    session_id: String,
    turn_id: Option<String>,
    auth: String,
    caller: String,
    persisted: bool,
) -> Response {
    use o2_enterprise::enterprise::ai::chat::{CancelReason, lease};

    // o2-ai's Stop is chat-wide, so which turn it may stop is settled here first.
    let mut chat_turns: Option<Vec<String>> = None;
    let target = if persisted {
        let running = super::chats::running_turn_id(&org_id, &session_id).await;
        match stop_target(turn_id.as_deref(), running.as_deref()) {
            Some(turn) => StopTarget::Turn(turn),
            None => StopTarget::Nothing,
        }
    } else {
        let turns = o2_enterprise::enterprise::ai::chat::registry::turns(&org_id, &session_id);
        let running: Vec<(&str, &str)> = turns
            .iter()
            .map(|t| (t.turn_id.as_str(), t.user_id.as_str()))
            .collect();
        let target = match direct_stop_target(turn_id.as_deref(), &running, &caller) {
            Ok(target) => target,
            Err(refusal) => return refusal.into_response(),
        };
        chat_turns = Some(own_turns(&running, &caller));
        target
    };
    let target = match target {
        StopTarget::Turn(turn) => Some(turn),
        StopTarget::Elsewhere => None,
        StopTarget::Nothing => return cancel_body(false, false, turn_id, None),
    };
    let (accepted, refusal) = upstream_cancel(&org_id, &session_id, auth).await;
    if accepted == Some(true)
        && persisted
        && let Some(target) = target.clone()
    {
        schedule_cancel_fallback(org_id.clone(), session_id.clone(), target);
    }
    let owner = if persisted && accepted != Some(true) {
        let owner = lease::cancel_on_owner(
            &org_id,
            &session_id,
            target.as_deref(),
            CancelReason::User,
            UPSTREAM_CANCEL_WAIT,
        )
        .await;
        Some(owner)
    } else {
        None
    };
    let turn_id = owner
        .as_ref()
        .and_then(|o| o.turn_id.clone())
        .or(target)
        .or(turn_id);
    match cancel_reply(accepted, refusal.is_some(), owner.as_ref()) {
        CancelReply::Body {
            cancelled,
            owner_reached,
        } => {
            // Without persistence o2-ai stops the whole chat; only the caller's turns are named.
            let stopped = chat_turns.map(|turns| if cancelled { turns } else { Vec::new() });
            cancel_body(cancelled, owner_reached, turn_id, stopped)
        }
        CancelReply::Relay => match refusal {
            Some(resp) => relay_response(resp).await,
            None => cancel_failed(),
        },
        CancelReply::Failed => cancel_failed(),
    }
}

/// o2-ai's answer to a user Stop: `Some(active)` when it answered 2xx, else its refusal, if any.
#[cfg(feature = "enterprise")]
async fn upstream_cancel(
    org_id: &str,
    session_id: &str,
    auth: String,
) -> (Option<bool>, Option<reqwest::Response>) {
    let Some(client) = get_agent_client() else {
        return (None, None);
    };
    let (org, sid) = (org_id.to_string(), session_id.to_string());
    // The caller's own credential only, so o2-ai checks that it started the streaming turn.
    let task =
        tokio::spawn(async move { client.cancel_session_as_caller(&sid, &org, &auth).await });
    let resp = match tokio::time::timeout(UPSTREAM_CANCEL_WAIT, task).await {
        Ok(Ok(Ok(resp))) => resp,
        Ok(Ok(Err(e))) => {
            log::warn!("[AI-CHAT] failed to forward cancel for {session_id}: {e}");
            return (None, None);
        }
        Ok(Err(e)) => {
            log::error!("[AI-CHAT] cancel task for {session_id} failed: {e}");
            return (None, None);
        }
        Err(_) => {
            log::warn!("[AI-CHAT] o2-ai did not answer the cancel for {session_id} in time");
            return (None, None);
        }
    };
    if !resp.status().is_success() {
        return (None, Some(resp));
    }
    let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
    let active = body.get("active").and_then(|v| v.as_bool()) == Some(true)
        || body.get("cancelled").and_then(|v| v.as_bool()) == Some(true);
    (Some(active), None)
}

/// The persisted turn to stop: the running one, and only if it is the one the caller named.
#[cfg(feature = "enterprise")]
fn stop_target(named: Option<&str>, running: Option<&str>) -> Option<String> {
    let running = running?;
    named
        .is_none_or(|named| named == running)
        .then(|| running.to_string())
}

/// The turn without persistence a Stop goes to, from the turns `(turn, user)` running here.
#[cfg(feature = "enterprise")]
fn direct_stop_target(
    named: Option<&str>,
    running: &[(&str, &str)],
    caller: &str,
) -> Result<StopTarget, AiErrorEnvelope> {
    // Only a node that streams none of the chat's turns forwards a Stop it cannot vouch for.
    if running.is_empty() {
        return Ok(StopTarget::Elsewhere);
    }
    let refused = || {
        AiErrorEnvelope::new(
            AiErrorCode::PermissionDenied,
            "Only the user who started this answer can stop it",
        )
    };
    let Some((newest_mine, _)) = running.iter().rev().find(|(_, user)| *user == caller) else {
        return Err(refused());
    };
    match named.map(|named| running.iter().find(|(turn, _)| *turn == named)) {
        None => Ok(StopTarget::Turn(newest_mine.to_string())),
        Some(Some((_, user))) if *user != caller => Err(refused()),
        Some(Some((turn, _))) => Ok(StopTarget::Turn(turn.to_string())),
        // Another turn of the caller runs here, so the named one already ended.
        Some(None) => Ok(StopTarget::Nothing),
    }
}

/// The caller's turns among the chat's `(turn, user)` here; other users' ids are never echoed.
#[cfg(feature = "enterprise")]
fn own_turns(running: &[(&str, &str)], caller: &str) -> Vec<String> {
    running
        .iter()
        .filter(|(_, user)| *user == caller)
        .map(|(turn, _)| turn.to_string())
        .collect()
}

/// How a Stop ends from o2-ai's answer and, for a persisted chat, what the turn's node said.
#[cfg(feature = "enterprise")]
fn cancel_reply(accepted: Option<bool>, refused: bool, owner: Option<&OwnerCancel>) -> CancelReply {
    match (accepted, owner) {
        (Some(true), _) => CancelReply::Body {
            cancelled: true,
            owner_reached: true,
        },
        // A refusal stays typed unless the turn was stopped anyway.
        (_, Some(owner)) if owner.reached || !refused => CancelReply::Body {
            cancelled: owner.reached,
            owner_reached: owner.reached,
        },
        (Some(false), None) => CancelReply::Body {
            cancelled: false,
            owner_reached: true,
        },
        (..) if refused => CancelReply::Relay,
        _ => CancelReply::Failed,
    }
}

#[cfg(feature = "enterprise")]
fn cancel_failed() -> Response {
    AiErrorEnvelope::new(
        AiErrorCode::Internal,
        "Failed to cancel the response; please retry",
    )
    .retryable(true)
    .into_response()
}

/// `owner_reached`: whoever runs the turn got the stop; `active` is kept for older clients.
#[cfg(feature = "enterprise")]
fn cancel_body(
    cancelled: bool,
    owner_reached: bool,
    turn_id: Option<String>,
    chat_wide: Option<Vec<String>>,
) -> Response {
    let mut body = serde_json::json!({
        "cancelled": cancelled,
        "active": cancelled,
        "owner_reached": owner_reached,
        "turn_id": turn_id,
    });
    if let (Some(stopped), Some(obj)) = (chat_wide, body.as_object_mut()) {
        obj.insert("chat_wide".into(), true.into());
        obj.insert("stopped_turns".into(), stopped.into());
    }
    MetaHttpResponse::json(body)
}

/// Stops the turn on its node if it is still running once o2-ai has had time to settle the abort.
#[cfg(feature = "enterprise")]
fn schedule_cancel_fallback(org_id: String, session_id: String, turn_id: String) {
    use o2_enterprise::enterprise::ai::chat::{CancelReason, lease};

    tokio::spawn(async move {
        tokio::time::sleep(CANCEL_GRACE).await;
        lease::cancel_on_owner(
            &org_id,
            &session_id,
            Some(&turn_id),
            CancelReason::User,
            UPSTREAM_CANCEL_WAIT,
        )
        .await;
    });
}

/// The optional `turn_id` of a cancel body; an empty body or `{}` names none.
#[cfg(feature = "enterprise")]
async fn cancel_turn_id(body: Body) -> Result<Option<String>, Response> {
    let Ok(bytes) = axum::body::to_bytes(body, 4 << 10).await else {
        return Err(error::invalid_request("Request body too large"));
    };
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Err(error::invalid_request("Expected {\"turn_id\"?: string}"));
    };
    match body.get("turn_id") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(id) => id
            .as_str()
            .and_then(openobserve_core::ai_chat::admission::normalize_uuid)
            .map(Some)
            .ok_or_else(|| error::invalid_request("Invalid turn id")),
    }
}

/// o2-ai's answer to a cancel; a refusal is reported by its status, its text only logged.
#[cfg(feature = "enterprise")]
async fn relay_response(resp: reqwest::Response) -> Response {
    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
    if !status.is_success() {
        log::warn!("[AI-CHAT] o2-ai refused a cancel with {status}: {body}");
        return upstream_failure(false, false, Some(status.as_u16()), None, None).into_response();
    }
    let json = serde_json::from_str::<serde_json::Value>(&body)
        .unwrap_or_else(|_| serde_json::json!({"message": body}));
    (status, axum::Json(json)).into_response()
}

/// Request headers matching the passthrough patterns (exact names or `prefix*`).
fn extract_passthrough_headers(
    headers: &axum::http::HeaderMap,
    passthrough_config: &str,
) -> std::collections::HashMap<String, String> {
    let mut result = std::collections::HashMap::new();

    // Parse the passthrough config into patterns
    let patterns: Vec<&str> = passthrough_config
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for (header_name, header_value) in headers.iter() {
        let header_name_lower = header_name.as_str().to_lowercase();

        for pattern in &patterns {
            let pattern_lower = pattern.to_lowercase();
            let matches = if pattern_lower.ends_with('*') {
                // Prefix match (e.g., "x-forwarded-*" matches "x-forwarded-for")
                let prefix = &pattern_lower[..pattern_lower.len() - 1];
                header_name_lower.starts_with(prefix)
            } else {
                // Exact match
                header_name_lower == pattern_lower
            };

            if matches {
                if let Ok(value) = header_value.to_str() {
                    result.insert(header_name_lower.clone(), value.to_string());
                }
                break;
            }
        }
    }

    result
}

/// The audit body of a Slack turn: the question stays in Slack, `slack_event` names the message.
pub fn slack_audit_body(mut body: serde_json::Value, slack_event: Option<&str>) -> String {
    match body.as_object_mut() {
        Some(obj) => {
            obj.insert("messages".to_string(), SLACK_REDACTED.into());
            obj.insert("slack_event".to_string(), slack_event.into());
        }
        None => body = SLACK_REDACTED.into(),
    }
    body.to_string()
}

#[cfg(feature = "enterprise")]
pub(super) fn sse_response(body: Body) -> Response {
    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            mime::TEXT_EVENT_STREAM.as_ref(),
        )
        .header(axum::http::header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// CreateChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chat",
    context_path = "/api",
    tag = "AI",
    operation_id = "Chat",
    summary = "Generate AI chat response",
    description = "Generates an AI-powered response to user queries and requests.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = inline(PromptRequest),
        description = "Prompt details",
        example = json!({
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = inline(PromptResponse)),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
        (status = StatusCode::PRECONDITION_FAILED, description = "Paid overage consent required", body = Object),
        (status = StatusCode::PAYMENT_REQUIRED, description = "Subscription or additional credits required", body = Object),
        (status = StatusCode::SERVICE_UNAVAILABLE, description = "Usage authorization unavailable", body = Object),
        (status = StatusCode::CONFLICT, description = "O2 AI session owner unavailable", body = Object),
        (status = StatusCode::TOO_MANY_REQUESTS, description = "Upstream AI rate limit exceeded", body = Object),
        (status = StatusCode::BAD_GATEWAY, description = "Upstream AI service unavailable", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Chat", "operation": "create"}))
    )
)]
pub async fn chat(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let (mut parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    // Extract TraceInfo from headers
    let auth_data = match Headers::<TraceInfo>::from_request_parts(&mut parts, &()).await {
        Ok(Headers(data)) => data,
        Err(_) => return error::invalid_request("The request carries no user identity"),
    };

    let trace_id = auth_data.get_trace_id();
    // The router does not audit this route: its body is the prompt, so this record replaces it.
    #[cfg(feature = "enterprise")]
    let audit = |prompt: Option<&PromptRequest>, bytes: usize| {
        let session_id = parts
            .headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .and_then(|v| v.to_str().ok());
        TurnAudit::new(
            &org_id,
            &auth_data.user_id,
            &trace_id,
            session_id,
            None,
            prompt,
            bytes,
        )
        .on_route("chat")
        .delegated_by(parts.extensions.get::<DelegatedCaller>(), &parts.headers)
    };

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            let response = error::invalid_request(format!("Failed to read request body: {e}"));
            #[cfg(feature = "enterprise")]
            audit(None, 0).report_status(response.status()).await;
            return response;
        }
    };

    let prompt_body: PromptRequest = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            let response = error::invalid_request(format!("Invalid JSON body: {e}"));
            #[cfg(feature = "enterprise")]
            audit(None, body_bytes.len())
                .report_status(response.status())
                .await;
            return response;
        }
    };

    #[cfg(feature = "enterprise")]
    {
        let audit = audit(Some(&prompt_body), body_bytes.len());
        let response = chat_turn(org_id, parts, auth_data, trace_id, prompt_body).await;
        audit.report_status(response.status()).await;
        response
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(parts);
        drop(auth_data);
        drop(trace_id);
        drop(prompt_body);
        error::not_enabled("AI chat is only available in enterprise version")
    }
}

#[derive(Debug, Deserialize)]
pub struct TraceInfo {
    pub user_id: String,
    pub traceparent: Option<String>,
    #[serde(default)]
    pub authorization: Option<String>,
}

impl TraceInfo {
    /// Extract trace_id from traceparent header if present, otherwise generate UUID v7
    fn get_trace_id(&self) -> String {
        if let Some(traceparent) = &self.traceparent
            && !traceparent.is_empty()
        {
            // Parse traceparent format: 00-{trace_id}-{span_id}-{flags}
            let parts: Vec<&str> = traceparent.split('-').collect();
            if parts.len() >= 3 {
                let trace_id = parts[1].to_string();
                // Validate trace_id (32 hex chars, not all zeros)
                if trace_id.len() == 32
                    && trace_id.chars().all(|c| c.is_ascii_hexdigit())
                    && trace_id.chars().any(|c| c != '0')
                {
                    return trace_id;
                }
            }
        }
        // Generate new UUID v7 trace_id if traceparent is invalid or missing
        config::ider::generate_trace_id()
    }
}

/// CreateChatStream
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chat_stream",
    context_path = "/api",
    tag = "AI",
    operation_id = "ChatStream",
    summary = "Generate streaming AI chat response",
    description = "Generates an AI response with real-time streaming for improved user experience. \
                   This endpoint redirects to the o2-sre-agent service for processing.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = inline(PromptRequest),
        description = "Prompt details",
        example = json!({
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
        (status = StatusCode::PRECONDITION_FAILED, description = "Paid overage consent required", body = Object),
        (status = StatusCode::PAYMENT_REQUIRED, description = "Subscription or additional credits required", body = Object),
        (status = StatusCode::SERVICE_UNAVAILABLE, description = "Usage authorization unavailable", body = Object),
        (status = StatusCode::CONFLICT, description = "O2 AI session owner unavailable", body = Object),
        (status = StatusCode::TOO_MANY_REQUESTS, description = "Upstream AI rate limit exceeded", body = Object),
        (status = StatusCode::BAD_GATEWAY, description = "Upstream AI service unavailable", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Chat", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
#[axum::debug_handler]
pub async fn chat_stream(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let (mut parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    // Extract TraceInfo from headers
    let auth_data = match Headers::<TraceInfo>::from_request_parts(&mut parts, &()).await {
        Ok(Headers(data)) => data,
        Err(_) => return error::invalid_request("The request carries no user identity"),
    };

    let trace_id = auth_data.get_trace_id();
    let mut response = stream_turn(org_id, parts, body, auth_data, trace_id.clone()).await;
    // On refusals too, so a turn refused before any frame still shows its trace in Details.
    if let Ok(value) = HeaderValue::from_str(&trace_id) {
        response
            .headers_mut()
            .insert(super::chats::X_O2_TRACE_ID, value);
    }
    response
}

/// Forwards feedback to o2-ai and stores a vote with its chat; the answer carries `stored`.
pub async fn feedback(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let (parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    // Extract trace info from headers (user_id may not be present for feedback)
    let traceparent = parts
        .headers
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trace_id = traceparent
        .as_ref()
        .and_then(|tp| tp.split('-').nth(1).map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    let mut forward_headers = std::collections::HashMap::new();

    // Rejected rather than dropped: feedback is recorded on the owning replica.
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_ascii_lowercase(),
            );
        } else {
            return error::invalid_request("Invalid session id");
        }
    }

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return error::invalid_request(format!("Failed to read request body: {}", e));
        }
    };

    let feedback_body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return error::invalid_request(format!("Invalid JSON body: {}", e));
        }
    };
    // The header wins; a body that names its chat is routed and stored the same way.
    if !forward_headers.contains_key(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Some(val) = feedback_body.get("session_id").and_then(Value::as_str)
    {
        if !is_valid_session_id(val) {
            return error::invalid_request("Invalid session id");
        }
        forward_headers.insert(
            X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
            val.to_ascii_lowercase(),
        );
    }

    #[cfg(feature = "enterprise")]
    {
        if !get_o2_config().ai.enabled {
            return not_enabled_error();
        }
        // Feedback text goes to o2-ai, which an org that is off never reaches.
        if let Err(refusal) = super::settings::refuse_if_off(&org_id).await {
            return refusal;
        }

        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                return agent_not_configured_error();
            }
        };
        if let Some(session_id) = forward_headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
            && let Err(resp) = check_chat_owner(&parts.headers, &org_id, session_id).await
        {
            return resp;
        }
        let stored = match forward_headers.get(X_O2_ASSISTANT_SESSION_ID.as_str()) {
            Some(session_id) => {
                store_feedback(&org_id, session_id, &parts.headers, &feedback_body).await
            }
            None => Err(NOT_STORED_NO_SESSION),
        };

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(forward_headers)
        };

        match client
            .post_feedback(feedback_body, &auth_str, headers_to_forward.as_ref())
            .await
        {
            Ok(response) => {
                log::info!(
                    "[trace_id:{}] Feedback submitted for org={}",
                    trace_id,
                    org_id
                );
                Json(with_stored(response, stored)).into_response()
            }
            // Stored with the turn, the vote survives; evaluation only misses this one.
            Err(e) if stored.is_ok() => {
                log::warn!("[trace_id:{trace_id}] Feedback stored but not forwarded: {e}");
                Json(serde_json::json!({"stored": true, "forwarded": false})).into_response()
            }
            Err(e) => {
                log::error!("[trace_id:{}] Feedback submission failed: {}", trace_id, e);
                AiErrorEnvelope::new(
                    AiErrorCode::AgentUnavailable,
                    "Feedback could not be delivered; please retry",
                )
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .into_response()
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(trace_id);
        drop(feedback_body);
        error::not_enabled("AI feedback is only available in enterprise version")
    }
}

/// ConfirmAction - Proxy confirmation response to o2-sre-agent
#[utoipa::path(
    post,
    path = "/{org_id}/ai/confirm/{session_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "ConfirmAction",
    summary = "Confirm or reject a destructive AI tool action",
    description = "Forwards user confirmation or rejection to the o2-sre-agent service \
                   for a pending destructive tool call.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID")
    ),
    request_body(
        content = serde_json::Value,
        description = "Decision on a card: `{id, approved, scope?, items?, reply?}`, where `id` \
                       is the card's id (or its `call_id`), `scope` is `once`, `chat` or \
                       `always` (only for a grantable card), `items` approves a subset of a \
                       batch and `reply` declines with text. `{id, extend: true}` asks for more \
                       time instead (at most three times) and answers the new `expires_at`.",
        example = json!({"id": "apr_3f9c2e81a0b4d5c6e7f8", "approved": true, "scope": "once"}),
    ),
    responses(
        (status = StatusCode::OK, description = "Decision applied: `{id, status, items[], resolved}` \
            with per-item results and the `confirmation_resolved` frame (plus the legacy fields)", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Invalid session ID, malformed body, or AI agent not configured", body = Object),
        (status = StatusCode::NOT_FOUND, description = "No such card, or it expired (`reason`: `approval_not_found` / `approval_expired`)", body = Object),
        (status = StatusCode::CONFLICT, description = "Already decided (`reason` `approval_resolved` with `resolved_by`, `at`) or not the pending card (`approval_mismatch`)", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "The decision did not reach the assistant", body = Object),
        (status = StatusCode::GATEWAY_TIMEOUT, description = "The assistant did not answer in time; the decision may still apply", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn confirm_action(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let (parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return error::invalid_request(format!("Failed to read request body: {e}"));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        let o2_cfg = get_o2_config();
        if !o2_cfg.ai.enabled {
            return not_enabled_error();
        }

        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                return agent_not_configured_error();
            }
        };

        // Validated before this caller-supplied segment is interpolated into an outbound URL.
        if !is_valid_session_id(&session_id) {
            return error::invalid_request("Invalid session id");
        }
        let session_id = session_id.to_ascii_lowercase();
        if let Err(resp) = check_chat_owner(&parts.headers, &org_id, &session_id).await {
            return resp;
        }
        // Only an explicit decline passes while off: it ends the paused turn and changes nothing.
        if !declines(&body_bytes)
            && let Err(refusal) = super::settings::refuse_if_off(&org_id).await
        {
            return refusal;
        }

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;

        let caller = parts
            .headers
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let (forward_bytes, stored) =
            match prepare_confirm(&org_id, &session_id, caller, &body_bytes).await {
                Ok(prepared) => prepared,
                Err(resp) => return resp,
            };

        // The client routes the confirm to the replica holding the paused turn.
        let sent = tokio::time::timeout(
            CONFIRM_RELAY_TIMEOUT,
            client.confirm_action(&session_id, forward_bytes, &auth_str),
        )
        .await;
        match sent {
            Ok(Ok(resp)) => {
                let status = resp.status();
                let response_body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
                if !status.is_success() {
                    log::warn!("Agent confirm endpoint returned {status}");
                    if status == StatusCode::CONFLICT {
                        record_known_decision(&org_id, &response_body).await;
                    }
                    return confirm_refusal(status.as_u16(), &response_body);
                }
                let answered = Answered {
                    org_id: &org_id,
                    session_id: &session_id,
                    caller,
                    request: &body_bytes,
                    stored: stored.as_ref(),
                };
                relay_confirm_answer(&answered, &response_body).await
            }
            Ok(Err(e)) if is_timeout(&e) => confirm_timed_out(),
            Ok(Err(e)) => {
                log::error!("Failed to forward confirmation to agent: {e}");
                approval_delivery_failed_error()
            }
            Err(_) => confirm_timed_out(),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(session_id);
        drop(parts);
        drop(body_bytes);
        error::not_enabled("AI chat is only available in enterprise version")
    }
}

/// CancelChat - stop the turn running in a conversation
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chats/{session_id}/cancel",
    context_path = "/api",
    tag = "AI",
    operation_id = "CancelChat",
    summary = "Stop the AI turn running in a conversation",
    description = "Stops generation for a chat session. With server-side chat persistence \
                   enabled the browser no longer holds the connection to the agent, so \
                   disconnecting does not stop the turn — this does, on whichever node runs it, \
                   and what was generated up to that point stays saved. The JSON body may name \
                   the turn (`{\"turn_id\": \"…\"}`); a turn that is not the one running is not \
                   stopped. The answer is `{cancelled, owner_reached, turn_id}`: `owner_reached` \
                   is false when nothing runs, or when neither the agent nor the node running \
                   the turn answered in time. Without chat persistence only the user who started \
                   the answer may stop it (403 `permission_denied`): a node streaming turns of \
                   the chat refuses unless one is the caller's, and a node streaming none sends \
                   it to the agent as the caller. Such a Stop ends the whole chat, so the answer \
                   adds `chat_wide: true` and `stopped_turns`, the caller's own turns of it.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Cancellation forwarded", body = Object,
            example = json!({"cancelled": true, "owner_reached": true, "turn_id": "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718"})),
        (status = StatusCode::BAD_REQUEST, description = "Invalid session ID or AI agent not configured", body = Object),
        (status = StatusCode::FORBIDDEN, description = "The conversation belongs to another user", body = Object),
        (status = StatusCode::NOT_FOUND, description = "Unknown conversation", body = Object),
        (status = StatusCode::UNSUPPORTED_MEDIA_TYPE, description = "The body is not JSON (send {})", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn cancel(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let (parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    #[cfg(feature = "enterprise")]
    {
        if !get_o2_config().ai.enabled {
            return not_enabled_error();
        }
        // Validated before it reaches an outbound URL and a routing key.
        if !is_valid_session_id(&session_id) {
            return error::invalid_request("Invalid session id");
        }
        let session_id = session_id.to_ascii_lowercase();
        let turn_id = match cancel_turn_id(body).await {
            Ok(turn_id) => turn_id,
            Err(resp) => return resp,
        };
        let persisted = match stop_route(&parts.headers, &org_id, &session_id).await {
            Ok(persisted) => persisted,
            Err(resp) => return resp,
        };
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        let caller = parts
            .headers
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        cancel_turn(org_id, session_id, turn_id, auth_str, caller, persisted).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop((org_id, session_id, parts, body));
        error::not_enabled("AI chat is only available in enterprise version")
    }
}

/// The body of [`chat`] once the request is parsed: o2-ai's answer, charged after a 2xx.
#[cfg(feature = "enterprise")]
async fn chat_turn(
    org_id: String,
    parts: axum::http::request::Parts,
    auth_data: TraceInfo,
    trace_id: String,
    prompt_body: PromptRequest,
) -> Response {
    {
        let user_id = &auth_data.user_id;
        let org_id_str = org_id.as_str();
        let o2_cfg = get_o2_config();

        // Check if AI/agent is enabled
        if !o2_cfg.ai.enabled {
            return not_enabled_error();
        }
        if let Err(refusal) = super::settings::refuse_if_off(org_id_str).await {
            return refusal;
        }
        if let Err(refusal) = refuse_if_unreachable(org_id_str) {
            return refusal;
        }

        if !o2_cfg.ai.has_agent_target() {
            return error::not_enabled("AI agent URL is not set");
        }
        // Nothing is stored on this path, so an ephemeral query turn needs only the mode check.
        if let Some(problem) = turn_mode_problem(prompt_body.mode, prompt_body.ephemeral) {
            return error::invalid_request(problem);
        }

        let model = Ai::model_override(&prompt_body.model).map(str::to_string);
        if !o2_cfg
            .ai
            .allows_model(model.as_deref().unwrap_or_default(), None)
        {
            return model_not_allowed_error();
        }

        // Quota is checked here, but a credit is only consumed once the upstream succeeds.
        #[cfg(feature = "cloud")]
        let usage_ctx = openobserve_core::trial_quota::AiUsageContext {
            user_email: user_id.to_string(),
            trace_id: Some(trace_id.clone()),
            session_id: None,
            incident_id: None,
        };
        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::precheck_ai_usage(
            org_id_str,
            openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
            user_id,
        )
        .await
        {
            return ai_authorization_error_response(error);
        }

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        // Auth header is passed directly to agent - no need to extract user_token

        // Get global agent client singleton
        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent service not configured"
                );
                return agent_not_configured_error();
            }
        };

        let passthrough_config = ""; // TODO: Replace with config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);

        let last_user_message = prompt_body
            .messages
            .iter()
            .rfind(|m| m.role == Role::User)
            .map(|m| m.content.clone())
            .unwrap_or_default();

        // Build history from all messages except the last user message
        let history: Vec<serde_json::Value> = prompt_body
            .messages
            .iter()
            .take(prompt_body.messages.len().saturating_sub(1))
            .map(|m| {
                serde_json::json!({
                    "role": format!("{:?}", m.role).to_lowercase(),
                    "content": m.content
                })
            })
            .collect();

        let delegated = parts.extensions.get::<DelegatedCaller>().is_some();
        let context = agent_context(&prompt_body.context, org_id_str, delegated);

        // An existing chat keeps its stored agent; resolve before context moves into QueryRequest.
        let session_header = parts
            .headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .and_then(|v| v.to_str().ok());
        let (agent_type, context) = turn_agent_and_context(
            org_id_str,
            user_id,
            session_header,
            context,
            prompt_body.mode,
        )
        .await;

        // Convert images to agent format
        let images = prompt_body.images.map(|imgs| {
            imgs.into_iter()
                .map(|img| ImageAttachment {
                    data: img.data,
                    mime_type: img.mime_type,
                    filename: img.filename,
                })
                .collect()
        });

        let (tool_mcps, tool_clis, tool_skills) =
            o2_enterprise::enterprise::ai::toolsets::push::load_agent_tools(org_id_str).await;
        let (tool_mcps, tool_clis) = turn_tools(prompt_body.mode, tool_mcps, tool_clis);
        let session = parts
            .headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .and_then(|v| v.to_str().ok())
            .filter(|sid| is_valid_session_id(sid))
            .map(str::to_ascii_lowercase);
        let policy = super::settings::turn_policy(org_id_str, user_id, session.as_deref()).await;
        let query_req = with_policy(
            QueryRequest {
                model,
                history: if history.is_empty() {
                    None
                } else {
                    Some(history)
                },
                images,
                mcps: if tool_mcps.is_empty() {
                    None
                } else {
                    Some(tool_mcps)
                },
                clis: if tool_clis.is_empty() {
                    None
                } else {
                    Some(tool_clis)
                },
                skills: if tool_skills.is_empty() {
                    None
                } else {
                    Some(tool_skills)
                },
                // Set by persistence admission below; absent, o2-ai streams as before.
                turn_id: None,
                known_seq: None,
                known_opencode_session_id: None,
                session_epoch: None,
                mode: prompt_body.mode.map(|mode| mode.as_str().to_string()),
                ephemeral: prompt_body.ephemeral,
                attachments: forwarded_attachments(prompt_body.attachments),
                confirm_timeout_secs: confirm_timeout(prompt_body.confirm_timeout_secs),
                ..QueryRequest::new(last_user_message, context)
            },
            &policy,
        );

        // Without it every call lands on an arbitrary replica, which starts a new session.
        let mut forward_headers = std::collections::HashMap::new();
        if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
            && let Ok(val) = session_id.to_str()
        {
            // A persisted chat is only continued through admission (owner check, epoch fence).
            if o2_enterprise::enterprise::ai::chat::is_enabled() {
                return error::invalid_request(
                    "Use /ai/chat_stream to continue a conversation while chat persistence is \
                     enabled",
                );
            }
            if is_valid_session_id(val) {
                forward_headers.insert(
                    X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                    val.to_ascii_lowercase(),
                );
            } else {
                return error::invalid_request("Invalid session id");
            }
        }

        // No span here, so the caller's traceparent joins the agent's spans to its trace.
        if let Some(traceparent) = &auth_data.traceparent
            && !traceparent.is_empty()
        {
            forward_headers.insert("traceparent".to_string(), traceparent.clone());
        }

        if let Some(user_agent) = parts.headers.get("user-agent")
            && let Ok(val) = user_agent.to_str()
        {
            forward_headers.insert("user-agent".to_string(), val.to_string());
        }

        // Merged last and never overriding the headers set above.
        for (key, value) in passthrough_headers {
            forward_headers.entry(key).or_insert(value);
        }

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(&forward_headers)
        };

        return match client
            .query_with_headers(agent_type, query_req, &auth_str, headers_to_forward)
            .await
        {
            Ok(response) => {
                #[cfg(feature = "cloud")]
                if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
                    org_id_str,
                    openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
                    &usage_ctx,
                )
                .await
                {
                    return post_upstream_authorization_error(error).into_response();
                }
                let prompt_response = PromptResponse {
                    role: Role::Assistant,
                    content: response.response,
                };
                (StatusCode::OK, Json(prompt_response)).into_response()
            }
            Err(error) => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent query failed: {error}"
                );
                upstream_error(&error).into_response()
            }
        };
    }
}

/// The body of [`chat_stream`]: admission, the charge and the metered stream.
async fn stream_turn(
    org_id: String,
    parts: axum::http::request::Parts,
    body: Body,
    auth_data: TraceInfo,
    trace_id: String,
) -> Response {
    let user_id = auth_data.user_id.clone();

    // OTel API directly: tracing-opentelemetry spans in async_stream! are not exported.
    #[cfg(feature = "enterprise")]
    let otel_chat_span = {
        if get_o2_config().ai.tracing_enabled {
            use opentelemetry::trace::{SpanKind, TraceContextExt, Tracer};

            // Extract parent context from incoming traceparent header
            let parent_cx = opentelemetry::global::get_text_map_propagator(|propagator| {
                propagator.extract(&common::utils::http::RequestHeaderExtractor::new(
                    &parts.headers,
                ))
            });

            // Create the span as a child of the incoming request
            let tracer = opentelemetry::global::tracer("openobserve");
            let span = tracer
                .span_builder("ai.chat_stream")
                .with_kind(SpanKind::Server)
                .with_attributes(vec![
                    opentelemetry::KeyValue::new("http.method", "POST"),
                    opentelemetry::KeyValue::new("http.route", "/api/{org_id}/ai/chat_stream"),
                    opentelemetry::KeyValue::new(
                        "http.target",
                        format!("/api/{}/ai/chat_stream", org_id),
                    ),
                    opentelemetry::KeyValue::new("trace_id", trace_id.clone()),
                    opentelemetry::KeyValue::new("user_id", user_id.clone()),
                    opentelemetry::KeyValue::new("org_id", org_id.clone()),
                ])
                .start_with_context(&tracer, &parent_cx);

            // Build the context with this span so we can inject a traceparent for downstream
            let span_cx = parent_cx.with_span(span);
            Some(span_cx)
        } else {
            None
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let otel_chat_span: Option<opentelemetry::Context> = None;

    let mut forward_headers = std::collections::HashMap::new();

    // The browser's id for this turn, so a retried request does not run the model twice.
    let persist_turn_id = parts
        .headers
        .get(X_O2_ASSISTANT_TURN_ID.as_str())
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // Extract and validate session ID (UUID v7 format: 8-4-4-4-12 hex digits)
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            // One chat per UUID whatever its spelling: the id keys the index row and the routing.
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_ascii_lowercase(),
            );
        } else {
            // Rejected, not dropped: an arbitrary replica would read as the assistant forgetting.
            log::warn!("[trace_id:{}] Invalid session ID format: {}", trace_id, val);
            return error::invalid_request("Invalid session id");
        }
    }

    // A traceparent from the ai.chat_stream span, so the agent's parent is this span.
    if let Some(ref span_cx) = otel_chat_span {
        let mut injected_headers = std::collections::HashMap::new();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(span_cx, &mut injected_headers);
        });
        if let Some(tp) = injected_headers.remove("traceparent") {
            log::info!(
                "[trace_id:{}] Forwarding traceparent from ai.chat_stream span: {}",
                trace_id,
                tp
            );
            forward_headers.insert("traceparent".to_string(), tp);
        }
    } else if let Some(traceparent) = &auth_data.traceparent
        && !traceparent.is_empty()
    {
        // Fallback: forward original traceparent when tracing is disabled
        forward_headers.insert("traceparent".to_string(), traceparent.clone());
    }

    if let Some(user_agent) = parts.headers.get("user-agent")
        && let Ok(val) = user_agent.to_str()
    {
        forward_headers.insert("user-agent".to_string(), val.to_string());
    }

    // Extract and merge passthrough headers from config
    #[cfg(feature = "enterprise")]
    {
        let passthrough_config = ""; // TODO: Replace with _config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);
        // Never overrides a header already set (session id, traceparent).
        for (key, value) in passthrough_headers {
            forward_headers.entry(key).or_insert(value);
        }
    }

    // Log correlation context for debugging
    log::info!(
        "[trace_id:{}] AI chat request: user_id={}, session_id={}",
        trace_id,
        user_id,
        forward_headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .map(String::as_str)
            .unwrap_or("none")
    );

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return error::invalid_request(format!("Failed to read request body: {}", e));
        }
    };

    let prompt_body: PromptRequest = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return error::invalid_request(format!("Invalid JSON body: {}", e));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        let org_id_str = org_id.clone();
        let audit = TurnAudit::new(
            &org_id_str,
            &user_id,
            &trace_id,
            forward_headers
                .get(X_O2_ASSISTANT_SESSION_ID.as_str())
                .map(String::as_str),
            persist_turn_id.as_deref(),
            Some(&prompt_body),
            body_bytes.len(),
        )
        .delegated_by(parts.extensions.get::<DelegatedCaller>(), &parts.headers);

        // Check if AI/agent is enabled
        if !get_o2_config().ai.enabled {
            audit
                .report(StatusCode::BAD_REQUEST, Some("AI is not enabled"))
                .await;
            return not_enabled_error();
        }
        if let Err(refusal) = super::settings::refuse_if_off(&org_id_str).await {
            audit
                .report(
                    StatusCode::BAD_REQUEST,
                    Some("AI is off for this organization"),
                )
                .await;
            return refusal;
        }
        if let Err(refusal) = refuse_if_unreachable(&org_id_str) {
            audit
                .report(
                    StatusCode::SERVICE_UNAVAILABLE,
                    Some("O2 Assistant is known to be unreachable"),
                )
                .await;
            return refusal;
        }
        let session = forward_headers.get(X_O2_ASSISTANT_SESSION_ID.as_str());
        if let Err(refusal) =
            refuse_turn_mode(&org_id_str, &prompt_body, session.map(String::as_str)).await
        {
            audit
                .report(refusal.status(), Some("Mode or ephemeral turn refused"))
                .await;
            return refusal;
        }
        let model = Ai::model_override(&prompt_body.model).map(str::to_string);
        if !get_o2_config()
            .ai
            .allows_model(model.as_deref().unwrap_or_default(), None)
        {
            audit
                .report(StatusCode::BAD_REQUEST, Some("Model override not allowed"))
                .await;
            return model_not_allowed_error();
        }

        // Quota is checked here; the credit is deducted only once o2-ai accepted the turn.
        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::precheck_ai_usage(
            &org_id_str,
            openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
            &user_id,
        )
        .await
        {
            return ai_authorization_error_response(error);
        }

        // Get global agent client
        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                audit
                    .report(
                        StatusCode::BAD_REQUEST,
                        Some("Agent service not configured"),
                    )
                    .await;
                return agent_not_configured_error();
            }
        };

        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        // Auth header is passed directly to agent - no need to extract user_token
        let replaces_turn_id = prompt_body.replaces_turn_id.clone();

        // Transform PromptRequest -> QueryRequest
        let last_user_message = prompt_body
            .messages
            .iter()
            .rfind(|m| m.role == Role::User)
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let history: Vec<serde_json::Value> = prompt_body
            .messages
            .iter()
            .take(prompt_body.messages.len().saturating_sub(1))
            .map(|m| {
                serde_json::json!({
                    "role": format!("{:?}", m.role).to_lowercase(),
                    "content": m.content
                })
            })
            .collect();

        let delegated = parts.extensions.get::<DelegatedCaller>().is_some();
        let context = agent_context(&prompt_body.context, &org_id_str, delegated);

        // An existing chat keeps its stored agent; resolve before context moves into QueryRequest.
        let (agent_type, context) = turn_agent_and_context(
            &org_id_str,
            &user_id,
            forward_headers
                .get(X_O2_ASSISTANT_SESSION_ID.as_str())
                .map(String::as_str),
            context,
            prompt_body.mode,
        )
        .await;

        // Convert images to agent format
        let images = prompt_body.images.map(|imgs| {
            imgs.into_iter()
                .map(|img| ImageAttachment {
                    data: img.data,
                    mime_type: img.mime_type,
                    filename: img.filename,
                })
                .collect()
        });

        let (tool_mcps, tool_clis, tool_skills) =
            o2_enterprise::enterprise::ai::toolsets::push::load_agent_tools(&org_id_str).await;
        let (tool_mcps, tool_clis) = turn_tools(prompt_body.mode, tool_mcps, tool_clis);
        let session = forward_headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .map(String::as_str);
        let policy = super::settings::turn_policy(&org_id_str, &user_id, session).await;
        let query_req = with_policy(
            QueryRequest {
                model,
                history: if history.is_empty() {
                    None
                } else {
                    Some(history)
                },
                images,
                mcps: if tool_mcps.is_empty() {
                    None
                } else {
                    Some(tool_mcps)
                },
                clis: if tool_clis.is_empty() {
                    None
                } else {
                    Some(tool_clis)
                },
                skills: if tool_skills.is_empty() {
                    None
                } else {
                    Some(tool_skills)
                },
                // Set by persistence admission below; absent, o2-ai streams as before.
                turn_id: None,
                known_seq: None,
                known_opencode_session_id: None,
                session_epoch: None,
                mode: prompt_body.mode.map(|mode| mode.as_str().to_string()),
                ephemeral: prompt_body.ephemeral,
                attachments: forwarded_attachments(prompt_body.attachments),
                confirm_timeout_secs: confirm_timeout(prompt_body.confirm_timeout_secs),
                ..QueryRequest::new(last_user_message, context)
            },
            &policy,
        );

        let turn = StreamTurn {
            org_id: org_id_str,
            user_id,
            trace_id,
            turn_id: persist_turn_id,
            replaces_turn_id,
            agent_type,
            query: query_req,
            auth: auth_str,
            auth_session_id: super::chats::login_key(&parts.headers),
            forward_headers: if forward_headers.is_empty() {
                None
            } else {
                Some(forward_headers)
            },
            client,
            span: otel_chat_span,
            audit,
        };
        // With persistence on, a background task owns the turn; a closed tab drops only its feed.
        if persists_turn(
            o2_enterprise::enterprise::ai::chat::is_enabled(),
            &turn.query,
        ) {
            persisted_turn(turn).await
        } else {
            direct_turn(turn).await
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(auth_data);
        drop(trace_id);
        drop(user_id);
        drop(prompt_body);
        drop(body_bytes);
        drop(persist_turn_id);
        error::not_enabled("AI chat is only available in enterprise version")
    }
}

/// Admits a persisted turn, takes its credit before o2-ai runs and streams it; no content refunds.
#[cfg(feature = "enterprise")]
async fn persisted_turn(turn: StreamTurn) -> Response {
    let StreamTurn {
        org_id,
        user_id,
        trace_id,
        turn_id,
        replaces_turn_id,
        agent_type,
        query: mut query_req,
        auth,
        auth_session_id,
        forward_headers,
        client,
        span,
        mut audit,
    } = turn;
    let session_id = forward_headers
        .as_ref()
        .and_then(|h| h.get(X_O2_ASSISTANT_SESSION_ID.as_str()))
        .cloned();
    if query_req.query.trim().is_empty() && query_req.images.as_ref().is_none_or(|i| i.is_empty()) {
        return error::invalid_request("The message is empty");
    }
    // Read before admission so a failed read leaves the turn retryable.
    let fork_seed =
        match super::shares::first_turn_seed(&org_id, session_id.as_deref(), &user_id).await {
            Ok(seed) => seed,
            Err(resp) => return resp,
        };
    let replaced = match replaced_turn(
        &org_id,
        &user_id,
        session_id.as_deref(),
        replaces_turn_id.as_deref(),
    )
    .await
    {
        Ok(replaced) => replaced,
        Err(resp) => return resp,
    };
    // The switch is read again at admission, so no caller skips it.
    if let Err(refusal) = super::settings::refuse_if_off(&org_id).await {
        return refusal;
    }
    let admitted = match openobserve_core::ai_chat::admission::admit_signed_in_turn(
        &org_id,
        session_id.as_deref(),
        turn_id.as_deref(),
        &user_id,
        auth_session_id.as_deref(),
        agent_type,
        &query_req.query,
        &trace_id,
        TurnCaps::from_config(),
    )
    .await
    {
        Ok(admitted) => admitted,
        Err(e) => {
            return super::chats::turn_admit_error_response(e, &org_id, session_id.as_deref())
                .await;
        }
    };
    audit.turn_id = Some(admitted.turn_id.clone());
    // Charged before o2-ai can commit anything, so a refusal leaves no answer in the history.
    let mut charge = TurnCharge::new(
        &org_id,
        &user_id,
        &trace_id,
        Some(&admitted.row.session_id),
        &admitted.turn_id,
    );
    if let Err(refusal) = charge.charge().await {
        openobserve_core::ai_chat::admission::abandon_turn(admitted, "usage_denied").await;
        audit
            .report(
                refusal.http_status(),
                Some("AI credit authorization failed"),
            )
            .await;
        return refusal.into_response();
    }
    openobserve_core::ai_chat::admission::apply_admission(&mut query_req, &admitted);
    let openobserve_core::ai_chat::admission::AdmittedTurn {
        row,
        owner,
        turn_id,
        lease,
        registration,
    } = admitted;
    audit.report(StatusCode::OK, None).await;
    let session_id = row.session_id.clone();
    if row.last_committed_seq == infra::table::ai_chat_sessions::NO_SEQ
        && let Some(seed) = fork_seed
    {
        query_req.history = Some(seed);
        if let Some(context) = query_req.context.as_object_mut() {
            context.insert(FORK_SEED_CONTEXT_KEY.to_string(), true.into());
        }
    }
    if let Some(replaced) = &replaced {
        version_turn(&row, &turn_id, replaced, &mut query_req).await;
    }

    let meter = TurnMeter::new(
        TurnPhase::charged(),
        charge,
        Some((session_id.clone(), turn_id.clone())),
    );
    let (stop_org, stop_session, stop_auth) = (org_id.clone(), session_id.clone(), auth.clone());
    let (stop_turn, stop_user) = (Some(turn_id.clone()), user_id.clone());
    let stop = move || {
        tokio::spawn(cancel_turn(
            stop_org,
            stop_session,
            stop_turn,
            stop_auth,
            stop_user,
            o2_enterprise::enterprise::ai::chat::is_enabled(),
        ));
    };
    let toolset_use = super::toolsets::ToolsetUse::load(&org_id).await;
    let turn_mark = super::turn_marks::mark_turn(&org_id, &session_id, &user_id).await;
    let confirmations = super::turn_marks::ConfirmationWatch::new(&org_id, &session_id, &user_id);
    let mut settings = PersistSettings::from_config();
    settings.owner_wait = owner_wait_for(
        super::capabilities::cached_health(&org_id),
        settings.owner_wait,
    );
    let store = std::sync::Arc::new(openobserve_core::ai_chat::StreamChatStore::new(
        settings.retention_days,
    ));
    let rx = spawn_turn(
        TurnSpec {
            identity: TurnIdentity {
                org_id,
                session_id,
                user_id: owner,
                agent_type,
                turn_id,
                trace_id,
                epoch: row.session_epoch,
                last_committed_seq: row.last_committed_seq,
                opencode_session_id: row.opencode_session_id,
            },
            request: query_req,
            auth_header: auth,
            forward_headers,
            client,
            store,
            lease,
            registration,
            // The span outlives this response, so the task ends it.
            on_end: Some(turn_end(span, turn_mark)),
            on_commit: None,
        },
        settings,
    );
    let frames = futures::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|chunk| (chunk, rx))
    })
    .inspect(move |chunk| {
        super::capabilities::note_turn_frame(chunk);
        toolset_use.note(chunk);
        confirmations.note(chunk);
    });
    let (body, _metering) = meter_persisted_turn(frames, meter, stop);
    sse_response(Body::from_stream(body))
}

/// A turn is refused at once while the health cache knows o2-ai is unreachable; nothing is charged.
#[cfg(feature = "enterprise")]
fn refuse_if_unreachable(org_id: &str) -> Result<(), Response> {
    admit_with_health(super::capabilities::cached_health(org_id))
}

/// See [`refuse_if_unreachable`]: only a known outage refuses; unknown and ok health admit.
#[cfg(feature = "enterprise")]
fn admit_with_health(health: super::capabilities::HealthStatus) -> Result<(), Response> {
    if health == super::capabilities::HealthStatus::Unreachable {
        return Err(AiErrorEnvelope::new(
            AiErrorCode::AgentUnavailable,
            "The AI assistant is unavailable right now; please retry",
        )
        .into_response());
    }
    Ok(())
}

/// The wait for a replacement o2-ai owner: configured while health is ok, short while unknown.
#[cfg(feature = "enterprise")]
fn owner_wait_for(
    health: super::capabilities::HealthStatus,
    configured: std::time::Duration,
) -> std::time::Duration {
    match health {
        super::capabilities::HealthStatus::Ok => configured,
        _ => configured.min(UNKNOWN_HEALTH_OWNER_WAIT),
    }
}

/// The persisted turn task's end: it, not the browser's stream, ends the span and drops the mark.
#[cfg(feature = "enterprise")]
fn turn_end(
    span: Option<opentelemetry::Context>,
    mark: super::turn_marks::TurnMark,
) -> Box<dyn FnOnce(TurnEnd) + Send> {
    Box::new(move |_end: TurnEnd| {
        drop(mark);
        if let Some(span_cx) = span {
            use opentelemetry::trace::TraceContextExt;
            span_cx.span().end();
        }
    })
}

/// Streams a turn straight from o2-ai; its answering is the acceptance that takes the credit.
#[cfg(feature = "enterprise")]
async fn direct_turn(turn: StreamTurn) -> Response {
    let StreamTurn {
        org_id,
        user_id,
        trace_id,
        turn_id,
        agent_type,
        query,
        auth,
        auth_session_id,
        forward_headers,
        client,
        span,
        audit,
        ..
    } = turn;
    let end_span = |span: &Option<opentelemetry::Context>| {
        if let Some(span_cx) = span.as_ref() {
            use opentelemetry::trace::TraceContextExt;
            span_cx.span().end();
        }
    };
    let ephemeral = query.ephemeral;
    // Without the browser's turn id the trace id keys the refund; both are unique per request.
    let charge_key = turn_id
        .as_deref()
        .and_then(openobserve_core::ai_chat::admission::normalize_uuid)
        .unwrap_or_else(|| trace_id.clone());
    let ephemeral_registration = if ephemeral {
        let session_id = forward_headers
            .as_ref()
            .and_then(|h| h.get(X_O2_ASSISTANT_SESSION_ID.as_str()));
        match register_ephemeral_turn(
            &org_id,
            session_id.map(String::as_str),
            &charge_key,
            &user_id,
            auth_session_id.as_deref(),
        ) {
            Ok(registration) => Some(registration),
            Err(refusal) => {
                end_span(&span);
                audit
                    .report(refusal.status(), Some("Active-turn limit reached"))
                    .await;
                return refusal;
            }
        }
    } else {
        None
    };
    // The upstream accepts before headers or usage go out, so startup errors keep statuses.
    let response = match client
        .query_stream_with_headers(agent_type, query, &auth, forward_headers.as_ref())
        .await
    {
        Ok(response) => response,
        Err(e) => {
            log::error!(
                "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id}] \
                 Agent query failed: {e}"
            );
            let refusal = upstream_error(&e);
            end_span(&span);
            audit
                .report(refusal.http_status(), Some("Upstream AI request failed"))
                .await;
            return refusal.into_response();
        }
    };

    let session_id = forward_headers
        .as_ref()
        .and_then(|h| h.get(X_O2_ASSISTANT_SESSION_ID.as_str()));
    let mut charge = TurnCharge::new(
        &org_id,
        &user_id,
        &trace_id,
        session_id.map(String::as_str),
        &charge_key,
    );
    if let Err(refusal) = charge.charge().await {
        end_span(&span);
        audit
            .report(
                refusal.http_status(),
                Some("AI credit authorization failed after upstream acceptance"),
            )
            .await;
        return refusal.into_response();
    }
    audit.report(StatusCode::OK, None).await;
    // A Stop of this turn is only forwarded for its own user (`direct_stop_target`).
    let registration = ephemeral_registration.or_else(|| {
        session_id
            .filter(|sid| is_valid_session_id(sid))
            .map(|sid| {
                o2_enterprise::enterprise::ai::chat::registry::register(
                    &org_id,
                    &sid.to_ascii_lowercase(),
                    &charge_key,
                    &user_id,
                    None,
                )
            })
    });

    let mut meter = TurnMeter::new(TurnPhase::charged(), charge, None);
    let toolset_use = super::toolsets::ToolsetUse::load(&org_id).await;
    let session = session_id
        .filter(|sid| is_valid_session_id(sid))
        .map(|sid| sid.to_ascii_lowercase());
    // An ephemeral turn leaves no row behind, not even a turn mark; it never asks to confirm.
    let (turn_mark, confirmations) = match session.as_ref().filter(|_| !ephemeral) {
        Some(sid) => (
            Some(super::turn_marks::mark_turn(&org_id, sid, &user_id).await),
            Some(super::turn_marks::ConfirmationWatch::new(
                &org_id, sid, &user_id,
            )),
        ),
        None => (None, None),
    };
    // Keep the OTel span alive for the full stream.
    let s = async_stream::stream! {
        let _registration = registration;
        let _turn_mark = turn_mark;
        let mut agent_stream = response.bytes_stream();
        while let Some(chunk_result) = agent_stream.next().await {
            let out = match chunk_result {
                Ok(bytes) => {
                    toolset_use.note(&bytes);
                    if let Some(confirmations) = &confirmations {
                        confirmations.note(&bytes);
                    }
                    meter.feed(&bytes).await
                }
                Err(e) => {
                    log::error!(
                        "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id}] \
                         Agent stream chunk error: {e}"
                    );
                    let out = meter.interrupt(stream_interrupted_error().to_sse_frame()).await;
                    for chunk in out {
                        yield Ok::<Bytes, std::io::Error>(chunk);
                    }
                    break;
                }
            };
            for chunk in out {
                yield Ok::<Bytes, std::io::Error>(chunk);
            }
            if meter.refused() {
                break;
            }
        }
        for chunk in meter.finish().await {
            yield Ok::<Bytes, std::io::Error>(chunk);
        }
        log::info!(
            "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id}] \
             Agent stream ended"
        );
        // The BatchSpanProcessor exports a span only once it has ended.
        end_span(&span);
    };
    sse_response(Body::from_stream(s))
}

/// An ephemeral turn writes no row, so `admit_turn`'s active-turn caps are taken here, per node.
#[cfg(feature = "enterprise")]
fn register_ephemeral_turn(
    org_id: &str,
    session_id: Option<&str>,
    turn_key: &str,
    user_id: &str,
    auth_session_id: Option<&str>,
) -> Result<o2_enterprise::enterprise::ai::chat::registry::Registration, Response> {
    use o2_enterprise::enterprise::ai::chat::registry;

    // Without a session the turn key stands in, so the turn still counts against the caps.
    let key = session_id
        .filter(|sid| is_valid_session_id(sid))
        .map_or_else(|| turn_key.to_string(), str::to_ascii_lowercase);
    registry::register_capped(
        org_id,
        &key,
        turn_key,
        user_id,
        auth_session_id,
        registry::TurnCaps::from_config(),
    )
    .map_err(super::chats::turn_limit_response)
}

/// Meters a persisted turn and reads on after the browser leaves, so a background turn still pays.
#[cfg(feature = "enterprise")]
fn meter_persisted_turn(
    frames: impl futures::Stream<Item = Bytes> + Send + 'static,
    mut meter: TurnMeter,
    stop: impl FnOnce() + Send + 'static,
) -> (
    impl futures::Stream<Item = Result<Bytes, std::io::Error>>,
    tokio::task::JoinHandle<TurnMeter>,
) {
    let (tx, mut body_rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();
    let pending = Arc::new(AtomicUsize::new(0));
    let queued = pending.clone();
    let metering = tokio::spawn(async move {
        let mut frames = Box::pin(frames);
        let mut browser = Some(tx);
        let mut stop = Some(stop);
        while let Some(chunk) = frames.next().await {
            let out = meter.feed(&chunk).await;
            send_to_browser(&mut browser, &queued, out);
            if meter.refused()
                && let Some(stop) = stop.take()
            {
                // The turn may not run on uncharged; it stops as a user's Stop would.
                stop();
                browser = None;
            }
        }
        let out = meter.finish().await;
        send_to_browser(&mut browser, &queued, out);
        meter
    });
    let body = async_stream::stream! {
        while let Some(chunk) = body_rx.recv().await {
            pending.fetch_sub(chunk.len(), Ordering::SeqCst);
            yield Ok::<Bytes, std::io::Error>(chunk);
        }
    };
    (body, metering)
}

/// A closed or lagging browser is dropped, never waited for, as the turn's own feed does.
#[cfg(feature = "enterprise")]
fn send_to_browser(
    browser: &mut Option<tokio::sync::mpsc::UnboundedSender<Bytes>>,
    pending: &AtomicUsize,
    out: Vec<Bytes>,
) {
    for chunk in out {
        let Some(tx) = browser.as_ref() else {
            return;
        };
        let len = chunk.len();
        if pending.load(Ordering::SeqCst) + len > BROWSER_MAX_PENDING_BYTES
            || tx.send(chunk).is_err()
        {
            *browser = None;
            return;
        }
        pending.fetch_add(len, Ordering::SeqCst);
    }
}

/// The `type` named in the head of an oversized frame; empty, so counted as content, if unread.
#[cfg(feature = "enterprise")]
fn head_frame_type(line: &[u8]) -> String {
    const KEY: &str = "\"type\"";
    let head = String::from_utf8_lossy(&line[..line.len().min(SSE_HEAD_BYTES)]);
    head.find(KEY)
        .and_then(|at| head[at + KEY.len()..].trim_start().strip_prefix(':'))
        .and_then(|value| value.trim_start().strip_prefix('"'))
        .and_then(|value| value.split_once('"'))
        .map(|(frame_type, _)| frame_type.to_string())
        .unwrap_or_default()
}

/// The JSON object of one `data:` line; `None` for comments, blank lines and unparsable data.
#[cfg(feature = "enterprise")]
fn data_frame(line: &[u8]) -> Option<serde_json::Map<String, Value>> {
    let text = std::str::from_utf8(line).ok()?;
    let data = text.strip_prefix("data:")?.trim();
    match serde_json::from_str::<Value>(data).ok()? {
        Value::Object(frame) => Some(frame),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn paid_overage_denial_is_a_structured_precondition_response() {
        use openobserve_core::trial_quota::{
            AiUsageAuthorizationError, PaidOverageBillingStatus, PaidOverageOrganizationStatus,
            PaidOverageStatus,
        };

        let response = ai_authorization_error_response(
            AiUsageAuthorizationError::PaidOverageConsentRequired(Box::new(PaidOverageStatus {
                feature: "ai_credits".to_string(),
                organization: PaidOverageOrganizationStatus {
                    org_id: "member".to_string(),
                    enabled: false,
                    can_manage: true,
                    enabled_by: None,
                    disabled_by: None,
                },
                payer: Some(PaidOverageOrganizationStatus {
                    org_id: "payer".to_string(),
                    enabled: false,
                    can_manage: false,
                    enabled_by: None,
                    disabled_by: None,
                }),
                effective: false,
                billing_status: PaidOverageBillingStatus::Eligible,
            })),
        );

        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error_type"], "paid_overage_consent_required");
        assert_eq!(body["consent"]["feature"], "ai_credits");
        assert_eq!(body["consent"]["organization"]["org_id"], "member");
        assert_eq!(body["consent"]["payer"]["org_id"], "payer");
        let serialized = body.to_string();
        assert!(!serialized.contains("ai_chat"));
        assert!(!serialized.contains("new_incident"));
        assert!(!serialized.contains("incident_reanalysis"));
    }

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn payment_required_carries_its_remedy() {
        use openobserve_core::trial_quota::{AiUsageAuthorizationError, PaymentRemedy};

        for (remedy, expected) in [
            (PaymentRemedy::Subscribe, "subscribe"),
            (
                PaymentRemedy::ContactAccountManager,
                "contact_account_manager",
            ),
            (PaymentRemedy::Retry, "retry"),
        ] {
            let response =
                ai_authorization_error_response(AiUsageAuthorizationError::PaymentRequired {
                    message: "out".to_string(),
                    remedy,
                    payer_org_id: Some("payer".to_string()),
                });
            assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["error_type"], "ai_credits_exhausted");
            assert_eq!(body["remedy"], expected);
            assert_eq!(body["message"], "out");
            assert_eq!(body["payer_org_id"], "payer");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn upstream_owner_unavailable_maps_to_recoverable_conflict() {
        let error = o2_enterprise::enterprise::ai::client::session_owner_unavailable(
            "01234567-89ab-cdef-0123-456789abcdef",
        );
        let response = upstream_error(&error).into_response();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = body_of(response).await;
        assert_eq!(body["code"], SESSION_OWNER_UNAVAILABLE);
        assert_eq!(body["error_code"], SESSION_OWNER_UNAVAILABLE);
        assert_eq!(body["retryable"], true);
        assert!(
            !body.to_string().contains("01234567"),
            "upstream text stays in the logs"
        );
    }

    async fn body_of(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_provider_429_is_rate_limited_with_retry_after_not_the_turn_limit() {
        let response = upstream_failure(false, false, Some(429), Some(42), None).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[axum::http::header::RETRY_AFTER], "42");
        let body = body_of(response).await;
        assert_eq!(body["code"], "rate_limited");
        assert_eq!(body["retry_after"], 42);
        assert!(
            body.get("error_code").is_none(),
            "never the turn limit's error_code"
        );
        let turn_limit = body_of(super::super::chats::turn_limit_response("user")).await;
        assert_eq!(turn_limit["code"], "turn_limit");
        assert_ne!(turn_limit["code"], body["code"]);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn o2_ai_down_is_agent_unavailable_and_its_transport_text_is_not_sent() {
        for status in [None, Some(502), Some(503), Some(504)] {
            let response =
                upstream_failure(false, status.is_none(), status, None, None).into_response();
            assert_eq!(
                response.status().as_u16(),
                status.unwrap_or(502),
                "{status:?}"
            );
            let body = body_of(response).await;
            assert_eq!(body["code"], "agent_unavailable");
            assert_eq!(body["retryable"], true);
        }
        let busy = body_of(
            upstream_failure(false, false, Some(409), None, Some("turn_in_progress"))
                .into_response(),
        )
        .await;
        assert_eq!(busy["code"], "turn_busy");
        assert_eq!(busy["retryable"], false);
        assert_eq!(busy["action"], "none");
        let crashed = upstream_failure(false, false, Some(500), None, None).into_response();
        assert_eq!(crashed.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let crashed = body_of(crashed).await;
        assert_eq!(crashed["code"], "internal", "as the persisted path says");
        // Reached but answered nothing usable (read timeout, bad body): not an outage.
        let garbled =
            body_of(upstream_failure(false, false, None, None, None).into_response()).await;
        assert_eq!(garbled["code"], "internal");
        assert_eq!(garbled["retryable"], false);
        assert_eq!(garbled["action"], "none");
        let decode = upstream_error(&anyhow::anyhow!("error decoding response body"));
        assert_eq!(
            decode.code(),
            AiErrorCode::Internal,
            "no status, yet o2-ai was reached"
        );
        assert_eq!(crashed["retryable"], false);

        let frame = stream_interrupted_error().to_sse_frame();
        let frame = data_frame(frame.split(|b| *b == b'\n').next().unwrap()).unwrap();
        assert_eq!(frame["code"], "agent_unavailable");
        assert_eq!(frame["retryable"], true);
        assert!(
            !frame["message"]
                .as_str()
                .unwrap()
                .contains("Stream interrupted:")
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn o2_ai_refusing_the_session_is_permission_denied_as_history_reads_say() {
        for status in [401, 403] {
            let response = upstream_failure(false, false, Some(status), None, None).into_response();
            assert_eq!(response.status().as_u16(), status);
            let body = body_of(response).await;
            assert_eq!(body["code"], "permission_denied", "{status}");
            assert_eq!(body["action"], "ask_admin", "{status}");
        }
        assert_eq!(
            AiErrorCode::from_stored("unauthorized"),
            Some(AiErrorCode::PermissionDenied)
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_unlisted_model_is_an_invalid_request_that_does_not_echo_it() {
        let response = model_not_allowed_error();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = body_of(response).await;
        assert_eq!(body["code"], "invalid_request");
        assert_eq!(body["action"], "none");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn content_settles_the_charge_and_is_never_uncharged() {
        let mut phase = TurnPhase::charged();
        assert_eq!(phase.observe("status"), ChargeStep::Nothing);
        assert_eq!(phase.observe("title"), ChargeStep::Nothing);
        assert_eq!(phase.observe("message_delta"), ChargeStep::Settle);
        assert_eq!(phase.observe("message_delta"), ChargeStep::Nothing);
        assert_eq!(phase.observe("error"), ChargeStep::Nothing);
        assert_eq!(
            phase.observe("complete"),
            ChargeStep::Nothing,
            "content was shown"
        );
        assert_eq!(phase.end(), ChargeStep::Nothing);

        // Every frame sequence: no shown frame is observed while the turn is uncharged.
        let frames = [
            "status",
            "message_delta",
            "error",
            "complete",
            "confirmation_required",
            "title",
            "findings",
        ];
        for a in frames {
            for b in frames {
                for c in frames {
                    for start in [TurnPhase::charged(), TurnPhase::default()] {
                        let mut phase = start;
                        for frame in [a, b, c] {
                            phase.observe(frame);
                            let shown = !BOOKKEEPING_FRAMES.contains(&frame)
                                && !FINAL_FRAMES.contains(&frame)
                                && frame != "error";
                            if shown {
                                assert!(phase.charged, "{a} {b} {c}");
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn any_frame_the_browser_shows_keeps_the_credit() {
        for shown in [
            "confirmation_required",
            "navigation_action",
            "findings",
            "query",
            "permission_denied",
            "a_type_from_a_newer_agent",
            "",
        ] {
            let mut phase = TurnPhase::charged();
            phase.observe("status");
            assert_eq!(phase.observe(shown), ChargeStep::Settle, "{shown:?}");
            assert_eq!(phase.observe("complete"), ChargeStep::Nothing, "{shown:?}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_turn_that_fails_before_content_is_refunded_once() {
        let mut failed = TurnPhase::charged();
        assert_eq!(failed.observe("status"), ChargeStep::Nothing);
        assert_eq!(
            failed.observe("error"),
            ChargeStep::Nothing,
            "content may still follow an error"
        );
        assert_eq!(failed.observe("complete"), ChargeStep::Refund);
        assert_eq!(
            failed.observe("cancelled"),
            ChargeStep::Nothing,
            "refunded once"
        );
        assert_eq!(failed.end(), ChargeStep::Nothing);
        assert_eq!(
            failed.observe("message_delta"),
            ChargeStep::ChargeAndSettle,
            "late content is charged again"
        );

        let mut dropped = TurnPhase::charged();
        assert_eq!(dropped.observe("status"), ChargeStep::Nothing);
        assert_eq!(dropped.end(), ChargeStep::Refund);
        assert_eq!(dropped.end(), ChargeStep::Nothing);

        let mut never = TurnPhase::default();
        assert_eq!(never.observe("error"), ChargeStep::Nothing);
        assert_eq!(never.end(), ChargeStep::Nothing, "nothing to refund");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn sse_lines_are_split_whole_across_chunks() {
        let mut lines = SseLines::default();
        assert!(lines.push(b"data: {\"type\":").is_empty());
        let out = lines.push(b"\"status\"}\n\ndata: x");
        assert_eq!(
            out,
            vec![
                SseLine::Whole(Bytes::from("data: {\"type\":\"status\"}\n")),
                SseLine::Whole(Bytes::from("\n")),
            ]
        );
        assert_eq!(lines.take_partial(), Some(Bytes::from("data: x\n\n")));
        assert_eq!(lines.take_partial(), None);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_oversized_line_is_classified_by_its_head_and_a_complete_one_is_held() {
        let big = "x".repeat(SSE_LINE_MAX_BYTES);
        let mut lines = SseLines::default();
        let head = format!("data: {{\"type\": \"tool_result\", \"output\": \"{big}");
        let out = lines.push(head.as_bytes());
        assert_eq!(out.len(), 1);
        assert!(matches!(
            &out[0],
            SseLine::Piece { head_type: Some(t), .. } if t == "tool_result"
        ));
        let out = lines.push(b"tail\"}\n\n");
        assert!(matches!(
            &out[0],
            SseLine::Piece {
                head_type: None,
                ..
            }
        ));
        assert_eq!(out[1], SseLine::Whole(Bytes::from("\n")));

        let mut lines = SseLines::default();
        let complete = format!("data: {{\"type\":\"complete\",\"history\":\"{big}");
        assert!(
            lines.push(complete.as_bytes()).is_empty(),
            "held to add credits"
        );
        let out = lines.push(b"\"}\n");
        assert!(matches!(&out[0], SseLine::Whole(_)));
        assert_eq!(head_frame_type(b"data: {\"a\":1}"), "");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn oversized_content_still_counts_as_content() {
        let mut meter = test_meter(1);
        let big = "x".repeat(SSE_LINE_MAX_BYTES);
        let frame = format!("data: {{\"type\":\"message_delta\",\"text\":\"{big}\"}}\n\n");
        meter.feed(frame.as_bytes()).await;
        assert!(meter.phase.content);
        assert_eq!(meter.finish().await, Vec::<Bytes>::new());
        assert_eq!(meter.charge.credits, 1, "not refunded");
    }

    #[cfg(feature = "enterprise")]
    fn test_meter(credits: u64) -> TurnMeter {
        let mut charge = TurnCharge::new("org", "u@x", "trace", None, "turn");
        charge.credits = credits;
        TurnMeter::new(TurnPhase::charged(), charge, None)
    }

    #[cfg(feature = "enterprise")]
    fn frames_of(out: &[Bytes]) -> Vec<serde_json::Map<String, Value>> {
        out.iter().filter_map(|line| data_frame(line)).collect()
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn complete_says_what_the_turn_cost() {
        let mut meter = test_meter(1);
        let out = meter
            .feed(b"data: {\"type\":\"message_delta\",\"text\":\"hi\"}\n\ndata: {\"type\":\"complete\",\"usage\":{\"total_tokens\":5}}\n\n")
            .await;
        let frames = frames_of(&out);
        assert_eq!(frames[1]["usage"]["credits"], 1);
        assert_eq!(frames[1]["usage"]["total_tokens"], 5);
        assert_eq!(
            out[0],
            Bytes::from("data: {\"type\":\"message_delta\",\"text\":\"hi\"}\n"),
            "content passes byte for byte"
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_seq_ids_of_a_persisted_stream_pass_through_the_meter() {
        let mut meter = test_meter(1);
        let stream = b"id: 3\ndata: {\"type\":\"message_delta\",\"text\":\"hi\"}\n\nid: 4\ndata: {\"type\":\"complete\"}\n\n";
        let out = meter.feed(stream).await;
        assert_eq!(out[0], Bytes::from_static(b"id: 3\n"));
        assert_eq!(out[3], Bytes::from_static(b"id: 4\n"));
        let frames = frames_of(&out);
        assert_eq!(frames.len(), 2, "an id line is not a frame");
        assert_eq!(frames[1]["usage"]["credits"], 1);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_failure_before_content_completes_at_zero_credits() {
        let mut meter = test_meter(1);
        let out = meter
            .feed(b"data: {\"type\":\"status\"}\n\ndata: {\"type\":\"error\",\"code\":\"agent_unreachable\",\"error\":\"down\",\"recoverable\":true}\n\ndata: {\"type\":\"complete\"}\n\n")
            .await;
        let frames = frames_of(&out);
        assert_eq!(frames[1]["code"], "agent_unavailable");
        assert_eq!(frames[1]["error_code"], "agent_unreachable");
        assert_eq!(frames[1]["retryable"], true);
        assert_eq!(frames[2]["usage"]["credits"], 0);
        assert_eq!(meter.charge.credits, 0);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_confirmation_only_turn_keeps_its_credit() {
        let mut meter = test_meter(1);
        let out = meter
            .feed(b"data: {\"type\":\"status\"}\n\ndata: {\"type\":\"confirmation_required\",\"tool\":\"x\"}\n\ndata: {\"type\":\"complete\"}\n\n")
            .await;
        assert_eq!(frames_of(&out)[2]["usage"]["credits"], 1);
        assert_eq!(meter.finish().await, Vec::<Bytes>::new());
        assert_eq!(meter.charge.credits, 1);
    }

    #[cfg(feature = "enterprise")]
    async fn collect_body(
        body: impl futures::Stream<Item = Result<Bytes, std::io::Error>>,
    ) -> Vec<Bytes> {
        body.map(|chunk| chunk.unwrap()).collect().await
    }

    #[cfg(feature = "enterprise")]
    fn frames(lines: &[&str]) -> impl futures::Stream<Item = Bytes> + Send + 'static {
        let chunks: Vec<Bytes> = lines
            .iter()
            .map(|line| Bytes::from(format!("data: {line}\n\n")))
            .collect();
        futures::stream::iter(chunks)
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_persisted_turn_that_ends_before_content_is_refunded() {
        let (body, metering) = meter_persisted_turn(
            frames(&[r#"{"type":"status"}"#, r#"{"type":"complete"}"#]),
            test_meter(1),
            || panic!("a granted turn is never stopped"),
        );
        let out = collect_body(body).await;
        assert_eq!(frames_of(&out)[1]["usage"]["credits"], 0);
        let meter = metering.await.unwrap();
        assert_eq!(meter.charge.credits, 0);
        assert!(!meter.phase.charged);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_browser_that_left_does_not_stop_the_meter() {
        let (body, metering) = meter_persisted_turn(
            frames(&[
                r#"{"type":"status"}"#,
                r#"{"type":"message_delta","text":"hi"}"#,
                r#"{"type":"complete"}"#,
            ]),
            test_meter(1),
            || panic!("a granted turn is never stopped"),
        );
        drop(body);
        let meter = metering.await.unwrap();
        assert!(meter.phase.content, "the turn was read to its end");
        assert_eq!(meter.charge.credits, 1, "and kept its credit");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_refused_meter_forwards_nothing_more_and_stops_the_turn() {
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stopped.clone();
        let mut meter = test_meter(1);
        meter.refused = true;
        let (body, metering) = meter_persisted_turn(
            frames(&[r#"{"type":"message_delta","text":"hi"}"#]),
            meter,
            move || flag.store(true, Ordering::SeqCst),
        );
        assert!(collect_body(body).await.is_empty());
        metering.await.unwrap();
        assert!(stopped.load(Ordering::SeqCst));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_lagging_browser_is_dropped_not_waited_for() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();
        let pending = AtomicUsize::new(BROWSER_MAX_PENDING_BYTES - 4);
        let mut browser = Some(tx);
        send_to_browser(&mut browser, &pending, vec![Bytes::from("abc")]);
        assert!(browser.is_some());
        send_to_browser(&mut browser, &pending, vec![Bytes::from("de")]);
        assert!(browser.is_none(), "over the byte budget");
        assert_eq!(rx.try_recv().unwrap(), Bytes::from("abc"));
        assert!(rx.try_recv().is_err());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_unset_model_allowlist_restricts_nothing() {
        assert!(
            get_o2_config().ai.model_allowlist.trim().is_empty(),
            "unset in tests"
        );
        assert!(get_o2_config().ai.allows_model("any-model-today", None));
        assert!(get_o2_config().ai.allows_model("", None));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_audit_record_never_holds_prompts_images_or_context_values() {
        let prompt: PromptRequest = serde_json::from_value(serde_json::json!({
            "messages": [{"role": "user", "content": "my api_key: abc and password hunter2"}],
            "context": {"api_key": "abc", "client": {"container": "sidebar"}, "stream": "logs"},
            "images": [{"data": "iVBORw0KGgoAAAANSUhEUg", "mime_type": "image/png"}],
        }))
        .unwrap();
        let body = TurnAudit::new(
            "org",
            "u@x",
            "t",
            Some("sid"),
            Some("turn"),
            Some(&prompt),
            321,
        )
        .body();
        for secret in ["abc", "hunter2", "iVBORw0KGgo", "sidebar", "logs\""] {
            assert!(!body.contains(secret), "{secret} leaked into {body}");
        }
        let record: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(record["message_count"], 1);
        assert_eq!(record["image_count"], 1);
        assert_eq!(record["bytes"], 321);
        assert_eq!(record["session_id"], "sid");
        let mut keys: Vec<&str> = record["context_keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["api_key", "client", "stream"]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_audit_record_is_capped_at_8_kib() {
        let context: serde_json::Map<String, Value> = (0..2000)
            .map(|i| (format!("key_{i:05}_{}", "k".repeat(50)), Value::Null))
            .collect();
        let prompt: PromptRequest =
            serde_json::from_value(serde_json::json!({"messages": [], "context": context}))
                .unwrap();
        let body = TurnAudit::new("org", "u@x", "t", None, None, Some(&prompt), 1).body();
        assert!(body.len() <= AUDIT_BODY_MAX_BYTES, "{}", body.len());
        let record: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(!record["context_keys"].as_array().unwrap().is_empty());
    }

    /// Fixtures that predate the action field (`""` = no action), until they are aligned.
    #[cfg(feature = "enterprise")]
    const FIXTURE_ACTION_WORDS: [(&str, &str, &str); 16] = [
        ("credits_exhausted", "upgrade", "manage_billing"),
        ("subscription_required", "upgrade", "manage_billing"),
        ("not_enabled", "contact_admin", "ask_admin"),
        ("permission_denied", "contact_admin", "ask_admin"),
        ("rate_limited", "wait", "retry"),
        ("turn_limit", "wait", "retry"),
        ("turn_busy", "wait", "none"),
        ("authorization_unavailable", "", "retry"),
        ("history_unavailable", "", "retry"),
        ("approval_delivery_failed", "", "retry"),
        ("provider_error", "", "retry"),
        ("session_expired", "", "sign_in"),
        ("consent_required", "", "enable_paid_usage"),
        ("agent_unavailable", "", "retry"),
        ("session_owner_unavailable", "", "retry"),
        ("persistence_failed", "", "none"),
    ];

    /// The server case behind every envelope fixture, as the response or frame it sends.
    #[cfg(feature = "enterprise")]
    async fn server_case(code: &str) -> (Option<u16>, serde_json::Value) {
        use super::super::chats;
        let wire = |name: &str| -> serde_json::Value {
            let path = format!(
                "{}/../../../web/src/composables/assistant/__fixtures__/errors/wire/{name}.json",
                env!("CARGO_MANIFEST_DIR")
            );
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
            serde_json::from_str::<serde_json::Value>(&text).unwrap()["body"].clone()
        };
        let forwarded = |name: &str| {
            let mut frame = wire(name);
            error::normalize_error_frame(frame.as_object_mut().unwrap());
            (None, frame)
        };
        let response = match code {
            "session_expired" => error::session_expired("Unauthorized"),
            "permission_denied" => {
                error::permission_denied("Chat history is only available to registered users")
            }
            "not_enabled" => not_enabled_error(),
            "credits_exhausted" => {
                payment_required_error("out".into(), "contact_account_manager", None)
                    .into_response()
            }
            "subscription_required" => {
                payment_required_error("out".into(), "subscribe", None).into_response()
            }
            "consent_required" => {
                consent_required_error(serde_json::json!({"feature": "ai_credits"})).into_response()
            }
            "authorization_unavailable" => authorization_unavailable_error().into_response(),
            "turn_limit" => chats::turn_limit_response("user"),
            "rate_limited" => {
                upstream_failure(false, false, Some(429), Some(30), None).into_response()
            }
            "turn_busy" => chats::lease_busy(None).into_response(),
            "already_submitted" => chats::already_submitted().into_response(),
            "agent_unavailable" => {
                upstream_failure(false, false, Some(503), None, None).into_response()
            }
            "session_owner_unavailable" => {
                upstream_failure(true, false, Some(409), None, None).into_response()
            }
            "history_unavailable" => chats::history_unreadable().into_response(),
            "approval_delivery_failed" => approval_delivery_failed_error(),
            "persistence_failed" => return forwarded("I1.persistence_failed_frame"),
            "provider_error" => return forwarded("H.llm_overload_frame"),
            "restore_required" => return forwarded("M1.restore_required_frame"),
            "stale_epoch" => return forwarded("M1.stale_epoch_frame"),
            other => panic!("no server case for the `{other}` fixture"),
        };
        let status = response.status().as_u16();
        (Some(status), body_of(response).await)
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn every_envelope_fixture_is_what_the_server_sends() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../web/src/composables/assistant/__fixtures__/errors/envelope"
        );
        let mut seen = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let code = path.file_stem().unwrap().to_str().unwrap().to_string();
            let fixture: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let expected = &fixture["body"];
            let (status, body) = server_case(&code).await;
            if let Some(want) = fixture["status"].as_u64() {
                assert_eq!(status, Some(want as u16), "{code}: status");
            }
            for key in ["code", "retryable", "retry_after", "type"] {
                assert_eq!(body.get(key), expected.get(key), "{code}: `{key}`");
            }
            let want = expected.get("action").and_then(serde_json::Value::as_str);
            let want = FIXTURE_ACTION_WORDS
                .iter()
                .find(|(c, fixture, _)| *c == code && *fixture == want.unwrap_or_default())
                .map_or(want, |(_, _, server)| Some(*server));
            assert_eq!(
                body.get("action").and_then(serde_json::Value::as_str),
                want,
                "{code}: `action`"
            );
            assert_eq!(
                body["code"],
                code.as_str(),
                "{code}: the file name is the code"
            );
            seen += 1;
        }
        assert!(seen >= 19, "only {seen} envelope fixtures were read");
    }

    #[test]
    fn only_json_bodies_change_state() {
        let headers = |ct: &str| {
            let mut h = axum::http::HeaderMap::new();
            h.insert(axum::http::header::CONTENT_TYPE, ct.parse().unwrap());
            h
        };
        assert!(require_json(&headers("application/json")).is_ok());
        assert!(require_json(&headers("Application/JSON; charset=utf-8")).is_ok());
        for ct in [
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
        ] {
            let resp = require_json(&headers(ct)).unwrap_err();
            assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE, "{ct}");
        }
        assert!(require_json(&axum::http::HeaderMap::new()).is_err());
    }

    #[test]
    fn test_valid_session_ids_are_accepted() {
        assert!(is_valid_session_id("01234567-89ab-cdef-0123-456789abcdef"));
        // UUID v7 as minted by the frontend, and case-insensitive hex.
        assert!(is_valid_session_id("0195A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B"));
    }

    #[test]
    fn test_shape_only_lookalikes_are_rejected() {
        // 36 chars with 4 hyphens — passed the old length+count check.
        assert!(!is_valid_session_id("----zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
        // Right characters, hyphens in the wrong places.
        assert!(!is_valid_session_id(
            "0123456-789ab-cdef-0123-456789abcdeff"
        ));
    }

    #[test]
    fn test_non_hyphenated_uuid_forms_are_rejected() {
        // `Uuid::try_parse` accepts all of these; a URN would carry `:` into the confirm URL.
        assert!(!is_valid_session_id(
            "urn:uuid:01234567-89ab-cdef-0123-456789abcdef"
        ));
        assert!(!is_valid_session_id(
            "{01234567-89ab-cdef-0123-456789abcdef}"
        ));
        assert!(!is_valid_session_id("0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn test_url_unsafe_session_ids_are_rejected() {
        // The confirm handler interpolates this into an outbound URL.
        assert!(!is_valid_session_id("../../etc/passwd"));
        assert!(!is_valid_session_id("01234567-89ab-cdef-0123-456789abcde/"));
    }

    #[test]
    fn test_wrong_length_session_ids_are_rejected() {
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("01234567-89ab-cdef-0123-456789abcde"));
        assert!(!is_valid_session_id(
            "01234567-89ab-cdef-0123-456789abcdeff"
        ));
    }

    #[test]
    fn test_confirm_body_carries_the_path_org() {
        let value = bind_confirm_body_to_org(br#"{"approved":true}"#, "acme").unwrap();
        assert_eq!(
            value,
            serde_json::json!({"approved": true, "org_id": "acme"})
        );
    }

    #[test]
    fn test_confirm_body_org_cannot_be_chosen_by_the_client() {
        let value =
            bind_confirm_body_to_org(br#"{"approved":true,"org_id":"victim"}"#, "acme").unwrap();
        assert_eq!(value["org_id"], "acme");
    }

    #[test]
    fn the_relay_names_the_card_id_and_drops_client_records() {
        let body =
            br#"{"approval_id":"apr_9","approved":true,"approval_record":{"id":"x"},"policy":{}}"#;
        assert_eq!(confirm_body_problem(body), None);
        let value = bind_confirm_body_to_org(body, "acme").unwrap();
        assert_eq!(value["id"], "apr_9");
        assert!(value.get("approval_record").is_none() && value.get("policy").is_none());
        assert!(confirm_body_problem(br#"{"call_id":3}"#).is_some());
        assert!(confirm_body_problem(br#"{"id":"apr_1","scope":"tool"}"#).is_some());
    }

    #[test]
    fn an_extension_moves_the_stored_expiry_and_card() {
        let card = r#"{"type":"confirmation_required","id":"apr_1","expires_at":1000}"#;
        let answer = serde_json::json!({"id": "apr_1", "expires_at": 5000, "extends": 1});
        let (expires_at, extended) = extended_card(card, &answer).unwrap();
        assert_eq!(expires_at, 5_000_000);
        let extended: Value = serde_json::from_str(&extended).unwrap();
        assert_eq!(extended["expires_at"], 5000);
        assert_eq!(extended["id"], "apr_1");
        assert!(extended_card(card, &serde_json::json!({"extends": 1})).is_none());
    }

    #[test]
    fn test_confirm_body_must_be_a_json_object() {
        assert!(bind_confirm_body_to_org(b"", "acme").is_none());
        assert!(bind_confirm_body_to_org(b"not json", "acme").is_none());
        assert!(bind_confirm_body_to_org(b"[true]", "acme").is_none());
    }

    #[test]
    fn the_confirm_relay_passes_scope_items_reply_and_id_through() {
        let body = br#"{"id":"apr_1","approved":true,"scope":"chat","items":["a1"],"reply":"no"}"#;
        assert_eq!(confirm_body_problem(body), None);
        let bound = bind_confirm_body_to_org(body, "acme").unwrap();
        assert_eq!(bound["scope"], "chat");
        assert_eq!(bound["items"], serde_json::json!(["a1"]));
        assert_eq!(bound["reply"], "no");
        assert_eq!(bound["id"], "apr_1");
        assert!(extends_only(br#"{"id":"apr_1","extend":true}"#));
        assert!(!extends_only(br#"{"id":"apr_1","approved":true}"#));
    }

    #[test]
    fn a_malformed_confirm_body_is_refused_before_the_relay() {
        for body in [
            &br#"{"scope":"forever"}"#[..],
            br#"{"items":"a1"}"#,
            br#"{"items":[1]}"#,
            br#"{"id":7}"#,
            br#"{"extend":"yes"}"#,
            b"[]",
        ] {
            assert!(confirm_body_problem(body).is_some(), "{body:?}");
        }
    }

    #[tokio::test]
    async fn o2_ais_typed_confirm_refusals_keep_their_status() {
        let resolved = r#"{"code":"approval_resolved","message":"x","id":"apr_1","resolved_by":"a@x","at":17,"approved":false,"withdrawn":true}"#;
        let response = confirm_refusal(409, resolved);
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = body_of(response).await;
        assert_eq!(body["code"], "already_submitted");
        assert_eq!(body["reason"], "approval_resolved");
        assert_eq!(body["resolved_by"], "a@x");
        assert_eq!(body["at"], 17);
        assert_eq!(body["withdrawn"], true);
        assert_ne!(body["message"], "x", "upstream text is not the message");

        let expired = confirm_refusal(404, r#"{"code":"approval_expired","message":"x"}"#);
        assert_eq!(expired.status(), StatusCode::NOT_FOUND);
        assert_eq!(body_of(expired).await["reason"], "approval_expired");
        assert_eq!(confirm_refusal(410, "{}").status(), StatusCode::GONE);
        assert_eq!(
            confirm_refusal(400, "not json").status(),
            StatusCode::BAD_REQUEST
        );

        let failed = confirm_refusal(502, r#"{"code":"Weird Thing"}"#);
        assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_of(failed).await["code"], "approval_delivery_failed");
    }

    #[tokio::test]
    async fn a_moved_session_is_its_own_retryable_refusal() {
        let detail = r#"{"detail":{"code":"session_owner_unavailable","message":"x"}}"#;
        let moved = confirm_refusal(409, detail);
        assert_eq!(moved.status(), StatusCode::CONFLICT);
        let body = body_of(moved).await;
        assert_eq!(body["code"], "session_owner_unavailable");
        assert_eq!(body["retryable"], true);
        let nested = r#"{"detail":{"code":"approval_mismatch","pending_id":"apr_2"}}"#;
        let body = body_of(confirm_refusal(409, nested)).await;
        assert_eq!(body["code"], "already_submitted");
        assert_eq!(body["pending_id"], "apr_2");
    }

    #[test]
    fn test_extract_passthrough_headers_exact_match() {
        // Create a test request with headers
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "Mozilla/5.0".parse().unwrap());
        headers.insert("x-custom-header", "custom-value".parse().unwrap());
        headers.insert("authorization", "Bearer secret".parse().unwrap());

        let config = "user-agent,x-custom-header";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert_eq!(result.get("user-agent"), Some(&"Mozilla/5.0".to_string()));
        assert_eq!(
            result.get("x-custom-header"),
            Some(&"custom-value".to_string())
        );
        // Authorization should not be included
        assert!(!result.contains_key("authorization"));
    }

    #[test]
    fn test_extract_passthrough_headers_wildcard_match() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("x-forwarded-for", "192.168.1.1".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("x-forwarded-host", "example.com".parse().unwrap());
        headers.insert("x-other-header", "other".parse().unwrap());

        let config = "x-forwarded-*";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 3);
        assert_eq!(
            result.get("x-forwarded-for"),
            Some(&"192.168.1.1".to_string())
        );
        assert_eq!(result.get("x-forwarded-proto"), Some(&"https".to_string()));
        assert_eq!(
            result.get("x-forwarded-host"),
            Some(&"example.com".to_string())
        );
        // X-Other-Header should not match
        assert!(!result.contains_key("x-other-header"));
    }

    #[test]
    fn test_extract_passthrough_headers_mixed_patterns() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "curl/7.68.0".parse().unwrap());
        headers.insert("x-forwarded-for", "10.0.0.1".parse().unwrap());
        headers.insert("x-forwarded-proto", "http".parse().unwrap());
        headers.insert("x-request-id", "abc-123".parse().unwrap());

        let config = "x-forwarded-*,user-agent,x-request-id";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 4);
        assert!(result.contains_key("user-agent"));
        assert!(result.contains_key("x-forwarded-for"));
        assert!(result.contains_key("x-forwarded-proto"));
        assert!(result.contains_key("x-request-id"));
    }

    #[test]
    fn test_extract_passthrough_headers_empty_config() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "test".parse().unwrap());

        let config = "";
        let result = extract_passthrough_headers(&headers, config);

        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_passthrough_headers_case_insensitive() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("USER-AGENT", "test-agent".parse().unwrap());
        headers.insert("X-FORWARDED-FOR", "1.2.3.4".parse().unwrap());

        let config = "User-Agent,x-forwarded-for";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert_eq!(result.get("user-agent"), Some(&"test-agent".to_string()));
        assert_eq!(result.get("x-forwarded-for"), Some(&"1.2.3.4".to_string()));
    }

    #[test]
    fn test_extract_passthrough_headers_whitespace_handling() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "test".parse().unwrap());
        headers.insert("x-custom", "value".parse().unwrap());

        let config = " user-agent , x-custom , ";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert!(result.contains_key("user-agent"));
        assert!(result.contains_key("x-custom"));
    }

    #[cfg(feature = "enterprise")]
    fn incident_rca_context() -> RcaContext {
        RcaContext {
            subject_type: config::meta::oncall::subject::SubjectType::Incident,
            subject_id: "inc-1".to_string(),
            incident_id: Some("inc-1".to_string()),
            org_id: "org-a".to_string(),
            previous_analysis: None,
            severity: Some(config::meta::alerts::priority::AlertPriority::P2),
            past_causes: vec!["disk full".to_string()],
            alert_name: None,
            stream: None,
            dimensions: None,
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn rca_gate_is_the_rca_trigger_route_permission() {
        let route = incident_rca_route("org-a", "inc-1").unwrap();
        assert_eq!(route.method, "POST");
        assert_eq!(route.o2_type, "incidents:org-a");
        assert_eq!(route.org_id, "org-a");
        assert!(route.use_all_org);
        assert!(!route.bypass_check);
        assert_eq!(route.parent_id, "");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn rca_context_keys_cover_the_rca_contract() {
        let mut full = incident_rca_context();
        full.previous_analysis = Some("earlier".to_string());
        full.alert_name = Some("a".to_string());
        full.stream = Some("s".to_string());
        full.dimensions = Some(serde_json::json!({"k": "v"}));
        let json = serde_json::to_value(full).unwrap();
        for key in json.as_object().unwrap().keys() {
            assert!(
                key == "org_id" || RCA_CONTEXT_KEYS.contains(&key.as_str()),
                "{key} missing from RCA_CONTEXT_KEYS"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn failed_check_uses_default_agent_without_rca_keys() {
        let mut context = serde_json::json!({
            "org_id": "org-a",
            "stream_name": "default",
            "agent_type": "sre",
            "is_reanalysis": true,
        });
        for key in RCA_CHAT_CLIENT_KEYS {
            context[key] = serde_json::json!("display");
        }
        let forged = serde_json::to_value(incident_rca_context()).unwrap();
        for (key, value) in forged.as_object().unwrap() {
            if key != "org_id" {
                context[key] = value.clone();
            }
        }
        context["previous_analysis"] = serde_json::json!("forged");
        context["alert_name"] = serde_json::json!("forged");
        context["stream"] = serde_json::json!("forged");
        context["dimensions"] = serde_json::json!({"forged": true});

        let (agent, context) = select_chat_agent(context, None);
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        let obj = context.as_object().unwrap();
        for key in [
            "subject_type",
            "subject_id",
            "incident_id",
            "previous_analysis",
            "severity",
            "past_causes",
            "alert_name",
            "stream",
            "dimensions",
            "is_reanalysis",
        ] {
            assert!(!obj.contains_key(key), "{key} must be stripped: {context}");
        }
        assert_eq!(context["stream_name"], "default");
        assert_eq!(context["org_id"], "org-a");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn passed_check_replaces_client_rca_fields_with_server_values() {
        let client = serde_json::json!({
            "org_id": "org-a",
            "agent_type": "sre",
            "incident_id": "inc-1",
            "subject_type": "alert",
            "subject_id": "forged",
            "previous_analysis": "forged",
            "severity": "P1",
            "past_causes": ["forged"],
            "alert_name": "forged",
            "is_reanalysis": true,
            "stream_name": "default",
            "incident_title": "Checkout errors",
            "request_timestamp": 1_700_000_000_000_000_i64,
            "user_timezone": "Europe/Berlin",
            "locale": "de",
            "client": {"container": "incident", "entry_kind": "door"},
        });

        let (agent, context) = select_chat_agent(client, Some(incident_rca_context()));
        assert_eq!(agent, RCA_AGENT_TYPE);
        assert_eq!(
            context,
            serde_json::json!({
                "subject_type": "incident",
                "subject_id": "inc-1",
                "incident_id": "inc-1",
                "org_id": "org-a",
                "severity": 2,
                "past_causes": ["disk full"],
                "incident_title": "Checkout errors",
                "request_timestamp": 1_700_000_000_000_000_i64,
                "user_timezone": "Europe/Berlin",
                "locale": "de",
                "client": {"container": "incident", "entry_kind": "door"},
            })
        );
    }

    /// A stand-in o2-ai answering every streamed turn with `status` and `body`, as FastAPI would.
    #[cfg(feature = "enterprise")]
    async fn o2ai_refusing(status: u16, body: &'static str) -> String {
        use axum::{Router, routing::post};

        let app = Router::new().route(
            "/o2_agent/{agent}/query/stream",
            post(move || async move {
                (
                    StatusCode::from_u16(status).unwrap(),
                    [("content-type", "application/json")],
                    body,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// What `chat_stream` answers (persistence off) when the real client meets that o2-ai.
    #[cfg(feature = "enterprise")]
    async fn upstream_refusal(base: &str) -> (StatusCode, serde_json::Value) {
        let client =
            o2_enterprise::enterprise::ai::client::AiAgentClient::new(base, false).unwrap();
        let error = client
            .query_stream(
                DEFAULT_AGENT_TYPE,
                QueryRequest::new("q".to_string(), serde_json::json!({})),
                "Bearer o2dt.x.y",
            )
            .await
            .unwrap_err();
        let response = upstream_error(&error).into_response();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn every_o2ai_refusal_code_reaches_the_body_as_error_code() {
        for (status, body, code) in [
            (
                404,
                r#"{"detail":{"code":"session_not_found","session_id":"s1","reason":"unknown"}}"#,
                "session_not_found",
            ),
            (
                409,
                r#"{"detail":{"code":"turn_in_progress","message":"another turn of this conversation is still running"}}"#,
                "turn_in_progress",
            ),
            (
                409,
                r#"{"detail":{"code":"session_owner_unavailable"}}"#,
                "session_owner_unavailable",
            ),
            (
                400,
                r#"{"detail":{"code":"epoch_out_of_range","message":"x","session_epoch":9,"current_epoch":2}}"#,
                "epoch_out_of_range",
            ),
            (
                503,
                r#"{"code":"internal_secret_required"}"#,
                "internal_secret_required",
            ),
        ] {
            let (got, json) = upstream_refusal(&o2ai_refusing(status, body).await).await;
            assert_eq!(json["error_code"], code, "{json}");
            let want = if code == "session_owner_unavailable" {
                StatusCode::CONFLICT
            } else {
                StatusCode::from_u16(status).unwrap()
            };
            assert_eq!(got, want, "{json}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_codeless_or_unreachable_upstream_has_no_error_code() {
        let (status, json) =
            upstream_refusal(&o2ai_refusing(429, r#"{"detail":"slow"}"#).await).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert!(json["error_code"].is_null(), "{json}");

        let (status, json) = upstream_refusal("http://127.0.0.1:9").await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(json["code"], "agent_unavailable", "{json}");
    }

    #[cfg(feature = "enterprise")]
    fn prompt(context: serde_json::Value) -> PromptRequest {
        serde_json::from_value(serde_json::json!({
            "messages": [{"role": "user", "content": "why are checkouts failing?"}],
            "context": context,
            "confirm_timeout_secs": 900,
        }))
        .unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn fork_seed_kept_only_for_delegated() {
        let body = prompt(serde_json::json!({"o2_fork_seed": true, "currentPage": "slack"}));
        let browser = agent_context(&body.context, "prod", false);
        assert!(browser.get(FORK_SEED_CONTEXT_KEY).is_none(), "{browser}");
        assert_eq!(browser["org_id"], "prod");
        let slack = agent_context(&body.context, "prod", true);
        assert_eq!(slack[FORK_SEED_CONTEXT_KEY], true);
        assert_eq!(slack["org_id"], "prod");
        assert_eq!(slack["currentPage"], "slack");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn confirm_timeout_is_capped_at_600_and_zero_means_unset() {
        assert_eq!(
            prompt(serde_json::json!({})).confirm_timeout_secs,
            Some(900)
        );
        assert_eq!(confirm_timeout(Some(900)), Some(600));
        assert_eq!(confirm_timeout(Some(600)), Some(600));
        assert_eq!(confirm_timeout(Some(30)), Some(30));
        assert_eq!(confirm_timeout(Some(0)), None);
        assert_eq!(confirm_timeout(None), None);
    }

    #[cfg(feature = "enterprise")]
    fn slack_event_headers() -> axum::http::HeaderMap {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(SLACK_EVENT_HEADER, "T0TEAM:C0CHAN:Ev0001".parse().unwrap());
        headers
    }

    #[cfg(feature = "enterprise")]
    fn bridge_caller() -> DelegatedCaller {
        DelegatedCaller {
            link_id: "lnk_01".to_string(),
            installation_id: "inst_01".to_string(),
            org: "prod".to_string(),
            jti: "jti-0001".to_string(),
            scope: config::utils::delegation::SCOPE_ASSISTANT.to_string(),
        }
    }

    #[cfg(feature = "enterprise")]
    fn slack_turn_audit(caller: Option<&DelegatedCaller>, body: &PromptRequest) -> TurnAudit {
        TurnAudit::new("prod", "ann@acme.io", "t1", None, None, Some(body), 64)
            .delegated_by(caller, &slack_event_headers())
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_slack_turn_is_audited_without_the_question_and_with_its_slack_event() {
        let body = prompt(serde_json::json!({"currentPage": "slack"}));
        let caller = bridge_caller();
        let audit = slack_turn_audit(Some(&caller), &body);
        assert_eq!(audit.protocol, Protocol::Slack);
        let text = audit.body();
        assert!(!text.contains("checkouts"), "{text}");
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["slack_event"], "T0TEAM:C0CHAN:Ev0001");
        assert_eq!(json["context_keys"], serde_json::json!(["currentPage"]));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_slack_turn_record_names_the_link_and_the_token() {
        let caller = bridge_caller();
        let audit = slack_turn_audit(Some(&caller), &prompt(serde_json::json!({})));
        let message = audit.message(StatusCode::OK, None);
        assert_eq!(
            message.delegated,
            Some(DelegatedAudit {
                link_id: "lnk_01".to_string(),
                jti: "jti-0001".to_string(),
            })
        );
        assert_eq!(message.protocol, Protocol::Slack);
        assert_eq!(message.response_meta.http_path, "/api/prod/ai/chat_stream");
        assert_eq!(message.response_meta.trace_id.as_deref(), Some("t1"));
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(
            json["delegated"],
            serde_json::json!({"link_id": "lnk_01", "jti": "jti-0001"})
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_browser_request_with_a_forged_slack_event_is_audited_as_http_without_it() {
        let body = prompt(serde_json::json!({}));
        let audit = slack_turn_audit(None, &body);
        assert_eq!(audit.protocol, Protocol::Http);
        let json: serde_json::Value = serde_json::from_str(&audit.body()).unwrap();
        assert!(json.get("slack_event").is_none(), "{json}");
        assert!(!audit.body().contains("checkouts"));
        assert_eq!(audit.message(StatusCode::OK, None).delegated, None);
    }

    #[test]
    fn the_slack_audit_body_drops_the_question_and_keeps_the_rest() {
        let body = serde_json::json!({
            "messages": [{"role": "user", "content": "why are checkouts failing?"}],
            "context": {"currentPage": "slack"},
        });
        let json: serde_json::Value =
            serde_json::from_str(&slack_audit_body(body, Some("T0TEAM:C0CHAN:Ev0001"))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "messages": SLACK_REDACTED,
                "context": {"currentPage": "slack"},
                "slack_event": "T0TEAM:C0CHAN:Ev0001",
            })
        );
        assert_eq!(
            slack_audit_body(serde_json::json!("why are checkouts failing?"), None),
            serde_json::json!(SLACK_REDACTED).to_string()
        );
    }

    #[cfg(feature = "enterprise")]
    const STICKY_ROOT: &str = "root@sticky.chat.test";

    /// The SQLite meta store with incident analysis on and [STICKY_ROOT] as root; refuses other
    /// stores.
    #[cfg(feature = "enterprise")]
    async fn sticky_tables() -> &'static sea_orm::DatabaseConnection {
        use infra::table::entity::{ai_chat_sessions, alert_incidents};
        use sea_orm::{ConnectionTrait, Schema};

        static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        TABLES
            .get_or_init(|| async {
                // SAFETY: set once inside the `OnceCell` initializer, before the refresh reads
                // them.
                unsafe {
                    std::env::set_var("O2_INCIDENTS_ENABLED", "true");
                    std::env::set_var("O2_INCIDENTS_RCA_ENABLED", "true");
                    std::env::set_var("O2_AGENT_URL", "http://127.0.0.1:1");
                }
                o2_enterprise::enterprise::common::config::refresh_config().unwrap();
                let cfg = config::get_config();
                assert!(
                    cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite",
                    "the sticky agent tests need the default SQLite meta store, found {:?}",
                    cfg.common.meta_store
                );
                std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
                let conn = infra::db::get_orm_client_rw().await;
                let backend = conn.get_database_backend();
                let schema = Schema::new(backend);
                for mut table in [
                    schema.create_table_from_entity(alert_incidents::Entity),
                    schema.create_table_from_entity(ai_chat_sessions::Entity),
                ] {
                    conn.execute(backend.build(table.if_not_exists()))
                        .await
                        .unwrap();
                }
                common::infra::config::ORG_USERS.insert(
                    format!("{}/{STICKY_ROOT}", config::DEFAULT_ORG),
                    infra::table::org_users::OrgUserRecord::new(
                        config::DEFAULT_ORG,
                        STICKY_ROOT,
                        config::meta::user::UserRole::Root,
                        "token",
                        None,
                    ),
                );
            })
            .await;
        infra::db::get_orm_client_rw().await
    }

    #[cfg(feature = "enterprise")]
    async fn sticky_incident(conn: &sea_orm::DatabaseConnection, org_id: &str, incident_id: &str) {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let now = config::utils::time::now_micros();
        let row = alert_incidents::Model {
            id: incident_id.to_string(),
            org_id: org_id.to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({}),
            key_type: "alert_id".to_string(),
            topology_context: None,
            first_alert_at: now,
            last_alert_at: now,
            resolved_at: None,
            alert_count: 1,
            title: Some("checkout errors".to_string()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: now,
            updated_at: now,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
        };
        alert_incidents::Entity::insert(alert_incidents::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    async fn sticky_session(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        session_id: &str,
        agent_type: &str,
    ) {
        use infra::table::entity::ai_chat_sessions;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let row = ai_chat_sessions::Model {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            user_id: STICKY_ROOT.to_string(),
            user_email: STICKY_ROOT.to_string(),
            opencode_session_id: None,
            agent_type: agent_type.to_string(),
            title: "Analysis · run 2".to_string(),
            title_source: "prompt".to_string(),
            status: "active".to_string(),
            created_at: 1_000,
            updated_at: 1_000,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: infra::table::ai_chat_sessions::NO_SEQ,
            session_epoch: 0,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        };
        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_only_a_non_rca_row_keeps_the_default_agent() {
        assert!(!keeps_default_agent(None));
        assert!(!keeps_default_agent(Some(RCA_AGENT_TYPE)));
        assert!(keeps_default_agent(Some(DEFAULT_AGENT_TYPE)));
        assert!(keeps_default_agent(Some("sre")));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_an_existing_chat_keeps_its_agent_and_a_new_one_picks_from_its_context() {
        let conn = sticky_tables().await;
        let org = format!(
            "sticky_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let other_org = format!("{org}_other");
        let incident = format!("inc.{org}");
        sticky_incident(conn, &org, &incident).await;
        let ask_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let rca_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let new_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let foreign_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        sticky_session(conn, &org, &ask_chat, DEFAULT_AGENT_TYPE).await;
        sticky_session(conn, &org, &rca_chat, RCA_AGENT_TYPE).await;
        sticky_session(conn, &other_org, &foreign_chat, DEFAULT_AGENT_TYPE).await;

        let context = serde_json::json!({
            "org_id": org,
            "currentPage": "incidents",
            "incident_id": incident,
            "subject_type": "incident",
            "subject_id": incident,
            "previous_analysis": "forged",
            "past_causes": ["forged"],
            "is_reanalysis": true,
            "incident_title": "Checkout errors",
        });
        let pick = async |session: Option<&str>, context: serde_json::Value| {
            session_agent_and_context(&org, STICKY_ROOT, session, context).await
        };

        for session in [ask_chat.clone(), ask_chat.to_uppercase()] {
            let (agent, picked) = pick(Some(&session), context.clone()).await;
            assert_eq!(agent, DEFAULT_AGENT_TYPE, "{session}");
            let obj = picked.as_object().unwrap();
            for key in RCA_CONTEXT_KEYS {
                assert!(!obj.contains_key(key), "{session}: {key} kept: {picked}");
            }
            assert_eq!(picked["currentPage"], "incidents", "{session}");
            assert_eq!(picked["org_id"], org.as_str(), "{session}");
        }

        for session in [
            Some(rca_chat.as_str()),
            Some(new_chat.as_str()),
            Some(foreign_chat.as_str()),
            None,
        ] {
            let (agent, picked) = pick(session, context.clone()).await;
            assert_eq!(agent, RCA_AGENT_TYPE, "{session:?}: {picked}");
            assert_eq!(picked["incident_id"], incident.as_str(), "{session:?}");
            assert_eq!(picked["subject_type"], "incident", "{session:?}");
            assert_eq!(picked["subject_id"], incident.as_str(), "{session:?}");
            assert!(picked.get("previous_analysis").is_none(), "{session:?}");
            assert_eq!(picked["incident_title"], "Checkout errors", "{session:?}");
        }

        let plain = serde_json::json!({"org_id": org, "currentPage": "logs"});
        let (agent, picked) = pick(Some(&new_chat), plain.clone()).await;
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        assert_eq!(picked, plain);

        // An explicit chat turn wins over the stored agent and never runs the autonomous one.
        for session in [
            Some(ask_chat.as_str()),
            Some(rca_chat.as_str()),
            Some(new_chat.as_str()),
            None,
        ] {
            let (agent, picked) = turn_agent_and_context(
                &org,
                STICKY_ROOT,
                session,
                context.clone(),
                Some(ChatMode::Chat),
            )
            .await;
            assert_eq!(agent, SRE_CHAT_AGENT_TYPE, "{session:?}: {picked}");
            assert_eq!(picked["incident_id"], incident.as_str(), "{session:?}");
            assert_eq!(picked["incident_title"], "Checkout errors", "{session:?}");
            assert!(picked.get("previous_analysis").is_none(), "{session:?}");
        }
        let (agent, picked) = turn_agent_and_context(
            &org,
            STICKY_ROOT,
            Some(&new_chat),
            plain.clone(),
            Some(ChatMode::Chat),
        )
        .await;
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        assert_eq!(picked, plain);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_stop_reaches_only_the_running_turn_it_names() {
        assert_eq!(stop_target(None, Some("t2")).as_deref(), Some("t2"));
        assert_eq!(stop_target(Some("t2"), Some("t2")).as_deref(), Some("t2"));
        // A stale Stop for t1 must not cut t2, which now runs in the same chat.
        assert_eq!(stop_target(Some("t1"), Some("t2")), None);
        assert_eq!(stop_target(Some("t1"), None), None);
        assert_eq!(stop_target(None, None), None);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn without_persistence_only_the_turns_user_may_stop_it() {
        let alice = [("t1", "alice@x")];
        assert_eq!(
            direct_stop_target(None, &alice, "alice@x").unwrap(),
            StopTarget::Turn("t1".into())
        );
        assert_eq!(
            direct_stop_target(Some("t0"), &alice, "alice@x").unwrap(),
            StopTarget::Nothing
        );
        // A node streaming only someone else's turns refuses, named or not, and forwards nothing.
        for named in [Some("t1"), None, Some("t9")] {
            let refused = direct_stop_target(named, &alice, "mallory@x").unwrap_err();
            assert_eq!(refused.code(), AiErrorCode::PermissionDenied, "{named:?}");
            assert_eq!(refused.http_status(), StatusCode::FORBIDDEN);
        }
        // A node streaming none of the chat's turns forwards as the caller.
        assert_eq!(
            direct_stop_target(None, &[], "alice@x").unwrap(),
            StopTarget::Elsewhere
        );
        assert_eq!(
            direct_stop_target(Some("t1"), &[], "mallory@x").unwrap(),
            StopTarget::Elsewhere
        );
        // Another user's turn under the same chat id never takes the caller's Stop away.
        let shared = [("t1", "alice@x"), ("t2", "mallory@x")];
        assert_eq!(
            direct_stop_target(None, &shared, "alice@x").unwrap(),
            StopTarget::Turn("t1".into())
        );
        assert!(direct_stop_target(Some("t2"), &shared, "alice@x").is_err());
        // Two tabs of one user: the Stop is decided for the named one (o2-ai then stops the chat).
        let tabs = [("t1", "alice@x"), ("t2", "alice@x")];
        assert_eq!(
            direct_stop_target(Some("t1"), &tabs, "alice@x").unwrap(),
            StopTarget::Turn("t1".into())
        );
        assert_eq!(
            direct_stop_target(None, &tabs, "alice@x").unwrap(),
            StopTarget::Turn("t2".into())
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_stop_without_persistence_says_it_stopped_the_whole_chat() {
        let body = |resp: Response| async move {
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()
        };
        let wide = body(cancel_body(
            true,
            true,
            Some("t1".into()),
            Some(vec!["t1".into(), "t2".into()]),
        ))
        .await;
        assert_eq!(wide["chat_wide"], true);
        assert_eq!(wide["stopped_turns"], serde_json::json!(["t1", "t2"]));
        let persisted = body(cancel_body(true, true, Some("t1".into()), None)).await;
        assert!(persisted.get("chat_wide").is_none() && persisted.get("stopped_turns").is_none());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_stop_answers_by_what_o2_ai_and_the_turns_node_said() {
        let owner = |reached| OwnerCancel {
            reached,
            turn_id: Some("t1".into()),
        };
        let body = |cancelled, owner_reached| CancelReply::Body {
            cancelled,
            owner_reached,
        };
        // o2-ai took it.
        assert_eq!(cancel_reply(Some(true), false, None), body(true, true));
        // Persisted: the node running the turn decides, a refusal stays typed only if it was not.
        assert_eq!(
            cancel_reply(Some(false), false, Some(&owner(true))),
            body(true, true)
        );
        assert_eq!(
            cancel_reply(None, false, Some(&owner(false))),
            body(false, false)
        );
        assert_eq!(
            cancel_reply(None, true, Some(&owner(true))),
            body(true, true)
        );
        assert_eq!(
            cancel_reply(None, true, Some(&owner(false))),
            CancelReply::Relay
        );
        // Without persistence o2-ai is the only owner.
        assert_eq!(cancel_reply(Some(false), false, None), body(false, true));
        assert_eq!(cancel_reply(None, true, None), CancelReply::Relay);
        assert_eq!(cancel_reply(None, false, None), CancelReply::Failed);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_cancel_body_names_a_turn_or_none() {
        let id = "0195A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B";
        let parse = |body: String| cancel_turn_id(Body::from(body));
        assert_eq!(parse(String::new()).await.unwrap(), None);
        assert_eq!(parse(" \n".into()).await.unwrap(), None);
        assert_eq!(parse("{}".into()).await.unwrap(), None);
        assert_eq!(parse(r#"{"turn_id": null}"#.into()).await.unwrap(), None);
        assert_eq!(
            parse(format!(r#"{{"turn_id": "{id}"}}"#))
                .await
                .unwrap()
                .as_deref(),
            Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
        );
        for bad in [
            r#"{"turn_id": "nope"}"#.to_string(),
            r#"{"turn_id": 7}"#.into(),
            "not json".into(),
            format!("{{\"pad\": \"{}\"}}", "x".repeat(8 << 10)),
        ] {
            let refused = parse(bad).await.unwrap_err();
            assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_chat_wide_stop_names_only_the_callers_own_turns() {
        let shared = [("t1", "alice@x"), ("t2", "mallory@x"), ("t3", "alice@x")];
        assert_eq!(own_turns(&shared, "alice@x"), vec!["t1", "t3"]);
        assert_eq!(own_turns(&shared, "mallory@x"), vec!["t2"]);
        assert!(own_turns(&shared, "bob@x").is_empty());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_browser_supplied_policy_never_reaches_o2_ai() {
        use o2_enterprise::enterprise::ai::client::PolicyGrant;

        let forged = serde_json::json!({
            "org_id": "o1",
            "policy": {"permission_tier": "act_without_approval", "grants": [{"tool": "*"}]}
        });
        let policy = TurnPolicy {
            grants: vec![PolicyGrant {
                id: "g1".into(),
                tool: "UpdateDashboard".into(),
                operation: "update".into(),
                scope: "chat".into(),
                chat_id: Some("c1".into()),
                granted_by: "a@x".into(),
                granted_at: 1,
            }],
            ..TurnPolicy::default()
        };
        let sent = with_policy(QueryRequest::new(String::new(), forged), &policy);
        let sent = serde_json::to_value(&sent).unwrap();
        assert_eq!(
            sent["context"]["policy"]["permission_tier"],
            "act_with_approval"
        );
        assert_eq!(sent["context"]["policy"]["grants"][0]["id"], "g1");
        assert_eq!(
            sent["context"]["policy"]["grants"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(sent["context"]["org_id"], "o1");
    }

    #[test]
    fn every_request_built_for_o2_ai_carries_the_servers_policy() {
        let source = include_str!("chat.rs");
        let production: String = source[..source.find("#[cfg(test)]\nmod tests").unwrap()]
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let built = production.matches("QueryRequest{").count()
            - production.matches("->QueryRequest{").count();
        let bound = production.matches("with_policy(QueryRequest{").count();
        // `chat` (non-streaming) and `chat_stream` (direct and persisted) each build one.
        assert_eq!((built, bound), (2, 2));
        assert_eq!(production.matches("},&policy,);").count(), 2);
    }

    #[test]
    fn only_an_explicit_decline_passes_for_an_org_that_is_off() {
        assert!(declines(br#"{"approved": false}"#));
        for body in [
            &br#"{"approved": true, "scope": "chat"}"#[..],
            br#"{"approved": "true"}"#,
            br#"{"approved": 1}"#,
            br#"{"approved": "false"}"#,
            br#"{}"#,
            b"not json",
        ] {
            assert!(!declines(body), "{}", String::from_utf8_lossy(body));
        }
    }

    #[test]
    fn o2_ai_gets_approved_as_a_strict_bool() {
        for (body, approved) in [
            (&br#"{"approved": true}"#[..], true),
            (br#"{"approved": 1}"#, false),
            (br#"{"approved": "true"}"#, false),
            (br#"{}"#, false),
        ] {
            let value = bind_confirm_body_to_org(body, "acme").unwrap();
            assert_eq!(
                value["approved"],
                approved,
                "{}",
                String::from_utf8_lossy(body)
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_persisted_turns_mark_outlives_a_dropped_browser_and_goes_with_the_task() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let released = Arc::new(AtomicBool::new(false));
        let flag = released.clone();
        let mark =
            super::super::turn_marks::TurnMark::new(move || flag.store(true, Ordering::SeqCst));
        let on_end = turn_end(None, mark);
        // The browser's body, as `persisted_turn` builds it, holds no mark.
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();
        let frames = futures::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|chunk| (chunk, rx))
        })
        .inspect(|chunk| super::super::capabilities::note_turn_frame(chunk));
        tx.send(Bytes::from_static(b"data: {\"type\":\"status\"}\n\n"))
            .unwrap();
        drop(frames);
        assert!(!released.load(Ordering::SeqCst), "the turn still runs");
        on_end(TurnEnd {
            result: o2_enterprise::enterprise::ai::chat::TurnResult::Persisted,
            committed_seq: 0,
            error_message: None,
        });
        assert!(released.load(Ordering::SeqCst));
    }

    #[test]
    fn the_persisted_turns_mark_is_owned_by_its_task_not_its_frames() {
        let source = include_str!("chat.rs");
        let production = &source[..source.find("#[cfg(test)]\nmod tests").unwrap()];
        let start = production.find("async fn persisted_turn(").unwrap();
        let body = &production[start..start + production[start..].find("\n}\n").unwrap()];
        assert!(body.contains("on_end: Some(turn_end(span, turn_mark))"));
        let inspect = &body[body.find(".inspect(").unwrap()..];
        assert!(!inspect[..inspect.find("});").unwrap()].contains("turn_mark"));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_unknown_health_waits_briefly_for_an_owner_and_a_good_one_as_configured() {
        use super::super::capabilities::HealthStatus;

        let configured = std::time::Duration::from_secs(45);
        assert_eq!(owner_wait_for(HealthStatus::Ok, configured), configured);
        assert_eq!(
            owner_wait_for(HealthStatus::Unknown, configured),
            UNKNOWN_HEALTH_OWNER_WAIT
        );
        assert_eq!(
            owner_wait_for(HealthStatus::Unknown, std::time::Duration::from_secs(2)),
            std::time::Duration::from_secs(2)
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_known_outage_refuses_the_turn_at_once_with_agent_unavailable() {
        use super::super::capabilities::HealthStatus;

        assert!(admit_with_health(HealthStatus::Ok).is_ok());
        assert!(admit_with_health(HealthStatus::Unknown).is_ok());
        let refusal = admit_with_health(HealthStatus::Unreachable).unwrap_err();
        assert_eq!(refusal.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = axum::body::to_bytes(refusal.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            (json["code"].as_str(), json["action"].as_str()),
            (Some("agent_unavailable"), Some("retry"))
        );
    }

    #[test]
    fn feedback_votes_read_rating_or_thumbs() {
        use infra::table::ai_chat_feedback::{RATING_DOWN, RATING_UP};

        assert_eq!(
            feedback_rating(&serde_json::json!({"rating": "UP"})),
            Some(RATING_UP)
        );
        assert_eq!(
            feedback_rating(&serde_json::json!({"feedback_type": "thumbs_down"})),
            Some(RATING_DOWN)
        );
        assert_eq!(feedback_rating(&serde_json::json!({"rating": 4})), None);
        assert_eq!(feedback_rating(&serde_json::json!({"rating": "meh"})), None);
    }

    #[test]
    fn confirm_bodies_become_bounded_decisions() {
        let body = serde_json::json!({"approved": true, "id": "x".repeat(200), "scope": "session", "items": [1]});
        let decision = decision_of(body.to_string().as_bytes(), "u@x", 1700).unwrap();
        assert_eq!(decision["approved"], true);
        assert_eq!(decision["by"], "u@x");
        assert_eq!(decision["at"], 1700);
        assert_eq!(decision["id"].as_str().unwrap().chars().count(), 128);
        assert_eq!(decision["scope"], "session");
        assert_eq!(decision["items"], serde_json::json!([1]));
        assert!(decision_of(br#"{"id":"c1"}"#, "u@x", 1).is_none());
        assert!(decision_of(b"not json", "u@x", 1).is_none());
    }

    #[test]
    fn a_version_answers_only_from_server_built_history() {
        let msg = |c: &str| serde_json::json!({"role": "user", "content": c});
        let mut context = serde_json::Map::new();
        let mut history = Some(vec![msg("sent by the client")]);
        set_version_history(&mut history, &mut context, Some((Vec::new(), false)));
        assert_eq!(history, None);
        let mut history = Some(vec![msg("sent by the client")]);
        set_version_history(&mut history, &mut context, None);
        assert_eq!(history, None);

        context.insert(FORK_SEED_CONTEXT_KEY.to_string(), true.into());
        let mut history = Some(vec![msg("fork seed")]);
        set_version_history(&mut history, &mut context, Some((Vec::new(), false)));
        assert_eq!(history, Some(vec![msg("fork seed")]));

        set_version_history(
            &mut history,
            &mut context,
            Some((vec![msg("before")], false)),
        );
        assert_eq!(history, Some(vec![msg("before")]));
        assert!(!context.contains_key(FORK_SEED_CONTEXT_KEY));
        set_version_history(&mut history, &mut context, Some((vec![msg("seed")], true)));
        assert_eq!(context[FORK_SEED_CONTEXT_KEY], true);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_ephemeral_turn_is_never_persisted() {
        let mut query = QueryRequest::new("q".to_string(), serde_json::json!({}));
        assert!(persists_turn(true, &query));
        assert!(!persists_turn(false, &query));
        query.ephemeral = true;
        assert!(!persists_turn(true, &query));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_query_helper_turn_runs_the_chat_agent_without_rca_inputs() {
        let context =
            serde_json::json!({"incident_id": "inc-1", "severity": "P1", "locale": "de-DE"});
        let (agent, context) =
            turn_agent_and_context("org", "user", None, context, Some(ChatMode::GenerateQuery))
                .await;
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        assert!(context.get("incident_id").is_none() && context.get("severity").is_none());
        assert_eq!(context["locale"], "de-DE");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_ephemeral_turn_without_a_session_is_admitted_and_chips_are_forwarded() {
        assert!(refuse_saved_chat("org", None).await.is_ok());
        assert!(forwarded_attachments(Some(Vec::new())).is_none());
        let chip: Attachment =
            serde_json::from_value(serde_json::json!({"kind": "field", "data": "status"})).unwrap();
        let sent = forwarded_attachments(Some(vec![chip])).unwrap();
        assert_eq!(
            (sent[0].kind.as_str(), &sent[0].data),
            ("field", &serde_json::json!("status"))
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_unknown_mode_or_a_chat_turn_marked_ephemeral_is_a_typed_400() {
        assert_eq!(
            turn_mode_problem(Some(ChatMode::Unsupported), false),
            Some("Unsupported mode")
        );
        assert!(turn_mode_problem(None, true).is_some());
        assert!(turn_mode_problem(Some(ChatMode::Chat), true).is_some());
        assert!(turn_mode_problem(Some(ChatMode::GenerateQuery), true).is_none());
        assert!(turn_mode_problem(None, false).is_none());
        let prompt: PromptRequest =
            serde_json::from_value(serde_json::json!({"messages": [], "ephemeral": true})).unwrap();
        let refusal = refuse_turn_mode("org", &prompt, None).await.unwrap_err();
        assert_eq!(refusal.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(refusal.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["code"], "invalid_request");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_chat_route_refuses_rca_mode_with_a_typed_envelope() {
        for mode in [None, Some(ChatMode::Chat), Some(ChatMode::GenerateQuery)] {
            assert!(rca_mode_refused(mode).is_none(), "{mode:?}");
        }
        assert_eq!(
            turn_mode_problem(Some(ChatMode::Rca), false),
            Some(RCA_MODE_REFUSED)
        );
        let prompt: PromptRequest =
            serde_json::from_value(serde_json::json!({"messages": [], "mode": "rca"})).unwrap();
        assert_eq!(prompt.mode, Some(ChatMode::Rca));
        let refusal = refuse_turn_mode("org", &prompt, None).await.unwrap_err();
        assert_eq!(refusal.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(refusal.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["code"], "invalid_request");
        assert_eq!(body["error"], RCA_MODE_REFUSED);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn with_the_rca_bar_passed_chat_mode_runs_sre_and_keeps_the_incident_context() {
        let client = serde_json::json!({"incident_id": "inc-1", "locale": "de-DE"});
        let route = |mode| agent_for_mode(mode, client.clone(), Some(incident_rca_context()));
        let (agent, context) = route(Some(ChatMode::Chat));
        assert_eq!(agent, SRE_CHAT_AGENT_TYPE);
        assert_eq!(context["incident_id"], "inc-1");
        assert_eq!(context["past_causes"][0], "disk full");
        assert_eq!(context["locale"], "de-DE");
        for mode in [None, Some(ChatMode::Rca)] {
            let (agent, context) = route(mode);
            assert_eq!(agent, RCA_AGENT_TYPE, "{mode:?}");
            assert_eq!(context["past_causes"][0], "disk full", "{mode:?}");
        }
        let (agent, context) = route(Some(ChatMode::GenerateQuery));
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        assert!(context.get("past_causes").is_none());
        let (agent, _) = agent_for_mode(Some(ChatMode::Chat), client.clone(), None);
        assert_eq!(agent, DEFAULT_AGENT_TYPE, "no RCA bar, no incident agent");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_ephemeral_turn_naming_a_saved_chat_is_refused_and_an_unreadable_one_fails_closed() {
        assert!(saved_chat_refusal("org", "s", Ok::<bool, String>(false)).is_ok());
        let saved = saved_chat_refusal("org", "s", Ok::<bool, String>(true)).unwrap_err();
        assert_eq!(saved.status(), StatusCode::BAD_REQUEST);
        let unreadable = saved_chat_refusal("org", "s", Err("db down")).unwrap_err();
        assert_eq!(
            unreadable.status(),
            error::history_unavailable("x").status()
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_query_turn_carries_no_cli_or_third_party_mcp_tools() {
        let (mcps, clis) = turn_tools(
            Some(ChatMode::GenerateQuery),
            vec!["github"],
            vec!["kubectl"],
        );
        assert!(mcps.is_empty() && clis.is_empty());
        let (mcps, clis) = turn_tools(None, vec!["github"], vec!["kubectl"]);
        assert_eq!((mcps, clis), (vec!["github"], vec!["kubectl"]));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn ephemeral_turns_count_against_the_active_turn_limit() {
        let caps = o2_enterprise::enterprise::ai::chat::TurnCaps::from_config();
        if caps.per_user == 0 {
            return;
        }
        let user = format!("eph-{}", config::ider::uuid());
        let held: Vec<_> = (0..caps.per_user)
            .map(|n| {
                register_ephemeral_turn("eph-org", None, &format!("t{n}"), &user, None).unwrap()
            })
            .collect();
        let Err(refusal) = register_ephemeral_turn("eph-org", None, "t-over", &user, None) else {
            panic!("a turn over the per-user cap was admitted");
        };
        assert_eq!(refusal.status(), StatusCode::TOO_MANY_REQUESTS);
        drop(held);
        assert!(register_ephemeral_turn("eph-org", None, "t-again", &user, None).is_ok());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_stop_without_a_saved_chat_reaches_the_turn_streaming_here() {
        assert!(direct_stop(false, true));
        assert!(!direct_stop(true, true));
        assert!(!direct_stop(false, false));
        let session = uuid::Uuid::now_v7().to_string();
        let _turn =
            register_ephemeral_turn("eph-org", Some(&session), "t1", "alice", None).unwrap();
        let running = o2_enterprise::enterprise::ai::chat::registry::turns("eph-org", &session);
        let running: Vec<(&str, &str)> = running
            .iter()
            .map(|t| (t.turn_id.as_str(), t.user_id.as_str()))
            .collect();
        assert!(matches!(
            direct_stop_target(None, &running, "alice"),
            Ok(StopTarget::Turn(turn)) if turn == "t1"
        ));
        assert!(direct_stop_target(None, &running, "mallory").is_err());
    }
}
