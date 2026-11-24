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

//! One audit entry and one health update per finished toolset call, as its part is stored.

use std::sync::Arc;

use config::{
    meta::oncall::confidence::{ToolsetNames, call_ref, strip_call_ref},
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

use super::rca_thread::{ToolPart, updated_part};

/// What opencode writes on a call that was running when its turn was stopped.
const ABORTED_TEXT: &str = "Tool execution aborted";
/// o2-ai's `toolset_policy.refusal`, whole: each names the toolset, which no vendor is told.
const REFUSALS: [&str; 4] = [
    "{tool} in {toolset} isn't allowed",
    "{tool} in {toolset} may change things and isn't available on this turn",
    "{tool} in {toolset} can't be called: its full name is over 64 characters",
    "{toolset} isn't connected for this turn",
];

/// A finished toolset call, as audit and health record it.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolsetCall {
    pub toolset: String,
    /// The vendor tool, as the agent names it.
    pub tool: String,
    pub call_id: String,
    pub call_ref: Option<String>,
    /// Size of the stored result; a spilled one's is its pointer's.
    pub result_bytes: usize,
    pub duration_ms: Option<i64>,
    /// Microseconds; the part's end, else its start.
    pub at: Option<i64>,
    /// Set when the part's state is `error`.
    pub failure: Option<Failure>,
}

/// Why a call's part ended in `error`; fixed kinds, as its text can echo arguments.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// The call failed at, or on the way to, the vendor.
    Tool,
    /// Our own policy check refused it, so nothing reached the vendor.
    Refused,
    /// The turn was stopped while it ran.
    Aborted,
}

impl Failure {
    fn of(state: Option<&Map<String, Value>>, toolset: &str, tool: &str) -> Self {
        let Some(state) = state else {
            return Self::Tool;
        };
        let error = state
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default();
        // Only opencode sets `interrupted`; a vendor can only choose the text.
        let interrupted = state
            .get("metadata")
            .and_then(|m| m.get("interrupted"))
            .and_then(Value::as_bool);
        if interrupted == Some(true) && error == ABORTED_TEXT {
            Self::Aborted
        } else if is_policy_refusal(error, toolset, tool) {
            Self::Refused
        } else {
            Self::Tool
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Tool => "tool error",
            Self::Refused => "refused by the toolset's policy",
            Self::Aborted => "aborted",
        }
    }

    fn status(self) -> u16 {
        match self {
            Self::Tool => 502,
            Self::Refused => 403,
            Self::Aborted => 499,
        }
    }
}

/// Who ran the turn whose parts are stored.
#[derive(Debug, Clone)]
struct TurnOwner {
    org_id: String,
    user_id: String,
    session_id: String,
    turn_id: String,
}

/// `on_commit` that also records the batch's calls of `toolsets`, the turn's own: one deleted while
/// the turn runs is still recorded.
pub fn with_toolset_calls(
    identity: &TurnIdentity,
    toolsets: ToolsetNames,
    inner: Option<OnCommit>,
) -> OnCommit {
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
        let calls = toolset_calls(events, &toolsets);
        if calls.is_empty() {
            return;
        }
        let owner = owner.clone();
        tokio::spawn(async move { record(&owner, calls).await });
    })
}

/// The finished calls of `toolsets` among committed events, in event order.
pub fn toolset_calls(events: &[DurableEvent], toolsets: &ToolsetNames) -> Vec<ToolsetCall> {
    events
        .iter()
        .filter_map(|event| call_of(updated_part(event)?, toolsets))
        .collect()
}

fn call_of(part: &Map<String, Value>, toolsets: &ToolsetNames) -> Option<ToolsetCall> {
    let call = ToolPart::of(part)?;
    let failed = match call.status {
        "completed" => false,
        "error" => true,
        _ => return None,
    };
    let (toolset, tool) = call.vendor(toolsets)?;
    let (start, end) = (call.started_at(), call.ended_at());
    let call_id = call.call_id();
    let result_bytes = call
        .state
        .and_then(|s| s.get("output")?.as_str())
        .map_or(0, |output| strip_call_ref(output).len());
    Some(ToolsetCall {
        toolset: toolset.to_string(),
        tool: tool.to_string(),
        call_ref: (!call_id.is_empty()).then(|| call_ref(&call_id)),
        call_id,
        result_bytes,
        duration_ms: start.zip(end).map(|(s, e)| (e - s) / 1000),
        at: end.or(start),
        failure: failed.then(|| Failure::of(call.state, toolset, tool)),
    })
}

fn is_policy_refusal(error: &str, toolset: &str, tool: &str) -> bool {
    let error = error.strip_prefix("Error: ").unwrap_or(error);
    REFUSALS.iter().any(|form| {
        // The toolset goes in last: its name holds no braces, a tool's neither.
        error == form.replace("{tool}", tool).replace("{toolset}", toolset)
    })
}

async fn record(owner: &TurnOwner, calls: Vec<ToolsetCall>) {
    let now = config::utils::time::now_micros();
    for call in calls {
        if get_o2_config().common.audit_enabled {
            audit::audit(audit_message(owner, &call, now)).await;
        }
        // Neither says anything about the vendor.
        if matches!(call.failure, Some(Failure::Refused | Failure::Aborted)) {
            continue;
        }
        let outcome = CallOutcome {
            org: &owner.org_id,
            toolset: &call.toolset,
            at: call.at.unwrap_or(now),
            error: call.failure.map(Failure::as_str),
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
            http_response_code: call.failure.map_or(200, Failure::status),
            error_msg: call.failure.map(|f| f.as_str().to_string()),
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
                "toolset_read_output",
                "completed",
                json!({"ref": "r"}),
                json!({"output": "x"}),
            ),
            ("dd_search_logs", "running", json!({"q": 1}), json!({})),
            (
                "dd_search_logs",
                "completed",
                json!({"q": "service:checkout"}),
                json!({"output": "{\"hits\":3}"}),
            ),
            (
                "dd-prod_logs_search",
                "completed",
                json!({"q": "get pods"}),
                json!({"output": "{\"error\":\"denied\"}"}),
            ),
            (
                "dd_get_monitor",
                "error",
                json!({"id": "secret-id"}),
                json!({"error": "HTTP 401 for id=secret-id"}),
            ),
            (
                "gone_search_logs",
                "completed",
                json!({"q": 1}),
                json!({"output": "x"}),
            ),
            (
                "record_step",
                "completed",
                json!({"stage": "metrics"}),
                json!({"output": "x"}),
            ),
            (
                "o2_dd_search",
                "completed",
                json!({"q": 1}),
                json!({"output": "x"}),
            ),
            (
                "invalid",
                "completed",
                json!({"tool": "dd_search_logs"}),
                json!({"output": "x"}),
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

    fn toolsets() -> ToolsetNames {
        ["dd", "dd-prod", "record"]
            .map(String::from)
            .into_iter()
            .collect()
    }

    #[test]
    fn only_finished_calls_of_the_turn_s_toolsets_are_recorded_from_their_part() {
        let calls = toolset_calls(&session().events, &toolsets());
        let summary: Vec<(&str, &str, Option<Failure>, usize)> = calls
            .iter()
            .map(|c| {
                (
                    c.toolset.as_str(),
                    c.tool.as_str(),
                    c.failure,
                    c.result_bytes,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("dd", "search_logs", None, 10),
                ("dd-prod", "logs_search", None, 18),
                ("dd", "get_monitor", Some(Failure::Tool), 0),
            ],
            "the outcome is the part's state, never its text"
        );
        assert!(toolset_calls(&session().events, &ToolsetNames::default()).is_empty());
        assert_eq!(calls[0].call_id, "call_prt_2");
        assert_eq!(calls[0].duration_ms, Some(250));
        for call in &calls {
            assert_eq!(
                call.call_ref.as_deref(),
                Some(call_ref(&call.call_id).as_str())
            );
        }
    }

    #[test]
    fn only_our_own_refusal_or_abort_is_not_the_vendor_s_failure() {
        let failure = |error: &str, metadata: Value| {
            let state = json!({"status": "error", "error": error, "metadata": metadata});
            Failure::of(state.as_object(), "dd-prod", "logs_delete")
        };
        for refusal in [
            "logs_delete in dd-prod isn't allowed",
            "Error: logs_delete in dd-prod isn't allowed",
            "logs_delete in dd-prod may change things and isn't available on this turn",
            "logs_delete in dd-prod can't be called: its full name is over 64 characters",
            "dd-prod isn't connected for this turn",
        ] {
            assert_eq!(failure(refusal, json!({})), Failure::Refused, "{refusal}");
        }
        for vendor in [
            "logs_delete isn't allowed",
            "logs_delete in dd isn't allowed",
            "other in dd-prod isn't allowed",
            "logs_delete in dd-prod isn't allowed (HTTP 403)",
            "upstream: logs_delete in dd-prod isn't allowed",
            "the toolset policy check did not answer, so this call was not made",
            "Tool execution aborted",
            "MCP error -32000: Connection closed",
            "",
        ] {
            assert_eq!(failure(vendor, json!({})), Failure::Tool, "{vendor}");
        }
        let interrupted = json!({"interrupted": true});
        assert_eq!(
            failure("Tool execution aborted", interrupted.clone()),
            Failure::Aborted
        );
        assert_eq!(failure("HTTP 500", interrupted), Failure::Tool);
        assert_eq!(Failure::of(None, "dd", "x"), Failure::Tool);
        assert_eq!(
            (Failure::Refused.status(), Failure::Aborted.status()),
            (403, 499)
        );
    }

    #[test]
    fn an_audit_entry_never_carries_arguments() {
        let calls = toolset_calls(&session().events, &toolsets());
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
        assert_eq!(body["result_bytes"], 10);
        assert!(body.get("arguments").is_none(), "{body}");

        for call in &calls {
            let text = serde_json::to_string(&audit_message(&rca, call, 1)).unwrap();
            for argument in ["service:checkout", "get pods", "secret-id"] {
                assert!(!text.contains(argument), "{text}");
            }
        }
        let failed = audit_message(&owner("alice@example.com"), &calls[2], 1);
        assert_eq!(failed.response_meta.http_response_code, 502);
        assert_eq!(
            failed.response_meta.error_msg.as_deref(),
            Some("tool error")
        );
        assert!(
            failed
                .response_meta
                .http_body
                .contains(&call_ref("call_prt_4"))
        );
    }
}
