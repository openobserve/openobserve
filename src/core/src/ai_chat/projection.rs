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

use config::utils::json::{Map, Value, json};
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

const SESSION_ARG: &str = "_o2_session";
const NAVIGATION_TOOL: &str = "create_navigation";
const FIRST_PARTY_MCP_PREFIX: &str = "o2_";
const O2_DELETE_TOOL: &str = "o2_delete";
const MCP_SERVER_PREFIXES: [&str; 1] = ["o2"];
const SEARCH_SQL_MAX_HITS: usize = 10;
const TEST_FUNCTION_MAX_INPUT_EVENTS: usize = 5;
const TEST_FUNCTION_MAX_OUTPUT_RESULTS: usize = 5;
const ERROR_DUMP_CHARS: usize = 500;
const FIRST_ERR_CHARS: usize = 200;

const HIDDEN_TOOLS: [&str; 19] = [
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

// Order matters: paths collapse before the bare-word runtime rule rewrites them.
static INTERNAL_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"/data/opencode-workspaces[\w./-]*", "[internal path]"),
        (r"/home/appuser[\w./-]*", "[internal path]"),
        (r"~?/\.config/opencode[\w./-]*", "[internal path]"),
        (r"\bnats://[\w.:@-]+", "[internal endpoint]"),
        (
            r"\bhttps?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?[\w./-]*",
            "[internal endpoint]",
        ),
        (
            r"(?i)\b(?:the\s+)?opencode(?:\s+(?:runtime|server|agent))?\b",
            "the agent runtime",
        ),
        (r"(?i)\bbubblewrap\b", "the sandbox"),
        (r"(?i)\bbwrap\b", "the sandbox"),
        (r"(?i)\bappuser\b", "the service account"),
        (r"(?i)\bDataFusion\b", "the query engine"),
        (
            r"\b(?:arrow_schema|sqlparser|datafusion)::[\w:]+",
            "the query engine",
        ),
    ]
    .into_iter()
    .map(|(pattern, replacement)| (Regex::new(pattern).expect("valid pattern"), replacement))
    .collect()
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
            if is_delete_confirmation(&result, tool_name) {
                self.last_tools_call_info = None;
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
struct Folded {
    title: Option<String>,
    last_seq: i64,
    infos: Map<String, Value>,
    parts: HashMap<String, Map<String, Value>>,
    /// Message id to the `(min, max)` seq of the events about it.
    spans: HashMap<String, (i64, i64)>,
}

impl Folded {
    fn fold(events: &[DurableEvent]) -> Self {
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

/// K6: keep assistant text and tool names; drop tool data, navigation and provider error text.
pub fn redact_turns(turns: &mut [Value]) {
    for turn in turns {
        keep_inline_images(turn);
        if let Some(error) = turn.get_mut("error").filter(|e| !e.is_null()) {
            *error = Value::String(DEFAULT_TURN_ERROR.into());
        }
        let Some(Value::Array(frames)) = turn.get_mut("frames") else {
            continue;
        };
        frames.retain(|f| f.get("type").and_then(Value::as_str) != Some("navigation_action"));
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

fn redact_frame(frame: &mut Value) {
    let Some(map) = frame.as_object_mut() else {
        return;
    };
    let kind = map.get("type").and_then(Value::as_str).unwrap_or_default();
    if kind == "error" {
        map.insert("error".into(), Value::String(DEFAULT_TURN_ERROR.into()));
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
    }
    if let Some(call_id) = map.get("call_id") {
        kept.insert("call_id".into(), call_id.clone());
    }
    *map = kept;
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

fn is_injected(part: &Map<String, Value>) -> bool {
    obj(part.get("metadata"))
        .and_then(|m| m.get(INJECTED_KEY))
        .is_some_and(|v| py_num_eq(v, 1))
}

fn strip_mcp_prefix(tool_name: &str) -> &str {
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
fn extract_mcp_response(result: &Map<String, Value>) -> Value {
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

fn coerce_tool_output(output: Option<&Value>, metadata: Value) -> Map<String, Value> {
    let mut wrapped = Map::new();
    match output {
        Some(Value::Object(m)) => return m.clone(),
        Some(Value::String(text)) => {
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
            wrapped.insert("output".into(), Value::String(text.clone()));
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
    if tool_name != O2_DELETE_TOOL {
        return false;
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
    candidates.iter().any(|item| {
        let has_type = item.get("resource_type").is_some_and(truthy);
        let has_id = !matches!(item.get("id"), None | Some(Value::Null))
            && item.get("id").and_then(Value::as_str) != Some("");
        has_type && has_id
    })
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

fn extract_error_message(error: &Value) -> String {
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

/// Scrub internal-architecture details (runtime, paths, endpoints) from outbound text.
fn redact_internal_details(text: &str) -> String {
    let mut text = text.to_string();
    for (pattern, replacement) in INTERNAL_PATTERNS.iter() {
        if pattern.is_match(&text) {
            text = pattern
                .replace_all(&text, NoExpand(replacement))
                .into_owned();
        }
    }
    text
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

fn obj(value: Option<&Value>) -> Option<&Map<String, Value>> {
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
fn truthy(value: &Value) -> bool {
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
            let actual = project(&events);
            if let Some(diff) = first_difference("", &actual, &expected) {
                panic!("{name}: {diff}");
            }
        }
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
        assert!(frames.iter().all(|f| f["type"] != "navigation_action"));
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
                    assert_eq!(keys, ["type", "tool", "success", "message", "call_id"])
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
        assert_eq!(
            redact_internal_details("the opencode server at /home/appuser/x"),
            "the agent runtime at [internal path]"
        );
    }
}
