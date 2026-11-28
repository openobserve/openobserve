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

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

use crate::meta::oncall::{
    agent::Confidence,
    confidence::is_call_ref,
    rca_run::{Polarity, Strength},
};

pub const AUTORESOLVE_RUNS_STREAM: &str = "_o2_autoresolve_runs";
pub const MAX_OPTIONS: usize = 4;
/// How o2-ai's AutoResolve guard (`PLANNING_REFUSAL`) answers a change tried while planning.
pub const PLANNING_HELD_PREFIX: &str = "Not run: this call changes something";
/// How o2-ai names a connection's tools to the model: `ar_<connection key>_<tool>`.
pub const AUTORESOLVE_TOOL_PREFIX: &str = "ar_";
pub const RESULT_CAP_BYTES: usize = 262_144;
pub const STEP_RESULT_GRACE_US: i64 = 300_000_000;
/// What a person reads for a connection; API and stored names keep "connection".
const MCP_NOUN: &str = "MCP";
/// Names a list shows before it counts the rest as "and N more".
const MAX_LISTED_NAMES: usize = 5;
const MAX_LISTED_MCPS: usize = 3;
/// A longer first clause of an MCP's description is left out rather than cut.
const MAX_SHORT_DESCRIPTION_CHARS: usize = 30;

const REDACTED: &str = "***";
// A key containing one of these holds a secret (`client_secret`, `access_token`, `x-api-key`).
const SECRET_KEY_PARTS: [&str; 13] = [
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "api_key",
    "apikey",
    "api-key",
    "authorization",
    "private_key",
    "access_key",
    "credential",
    "routing_key",
];
// A URL query parameter whose name contains one of these carries a credential.
const SECRET_QUERY_PARTS: [&str; 7] = ["token", "key", "sig", "secret", "password", "auth", "code"];
// Webhook hosts whose URL path is itself the credential.
const WEBHOOK_HOSTS: [&str; 9] = [
    "hooks.slack.com",
    "webhook.office.com",
    "outlook.office.com",
    "discord.com",
    "discordapp.com",
    "hooks.zapier.com",
    "api.telegram.org",
    "chat.googleapis.com",
    "events.pagerduty.com",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Investigating,
    WaitingApproval,
    Proceeding,
    Checking,
    Worked,
    NoChange,
    Worse,
    Declined,
    Lapsed,
    StepFailed,
    OutcomeUnknown,
    Failed,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Investigating => "investigating",
            Self::WaitingApproval => "waiting_approval",
            Self::Proceeding => "proceeding",
            Self::Checking => "checking",
            Self::Worked => "worked",
            Self::NoChange => "no_change",
            Self::Worse => "worse",
            Self::Declined => "declined",
            Self::Lapsed => "lapsed",
            Self::StepFailed => "step_failed",
            Self::OutcomeUnknown => "outcome_unknown",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "investigating" => Self::Investigating,
            "waiting_approval" => Self::WaitingApproval,
            "proceeding" => Self::Proceeding,
            "checking" => Self::Checking,
            "worked" => Self::Worked,
            "no_change" => Self::NoChange,
            "worse" => Self::Worse,
            "declined" => Self::Declined,
            "lapsed" => Self::Lapsed,
            "step_failed" => Self::StepFailed,
            "outcome_unknown" => Self::OutcomeUnknown,
            "failed" => Self::Failed,
            _ => return None,
        })
    }

    pub fn is_live(&self) -> bool {
        matches!(
            self,
            Self::Investigating | Self::Proceeding | Self::Checking
        )
    }

    /// The states a run ends in; `Worse` still lets a person raise a revert.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Worked
                | Self::NoChange
                | Self::Worse
                | Self::Declined
                | Self::Lapsed
                | Self::StepFailed
                | Self::OutcomeUnknown
                | Self::Failed
        )
    }

    pub fn can_move_to(self, next: RunState) -> bool {
        use RunState::*;
        match self {
            Investigating => matches!(next, WaitingApproval | NoChange | Failed),
            WaitingApproval => matches!(next, Proceeding | Declined | Lapsed | Investigating),
            Proceeding => matches!(
                next,
                Checking | StepFailed | OutcomeUnknown | WaitingApproval | Failed | NoChange
            ),
            Checking => matches!(next, Worked | NoChange | Worse | Failed | OutcomeUnknown),
            Worse | Worked | OutcomeUnknown | NoChange => next == Investigating,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    Proposed,
    Approved,
    Running,
    Done,
    Failed,
    Held,
    NotRun,
    Superseded,
    OutcomeUnknown,
}

impl StepState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Approved => "approved",
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Held => "held",
            Self::NotRun => "not_run",
            Self::Superseded => "superseded",
            Self::OutcomeUnknown => "outcome_unknown",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "proposed" => Self::Proposed,
            "approved" => Self::Approved,
            "running" => Self::Running,
            "done" => Self::Done,
            "failed" => Self::Failed,
            "held" => Self::Held,
            "not_run" => Self::NotRun,
            "superseded" => Self::Superseded,
            "outcome_unknown" => Self::OutcomeUnknown,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    DryRun,
    Change,
}

impl StepKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DryRun => "dry_run",
            Self::Change => "change",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    Person,
    Alert,
    Incident,
}

impl TriggerKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Alert => "alert",
            Self::Incident => "incident",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Worked,
    NoChange,
    Worse,
}

impl Verdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Worked => "worked",
            Self::NoChange => "no_change",
            Self::Worse => "worse",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PersonVerdict {
    Fixed,
    NotFixed,
}

impl PersonVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fixed => "fixed",
            Self::NotFixed => "not_fixed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionKind {
    WrongCause,
    WrongFix,
    OutOfScope,
    NotFixed,
}

impl CorrectionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WrongCause => "wrong_cause",
            Self::WrongFix => "wrong_fix",
            Self::OutOfScope => "out_of_scope",
            Self::NotFixed => "not_fixed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "wrong_cause" => Self::WrongCause,
            "wrong_fix" => Self::WrongFix,
            "out_of_scope" => Self::OutOfScope,
            "not_fixed" => Self::NotFixed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalChannel {
    Screen,
    Slack,
}

impl ApprovalChannel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Screen => "screen",
            Self::Slack => "slack",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlanInput {
    pub options: Vec<OptionInput>,
    pub omitted_count: u32,
    pub omitted_reason: Option<String>,
    pub missing_capability: Option<String>,
    // `cause` and `evidence` are skipped when absent so plans stored before them keep their
    // fingerprint.
    /// The cause the agent's reads confirmed; the run page shows it first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    /// The reads that show the cause, each citing a call by its ref.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<PlanEvidence>,
}

/// One read the agent cites for the plan's cause; the server binds it to the call with that ref.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PlanEvidence {
    pub id: String,
    pub tool: String,
    #[serde(rename = "ref")]
    pub call_ref: String,
    pub polarity: Polarity,
    pub strength: Strength,
    pub observation: String,
    /// `rules_out` only: the other cause the read rules out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternative: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct OptionInput {
    pub title: String,
    pub recommended: bool,
    pub changes_production_directly: bool,
    pub tradeoffs: String,
    pub reason: String,
    pub steps: Vec<StepInput>,
    // Skipped when absent so plans stored before this field keep their fingerprint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial_fix: Option<String>,
    /// The band the agent claims for this option; the server lowers it to what the cause's
    /// evidence supports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<Confidence>,
}

/// One accepted plan as `autoresolve_runs.plan_history` keeps it: what the run's timeline shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlanRevision {
    pub revision: i32,
    pub planned_at_us: i64,
    #[serde(default)]
    pub cause: Option<String>,
    #[serde(default)]
    pub evidence: Vec<PlanEvidence>,
    #[serde(default)]
    pub missing_capability: Option<String>,
    pub options: Vec<PlanRevisionOption>,
    /// What happened to this plan, kept when a replan clears it from the run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<PlanAttempt>,
}

/// The approval and the agent's check of one plan, as the run held them before a replan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlanAttempt {
    #[serde(default)]
    pub option_id: Option<String>,
    #[serde(default)]
    pub approved_by: Option<String>,
    #[serde(default)]
    pub approved_at_us: Option<i64>,
    /// The state the run left, such as `worked`.
    pub state: String,
    #[serde(default)]
    pub verdict: Option<String>,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub ended_at_us: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlanRevisionOption {
    pub title: String,
    pub recommended: bool,
    #[serde(default)]
    pub partial_fix: Option<String>,
    #[serde(default)]
    pub confidence: Option<Confidence>,
}

impl PlanRevision {
    pub fn of(plan: &PlanInput, revision: i32, planned_at_us: i64) -> Self {
        Self {
            revision,
            planned_at_us,
            cause: plan.cause.clone(),
            evidence: plan.evidence.clone(),
            missing_capability: plan.missing_capability.clone(),
            options: plan
                .options
                .iter()
                .map(|o| PlanRevisionOption {
                    title: o.title.clone(),
                    recommended: o.recommended,
                    partial_fix: o.partial_fix.clone(),
                    confidence: o.confidence,
                })
                .collect(),
            attempt: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StepInput {
    pub connection: String,
    pub tool: String,
    pub kind: StepKind,
    pub arguments: Value,
    pub refs: Vec<StepRef>,
    pub reason: String,
    pub tool_def_hash: String,
    pub preview: Option<Value>,
}

/// JSON pointers; `from_step` is the 1-based seq inside the same option.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StepRef {
    pub arg_path: String,
    pub from_step: u32,
    pub result_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct OutcomeInput {
    pub verdict: Verdict,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConsumeRequest {
    pub connection: String,
    pub tool: String,
    pub arguments: Value,
    pub upstream_url: String,
    pub tool_def_hash: String,
}

#[derive(Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum ConsumeResponse {
    Run {
        step_id: String,
        arguments: Value,
        headers: HashMap<String, String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        allowed_hosts: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_redirects: Option<bool>,
    },
    Refuse {
        message: String,
    },
    Hold {
        message: String,
    },
}

impl std::fmt::Debug for ConsumeResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Run {
                step_id,
                arguments,
                headers,
                allowed_hosts,
                follow_redirects,
            } => {
                let mut names: Vec<&String> = headers.keys().collect();
                names.sort();
                f.debug_struct("Run")
                    .field("step_id", step_id)
                    .field("arguments", arguments)
                    .field("header_names", &names)
                    .field("allowed_hosts", allowed_hosts)
                    .field("follow_redirects", follow_redirects)
                    .finish()
            }
            Self::Refuse { message } => f.debug_struct("Refuse").field("message", message).finish(),
            Self::Hold { message } => f.debug_struct("Hold").field("message", message).finish(),
        }
    }
}

/// `unknown` means the request was sent but no answer came back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StepResultInput {
    pub ok: bool,
    pub unknown: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefError {
    MissingStep(u32),
    MissingPath { step: u32, path: String },
}

impl std::fmt::Display for RefError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingStep(step) => write!(f, "step {step} has no recorded result"),
            Self::MissingPath { step, path } => {
                write!(f, "step {step} result has nothing at {path}")
            }
        }
    }
}

impl std::error::Error for RefError {}

pub fn canonical_json(v: &Value) -> String {
    let mut out = String::new();
    write_canonical(v, &mut out);
    out
}

pub fn args_hash(arguments: &Value, refs: &[StepRef]) -> String {
    let mut masked = arguments.clone();
    for r in refs {
        let _ = set_pointer(&mut masked, &r.arg_path, Value::Null);
    }
    sha256_hex(&canonical_json(&masked))
}

/// Excludes every step's `preview`, so a verified dry run does not change the plan's identity.
pub fn plan_fingerprint(plan: &PlanInput, revision: u32) -> String {
    let mut v = serde_json::to_value((revision, plan)).unwrap_or(Value::Null);
    if let Some(steps) = v.pointer_mut("/1/options").and_then(Value::as_array_mut) {
        for step in steps
            .iter_mut()
            .filter_map(|o| o.get_mut("steps").and_then(Value::as_array_mut))
            .flatten()
        {
            if let Some(map) = step.as_object_mut() {
                map.remove("preview");
            }
        }
    }
    sha256_hex(&canonical_json(&v))
}

pub fn resolve_refs(
    arguments: &Value,
    refs: &[StepRef],
    results: &BTreeMap<u32, Value>,
) -> Result<Value, RefError> {
    let mut resolved = arguments.clone();
    for r in refs {
        let result = results
            .get(&r.from_step)
            .ok_or(RefError::MissingStep(r.from_step))?;
        let missing = || RefError::MissingPath {
            step: r.from_step,
            path: r.result_path.clone(),
        };
        let source = result_source(result).ok_or_else(missing)?;
        let value = source.pointer(&r.result_path).ok_or_else(missing)?;
        if !set_pointer(&mut resolved, &r.arg_path, value.clone()) {
            return Err(missing());
        }
    }
    Ok(resolved)
}

/// Replaces every secret-bearing value in place with a marker.
pub fn redact_secrets(v: &mut Value) {
    redact(v);
}

/// `text` without the `[ref abc234]` / `[ref abc234, xyz567]` markers the model copies from tool
/// results: refs belong in a plan's `evidence`, never in the prose people read.
pub fn without_call_refs(text: &str) -> String {
    const MARK: &str = "[ref ";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(MARK) {
        let tail = &rest[at + MARK.len()..];
        let refs = tail.find(']').map(|end| &tail[..end]);
        match refs.filter(|r| r.split(',').all(|one| is_call_ref(one.trim()))) {
            Some(r) => {
                out.push_str(rest[..at].trim_end_matches(' '));
                rest = &tail[r.len() + 1..];
            }
            None => {
                out.push_str(&rest[..at + MARK.len()]);
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Stored text with its secrets redacted: JSON by key, any other text only whole (a URL carrying
/// a credential).
pub fn redacted_text(text: &str) -> String {
    let mut value = serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()));
    redact(&mut value);
    match value {
        Value::String(s) => s,
        other => other.to_string(),
    }
}

/// A stored step result as a person reads it: its MCP text items, or the stored text unchanged
/// when it has none or is not MCP content (a capped result no longer parses).
pub fn result_text(stored: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(stored) else {
        return stored.to_string();
    };
    let texts = text_items(&value);
    if texts.is_empty() {
        stored.to_string()
    } else {
        texts.join("\n\n")
    }
}

/// A step result as a person may see it: its text items, each redacted on its own because one
/// may hold JSON, else the whole result redacted.
pub fn shown_result(result: &Value) -> String {
    let mut whole = result.clone();
    redact(&mut whole);
    let texts: Vec<String> = text_items(&whole).into_iter().map(redacted_text).collect();
    if texts.is_empty() {
        whole.to_string()
    } else {
        texts.join("\n\n")
    }
}

pub fn mcp_noun(count: usize) -> String {
    match count {
        1 => MCP_NOUN.to_string(),
        _ => format!("{MCP_NOUN}s"),
    }
}

pub fn mcp_count(count: usize) -> String {
    format!("{count} {}", mcp_noun(count))
}

pub fn named_mcp(name: &str) -> String {
    named_mcps(&[name.to_string()])
}

/// The en-US form every layer shares: serial comma, three names, then "and N more" (N >= 2).
pub fn named_mcps(names: &[String]) -> String {
    let mut words: Vec<String> = names.to_vec();
    if names.len() > MAX_LISTED_MCPS + 1 {
        words.truncate(MAX_LISTED_MCPS);
        words.push(format!("{} more", names.len() - MAX_LISTED_MCPS));
    }
    let list = match words.as_slice() {
        [] => return String::new(),
        [one] => one.clone(),
        [first, second] => format!("{first} and {second}"),
        [head @ .., last] => format!("{}, and {last}", head.join(", ")),
    };
    format!("the {list} {}", mcp_noun(names.len()))
}

/// An MCP description's first clause, shown beside its name: "postgres (shop primary)".
pub fn mcp_short_description(description: &str) -> Option<String> {
    let text = description.trim();
    let mut end = [";", ",", " - ", "\n"]
        .iter()
        .filter_map(|sep| text.find(sep))
        .min()
        .unwrap_or(text.len());
    // A period inside a host name or a version does not end the clause.
    let bytes = text.as_bytes();
    let period = text.match_indices('.').map(|(i, _)| i).find(|&i| {
        bytes
            .get(i + 1)
            .is_none_or(|next| next.is_ascii_whitespace())
    });
    if let Some(i) = period {
        end = end.min(i);
    }
    let clause = text[..end].trim();
    (!clause.is_empty() && clause.chars().count() <= MAX_SHORT_DESCRIPTION_CHARS)
        .then(|| clause.to_string())
}

/// "Approving changes the postgres MCP (shop primary)." from (name, short description) pairs.
pub fn approving_changes(mcps: &[(String, Option<String>)]) -> Option<String> {
    let named = match mcps {
        [] => return None,
        [(name, Some(short))] => format!("{} ({short})", named_mcp(name)),
        _ => {
            let names: Vec<String> = mcps
                .iter()
                .map(|(name, short)| match short {
                    Some(short) => format!("{name} ({short})"),
                    None => name.clone(),
                })
                .collect();
            named_mcps(&names)
        }
    };
    Some(format!("Approving changes {named}."))
}

pub fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// "a", "a and b", "a, b and c"; past `MAX_LISTED_NAMES` + 1 names, "a, …, e and 7 more".
pub fn name_list(items: &[String]) -> String {
    let mut words: Vec<String> = if items.len() > MAX_LISTED_NAMES + 1 {
        let mut shown = items[..MAX_LISTED_NAMES].to_vec();
        shown.push(format!("{} more", items.len() - MAX_LISTED_NAMES));
        shown
    } else {
        items.to_vec()
    };
    let Some(last) = words.pop() else {
        return String::new();
    };
    if words.is_empty() {
        last
    } else {
        format!("{} and {last}", words.join(", "))
    }
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(k.clone()).to_string());
                out.push(':');
                write_canonical(&map[k], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// Sets `pointer` to `value`, adding only a missing last object key; `false` when a parent is
/// missing or the path does not fit.
fn set_pointer(root: &mut Value, pointer: &str, value: Value) -> bool {
    if pointer.is_empty() {
        *root = value;
        return true;
    }
    let Some(path) = pointer.strip_prefix('/') else {
        return false;
    };
    let mut cur = root;
    for token in path.split('/') {
        let token = token.replace("~1", "/").replace("~0", "~");
        cur = match cur {
            Value::Array(items) => match token.parse::<usize>().ok().and_then(|i| items.get_mut(i))
            {
                Some(item) => item,
                None => return false,
            },
            Value::Object(map) => map.entry(token).or_insert(Value::Null),
            _ => return false,
        };
    }
    *cur = value;
    true
}

fn result_source(result: &Value) -> Option<Value> {
    if let Some(structured) = result.get("structuredContent") {
        return Some(structured.clone());
    }
    let text = result
        .get("content")?
        .as_array()?
        .iter()
        .find_map(|c| c.get("text").and_then(Value::as_str))?;
    serde_json::from_str(text).ok()
}

fn text_items(result: &Value) -> Vec<&str> {
    result
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect()
}

fn redact(value: &mut Value) -> bool {
    match value {
        Value::Object(map) => map.iter_mut().fold(false, |changed, (key, inner)| {
            let removed = if is_secret_key(key) {
                conceal(inner)
            } else {
                redact(inner)
            };
            removed | changed
        }),
        Value::Array(items) => items
            .iter_mut()
            .fold(false, |changed, item| redact(item) | changed),
        Value::String(text) if is_secret_url(text) => {
            *text = REDACTED.to_string();
            true
        }
        _ => false,
    }
}

fn is_secret_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower == "headers" || SECRET_KEY_PARTS.iter().any(|part| lower.contains(part))
}

/// Credentials in the URL, a credential-named query parameter, or a webhook whose path is a token.
fn is_secret_url(text: &str) -> bool {
    let Ok(url) = url::Url::parse(text) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    !url.username().is_empty()
        || url.password().is_some()
        || url.query_pairs().any(|(name, _)| {
            let name = name.to_ascii_lowercase();
            SECRET_QUERY_PARTS.iter().any(|part| name.contains(part))
        })
        || WEBHOOK_HOSTS
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// Replaces a set value with the redaction marker; `false` when there was nothing to hide.
fn conceal(value: &mut Value) -> bool {
    let empty = match &*value {
        Value::Null => true,
        Value::String(s) => s.is_empty() || s == REDACTED,
        Value::Object(map) => map.is_empty(),
        Value::Array(items) => items.is_empty(),
        _ => false,
    };
    if !empty {
        *value = Value::String(REDACTED.to_string());
    }
    !empty
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn step_ref(arg_path: &str, from_step: u32, result_path: &str) -> StepRef {
        StepRef {
            arg_path: arg_path.into(),
            from_step,
            result_path: result_path.into(),
        }
    }

    #[test]
    fn call_refs_leave_the_prose_and_other_brackets_stay() {
        let cases = [
            (
                "pods crash with \"panic\" [ref l6txzf]. The service failed [ref t74ia6, h7yr53].",
                "pods crash with \"panic\". The service failed.",
            ),
            ("[ref abcdef] first", " first"),
            (
                "a [ref note] and [ref ABCDEF] stay",
                "a [ref note] and [ref ABCDEF] stay",
            ),
            ("an open [ref abcdef", "an open [ref abcdef"),
            ("no refs at all", "no refs at all"),
        ];
        for (text, want) in cases {
            assert_eq!(without_call_refs(text), want, "{text}");
        }
    }

    #[test]
    fn mcp_text_reads_at_one_and_many() {
        let names = |n: usize| (1..=n).map(|i| format!("m{i}")).collect::<Vec<_>>();
        let cases = [
            (0, "0 MCPs", ""),
            (1, "1 MCP", "the m1 MCP"),
            (2, "2 MCPs", "the m1 and m2 MCPs"),
            (3, "3 MCPs", "the m1, m2, and m3 MCPs"),
            (4, "4 MCPs", "the m1, m2, m3, and m4 MCPs"),
            (5, "5 MCPs", "the m1, m2, m3, and 2 more MCPs"),
        ];
        for (n, count, named) in cases {
            assert_eq!(mcp_count(n), count);
            assert_eq!(named_mcps(&names(n)), named);
        }
        assert_eq!(name_list(&[]), "");
    }

    #[test]
    fn mcp_short_description_is_the_first_short_clause() {
        let cases = [
            ("Shop primary", Some("Shop primary")),
            (
                "Shop primary. Holds orders and carts.",
                Some("Shop primary"),
            ),
            ("shop primary, eu-west-1", Some("shop primary")),
            ("Event bus; JetStream enabled", Some("Event bus")),
            ("Cache - session store", Some("Cache")),
            ("  Line one\nline two", Some("Line one")),
            (
                "Orders on db.shop.internal",
                Some("Orders on db.shop.internal"),
            ),
            (
                "abcdefghij abcdefghij abcdefgh",
                Some("abcdefghij abcdefghij abcdefgh"),
            ),
            ("abcdefghij abcdefghij abcdefghi", None),
            ("The primary database of the shop. Orders.", None),
            ("", None),
            (" . ", None),
        ];
        for (description, want) in cases {
            assert_eq!(
                mcp_short_description(description).as_deref(),
                want,
                "{description:?}"
            );
        }
        let mcp = |name: &str, short: Option<&str>| (name.to_string(), short.map(str::to_string));
        let cases = [
            (vec![], None),
            (
                vec![mcp("postgres", Some("shop primary"))],
                Some("Approving changes the postgres MCP (shop primary)."),
            ),
            (
                vec![mcp("nats", None), mcp("redis", Some("cache"))],
                Some("Approving changes the nats and redis (cache) MCPs."),
            ),
        ];
        for (mcps, want) in cases {
            assert_eq!(approving_changes(&mcps).as_deref(), want, "{mcps:?}");
        }
    }

    #[test]
    fn resolve_refs_fills_from_recorded_results() {
        let structured = json!({"structuredContent": {"number": 42}});
        let text = json!({"content": [{"type": "text", "text": "{\"head\":{\"sha\":\"abc\"}}"}]});
        let results = BTreeMap::from([(1, structured), (2, text)]);
        let cases = [
            (
                json!({"pr": null}),
                vec![step_ref("/pr", 1, "/number")],
                Ok(json!({"pr": 42})),
            ),
            (
                json!({"sha": null}),
                vec![step_ref("/sha", 2, "/head/sha")],
                Ok(json!({"sha": "abc"})),
            ),
            (
                json!({"pr": 7}),
                vec![step_ref("/pr", 1, "/number")],
                Ok(json!({"pr": 42})),
            ),
            (
                json!({"pr": null}),
                vec![step_ref("pr", 1, "/number")],
                Err(RefError::MissingPath {
                    step: 1,
                    path: "/number".into(),
                }),
            ),
            (
                json!({"ids": [1]}),
                vec![step_ref("/ids/5", 1, "/number")],
                Err(RefError::MissingPath {
                    step: 1,
                    path: "/number".into(),
                }),
            ),
            (
                json!({"a": "x"}),
                vec![step_ref("/a/b", 1, "/number")],
                Err(RefError::MissingPath {
                    step: 1,
                    path: "/number".into(),
                }),
            ),
            (
                json!({"pr": null}),
                vec![step_ref("/pr", 3, "/number")],
                Err(RefError::MissingStep(3)),
            ),
            (
                json!({"pr": null}),
                vec![step_ref("/pr", 1, "/nope")],
                Err(RefError::MissingPath {
                    step: 1,
                    path: "/nope".into(),
                }),
            ),
        ];
        for (args, refs, want) in cases {
            assert_eq!(resolve_refs(&args, &refs, &results), want, "{args}");
        }

        let wire = [
            json!({"decision":"run","step_id":"s1","arguments":{"sha":"abc"},"headers":{"Authorization":"W"}}),
            json!({"decision":"run","step_id":"s1","arguments":{"sha":"abc"},"headers":{"Authorization":"W"},"allowed_hosts":["https://github.example:443"],"follow_redirects":false}),
            json!({"decision":"refuse","message":"Run step 1 first."}),
            json!({"decision":"hold","message":"Waiting for review."}),
        ];
        for v in wire {
            let parsed: ConsumeResponse = serde_json::from_value(v.clone()).unwrap();
            assert_eq!(serde_json::to_value(parsed).unwrap(), v);
        }
        let result = json!({"ok":true,"unknown":false,"result":{"n":1},"error":null});
        let parsed: StepResultInput = serde_json::from_value(result.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), result);
    }

    #[test]
    fn consume_response_debug_hides_header_values_and_shows_pins() {
        let response = ConsumeResponse::Run {
            step_id: "s1".into(),
            arguments: json!({}),
            headers: HashMap::from([("Authorization".into(), "write-secret".into())]),
            allowed_hosts: vec!["https://github.example:443".into()],
            follow_redirects: Some(false),
        };
        let debug = format!("{response:?}");
        assert!(debug.contains("Authorization"));
        assert!(!debug.contains("write-secret"));
        assert!(debug.contains("https://github.example:443"));
        assert!(debug.contains("follow_redirects: Some(false)"));
    }

    #[test]
    fn args_hash_ignores_ref_paths_and_key_order() {
        let refs = [step_ref("/a/sha", 1, "/sha")];
        let a = args_hash(&json!({"b": 1, "a": {"sha": "x"}}), &refs);
        assert_eq!(a, args_hash(&json!({"a": {"sha": "y"}, "b": 1}), &refs));
        assert_ne!(a, args_hash(&json!({"a": {"sha": "x"}, "b": 2}), &refs));
    }

    #[test]
    fn run_state_moves_only_along_the_spine() {
        use RunState::*;
        let cases = [
            (Investigating, WaitingApproval, true),
            (WaitingApproval, Proceeding, true),
            (Proceeding, WaitingApproval, true),
            (Proceeding, NoChange, true),
            (Worse, Investigating, true),
            (Worked, Investigating, true),
            (OutcomeUnknown, Investigating, true),
            (NoChange, Investigating, true),
            (Checking, OutcomeUnknown, true),
            (Worked, Proceeding, false),
            (Lapsed, Proceeding, false),
            (Declined, Investigating, false),
        ];
        for (from, to, ok) in cases {
            assert_eq!(from.can_move_to(to), ok, "{from:?} -> {to:?}");
        }
    }

    #[test]
    fn result_text_shows_the_text_items() {
        let image = json!({"type": "image", "data": "aGk=", "mimeType": "image/png"});
        let text = |t: &str| json!({"type": "text", "text": t});
        let truncated = "{\"content\":[{\"type\":\"text\",\"text\":\"pod restarted\n… Truncated: the full result is 300000 bytes.";
        let cases = [
            (
                "text only",
                json!({"content": [text("pod restarted")]}).to_string(),
                "pod restarted",
            ),
            (
                "mixed",
                json!({"content": [text("one"), image.clone(), text("two")]}).to_string(),
                "one\n\ntwo",
            ),
            ("image only", json!({"content": [image]}).to_string(), ""),
            ("not json", "plain words".to_string(), "plain words"),
            ("truncated json", truncated.to_string(), truncated),
            (
                "error result",
                json!({"isError": true, "content": [text("permission denied")]}).to_string(),
                "permission denied",
            ),
        ];
        for (name, stored, want) in cases {
            let want = if want.is_empty() {
                stored.as_str()
            } else {
                want
            };
            assert_eq!(result_text(&stored), want, "{name}");
        }
    }
}
