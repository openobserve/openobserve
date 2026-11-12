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

//! Port of o2-ai's `project_events`; model names are not redacted (unknown here).

use std::collections::{HashMap, HashSet};

use config::{
    meta::oncall::confidence::strip_call_ref,
    utils::{
        json::{Map, Value, json},
        redact::redact_internal_details,
    },
};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
use regex::{NoExpand, Regex};

use super::record_v2::{
    LegacyMessage, MESSAGE_UPDATED, SESSION_CREATED, SESSION_UPDATED, is_v2_record, record_message,
    tool_output_text, user_text,
};

const PLACEHOLDER_TITLE_PREFIXES: [&str; 2] = ["New session - ", "Child session - "];
const INJECTED_KEY: &str = "o2_injected";
// o2-ai's metadata on the user's own part: the asked window (ms) and the entry the turn came from.
const ASKED_WINDOW_KEY: &str = "o2_window";
const ASKED_ENTRY_KEY: &str = "o2_entry_kind";
const ABORTED_ERROR: &str = "MessageAbortedError";
const DEFAULT_TURN_ERROR: &str = "The assistant failed to respond";
/// The 2.x tool error type of a permission o2-ai denied.
const PERMISSION_REJECTED: &str = "permission.rejected";

const FLUSH_CHARS: usize = 80;
const FLUSH_BREAKS: [char; 4] = ['.', '!', '?', '\n'];
const STREAM_HOLDBACK_WORDS: usize = 3;
const STREAM_CARRY_MAX: usize = 4096;
const STREAM_HOLDBACK: usize = 48;
// Blocks o2-ai's live stream holds out of the answer; only at the start of a line.
const FINDINGS_FENCE: &str = "```findings";
const HANDOFF_FENCE: &str = "```handoff";
const FOLLOW_UPS_FENCE: &str = "```follow_ups";
const FENCE_CLOSE: &str = "\n```";
const CODE_FENCE: &str = "```";
const FINDINGS_FRAME: &str = "findings";
const FOLLOW_UPS_MAX: usize = 3;
const FOLLOW_UP_CHARS_MAX: usize = 200;
const FINDINGS_SCHEMA_JSON: &str = include_str!("findings.schema.json");
const QUERY_AGENT: &str = "generate-query";
// A model's `[^N]` step reference is its position among the turn's calls.
const CALL_POSITION_MAX_DIGITS: usize = 3;

pub(crate) const SESSION_ARG: &str = "_o2_session";
const NAVIGATION_TOOL: &str = "create_navigation";
const FIRST_PARTY_MCP_PREFIX: &str = "o2_";
const O2_DELETE_TOOL: &str = "o2_delete";
const MCP_SERVER_PREFIXES: [&str; 1] = ["o2"];
const SEARCH_SQL_MAX_HITS: usize = 10;
const TEST_FUNCTION_MAX_INPUT_EVENTS: usize = 5;
const TEST_FUNCTION_MAX_OUTPUT_RESULTS: usize = 5;
const ERROR_DUMP_CHARS: usize = 500;
const FIRST_ERR_CHARS: usize = 200;
const SCRUB_TERMS_JSON: &str = include_str!("scrub_terms.json");
// Ids and enums, never prose a model name could be in (as `SCRUB_SKIP_KEYS` in the web client).
const SCRUB_SKIP_KEYS: [&str; 11] = [
    "type",
    "id",
    "call_id",
    "turn_id",
    "tool",
    "kind",
    "code",
    "error_code",
    "trace_id",
    "by",
    "url",
];
const MODEL_KEYS: [&str; 2] = ["model", "model_provider"];
// serde_json refuses deeper documents, so every stored value is scrubbed whole.
const SCRUB_MAX_DEPTH: usize = 128;
// What a redacted approval keeps: no resource names, ids, operation or message.
const REDACTED_APPROVAL_KEYS: [&str; 3] = ["type", "id", "kind"];
// A redacted link says what kind of view it opens, never its query, stream or time window.
const REDACTED_NAVIGATION_KEYS: [&str; 3] = ["type", "resource_type", "action"];
const REDACTED_NAVIGATION_LABEL: &str = "Open the linked view";
// A redacted step names its tool, never the params or label that carry its query and stream.
const REDACTED_STEP_KEYS: [&str; 6] = ["type", "id", "call_id", "kind", "state", "tool"];
// Their whole payload is the query text, stream and conclusions drawn from the data.
const REDACTED_DROPPED_FRAMES: [&str; 2] = ["query", "findings"];
const VIEWER_DECISION_KEYS: [&str; 4] = ["type", "id", "approved", "at"];
const TERMINAL_FRAMES: [&str; 3] = ["complete", "cancelled", "error"];
const QUERY_FRAME: &str = "query";
// The fenced languages o2-ai's `query_frame` accepts, and the frame's name for each.
const QUERY_LANGUAGES: [(&str, &str); 4] = [
    ("sql", "sql"),
    ("promql", "promql"),
    ("vrl", "vrl"),
    ("traces", "traces"),
];
// The arguments a query step names its text under.
const QUERY_STEP_KEYS: [&str; 3] = ["sql", "query", "promql"];
const CONFIRMATION_REQUIRED: &str = "confirmation_required";
const CONFIRMATION_RESOLVED: &str = "confirmation_resolved";
const NAVIGATION_ACTION: &str = "navigation_action";
const STREAM_NAME_KEYS: [&str; 3] = ["stream_name", "stream", "streamName"];
const CHECKABLE_STREAM_TYPES: [&str; 3] = ["logs", "metrics", "traces"];
const DEFAULT_STREAM_TYPE: &str = "logs";
// Steps that read no stream data; every other step is checked against the streams it names.
const STREAMLESS_TOOLS: [&str; 18] = [
    "StreamList",
    "ListAlerts",
    "ListDashboards",
    "listFunctions",
    "listPipelines",
    "ListPipelines",
    "ListDestinations",
    "ListTemplates",
    "ListFolders",
    "ListReports",
    "ListIncidents",
    "ListSavedViews",
    "UserList",
    "ServiceAccountsList",
    "ListRoles",
    "ListGroups",
    "testFunction",
    "create_navigation",
];
const TRUNCATED_SUFFIX: &str = " (truncated)";
// `error_type` of a call that never ran: queued behind a card, or refused by the org's policy.
const APPROVAL_PENDING: &str = "approval_pending";
const POLICY_REFUSED: &str = "policy_refused";
const REFUSED_PREFIX: &str = "Refused by this organization's assistant policy";
// For the model only; a person reading the refusal gets the text without it.
const REFUSED_ADVICE: &str = " Tell the user; do not retry.";

/// Tools no projection shows; the sentinels at the end are RCA thread structure.
pub(crate) const HIDDEN_TOOLS: [&str; 26] = [
    "tool_search",
    "convert_time_to_microseconds",
    "calculate_time_range",
    "format_timestamp_for_display",
    "create_navigation",
    "bash",
    "read",
    "write",
    "edit",
    "patch",
    "glob",
    "grep",
    "list",
    "task",
    "webfetch",
    "websearch",
    "todowrite",
    "todoread",
    "skill",
    "ask_user",
    "record_step",
    "submit_report",
    "record_hypothesis",
    "record_blind_spot",
    "ask_responders",
    "acknowledge_steering",
];

const TOOL_DESCRIPTIONS: [(&str, &str); 37] = [
    ("GetIncident", "Retrieving incident details"),
    ("GetAlert", "Fetching alert details"),
    ("ListAlerts", "Listing alerts"),
    ("GetAlertHistory", "Retrieving alert history"),
    ("CreateAnnotations", "Creating timeline annotations"),
    ("UpdateIncident", "Updating incident status"),
    (
        "GetCurrentServiceGraphTopology",
        "Mapping service dependencies",
    ),
    ("GetLatestTraces", "Analyzing distributed traces"),
    ("ExtractPatterns", "Extracting log patterns"),
    ("SearchSQL", "Querying logs"),
    ("SearchValues", "Finding distinct values"),
    ("SearchAround", "Searching logs around timestamp"),
    ("PrometheusRangeQuery", "Analyzing metrics"),
    ("PrometheusQuery", "Querying metrics"),
    ("PrometheusSeries", "Finding metric series"),
    ("correlate_streams", "Correlating telemetry data"),
    ("StreamList", "Listing streams"),
    ("StreamSchema", "Fetching stream schema"),
    ("SearchLogs", "Searching log data"),
    ("SearchTraces", "Searching trace data"),
    ("QueryMetrics", "Querying metrics data"),
    ("ListDashboards", "Listing dashboards"),
    ("GetDashboard", "Fetching dashboard details"),
    ("listFunctions", "Listing functions"),
    ("listPipelines", "Listing pipelines"),
    ("ListPipelines", "Listing pipelines"),
    ("ListDestinations", "Listing alert destinations"),
    ("ListTemplates", "Listing alert templates"),
    ("ListFolders", "Listing folders"),
    ("ListReports", "Listing reports"),
    ("ListIncidents", "Listing incidents"),
    ("ListSavedViews", "Listing saved views"),
    ("UserList", "Listing users"),
    ("ServiceAccountsList", "Listing service accounts"),
    ("ListRoles", "Listing roles"),
    ("ListGroups", "Listing groups"),
    ("testFunction", "Validating VRL"),
];

/// opencode 2.x names of built-in tools; o2-ai hides them in chat history only, not in RCA threads.
const HIDDEN_V2_TOOLS: [&str; 4] = ["shell", "subagent", "question", "apply_patch"];

const PERMISSION_REJECTION_MARKERS: [&str; 5] = [
    "rejected permission",
    "permission to use this",
    "permission denied",
    "rejected the permission",
    "not allowed to access",
];

static MODEL_NAME: LazyLock<(Regex, String)> = LazyLock::new(|| {
    let terms: Value = config::utils::json::from_str(SCRUB_TERMS_JSON).expect("valid scrub terms");
    let patterns: Vec<&str> = terms["patterns"]
        .as_array()
        .expect("scrub term patterns")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let pattern = format!(r"(?i)\b(?:{})\b", patterns.join("|"));
    let replacement = terms["replacement"]
        .as_str()
        .unwrap_or("the model")
        .to_string();
    (
        Regex::new(&pattern).expect("valid model pattern"),
        replacement,
    )
});

static FINDINGS_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    config::utils::json::from_str(FINDINGS_SCHEMA_JSON).expect("valid findings schema")
});

static QUERY_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)```([A-Za-z]+)[^\n]*\n(.*?)```").expect("valid query block"));
static NONCED_OPENER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^--- (.+?) \[([a-z2-7]{8})\] ---$").expect("valid opener"));
static NONCED_CLOSER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^--- end \[([a-z2-7]{8})\] ---$").expect("valid closer"));
static LEGACY_OPENER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^--- (.+?) (?:\(lines \d+-\d+\) )?---$").expect("valid legacy opener")
});
// o2-ai's `APPROVAL_MARKER`: the queued result names its card, so a reload can find its outcome.
static APPROVAL_MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)^This change needs the user's approval\. .* \[approval (apr_[0-9a-f]{20})\]$")
        .expect("valid approval marker")
});
// o2-ai's `CLAIM_MARKER`: a call position or a call id the model cites a step by.
static CLAIM_MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\^(\d{1,3}|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]{1,60})\]")
        .expect("valid claim marker")
});
static LEGACY_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^--- (.+?) (?:\(lines \d+-\d+\) )?---\n[\s\S]*?\n--- end ---$")
        .expect("valid legacy block")
});

/// A tool call as the live mapper remembers it until its result arrives.
#[derive(Clone)]
struct CallInfo {
    tool: String,
    args: Map<String, Value>,
}

/// The per-turn state of o2-ai's live mapper (`StreamState`) that history uses.
#[derive(Default)]
struct StreamState {
    text_buffer: String,
    scrub_carry: String,
    pending_tool_calls: HashMap<String, CallInfo>,
    last_tools_call_info: Option<CallInfo>,
    /// 2.x only: chars emitted per `<message id>:<text ordinal>`.
    text_streamed: HashMap<String, usize>,
    /// 2.x only: the tool name of each call id.
    tool_names: HashMap<String, String>,
    tools_called: HashSet<String>,
    tools_done: HashSet<String>,
}

impl StreamState {
    /// What a text part shows: the held-out blocks stay out, as on the live stream.
    fn shape_text(&mut self, text: &str) -> String {
        let mut shown = String::new();
        let mut rest = text;
        while let Some((start, fence)) = self.next_fence(rest) {
            shown.push_str(&rest[..start]);
            let body = &rest[start + fence.len()..];
            let (block, after, closed) = match body.find(FENCE_CLOSE) {
                Some(end) => (&body[..end], &body[end + FENCE_CLOSE.len()..], true),
                None => (body, "", false),
            };
            rest = after;
            if fence == FINDINGS_FENCE {
                shown.push_str(&self.settle_findings(block, closed));
            } else if fence == FOLLOW_UPS_FENCE {
                self.follow_ups = follow_ups_of(block);
            }
        }
        shown.push_str(rest);
        if let Some(last) = shown.chars().next_back() {
            self.shown_tail = Some(last);
        }
        self.rewrite_claim_markers(&shown)
    }

    /// Markers naming a visible step keep its call id, others are dropped, as o2-ai streams them.
    fn rewrite_claim_markers(&mut self, text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = String::with_capacity(text.len());
        let (mut from, mut i) = (0, 0);
        while i < bytes.len() {
            let byte = bytes[i];
            if byte == b'`' || byte == b'~' {
                let run = bytes[i..].iter().take_while(|&&b| b == byte).count();
                let next = self.code.after_run(byte, run, self.mid_line);
                if next != self.code {
                    self.push_segment(&mut out, &text[from..i]);
                    out.push_str(&text[i..i + run]);
                    from = i + run;
                    self.code = next;
                }
                self.mid_line = true;
                i += run;
                continue;
            }
            if byte == b'\n' {
                // A span may wrap a line, not a paragraph: a stray backtick cannot hide the rest.
                if matches!(self.code, CodeSpan::Inline(_)) && !self.mid_line {
                    self.push_segment(&mut out, &text[from..i]);
                    from = i;
                    self.code = CodeSpan::Prose;
                }
                self.mid_line = false;
            } else if byte != b' ' && byte != b'\t' {
                self.mid_line = true;
            }
            i += 1;
        }
        self.push_segment(&mut out, &text[from..]);
        out
    }

    fn push_segment(&self, out: &mut String, segment: &str) {
        if self.code != CodeSpan::Prose {
            out.push_str(segment);
            return;
        }
        let rewritten = CLAIM_MARKER.replace_all(segment, |m: &regex::Captures<'_>| {
            self.step_call_id(&m[1])
                .map(|call_id| format!("[^{call_id}]"))
                .unwrap_or_default()
        });
        out.push_str(&rewritten);
    }

    fn next_fence(&self, text: &str) -> Option<(usize, &'static str)> {
        [FINDINGS_FENCE, HANDOFF_FENCE, FOLLOW_UPS_FENCE]
            .into_iter()
            .filter_map(|fence| Some((fence_start(text, self.shown_tail, fence)?, fence)))
            .min_by_key(|(start, _)| *start)
    }

    /// Holds a valid block for the turn's `findings` frame; any other block stays as ordinary text.
    fn settle_findings(&mut self, block: &str, closed: bool) -> String {
        if findings_body(block).is_some() {
            self.findings_raw = Some(block.to_string());
            return String::new();
        }
        self.findings_raw = None;
        let close = if closed { FENCE_CLOSE } else { "" };
        format!("{FINDINGS_FENCE}{block}{close}")
    }

    /// The frame the live turn ended with: evidence naming no visible step is only inferred.
    fn findings_frame(&self) -> Option<Value> {
        let mut frame = findings_body(self.findings_raw.as_deref()?)?;
        let evidence = frame.get_mut("evidence")?.as_array_mut()?;
        for item in evidence.iter_mut().filter_map(Value::as_object_mut) {
            let Some(reference) = item.get("call_id").and_then(Value::as_str) else {
                continue;
            };
            match self.step_call_id(reference) {
                Some(call_id) => {
                    item.insert("call_id".into(), Value::String(call_id));
                }
                None => {
                    item.shift_remove("call_id");
                    item.insert("kind".into(), Value::String("inferred".into()));
                }
            }
        }
        Some(Value::Object(frame))
    }

    /// The visible step a reference names: its call id, or its 1-based position in the turn.
    fn step_call_id(&self, reference: &str) -> Option<String> {
        if self.step_call_ids.contains(reference) {
            return Some(reference.to_string());
        }
        if reference.len() > CALL_POSITION_MAX_DIGITS
            || !reference.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let position = reference.parse::<usize>().ok()?.checked_sub(1)?;
        self.turn_call_ids
            .get(position)
            .filter(|call_id| self.step_call_ids.contains(*call_id))
            .cloned()
    }

    fn emit_text_delta(&mut self, delta: &str, frames: &mut Vec<Value>) {
        if delta.is_empty() {
            return;
        }
        let buf = std::mem::take(&mut self.text_buffer) + delta;
        let flush = buf.chars().count() >= FLUSH_CHARS
            || buf
                .chars()
                .next_back()
                .is_some_and(|c| FLUSH_BREAKS.contains(&c));
        if flush {
            self.emit_scrubbed(&buf, false, frames);
        } else {
            self.text_buffer = buf;
        }
    }

    fn flush_text_buffer(&mut self, frames: &mut Vec<Value>) {
        let buf = std::mem::take(&mut self.text_buffer);
        self.emit_scrubbed(&buf, true, frames);
    }

    fn emit_scrubbed(&mut self, buf: &str, final_: bool, frames: &mut Vec<Value>) {
        let combined = std::mem::take(&mut self.scrub_carry) + buf;
        let emit = if final_ {
            redact_internal_details(&combined)
        } else {
            let chars: Vec<char> = combined.chars().collect();
            let mut cut = stream_split(&chars);
            if chars.len() - cut > STREAM_CARRY_MAX {
                cut = cut.max(chars.len() - STREAM_HOLDBACK);
            }
            if cut == 0 {
                self.scrub_carry = combined;
                return;
            }
            self.scrub_carry = chars[cut..].iter().collect();
            redact_internal_details(&chars[..cut].iter().collect::<String>())
        };
        if !emit.is_empty() {
            frames.push(json!({"type": "message_delta", "content": emit}));
        }
    }

    fn handle_tool_part(&mut self, part: &Map<String, Value>, frames: &mut Vec<Value>) {
        let call_id = [part.get("callID"), part.get("id")]
            .into_iter()
            .flatten()
            .find(|v| truthy(v))
            .map(py_str)
            .unwrap_or_default();
        let tool_name = part
            .get("tool")
            .filter(|v| truthy(v))
            .map(py_str)
            .unwrap_or_else(|| "unknown".to_string());
        let empty = Map::new();
        let tool_state = obj(part.get("state")).unwrap_or(&empty);
        match tool_state.get("status").and_then(Value::as_str) {
            Some("running") => self.tool_running(&call_id, &tool_name, tool_state, frames),
            Some(status @ ("completed" | "error")) => {
                self.tool_finished(&call_id, &tool_name, tool_state, status == "error", frames)
            }
            _ => {}
        }
    }

    fn tool_running(
        &mut self,
        call_id: &str,
        tool_name: &str,
        tool_state: &Map<String, Value>,
        frames: &mut Vec<Value>,
    ) {
        let tool_input: Map<String, Value> = obj(tool_state.get("input"))
            .map(|input| {
                input
                    .iter()
                    .filter(|(k, _)| k.as_str() != SESSION_ARG)
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default();
        if !call_id.is_empty() && !self.turn_call_ids.iter().any(|id| id == call_id) {
            self.turn_call_ids.push(call_id.to_string());
        }
        let Some(mut event) = format_tool_call_event(tool_name, &tool_input) else {
            return;
        };
        let call_info = CallInfo {
            tool: event
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            args: tool_input,
        };
        self.last_tools_call_info = Some(call_info.clone());
        if !call_id.is_empty() {
            self.pending_tool_calls
                .insert(call_id.to_string(), call_info);
            self.step_call_ids.insert(call_id.to_string());
            event.insert("call_id".into(), Value::String(call_id.to_string()));
        }
        frames.push(Value::Object(event));
    }

    fn tool_finished(
        &mut self,
        call_id: &str,
        tool_name: &str,
        tool_state: &Map<String, Value>,
        is_error: bool,
        frames: &mut Vec<Value>,
    ) {
        if is_error {
            let err = tool_state
                .get("error")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let message = extract_error_message(&err);
            let error_type = match &err {
                Value::Object(m) => m.get("name").cloned().unwrap_or(Value::Null),
                _ => Value::String("ToolError".into()),
            };
            self.tool_failed(call_id, tool_name, message, error_type, false, frames);
        } else {
            let metadata = tool_state
                .get("metadata")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let result = coerce_tool_output(tool_state.get("output"), metadata);
            self.tool_completed(call_id, tool_name, result, frames);
        }
    }

    /// The call a result answers: its own, else the last call announced.
    fn take_call(&mut self, call_id: &str) -> Option<CallInfo> {
        if call_id.is_empty() {
            None
        } else {
            self.pending_tool_calls.remove(call_id)
        }
        .or_else(|| self.last_tools_call_info.clone())
    }

    fn tool_failed(
        &mut self,
        call_id: &str,
        tool_name: &str,
        message: String,
        error_type: Value,
        rejected: bool,
        frames: &mut Vec<Value>,
    ) {
        let matched = self.take_call(call_id);
        // o2-ai denies some permissions on purpose; their failures are not shown.
        if rejected || is_permission_rejection(&message) {
            self.last_tools_call_info = None;
            return;
        }
        let mut result = Map::new();
        result.insert("error".into(), Value::Bool(true));
        result.insert("error_type".into(), error_type);
        result.insert("message".into(), Value::String(message));
        self.push_result(call_id, tool_name, &result, true, matched.as_ref(), frames);
    }

    fn tool_completed(
        &mut self,
        call_id: &str,
        tool_name: &str,
        result: Map<String, Value>,
        frames: &mut Vec<Value>,
    ) {
        let matched = self.take_call(call_id);
        if is_delete_confirmation(&result, tool_name) {
            self.last_tools_call_info = None;
            return;
        }
        if let Some(navigation) = navigation_frame(&result, tool_name) {
            self.last_tools_call_info = None;
            frames.push(navigation);
            return;
        }
        self.push_result(call_id, tool_name, &result, false, matched.as_ref(), frames);
    }

    fn push_result(
        &mut self,
        call_id: &str,
        tool_name: &str,
        result: &Map<String, Value>,
        is_error: bool,
        matched: Option<&CallInfo>,
        frames: &mut Vec<Value>,
    ) {
        let Some(mut event) = format_tool_result_event(tool_name, result, is_error, matched) else {
            return;
        };
        if !call_id.is_empty() {
            event.insert("call_id".into(), Value::String(call_id.to_string()));
        }
        self.last_tools_call_info = None;
        frames.push(Value::Object(event));
    }

    /// o2-ai's `session.text.ended`: the part of a 2.x text item not streamed yet.
    fn text_ended(&mut self, key: String, text: &str, frames: &mut Vec<Value>) {
        let len = text.chars().count();
        let seen = self.text_streamed.get(&key).copied().unwrap_or(0);
        self.text_streamed.insert(key, seen.max(len));
        if len > seen {
            let rest: String = text.chars().skip(seen).collect();
            self.emit_text_delta(&rest, frames);
        }
    }

    /// o2-ai's tool events of one settled 2.x tool item, each emitted once per call id.
    fn v2_tool(&mut self, item: &Map<String, Value>, frames: &mut Vec<Value>) {
        let call_id = item
            .get("id")
            .filter(|v| truthy(v))
            .map(py_str)
            .unwrap_or_default();
        let name = item
            .get("name")
            .filter(|v| truthy(v))
            .map_or_else(|| "unknown".to_string(), py_str);
        self.tool_names.insert(call_id.clone(), name.clone());
        let empty = Map::new();
        let state = obj(item.get("state")).unwrap_or(&empty);
        let status = state.get("status").and_then(Value::as_str);
        if !matches!(status, Some("running" | "completed" | "error")) {
            return;
        }
        if call_id.is_empty() || self.tools_called.insert(call_id.clone()) {
            self.tool_running(&call_id, &name, state, frames);
        }
        if status == Some("running")
            || !(call_id.is_empty() || self.tools_done.insert(call_id.clone()))
        {
            return;
        }
        let name = self.tool_names.get(&call_id).cloned().unwrap_or(name);
        if status == Some("error") {
            let error = state
                .get("error")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let rejected = obj(Some(&error))
                .and_then(|e| e.get("type"))
                .is_some_and(|t| t == PERMISSION_REJECTED);
            let message = v2_error_message(&error);
            let error_type = Value::String("ToolError".into());
            self.tool_failed(&call_id, &name, message, error_type, rejected, frames);
        } else {
            let metadata = Value::Object(obj(state.get("metadata")).cloned().unwrap_or_default());
            let output = tool_output_text(state.get("content")).map(Value::String);
            let result = coerce_tool_output(output.as_ref(), metadata);
            self.tool_completed(&call_id, &name, result, frames);
        }
    }
}

/// The code an answer's scan is inside, by its opening run's character and length.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum CodeSpan {
    #[default]
    Prose,
    Inline(usize),
    Fence(u8, usize),
}

impl CodeSpan {
    /// The state after a run of `run` backticks or tildes, judged as o2-ai judges it.
    fn after_run(self, byte: u8, run: usize, mid_line: bool) -> Self {
        let fence_ok = byte == b'`' || !mid_line;
        match self {
            Self::Prose if run >= 3 && fence_ok => Self::Fence(byte, run),
            Self::Prose if byte == b'`' => Self::Inline(run),
            Self::Inline(n) if byte == b'`' && run == n => Self::Prose,
            Self::Fence(open, n) if byte == open && run >= n && fence_ok => Self::Prose,
            other => other,
        }
    }
}

/// One turn being projected: a user message and the assistant messages answering it.
#[derive(Default)]
struct Turn {
    user_message_id: Value,
    created: Value,
    user_parts: Vec<(String, bool)>,
    images: Vec<Value>,
    window: Option<Value>,
    entry_kind: Option<String>,
    frames: Vec<Value>,
    state: StreamState,
    error: Option<String>,
    aborted: bool,
    query_mode: bool,
    seqs: Option<(i64, i64)>,
}

impl Turn {
    /// Widen the turn's seq range by one of its messages' `(min, max)`.
    fn cover(&mut self, seqs: Option<&(i64, i64)>) {
        if let Some(&(low, high)) = seqs {
            self.seqs = Some(
                self.seqs
                    .map_or((low, high), |(l, h)| (l.min(low), h.max(high))),
            );
        }
    }

    fn collect_user_parts(&mut self, parts: &Map<String, Value>) {
        for part in parts.values().filter_map(Value::as_object) {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                    let injected = is_injected(part);
                    if !injected {
                        self.keep_asked(part);
                    }
                    self.user_parts.push((text.to_string(), injected));
                }
                Some("file")
                    if py_str(part.get("mime").unwrap_or(&Value::String(String::new())))
                        .starts_with("image/") =>
                {
                    let filename = part
                        .get("filename")
                        .filter(|v| truthy(v))
                        .cloned()
                        .unwrap_or_else(|| Value::String("image".into()));
                    self.images.push(json!({
                        "filename": filename,
                        "mime": part.get("mime").cloned().unwrap_or(Value::Null),
                        "url": part.get("url").cloned().unwrap_or(Value::Null),
                    }));
                }
                _ => {}
            }
        }
    }

    /// Run one assistant message's final parts through the live mapper.
    fn project_assistant_message(&mut self, info: &Map<String, Value>, parts: &Map<String, Value>) {
        self.query_mode |= info.get("agent").and_then(Value::as_str) == Some(QUERY_AGENT);
        for part in parts.values().filter_map(Value::as_object) {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                    let hidden = part.get("synthetic").is_some_and(truthy)
                        || part.get("ignored").is_some_and(truthy);
                    if !text.is_empty() && !hidden {
                        let shown = self.state.shape_text(text);
                        self.state.emit_text_delta(&shown, &mut self.frames);
                        // One text part is one block: never carry its tail into the next part.
                        self.state.flush_text_buffer(&mut self.frames);
                    }
                }
                Some("tool") => {
                    let status = obj(part.get("state"))
                        .and_then(|s| s.get("status"))
                        .and_then(Value::as_str);
                    if let (Some("completed" | "error"), Some(state)) =
                        (status, obj(part.get("state")))
                    {
                        // The live stream announced the call while it was running.
                        let mut running = part.clone();
                        let mut running_state = state.clone();
                        running_state.insert("status".into(), Value::String("running".into()));
                        running.insert("state".into(), Value::Object(running_state));
                        self.state.handle_tool_part(&running, &mut self.frames);
                    }
                    self.state.handle_tool_part(part, &mut self.frames);
                }
                _ => {}
            }
        }

        if let Some(error) = obj(info.get("error")) {
            if error.get("name").and_then(Value::as_str) == Some(ABORTED_ERROR) {
                self.aborted = true;
            } else {
                let message = obj(error.get("data"))
                    .and_then(|d| d.get("message"))
                    .filter(|v| truthy(v))
                    .or_else(|| error.get("name"))
                    .filter(|v| truthy(v));
                self.error = Some(message.map_or_else(
                    || DEFAULT_TURN_ERROR.to_string(),
                    |message| readable_error(&py_str(message)),
                ));
            }
        }
    }

    fn collect_v2_user(&mut self, message: &Map<String, Value>) {
        self.user_parts.push((user_text(message), false));
        let files = message.get("files").and_then(Value::as_array);
        for (index, file) in files.into_iter().flatten().enumerate() {
            let Some(file) = file.as_object() else {
                continue;
            };
            let mime = file
                .get("mime")
                .filter(|v| truthy(v))
                .map(py_str)
                .unwrap_or_default();
            let Some(data) = file.get("data").filter(|v| truthy(v)) else {
                continue;
            };
            if !mime.starts_with("image/") {
                continue;
            }
            let filename = file
                .get("name")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::String(format!("image-{}", index + 1)));
            let url = format!("data:{mime};base64,{}", py_str(data));
            self.images
                .push(json!({"filename": filename, "mime": mime, "url": url}));
        }
    }

    /// Run one settled 2.x message through the live mapper, as o2-ai's `messages_to_events`.
    fn project_v2_message(&mut self, message: &Map<String, Value>) {
        let msg_id = message
            .get("id")
            .filter(|v| truthy(v))
            .map(py_str)
            .unwrap_or_default();
        let kind = message.get("type").and_then(Value::as_str);
        if kind == Some("assistant") {
            let content = message.get("content").and_then(Value::as_array);
            let mut ordinal = 0;
            for item in content.into_iter().flatten().filter_map(Value::as_object) {
                match item.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let text = match item.get("text") {
                            Some(Value::String(text)) => Some(text.as_str()),
                            Some(other) if truthy(other) => None,
                            _ => Some(""),
                        };
                        if let Some(text) = text {
                            let key = format!("{msg_id}:{ordinal}");
                            self.state.text_ended(key, text, &mut self.frames);
                        }
                        // One text item is one block: never carry its tail into the next.
                        self.state.flush_text_buffer(&mut self.frames);
                        ordinal += 1;
                    }
                    Some("tool") => self.state.v2_tool(item, &mut self.frames),
                    _ => {}
                }
            }
        }
        let error = obj(message.get("error"));
        let said = |e: &Map<String, Value>| {
            e.get("message")
                .filter(|v| truthy(v))
                .or_else(|| e.get("type").filter(|v| truthy(v)))
                .map(py_str)
                .unwrap_or_default()
        };
        match (kind, message.get("outcome").and_then(Value::as_str), error) {
            (Some("idle"), Some("interrupted"), _) => self.aborted = true,
            (Some("idle"), Some("failed"), Some(error)) => self.error = Some(said(error)),
            (Some("assistant"), _, Some(error)) => {
                if error.get("type").and_then(Value::as_str) == Some("aborted") {
                    self.aborted = true;
                } else {
                    self.error = Some(said(error));
                }
            }
            _ => {}
        }
        if self.error.as_deref() == Some("") {
            self.error = Some(DEFAULT_TURN_ERROR.to_string());
        }
    }

    fn user_text(&self) -> String {
        let joined = self
            .user_parts
            .iter()
            .filter(|(text, injected)| !injected && !text.is_empty())
            .map(|(text, _)| text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        py_strip(&joined).to_string()
    }

    fn into_value(mut self) -> Value {
        if let Some(error) = &self.error {
            self.frames
                .push(json!({"type": "error", "error": error, "recoverable": false}));
        } else if !self.aborted && !self.query_mode {
            self.frames.extend(self.state.findings_frame());
            if !self.state.follow_ups.is_empty() {
                let items = std::mem::take(&mut self.state.follow_ups);
                self.frames
                    .push(json!({"type": "follow_ups", "items": items}));
            }
        }
        let terminal = if self.aborted {
            "cancelled"
        } else {
            "complete"
        };
        self.frames.push(json!({"type": terminal}));
        let text = self.user_text();
        let mut user = json!({"text": text, "images": self.images});
        if let Some(window) = self.window {
            user["window"] = window;
        }
        if let Some(entry_kind) = self.entry_kind {
            user["entry_kind"] = entry_kind.into();
        }
        json!({
            "user_message_id": self.user_message_id,
            "created": self.created,
            "user": user,
            "frames": self.frames,
            "error": self.error,
            "first_seq": self.seqs.map(|(low, _)| low),
            "last_seq": self.seqs.map(|(_, high)| high),
        })
    }
}

/// The event log folded to each message's latest info and each part's final snapshot.
#[derive(Default)]
pub(crate) struct Folded {
    pub(crate) title: Option<String>,
    pub(crate) last_seq: i64,
    pub(crate) infos: Map<String, Value>,
    pub(crate) parts: HashMap<String, Map<String, Value>>,
    /// Message id to the `(min, max)` seq of the events about it.
    pub(crate) spans: HashMap<String, (i64, i64)>,
}

impl Folded {
    /// Both record generations, a 2.x message as its 1.x view unless the 1.x events hold it.
    pub(crate) fn fold(events: &[DurableEvent]) -> Self {
        let mut folded = Self::fold_v1(events);
        let held: HashSet<String> = folded.infos.keys().cloned().collect();
        for event in events {
            let Some(message) = record_message(event) else {
                continue;
            };
            let Some(legacy) = LegacyMessage::of(message, None) else {
                continue;
            };
            if held.contains(&legacy.id) {
                continue;
            }
            let parts = legacy.parts.into_iter().filter_map(|part| {
                let id = part.get("id").and_then(Value::as_str)?.to_string();
                Some((id, Value::Object(part)))
            });
            folded.parts.insert(legacy.id.clone(), parts.collect());
            folded
                .infos
                .insert(legacy.id.clone(), Value::Object(legacy.info));
            folded.cover(&legacy.id, event.seq);
        }
        folded
    }

    /// The 1.x events only; `last_seq` still covers every event.
    fn fold_v1(events: &[DurableEvent]) -> Self {
        let mut folded = Folded {
            last_seq: -1,
            ..Default::default()
        };
        for event in events {
            folded.last_seq = folded.last_seq.max(event.seq);
            if is_v2_record(&event.event_type) {
                continue;
            }
            let empty = Map::new();
            let data = match &event.data {
                Value::Object(m) => m,
                v if !truthy(v) => &empty,
                _ => continue,
            };
            folded.apply(event.seq, live_type(&event.event_type), data);
        }
        folded
    }

    fn apply(&mut self, seq: i64, etype: &str, data: &Map<String, Value>) {
        let empty = Map::new();
        match etype {
            "session.updated" => {
                let info = obj(data.get("info")).unwrap_or(&empty);
                if let Some(title) = info.get("title").and_then(generated_title) {
                    self.title = Some(title);
                }
            }
            "message.updated" => {
                let info = obj(data.get("info")).unwrap_or(&empty);
                let (Some(id), Some(role)) = (truthy_key(info.get("id")), info.get("role")) else {
                    return;
                };
                if !truthy(role) {
                    return;
                }
                self.infos.insert(id.clone(), Value::Object(info.clone()));
                self.parts.entry(id.clone()).or_default();
                self.cover(&id, seq);
            }
            "message.part.updated" => {
                let part = obj(data.get("part")).unwrap_or(&empty);
                let (Some(pid), Some(mid)) = (
                    truthy_key(part.get("id")),
                    truthy_key(part.get("messageID")),
                ) else {
                    return;
                };
                self.parts
                    .entry(mid.clone())
                    .or_default()
                    .insert(pid, Value::Object(part.clone()));
                self.cover(&mid, seq);
            }
            "message.part.removed" => {
                let mid = truthy_key(data.get("messageID")).unwrap_or_default();
                let pid = truthy_key(data.get("partID")).unwrap_or_default();
                if let Some(parts) = self.parts.get_mut(&mid) {
                    parts.shift_remove(&pid);
                }
                if !mid.is_empty() {
                    self.cover(&mid, seq);
                }
            }
            "message.removed" => {
                let mid = truthy_key(data.get("messageID")).unwrap_or_default();
                self.infos.shift_remove(&mid);
                if !mid.is_empty() {
                    self.cover(&mid, seq);
                }
            }
            _ => {}
        }
    }

    fn cover(&mut self, msg_id: &str, seq: i64) {
        let span = self.spans.entry(msg_id.to_string()).or_insert((seq, seq));
        *span = (span.0.min(seq), span.1.max(seq));
    }
}

/// Who reads a stored transcript; the owner reads it as stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audience {
    Owner,
    Viewer,
    /// A viewer of a `redact_tools` share: tool names and counts, no tool data.
    ViewerRedacted,
}

/// What else a share's reader may not see.
#[derive(Debug, Default, Clone, Copy)]
pub struct ReaderView<'a> {
    /// `{call_id: {reason, stream}}` of the steps on streams the reader cannot read.
    pub hidden: Option<&'a Map<String, Value>>,
    pub hide_attachments: bool,
}

/// o2-ai's `project_events` output for ascending events, plus each turn's `first_seq`/`last_seq`.
pub fn project(events: &[DurableEvent]) -> Value {
    let folded = Folded::fold_v1(events);
    let mut turns = project_v1(&folded);
    let mut title = folded.title.clone();
    if events.iter().any(|e| is_v2_record(&e.event_type)) {
        let (v2_turns, v2_title) = project_v2(events, &folded.infos);
        turns.extend(v2_turns);
        title = v2_title.or(title);
        // Only a log holding 2.x records is ordered by creation, so a 1.x chat projects as before.
        turns.sort_by(|a, b| created_order(&a.created, &b.created));
    }
    let turns: Vec<Value> = turns.into_iter().map(Turn::into_value).collect();
    json!({"turns": turns, "title": title, "last_seq": folded.last_seq})
}

/// [`redact_turns`] on a projection (`{"turns": [...]}`) or a bare list of turns.
pub fn redact(projected: &mut Value) {
    match projected {
        Value::Object(m) => {
            if let Some(Value::Array(turns)) = m.get_mut("turns") {
                redact_turns(turns);
            }
        }
        Value::Array(turns) => redact_turns(turns),
        _ => {}
    }
}

/// K6: keep assistant text and tool names; drop tool data, navigation targets and provider errors.
pub fn redact_turns(turns: &mut [Value]) {
    for turn in turns {
        keep_inline_images(turn);
        if let Some(error) = turn.get_mut("error").filter(|e| !e.is_null()) {
            *error = Value::String(DEFAULT_TURN_ERROR.into());
        }
        let Some(Value::Array(frames)) = turn.get_mut("frames") else {
            continue;
        };
        frames.retain(|frame| !REDACTED_DROPPED_FRAMES.contains(&frame_type(frame)));
        for frame in frames.iter_mut() {
            redact_frame(frame);
        }
    }
}

/// Clears user image urls that are not inline `data:image/` urls, so a viewer fetches nothing.
pub fn keep_inline_images(turn: &mut Value) {
    let Some(Value::Array(images)) = turn.get_mut("user").and_then(|u| u.get_mut("images")) else {
        return;
    };
    for image in images.iter_mut().filter_map(Value::as_object_mut) {
        let inline = image
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|url| url.starts_with("data:image/"));
        if !inline {
            image.insert("url".into(), Value::Null);
        }
    }
}

/// The 1.x turns: each user message, answered by the assistant messages naming it as parent.
fn project_v1(folded: &Folded) -> Vec<Turn> {
    let empty = Map::new();
    let mut turns: HashMap<&str, usize> = HashMap::new();
    let mut projected: Vec<Turn> = Vec::new();
    for (msg_id, info) in &folded.infos {
        let Some(info) = info.as_object() else {
            continue;
        };
        if info.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let mut turn = Turn {
            user_message_id: info.get("id").cloned().unwrap_or(Value::Null),
            created: obj(info.get("time"))
                .and_then(|t| t.get("created"))
                .cloned()
                .unwrap_or(Value::Null),
            ..Default::default()
        };
        turn.cover(folded.spans.get(msg_id));
        turn.collect_user_parts(folded.parts.get(msg_id).unwrap_or(&empty));
        turns.insert(msg_id, projected.len());
        projected.push(turn);
    }

    for (msg_id, info) in &folded.infos {
        let Some(info) = info.as_object() else {
            continue;
        };
        if info.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let parent = truthy_key(info.get("parentID")).unwrap_or_default();
        if let Some(&index) = turns.get(parent.as_str()) {
            let turn = &mut projected[index];
            turn.cover(folded.spans.get(msg_id));
            turn.project_assistant_message(info, folded.parts.get(msg_id).unwrap_or(&empty));
        }
    }
    projected
}

/// The 2.x turns and generated title; `held` is the 1.x messages, whose 2.x copies are skipped.
fn project_v2(events: &[DurableEvent], held: &Map<String, Value>) -> (Vec<Turn>, Option<String>) {
    let mut title = None;
    let mut messages: Map<String, Value> = Map::new();
    let mut spans: HashMap<String, (i64, i64)> = HashMap::new();
    for event in events {
        let Value::Object(data) = &event.data else {
            continue;
        };
        let kind = event.event_type.as_str();
        if let (SESSION_CREATED | SESSION_UPDATED, Some(info)) = (kind, obj(data.get("info"))) {
            if let Some(generated) = info.get("title").and_then(generated_title) {
                title = Some(generated);
            }
            continue;
        }
        let Some(message) = obj(data.get("message")).filter(|_| kind == MESSAGE_UPDATED) else {
            continue;
        };
        let Some(msg_id) = message.get("id").filter(|v| truthy(v)).map(py_str) else {
            continue;
        };
        if held.contains_key(&msg_id) {
            continue;
        }
        let span = spans
            .entry(msg_id.clone())
            .or_insert((event.seq, event.seq));
        *span = (span.0.min(event.seq), span.1.max(event.seq));
        messages.insert(msg_id, Value::Object(message.clone()));
    }

    let mut turns: Vec<Turn> = Vec::new();
    for (msg_id, message) in &messages {
        let Some(message) = message.as_object() else {
            continue;
        };
        if message.get("type").and_then(Value::as_str) == Some("user") {
            let mut turn = Turn {
                user_message_id: Value::String(msg_id.clone()),
                created: obj(message.get("time"))
                    .and_then(|t| t.get("created"))
                    .cloned()
                    .unwrap_or(Value::Null),
                ..Default::default()
            };
            turn.collect_v2_user(message);
            turns.push(turn);
        } else if let Some(turn) = turns.last_mut() {
            turn.project_v2_message(message);
        } else {
            continue;
        }
        if let Some(turn) = turns.last_mut() {
            turn.cover(spans.get(msg_id));
        }
    }
    (turns, title)
}

/// o2-ai's turn order: by the user message's creation, turns without one last.
fn created_order(a: &Value, b: &Value) -> std::cmp::Ordering {
    let key = |created: &Value| {
        let at = if truthy(created) {
            created.as_f64().unwrap_or(0.0)
        } else {
            0.0
        };
        (created.is_null(), at)
    };
    let ((a_null, a_at), (b_null, b_at)) = (key(a), key(b));
    a_null.cmp(&b_null).then(a_at.total_cmp(&b_at))
}

fn redact_frame(frame: &mut Value) {
    let Some(map) = frame.as_object_mut() else {
        return;
    };
    let kind = map.get("type").and_then(Value::as_str).unwrap_or_default();
    if kind == "error" {
        map.insert("error".into(), Value::String(DEFAULT_TURN_ERROR.into()));
        return;
    }
    if kind == NAVIGATION_ACTION {
        map.retain(|k, _| REDACTED_NAVIGATION_KEYS.contains(&k.as_str()));
        map.insert("label".into(), REDACTED_NAVIGATION_LABEL.into());
        return;
    }
    if kind == "step" {
        let label = map
            .get("tool")
            .and_then(Value::as_str)
            .map(tool_description)
            .or_else(|| map.get("kind").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        let call_id = map.get("call_id").cloned();
        map.retain(|k, _| REDACTED_STEP_KEYS.contains(&k.as_str()));
        map.insert("label".into(), label.into());
        if let Some(call_id) = call_id {
            map.insert("params".into(), json!({ "call_id": call_id }));
        }
        return;
    }
    if kind == CONFIRMATION_REQUIRED {
        let total = approval_total(map);
        map.retain(|k, _| REDACTED_APPROVAL_KEYS.contains(&k.as_str()));
        map.insert("total".into(), total.into());
        return;
    }
    if kind != "tool_call" && kind != "tool_result" {
        return;
    }
    let tool = map
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let mut kept = Map::new();
    kept.insert("type".into(), Value::String(kind.to_string()));
    kept.insert("tool".into(), Value::String(tool.clone()));
    if kind == "tool_call" {
        kept.insert("message".into(), Value::String(tool_description(&tool)));
    } else {
        let success = map.get("success").and_then(Value::as_bool).unwrap_or(false);
        let message = if success {
            format!("{tool} completed successfully")
        } else {
            format!("{tool} failed")
        };
        kept.insert("success".into(), Value::Bool(success));
        kept.insert("message".into(), Value::String(message));
        // Counts say how much was found, never what.
        if let Some(summary) =
            obj(map.get("summary")).filter(|m| !m.is_empty() && m.values().all(Value::is_number))
        {
            kept.insert("summary".into(), Value::Object(summary.clone()));
        }
    }
    if let Some(call_id) = map.get("call_id") {
        kept.insert("call_id".into(), call_id.clone());
    }
    *map = kept;
}

/// Pairs `decision` with the request it answers, naming the request when it had no id.
fn resolved_frame(decision: &Map<String, Value>, asked: Option<&mut Value>, n: usize) -> Value {
    let id = asked
        .as_ref()
        .and_then(|f| f.get("id").and_then(Value::as_str).map(str::to_string))
        .or_else(|| {
            decision
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("decision-{n}"));
    if let Some(Value::Object(asked)) = asked {
        asked
            .entry("id")
            .or_insert_with(|| Value::String(id.clone()));
    }
    let mut frame = Map::new();
    frame.insert("type".into(), CONFIRMATION_RESOLVED.into());
    frame.insert("id".into(), id.into());
    frame.insert(
        "approved".into(),
        decision
            .get("approved")
            .cloned()
            .unwrap_or(Value::Bool(false)),
    );
    for key in ["by", "at", "scope", "items"] {
        if let Some(value) = decision.get(key).filter(|v| !v.is_null()) {
            frame.insert(key.into(), value.clone());
        }
    }
    Value::Object(frame)
}

/// The answer's last fenced query, validated only by a successful run of that same text.
fn query_frame(frames: &[Value]) -> Option<Value> {
    let answer: String = frames
        .iter()
        .filter(|f| frame_type(f) == "message_delta")
        .filter_map(|f| f.get("content").and_then(Value::as_str))
        .collect();
    let (language, text) = QUERY_BLOCK
        .captures_iter(&answer)
        .filter_map(|block| {
            let fenced = block[1].to_ascii_lowercase();
            let (_, language) = QUERY_LANGUAGES.iter().find(|(tag, _)| *tag == fenced)?;
            let text = block[2].trim();
            (!text.is_empty()).then(|| (*language, text.to_string()))
        })
        .last()?;
    let validated = query_ran(frames, &text);
    Some(json!({
        "type": QUERY_FRAME,
        "language": language,
        "text": text,
        "validated": validated,
    }))
}

/// Whether the newest step that ran `text` succeeded.
fn query_ran(frames: &[Value], text: &str) -> bool {
    let wanted = normal_query(text);
    let ran: Vec<&str> = frames
        .iter()
        .filter(|f| frame_type(f) == "tool_call")
        .filter(|f| {
            obj(f.get("context")).is_some_and(|context| {
                QUERY_STEP_KEYS
                    .iter()
                    .filter_map(|key| context.get(*key).and_then(Value::as_str))
                    .any(|query| normal_query(query) == wanted)
            })
        })
        .filter_map(|f| f.get("call_id").and_then(Value::as_str))
        .collect();
    frames
        .iter()
        .rev()
        .filter(|f| frame_type(f) == "tool_result")
        .find(|f| {
            f.get("call_id")
                .and_then(Value::as_str)
                .is_some_and(|id| ran.contains(&id))
        })
        .is_some_and(|f| f.get("success") == Some(&Value::Bool(true)))
}

/// `text` with runs of whitespace outside quotes made one space; quoted text is kept verbatim.
fn normal_query(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let (mut quote, mut escaped, mut gap) = (None, false, false);
    for c in text.chars() {
        if let Some(open) = quote {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == open {
                quote = None;
            }
            continue;
        }
        if c.is_whitespace() {
            gap = true;
            continue;
        }
        if gap && !out.is_empty() {
            out.push(' ');
        }
        gap = false;
        if matches!(c, '\'' | '"' | '`') {
            quote = Some(c);
        }
        out.push(c);
    }
    out.trim_end_matches(';').trim().to_string()
}

/// How many frames at the end are terminal (`complete`, `cancelled`, `error`).
fn trailing_terminal(frames: &[Value]) -> usize {
    frames
        .iter()
        .rev()
        .take_while(|f| TERMINAL_FRAMES.contains(&frame_type(f)))
        .count()
}

fn frame_type(frame: &Value) -> &str {
    frame
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// A viewer sees that a request was answered and how, never who answered or what was granted.
fn keep_decision_only(frame: &mut Value) {
    if frame_type(frame) != CONFIRMATION_RESOLVED {
        return;
    }
    if let Some(map) = frame.as_object_mut() {
        map.retain(|k, _| VIEWER_DECISION_KEYS.contains(&k.as_str()));
    }
}

/// Where `fence` opens at the start of a line; mid-line it is plain text.
fn fence_start(text: &str, before: Option<char>, fence: &str) -> Option<usize> {
    text.match_indices(fence).map(|(at, _)| at).find(|&at| {
        text[..at]
            .chars()
            .next_back()
            .or(before)
            .is_none_or(|previous| previous == '\n')
    })
}

/// A follow-ups block's next questions, cleaned as o2-ai's `follow_ups_frame` cleans them.
fn follow_ups_of(block: &str) -> Vec<String> {
    let text = py_strip(block);
    let text = text.strip_suffix(CODE_FENCE).unwrap_or(text);
    let Ok(Value::Array(body)) = config::utils::json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let mut items: Vec<String> = Vec::new();
    for item in body.iter().filter_map(Value::as_str) {
        let words = item.split_whitespace().collect::<Vec<_>>().join(" ");
        let text: String = redact_internal_details(&words)
            .chars()
            .take(FOLLOW_UP_CHARS_MAX)
            .collect();
        if !text.is_empty() && !items.contains(&text) {
            items.push(text);
        }
    }
    items.truncate(FOLLOW_UPS_MAX);
    items
}

/// A findings block as its frame, only when it passes the schema the web client validates.
fn findings_body(block: &str) -> Option<Map<String, Value>> {
    let text = py_strip(block);
    let text = text.strip_suffix(CODE_FENCE).unwrap_or(text);
    let Ok(Value::Object(body)) = config::utils::json::from_str::<Value>(text) else {
        return None;
    };
    let mut frame = Map::new();
    frame.insert("type".into(), FINDINGS_FRAME.into());
    frame.extend(body);
    let frame = Value::Object(frame);
    if !fits_schema(&frame, &FINDINGS_SCHEMA) {
        return None;
    }
    match frame {
        Value::Object(frame) => Some(frame),
        _ => None,
    }
}

/// Whether `value` fits the JSON Schema subset findings.schema.json uses (as o2-ai's check).
fn fits_schema(value: &Value, schema: &Value) -> bool {
    let fits_value = schema.get("const").is_none_or(|expected| expected == value)
        && schema
            .get("enum")
            .and_then(Value::as_array)
            .is_none_or(|allowed| allowed.contains(value));
    fits_value
        && match value {
            Value::String(text) => fits_string(text, schema),
            Value::Array(items) => fits_array(items, schema),
            Value::Object(fields) => fits_object(fields, schema),
            _ => schema.get("type").is_none(),
        }
}

fn fits_string(text: &str, schema: &Value) -> bool {
    let chars = text.chars().count() as u64;
    has_type(schema, "string")
        && schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_none_or(|min| chars >= min)
        && schema
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_none_or(|max| chars <= max)
}

fn fits_array(items: &[Value], schema: &Value) -> bool {
    has_type(schema, "array")
        && schema
            .get("maxItems")
            .and_then(Value::as_u64)
            .is_none_or(|max| items.len() as u64 <= max)
        && schema
            .get("items")
            .is_none_or(|item| items.iter().all(|value| fits_schema(value, item)))
}

fn fits_object(fields: &Map<String, Value>, schema: &Value) -> bool {
    let empty = Map::new();
    let properties = obj(schema.get("properties")).unwrap_or(&empty);
    let closed = schema.get("additionalProperties") == Some(&Value::Bool(false));
    has_type(schema, "object")
        && schema
            .get("required")
            .and_then(Value::as_array)
            .is_none_or(|keys| {
                keys.iter()
                    .filter_map(Value::as_str)
                    .all(|key| fields.contains_key(key))
            })
        && fields.iter().all(|(key, value)| {
            properties
                .get(key)
                .map_or(!closed, |property| fits_schema(value, property))
        })
}

fn has_type(schema: &Value, kind: &str) -> bool {
    schema
        .get("type")
        .and_then(Value::as_str)
        .is_none_or(|declared| declared == kind)
}

/// A provider's own JSON error body stays out of the transcript; its prose passes.
fn readable_error(message: &str) -> String {
    let is_json = |text: &str| {
        config::utils::json::from_str::<Value>(text)
            .is_ok_and(|value| value.is_object() || value.is_array())
    };
    let raw = is_json(py_strip(message))
        || message
            .find('{')
            .is_some_and(|start| is_json(&message[start..]));
    if raw {
        DEFAULT_TURN_ERROR.to_string()
    } else {
        message.to_string()
    }
}

/// Replaces the user's attachment blocks with markers and drops the images.
fn hide_attachments(turn: &mut Value) {
    let Some(Value::Object(user)) = turn.get_mut("user") else {
        return;
    };
    if let Some(Value::String(text)) = user.get_mut("text") {
        *text = hide_attachment_blocks(text);
    }
    if user.contains_key("images") {
        user.insert("images".into(), Value::Array(Vec::new()));
    }
}

/// Model names go from every prose string and `model` keys go entirely; ids and enums stay.
fn scrub_value(value: &mut Value, depth: usize) {
    match value {
        Value::String(text) => {
            if MODEL_NAME.0.is_match(text) {
                *text = scrub_model_names(text);
            }
        }
        Value::Array(items) if depth <= SCRUB_MAX_DEPTH => {
            for item in items {
                scrub_value(item, depth + 1);
            }
        }
        Value::Object(map) if depth <= SCRUB_MAX_DEPTH => {
            map.retain(|k, _| !MODEL_KEYS.contains(&k.as_str()));
            for (key, item) in map.iter_mut() {
                if !SCRUB_SKIP_KEYS.contains(&key.as_str()) {
                    scrub_value(item, depth + 1);
                }
            }
        }
        _ => {}
    }
}

/// The trailing run of blocks under the last block's nonce; anything else stays typed text.
fn split_nonced_blocks(text: &str) -> (String, Vec<String>) {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut names = Vec::new();
    let mut end = last_content_line(&lines, lines.len().checked_sub(1));
    let nonce = end
        .and_then(|e| NONCED_CLOSER.captures(lines[e]))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    while let (Some(nonce), Some(e)) = (nonce.as_deref(), end) {
        if e < 2 || lines[e] != format!("--- end [{nonce}] ---") {
            break;
        }
        let Some(opener) = NONCED_OPENER.captures(lines[e - 2]) else {
            break;
        };
        if opener.get(2).map(|m| m.as_str()) != Some(nonce) {
            break;
        }
        names.insert(0, opener[1].to_string());
        end = last_content_line(&lines, e.checked_sub(3));
    }
    if names.is_empty() {
        return (text.trim().to_string(), names);
    }
    let typed = end.map_or_else(String::new, |e| lines[..=e].join("\n"));
    (typed.trim().to_string(), names)
}

fn last_content_line(lines: &[&str], from: Option<usize>) -> Option<usize> {
    let mut i = from?;
    loop {
        if !lines[i].trim().is_empty() {
            return Some(i);
        }
        i = i.checked_sub(1)?;
    }
}

/// Streams a step's input names: its name keys and its SQL's tables; none when the SQL is
/// unreadable.
fn context_streams(context: &Map<String, Value>) -> Vec<String> {
    let mut streams: Vec<String> = STREAM_NAME_KEYS
        .iter()
        .filter_map(|k| context.get(*k).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if let Some(sql) = context.get("sql").and_then(Value::as_str) {
        // A named stream does not vouch for the SQL, which may read another one.
        match config::meta::sql::resolve_stream_names(sql) {
            Ok(tables) if !tables.is_empty() => streams.extend(tables),
            _ => return Vec::new(),
        }
    }
    streams.sort();
    streams.dedup();
    streams
}

/// `(stream_type, stream)` of each stream a step's input names; none for a type no check covers.
fn step_places(context: &Map<String, Value>) -> Vec<(String, String)> {
    let stream_type = match context.get("stream_type").and_then(Value::as_str) {
        Some(t) if CHECKABLE_STREAM_TYPES.contains(&t) => t,
        Some(_) => return Vec::new(),
        None => context
            .get("type")
            .and_then(Value::as_str)
            .filter(|t| CHECKABLE_STREAM_TYPES.contains(t))
            .unwrap_or(DEFAULT_STREAM_TYPE),
    };
    context_streams(context)
        .into_iter()
        .map(|stream| (stream_type.to_string(), stream))
        .collect()
}

/// How many items an approval covers, as the web client counts them.
fn approval_total(approval: &Map<String, Value>) -> u64 {
    let len = |v: Option<&Value>| v.and_then(Value::as_array).map(|a| a.len() as u64);
    approval
        .get("total")
        .and_then(Value::as_u64)
        .or_else(|| len(approval.get("targets")))
        .or_else(|| len(approval.get("args").and_then(|a| a.get("items"))))
        .unwrap_or(0)
}

/// `text` before its first line that opens an attachment block, and that block's name.
fn cut_at_block_opener(text: &str) -> (String, Option<String>) {
    let lines: Vec<&str> = text.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let name = NONCED_OPENER
            .captures(line)
            .or_else(|| LEGACY_OPENER.captures(line))
            .map(|c| c[1].to_string())
            .filter(|name| name != "end");
        if name.is_some() {
            return (lines[..i].join("\n").trim().to_string(), name);
        }
    }
    (text.to_string(), None)
}

fn tool_description(tool: &str) -> String {
    TOOL_DESCRIPTIONS
        .iter()
        .find(|(name, _)| *name == tool)
        .map_or_else(|| format!("Executing {tool}"), |(_, d)| d.to_string())
}

fn live_type(durable_type: &str) -> &str {
    match durable_type.rsplit_once('.') {
        Some((base, version))
            if !version.is_empty() && version.bytes().all(|b| b.is_ascii_digit()) =>
        {
            base
        }
        _ => durable_type,
    }
}

fn generated_title(title: &Value) -> Option<String> {
    let stripped = py_strip(title.as_str()?);
    if stripped.is_empty()
        || PLACEHOLDER_TITLE_PREFIXES
            .iter()
            .any(|p| stripped.starts_with(p))
    {
        return None;
    }
    Some(stripped.to_string())
}

pub(crate) fn is_injected(part: &Map<String, Value>) -> bool {
    obj(part.get("metadata"))
        .and_then(|m| m.get(INJECTED_KEY))
        .is_some_and(|v| py_num_eq(v, 1))
}

pub(crate) fn strip_mcp_prefix(tool_name: &str) -> &str {
    match tool_name.split_once('_') {
        Some((prefix, rest)) if !rest.is_empty() && MCP_SERVER_PREFIXES.contains(&prefix) => rest,
        _ => tool_name,
    }
}

fn hidden_in_chat(tool_name: &str) -> bool {
    HIDDEN_TOOLS.contains(&tool_name) || HIDDEN_V2_TOOLS.contains(&tool_name)
}

fn resolve_tool_call(
    tool_name: &str,
    args: &Map<String, Value>,
) -> Option<(String, Map<String, Value>)> {
    let tool_name = strip_mcp_prefix(tool_name);
    if hidden_in_chat(tool_name) {
        return None;
    }
    if tool_name == "tools_call" {
        let actual = strip_mcp_prefix(args.get("tool").and_then(Value::as_str).unwrap_or_default());
        if actual.is_empty() {
            return None;
        }
        let inner = obj(args.get("args")).cloned().unwrap_or_default();
        return Some((actual.to_string(), inner));
    }
    Some((tool_name.to_string(), args.clone()))
}

fn format_tool_call_event(
    tool_name: &str,
    args: &Map<String, Value>,
) -> Option<Map<String, Value>> {
    let (tool_name, args) = resolve_tool_call(tool_name, args)?;
    let mut message = tool_description(&tool_name);
    if tool_name == "StreamList" {
        let stream_type = py_strip(args.get("type").and_then(Value::as_str).unwrap_or_default());
        if !stream_type.is_empty() {
            let label = if stream_type.ends_with('s') {
                stream_type.trim_end_matches('s')
            } else {
                stream_type
            };
            message = format!("Listing {label} streams");
        }
    }
    let mut context = args.clone();
    let request_body = obj(args.get("request_body"));
    if tool_name == "testFunction" {
        if let Some(vrl) = request_body
            .and_then(|rb| rb.get("function"))
            .filter(|v| truthy(v))
        {
            context.insert("vrl".into(), vrl.clone());
        }
    } else if tool_name == "SearchSQL"
        && let Some(sql) = request_body
            .and_then(|rb| obj(rb.get("query")))
            .and_then(|q| q.get("sql"))
            .filter(|v| truthy(v))
    {
        context.insert("sql".into(), sql.clone());
    }
    let mut event = Map::new();
    event.insert("type".into(), Value::String("tool_call".into()));
    event.insert("tool".into(), Value::String(tool_name));
    event.insert("message".into(), Value::String(message));
    event.insert("context".into(), Value::Object(context));
    Some(event)
}

fn format_tool_result_event(
    tool_name: &str,
    result: &Map<String, Value>,
    is_error: bool,
    call_info: Option<&CallInfo>,
) -> Option<Map<String, Value>> {
    let tool_name = strip_mcp_prefix(tool_name);
    if hidden_in_chat(tool_name) {
        return None;
    }
    if is_error
        && let Some(Value::String(error)) = result.get("error")
        && error.contains("requires user confirmation")
    {
        return None;
    }
    let actual_tool = strip_mcp_prefix(
        call_info
            .map(|c| c.tool.as_str())
            .filter(|t| !t.is_empty())
            .unwrap_or(tool_name),
    )
    .to_string();
    let call_args = call_info.map(|c| &c.args).filter(|a| !a.is_empty());

    if !is_error
        && (actual_tool.starts_with("cli_") || actual_tool.starts_with("custom_"))
        && result.contains_key("return_code")
    {
        return Some(format_exec_event(actual_tool, result, call_args));
    }

    let mut response_body = extract_mcp_response(result);
    if response_body.is_null() && is_error {
        response_body = Value::Object(result.clone());
    }

    let mut event = Map::new();
    event.insert("type".into(), Value::String("tool_result".into()));
    event.insert("tool".into(), Value::String(actual_tool.clone()));
    event.insert("success".into(), Value::Bool(!is_error));
    if let Some(unrun) = unrun_call(result, &response_body).filter(|_| !is_error) {
        event.insert("success".into(), Value::Bool(false));
        event.extend(unrun);
        return Some(scrub_event_text(event));
    }
    if is_error {
        let (message, error_type) = parse_error(&response_body, Some(result));
        let message = match message {
            Value::String(text) => Value::String(
                text.strip_suffix(REFUSED_ADVICE)
                    .map_or_else(|| text.clone(), str::to_string),
            ),
            other => other,
        };
        event.insert("error_type".into(), Value::String(error_type));
        event.insert("message".into(), message);
    } else {
        event.insert(
            "message".into(),
            Value::String(format!("{actual_tool} completed successfully")),
        );
    }

    if actual_tool == "SearchSQL" {
        add_search_sql_details(&mut event, &response_body, is_error);
    } else if actual_tool == "testFunction" {
        add_test_function_details(&mut event, &response_body, call_args, is_error);
    }

    if !is_error && truthy(&response_body) && response_body.is_object() {
        event.entry("response").or_insert(response_body);
    }
    if let Some(args) = call_args
        && !is_error
    {
        event.insert("call_args".into(), Value::Object(args.clone()));
    }
    Some(scrub_event_text(event))
}

/// Frame fields of a completed call the approval guard stopped; it must not read as success.
fn unrun_call(result: &Map<String, Value>, response_body: &Value) -> Option<Map<String, Value>> {
    let raw = match response_body {
        Value::String(text) => Some(text.as_str()),
        _ => result.get("output").and_then(Value::as_str),
    };
    let text = raw.unwrap_or_default().trim();
    let mut fields = Map::new();
    if let Some(queued) = APPROVAL_MARKER.captures(text) {
        fields.insert("error_type".into(), APPROVAL_PENDING.into());
        fields.insert("approval_id".into(), queued[1].into());
        fields.insert(
            "message".into(),
            "Waiting for your approval. Nothing has changed yet.".into(),
        );
    } else if text.starts_with(REFUSED_PREFIX) {
        fields.insert("error_type".into(), POLICY_REFUSED.into());
        let message = text.strip_suffix(REFUSED_ADVICE).unwrap_or(text);
        fields.insert("message".into(), message.into());
    } else {
        return None;
    }
    Some(fields)
}

/// `(success, error_type, message)` of a decided card; `None` while it still waits.
fn card_outcome(card: &Value, now: i64) -> Option<(bool, Option<&'static str>, Option<String>)> {
    // A card past its expiry is expired before the purge marks it, as the pending flag says.
    let status = match card["status"].as_str().unwrap_or_default() {
        "pending" if card["expires_at"].as_i64().is_some_and(|at| at <= now) => "expired",
        status => status,
    };
    let resolved = &card["resolved"];
    let detail = resolved["detail"].as_str().map(str::to_string);
    let outcome = resolved["outcome"].as_str().unwrap_or(status);
    match (status, outcome) {
        ("pending", _) => None,
        ("expired", _) => Some((
            false,
            Some("approval_expired"),
            Some("The approval expired. Nothing was changed.".into()),
        )),
        ("approved", "approved") => Some((true, None, None)),
        ("approved", _) => Some((
            false,
            Some("approval_failed"),
            Some(detail.unwrap_or_else(|| "The change could not be applied.".into())),
        )),
        _ => Some((
            false,
            Some("approval_denied"),
            Some(detail.unwrap_or_else(|| "Declined. Nothing was changed.".into())),
        )),
    }
}

fn format_exec_event(
    tool: String,
    result: &Map<String, Value>,
    call_args: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let return_code = result.get("return_code").cloned().unwrap_or(Value::Null);
    let text_of = |key: &str| {
        result
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let (stdout, stderr) = (text_of("stdout"), text_of("stderr"));
    let truncated = result.get("truncated").is_some_and(truthy);
    let stdout_lines = count_lines(&stdout);
    let mut summary = Map::new();
    summary.insert("return_code".into(), return_code.clone());
    summary.insert("stdout_lines".into(), Value::from(stdout_lines));
    summary.insert("stderr_lines".into(), Value::from(count_lines(&stderr)));
    if truncated {
        summary.insert("truncated".into(), Value::Bool(true));
    }
    let success = py_num_eq(&return_code, 0);
    let message = if success {
        let suffix = if stdout_lines == 1 { "" } else { "s" };
        format!("Exited 0 ({stdout_lines} line{suffix} stdout)")
    } else {
        let stripped = py_strip(&stderr);
        let first_err: String = stripped
            .split(is_py_line_break)
            .next()
            .unwrap_or_default()
            .chars()
            .take(FIRST_ERR_CHARS)
            .collect();
        if first_err.is_empty() {
            format!("Exited {}", py_str(&return_code))
        } else {
            format!("Exited {}: {first_err}", py_str(&return_code))
        }
    };
    let mut event = Map::new();
    event.insert("type".into(), Value::String("tool_result".into()));
    event.insert("tool".into(), Value::String(tool));
    event.insert("success".into(), Value::Bool(success));
    event.insert("message".into(), Value::String(message));
    event.insert("summary".into(), Value::Object(summary));
    if let Some(args) = call_args {
        event.insert("call_args".into(), Value::Object(args.clone()));
    }
    scrub_event_text(event)
}

fn add_search_sql_details(event: &mut Map<String, Value>, body: &Value, is_error: bool) {
    let response = match body {
        Value::Object(body) => {
            let mut formatted = Map::new();
            let hits = body.get("hits").cloned().unwrap_or(Value::Array(vec![]));
            if truthy(&hits) {
                formatted.insert("hits".into(), py_slice(&hits, SEARCH_SQL_MAX_HITS));
                if py_len(&hits) > SEARCH_SQL_MAX_HITS {
                    formatted.insert("hits_truncated".into(), Value::Bool(true));
                }
            }
            let total = body
                .get("total")
                .cloned()
                .unwrap_or_else(|| Value::from(py_len(&hits)));
            formatted.insert("total".into(), total);
            if let Some(took) = body.get("took") {
                formatted.insert("took".into(), took.clone());
            }
            Value::Object(formatted)
        }
        Value::String(_) => parse_error(body, None).0,
        other => other.clone(),
    };
    event.insert("response".into(), response);
    let Some(body) = body.as_object().filter(|_| !is_error) else {
        return;
    };
    let mut summary = Map::new();
    if let Some(total) = body.get("total") {
        summary.insert("count".into(), total.clone());
    } else if let Some(Value::Array(hits)) = body.get("hits") {
        summary.insert("count".into(), Value::from(hits.len()));
    } else if !body.contains_key("hits") {
        summary.insert("count".into(), Value::from(0));
    }
    if let Some(took) = body.get("took") {
        summary.insert("took".into(), took.clone());
    }
    if summary.is_empty() {
        return;
    }
    if let Some(count) = summary.get("count") {
        let suffix = if py_num_eq(count, 1) { "" } else { "s" };
        event.insert(
            "message".into(),
            Value::String(format!("Found {} result{suffix}", py_str(count))),
        );
    }
    event.insert("summary".into(), Value::Object(summary));
}

fn add_test_function_details(
    event: &mut Map<String, Value>,
    body: &Value,
    call_args: Option<&Map<String, Value>>,
    is_error: bool,
) {
    let request_body = call_args.and_then(|a| match a.get("request_body") {
        None => Some(Map::new()),
        Some(Value::Object(rb)) => Some(rb.clone()),
        Some(_) => None,
    });
    let mut formatted = Map::new();
    if let Some(rb) = &request_body {
        let events = rb.get("events").cloned().unwrap_or(Value::Array(vec![]));
        if truthy(&events) {
            formatted.insert(
                "input".into(),
                py_slice(&events, TEST_FUNCTION_MAX_INPUT_EVENTS),
            );
        }
    }
    if let Some(body) = body.as_object() {
        let results = body.get("results").cloned().unwrap_or(Value::Array(vec![]));
        if truthy(&results) {
            formatted.insert(
                "output".into(),
                py_slice(&results, TEST_FUNCTION_MAX_OUTPUT_RESULTS),
            );
        }
    }
    let response = if !formatted.is_empty() {
        Value::Object(formatted)
    } else if body.is_object() {
        body.clone()
    } else {
        Value::Null
    };
    event.insert("response".into(), response);

    let Some(body) = body.as_object().filter(|_| !is_error) else {
        return;
    };
    let mut summary = Map::new();
    let mut parts: Vec<String> = Vec::new();
    if let Some(Value::Array(events)) = request_body.as_ref().and_then(|rb| rb.get("events")) {
        let n = events.len();
        summary.insert("input_count".into(), Value::from(n));
        parts.push(format!("{n} input event{}", if n == 1 { "" } else { "s" }));
    } else if request_body
        .as_ref()
        .is_some_and(|rb| !rb.contains_key("events"))
    {
        summary.insert("input_count".into(), Value::from(0));
        parts.push("0 input events".to_string());
    }
    if let Some(Value::Array(results)) = body.get("results") {
        let n = results.len();
        summary.insert("output_count".into(), Value::from(n));
        parts.push(format!("{n} result{}", if n == 1 { "" } else { "s" }));
    }
    if summary.is_empty() {
        return;
    }
    event.insert("summary".into(), Value::Object(summary));
    if !parts.is_empty() {
        event.insert(
            "message".into(),
            Value::String(format!("Tested: {}", parts.join(", "))),
        );
    }
}

/// The response body inside an MCP content wrapper; `Null` when there is none.
pub(crate) fn extract_mcp_response(result: &Map<String, Value>) -> Value {
    let Some(Value::Object(first)) = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
    else {
        return Value::Null;
    };
    match first.get("text") {
        None => Value::Null,
        Some(Value::String(text)) => config::utils::json::from_str::<Value>(text)
            .unwrap_or_else(|_| Value::String(text.clone())),
        Some(other) => Value::String(py_str(other)),
    }
}

/// A clean error message (any JSON value) and error type from a tool's error body.
fn parse_error(body: &Value, raw_result: Option<&Map<String, Value>>) -> (Value, String) {
    let error_type = |code: Option<&Value>| match code {
        Some(code) if truthy(code) => format!("HTTP {}", py_str(code)),
        _ => "error".to_string(),
    };
    match body {
        Value::Object(body) => {
            let message = body
                .get("message")
                .cloned()
                .unwrap_or_else(|| Value::String("Tool execution failed".into()));
            return (message, error_type(body.get("code")));
        }
        Value::String(text) => {
            let parsed = text
                .find('{')
                .and_then(|start| config::utils::json::from_str::<Value>(&text[start..]).ok());
            if let Some(Value::Object(error)) = parsed {
                let message = error
                    .get("message")
                    .cloned()
                    .unwrap_or_else(|| body.clone());
                return (message, error_type(error.get("code")));
            }
            return (body.clone(), "error".to_string());
        }
        _ => {}
    }
    if let Some(raw) = raw_result {
        if let Some(Value::String(error)) = raw.get("error")
            && !error.is_empty()
        {
            return (Value::String(error.clone()), "mcp_error".into());
        }
        if let Some(Value::Object(first)) = raw
            .get("content")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            && let Some(text) = first.get("text").filter(|t| truthy(t))
        {
            return (Value::String(py_str(text)), "mcp_error".into());
        }
    }
    (
        Value::String("Tool execution failed".into()),
        "unknown".into(),
    )
}

fn scrub_event_text(mut event: Map<String, Value>) -> Map<String, Value> {
    for field in ["message", "response", "summary"] {
        if let Some(Value::String(text)) = event.get_mut(field) {
            *text = redact_internal_details(text);
        }
    }
    event
}

pub(crate) fn coerce_tool_output(output: Option<&Value>, metadata: Value) -> Map<String, Value> {
    let mut wrapped = Map::new();
    match output {
        Some(Value::Object(m)) => return m.clone(),
        Some(Value::String(text)) => {
            let text = strip_call_ref(text);
            let stripped = py_strip(text);
            if (stripped.starts_with('{') || stripped.starts_with('['))
                && let Ok(parsed) = config::utils::json::from_str::<Value>(stripped)
            {
                if let Value::Object(m) = parsed {
                    return m;
                }
                wrapped.insert("output".into(), parsed);
                return wrapped;
            }
            wrapped.insert("output".into(), Value::String(text.to_string()));
            if truthy(&metadata) {
                wrapped.insert("metadata".into(), metadata);
            }
        }
        None | Some(Value::Null) => {
            if let Value::Object(m) = metadata {
                return m;
            }
        }
        Some(other) => {
            wrapped.insert("output".into(), other.clone());
        }
    }
    wrapped
}

/// Whether the first-party delete tool returned a confirmation sentinel (it never deletes).
fn is_delete_confirmation(result: &Map<String, Value>, tool_name: &str) -> bool {
    !delete_sentinels(result, tool_name).is_empty()
}

/// The valid `delete_confirmation` sentinels of an `o2_delete` result.
fn delete_sentinels<'a>(
    result: &'a Map<String, Value>,
    tool_name: &str,
) -> Vec<&'a Map<String, Value>> {
    if tool_name != O2_DELETE_TOOL {
        return Vec::new();
    }
    let is_sentinel = |m: &Map<String, Value>| {
        m.get("type").and_then(Value::as_str) == Some("delete_confirmation")
    };
    let mut candidates: Vec<&Map<String, Value>> = Vec::new();
    if is_sentinel(result) {
        candidates.push(result);
    }
    for key in ["delete_confirmation", "response"] {
        if let Some(nested) = obj(result.get(key)).filter(|m| is_sentinel(m)) {
            candidates.push(nested);
        }
    }
    candidates.retain(|item| {
        let has_type = item.get("resource_type").is_some_and(truthy);
        let has_id = !matches!(item.get("id"), None | Some(Value::Null))
            && item.get("id").and_then(Value::as_str) != Some("");
        has_type && has_id
    });
    candidates
}

/// The `confirmation_required` frame the live stream showed for a delete awaiting approval.
fn delete_confirmation_frame(
    result: &Map<String, Value>,
    tool_name: &str,
    call_id: &str,
) -> Option<Value> {
    let sentinels = delete_sentinels(result, tool_name);
    let first = sentinels.first()?;
    let name_of = |item: &Map<String, Value>| {
        item.get("name")
            .filter(|v| truthy(v))
            .or_else(|| item.get("id"))
            .map(py_str)
            .unwrap_or_default()
    };
    let items: Vec<Value> = sentinels
        .iter()
        .map(|item| {
            json!({
                "resource_type": item.get("resource_type"),
                "name": name_of(item),
                "id": item.get("id"),
            })
        })
        .collect();
    let targets: Vec<Value> = sentinels
        .iter()
        .map(|item| json!({"type": item.get("resource_type"), "id": item.get("id"), "name": name_of(item)}))
        .collect();
    let message = if sentinels.len() == 1 {
        format!(
            "Do you really want to delete the \"{}\" {}?",
            name_of(first),
            first.get("resource_type").map(py_str).unwrap_or_default()
        )
    } else {
        format!(
            "Do you really want to delete these {} resources?",
            sentinels.len()
        )
    };
    let mut frame = json!({
        "type": CONFIRMATION_REQUIRED,
        "tool": O2_DELETE_TOOL,
        "kind": "delete",
        "destructive": true,
        "targets": targets,
        "args": {"items": items},
        "message": message,
    });
    if !call_id.is_empty() {
        frame["id"] = Value::String(call_id.to_string());
    }
    Some(frame)
}

/// A first-party tool's `navigation_action` payload, forwarded verbatim.
fn navigation_frame(result: &Map<String, Value>, tool_name: &str) -> Option<Value> {
    let mut candidates: Vec<&Map<String, Value>> = Vec::new();
    if result.get("type").and_then(Value::as_str) == Some("navigation_action") {
        candidates.push(result);
    }
    let keys = ["navigation_action", "navigation"];
    candidates.extend(keys.iter().filter_map(|k| obj(result.get(*k))));
    if let Some(response) = obj(result.get("response")) {
        candidates.extend(keys.iter().filter_map(|k| obj(response.get(*k))));
    }
    let cand = candidates.into_iter().find(|c| {
        c.get("type").and_then(Value::as_str) == Some("navigation_action")
            && c.get("action").is_some_and(truthy)
    })?;
    // Tool output can carry customer data: only first-party tools may navigate.
    let first_party = tool_name == NAVIGATION_TOOL || tool_name.starts_with(FIRST_PARTY_MCP_PREFIX);
    first_party.then(|| Value::Object(cand.clone()))
}

fn is_permission_rejection(message: &str) -> bool {
    let low = message.to_lowercase();
    PERMISSION_REJECTION_MARKERS.iter().any(|m| low.contains(m))
}

pub(crate) fn extract_error_message(error: &Value) -> String {
    match error {
        Value::String(s) => s.clone(),
        Value::Object(m) => {
            let from_data = obj(m.get("data")).and_then(|d| {
                d.get("message")
                    .filter(|v| truthy(v))
                    .or_else(|| d.get("error"))
                    .filter(|v| truthy(v))
            });
            let message = from_data.or_else(|| {
                m.get("message")
                    .filter(|v| truthy(v))
                    .or_else(|| m.get("name"))
                    .filter(|v| truthy(v))
            });
            match message {
                Some(message) => py_str(message),
                None => py_dumps(error).chars().take(ERROR_DUMP_CHARS).collect(),
            }
        }
        other => py_str(other),
    }
}

/// o2-ai's 2.x error message: [`extract_error_message`], falling back to the error's `type`.
fn v2_error_message(error: &Value) -> String {
    let said = |m: &Map<String, Value>, keys: [&str; 2]| {
        keys.iter().any(|k| m.get(*k).is_some_and(truthy))
    };
    let type_only = error
        .as_object()
        .filter(|m| !said(m, ["message", "name"]))
        .filter(|m| !obj(m.get("data")).is_some_and(|d| said(d, ["message", "error"])))
        .and_then(|m| m.get("type"))
        .filter(|t| truthy(t));
    type_only.map_or_else(|| extract_error_message(error), py_str)
}

/// Char index up to which streamed text can be emitted without splitting a redacted term.
fn stream_split(text: &[char]) -> usize {
    let mut cut = text.len();
    for _ in 0..STREAM_HOLDBACK_WORDS {
        while cut > 0 && is_py_space(text[cut - 1]) {
            cut -= 1;
        }
        while cut > 0 && !is_py_space(text[cut - 1]) {
            cut -= 1;
        }
        if cut == 0 {
            return 0;
        }
    }
    cut
}

fn count_lines(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    text.matches('\n').count() + usize::from(!text.ends_with('\n'))
}

pub(crate) fn obj(value: Option<&Value>) -> Option<&Map<String, Value>> {
    value.and_then(Value::as_object)
}

/// A truthy JSON value as a map key (strings as themselves).
fn truthy_key(value: Option<&Value>) -> Option<String> {
    value.filter(|v| truthy(v)).map(|v| match v {
        Value::String(s) => s.clone(),
        other => format!("\u{0}{other}"),
    })
}

/// Python truthiness of a JSON value.
pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Python `value == n` for a JSON value (`True == 1`, `1.0 == 1`).
fn py_num_eq(value: &Value, n: i64) -> bool {
    match value {
        Value::Bool(b) => i64::from(*b) == n,
        Value::Number(x) => x.as_f64() == Some(n as f64),
        _ => false,
    }
}

/// Python `str(value)` for a JSON value.
pub(crate) fn py_str(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Number(n) if n.is_i64() || n.is_u64() => n.to_string(),
        Value::Number(n) => n
            .as_f64()
            .map_or_else(|| n.to_string(), |f| format!("{f:?}")),
        other => py_dumps(other),
    }
}

/// Python `json.dumps(value)`: `", "`/`": "` separators and ASCII-only output.
fn py_dumps(value: &Value) -> String {
    let mut out = String::new();
    write_py_json(value, &mut out);
    out
}

fn write_py_json(value: &Value, out: &mut String) {
    match value {
        Value::String(s) => write_py_json_str(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_py_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            for (i, (k, v)) in map.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_py_json_str(k, out);
                out.push_str(": ");
                write_py_json(v, out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn write_py_json_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if !(' '..='~').contains(&c) => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn py_len(value: &Value) -> usize {
    match value {
        Value::Array(a) => a.len(),
        Value::String(s) => s.chars().count(),
        Value::Object(o) => o.len(),
        _ => 0,
    }
}

fn py_slice(value: &Value, n: usize) -> Value {
    match value {
        Value::Array(a) => Value::Array(a.iter().take(n).cloned().collect()),
        Value::String(s) => Value::String(s.chars().take(n).collect()),
        other => other.clone(),
    }
}

/// Python `str.isspace` for one char.
fn is_py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// The line boundaries of Python `str.splitlines`.
fn is_py_line_break(c: char) -> bool {
    matches!(
        c,
        '\n' | '\r'
            | '\u{b}'
            | '\u{c}'
            | '\u{1c}'
            | '\u{1d}'
            | '\u{1e}'
            | '\u{85}'
            | '\u{2028}'
            | '\u{2029}'
    )
}

fn py_strip(text: &str) -> &str {
    text.trim_matches(is_py_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_turn_keeps_the_window_and_entry_it_was_asked_with() {
        let parts = json!({
            "p1": {"type": "text", "text": "[Context] page", "metadata": {
                "o2_injected": true, "o2_window": {"from": 1, "to": 2}, "o2_entry_kind": "forged"}},
            "p2": {"type": "text", "text": "why errors?", "metadata": {
                "o2_window": {"from": 1_794_150_000_000_i64, "to": 1_794_236_400_000_i64, "relative": "24h"},
                "o2_entry_kind": "home_launcher"}},
        });
        let mut turn = Turn::default();
        turn.collect_user_parts(parts.as_object().unwrap());
        let user = turn.into_value()["user"].clone();
        assert_eq!(user["text"], "why errors?");
        assert_eq!(
            user["window"],
            json!({"from": 1_794_150_000_000_i64, "to": 1_794_236_400_000_i64, "relative": "24h"})
        );
        assert_eq!(user["entry_kind"], "home_launcher");

        let mut plain = Turn::default();
        let bare = json!({"p": {"type": "text", "text": "hi", "metadata": {"o2_window": {"from": "x", "to": 2}}}});
        plain.collect_user_parts(bare.as_object().unwrap());
        let user = plain.into_value()["user"].clone();
        assert!(user.get("window").is_none() && user.get("entry_kind").is_none());
    }

    #[test]
    fn a_query_builder_turn_gets_its_end_frame_back_before_the_terminal() {
        let fence = "```";
        let mut turn = json!({"frames": [
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "c1",
             "context": {"sql": "SELECT  a FROM b;"}},
            {"type": "tool_result", "tool": "SearchSQL", "call_id": "c1", "success": true},
            {"type": "message_delta", "content": format!("Try:\n{fence}sql\nSELECT 1\n{fence}\n")},
            {"type": "message_delta", "content": format!("or\n{fence}SQL\nSELECT a\nFROM b\n{fence}")},
            {"type": "complete"},
        ]});
        attach_query_frame(&mut turn);
        let frames = turn["frames"].as_array().unwrap();
        assert_eq!(frames.len(), 6);
        assert_eq!(frames[5]["type"], "complete");
        assert_eq!(
            frames[4],
            json!({"type": "query", "language": "sql", "text": "SELECT a\nFROM b", "validated": true})
        );
        attach_query_frame(&mut turn);
        assert_eq!(turn["frames"].as_array().unwrap().len(), 6, "only once");
    }

    #[test]
    fn a_query_that_never_ran_or_failed_is_not_validated_and_prose_gets_no_frame() {
        let fence = "```";
        let answer = format!("{fence}promql\nrate(x[5m])\n{fence}");
        let mut unrun = json!({"frames": [{"type": "message_delta", "content": answer}]});
        attach_query_frame(&mut unrun);
        assert_eq!(unrun["frames"][1]["language"], "promql");
        assert_eq!(unrun["frames"][1]["validated"], false);

        let mut failed = json!({"frames": [
            {"type": "tool_call", "call_id": "c1", "context": {"query": "rate(x[5m])"}},
            {"type": "tool_result", "call_id": "c1", "success": false},
            {"type": "message_delta", "content": answer},
        ]});
        attach_query_frame(&mut failed);
        assert_eq!(failed["frames"][3]["validated"], false);

        let mut prose = json!({"frames": [{"type": "message_delta", "content": "No query."}]});
        attach_query_frame(&mut prose);
        assert_eq!(prose["frames"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_query_whose_string_literal_differs_from_the_one_that_ran_is_not_validated() {
        let ran = |sql: &str| {
            vec![
                json!({"type": "tool_call", "call_id": "c1", "context": {"sql": sql}}),
                json!({"type": "tool_result", "call_id": "c1", "success": true}),
            ]
        };
        let executed = ran("SELECT *  FROM logs WHERE message = 'two  spaces';");
        assert!(query_ran(
            &executed,
            "SELECT * FROM logs\nWHERE message = 'two  spaces'"
        ));
        assert!(!query_ran(
            &executed,
            "SELECT * FROM logs WHERE message = 'two spaces'"
        ));
        assert!(!query_ran(
            &ran("SELECT * FROM logs WHERE message = 'Error'"),
            "SELECT * FROM logs WHERE message = 'error'"
        ));
        assert!(!query_ran(&ran(r#"up{job="a  b"}"#), r#"up{job="a b"}"#));
    }

    fn load(name: &str) -> (Vec<DurableEvent>, Value) {
        let path = format!("{}/src/ai_chat/testdata/{name}", env!("CARGO_MANIFEST_DIR"));
        let body: Value = config::utils::json::from_str(&std::fs::read_to_string(&path).unwrap())
            .unwrap_or_else(|e| panic!("{path}: {e}"));
        let events = body["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| DurableEvent::from_sync_event(e).expect("a durable event"))
            .collect();
        (events, body["expected"].clone())
    }

    fn golden_files() -> Vec<String> {
        let dir = format!("{}/src/ai_chat/testdata", env!("CARGO_MANIFEST_DIR"));
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".json"))
            .collect();
        names.sort();
        names
    }

    fn first_difference(path: &str, actual: &Value, expected: &Value) -> Option<String> {
        match (actual, expected) {
            (Value::Object(a), Value::Object(e)) => {
                let keys: std::collections::BTreeSet<&String> = a.keys().chain(e.keys()).collect();
                keys.into_iter().find_map(|k| {
                    let (av, ev) = (
                        a.get(k).unwrap_or(&Value::Null),
                        e.get(k).unwrap_or(&Value::Null),
                    );
                    if a.contains_key(k) != e.contains_key(k) {
                        return Some(format!("{path}.{k}: {av} vs {ev}"));
                    }
                    first_difference(&format!("{path}.{k}"), av, ev)
                })
            }
            (Value::Array(a), Value::Array(e)) if a.len() == e.len() => a
                .iter()
                .zip(e)
                .enumerate()
                .find_map(|(i, (av, ev))| first_difference(&format!("{path}[{i}]"), av, ev)),
            _ if actual == expected => None,
            _ => Some(format!("{path}: {actual} vs {expected}")),
        }
    }

    #[test]
    fn projection_matches_o2_ai_on_every_golden_file() {
        let names = golden_files();
        assert!(names.len() >= 5, "{names:?}");
        for name in names {
            let (events, expected) = load(&name);
            let mut actual = project(&events);
            // A documented difference: o2-ai's history drops the streamed delete request.
            for turn in actual["turns"].as_array_mut().unwrap() {
                turn["frames"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|f| f["type"] != CONFIRMATION_REQUIRED);
            }
            if let Some(diff) = first_difference("", &actual, &expected) {
                panic!("{name}: {diff}");
            }
        }
    }

    /// A `record_step` part is stored in full but projects to no tool frame.
    #[test]
    fn record_step_is_stored_but_never_projected() {
        let (events, _) = load("record_step.json");
        assert!(
            events
                .iter()
                .any(|e| e.data.pointer("/part/tool") == Some(&json!("record_step")))
        );
        let projected = project(&events).to_string();
        assert!(!projected.contains("record_step"), "{projected}");
    }

    #[test]
    fn turns_carry_the_seq_range_of_their_events() {
        let (events, _) = load("structure.json");
        let projected = project(&events);
        for turn in projected["turns"].as_array().unwrap() {
            let (first, last) = (
                turn["first_seq"].as_i64().unwrap(),
                turn["last_seq"].as_i64().unwrap(),
            );
            assert!(0 <= first && first <= last, "{turn}");
        }
        assert_eq!(project(&[])["last_seq"], -1);
        assert_eq!(project(&[])["turns"], json!([]));
    }

    #[test]
    fn redaction_keeps_text_and_tool_names_only() {
        let (events, _) = load("tool_heavy.json");
        let mut projected = project(&events);
        let full = projected.clone();
        redact(&mut projected);
        let frames = projected["turns"][0]["frames"].as_array().unwrap();
        let links = frames.iter().filter(|f| f["type"] == NAVIGATION_ACTION);
        for link in links {
            let mut keys: Vec<&str> = link
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            keys.sort_unstable();
            assert_eq!(keys, ["action", "label", "resource_type", "type"], "{link}");
            assert_eq!(link["label"], REDACTED_NAVIGATION_LABEL);
        }
        for frame in frames {
            let keys: Vec<&str> = frame
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            match frame["type"].as_str().unwrap() {
                "tool_call" => assert_eq!(keys, ["type", "tool", "message", "call_id"]),
                "tool_result" => {
                    let summary = frame["summary"].as_object();
                    assert!(summary.is_none_or(|m| m.values().all(Value::is_number)));
                    let mut expected = vec!["type", "tool", "success", "message"];
                    expected.extend(summary.map(|_| "summary"));
                    expected.push("call_id");
                    assert_eq!(keys, expected)
                }
                _ => {}
            }
        }
        let text = |v: &Value| -> String {
            v["turns"][0]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|f| f["type"] == "message_delta")
                .map(|f| f["content"].as_str().unwrap().to_string())
                .collect()
        };
        assert_eq!(text(&projected), text(&full));
        let dumped = projected.to_string();
        assert!(!dumped.contains("SELECT 1") && !dumped.contains("/d/1"));

        let mut turns = full["turns"].clone();
        redact(&mut turns);
        assert_eq!(turns, projected["turns"]);
    }

    #[test]
    fn redaction_drops_query_and_findings_and_strips_step_params() {
        let mut turns = json!([{"frames": [
            {"type": "query", "language": "sql", "text": "SELECT secret FROM payroll"},
            {"type": "findings", "likely_cause": "payroll spike", "confidence": "high",
             "evidence": [{"text": "payroll row 7", "kind": "verified"}],
             "ruled_out": [], "unknowns": [], "next_steps": []},
            {"type": "step", "id": "c1", "call_id": "c1", "kind": "search",
             "label": "Searching payroll", "tool": "SearchSQL", "state": "running",
             "params": {"call_id": "c1", "stream": "payroll", "query": "SELECT secret"}},
            {"type": "message_delta", "content": "done"},
        ]}]);
        redact(&mut turns);
        let frames = turns[0]["frames"].as_array().unwrap();
        let kinds: Vec<&str> = frames.iter().map(frame_type).collect();
        assert_eq!(kinds, ["step", "message_delta"]);
        assert_eq!(frames[0]["params"], json!({"call_id": "c1"}));
        assert_eq!(frames[0]["label"], tool_description("SearchSQL"));
        assert_eq!(frames[0]["state"], "running");
        let dumped = turns.to_string();
        assert!(
            !dumped.contains("payroll") && !dumped.contains("secret"),
            "{dumped}"
        );
    }

    #[test]
    fn redaction_hides_provider_errors_and_remote_images() {
        let mut turns = json!([{
            "user": {"text": "hi", "images": [
                {"filename": "a.png", "url": "data:image/png;base64,AAAA"},
                {"filename": "b.png", "url": "https://tracker.example/b.png"},
                {"filename": "c.png", "url": "data:text/html,<script>"},
            ]},
            "frames": [{"type": "error", "error": "provider key sk-123 rejected", "recoverable": false}],
            "error": "provider key sk-123 rejected",
        }]);
        redact(&mut turns);
        let dumped = turns.to_string();
        assert!(
            !dumped.contains("sk-123") && !dumped.contains("tracker"),
            "{dumped}"
        );
        assert_eq!(turns[0]["frames"][0]["error"], DEFAULT_TURN_ERROR);
        assert_eq!(turns[0]["frames"][0]["recoverable"], false);
        assert_eq!(turns[0]["error"], DEFAULT_TURN_ERROR);
        let urls: Vec<&Value> = turns[0]["user"]["images"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| &i["url"])
            .collect();
        assert_eq!(urls[0], "data:image/png;base64,AAAA");
        assert_eq!((urls[1], urls[2]), (&Value::Null, &Value::Null));
        let mut clean = json!([{"user": null, "frames": [], "error": null}]);
        redact(&mut clean);
        assert_eq!(clean[0]["error"], Value::Null);
    }

    #[test]
    fn python_helpers_behave_like_python() {
        assert_eq!(
            py_dumps(&json!({"a": "ü ☃", "b": [1, null, true]})),
            "{\"a\": \"\\u00fc \\u2603\", \"b\": [1, null, true]}"
        );
        assert_eq!(py_str(&json!(null)), "None");
        assert_eq!(py_str(&json!(2.5)), "2.5");
        assert!(py_num_eq(&json!(true), 1) && py_num_eq(&json!(1.0), 1));
        assert_eq!(live_type("message.part.updated.1"), "message.part.updated");
        assert_eq!(live_type("session.idle"), "session.idle");
        assert_eq!(strip_mcp_prefix("o2_"), "o2_");
        assert_eq!(
            strip_mcp_prefix("o2_correlate_streams"),
            "correlate_streams"
        );
    }

    #[test]
    fn a_2x_shell_call_is_hidden_in_chat_but_stays_an_rca_row() {
        let mut events =
            crate::ai_chat::record_v2::tests::golden_events("v2_user_text_and_tools.json");
        let projected = project(&events).to_string();
        assert!(projected.contains("tool_call"), "{projected}");
        events[2].data["message"]["content"][0]["name"] = json!("shell");
        let projected = project(&events).to_string();
        assert!(!projected.contains("tool_call"), "{projected}");
        assert_eq!(
            crate::ai_chat::rca_thread::ThreadPart::of("shell", "completed", None),
            crate::ai_chat::rca_thread::ThreadPart::Row
        );
    }

    /// A log without 2.x records keeps log order even where creation times disagree.
    #[test]
    fn only_a_log_with_2x_records_is_ordered_by_creation() {
        let (events, expected) = load("structure.json");
        let created: Vec<&Value> = expected["turns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| &t["created"])
            .collect();
        assert!(
            created.windows(2).any(|w| w[0].as_i64() > w[1].as_i64()),
            "{created:?}"
        );
        let mut mixed = events.clone();
        mixed.push(DurableEvent {
            id: "evt_x".into(),
            aggregate_id: events[0].aggregate_id.clone(),
            seq: events.last().unwrap().seq + 1,
            event_type: SESSION_UPDATED.into(),
            data: json!({"info": {"title": "Pool exhaustion"}}),
        });
        let sorted = project(&mixed);
        let created: Vec<Option<i64>> = sorted["turns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["created"].as_i64())
            .collect();
        assert_eq!(
            created,
            [Some(1), Some(1), Some(1), Some(1), Some(99), None]
        );
        assert_eq!(sorted["title"], "Pool exhaustion");
    }
}
