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

//! The one error envelope of the `/api/{org_id}/ai/*` routes and their SSE `error` frames.

use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use serde_json::{Map, Value};

/// The ledger code of an AI error (`80` §1.3); the wire spelling never changes once shipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AiErrorCode {
    SessionExpired,
    PermissionDenied,
    NotEnabled,
    CreditsExhausted,
    SubscriptionRequired,
    ConsentRequired,
    AuthorizationUnavailable,
    TurnLimit,
    RateLimited,
    TurnBusy,
    AlreadySubmitted,
    AgentUnavailable,
    SessionOwnerUnavailable,
    PersistenceFailed,
    ProviderError,
    RestoreRequired,
    StaleEpoch,
    ApprovalDeliveryFailed,
    HistoryUnavailable,
    NotFound,
    InvalidRequest,
    Internal,
    Unknown,
    SignedOut,
    StreamDropped,
    TurnExpired,
    ChangedSince,
    UndoExpired,
    BelowUsage,
}

impl AiErrorCode {
    pub const ALL: [AiErrorCode; 29] = [
        AiErrorCode::SessionExpired,
        AiErrorCode::PermissionDenied,
        AiErrorCode::NotEnabled,
        AiErrorCode::CreditsExhausted,
        AiErrorCode::SubscriptionRequired,
        AiErrorCode::ConsentRequired,
        AiErrorCode::AuthorizationUnavailable,
        AiErrorCode::TurnLimit,
        AiErrorCode::RateLimited,
        AiErrorCode::TurnBusy,
        AiErrorCode::AlreadySubmitted,
        AiErrorCode::AgentUnavailable,
        AiErrorCode::SessionOwnerUnavailable,
        AiErrorCode::PersistenceFailed,
        AiErrorCode::ProviderError,
        AiErrorCode::RestoreRequired,
        AiErrorCode::StaleEpoch,
        AiErrorCode::ApprovalDeliveryFailed,
        AiErrorCode::HistoryUnavailable,
        AiErrorCode::NotFound,
        AiErrorCode::InvalidRequest,
        AiErrorCode::Internal,
        AiErrorCode::Unknown,
        AiErrorCode::SignedOut,
        AiErrorCode::StreamDropped,
        AiErrorCode::TurnExpired,
        AiErrorCode::ChangedSince,
        AiErrorCode::UndoExpired,
        AiErrorCode::BelowUsage,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AiErrorCode::SessionExpired => "session_expired",
            AiErrorCode::PermissionDenied => "permission_denied",
            AiErrorCode::NotEnabled => "not_enabled",
            AiErrorCode::CreditsExhausted => "credits_exhausted",
            AiErrorCode::SubscriptionRequired => "subscription_required",
            AiErrorCode::ConsentRequired => "consent_required",
            AiErrorCode::AuthorizationUnavailable => "authorization_unavailable",
            AiErrorCode::TurnLimit => "turn_limit",
            AiErrorCode::RateLimited => "rate_limited",
            AiErrorCode::TurnBusy => "turn_busy",
            AiErrorCode::AlreadySubmitted => "already_submitted",
            AiErrorCode::AgentUnavailable => "agent_unavailable",
            AiErrorCode::SessionOwnerUnavailable => "session_owner_unavailable",
            AiErrorCode::PersistenceFailed => "persistence_failed",
            AiErrorCode::ProviderError => "provider_error",
            AiErrorCode::RestoreRequired => "restore_required",
            AiErrorCode::StaleEpoch => "stale_epoch",
            AiErrorCode::ApprovalDeliveryFailed => "approval_delivery_failed",
            AiErrorCode::HistoryUnavailable => "history_unavailable",
            AiErrorCode::NotFound => "not_found",
            AiErrorCode::InvalidRequest => "invalid_request",
            AiErrorCode::Internal => "internal",
            AiErrorCode::Unknown => "unknown",
            AiErrorCode::SignedOut => "signed_out",
            AiErrorCode::StreamDropped => "stream_dropped",
            AiErrorCode::TurnExpired => "turn_expired",
            AiErrorCode::ChangedSince => "changed_since",
            AiErrorCode::UndoExpired => "undo_expired",
            AiErrorCode::BelowUsage => "below_usage",
        }
    }

    /// The code spelled `code` exactly as the ledger does.
    pub fn from_ledger(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == code)
    }

    /// The ledger code of a stored `ai_chat_turns.error_code` or an upstream code.
    pub fn from_stored(code: &str) -> Option<Self> {
        if let Some(code) = Self::from_ledger(code) {
            return Some(code);
        }
        let code = match code {
            "agent_unreachable"
            | "stream_interrupted"
            | "turn_timeout"
            | "restore_failed"
            | "event_store_unavailable"
            | "internal_secret_required" => AiErrorCode::AgentUnavailable,
            // Stored for any o2-ai status it was not told apart by; 500 is the common one.
            "agent_query_failed" => AiErrorCode::Internal,
            "turn_in_progress" => AiErrorCode::TurnBusy,
            "epoch_out_of_range" => AiErrorCode::StaleEpoch,
            "epoch_conflict" => AiErrorCode::HistoryUnavailable,
            "fenced" | "lease_lost" | "event_too_large" => AiErrorCode::PersistenceFailed,
            "unauthorized" => AiErrorCode::PermissionDenied,
            "usage_denied" => AiErrorCode::CreditsExhausted,
            "chat_deleted" | "session_not_found" => AiErrorCode::NotFound,
            "agent_error" => AiErrorCode::ProviderError,
            _ => return None,
        };
        Some(code)
    }

    /// What the live stream said for a stored `error_code`, so a reload shows the same failure.
    pub fn live_failure(stored: &str) -> (Self, AiErrorAction) {
        // The turn task owns the spellings it stores, so its own table decides first.
        let code = o2_enterprise::enterprise::ai::chat::ledger_code(stored)
            .and_then(Self::from_ledger)
            .or_else(|| Self::from_stored(stored))
            .unwrap_or(AiErrorCode::Unknown);
        let action = code
            .default_action()
            .unwrap_or(if code.default_retryable() {
                AiErrorAction::Retry
            } else {
                AiErrorAction::None
            });
        (code, action)
    }

    pub fn default_status(self) -> StatusCode {
        match self {
            AiErrorCode::SessionExpired | AiErrorCode::SignedOut => StatusCode::UNAUTHORIZED,
            AiErrorCode::PermissionDenied => StatusCode::FORBIDDEN,
            AiErrorCode::NotEnabled | AiErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
            AiErrorCode::CreditsExhausted | AiErrorCode::SubscriptionRequired => {
                StatusCode::PAYMENT_REQUIRED
            }
            AiErrorCode::ConsentRequired => StatusCode::PRECONDITION_FAILED,
            AiErrorCode::AuthorizationUnavailable
            | AiErrorCode::AgentUnavailable
            | AiErrorCode::HistoryUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            AiErrorCode::TurnLimit | AiErrorCode::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AiErrorCode::TurnBusy
            | AiErrorCode::AlreadySubmitted
            | AiErrorCode::SessionOwnerUnavailable
            | AiErrorCode::RestoreRequired
            | AiErrorCode::StaleEpoch
            | AiErrorCode::ChangedSince
            | AiErrorCode::BelowUsage => StatusCode::CONFLICT,
            AiErrorCode::NotFound => StatusCode::NOT_FOUND,
            AiErrorCode::TurnExpired | AiErrorCode::UndoExpired => StatusCode::GONE,
            AiErrorCode::PersistenceFailed
            | AiErrorCode::ProviderError
            | AiErrorCode::ApprovalDeliveryFailed
            | AiErrorCode::Internal
            | AiErrorCode::StreamDropped
            | AiErrorCode::Unknown => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn default_retryable(self) -> bool {
        matches!(
            self,
            AiErrorCode::AuthorizationUnavailable
                | AiErrorCode::TurnLimit
                | AiErrorCode::RateLimited
                | AiErrorCode::AgentUnavailable
                | AiErrorCode::SessionOwnerUnavailable
                | AiErrorCode::ProviderError
                | AiErrorCode::RestoreRequired
                | AiErrorCode::ApprovalDeliveryFailed
                | AiErrorCode::HistoryUnavailable
                | AiErrorCode::StreamDropped
        )
    }

    /// The one action the client offers; `None` leaves the choice to the client's code mapping.
    pub fn default_action(self) -> Option<AiErrorAction> {
        match self {
            AiErrorCode::SessionExpired => Some(AiErrorAction::SignIn),
            AiErrorCode::ConsentRequired => Some(AiErrorAction::EnablePaidUsage),
            AiErrorCode::AuthorizationUnavailable
            | AiErrorCode::HistoryUnavailable
            | AiErrorCode::ApprovalDeliveryFailed
            | AiErrorCode::ProviderError => Some(AiErrorAction::Retry),
            AiErrorCode::PermissionDenied | AiErrorCode::NotEnabled => {
                Some(AiErrorAction::AskAdmin)
            }
            AiErrorCode::CreditsExhausted | AiErrorCode::SubscriptionRequired => {
                Some(AiErrorAction::ManageBilling)
            }
            AiErrorCode::TurnLimit | AiErrorCode::RateLimited | AiErrorCode::StreamDropped => {
                Some(AiErrorAction::Retry)
            }
            AiErrorCode::SignedOut => Some(AiErrorAction::SignIn),
            AiErrorCode::AgentUnavailable | AiErrorCode::SessionOwnerUnavailable => {
                Some(AiErrorAction::Retry)
            }
            AiErrorCode::TurnBusy
            | AiErrorCode::InvalidRequest
            | AiErrorCode::PersistenceFailed
            | AiErrorCode::NotFound
            | AiErrorCode::Internal
            | AiErrorCode::ChangedSince
            | AiErrorCode::UndoExpired
            | AiErrorCode::BelowUsage => Some(AiErrorAction::None),
            AiErrorCode::AlreadySubmitted
            | AiErrorCode::RestoreRequired
            | AiErrorCode::StaleEpoch
            | AiErrorCode::TurnExpired => Some(AiErrorAction::Reload),
            _ => None,
        }
    }
}

impl std::fmt::Display for AiErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What the client's one button does; the client owns its copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiErrorAction {
    Retry,
    SignIn,
    EnablePaidUsage,
    ManageBilling,
    AskAdmin,
    Reload,
    None,
}

impl AiErrorAction {
    pub fn as_str(self) -> &'static str {
        match self {
            AiErrorAction::Retry => "retry",
            AiErrorAction::SignIn => "sign_in",
            AiErrorAction::EnablePaidUsage => "enable_paid_usage",
            AiErrorAction::ManageBilling => "manage_billing",
            AiErrorAction::AskAdmin => "ask_admin",
            AiErrorAction::Reload => "reload",
            AiErrorAction::None => "none",
        }
    }
}

/// The envelope, plus the legacy `error`, `error_code` and `recoverable` keys old clients read.
#[derive(Debug, Clone)]
pub struct AiErrorEnvelope {
    status: StatusCode,
    code: AiErrorCode,
    message: String,
    retryable: bool,
    retry_after: Option<u64>,
    action: Option<AiErrorAction>,
    legacy_code: Option<String>,
    extra: Map<String, Value>,
}

impl AiErrorEnvelope {
    /// `message` is shown only inside Details, so it must never carry upstream text or prompts.
    pub fn new(code: AiErrorCode, message: impl Into<String>) -> Self {
        Self {
            status: code.default_status(),
            code,
            message: message.into(),
            retryable: code.default_retryable(),
            retry_after: None,
            action: code.default_action(),
            legacy_code: None,
            extra: Map::new(),
        }
    }

    pub fn status(mut self, status: StatusCode) -> Self {
        self.status = status;
        self
    }

    pub fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn retry_after(mut self, secs: Option<u64>) -> Self {
        self.retry_after = secs;
        self
    }

    pub fn action(mut self, action: Option<AiErrorAction>) -> Self {
        self.action = action;
        self
    }

    /// The `error_code` an older server sent for this cause.
    pub fn legacy_code(mut self, code: impl Into<String>) -> Self {
        self.legacy_code = Some(code.into());
        self
    }

    /// An extra key kept from the pre-envelope body; never overrides an envelope key.
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.extra.insert(key.to_string(), value.into());
        self
    }

    pub fn code(&self) -> AiErrorCode {
        self.code
    }

    pub fn http_status(&self) -> StatusCode {
        self.status
    }

    pub fn message_text(&self) -> &str {
        &self.message
    }

    pub fn body(&self) -> Value {
        let mut body = self.extra.clone();
        body.insert("code".into(), self.code.as_str().into());
        body.insert("message".into(), self.message.clone().into());
        body.insert("retryable".into(), self.retryable.into());
        if let Some(secs) = self.retry_after {
            body.insert("retry_after".into(), secs.into());
        }
        if let Some(action) = self.action {
            body.insert("action".into(), action.as_str().into());
        }
        body.insert("error".into(), self.message.clone().into());
        if let Some(legacy) = &self.legacy_code {
            body.insert("error_code".into(), legacy.clone().into());
        }
        body.insert("recoverable".into(), self.retryable.into());
        Value::Object(body)
    }

    /// The same envelope as one SSE `error` frame.
    pub fn to_sse_frame(&self) -> Bytes {
        let mut frame = self.body();
        if let Some(obj) = frame.as_object_mut() {
            obj.insert("type".into(), "error".into());
        }
        Bytes::from(format!("data: {frame}\n\n"))
    }
}

impl IntoResponse for AiErrorEnvelope {
    fn into_response(self) -> Response {
        let retry_after = self
            .retry_after
            .filter(|_| {
                matches!(
                    self.status,
                    StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
                )
            })
            .map(HeaderValue::from);
        let mut response = (self.status, Json(self.body())).into_response();
        if let Some(value) = retry_after {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response
    }
}

pub fn invalid_request(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::InvalidRequest, message).into_response()
}

/// A JSON body as `T`; a malformed body or an unknown field is the 400 envelope, not axum's 422.
pub fn json_body<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<T, Response> {
    serde_json::from_slice(body).map_err(|e| invalid_request(format!("Invalid request body: {e}")))
}

pub fn not_found(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::NotFound, message).into_response()
}

pub fn permission_denied(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::PermissionDenied, message).into_response()
}

pub fn session_expired(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::SessionExpired, message).into_response()
}

/// The deployment or the org has the assistant off; history routes answer it as a 404.
pub fn not_enabled(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::NotEnabled, message).into_response()
}

pub fn history_unavailable(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::HistoryUnavailable, message).into_response()
}

pub fn internal(message: impl Into<String>) -> Response {
    AiErrorEnvelope::new(AiErrorCode::Internal, message).into_response()
}

/// Gives a forwarded `error` frame the envelope keys it lacks; keys it already has are kept.
pub fn normalize_error_frame(frame: &mut Map<String, Value>) {
    let text = |frame: &Map<String, Value>, key: &str| {
        frame.get(key).and_then(Value::as_str).map(str::to_string)
    };
    let given = text(frame, "code");
    let code = match given.as_deref().and_then(AiErrorCode::from_ledger) {
        Some(code) => code,
        None => {
            let stored = given
                .clone()
                .or_else(|| text(frame, "error_code"))
                .or_else(|| text(frame, "category"));
            let code = stored
                .as_deref()
                .and_then(AiErrorCode::from_stored)
                .or_else(|| {
                    frame
                        .contains_key("error_type")
                        .then_some(AiErrorCode::ProviderError)
                })
                .unwrap_or(AiErrorCode::Unknown);
            if let Some(given) = given
                && !frame.contains_key("error_code")
            {
                frame.insert("error_code".into(), given.into());
            }
            frame.insert("code".into(), code.as_str().into());
            code
        }
    };
    let recoverable = frame.get("recoverable").and_then(Value::as_bool);
    // One meaning on every path: the client offers Stop, never a retry, for a busy chat.
    let busy = code == AiErrorCode::TurnBusy;
    let retryable = !busy
        && frame
            .get("retryable")
            .and_then(Value::as_bool)
            .or(recoverable)
            .unwrap_or_else(|| code.default_retryable());
    frame.insert("retryable".into(), retryable.into());
    if busy {
        frame.insert("action".into(), AiErrorAction::None.as_str().into());
    }
    frame.entry("recoverable").or_insert(retryable.into());
    if !frame.contains_key("action")
        && let Some(action) = code.default_action()
    {
        frame.insert("action".into(), action.as_str().into());
    }
    let message = text(frame, "message").or_else(|| text(frame, "error"));
    if let Some(message) = message {
        frame.entry("message").or_insert(message.clone().into());
        frame.entry("error").or_insert(message.into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_bad_or_unknown_field_body_is_the_400_envelope() {
        #[derive(Debug, serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        #[allow(dead_code)]
        struct Patch {
            enabled: bool,
        }
        for body in [
            r#"{"enabled":true,"x":1}"#,
            r#"{"enabled":"yes"}"#,
            "not json",
        ] {
            let response = json_body::<Patch>(body.as_bytes()).unwrap_err();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(json["code"], "invalid_request", "{body}");
        }
        assert!(json_body::<Patch>(br#"{"enabled":false}"#).is_ok());
    }

    #[test]
    fn every_code_serialises_to_its_ledger_string() {
        let spelled: Vec<&str> = AiErrorCode::ALL.iter().map(|c| c.as_str()).collect();
        assert_eq!(
            spelled,
            vec![
                "session_expired",
                "permission_denied",
                "not_enabled",
                "credits_exhausted",
                "subscription_required",
                "consent_required",
                "authorization_unavailable",
                "turn_limit",
                "rate_limited",
                "turn_busy",
                "already_submitted",
                "agent_unavailable",
                "session_owner_unavailable",
                "persistence_failed",
                "provider_error",
                "restore_required",
                "stale_epoch",
                "approval_delivery_failed",
                "history_unavailable",
                "not_found",
                "invalid_request",
                "internal",
                "unknown",
                "signed_out",
                "stream_dropped",
                "turn_expired",
                "changed_since",
                "undo_expired",
                "below_usage",
            ]
        );
        for code in AiErrorCode::ALL {
            assert_eq!(AiErrorCode::from_ledger(code.as_str()), Some(code));
            let body = AiErrorEnvelope::new(code, "m").body();
            assert_eq!(body["code"], code.as_str());
        }
    }

    #[test]
    fn stored_spellings_map_to_their_ledger_code_on_read() {
        for (stored, ledger) in [
            ("agent_unreachable", AiErrorCode::AgentUnavailable),
            ("stream_interrupted", AiErrorCode::AgentUnavailable),
            ("turn_in_progress", AiErrorCode::TurnBusy),
            ("epoch_out_of_range", AiErrorCode::StaleEpoch),
            ("usage_denied", AiErrorCode::CreditsExhausted),
            ("unauthorized", AiErrorCode::PermissionDenied),
            ("fenced", AiErrorCode::PersistenceFailed),
            ("lease_lost", AiErrorCode::PersistenceFailed),
            ("agent_query_failed", AiErrorCode::Internal),
            (
                "session_owner_unavailable",
                AiErrorCode::SessionOwnerUnavailable,
            ),
        ] {
            assert_eq!(AiErrorCode::from_stored(stored), Some(ledger), "{stored}");
        }
        assert_eq!(AiErrorCode::from_stored("never_heard_of_it"), None);
    }

    #[test]
    fn a_history_read_says_what_the_live_stream_said() {
        for (stored, code, action) in [
            (
                "fenced",
                AiErrorCode::PersistenceFailed,
                AiErrorAction::None,
            ),
            (
                "lease_lost",
                AiErrorCode::PersistenceFailed,
                AiErrorAction::None,
            ),
            (
                "stale_epoch",
                AiErrorCode::StaleEpoch,
                AiErrorAction::Reload,
            ),
            (
                "persistence_failed",
                AiErrorCode::PersistenceFailed,
                AiErrorAction::None,
            ),
            (
                "event_too_large",
                AiErrorCode::PersistenceFailed,
                AiErrorAction::None,
            ),
            (
                "agent_query_failed",
                AiErrorCode::Internal,
                AiErrorAction::None,
            ),
            (
                "agent_unreachable",
                AiErrorCode::AgentUnavailable,
                AiErrorAction::Retry,
            ),
            (
                "stream_interrupted",
                AiErrorCode::AgentUnavailable,
                AiErrorAction::Retry,
            ),
            (
                "turn_timeout",
                AiErrorCode::AgentUnavailable,
                AiErrorAction::Retry,
            ),
            (
                "agent_unavailable",
                AiErrorCode::AgentUnavailable,
                AiErrorAction::Retry,
            ),
            (
                "turn_in_progress",
                AiErrorCode::TurnBusy,
                AiErrorAction::None,
            ),
            (
                "epoch_out_of_range",
                AiErrorCode::StaleEpoch,
                AiErrorAction::Reload,
            ),
            (
                "unauthorized",
                AiErrorCode::PermissionDenied,
                AiErrorAction::AskAdmin,
            ),
            (
                "rate_limited",
                AiErrorCode::RateLimited,
                AiErrorAction::Retry,
            ),
            (
                "session_owner_unavailable",
                AiErrorCode::SessionOwnerUnavailable,
                AiErrorAction::Retry,
            ),
            ("chat_deleted", AiErrorCode::NotFound, AiErrorAction::None),
            (
                "never_heard_of_it",
                AiErrorCode::Unknown,
                AiErrorAction::None,
            ),
        ] {
            assert_eq!(
                AiErrorCode::live_failure(stored),
                (code, action),
                "{stored}"
            );
        }
    }

    #[test]
    fn legacy_mirrors_are_present_with_the_same_values() {
        let body = AiErrorEnvelope::new(AiErrorCode::TurnLimit, "Too many")
            .legacy_code("turn_limit")
            .with("scope", "user")
            .body();
        assert_eq!(body["error"], body["message"]);
        assert_eq!(body["recoverable"], body["retryable"]);
        assert_eq!(body["error_code"], "turn_limit");
        assert_eq!(body["scope"], "user");
        let plain = AiErrorEnvelope::new(AiErrorCode::NotFound, "gone").body();
        assert!(plain.get("error_code").is_none());
        assert!(plain.get("retry_after").is_none());
    }

    #[test]
    fn an_extra_key_never_overrides_the_envelope() {
        let body = AiErrorEnvelope::new(AiErrorCode::NotFound, "gone")
            .with("code", 404)
            .body();
        assert_eq!(body["code"], "not_found");
    }

    #[test]
    fn retry_after_sets_the_header_on_429_and_503_only() {
        let limited = AiErrorEnvelope::new(AiErrorCode::RateLimited, "slow down")
            .retry_after(Some(42))
            .into_response();
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(limited.headers()[header::RETRY_AFTER], "42");
        let conflict = AiErrorEnvelope::new(AiErrorCode::TurnBusy, "busy")
            .retry_after(Some(5))
            .into_response();
        assert!(conflict.headers().get(header::RETRY_AFTER).is_none());
        let none = AiErrorEnvelope::new(AiErrorCode::AgentUnavailable, "down").into_response();
        assert!(none.headers().get(header::RETRY_AFTER).is_none());
    }

    #[test]
    fn an_sse_frame_is_the_envelope_typed_error() {
        let frame = AiErrorEnvelope::new(AiErrorCode::AgentUnavailable, "down")
            .legacy_code("agent_unreachable")
            .to_sse_frame();
        let text = std::str::from_utf8(&frame).unwrap();
        assert!(
            text.starts_with("data: ") && text.ends_with("\n\n"),
            "{text}"
        );
        let value: Value = serde_json::from_str(text["data: ".len()..].trim()).unwrap();
        assert_eq!(value["type"], "error");
        assert_eq!(value["code"], "agent_unavailable");
        assert_eq!(value["error_code"], "agent_unreachable");
        assert_eq!(value["retryable"], true);
    }

    #[test]
    fn a_forwarded_frame_gains_the_keys_it_lacks_and_keeps_the_rest() {
        let mut frame = serde_json::json!({
            "type": "error",
            "code": "agent_unreachable",
            "error": "The AI assistant is unreachable right now. Please try again.",
            "recoverable": true,
        });
        normalize_error_frame(frame.as_object_mut().unwrap());
        assert_eq!(frame["code"], "agent_unavailable");
        assert_eq!(frame["error_code"], "agent_unreachable");
        assert_eq!(frame["retryable"], true);
        assert_eq!(frame["message"], frame["error"]);

        let mut enveloped = AiErrorEnvelope::new(AiErrorCode::AgentUnavailable, "down")
            .retryable(false)
            .body();
        let before = enveloped.clone();
        normalize_error_frame(enveloped.as_object_mut().unwrap());
        assert_eq!(enveloped, before, "an envelope is left as it is");

        let mut busy = serde_json::json!({
            "type": "error",
            "code": "turn_in_progress",
            "recoverable": true,
            "action": "retry",
        });
        normalize_error_frame(busy.as_object_mut().unwrap());
        assert_eq!(busy["code"], "turn_busy");
        assert_eq!(busy["retryable"], false);
        assert_eq!(busy["action"], "none");

        let mut bare = serde_json::json!({"type": "error"});
        normalize_error_frame(bare.as_object_mut().unwrap());
        assert_eq!(bare["code"], "unknown");
        assert_eq!(bare["retryable"], false);
    }
}
