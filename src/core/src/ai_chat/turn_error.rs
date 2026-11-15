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

//! Port of o2-ai's `classify_runner_error`: the `error` frame a failed turn's live stream sent.

use std::sync::LazyLock;

use config::utils::json::{Map, Value, json};
use regex::Regex;

const PROVIDER_ERROR: &str = "provider_error";
const RATE_LIMITED: &str = "rate_limited";
const AGENT_UNAVAILABLE: &str = "agent_unavailable";
const PERMISSION_DENIED_TOOL: &str = "permission_denied_tool";
const UNKNOWN: &str = "unknown";
const RETRY_AFTER_MAX_SECONDS: f64 = 3600.0;
const FAILED_PROVIDER: &str = "The model provider failed";
/// Provider text markers per cause, in o2-ai's order: the first match wins.
const PROVIDER_CAUSES: [(&str, &[&str]); 4] = [
    ("llm_overload", &["overload", "529", "capacity"]),
    (
        "rate_limit",
        &["rate limit", "rate_limit", "429", "too many requests"],
    ),
    ("auth_error", &["auth", "401", "403"]),
    (
        "unsupported_images",
        &["image", "media", "vision", "multimodal"],
    ),
];

// A delay needs a unit, or the header form (`Retry-After: 30`); a bare number after prose is
// ignored.
static RETRY_AFTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)retry[\s_-]*after(?P<ms>[\s_-]*ms)?\s*(?P<sep>[:=])?\s*(?:in\s+)?(?P<num>\d{1,9}(?:\.\d+)?)\s*(?P<unit>milliseconds?|msecs?|ms|minutes?|mins?|m|seconds?|secs?|s)?\b",
    )
    .expect("valid retry-after pattern")
});

/// A 2.x execution failure as o2-ai raises it: opencode's error `type`, text and HTTP status.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProviderFailure {
    message: String,
    name: String,
    status: Option<i64>,
}

impl ProviderFailure {
    /// o2-ai's `session_error` of a `session.execution.failed` carrying `error`.
    pub(crate) fn of(error: Option<&Value>) -> Self {
        let Some(Value::Object(error)) = error else {
            return Self {
                message: FAILED_PROVIDER.into(),
                name: UNKNOWN.into(),
                status: None,
            };
        };
        Self {
            message: error_text(error),
            name: error
                .get("type")
                .filter(|v| truthy(v))
                .map(text)
                .unwrap_or_default(),
            status: error.get("status").and_then(Value::as_i64),
        }
    }
}

struct Classification {
    subtype: &'static str,
    message: &'static str,
    recoverable: bool,
    code: &'static str,
    retry_after: Option<i64>,
}

/// The `error` frame of a turn that failed with provider `text`, which is only sniffed, never
/// shown.
pub(crate) fn error_frame(text: &str, cause: Option<&ProviderFailure>) -> Value {
    let c = classify(text, cause);
    let retryable = if c.code == PROVIDER_ERROR {
        c.recoverable
    } else {
        ledger_retryable(c.code)
    };
    let action = if c.code == PROVIDER_ERROR && !retryable {
        "none"
    } else {
        ledger_action(c.code)
    };
    let mut frame = json!({
        "type": "error",
        "error_type": c.subtype,
        "error": c.message,
        "recoverable": c.recoverable,
        "code": c.code,
        "message": c.message,
        "retryable": retryable,
        "action": action,
    });
    if let Some(seconds) = c.retry_after {
        frame["retry_after"] = seconds.into();
    }
    frame
}

fn classify(text: &str, cause: Option<&ProviderFailure>) -> Classification {
    let raw = cause.map_or(text, |c| c.message.as_str());
    let sniffed = match cause {
        Some(c) => {
            let status = c.status.filter(|s| *s != 0).map(|s| s.to_string());
            format!("{} {} {}", c.message, status.unwrap_or_default(), c.name).to_lowercase()
        }
        None => text.to_lowercase(),
    };
    if let Some(subtype) = provider_cause(&sniffed) {
        return llm_classification(subtype, raw);
    }
    let classified = |code, subtype, message, recoverable| Classification {
        subtype,
        message,
        recoverable,
        code,
        retry_after: None,
    };
    if sniffed.contains("opencode server") || sniffed.contains("ensure it is running") {
        return classified(
            AGENT_UNAVAILABLE,
            "ConnectError",
            "The AI backend service is temporarily unavailable. Please try again in a moment.",
            true,
        );
    }
    if let Some(cause) = cause {
        if super::projection::is_permission_rejection(&cause.message) {
            return classified(
                PERMISSION_DENIED_TOOL,
                "permission_denied",
                "The agent stopped because a tool call was not permitted.",
                false,
            );
        }
        // An unknown status may be transient (a dropped connection); a 4xx would fail again.
        let recoverable = cause.status.is_none_or(|s| s >= 500);
        return classified(
            PROVIDER_ERROR,
            PROVIDER_ERROR,
            "The AI model provider returned an error. Please try again.",
            recoverable,
        );
    }
    let message = if sniffed.contains("connection") || sniffed.contains("timeout") {
        "A connection error occurred. The service may be temporarily unavailable."
    } else if sniffed.contains("auth") {
        "An authentication error occurred."
    } else {
        "An unexpected error occurred. Please try again or contact support if this persists."
    };
    classified(UNKNOWN, UNKNOWN, message, false)
}

fn provider_cause(sniffed: &str) -> Option<&'static str> {
    PROVIDER_CAUSES
        .iter()
        .find(|(_, markers)| markers.iter().any(|m| sniffed.contains(m)))
        .map(|(subtype, _)| *subtype)
}

fn llm_classification(subtype: &'static str, raw: &str) -> Classification {
    let (code, message, recoverable) = match subtype {
        "llm_overload" => (
            PROVIDER_ERROR,
            "The AI service is experiencing high load. Please try again.",
            true,
        ),
        "rate_limit" => (
            RATE_LIMITED,
            "Too many requests. Please wait before trying again.",
            true,
        ),
        "auth_error" => (
            PROVIDER_ERROR,
            "AI service authentication error. Please contact your administrator.",
            false,
        ),
        _ => (
            PROVIDER_ERROR,
            "The selected model does not support image inputs.",
            true,
        ),
    };
    Classification {
        subtype,
        message,
        recoverable,
        code,
        retry_after: (code == RATE_LIMITED)
            .then(|| retry_after_seconds(raw))
            .flatten(),
    }
}

fn ledger_retryable(code: &str) -> bool {
    code != PERMISSION_DENIED_TOOL
}

fn ledger_action(code: &str) -> &'static str {
    if code == PERMISSION_DENIED_TOOL {
        "ask_admin"
    } else {
        "retry"
    }
}

/// Whole seconds of the delay a provider text names (ms, s or minutes), capped at an hour.
fn retry_after_seconds(text: &str) -> Option<i64> {
    let found = RETRY_AFTER.captures(text)?;
    let unit = if found.name("ms").is_some() {
        0.001
    } else if let Some(unit) = found.name("unit") {
        let unit = unit.as_str().to_lowercase();
        if ["ms", "msec", "milli"].iter().any(|p| unit.starts_with(p)) {
            0.001
        } else if unit.starts_with('m') {
            60.0
        } else {
            1.0
        }
    } else if found.name("sep").is_some() {
        1.0
    } else {
        return None;
    };
    let seconds = found["num"].parse::<f64>().ok()? * unit;
    (seconds.is_finite() && seconds > 0.0)
        .then(|| seconds.ceil().min(RETRY_AFTER_MAX_SECONDS) as i64)
}

/// o2-ai's `_extract_error_message` of an error object.
fn error_text(error: &Map<String, Value>) -> String {
    if let Some(Value::Object(data)) = error.get("data")
        && let Some(said) = ["message", "error"]
            .into_iter()
            .find_map(|k| data.get(k).filter(|v| truthy(v)))
    {
        return text(said);
    }
    if let Some(said) = ["message", "name", "type"]
        .into_iter()
        .find_map(|k| error.get(k).filter(|v| truthy(v)))
    {
        return text(said);
    }
    Value::Object(error.clone())
        .to_string()
        .chars()
        .take(500)
        .collect()
}

fn text(value: &Value) -> String {
    super::projection::py_str(value)
}

fn truthy(value: &Value) -> bool {
    super::projection::truthy(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rate_limit_names_its_delay_and_offers_a_retry() {
        let frame = error_frame("429 Too Many Requests, retry after 30s", None);
        assert_eq!(frame["code"], RATE_LIMITED);
        assert_eq!(frame["error_type"], "rate_limit");
        assert_eq!(frame["retry_after"], 30);
        assert_eq!(frame["action"], "retry");
        assert_eq!(retry_after_seconds("Retry-After: 2"), Some(2));
        assert_eq!(retry_after_seconds("retry after 1500ms"), Some(2));
        assert_eq!(retry_after_seconds("retry after 5 minutes"), Some(300));
        assert_eq!(retry_after_seconds("retry after 30"), None);
    }

    #[test]
    fn a_provider_failure_is_retryable_unless_its_status_says_it_would_fail_again() {
        let failure = |status: Value| {
            ProviderFailure::of(Some(
                &json!({"type": "provider.no-route", "message": "x", "status": status}),
            ))
        };
        let frame = error_frame("x", Some(&failure(json!(400))));
        assert_eq!(
            (frame["code"].clone(), frame["action"].clone()),
            (json!(PROVIDER_ERROR), json!("none"))
        );
        assert_eq!(
            error_frame("x", Some(&failure(json!(502))))["retryable"],
            true
        );
        let denied = ProviderFailure::of(Some(&json!({"message": "user rejected permission"})));
        assert_eq!(error_frame("", Some(&denied))["action"], "ask_admin");
        let bare = ProviderFailure::of(None);
        assert_eq!(error_frame("", Some(&bare))["code"], PROVIDER_ERROR);
    }

    #[test]
    fn a_text_failure_never_copies_the_providers_text() {
        let frame = error_frame(r#"{"error":{"secret":"sk-123"}}"#, None);
        assert_eq!(frame["code"], UNKNOWN);
        assert!(!frame.to_string().contains("sk-123"), "{frame}");
        let down = error_frame("cannot reach the opencode server", None);
        assert_eq!(down["code"], AGENT_UNAVAILABLE);
    }
}
