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

//! One audit entry and one health update per finished gateway toolset call, as its part is stored.

use std::sync::Arc;

use config::{
    meta::oncall::confidence::call_ref,
    utils::json::{Map, Value},
};
use infra::table::ai_toolset_health::{self, CallOutcome};
use o2_enterprise::enterprise::{
    ai::{
        chat::{OnCommit, TurnIdentity, batcher::DurableEvent},
        toolsets::push::normalize_tool_name,
    },
    common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::get_config as get_o2_config,
    },
};

use super::{
    projection::{gateway_call, obj},
    rca_thread::{ms_to_us, updated_part},
};

/// A finished `toolset_tool_call` or `toolset_cli_run`, as audit and health record it.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolsetCall {
    pub toolset: String,
    /// The vendor tool; `run` for a CLI.
    pub tool: String,
    pub call_id: String,
    pub call_ref: Option<String>,
    pub result_bytes: usize,
    pub duration_ms: Option<i64>,
    /// Microseconds; the part's end, else its start.
    pub at: Option<i64>,
    /// A fixed error kind; no tool part text is kept, as it can echo arguments.
    pub error: Option<String>,
}

/// Who ran the turn whose parts are stored.
#[derive(Debug, Clone)]
struct TurnOwner {
    org_id: String,
    user_id: String,
    session_id: String,
    turn_id: String,
}

/// `on_commit` that also records the batch's toolset calls; listings and `toolset_read_output`
/// aren't.
pub fn with_toolset_calls(identity: &TurnIdentity, inner: Option<OnCommit>) -> OnCommit {
    let owner = Arc::new(TurnOwner {
        org_id: identity.org_id.clone(),
        user_id: identity.user_id.clone(),
        session_id: identity.session_id.clone(),
        turn_id: identity.turn_id.clone(),
    });
    Arc::new(move |events: &[DurableEvent]| {
        if let Some(inner) = &inner {
            inner(events);
        }
        let calls = toolset_calls(events);
        if calls.is_empty() {
            return;
        }
        let owner = owner.clone();
        tokio::spawn(async move { record(&owner, calls).await });
    })
}

/// The finished gateway calls among committed events, in event order.
pub fn toolset_calls(events: &[DurableEvent]) -> Vec<ToolsetCall> {
    events
        .iter()
        .filter_map(|event| call_of(updated_part(event)?))
        .collect()
}

fn call_of(part: &Map<String, Value>) -> Option<ToolsetCall> {
    if part.get("type").and_then(Value::as_str) != Some("tool") {
        return None;
    }
    let state = obj(part.get("state"))?;
    let status = state.get("status").and_then(Value::as_str)?;
    if status != "completed" && status != "error" {
        return None;
    }
    let name = part.get("tool").and_then(Value::as_str)?;
    let call = gateway_call(name, obj(state.get("input")))?;
    let metadata = obj(state.get("metadata"));
    // A spilled result's output is a pointer; o2-ai records the gateway result's own size.
    let result_bytes = metadata
        .and_then(|m| m.get("result_bytes"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let exit = metadata
        .and_then(|m| m.get("exit"))
        .and_then(Value::as_i64)
        .filter(|code| *code != 0);
    let error = match (status, exit) {
        (_, Some(code)) if call.cli => Some(format!("exit {code}")),
        ("error", _) => Some(error_kind(metadata, state.get("error")).to_string()),
        _ => None,
    };
    let time = obj(state.get("time"));
    let start = time.and_then(|t| ms_to_us(t.get("start")));
    let end = time.and_then(|t| ms_to_us(t.get("end")));
    let call_id = part
        .get("callID")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Some(ToolsetCall {
        toolset: call.toolset.to_string(),
        tool: call.tool.to_string(),
        call_ref: (!call_id.is_empty()).then(|| call_ref(&call_id)),
        call_id,
        result_bytes,
        duration_ms: start.zip(end).map(|(s, e)| (e - s) / 1000),
        at: end.or(start),
        error,
    })
}

/// One of a few fixed kinds; the error text is only matched, never stored.
fn error_kind(metadata: Option<&Map<String, Value>>, error: Option<&Value>) -> String {
    let status = metadata
        .and_then(|m| m.get("http_status").or_else(|| m.get("status")))
        .and_then(Value::as_u64);
    let text = match error {
        Some(Value::String(t)) => t.to_ascii_lowercase(),
        Some(other) => other.to_string().to_ascii_lowercase(),
        None => String::new(),
    };
    let status = status.or_else(|| {
        text.split(|c: char| !c.is_ascii_digit())
            .filter(|w| w.len() == 3)
            .filter_map(|w| w.parse::<u64>().ok())
            .find(|code| (400..600).contains(code))
    });
    match status {
        Some(429) => "rate limited".to_string(),
        Some(code) if code >= 500 => "HTTP 5xx".to_string(),
        Some(code) => format!("HTTP {code}"),
        None if text.contains("timed out") || text.contains("timeout") => "timeout".to_string(),
        None if text.contains("rate limit") => "rate limited".to_string(),
        None if text.contains("unavailable") => "unavailable".to_string(),
        None => "tool error".to_string(),
    }
}

async fn record(owner: &TurnOwner, calls: Vec<ToolsetCall>) {
    let now = config::utils::time::now_micros();
    for call in calls {
        if get_o2_config().common.audit_enabled {
            audit::audit(audit_message(owner, &call, now)).await;
        }
        let outcome = CallOutcome {
            org: &owner.org_id,
            toolset: &call.toolset,
            at: call.at.unwrap_or(now),
            error: call.error.as_deref(),
        };
        let exists =
            |names: &[String]| names.iter().any(|n| normalize_tool_name(n) == call.toolset);
        if let Err(e) = ai_toolset_health::record(outcome, exists).await {
            log::warn!(
                "[AI] org={} toolset={}: recording health failed: {e}",
                owner.org_id,
                call.toolset
            );
        }
    }
}

fn audit_message(owner: &TurnOwner, call: &ToolsetCall, now: i64) -> AuditMessage {
    let body = serde_json::json!({
        "chat": owner.session_id,
        "turn": owner.turn_id,
        "toolset": call.toolset,
        "tool": call.tool,
        "call_id": call.call_id,
        "call_ref": call.call_ref,
        "result_bytes": call.result_bytes,
        "duration_ms": call.duration_ms,
    });
    AuditMessage {
        login_ip: None,
        user_agent: None,
        user_email: owner.user_id.clone(),
        org_id: owner.org_id.clone(),
        _timestamp: call.at.unwrap_or(now),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: format!("/api/{}/ai/toolsets/{}/call", owner.org_id, call.toolset),
            http_query_params: String::new(),
            http_body: body.to_string(),
            http_response_code: if call.error.is_some() { 502 } else { 200 },
            error_msg: call.error.clone(),
            trace_id: None,
        },
        delegated: None,
        fleet_id: None,
        target: None,
    }
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;

    use super::*;
    use crate::ai_chat::rca_thread::tests::{Session, T};

    fn owner(user: &str) -> TurnOwner {
        TurnOwner {
            org_id: "org".to_string(),
            user_id: user.to_string(),
            session_id: "chat-1".to_string(),
            turn_id: "turn-1".to_string(),
        }
    }

    fn session() -> Session {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        let parts = [
            (
                "toolset_list",
                "completed",
                json!({}),
                json!({"output": "[]"}),
            ),
            (
                "toolset_list_tools",
                "completed",
                json!({"toolset_name": "dd"}),
                json!({"output": "[]"}),
            ),
            (
                "toolset_read_output",
                "completed",
                json!({"ref": "r"}),
                json!({"output": "x"}),
            ),
            (
                "toolset_tool_call",
                "running",
                json!({"toolset_name": "dd", "tool_name": "search_logs", "args": {"q": 1}}),
                json!({}),
            ),
            (
                "toolset_tool_call",
                "completed",
                json!({"toolset_name": "dd", "tool_name": "search_logs", "args": {"q": "service:checkout"}}),
                json!({"output": "[saved to a file]", "metadata": {"result_bytes": 120000}}),
            ),
            (
                "toolset_cli_run",
                "completed",
                json!({"toolset_name": "k8s", "command": "get pods"}),
                json!({"output": "denied", "metadata": {"exit": 1, "result_bytes": 6}}),
            ),
            (
                "toolset_tool_call",
                "error",
                json!({"toolset_name": "dd", "tool_name": "get_monitor", "args": {"id": "secret-id"}}),
                json!({"error": "401 Unauthorized"}),
            ),
        ];
        for (i, (tool, status, input, result)) in parts.into_iter().enumerate() {
            s.tool(
                "msg_a1",
                &format!("prt_{i}"),
                tool,
                status,
                input,
                result,
                100,
                350,
            );
        }
        s
    }

    #[test]
    fn only_finished_gateway_calls_are_recorded_with_their_metadata() {
        let calls = toolset_calls(&session().events);
        let summary: Vec<(&str, &str, Option<&str>, usize)> = calls
            .iter()
            .map(|c| {
                (
                    c.toolset.as_str(),
                    c.tool.as_str(),
                    c.error.as_deref(),
                    c.result_bytes,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("dd", "search_logs", None, 120000),
                ("k8s", "run", Some("exit 1"), 6),
                ("dd", "get_monitor", Some("HTTP 401"), 0),
            ]
        );
        assert_eq!(calls[0].call_id, "call_prt_4");
        assert_eq!(calls[0].duration_ms, Some(250));
        for call in &calls {
            assert_eq!(
                call.call_ref.as_deref(),
                Some(call_ref(&call.call_id).as_str())
            );
        }
    }

    #[test]
    fn only_a_fixed_error_kind_is_kept_from_a_failed_call() {
        let kind = |error: &str| error_kind(None, Some(&json!(error)));
        assert_eq!(
            kind("upstream answered HTTP 401 for query=secret-q"),
            "HTTP 401"
        );
        assert_eq!(kind("HTTP 503 Service Unavailable"), "HTTP 5xx");
        assert_eq!(kind("429 Too Many Requests"), "rate limited");
        assert_eq!(
            kind("rate limit for dd reached; retry after 3 s"),
            "rate limited"
        );
        assert_eq!(kind("dd: request timed out"), "timeout");
        assert_eq!(kind("dd unavailable: 5xx"), "unavailable");
        assert_eq!(
            kind("datadog-prod unavailable for this turn"),
            "unavailable"
        );
        assert_eq!(
            kind("'secret-arg-value' is not valid under any of the given schemas"),
            "tool error"
        );
        assert_eq!(
            error_kind(Some(json!({"http_status": 403}).as_object().unwrap()), None),
            "HTTP 403"
        );

        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        s.tool(
            "msg_a1",
            "prt_x",
            "toolset_tool_call",
            "error",
            json!({"toolset_name": "dd", "tool_name": "q", "args": {"query": "secret-arg-value"}}),
            json!({"error": "argument 'secret-arg-value' failed: HTTP 401"}),
            100,
            200,
        );
        let calls = toolset_calls(&s.events);
        assert_eq!(calls[0].error.as_deref(), Some("HTTP 401"));
        let entry = serde_json::to_string(&audit_message(&owner("u"), &calls[0], 1)).unwrap();
        assert!(!entry.contains("secret-arg-value"), "{entry}");
    }

    #[test]
    fn an_audit_entry_never_carries_arguments() {
        let calls = toolset_calls(&session().events);
        let rca = owner("sysrcaagent@org.example");
        let entry = audit_message(&rca, &calls[0], 1);
        assert_eq!(entry.user_email, "sysrcaagent@org.example");
        assert_eq!(
            entry.response_meta.http_path,
            "/api/org/ai/toolsets/dd/call"
        );
        assert_eq!(entry.response_meta.http_response_code, 200);
        let body: Value = serde_json::from_str(&entry.response_meta.http_body).unwrap();
        assert_eq!(body["chat"], "chat-1");
        assert_eq!(body["turn"], "turn-1");
        assert_eq!(body["tool"], "search_logs");
        assert_eq!(body["result_bytes"], 120000);
        assert!(body.get("arguments").is_none(), "{body}");

        for call in &calls {
            let text = serde_json::to_string(&audit_message(&rca, call, 1)).unwrap();
            for argument in ["service:checkout", "get pods", "secret-id"] {
                assert!(!text.contains(argument), "{text}");
            }
        }
        let failed = audit_message(&owner("alice@example.com"), &calls[2], 1);
        assert_eq!(failed.response_meta.http_response_code, 502);
        assert_eq!(failed.response_meta.error_msg.as_deref(), Some("HTTP 401"));
        assert!(
            failed
                .response_meta
                .http_body
                .contains(&call_ref("call_prt_6"))
        );
    }
}
