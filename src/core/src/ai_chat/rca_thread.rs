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

//! The investigation thread of an RCA run, projected from its chat session (TH29, TH33).

use config::utils::json::{Map, Value};
use infra::table::ai_chat_turns;
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
use serde::Serialize;
use utoipa::ToSchema;

use super::projection::{
    Folded, HIDDEN_TOOLS, SESSION_ARG, coerce_tool_output, extract_error_message,
    extract_mcp_response, is_injected, obj, strip_mcp_prefix, truthy,
};
use crate::redact::redact_internal_details;

const RECORD_STEP: &str = "record_step";
const SUBMIT_REPORT: &str = "submit_report";
const IMPLICIT_STEP_TITLE: &str = "Investigation";
/// The seven stages of the RCA protocol, in order; `stage_index` is the 1-based position (TH18).
pub(crate) const RCA_STAGES: [&str; 7] = [
    "context",
    "topology",
    "changes",
    "traces",
    "log_patterns",
    "metrics",
    "converge",
];

/// One of the seven stage names, else `None`.
pub(crate) fn rca_stage(stage: Option<&Value>) -> Option<&'static str> {
    let stage = stage?.as_str()?;
    RCA_STAGES.iter().copied().find(|s| *s == stage)
}

/// How one tool part counts in the thread (TH20, TH29). The projection and the live
/// observer (TH27) both count through this, so the live counts are the final ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThreadPart {
    /// A `record_step` that opens a step with this stage.
    Step(Option<&'static str>),
    /// A `record_step` the tool rejected (VE2): no step.
    FailedStep,
    /// A visible tool row; before any step it opens the implicit step.
    Row,
    /// A hidden tool or sentinel: no row.
    Hidden,
}

impl ThreadPart {
    /// `tool` is the unwrapped tool name, `status` the part's `state.status`.
    pub(crate) fn of(tool: &str, status: &str, stage: Option<&Value>) -> Self {
        match tool {
            RECORD_STEP if status == "error" => Self::FailedStep,
            RECORD_STEP => Self::Step(rca_stage(stage)),
            "" => Self::Hidden,
            name if HIDDEN_TOOLS.contains(&name) => Self::Hidden,
            _ => Self::Row,
        }
    }

    /// Whether this part, coming after `steps` steps, opens a step: a `record_step`, or the
    /// first row before any step (the implicit "Investigation" step).
    pub(crate) fn opens_step(self, steps: usize) -> bool {
        match self {
            Self::Step(_) => true,
            Self::Row => steps == 0,
            Self::FailedStep | Self::Hidden => false,
        }
    }
}

const NOTE_MAX_CHARS: usize = 1_000;
const STEP_TITLE_MAX_CHARS: usize = 80;
const KEY_ARG_MAX_BYTES: usize = 4 * 1024;
const OUTPUT_MAX_BYTES: usize = 16 * 1024;
const ERROR_MAX_CHARS: usize = 200;
const UNFINISHED_TOOL_ERROR: &str = "The run ended before this tool call finished";

/// Whether the run's chat transcript can be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Transcript {
    Available,
    Expired,
    None,
}

/// `GET .../rca/runs/{run_id}/thread` response.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct RcaThread {
    pub run_id: String,
    pub state_version: String,
    pub not_modified: bool,
    pub active: bool,
    pub transcript: Transcript,
    pub started: Option<ThreadStart>,
    pub steps: Vec<ThreadStep>,
    pub user_messages: Vec<ThreadUserMessage>,
    /// Questions to responders; Phase 4 fills them.
    #[schema(value_type = Vec<Object>)]
    pub questions: Vec<Value>,
    pub report_submitted: bool,
    pub stats: ThreadStats,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ThreadStart {
    /// Microseconds.
    pub at: Option<i64>,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ThreadStep {
    /// 1-based.
    pub index: u32,
    /// `null` for tool calls made before the first `record_step`.
    pub stage: Option<String>,
    pub title: String,
    pub started_at: Option<i64>,
    /// `null` while this is the open step of a live run.
    pub ended_at: Option<i64>,
    pub note: Option<String>,
    pub note_truncated: bool,
    pub citations: Vec<String>,
    pub from_steering: bool,
    pub tool_calls: Vec<ThreadToolCall>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallStatus {
    Ok,
    Error,
    Running,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ThreadToolCall {
    pub call_id: String,
    pub tool: String,
    pub key_arg: Option<String>,
    pub status: ToolCallStatus,
    pub started_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub result_summary: Option<String>,
    pub error: Option<String>,
    /// Only with the org setting `ai_rca_thread_tool_output` (TH34).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub input: Option<Value>,
    /// Only with the org setting `ai_rca_thread_tool_output`; at most 16 KB (TH34).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ThreadUserMessage {
    pub at: Option<i64>,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ToSchema)]
pub struct ThreadStats {
    pub steps: u32,
    pub tool_calls: u32,
    pub duration_ms: i64,
    pub tokens: ThreadTokens,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ToSchema)]
pub struct ThreadTokens {
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
    pub cache_read: u64,
}

impl RcaThread {
    /// A run without a readable transcript: a legacy run (no session) or an expired one.
    pub fn without_transcript(
        run_id: &str,
        state_version: String,
        active: bool,
        transcript: Transcript,
    ) -> Self {
        Self {
            run_id: run_id.to_string(),
            state_version,
            not_modified: false,
            active,
            transcript,
            started: None,
            steps: Vec::new(),
            user_messages: Vec::new(),
            questions: Vec::new(),
            report_submitted: false,
            stats: ThreadStats::default(),
        }
    }
}

/// TH31: `"{last_committed_seq}.{session.updated_at}.{run.updated_at}"`, plus `.io` while
/// the org shows tool input and output, so turning that setting off or on invalidates a
/// version a client holds.
pub fn state_version(
    last_committed_seq: i64,
    session_updated_at: i64,
    run_updated_at: i64,
    show_tool_io: bool,
) -> String {
    let io = if show_tool_io { ".io" } else { "" };
    format!("{last_committed_seq}.{session_updated_at}.{run_updated_at}{io}")
}

/// The thread of an RCA session (TH29). `run_id` and `state_version` are left empty for the
/// caller; `show_tool_io` adds raw tool `input`/`output` (TH34).
pub fn project_rca_thread(
    events: &[DurableEvent],
    turns: &[ai_chat_turns::Model],
    active: bool,
    show_tool_io: bool,
) -> RcaThread {
    let folded = Folded::fold(events);
    let mut builder = Builder {
        active,
        show_tool_io,
        ..Default::default()
    };
    let empty = Map::new();
    for (msg_id, info) in &folded.infos {
        let Some(info) = info.as_object() else {
            continue;
        };
        let time = obj(info.get("time"));
        builder.observe(time.and_then(|t| t.get("created")));
        builder.observe(time.and_then(|t| t.get("completed")));
        let parts = folded.parts.get(msg_id).unwrap_or(&empty);
        match info.get("role").and_then(Value::as_str) {
            Some("user") => {
                builder.user_message(time.and_then(|t| ms_to_us(t.get("created"))), parts)
            }
            Some("assistant") => {
                for part in parts.values().filter_map(Value::as_object) {
                    builder.assistant_part(part);
                }
            }
            _ => {}
        }
    }
    builder.finish(turns)
}

#[derive(Default)]
struct Builder {
    active: bool,
    show_tool_io: bool,
    started: Option<ThreadStart>,
    user_messages: Vec<ThreadUserMessage>,
    steps: Vec<StepAcc>,
    report_submitted: bool,
    tokens: ThreadTokens,
    first_ms: Option<i64>,
    last_ms: Option<i64>,
}

struct StepAcc {
    step: ThreadStep,
    /// Text since the step's last tool row.
    note: Vec<String>,
    last_end: Option<i64>,
}

impl Builder {
    fn observe(&mut self, ms: Option<&Value>) {
        let Some(ms) = ms.and_then(as_i64) else {
            return;
        };
        self.first_ms = Some(self.first_ms.map_or(ms, |f| f.min(ms)));
        self.last_ms = Some(self.last_ms.map_or(ms, |l| l.max(ms)));
    }

    fn user_message(&mut self, at: Option<i64>, parts: &Map<String, Value>) {
        let text = parts
            .values()
            .filter_map(Value::as_object)
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text") && !is_injected(p))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let text = text.trim().to_string();
        if self.started.is_none() {
            self.started = Some(ThreadStart { at, prompt: text });
        } else {
            self.user_messages.push(ThreadUserMessage { at, text });
        }
    }

    fn assistant_part(&mut self, part: &Map<String, Value>) {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => self.text_part(part),
            Some("tool") => self.tool_part(part),
            Some("step-finish") => self.add_tokens(part),
            _ => {}
        }
    }

    fn text_part(&mut self, part: &Map<String, Value>) {
        let time = obj(part.get("time"));
        self.observe(time.and_then(|t| t.get("start")));
        self.observe(time.and_then(|t| t.get("end")));
        let hidden =
            part.get("synthetic").is_some_and(truthy) || part.get("ignored").is_some_and(truthy);
        let text = part
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if hidden || text.is_empty() {
            return;
        }
        if let Some(step) = self.steps.last_mut() {
            step.note.push(text.to_string());
            step.extend(time.and_then(|t| ms_to_us(t.get("end"))));
        }
    }

    fn add_tokens(&mut self, part: &Map<String, Value>) {
        let Some(tokens) = obj(part.get("tokens")) else {
            return;
        };
        let count = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
        self.tokens.input += count(tokens.get("input"));
        self.tokens.output += count(tokens.get("output"));
        self.tokens.reasoning += count(tokens.get("reasoning"));
        self.tokens.cache_read += count(obj(tokens.get("cache")).and_then(|c| c.get("read")));
    }

    fn tool_part(&mut self, part: &Map<String, Value>) {
        let empty = Map::new();
        let state = obj(part.get("state")).unwrap_or(&empty);
        let time = obj(state.get("time"));
        self.observe(time.and_then(|t| t.get("start")));
        self.observe(time.and_then(|t| t.get("end")));
        let started_at = time.and_then(|t| ms_to_us(t.get("start")));
        let ended_at = time.and_then(|t| ms_to_us(t.get("end")));
        let status = state
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();

        let raw_name = part.get("tool").and_then(Value::as_str).unwrap_or_default();
        let mut input: Map<String, Value> = obj(state.get("input"))
            .map(|i| {
                i.iter()
                    .filter(|(k, _)| k.as_str() != SESSION_ARG)
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default();
        let mut tool = strip_mcp_prefix(raw_name).to_string();
        if tool == "tools_call" {
            tool = strip_mcp_prefix(
                input
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
            .to_string();
            input = obj(input.get("args")).cloned().unwrap_or_default();
        }

        let kind = ThreadPart::of(&tool, status, input.get("stage"));
        match kind {
            ThreadPart::Step(stage) => {
                self.open_step(stage, input.get("title"), started_at, ended_at);
                return;
            }
            ThreadPart::FailedStep => return,
            ThreadPart::Hidden => {
                if tool == SUBMIT_REPORT && status == "completed" {
                    self.report_submitted = true;
                }
                return;
            }
            ThreadPart::Row => {}
        }

        let (status, result_summary, error) = match status {
            "completed" => (ToolCallStatus::Ok, Some(result_summary(state)), None),
            "error" => (
                ToolCallStatus::Error,
                None,
                Some(error_text(state.get("error"))),
            ),
            _ if self.active => (ToolCallStatus::Running, None, None),
            _ => (
                ToolCallStatus::Error,
                None,
                Some(UNFINISHED_TOOL_ERROR.to_string()),
            ),
        };
        let call_id = [part.get("callID"), part.get("id")]
            .into_iter()
            .flatten()
            .find_map(|v| v.as_str().filter(|s| !s.is_empty()))
            .unwrap_or_default()
            .to_string();
        let (input_out, output) = if self.show_tool_io {
            (Some(Value::Object(input.clone())), raw_output(state))
        } else {
            (None, None)
        };
        let row = ThreadToolCall {
            call_id,
            key_arg: key_arg(&tool, &input),
            tool,
            status,
            started_at,
            duration_ms: started_at.zip(ended_at).map(|(s, e)| (e - s) / 1000),
            result_summary,
            error,
            input: input_out,
            output,
        };

        if kind.opens_step(self.steps.len()) {
            self.push_step(None, IMPLICIT_STEP_TITLE.to_string(), started_at);
        }
        let step = self.steps.last_mut().expect("a step exists");
        step.note.clear();
        step.extend(ended_at.or(started_at));
        step.step.tool_calls.push(row);
    }

    fn open_step(
        &mut self,
        stage: Option<&'static str>,
        title: Option<&Value>,
        started_at: Option<i64>,
        ended_at: Option<i64>,
    ) {
        let stage = stage.map(str::to_string);
        let title = title
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(|t| t.chars().take(STEP_TITLE_MAX_CHARS).collect::<String>())
            .unwrap_or_else(|| format!("Step {}", self.steps.len() + 1));
        self.push_step(stage, title, started_at);
        if let Some(step) = self.steps.last_mut() {
            step.extend(ended_at);
        }
    }

    fn push_step(&mut self, stage: Option<String>, title: String, started_at: Option<i64>) {
        self.steps.push(StepAcc {
            step: ThreadStep {
                index: self.steps.len() as u32 + 1,
                stage,
                title,
                started_at,
                ended_at: None,
                note: None,
                note_truncated: false,
                citations: Vec::new(),
                from_steering: false,
                tool_calls: Vec::new(),
            },
            note: Vec::new(),
            last_end: started_at,
        });
    }

    fn finish(self, turns: &[ai_chat_turns::Model]) -> RcaThread {
        let count = self.steps.len();
        let mut tool_calls = 0u32;
        let steps: Vec<ThreadStep> = self
            .steps
            .into_iter()
            .enumerate()
            .map(|(i, acc)| {
                let open = self.active && i + 1 == count;
                let mut step = acc.step;
                tool_calls += step.tool_calls.len() as u32;
                step.ended_at = if open { None } else { acc.last_end };
                if !acc.note.is_empty() {
                    let full = redact_internal_details(&acc.note.join("\n\n"));
                    step.note_truncated = full.chars().count() > NOTE_MAX_CHARS;
                    let note: String = if step.note_truncated {
                        full.chars().take(NOTE_MAX_CHARS).collect()
                    } else {
                        full
                    };
                    // TH29: only what the reader sees is cited.
                    step.citations = citations(&note);
                    step.note = Some(note);
                }
                step
            })
            .collect();

        let started = self.started.map(|mut s| {
            s.at = s.at.or_else(|| turns.first().map(|t| t.started_at));
            s
        });
        let duration_ms = self.first_ms.zip(self.last_ms).map_or(0, |(f, l)| l - f);
        RcaThread {
            run_id: String::new(),
            state_version: String::new(),
            not_modified: false,
            active: self.active,
            transcript: Transcript::Available,
            started,
            user_messages: self.user_messages,
            questions: Vec::new(),
            report_submitted: self.report_submitted,
            stats: ThreadStats {
                steps: steps.len() as u32,
                tool_calls,
                duration_ms,
                tokens: self.tokens,
            },
            steps,
        }
    }
}

impl StepAcc {
    fn extend(&mut self, at: Option<i64>) {
        if let Some(at) = at {
            self.last_end = Some(self.last_end.map_or(at, |e| e.max(at)));
        }
    }
}

fn as_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}

/// Event times are epoch milliseconds; the thread uses microseconds.
fn ms_to_us(v: Option<&Value>) -> Option<i64> {
    v.and_then(as_i64).map(|ms| ms * 1000)
}

/// The longest prefix of `s` within `max` bytes that ends on a char boundary.
fn cut_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// `[eN]` references in a note, in order, without duplicates.
fn citations(note: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut rest = note;
    while let Some(start) = rest.find("[e") {
        let after = &rest[start + 2..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && after.as_bytes().get(digits) == Some(&b']') {
            let id = format!("e{}", &after[..digits]);
            if !found.contains(&id) {
                found.push(id);
            }
        }
        rest = after;
    }
    found
}

/// The one argument that says what a tool call did (TH33).
fn key_arg(tool: &str, input: &Map<String, Value>) -> Option<String> {
    let request_body = obj(input.get("request_body"));
    let text = match tool {
        "SearchSQL" => request_body
            .and_then(|rb| obj(rb.get("query")))
            .and_then(|q| q.get("sql"))
            .and_then(Value::as_str)
            .map(str::to_string),
        t if t.starts_with("Prometheus") => input
            .get("query")
            .or_else(|| request_body.and_then(|rb| rb.get("query")))
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
    .or_else(|| {
        ["command", "cmd"]
            .iter()
            .find_map(|k| input.get(*k).and_then(Value::as_str))
            .map(str::to_string)
    })
    .or_else(|| (!input.is_empty()).then(|| Value::Object(input.clone()).to_string()))?;
    Some(cut_bytes(&text, KEY_ARG_MAX_BYTES).to_string())
}

/// Counts only, never data from the output (TH33).
fn result_summary(state: &Map<String, Value>) -> String {
    let metadata = state
        .get("metadata")
        .filter(|v| truthy(v))
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let coerced = coerce_tool_output(state.get("output"), metadata);
    let body = match extract_mcp_response(&coerced) {
        Value::Null => Value::Object(coerced),
        body => body,
    };
    count_summary(&body).unwrap_or_else(|| byte_size(output_len(state)))
}

fn count_summary(body: &Value) -> Option<String> {
    let body = body.as_object()?;
    let len = |key: &str| body.get(key).and_then(Value::as_array).map(Vec::len);
    if let Some(n) = len("hits") {
        return Some(plural(n, "row"));
    }
    let series = body
        .get("result")
        .or_else(|| obj(body.get("data")).and_then(|d| d.get("result")))
        .and_then(Value::as_array);
    if let Some(series) = series {
        let points: usize = series
            .iter()
            .map(|s| match s.get("values").and_then(Value::as_array) {
                Some(values) => values.len(),
                None => usize::from(s.get("value").is_some()),
            })
            .sum();
        return Some(format!(
            "{} · {}",
            plural(series.len(), "series"),
            plural(points, "point")
        ));
    }
    if let Some(n) = len("patterns") {
        return Some(plural(n, "pattern"));
    }
    if let Some(n) = len("spans") {
        return Some(plural(n, "span"));
    }
    if let Some(n) = len("traces") {
        return Some(plural(n, "trace"));
    }
    None
}

fn plural(n: usize, noun: &str) -> String {
    if n == 1 || noun == "series" {
        format!("{n} {noun}")
    } else {
        format!("{n} {noun}s")
    }
}

fn output_len(state: &Map<String, Value>) -> usize {
    match state.get("output") {
        Some(Value::String(s)) => s.len(),
        None | Some(Value::Null) => 0,
        Some(other) => other.to_string().len(),
    }
}

fn byte_size(bytes: usize) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

fn error_text(error: Option<&Value>) -> String {
    let message = match error.filter(|e| truthy(e)) {
        Some(error) => redact_internal_details(&extract_error_message(error)),
        None => "Tool execution failed".to_string(),
    };
    message.chars().take(ERROR_MAX_CHARS).collect()
}

fn raw_output(state: &Map<String, Value>) -> Option<String> {
    let text = match state.get("output").or_else(|| state.get("error")) {
        Some(Value::String(s)) => s.clone(),
        None | Some(Value::Null) => return None,
        Some(other) => other.to_string(),
    };
    Some(cut_bytes(&text, OUTPUT_MAX_BYTES).to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use config::utils::json::json;

    use super::*;

    /// The fixture session's start, epoch milliseconds.
    pub(crate) const T: i64 = 1_784_600_000_000;
    pub(crate) const FIRST_REPORT: &str = "## Draft\nThe pool may be exhausted.";
    pub(crate) const SECOND_REPORT: &str = "## Root cause\nThe DB pool ran dry.";
    /// The visible tool rows of [rca_session]: GetIncident, SearchSQL, PrometheusRangeQuery,
    /// and a failed SearchSQL. `bash`, `read` and the sentinels are not rows.
    pub(crate) const VISIBLE_TOOL_CALLS: u32 = 4;

    /// Builds the committed events of one chat session.
    pub(crate) struct Session {
        pub(crate) events: Vec<DurableEvent>,
    }

    impl Session {
        pub(crate) fn new() -> Self {
            Self { events: Vec::new() }
        }

        fn push(&mut self, event_type: &str, data: Value) {
            let seq = self.events.len() as i64;
            self.events.push(DurableEvent {
                id: format!("evt_{seq:04}"),
                aggregate_id: "ses_rca".to_string(),
                seq,
                event_type: event_type.to_string(),
                data,
            });
        }

        pub(crate) fn message(&mut self, id: &str, role: &str, time: Value) {
            self.push(
                "message.updated.1",
                json!({"sessionID": "ses_rca", "info": {"id": id, "sessionID": "ses_rca", "role": role, "time": time}}),
            );
        }

        pub(crate) fn part(&mut self, message_id: &str, mut part: Value) {
            part["sessionID"] = json!("ses_rca");
            part["messageID"] = json!(message_id);
            self.push(
                "message.part.updated.1",
                json!({"sessionID": "ses_rca", "part": part}),
            );
        }

        pub(crate) fn text(
            &mut self,
            message_id: &str,
            id: &str,
            text: &str,
            start: i64,
            end: i64,
        ) {
            self.part(
                message_id,
                json!({"id": id, "type": "text", "text": text, "time": {"start": T + start, "end": T + end}}),
            );
        }

        /// A tool part as opencode stores it; `result` holds `output` or `error`.
        #[allow(clippy::too_many_arguments)]
        pub(crate) fn tool(
            &mut self,
            message_id: &str,
            id: &str,
            tool: &str,
            status: &str,
            input: Value,
            result: Value,
            start: i64,
            end: i64,
        ) {
            let mut state = json!({"status": status, "input": input, "time": {"start": T + start, "end": T + end}});
            if let Value::Object(result) = result {
                state.as_object_mut().unwrap().extend(result);
            }
            self.part(
                message_id,
                json!({"id": id, "type": "tool", "callID": format!("call_{id}"), "tool": tool, "state": state}),
            );
        }

        pub(crate) fn tokens(
            &mut self,
            message_id: &str,
            id: &str,
            input: u64,
            output: u64,
            reasoning: u64,
            cache_read: u64,
        ) {
            self.part(
                message_id,
                json!({"id": id, "type": "step-finish", "tokens": {"input": input, "output": output, "reasoning": reasoning, "cache": {"read": cache_read, "write": 0}}}),
            );
        }
    }

    pub(crate) fn search_sql(sql: &str) -> Value {
        json!({"org_id": "default", "type": "logs", "request_body": {"query": {"sql": sql}}})
    }

    pub(crate) fn hits(n: usize) -> Value {
        json!({"output": json!({"took": 3, "hits": vec![json!({}); n], "total": n}).to_string()})
    }

    /// A recorded-shape RCA session: a tool call before the first step, hidden tools, two
    /// `record_step`s with notes and citations, a failed call, and two `submit_report`s.
    pub(crate) fn rca_session() -> Vec<DurableEvent> {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.part(
            "msg_u1",
            json!({"id": "prt_u1", "type": "text", "text": "Analyze incident inc_1 \"checkout errors\" (3 alerts, P2). Trigger: manual."}),
        );
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        // Text before any step or tool call has no step to belong to.
        s.text(
            "msg_a1",
            "prt_a0",
            "I will start with the incident.",
            150,
            160,
        );
        s.tool(
            "msg_a1",
            "prt_t0",
            "o2_GetIncident",
            "pending",
            json!({}),
            json!({}),
            200,
            200,
        );
        s.tool(
            "msg_a1",
            "prt_t0",
            "o2_GetIncident",
            "completed",
            json!({"incident_id": "inc_1", "_o2_session": "secret"}),
            json!({"output": "{\"id\":\"inc_1\",\"title\":\"checkout errors\"}"}),
            200,
            260,
        );
        s.tool(
            "msg_a1",
            "prt_b1",
            "bash",
            "completed",
            json!({"command": "ls"}),
            json!({"output": "a\nb"}),
            300,
            310,
        );
        s.tool(
            "msg_a1",
            "prt_r1",
            "read",
            "completed",
            json!({"filePath": "/x"}),
            json!({"output": "x"}),
            320,
            330,
        );
        s.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "context", "title": "Load incident context"}),
            json!({"output": "{\"type\":\"rca_step\"}"}),
            1_000,
            1_001,
        );
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT count(*) FROM app_logs WHERE level = 'error'"),
            hits(42),
            1_100,
            1_142,
        );
        s.text(
            "msg_a1",
            "prt_n1",
            "Errors began at 10:02 [e1]. Pool waits rose at the same time [e2] [e1].",
            1_200,
            1_300,
        );
        s.tokens("msg_a1", "prt_f1", 1_000, 200, 50, 300);
        s.tool(
            "msg_a1",
            "prt_s2",
            "record_step",
            "completed",
            json!({"stage": "metrics", "title": "Check pool saturation"}),
            json!({"output": "{\"type\":\"rca_step\"}"}),
            2_000,
            2_001,
        );
        s.tool(
            "msg_a1",
            "prt_t2",
            "o2_tools_call",
            "completed",
            json!({"tool": "o2_PrometheusRangeQuery", "args": {"query": "sum(rate(db_pool_wait_seconds[5m]))"}}),
            json!({"output": "{\"data\":{\"result\":[{\"values\":[[1,\"1\"],[2,\"2\"]]},{\"values\":[[1,\"3\"]]}]}}"}),
            2_100,
            2_350,
        );
        s.tool(
            "msg_a1",
            "prt_t3",
            "o2_SearchSQL",
            "error",
            search_sql("SELECT * FROM db_logs"),
            json!({"error": "connection refused"}),
            2_400,
            2_410,
        );
        s.text(
            "msg_a1",
            "prt_n2",
            &format!("Pool max is 20 [e3]. {}", "y".repeat(1_100)),
            2_500,
            2_600,
        );
        s.tool(
            "msg_a1",
            "prt_p1",
            "submit_report",
            "completed",
            json!({"markdown": FIRST_REPORT}),
            json!({"output": "{\"type\":\"rca_report\"}"}),
            3_000,
            3_001,
        );
        s.tokens("msg_a1", "prt_f2", 2_000, 400, 0, 100);
        s.tool(
            "msg_a1",
            "prt_p2",
            "submit_report",
            "completed",
            json!({"markdown": SECOND_REPORT}),
            json!({"output": "{\"type\":\"rca_report\"}"}),
            4_000,
            4_001,
        );
        s.message(
            "msg_a1",
            "assistant",
            json!({"created": T + 100, "completed": T + 4_100}),
        );
        s.events
    }

    /// [rca_session] without its `submit_report` parts.
    pub(crate) fn without_report(events: Vec<DurableEvent>) -> Vec<DurableEvent> {
        events
            .into_iter()
            .filter(|e| e.data["part"]["tool"] != "submit_report")
            .collect()
    }

    fn us(ms: i64) -> Option<i64> {
        Some((T + ms) * 1000)
    }

    fn load_replay() -> Vec<DurableEvent> {
        let path = format!(
            "{}/src/ai_chat/testdata/replay_session.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let body: Value =
            config::utils::json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        body["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| DurableEvent::from_sync_event(e).expect("a durable event"))
            .collect()
    }

    /// TH29, TH33: steps, stage and title, notes, citations, durations and summaries of the
    /// recorded RCA session.
    #[test]
    fn the_rca_session_projects_to_its_steps_notes_and_tool_rows() {
        let thread = project_rca_thread(&rca_session(), &[], false, false);

        assert_eq!(thread.transcript, Transcript::Available);
        let started = thread.started.as_ref().unwrap();
        assert_eq!(started.at, Some(T * 1000));
        assert_eq!(
            started.prompt,
            "Analyze incident inc_1 \"checkout errors\" (3 alerts, P2). Trigger: manual."
        );
        assert!(thread.user_messages.is_empty());
        assert!(thread.report_submitted);

        let titles: Vec<(u32, Option<&str>, &str)> = thread
            .steps
            .iter()
            .map(|s| (s.index, s.stage.as_deref(), s.title.as_str()))
            .collect();
        assert_eq!(
            titles,
            [
                (1, None, "Investigation"),
                (2, Some("context"), "Load incident context"),
                (3, Some("metrics"), "Check pool saturation"),
            ]
        );

        // Tool calls before the first record_step: the "Investigation" step; the text before
        // them is no note.
        let first = &thread.steps[0];
        assert_eq!(first.note, None);
        assert_eq!(first.started_at, us(200));
        assert_eq!(first.ended_at, us(260));
        let get = &first.tool_calls[..];
        assert_eq!(get.len(), 1, "bash and read are no rows");
        assert_eq!(get[0].tool, "GetIncident");
        assert_eq!(get[0].call_id, "call_prt_t0");
        assert_eq!(
            get[0].key_arg.as_deref(),
            Some("{\"incident_id\":\"inc_1\"}")
        );
        assert_eq!(get[0].status, ToolCallStatus::Ok);
        let output_len = "{\"id\":\"inc_1\",\"title\":\"checkout errors\"}".len();
        assert_eq!(get[0].result_summary, Some(format!("{output_len} B")));

        let context = &thread.steps[1];
        assert_eq!(context.started_at, us(1_000));
        assert_eq!(context.ended_at, us(1_300));
        let sql = &context.tool_calls[0];
        assert_eq!(sql.tool, "SearchSQL");
        assert_eq!(
            sql.key_arg.as_deref(),
            Some("SELECT count(*) FROM app_logs WHERE level = 'error'")
        );
        assert_eq!(sql.started_at, us(1_100), "ms become µs");
        assert_eq!(sql.duration_ms, Some(42));
        assert_eq!(sql.result_summary.as_deref(), Some("42 rows"));
        assert_eq!(sql.error, None);
        assert_eq!(
            context.note.as_deref(),
            Some("Errors began at 10:02 [e1]. Pool waits rose at the same time [e2] [e1].")
        );
        assert!(!context.note_truncated);
        assert_eq!(context.citations, ["e1", "e2"]);

        let metrics = &thread.steps[2];
        let rows: Vec<(&str, ToolCallStatus)> = metrics
            .tool_calls
            .iter()
            .map(|c| (c.tool.as_str(), c.status))
            .collect();
        assert_eq!(
            rows,
            [
                ("PrometheusRangeQuery", ToolCallStatus::Ok),
                ("SearchSQL", ToolCallStatus::Error)
            ],
            "submit_report is no row"
        );
        let prom = &metrics.tool_calls[0];
        assert_eq!(
            prom.key_arg.as_deref(),
            Some("sum(rate(db_pool_wait_seconds[5m]))")
        );
        assert_eq!(prom.result_summary.as_deref(), Some("2 series · 3 points"));
        assert_eq!(prom.duration_ms, Some(250));
        let failed = &metrics.tool_calls[1];
        assert_eq!(failed.result_summary, None);
        assert_eq!(failed.error.as_deref(), Some("connection refused"));
        let note = metrics.note.as_deref().unwrap();
        assert!(metrics.note_truncated);
        assert_eq!(note.chars().count(), 1_000);
        assert!(note.starts_with("Pool max is 20 [e3]. yyy"));
        assert_eq!(metrics.citations, ["e3"]);
        assert_eq!(
            metrics.ended_at,
            us(2_600),
            "a run that is not live closes its last step"
        );

        assert_eq!(
            thread.stats,
            ThreadStats {
                steps: 3,
                tool_calls: VISIBLE_TOOL_CALLS,
                duration_ms: 4_100,
                tokens: ThreadTokens {
                    input: 3_000,
                    output: 600,
                    reasoning: 50,
                    cache_read: 400,
                },
            }
        );
    }

    /// TH29: no `bash`/`read` row; every visible row of the replay keeps its timing in µs.
    #[test]
    fn the_replay_session_shows_only_visible_tools_with_their_timing() {
        let events = load_replay();
        let thread = project_rca_thread(&events, &[], false, false);

        // The final state of each tool part, as the events carry it.
        let mut finals: Vec<(String, Value)> = Vec::new();
        for e in &events {
            let part = &e.data["part"];
            if part["type"] != "tool" {
                continue;
            }
            let id = part["id"].as_str().unwrap().to_string();
            match finals.iter_mut().find(|(pid, _)| *pid == id) {
                Some(entry) => entry.1 = part.clone(),
                None => finals.push((id, part.clone())),
            }
        }
        let visible: Vec<&Value> = finals
            .iter()
            .map(|(_, p)| p)
            .filter(|p| !HIDDEN_TOOLS.contains(&strip_mcp_prefix(p["tool"].as_str().unwrap())))
            .collect();
        assert!(visible.len() >= 3, "the replay has visible tool calls");

        assert_eq!(thread.steps.len(), 1);
        let step = &thread.steps[0];
        assert_eq!(
            (step.stage.as_deref(), step.title.as_str()),
            (None, "Investigation")
        );
        assert_eq!(step.tool_calls.len(), visible.len());
        assert_eq!(thread.stats.tool_calls as usize, visible.len());
        for (row, part) in step.tool_calls.iter().zip(&visible) {
            assert_eq!(row.tool, strip_mcp_prefix(part["tool"].as_str().unwrap()));
            assert!(!["bash", "read", "tool_search"].contains(&row.tool.as_str()));
            let time = &part["state"]["time"];
            let start = time["start"].as_i64();
            assert_eq!(row.started_at, start.map(|ms| ms * 1000), "ms become µs");
            assert_eq!(
                row.duration_ms,
                start.zip(time["end"].as_i64()).map(|(s, e)| e - s)
            );
            if row.status == ToolCallStatus::Ok {
                assert!(row.result_summary.is_some(), "{row:?}");
            }
        }
    }

    /// TH33: without the org setting no row carries `input` or `output`, not even as null.
    #[test]
    fn tool_rows_carry_no_input_or_output_by_default() {
        let json =
            serde_json::to_value(project_rca_thread(&rca_session(), &[], false, false)).unwrap();
        let rows: Vec<&Map<String, Value>> = json["steps"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|s| s["tool_calls"].as_array().unwrap())
            .map(|r| r.as_object().unwrap())
            .collect();
        assert_eq!(rows.len(), VISIBLE_TOOL_CALLS as usize);
        for row in rows {
            assert!(
                !row.contains_key("input") && !row.contains_key("output"),
                "{row:?}"
            );
            for key in [
                "call_id",
                "tool",
                "key_arg",
                "status",
                "started_at",
                "duration_ms",
                "result_summary",
                "error",
            ] {
                assert!(row.contains_key(key), "{key} missing in {row:?}");
            }
        }
    }

    /// TH34: the org setting adds the raw input (without the session arg) and output.
    #[test]
    fn the_tool_io_setting_adds_input_and_output() {
        let thread = project_rca_thread(&rca_session(), &[], false, true);
        let get = &thread.steps[0].tool_calls[0];
        assert_eq!(get.input, Some(json!({"incident_id": "inc_1"})));
        assert_eq!(
            get.output.as_deref(),
            Some("{\"id\":\"inc_1\",\"title\":\"checkout errors\"}")
        );
        let failed = &thread.steps[2].tool_calls[1];
        assert_eq!(failed.output.as_deref(), Some("connection refused"));
    }

    /// TH29: the open step of a live run has no end, and its unfinished call is running.
    #[test]
    fn a_live_run_keeps_its_last_step_open() {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        s.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "context", "title": "Load incident context"}),
            json!({}),
            1_000,
            1_001,
        );
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "running",
            search_sql("SELECT 1"),
            json!({}),
            1_100,
            1_100,
        );

        let live = project_rca_thread(&s.events, &[], true, false);
        assert_eq!(live.steps[0].ended_at, None);
        assert_eq!(live.steps[0].tool_calls[0].status, ToolCallStatus::Running);
        let ended = project_rca_thread(&s.events, &[], false, false);
        assert_eq!(ended.steps[0].tool_calls[0].status, ToolCallStatus::Error);
        assert_eq!(
            ended.steps[0].tool_calls[0].error.as_deref(),
            Some(UNFINISHED_TOOL_ERROR)
        );
    }

    /// TH31: the version names the session watermark, the session write and the run write.
    #[test]
    fn the_state_version_moves_with_each_of_its_parts() {
        let v = state_version(12, 1_700, 1_800, false);
        assert_eq!(v, "12.1700.1800");
        assert_eq!(v, state_version(12, 1_700, 1_800, false));
        assert_ne!(v, state_version(13, 1_700, 1_800, false));
        assert_ne!(v, state_version(12, 1_701, 1_800, false));
        assert_ne!(v, state_version(12, 1_700, 1_801, false));
        assert_ne!(v, state_version(12, 1_700, 1_800, true));
    }

    /// TH31: turning the org's tool-output setting on or off changes the version, so a
    /// client's copy with the other visibility is never answered `not_modified`.
    #[test]
    fn the_state_version_names_the_tool_io_setting() {
        assert_eq!(state_version(12, 1_700, 1_800, true), "12.1700.1800.io");
        assert_ne!(
            state_version(12, 1_700, 1_800, false),
            state_version(12, 1_700, 1_800, true)
        );
    }

    /// TH18: the seven stage names map to themselves; anything else is no stage.
    #[test]
    fn rca_stage_maps_the_seven_names_only() {
        for stage in RCA_STAGES {
            assert_eq!(rca_stage(Some(&json!(stage))), Some(stage));
        }
        assert_eq!(
            RCA_STAGES,
            [
                "context",
                "topology",
                "changes",
                "traces",
                "log_patterns",
                "metrics",
                "converge"
            ]
        );
        for other in [
            json!("gather"),
            json!("Context"),
            json!(""),
            json!(3),
            json!(null),
        ] {
            assert_eq!(rca_stage(Some(&other)), None, "{other}");
        }
        assert_eq!(rca_stage(None), None);
    }

    /// TH18, TH29: a `record_step` with an unknown stage is a step without a stage.
    #[test]
    fn an_unknown_stage_never_shows_as_a_stage() {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        s.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "gather", "title": "Gather data"}),
            json!({}),
            100,
            101,
        );
        s.tool(
            "msg_a1",
            "prt_s2",
            "record_step",
            "completed",
            json!({"stage": "topology", "title": "Map services"}),
            json!({}),
            200,
            201,
        );
        let thread = project_rca_thread(&s.events, &[], false, false);
        let steps: Vec<(Option<&str>, &str)> = thread
            .steps
            .iter()
            .map(|st| (st.stage.as_deref(), st.title.as_str()))
            .collect();
        assert_eq!(
            steps,
            [(None, "Gather data"), (Some("topology"), "Map services")]
        );
        let json = serde_json::to_string(&thread).unwrap();
        assert!(!json.contains("gather"), "{json}");
    }

    /// TH29: a citation past the 1,000-char cut of a note is not returned.
    #[test]
    fn a_citation_past_the_note_cut_is_not_returned() {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        s.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "context", "title": "Load"}),
            json!({}),
            100,
            101,
        );
        // [e1] at the start, [e2] ends exactly at char 1,000, [e3] starts after the cut,
        // [e4] straddles it.
        let head = format!("[e1] {}", "a".repeat(990));
        assert_eq!(head.chars().count(), 995);
        let text = format!("{head} [e2] [e3] {} [e4]", "b".repeat(50));
        let straddle = format!("{} [e5]", "c".repeat(997));
        s.text("msg_a1", "prt_n1", &text, 200, 300);

        let thread = project_rca_thread(&s.events, &[], false, false);
        let step = &thread.steps[0];
        assert!(step.note_truncated);
        assert!(step.note.as_deref().unwrap().ends_with("[e2]"));
        assert_eq!(step.citations, ["e1", "e2"]);

        let mut cut = Session::new();
        cut.message("msg_a1", "assistant", json!({"created": T}));
        cut.tool(
            "msg_a1",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "context", "title": "Load"}),
            json!({}),
            100,
            101,
        );
        cut.text("msg_a1", "prt_n1", &straddle, 200, 300);
        let thread = project_rca_thread(&cut.events, &[], false, false);
        assert!(
            thread.steps[0].citations.is_empty(),
            "a reference cut in half is no citation"
        );
    }

    /// TH30: a run without a transcript serializes `transcript: "none"` and no steps.
    #[test]
    fn a_run_without_a_transcript_has_no_steps() {
        let json = serde_json::to_value(RcaThread::without_transcript(
            "run_1",
            state_version(-1, 0, 5, false),
            false,
            Transcript::None,
        ))
        .unwrap();
        assert_eq!(json["transcript"], "none");
        assert_eq!(json["run_id"], "run_1");
        assert_eq!(json["state_version"], "-1.0.5");
        assert_eq!(json["steps"], json!([]));
        assert_eq!(json["stats"]["tool_calls"], 0);
    }
}
