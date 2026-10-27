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

use std::{collections::HashMap, sync::LazyLock};

use config::{
    meta::oncall::confidence::strip_call_ref,
    utils::{
        json::{Map, Value, json},
        redact::redact_internal_details,
    },
};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
use regex::{NoExpand, Regex};

const PLACEHOLDER_TITLE_PREFIXES: [&str; 2] = ["New session - ", "Child session - "];
const INJECTED_KEY: &str = "o2_injected";
const ABORTED_ERROR: &str = "MessageAbortedError";
const DEFAULT_TURN_ERROR: &str = "The assistant failed to respond";

const FLUSH_CHARS: usize = 80;
const FLUSH_BREAKS: [char; 4] = ['.', '!', '?', '\n'];
const STREAM_HOLDBACK_WORDS: usize = 3;
const STREAM_CARRY_MAX: usize = 4096;
const STREAM_HOLDBACK: usize = 48;

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

/// Tools no projection shows; the sentinels at the end are RCA thread structure.
pub(crate) const HIDDEN_TOOLS: [&str; 25] = [
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

static NONCED_OPENER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^--- (.+?) \[([a-z2-7]{8})\] ---$").expect("valid opener"));
static NONCED_CLOSER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^--- end \[([a-z2-7]{8})\] ---$").expect("valid closer"));
static LEGACY_OPENER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^--- (.+?) (?:\(lines \d+-\d+\) )?---$").expect("valid legacy opener")
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
}

impl StreamState {
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
        let matched = if call_id.is_empty() {
            None
        } else {
            self.pending_tool_calls.remove(call_id)
        }
        .or_else(|| self.last_tools_call_info.clone());

        let result = if is_error {
            let err = tool_state
                .get("error")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let message = extract_error_message(&err);
            // o2-ai denies some permissions on purpose; their failures are not shown.
            if is_permission_rejection(&message) {
                self.pending_tool_calls.remove(call_id);
                self.last_tools_call_info = None;
                return;
            }
            let error_type = match &err {
                Value::Object(m) => m.get("name").cloned().unwrap_or(Value::Null),
                _ => Value::String("ToolError".into()),
            };
            let mut result = Map::new();
            result.insert("error".into(), Value::Bool(true));
            result.insert("error_type".into(), error_type);
            result.insert("message".into(), Value::String(message));
            result
        } else {
            let metadata = tool_state
                .get("metadata")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let result = coerce_tool_output(tool_state.get("output"), metadata);
            if let Some(confirmation) = delete_confirmation_frame(&result, tool_name, call_id) {
                self.last_tools_call_info = None;
                frames.push(confirmation);
                return;
            }
            if let Some(navigation) = navigation_frame(&result, tool_name) {
                self.last_tools_call_info = None;
                frames.push(navigation);
                return;
            }
            result
        };

        let Some(mut event) =
            format_tool_result_event(tool_name, &result, is_error, matched.as_ref())
        else {
            return;
        };
        if !call_id.is_empty() {
            event.insert("call_id".into(), Value::String(call_id.to_string()));
        }
        self.last_tools_call_info = None;
        frames.push(Value::Object(event));
    }
}

/// One turn being projected: a user message and the assistant messages answering it.
#[derive(Default)]
struct Turn {
    user_message_id: Value,
    created: Value,
    user_parts: Vec<(String, bool)>,
    images: Vec<Value>,
    frames: Vec<Value>,
    state: StreamState,
    error: Option<String>,
    aborted: bool,
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
                    self.user_parts.push((text.to_string(), is_injected(part)));
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
        for part in parts.values().filter_map(Value::as_object) {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                    let hidden = part.get("synthetic").is_some_and(truthy)
                        || part.get("ignored").is_some_and(truthy);
                    if !text.is_empty() && !hidden {
                        self.state.emit_text_delta(text, &mut self.frames);
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
                self.error = Some(message.map_or_else(|| DEFAULT_TURN_ERROR.to_string(), py_str));
            }
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
        }
        let terminal = if self.aborted {
            "cancelled"
        } else {
            "complete"
        };
        self.frames.push(json!({"type": terminal}));
        let text = self.user_text();
        json!({
            "user_message_id": self.user_message_id,
            "created": self.created,
            "user": {"text": text, "images": self.images},
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
    pub(crate) fn fold(events: &[DurableEvent]) -> Self {
        let mut folded = Folded {
            last_seq: -1,
            ..Default::default()
        };
        for event in events {
            folded.last_seq = folded.last_seq.max(event.seq);
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
    let folded = Folded::fold(events);
    let empty = Map::new();
    let mut turns: Map<String, Value> = Map::new();
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
        turns.insert(msg_id.clone(), Value::from(projected.len()));
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
        if let Some(index) = turns.get(&parent).and_then(Value::as_u64) {
            let turn = &mut projected[index as usize];
            turn.cover(folded.spans.get(msg_id));
            turn.project_assistant_message(info, folded.parts.get(msg_id).unwrap_or(&empty));
        }
    }

    let turns: Vec<Value> = projected.into_iter().map(Turn::into_value).collect();
    json!({"turns": turns, "title": folded.title, "last_seq": folded.last_seq})
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

/// The call id (maybe empty) of a delete the agent asked the user to confirm in this event.
pub fn delete_confirmation_call(event_type: &str, data: &Value) -> Option<String> {
    if live_type(event_type) != "message.part.updated" {
        return None;
    }
    let part = obj(data.get("part"))?;
    let state = obj(part.get("state"))?;
    if state.get("status").and_then(Value::as_str) != Some("completed") {
        return None;
    }
    let tool = part.get("tool").and_then(Value::as_str).unwrap_or_default();
    let metadata = state
        .get("metadata")
        .filter(|v| truthy(v))
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let result = coerce_tool_output(state.get("output"), metadata);
    is_delete_confirmation(&result, tool).then(|| {
        [part.get("callID"), part.get("id")]
            .into_iter()
            .flatten()
            .find(|v| truthy(v))
            .map(py_str)
            .unwrap_or_default()
    })
}

/// The stored turns as `audience` reads them; every viewer audience is model-name scrubbed.
pub fn for_audience(turns: &mut [Value], audience: Audience, view: &ReaderView<'_>) {
    if audience == Audience::Owner {
        return;
    }
    if audience == Audience::ViewerRedacted {
        redact_turns(turns);
    }
    for turn in turns.iter_mut() {
        keep_inline_images(turn);
        if view.hide_attachments {
            hide_attachments(turn);
        }
        let Some(Value::Array(frames)) = turn.get_mut("frames") else {
            scrub_value(turn, 0);
            continue;
        };
        for frame in frames.iter_mut() {
            let hidden = frame
                .get("call_id")
                .and_then(Value::as_str)
                .is_some_and(|id| view.hidden.is_some_and(|h| h.contains_key(id)));
            if hidden {
                redact_frame(frame);
            }
            keep_decision_only(frame);
        }
        scrub_value(turn, 0);
    }
}

/// `text` with model ids replaced the way viewer transcripts read them.
pub fn scrub_model_names(text: &str) -> String {
    let (pattern, replacement) = &*MODEL_NAME;
    pattern
        .replace_all(text, NoExpand(replacement.as_str()))
        .into_owned()
}

/// A user message's typed text and its attachment block names, as the web client splits them.
pub fn split_attachment_blocks(text: &str) -> (String, Vec<String>) {
    let nonced = split_nonced_blocks(text);
    if !nonced.1.is_empty() {
        return nonced;
    }
    let names: Vec<String> = LEGACY_BLOCK
        .captures_iter(text)
        .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .collect();
    let rest = LEGACY_BLOCK.replace_all(text, "");
    (rest.trim().to_string(), names)
}

/// `text` with every attachment block, parsed or not, replaced by `[Attached {kind} hidden]`.
pub fn hide_attachment_blocks(text: &str) -> String {
    let (typed, mut names) = split_attachment_blocks(text);
    let (typed, unparsed) = cut_at_block_opener(&typed);
    if let Some(name) = unparsed {
        names.insert(0, name);
    }
    if names.is_empty() {
        return text.to_string();
    }
    let markers: Vec<String> = names
        .iter()
        .map(|name| {
            let kind = name.strip_suffix(TRUNCATED_SUFFIX).unwrap_or(name);
            format!("[Attached {} hidden]", kind.to_lowercase())
        })
        .collect();
    [typed, markers.join("\n")]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `(call_id, (type, stream))` per stream a data step reads; `None` when it cannot be told.
pub fn step_streams(turns: &[Value]) -> Vec<(String, Option<(String, String)>)> {
    let mut steps = Vec::new();
    for frame in turns
        .iter()
        .filter_map(|t| t.get("frames").and_then(Value::as_array))
        .flatten()
        .filter(|f| f.get("type").and_then(Value::as_str) == Some("tool_call"))
    {
        let Some(call_id) = frame.get("call_id").and_then(Value::as_str) else {
            continue;
        };
        let tool = frame
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if STREAMLESS_TOOLS.contains(&tool) {
            continue;
        }
        let places = obj(frame.get("context"))
            .map(step_places)
            .unwrap_or_default();
        if places.is_empty() {
            steps.push((call_id.to_string(), None));
        }
        steps.extend(places.into_iter().map(|p| (call_id.to_string(), Some(p))));
    }
    steps
}

/// Inserts a `confirmation_resolved` frame after the request each recorded decision answers.
pub fn attach_decisions(turn: &mut Value, decisions: &[Value]) {
    let Some(Value::Array(frames)) = turn.get_mut("frames") else {
        return;
    };
    for (n, decision) in decisions.iter().filter_map(Value::as_object).enumerate() {
        let id = decision
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        let resolved: Vec<&str> = frames
            .iter()
            .filter(|f| frame_type(f) == CONFIRMATION_RESOLVED)
            .filter_map(|f| f.get("id").and_then(Value::as_str))
            .collect();
        let unanswered = |f: &Value| {
            frame_type(f) == CONFIRMATION_REQUIRED
                && f.get("id")
                    .and_then(Value::as_str)
                    .is_none_or(|fid| !resolved.contains(&fid))
        };
        // Live ids may differ from projected ones, so an unmatched id takes the oldest open one.
        let asked = id
            .and_then(|id| {
                frames.iter().position(|f| {
                    frame_type(f) == CONFIRMATION_REQUIRED
                        && f.get("id").and_then(Value::as_str) == Some(id)
                })
            })
            .or_else(|| frames.iter().position(unanswered));
        let at = match asked {
            Some(i) => {
                i + 1
                    + frames[i + 1..]
                        .iter()
                        .take_while(|f| frame_type(f) == CONFIRMATION_RESOLVED)
                        .count()
            }
            None => frames.len() - trailing_terminal(frames),
        };
        let frame = resolved_frame(decision, asked.map(|i| &mut frames[i]), n);
        frames.insert(at, frame);
    }
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

/// Streams a step's input names: explicit name keys, else the tables of its SQL.
fn context_streams(context: &Map<String, Value>) -> Vec<String> {
    let named: Vec<String> = STREAM_NAME_KEYS
        .iter()
        .filter_map(|k| context.get(*k).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if !named.is_empty() {
        return named;
    }
    let Some(sql) = context.get("sql").and_then(Value::as_str) else {
        return Vec::new();
    };
    let mut streams = config::meta::sql::resolve_stream_names(sql).unwrap_or_default();
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

fn resolve_tool_call(
    tool_name: &str,
    args: &Map<String, Value>,
) -> Option<(String, Map<String, Value>)> {
    let tool_name = strip_mcp_prefix(tool_name);
    if HIDDEN_TOOLS.contains(&tool_name) {
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
    if HIDDEN_TOOLS.contains(&tool_name) {
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
    if is_error {
        let (message, error_type) = parse_error(&response_body, Some(result));
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
fn py_str(value: &Value) -> String {
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
    fn a_delete_confirmation_sentinel_names_its_call() {
        let sentinel = json!({"type": "delete_confirmation", "resource_type": "alert", "id": "a1"});
        let part = |tool: &str, status: &str| {
            json!({"part": {"id": "prt_1", "callID": "call_9", "tool": tool,
                "state": {"status": status, "output": sentinel.to_string()}}})
        };
        let updated = "message.part.updated.1";
        assert_eq!(
            delete_confirmation_call(updated, &part("o2_delete", "completed")).as_deref(),
            Some("call_9")
        );
        assert_eq!(
            delete_confirmation_call(updated, &part("o2_delete", "running")),
            None
        );
        assert_eq!(
            delete_confirmation_call(updated, &part("SearchSQL", "completed")),
            None
        );
        assert_eq!(
            delete_confirmation_call("message.updated.1", &part("o2_delete", "completed")),
            None
        );
    }

    /// What the web client's rendered record and the server's frames must agree on.
    #[derive(Debug, Default, PartialEq)]
    struct Transcript {
        user: Vec<String>,
        answers: Vec<String>,
        steps: Vec<(String, String, bool)>,
        approvals: Vec<(Option<String>, bool, Option<u64>)>,
        decisions: Vec<(String, bool)>,
        links: usize,
    }

    impl Transcript {
        fn of_frames(turns: &[Value]) -> Self {
            let mut out = Self::default();
            for turn in turns {
                if let Some(text) = turn["user"]["text"].as_str() {
                    out.user.push(text.to_string());
                }
                let mut answer = String::new();
                for frame in turn["frames"].as_array().unwrap() {
                    out.add_frame(frame, &mut answer);
                }
                if !answer.is_empty() {
                    out.answers.push(answer);
                }
            }
            out
        }

        fn add_frame(&mut self, frame: &Value, answer: &mut String) {
            let call_id = frame["call_id"].as_str().unwrap_or_default().to_string();
            let tool = frame["tool"].as_str().unwrap_or_default().to_string();
            match frame_type(frame) {
                "message_delta" => answer.push_str(frame["content"].as_str().unwrap()),
                "tool_call" | "tool_result" if !self.steps.iter().any(|s| s.0 == call_id) => {
                    let context = frame["context"].as_object().is_some_and(|c| !c.is_empty());
                    self.steps.push((call_id, tool, context));
                }
                CONFIRMATION_REQUIRED => self.approvals.push((
                    frame["id"].as_str().map(str::to_string),
                    frame.get("args").is_some(),
                    frame["total"].as_u64(),
                )),
                CONFIRMATION_RESOLVED => self.decisions.push((
                    frame["id"].as_str().unwrap().to_string(),
                    frame["approved"].as_bool().unwrap(),
                )),
                "navigation_action" => self.links += 1,
                _ => {}
            }
        }

        fn of_messages(messages: &[Value]) -> Self {
            let mut out = Self::default();
            for message in messages {
                let content = message["content"].as_str().unwrap_or_default().to_string();
                match message["role"].as_str() {
                    Some("user") => out.user.push(content),
                    _ if !content.is_empty() => out.answers.push(content),
                    _ => {}
                }
                for block in message["contentBlocks"].as_array().into_iter().flatten() {
                    out.add_block(block);
                }
            }
            out
        }

        fn add_block(&mut self, block: &Value) {
            match block["type"].as_str().unwrap_or_default() {
                "tool_call" => self.steps.push((
                    block["call_id"].as_str().unwrap_or_default().to_string(),
                    block["tool"].as_str().unwrap_or_default().to_string(),
                    block["context"].as_object().is_some_and(|c| !c.is_empty()),
                )),
                "approval" => self.approvals.push((
                    block["approval"]["id"].as_str().map(str::to_string),
                    block["approval"].get("args").is_some(),
                    block["approval"]["total"].as_u64(),
                )),
                "approval_result" => self.decisions.push((
                    block["resolved"]["id"].as_str().unwrap().to_string(),
                    block["resolved"]["approved"].as_bool().unwrap(),
                )),
                "link" => self.links += 1,
                _ => {}
            }
        }
    }

    fn assistant_web_dir() -> std::path::PathBuf {
        std::env::var_os("O2_ASSISTANT_WEB_DIR").map_or_else(
            || {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../web/src/composables/assistant")
            },
            Into::into,
        )
    }

    fn read_json(path: &std::path::Path) -> Value {
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
        config::utils::json::from_str(&text).unwrap_or_else(|e| panic!("{path:?}: {e}"))
    }

    #[test]
    fn every_record_fixture_projects_like_the_web_client() {
        let root = assistant_web_dir().join("__fixtures__/record");
        let Ok(entries) = std::fs::read_dir(&root) else {
            assert!(
                std::env::var_os("CI").is_none(),
                "no record fixtures at {root:?}"
            );
            eprintln!("skipped: no record fixtures at {root:?} (set O2_ASSISTANT_WEB_DIR)");
            return;
        };
        let mut cases: Vec<_> = entries
            .filter_map(Result::ok)
            .filter(|e| e.path().is_dir())
            .map(|e| e.path())
            .collect();
        cases.sort();
        assert!(cases.len() >= 9, "{cases:?}");
        let audiences = [
            ("owner.json", Audience::Owner, false),
            ("viewer.json", Audience::Viewer, true),
            ("viewer-redacted.json", Audience::ViewerRedacted, true),
            ("export.json", Audience::Viewer, false),
        ];
        for case in &cases {
            let input = read_json(&case.join("frames.json"));
            for (file, audience, with_hidden) in audiences {
                let mut turns = input["turns"].as_array().unwrap().clone();
                let view = ReaderView {
                    hidden: input["hidden"].as_object().filter(|_| with_hidden),
                    hide_attachments: false,
                };
                for_audience(&mut turns, audience, &view);
                let mut actual = Transcript::of_frames(&turns);
                let messages = read_json(&case.join(file));
                let mut expected = Transcript::of_messages(messages.as_array().unwrap());
                // Request ids the server never had are the client's own.
                for (want, got) in expected.approvals.iter_mut().zip(&actual.approvals) {
                    if got.0.is_none() {
                        want.0 = None;
                    }
                }
                if audience == Audience::ViewerRedacted {
                    let links = turns
                        .iter()
                        .flat_map(|t| t["frames"].as_array().unwrap())
                        .filter(|f| frame_type(f) == NAVIGATION_ACTION);
                    for link in links {
                        let keys = link.as_object().unwrap().keys();
                        let allowed = ["type", "resource_type", "action", "label"];
                        assert!(
                            keys.clone().all(|k| allowed.contains(&k.as_str())),
                            "{case:?}"
                        );
                    }
                } else {
                    for approval in expected.approvals.iter_mut().chain(&mut actual.approvals) {
                        approval.2 = None;
                    }
                }
                assert_eq!(actual, expected, "{case:?} {file}");
                if audience == Audience::ViewerRedacted {
                    let approvals = turns
                        .iter()
                        .flat_map(|t| t["frames"].as_array().unwrap())
                        .filter(|f| frame_type(f) == CONFIRMATION_REQUIRED);
                    for approval in approvals {
                        let keys = approval.as_object().unwrap().keys();
                        let allowed = ["type", "id", "kind", "total"];
                        assert!(
                            keys.clone().all(|k| allowed.contains(&k.as_str())),
                            "{case:?}"
                        );
                    }
                }
                if audience != Audience::Owner {
                    let dumped = Value::Array(turns).to_string();
                    assert!(!MODEL_NAME.0.is_match(&dumped), "{case:?} {file}: {dumped}");
                }
            }
        }
    }

    #[test]
    fn scrub_terms_match_the_web_client() {
        let path = assistant_web_dir().join("record.ts");
        let Ok(source) = std::fs::read_to_string(&path) else {
            assert!(std::env::var_os("CI").is_none(), "no {path:?}");
            eprintln!("skipped: no {path:?} (set O2_ASSISTANT_WEB_DIR)");
            return;
        };
        let start = source.find(r"/\b(?:").expect("MODEL_NAME in record.ts") + 6;
        let end = start + source[start..].find(r")\b/gi").expect("MODEL_NAME end");
        let terms: Value = config::utils::json::from_str(SCRUB_TERMS_JSON).unwrap();
        let ours: Vec<&str> = terms["patterns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        assert_eq!(
            source[start..end],
            ours.join("|"),
            "scrub_terms.json drifted"
        );
    }

    #[test]
    fn viewers_read_no_model_names_and_owners_read_them_as_stored() {
        let stored = json!([{
            "user": {"text": "Is claude-3-5-sonnet better than GPT-4o?"},
            "frames": [
                {"type": "usage", "usage": {"tokens_in": 1}, "model": "gpt-4o-mini"},
                {"type": "message_delta", "content": "I run on gemini-1.5-pro."},
                {"type": "tool_call", "tool": "llama_tool", "call_id": "gpt-4o", "message": "o3-mini"},
            ],
        }]);
        let mut owner = stored.as_array().unwrap().clone();
        for_audience(&mut owner, Audience::Owner, &ReaderView::default());
        assert_eq!(Value::Array(owner), stored);
        let mut viewer = stored.as_array().unwrap().clone();
        for_audience(&mut viewer, Audience::Viewer, &ReaderView::default());
        assert_eq!(
            viewer[0]["user"]["text"],
            "Is the model better than the model?"
        );
        assert_eq!(viewer[0]["frames"][0].get("model"), None);
        assert_eq!(viewer[0]["frames"][1]["content"], "I run on the model.");
        assert_eq!(viewer[0]["frames"][2]["tool"], "llama_tool");
        assert_eq!(viewer[0]["frames"][2]["call_id"], "gpt-4o");
        assert_eq!(viewer[0]["frames"][2]["message"], "the model");
        assert_eq!(
            scrub_model_names("o11y and mistralai"),
            "o11y and the model"
        );
    }

    #[test]
    fn a_delete_awaiting_approval_is_kept_as_its_request() {
        let (events, _) = load("tool_heavy.json");
        let projected = project(&events);
        let asked: Vec<&Value> = projected["turns"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|t| t["frames"].as_array().unwrap())
            .filter(|f| f["type"] == CONFIRMATION_REQUIRED)
            .collect();
        assert_eq!(asked.len(), 1, "{asked:?}");
        assert_eq!(asked[0]["tool"], O2_DELETE_TOOL);
        assert_eq!(asked[0]["args"]["items"][0]["id"], "a1");
        assert_eq!(
            asked[0]["message"],
            "Do you really want to delete the \"A\" alert?"
        );
        let mut redacted = projected["turns"].as_array().unwrap().clone();
        for_audience(
            &mut redacted,
            Audience::ViewerRedacted,
            &ReaderView::default(),
        );
        let kept = redacted
            .iter()
            .flat_map(|t| t["frames"].as_array().unwrap())
            .find(|f| f["type"] == CONFIRMATION_REQUIRED)
            .unwrap();
        let id = asked[0]["id"].clone();
        assert_eq!(
            kept,
            &json!({"type": CONFIRMATION_REQUIRED, "id": id, "kind": "delete", "total": 1})
        );
        let mut update = json!({"type": CONFIRMATION_REQUIRED, "id": "apr_2", "tool": "o2_update",
            "kind": "update", "operation": "Update 1 alert", "message": "Update checkout?",
            "targets": [{"type": "alert", "id": "a_1", "name": "checkout"}], "diff": "x",
            "before": {"t": 1}, "after": {"t": 2}});
        redact_frame(&mut update);
        assert_eq!(
            update,
            json!({"type": CONFIRMATION_REQUIRED, "id": "apr_2", "kind": "update", "total": 1})
        );
    }

    #[test]
    fn decisions_reattach_after_the_request_they_answer() {
        let mut turn = json!({"frames": [
            {"type": "confirmation_required", "id": "apr_1", "tool": "o2_delete"},
            {"type": "confirmation_required", "tool": "UpdateDashboard"},
            {"type": "message_delta", "content": "done"},
            {"type": "complete"},
        ]});
        let decisions = [
            json!({"id": "unknown-live-id", "approved": false, "by": "a@x", "at": 5}),
            json!({"id": "apr_1", "approved": true, "by": "a@x", "at": 4, "scope": "once"}),
            json!({"approved": true, "by": "a@x", "at": 6}),
        ];
        attach_decisions(&mut turn, &decisions);
        let kinds: Vec<(&str, &str)> = turn["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (frame_type(f), f["id"].as_str().unwrap_or_default()))
            .collect();
        assert_eq!(
            kinds,
            [
                (CONFIRMATION_REQUIRED, "apr_1"),
                (CONFIRMATION_RESOLVED, "apr_1"),
                (CONFIRMATION_RESOLVED, "apr_1"),
                (CONFIRMATION_REQUIRED, "decision-2"),
                (CONFIRMATION_RESOLVED, "decision-2"),
                ("message_delta", ""),
                ("complete", ""),
            ]
        );
        assert_eq!(turn["frames"][2]["scope"], "once");
        let mut viewer = vec![turn];
        for_audience(&mut viewer, Audience::Viewer, &ReaderView::default());
        let keys: Vec<&String> = viewer[0]["frames"][2].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["type", "id", "approved", "at"]);
        let mut empty = json!({"frames": [{"type": "complete"}]});
        attach_decisions(&mut empty, &[json!({"id": "x", "approved": true})]);
        assert_eq!(empty["frames"][0]["type"], CONFIRMATION_RESOLVED);
    }

    #[test]
    fn hidden_steps_and_attachments_never_reach_the_reader() {
        let text = "Why?\n\n--- Log rows [abcdefgh] ---\n\"card 4111\"\n--- end [abcdefgh] ---\n--- Span (truncated) [abcdefgh] ---\n{}\n--- end [abcdefgh] ---";
        assert_eq!(
            split_attachment_blocks(text),
            (
                "Why?".to_string(),
                vec!["Log rows".to_string(), "Span (truncated)".to_string()]
            )
        );
        let mut turns = vec![json!({
            "user": {"text": text, "images": [{"filename": "a.png", "url": "data:image/png;base64,AA"}]},
            "frames": [
                {"type": "tool_call", "tool": "SearchSQL", "call_id": "c1", "context": {"sql": "SELECT * FROM payments_audit"}},
                {"type": "tool_result", "tool": "SearchSQL", "call_id": "c1", "success": true, "summary": "3 rows about card 4111"},
                {"type": "tool_call", "tool": "SearchSQL", "call_id": "c2", "context": {"stream_name": "default", "stream_type": "traces"}},
            ],
        })];
        let place = |t: &str, s: &str| Some((t.to_string(), s.to_string()));
        assert_eq!(
            step_streams(&turns),
            [
                ("c1".to_string(), place("logs", "payments_audit")),
                ("c2".to_string(), place("traces", "default")),
            ]
        );
        let hidden = json!({"c1": {"reason": "stream_forbidden", "stream": "payments_audit"}});
        let view = ReaderView {
            hidden: hidden.as_object(),
            hide_attachments: true,
        };
        for_audience(&mut turns, Audience::Viewer, &view);
        let dumped = Value::Array(turns.clone()).to_string();
        assert!(
            !dumped.contains("4111") && !dumped.contains("payments_audit"),
            "{dumped}"
        );
        assert_eq!(
            turns[0]["user"]["text"],
            "Why?\n\n[Attached log rows hidden]\n[Attached span hidden]"
        );
        assert_eq!(turns[0]["user"]["images"], json!([]));
        assert_eq!(turns[0]["frames"][2]["context"]["stream_name"], "default");
        let legacy = "See\n--- Log Entry ---\n{\"a\":1}\n--- end ---";
        assert_eq!(
            hide_attachment_blocks(legacy),
            "See\n\n[Attached log entry hidden]"
        );
        assert_eq!(hide_attachment_blocks("plain"), "plain");
        let unclosed = "Why?\n--- Log rows [abcdefgh] ---\nrow 1\nrow 2 card 4111";
        assert_eq!(
            hide_attachment_blocks(unclosed),
            "Why?\n\n[Attached log rows hidden]"
        );
        let multi_line = "See\n--- Span ---\n{\n}\n--- end ---\nthen\n--- Log rows ---\nsecret";
        let hidden = hide_attachment_blocks(multi_line);
        assert!(
            !hidden.contains("secret") && hidden.starts_with("See"),
            "{hidden}"
        );
    }

    #[test]
    fn steps_whose_streams_cannot_be_told_are_unplaced() {
        let turns = vec![json!({"frames": [
            {"type": "tool_call", "tool": "PrometheusQuery", "call_id": "p1", "context": {"query": "rate(http_requests_total[5m])"}},
            {"type": "tool_call", "tool": "correlate_streams", "call_id": "k1", "context": {"service": "checkout"}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "s1", "context": {"sql": "SELEC nonsense ((("}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "s2", "context": {"stream_name": "e1", "stream_type": "enrichment_tables"}},
            {"type": "tool_call", "tool": "SearchSQL", "call_id": "s3"},
            {"type": "tool_call", "tool": "StreamSchema", "call_id": "m1", "context": {"stream_name": "cpu", "type": "metrics"}},
            {"type": "tool_call", "tool": "StreamList", "call_id": "l1", "context": {}},
            {"type": "tool_call", "tool": "ListAlerts", "call_id": "l2"},
        ]})];
        let steps = step_streams(&turns);
        let unplaced: Vec<&str> = steps
            .iter()
            .filter(|(_, p)| p.is_none())
            .map(|(id, _)| id.as_str())
            .collect();
        assert_eq!(unplaced, ["p1", "k1", "s1", "s2", "s3"]);
        assert!(steps.contains(&(
            "m1".to_string(),
            Some(("metrics".to_string(), "cpu".to_string()))
        )));
        assert!(!steps.iter().any(|(id, _)| id.starts_with('l')));
    }
}
