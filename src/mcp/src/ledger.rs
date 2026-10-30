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

//! The assistant's action ledger: which MCP calls change an object, their snapshots, and undo.

use std::sync::{Arc, OnceLock};

use anyhow::{Result, anyhow};
use reqwest::{Method, header::HeaderMap};
use serde_json::{Map, Value, json};
use tokio::sync::OnceCell;

pub const SESSION_HEADER: &str = "x-o2-assistant-session-id";
pub const TURN_HEADER: &str = "x-o2-assistant-turn-id";
/// A snapshot above this is not kept, and the action cannot be undone; fits a MySQL `TEXT`.
pub const SNAPSHOT_MAX_BYTES: usize = 65_535;
pub const UNDO_WINDOW_MICROS: i64 = 24 * 3600 * 1_000_000;
pub const REASON_FAILED: &str = "failed";
pub const REASON_UNSUPPORTED: &str = "unsupported";
pub const REASON_NO_SNAPSHOT: &str = "no_snapshot";
pub const REASON_TOO_LARGE: &str = "too_large";
pub const REASON_HAS_SECRETS: &str = "has_secrets";
pub const REASON_NO_ID: &str = "no_id";
pub const OPERATION_READ: &str = "read";
pub const OPERATION_DELETE: &str = "delete";
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
// POST tools whose last path segment names one of these only read or check.
const READ_SEGMENTS: [&str; 17] = [
    "test",
    "test_send",
    "preview",
    "preview-diff",
    "parse_tree",
    "lookup",
    "stacktrace",
    "output_schema",
    "result_schema",
    "query",
    "query_range",
    "series",
    "labels",
    "explain",
    "validate",
    "export",
    "generate_sql",
];
const READ_PREFIXES: [&str; 4] = ["_search", "_around", "_values", "_correlate"];
// A POST whose path names one of these removes something.
const DELETE_WORDS: [&str; 4] = ["delete", "remove", "purge", "drop"];

static RECORDER: OnceLock<Arc<dyn Recorder>> = OnceLock::new();
static LOOPBACK: OnceCell<(reqwest::Client, url::Url)> = OnceCell::const_new();

/// Who the assistant acts for in one MCP request, from o2-ai's session header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub user_email: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    /// o2-ai's signed approval for this call (`x-o2-approval`), checked by [`crate::approval`].
    pub approval: Option<String>,
}

impl Origin {
    /// `None` without a well-formed session header or an authenticated user.
    pub fn from_headers(headers: &HeaderMap) -> Option<Self> {
        let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        let user_email = header("user_id").filter(|u| !u.is_empty())?;
        let session_id = header(SESSION_HEADER).filter(|s| is_uuid(s))?;
        Some(Self {
            user_email: user_email.to_string(),
            session_id: session_id.to_ascii_lowercase(),
            turn_id: header(TURN_HEADER)
                .filter(|t| is_uuid(t))
                .map(str::to_ascii_lowercase),
            approval: header(crate::approval::APPROVAL_HEADER).map(str::to_string),
        })
    }

    /// [`Self::from_headers`], but `Err` for a garbled assistant claim so it cannot skip approval.
    pub fn checked(headers: &HeaderMap) -> Result<Option<Self>, &'static str> {
        let claims = headers.contains_key(SESSION_HEADER)
            || headers.contains_key(crate::approval::APPROVAL_HEADER);
        match Self::from_headers(headers) {
            None if claims => Err("malformed assistant session or approval header"),
            origin => Ok(origin),
        }
    }
}

/// Stores what [`finish`] hands over; registered once at startup by the enterprise build.
pub trait Recorder: Send + Sync {
    /// Must not block: the MCP answer waits for it.
    fn record(&self, action: Recorded);
}

/// The object types whose changes can be undone, each with its API routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceKind {
    Dashboard,
    Alert,
    Pipeline,
    Function,
    Destination,
}

impl ResourceKind {
    pub const ALL: [Self; 5] = [
        Self::Dashboard,
        Self::Alert,
        Self::Pipeline,
        Self::Function,
        Self::Destination,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dashboard => "dashboard",
            Self::Alert => "alert",
            Self::Pipeline => "pipeline",
            Self::Function => "function",
            Self::Destination => "destination",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    fn collection(self) -> &'static str {
        match self {
            Self::Dashboard => "/api/{org_id}/dashboards",
            Self::Alert => "/api/v2/{org_id}/alerts",
            Self::Pipeline => "/api/{org_id}/pipelines",
            Self::Function => "/api/{org_id}/functions",
            Self::Destination => "/api/{org_id}/alerts/destinations",
        }
    }

    fn item(self) -> &'static str {
        match self {
            Self::Dashboard => "/api/{org_id}/dashboards/{dashboard_id}",
            Self::Alert => "/api/v2/{org_id}/alerts/{alert_id}",
            Self::Pipeline => "/api/{org_id}/pipelines/{pipeline_id}",
            Self::Function => "/api/{org_id}/functions/{name}",
            Self::Destination => "/api/{org_id}/alerts/destinations/{destination_name}",
        }
    }

    fn id_keys(self) -> &'static [&'static str] {
        match self {
            Self::Dashboard => &["dashboardId", "dashboard_id"],
            Self::Alert => &["id", "alert_id"],
            Self::Pipeline => &["pipeline_id", "id"],
            Self::Function | Self::Destination => &["name"],
        }
    }

    fn name_keys(self) -> &'static [&'static str] {
        match self {
            Self::Dashboard => &["title"],
            _ => &["name"],
        }
    }

    /// The object's own fields: a dashboard nests them under `v{version}`.
    fn fields(self, object: &Value) -> Option<&Value> {
        match self {
            Self::Dashboard => {
                let version = object.get("version").and_then(Value::as_i64)?;
                object.get(format!("v{version}"))
            }
            _ => Some(object),
        }
    }

    pub fn object_id(self, object: &Value) -> Option<String> {
        let fields = self.fields(object)?;
        first_string(fields, self.id_keys())
    }

    pub fn object_name(self, object: &Value) -> Option<String> {
        let fields = self.fields(object)?;
        first_string(fields, self.name_keys())
    }

    /// Fields the server moves without anyone editing the object, ignored by "changed since".
    fn server_fields(self) -> &'static [&'static str] {
        match self {
            Self::Alert => &[
                "last_triggered_at",
                "last_satisfied_at",
                "updated_at",
                "last_edited_by",
            ],
            Self::Pipeline => &["version", "paused_at", "last_error", "updated_at"],
            Self::Function => &["streams"],
            Self::Dashboard | Self::Destination => &["updated_at"],
        }
    }

    /// Query parameters an undo sends again; the rest of the original query is never replayed.
    fn replay_query(self) -> &'static [&'static str] {
        match self {
            Self::Dashboard | Self::Alert => &["folder"],
            Self::Pipeline | Self::Function | Self::Destination => &[],
        }
    }

    /// Fields that are a secret whatever their value, e.g. a webhook URL.
    fn secret_fields(self) -> &'static [&'static str] {
        match self {
            Self::Destination => &["url", "metadata"],
            _ => &[],
        }
    }

    /// What "changed since" compares: the object's own fields without the server-maintained ones.
    fn editable(self, object: &Value) -> Option<Value> {
        let mut fields = self.fields(object)?.clone();
        if let Some(map) = fields.as_object_mut() {
            for key in self.server_fields() {
                map.remove(*key);
            }
        }
        Some(fields)
    }

    /// The body that creates or updates the object a GET returned.
    fn write_body(self, object: &Value) -> Option<Value> {
        let mut fields = self.fields(object)?.clone();
        if self == Self::Dashboard
            && let Some(map) = fields.as_object_mut()
        {
            map.insert("version".to_string(), object["version"].clone());
        }
        Some(fields)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Create,
    Update,
    Delete,
    Other,
}

impl Op {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::Delete => "delete",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "create" => Self::Create,
            "update" => Self::Update,
            "delete" => Self::Delete,
            _ => Self::Other,
        }
    }
}

/// What one mutating call changes, decided before it runs.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    org_id: String,
    origin: Origin,
    tool: String,
    op: Op,
    kind: Option<ResourceKind>,
    resource_type: String,
    resource_id: Option<String>,
    query: Map<String, Value>,
    body: Option<Value>,
}

impl Plan {
    /// Updates and deletes read the object first; creates and other calls skip the read.
    pub async fn before(&self, auth: Option<&str>) -> Option<Snapshot> {
        let kind = self.kind?;
        let id = self.resource_id.as_deref()?;
        matches!(self.op, Op::Update | Op::Delete).then_some(())?;
        Some(fetch(kind, &self.org_id, id, auth).await)
    }
}

/// A GET of the target object.
#[derive(Debug, Clone, PartialEq)]
pub enum Snapshot {
    Found(Value),
    Missing,
    Failed,
}

/// One ledger row as the MCP executor saw it; `before`/`after` are redacted JSON envelopes.
#[derive(Debug, Clone, PartialEq)]
pub struct Recorded {
    pub org_id: String,
    pub origin: Origin,
    pub tool: String,
    pub op: Op,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub resource_name: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub ok: bool,
    pub status_code: u16,
    pub undoable: bool,
    pub undo_reason: Option<&'static str>,
}

/// A stored action to reverse; `before`/`after` are the envelopes [`Recorded`] carried.
#[derive(Debug, Clone, Copy)]
pub struct UndoTarget<'a> {
    pub org_id: &'a str,
    pub kind: ResourceKind,
    pub op: Op,
    pub resource_id: &'a str,
    pub before: Option<&'a str>,
    pub after: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UndoOutcome {
    /// The reverse call answered 2xx; `id` is the object's id afterwards, if known.
    Done {
        id: Option<String>,
    },
    /// Someone changed the object after the action; `at` is its own `updated_at`, if any.
    ChangedSince {
        changed_by: Option<String>,
        at: Option<i64>,
    },
    /// The reverse call was refused with this status, e.g. 403 when the caller lost permission.
    Refused(u16),
    Unavailable,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoopbackResponse {
    pub status: u16,
    pub body: Option<Value>,
}

/// One HTTP request to this node's API; `path` holds raw segments, encoded here.
#[derive(Debug, Clone, PartialEq)]
struct Request {
    method: Method,
    segments: Vec<String>,
    query: Map<String, Value>,
    body: Option<Value>,
}

/// One snapshot's stored text and, when it cannot back an undo, why.
type Envelope = (Option<String>, Option<&'static str>);

pub fn set_recorder(recorder: Arc<dyn Recorder>) {
    if RECORDER.set(recorder).is_err() {
        log::warn!("[ai ledger] recorder already set; keeping the first");
    }
}

/// `Some` for a call that may change something and carries the assistant's session.
pub fn plan(
    org_id: &str,
    metadata: &rmcp_openapi::ToolMetadata,
    arguments: &Value,
    origin: Option<&Origin>,
) -> Option<Plan> {
    let origin = origin?;
    let method = metadata.method.to_ascii_uppercase();
    let read_only = super::tools::tool_class(&metadata.name)
        .map_or_else(|| !is_mutating(&method, &metadata.path), |c| c.read_only);
    if read_only {
        return None;
    }
    let kind = ResourceKind::ALL.into_iter().find(|kind| {
        metadata.path == kind.collection()
            || metadata
                .path
                .starts_with(&format!("{}/", kind.collection()))
    });
    let op = kind.map_or(Op::Other, |kind| op_of(kind, &method, &metadata.path));
    let body = arguments.get("request_body").cloned();
    let resource_id = match kind {
        Some(kind) if metadata.path.starts_with(kind.item()) => {
            arg_string(arguments, item_param(kind))
        }
        Some(kind) if op == Op::Update => {
            body.as_ref().and_then(|b| first_string(b, kind.id_keys()))
        }
        _ => None,
    };
    let replayable = kind.map_or(&[][..], ResourceKind::replay_query);
    let query = metadata
        .parameter_mappings
        .iter()
        .filter(|(name, mapping)| {
            mapping.location == "query" && replayable.contains(&name.as_str())
        })
        .filter_map(|(name, _)| Some((name.clone(), arguments.get(name)?.clone())))
        .collect();
    Some(Plan {
        org_id: org_id.to_string(),
        // The approval authorized one call; the ledger never keeps it.
        origin: Origin {
            approval: None,
            ..origin.clone()
        },
        tool: metadata.name.clone(),
        op,
        kind,
        resource_type: kind.map_or_else(
            || resource_type_of(&metadata.path),
            |k| k.as_str().to_string(),
        ),
        resource_id,
        query,
        body,
    })
}

/// Builds the row of a finished call, reading the object back after a create or update.
pub async fn finish(
    plan: Plan,
    before: Option<Snapshot>,
    status_code: u16,
    response_body: &str,
    auth: Option<&str>,
) {
    let ok = (200..300).contains(&status_code);
    let response = serde_json::from_str::<Value>(response_body).ok();
    let resource_id = plan.resource_id.clone().or_else(|| {
        let kind = plan.kind?;
        let from = |v: &Option<Value>| {
            v.as_ref().and_then(|v| {
                kind.object_id(v)
                    .or_else(|| first_string(v, kind.id_keys()))
            })
        };
        from(&response).or_else(|| from(&plan.body))
    });
    let after = match (plan.kind, plan.op, &resource_id) {
        (Some(kind), Op::Create | Op::Update, Some(id)) if ok => {
            Some(fetch(kind, &plan.org_id, id, auth).await)
        }
        _ => None,
    };
    let recorded = recorded(plan, before, after, resource_id, (ok, status_code));
    match RECORDER.get() {
        Some(recorder) => recorder.record(recorded),
        None => log::debug!("[ai ledger] no recorder; action not stored"),
    }
}

/// Reverses `target` as the caller (`auth`), so the API's own permission check decides.
pub async fn undo(target: UndoTarget<'_>, auth: &str) -> UndoOutcome {
    let current = fetch(target.kind, target.org_id, target.resource_id, Some(auth)).await;
    let request = match reverse_request(&target, &current) {
        Ok(request) => request,
        Err(outcome) => return outcome,
    };
    match send(&request, Some(auth)).await {
        Ok(response) if (200..300).contains(&response.status) => UndoOutcome::Done {
            id: undone_id(&target, response.body.as_ref()),
        },
        Ok(response) => {
            log::warn!(
                "[ai ledger] undo of {} {} answered {}",
                target.kind.as_str(),
                target.resource_id,
                response.status
            );
            UndoOutcome::Refused(response.status)
        }
        Err(e) => {
            log::warn!("[ai ledger] undo request failed: {e}");
            UndoOutcome::Unavailable
        }
    }
}

/// What tool `name` does, from its MCP class; `None` for a tool the server lacks.
pub fn tool_operation(name: &str) -> Option<&'static str> {
    super::tools::tool_class(name).map(|class| class.operation)
}

/// Removes every secret-bearing value; `true` when anything was removed.
pub fn redact(value: &mut Value) -> bool {
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

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
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

pub(crate) fn is_mutating(method: &str, path: &str) -> bool {
    match method {
        "PUT" | "PATCH" | "DELETE" => true,
        "POST" => {
            let last = path.rsplit('/').next().unwrap_or_default();
            !(READ_SEGMENTS.contains(&last)
                || path
                    .split('/')
                    .any(|segment| READ_PREFIXES.iter().any(|p| segment.starts_with(p))))
        }
        _ => false,
    }
}

pub(crate) fn operation_of(method: &str, path: &str) -> &'static str {
    let method = method.to_ascii_uppercase();
    let lower = path.to_ascii_lowercase();
    match method.as_str() {
        "DELETE" => OPERATION_DELETE,
        _ if !is_mutating(&method, path) => OPERATION_READ,
        _ if DELETE_WORDS.iter().any(|word| lower.contains(word)) => OPERATION_DELETE,
        "POST" => Op::Create.as_str(),
        _ => Op::Update.as_str(),
    }
}

fn op_of(kind: ResourceKind, method: &str, path: &str) -> Op {
    match (method, path == kind.collection(), path == kind.item()) {
        ("POST", true, _) => Op::Create,
        ("PUT", true, _) if kind == ResourceKind::Pipeline => Op::Update,
        ("PUT", _, true) => Op::Update,
        ("DELETE", _, true) => Op::Delete,
        _ => Op::Other,
    }
}

fn item_param(kind: ResourceKind) -> &'static str {
    kind.item()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .trim_matches(|c| c == '{' || c == '}')
}

/// The first literal segment after the org, e.g. `reports` for `/api/{org_id}/reports/{name}`.
fn resource_type_of(path: &str) -> String {
    path.split('/')
        .skip_while(|segment| *segment != "{org_id}")
        .skip(1)
        .find(|segment| !segment.is_empty() && !segment.starts_with('{'))
        .unwrap_or("unknown")
        .to_string()
}

fn arg_string(arguments: &Value, name: &str) -> Option<String> {
    match arguments.get(name)? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key)?.as_str())
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

/// Redacts and caps one snapshot; a redacted one is kept for reading but cannot be restored.
fn envelope(
    kind: Option<ResourceKind>,
    object: &Value,
    query: Option<&Map<String, Value>>,
) -> Envelope {
    let mut object = object.clone();
    let mut redacted = false;
    if let (Some(kind), Some(map)) = (kind, object.as_object_mut()) {
        for key in kind.secret_fields() {
            if let Some(field) = map.get_mut(*key) {
                redacted |= conceal(field);
            }
        }
    }
    redacted |= redact(&mut object);
    let mut envelope = json!({ "object": object });
    if let Some(query) = query.filter(|q| !q.is_empty()) {
        envelope["query"] = Value::Object(query.clone());
    }
    let text = envelope.to_string();
    if text.len() > SNAPSHOT_MAX_BYTES {
        return (None, Some(REASON_TOO_LARGE));
    }
    (Some(text), redacted.then_some(REASON_HAS_SECRETS))
}

fn recorded(
    plan: Plan,
    before: Option<Snapshot>,
    after: Option<Snapshot>,
    resource_id: Option<String>,
    (ok, status_code): (bool, u16),
) -> Recorded {
    let found = |s: Option<Snapshot>| match s {
        Some(Snapshot::Found(v)) => Some(v),
        _ => None,
    };
    let (before, after) = (found(before), found(after));
    let name = plan.kind.and_then(|kind| {
        [&after, &before, &plan.body]
            .into_iter()
            .flatten()
            .find_map(|v| {
                kind.object_name(v)
                    .or_else(|| first_string(v, kind.name_keys()))
            })
    });
    let before = before.map(|v| envelope(plan.kind, &v, Some(&plan.query)));
    let after = after.map(|v| envelope(plan.kind, &v, None));
    let undo_reason = undo_reason(&plan, ok, resource_id.as_deref(), &before, &after);
    Recorded {
        org_id: plan.org_id,
        origin: plan.origin,
        tool: plan.tool,
        op: plan.op,
        resource_type: plan.resource_type,
        resource_id,
        resource_name: name,
        before: before.and_then(|(text, _)| text),
        after: after.and_then(|(text, _)| text),
        ok,
        status_code,
        undoable: undo_reason.is_none(),
        undo_reason,
    }
}

fn undo_reason(
    plan: &Plan,
    ok: bool,
    resource_id: Option<&str>,
    before: &Option<Envelope>,
    after: &Option<Envelope>,
) -> Option<&'static str> {
    if !ok {
        return Some(REASON_FAILED);
    }
    if plan.kind.is_none() || plan.op == Op::Other {
        return Some(REASON_UNSUPPORTED);
    }
    if resource_id.is_none() {
        return Some(REASON_NO_ID);
    }
    let needed = |snapshot: &Option<Envelope>| match snapshot {
        Some((_, reason)) => *reason,
        None => Some(REASON_NO_SNAPSHOT),
    };
    match plan.op {
        Op::Create => needed(after),
        Op::Update => needed(before).or_else(|| needed(after)),
        Op::Delete => needed(before),
        Op::Other => Some(REASON_UNSUPPORTED),
    }
}

/// The call that reverses `target`, or why it must not run.
fn reverse_request(target: &UndoTarget<'_>, current: &Snapshot) -> Result<Request, UndoOutcome> {
    let parse = |text: Option<&str>| text.and_then(|t| serde_json::from_str::<Value>(t).ok());
    let before = parse(target.before);
    let after = parse(target.after);
    let changed = |current: Option<&Value>| UndoOutcome::ChangedSince {
        changed_by: current.and_then(|c| first_string(c, &["updated_by", "updatedBy", "owner"])),
        at: current.and_then(|c| {
            ["updated_at", "updatedAt"]
                .iter()
                .find_map(|k| c.get(*k)?.as_i64())
        }),
    };
    let kind = target.kind;
    match (target.op, current) {
        (_, Snapshot::Failed) => Err(UndoOutcome::Unavailable),
        (Op::Delete, Snapshot::Found(c)) => Err(changed(Some(c))),
        (Op::Create | Op::Update, Snapshot::Missing) => Err(changed(None)),
        (Op::Create | Op::Update, Snapshot::Found(c))
            if !same_object(kind, after.as_ref().map(|a| &a["object"]), c) =>
        {
            Err(changed(Some(c)))
        }
        (Op::Create, Snapshot::Found(_)) => Ok(Request {
            method: Method::DELETE,
            segments: path_segments(kind.item(), target.org_id, target.resource_id),
            query: Map::new(),
            body: None,
        }),
        (Op::Update | Op::Delete, current) => {
            let before = before.ok_or(UndoOutcome::Refused(400))?;
            let mut body = kind
                .write_body(&before["object"])
                .ok_or(UndoOutcome::Refused(400))?;
            // A pipeline update is refused unless it names the version it replaces.
            if let (Snapshot::Found(c), ResourceKind::Pipeline, Some(map)) =
                (current, kind, body.as_object_mut())
                && let Some(version) = c.get("version")
            {
                map.insert("version".to_string(), version.clone());
            }
            let mut query: Map<String, Value> = before
                .get("query")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter(|(key, _)| kind.replay_query().contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            if let (Snapshot::Found(c), ResourceKind::Dashboard) = (current, kind)
                && let Some(hash) = c.get("hash")
            {
                query.insert("hash".to_string(), hash.clone());
            }
            let (method, template) = match (target.op, kind) {
                (Op::Delete, _) => (Method::POST, kind.collection()),
                (_, ResourceKind::Pipeline) => (Method::PUT, kind.collection()),
                _ => (Method::PUT, kind.item()),
            };
            Ok(Request {
                method,
                segments: path_segments(template, target.org_id, target.resource_id),
                query,
                body: Some(body),
            })
        }
        (Op::Other, _) => Err(UndoOutcome::Refused(400)),
    }
}

/// Whether `current` is still the object the assistant left, ignoring server-maintained fields.
fn same_object(kind: ResourceKind, after: Option<&Value>, current: &Value) -> bool {
    match (after.and_then(|a| kind.editable(a)), kind.editable(current)) {
        (Some(after), Some(current)) => after == current,
        _ => false,
    }
}

fn undone_id(target: &UndoTarget<'_>, response: Option<&Value>) -> Option<String> {
    match target.op {
        Op::Create => None,
        Op::Delete => response
            .and_then(|r| {
                target
                    .kind
                    .object_id(r)
                    .or_else(|| first_string(r, target.kind.id_keys()))
            })
            .or_else(|| Some(target.resource_id.to_string())),
        _ => Some(target.resource_id.to_string()),
    }
}

/// `template` with `{org_id}` and its one id placeholder filled in, split into raw segments.
fn path_segments(template: &str, org_id: &str, id: &str) -> Vec<String> {
    template
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| match segment {
            "{org_id}" => org_id.to_string(),
            s if s.starts_with('{') => id.to_string(),
            s => s.to_string(),
        })
        .collect()
}

async fn fetch(kind: ResourceKind, org_id: &str, id: &str, auth: Option<&str>) -> Snapshot {
    // A function's own GET lists the pipelines using it, so it is found in the list instead.
    let (template, from_list) = match kind {
        ResourceKind::Function => (kind.collection(), true),
        _ => (kind.item(), false),
    };
    let request = Request {
        method: Method::GET,
        segments: path_segments(template, org_id, id),
        query: Map::new(),
        body: None,
    };
    match send(&request, auth).await {
        Ok(LoopbackResponse { status: 404, .. }) => Snapshot::Missing,
        Ok(LoopbackResponse {
            status: 200..=299,
            body: Some(body),
        }) if from_list => body["list"]
            .as_array()
            .and_then(|list| list.iter().find(|f| f["name"] == id))
            .cloned()
            .map_or(Snapshot::Missing, Snapshot::Found),
        Ok(LoopbackResponse {
            status: 200..=299,
            body: Some(body),
        }) => Snapshot::Found(body),
        Ok(response) => {
            log::debug!(
                "[ai ledger] snapshot of {} answered {}",
                kind.as_str(),
                response.status
            );
            Snapshot::Failed
        }
        Err(e) => {
            log::warn!("[ai ledger] snapshot of {} failed: {e}", kind.as_str());
            Snapshot::Failed
        }
    }
}

async fn send(request: &Request, auth: Option<&str>) -> Result<LoopbackResponse> {
    let (client, base) = LOOPBACK
        .get_or_try_init(|| async {
            let (builder, mut base) = super::tools::loopback_client_builder()?;
            if !base.path().ends_with('/') {
                base.set_path(&format!("{}/", base.path()));
            }
            Ok::<_, anyhow::Error>((builder.build()?, base))
        })
        .await?;
    let url = request_url(base, request)?;
    let mut builder = client.request(request.method.clone(), url);
    if let Some(auth) = auth {
        builder = builder.header(reqwest::header::AUTHORIZATION, auth);
    }
    if let Some(body) = &request.body {
        builder = builder.json(body);
    }
    let response = builder.send().await?;
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.ok();
    Ok(LoopbackResponse { status, body })
}

fn request_url(base: &url::Url, request: &Request) -> Result<url::Url> {
    let mut url = base.clone();
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| anyhow!("loopback base URL cannot take a path"))?;
        segments.pop_if_empty();
        for segment in &request.segments {
            segments.push(segment);
        }
    }
    if !request.query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in &request.query {
            match value {
                Value::String(s) => pairs.append_pair(key, s),
                Value::Null => continue,
                other => pairs.append_pair(key, &other.to_string()),
            };
        }
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718";

    fn origin() -> Origin {
        Origin {
            user_email: "a@x".to_string(),
            session_id: SESSION.to_string(),
            turn_id: None,
            approval: None,
        }
    }

    fn tool(
        name: &str,
        method: &str,
        path: &str,
        params: &[(&str, &str)],
    ) -> rmcp_openapi::ToolMetadata {
        rmcp_openapi::ToolMetadata {
            name: name.to_string(),
            title: None,
            description: None,
            parameters: json!({"type": "object"}),
            output_schema: None,
            method: method.to_string(),
            path: path.to_string(),
            security: None,
            parameter_mappings: params
                .iter()
                .map(|(name, location)| {
                    (
                        name.to_string(),
                        rmcp_openapi::tool::ParameterMapping {
                            sanitized_name: name.to_string(),
                            original_name: name.to_string(),
                            location: location.to_string(),
                            explode: false,
                        },
                    )
                })
                .collect(),
        }
    }

    fn planned(method: &str, path: &str, arguments: Value) -> Option<Plan> {
        let metadata = tool(
            "T",
            method,
            path,
            &[("org_id", "path"), ("folder", "query")],
        );
        plan("o", &metadata, &arguments, Some(&origin()))
    }

    fn dashboard(hash: &str, title: &str) -> Value {
        json!({"version": 8, "hash": hash, "updated_at": 7, "v8": {"dashboardId": "d1", "title": title}})
    }

    #[test]
    fn only_a_signed_in_assistant_session_is_an_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(SESSION_HEADER, SESSION.to_uppercase().parse().unwrap());
        assert!(Origin::from_headers(&headers).is_none());
        headers.insert("user_id", "a@x".parse().unwrap());
        assert_eq!(Origin::from_headers(&headers).unwrap().session_id, SESSION);
        headers.insert(SESSION_HEADER, "not-a-session".parse().unwrap());
        assert!(Origin::from_headers(&headers).is_none());
    }

    #[test]
    fn a_garbled_assistant_claim_is_refused_not_ignored() {
        let mut headers = HeaderMap::new();
        assert_eq!(Origin::checked(&headers), Ok(None));
        headers.insert("user_id", "a@x".parse().unwrap());
        headers.insert(
            crate::approval::APPROVAL_HEADER,
            "apr_1.1.ab".parse().unwrap(),
        );
        assert!(Origin::checked(&headers).is_err());
        headers.insert(SESSION_HEADER, "not-a-session".parse().unwrap());
        assert!(Origin::checked(&headers).is_err());
        headers.insert(SESSION_HEADER, SESSION.parse().unwrap());
        assert!(Origin::checked(&headers).unwrap().is_some());
    }

    #[test]
    fn reads_and_calls_without_a_session_are_never_planned() {
        assert!(planned("GET", "/api/{org_id}/dashboards/{dashboard_id}", json!({})).is_none());
        assert!(planned("POST", "/api/{org_id}/_search", json!({})).is_none());
        assert!(planned("POST", "/api/{org_id}/alerts/destinations/test", json!({})).is_none());
        let metadata = tool("T", "DELETE", "/api/v2/{org_id}/alerts/{alert_id}", &[]);
        assert!(plan("o", &metadata, &json!({"alert_id": "a1"}), None).is_none());
    }

    #[test]
    fn each_catalogued_route_names_its_operation_and_target() {
        let update = planned(
            "PUT",
            "/api/{org_id}/dashboards/{dashboard_id}",
            json!({"dashboard_id": "d1", "folder": "f1"}),
        )
        .unwrap();
        assert_eq!(
            (update.op, update.kind),
            (Op::Update, Some(ResourceKind::Dashboard))
        );
        assert_eq!(update.resource_id.as_deref(), Some("d1"));
        assert_eq!(update.query["folder"], "f1");
        let pipeline = planned(
            "PUT",
            "/api/{org_id}/pipelines",
            json!({"request_body": {"pipeline_id": "p1"}}),
        )
        .unwrap();
        assert_eq!(
            (pipeline.op, pipeline.resource_id.as_deref()),
            (Op::Update, Some("p1"))
        );
        let delete = planned(
            "DELETE",
            "/api/v2/{org_id}/alerts/{alert_id}",
            json!({"alert_id": "a1"}),
        )
        .unwrap();
        assert_eq!(
            (delete.op, delete.resource_type.as_str()),
            (Op::Delete, "alert")
        );
        let enable = planned(
            "PATCH",
            "/api/v2/{org_id}/alerts/{alert_id}/enable",
            json!({"alert_id": "a1"}),
        )
        .unwrap();
        assert_eq!(enable.op, Op::Other);
        let report = planned("POST", "/api/{org_id}/reports", json!({})).unwrap();
        assert_eq!(
            (report.kind, report.resource_type.as_str()),
            (None, "reports")
        );
    }

    #[test]
    fn a_delete_keeps_its_before_and_its_query_and_can_be_undone() {
        let plan = planned(
            "DELETE",
            "/api/v2/{org_id}/alerts/{alert_id}",
            json!({"alert_id": "a1", "folder": "f"}),
        )
        .unwrap();
        let before = Snapshot::Found(json!({"id": "a1", "name": "cpu"}));
        let row = recorded(
            plan,
            Some(before),
            None,
            Some("a1".to_string()),
            (true, 200),
        );
        assert!(row.undoable, "{:?}", row.undo_reason);
        assert_eq!(row.resource_name.as_deref(), Some("cpu"));
        let before: Value = serde_json::from_str(row.before.as_deref().unwrap()).unwrap();
        assert_eq!(
            before,
            json!({"object": {"id": "a1", "name": "cpu"}, "query": {"folder": "f"}})
        );
    }

    #[test]
    fn an_action_without_what_undo_needs_says_why() {
        let update = || {
            planned(
                "PUT",
                "/api/v2/{org_id}/alerts/{alert_id}",
                json!({"alert_id": "a1"}),
            )
            .unwrap()
        };
        let found = || Some(Snapshot::Found(json!({"id": "a1"})));
        let failed = recorded(update(), found(), found(), Some("a1".into()), (false, 500));
        assert_eq!(failed.undo_reason, Some(REASON_FAILED));
        let no_after = recorded(update(), found(), None, Some("a1".into()), (true, 200));
        assert_eq!(no_after.undo_reason, Some(REASON_NO_SNAPSHOT));
        let big = Some(Snapshot::Found(
            json!({"id": "a1", "blob": "x".repeat(SNAPSHOT_MAX_BYTES)}),
        ));
        let too_large = recorded(update(), big, found(), Some("a1".into()), (true, 200));
        assert_eq!(too_large.undo_reason, Some(REASON_TOO_LARGE));
        assert!(too_large.before.is_none());
        let other = planned("POST", "/api/{org_id}/reports", json!({})).unwrap();
        let other = recorded(other, None, None, None, (true, 200));
        assert_eq!(other.undo_reason, Some(REASON_UNSUPPORTED));
    }

    #[test]
    fn a_secret_never_reaches_the_ledger_and_its_object_is_not_restorable() {
        let plan = planned(
            "DELETE",
            "/api/{org_id}/alerts/destinations/{destination_name}",
            json!({"destination_name": "hook"}),
        )
        .unwrap();
        let before = Snapshot::Found(json!({
            "name": "hook",
            "url": "https://example.invalid",
            "headers": {"Authorization": "Bearer real"},
            "nested": [{"api_key": "k1"}]
        }));
        let row = recorded(plan, Some(before), None, Some("hook".into()), (true, 200));
        assert_eq!(row.undo_reason, Some(REASON_HAS_SECRETS));
        let text = row.before.unwrap();
        assert!(
            !text.contains("Bearer real")
                && !text.contains("k1")
                && !text.contains("example.invalid"),
            "{text}"
        );
        assert!(text.contains("hook"));
    }

    #[test]
    fn secrets_are_found_by_pattern_and_a_plain_link_is_kept() {
        let mut object = json!({
            "x-api-key": "k",
            "client_secret": "s",
            "access_token": "t",
            "max_rows": 5,
            "links": [
                "https://user:pw@example.com/a",
                "https://example.com/feed?api_key=abc&x=1",
                "https://hooks.slack.com/services/T0/B0/XYZ",
                "https://acme.webhook.office.com/webhookb2/abc",
                "https://example.com/dashboards?folder=f&tab=2"
            ],
            "title": "Latency"
        });
        assert!(redact(&mut object));
        let text = object.to_string();
        for secret in ["\"k\"", "\"s\"", "\"t\"", "pw@", "abc", "XYZ"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        assert!(text.contains("https://example.com/dashboards?folder=f&tab=2"));
        assert_eq!(object["max_rows"], 5);
        let mut plain = json!({"title": "Latency", "link": "https://docs.example.com/x"});
        assert!(!redact(&mut plain));
    }

    #[test]
    fn an_email_destination_can_be_undone_and_a_webhook_one_cannot() {
        let delete = || {
            planned(
                "DELETE",
                "/api/{org_id}/alerts/destinations/{destination_name}",
                json!({"destination_name": "d"}),
            )
            .unwrap()
        };
        let email = Snapshot::Found(json!({"name": "d", "url": "", "emails": ["a@x"]}));
        let row = recorded(delete(), Some(email), None, Some("d".into()), (true, 200));
        assert!(row.undoable, "{:?}", row.undo_reason);
        let hook = Snapshot::Found(
            json!({"name": "d", "url": "https://ops.example.com/in/abc", "metadata": {"k": "v"}}),
        );
        let row = recorded(delete(), Some(hook), None, Some("d".into()), (true, 200));
        assert_eq!(row.undo_reason, Some(REASON_HAS_SECRETS));
        assert!(!row.before.unwrap().contains("ops.example.com"));
    }

    fn target<'a>(
        op: Op,
        kind: ResourceKind,
        before: Option<&'a str>,
        after: Option<&'a str>,
    ) -> UndoTarget<'a> {
        UndoTarget {
            org_id: "o",
            kind,
            op,
            resource_id: "d1",
            before,
            after,
        }
    }

    #[test]
    fn undo_of_a_delete_recreates_and_refuses_when_the_object_is_back() {
        let before =
            json!({"object": dashboard("h0", "Latency"), "query": {"folder": "f"}}).to_string();
        let t = target(Op::Delete, ResourceKind::Dashboard, Some(&before), None);
        let request = reverse_request(&t, &Snapshot::Missing).unwrap();
        assert_eq!(request.method, Method::POST);
        assert_eq!(request.segments, ["api", "o", "dashboards"]);
        assert_eq!(request.query["folder"], "f");
        assert_eq!(
            request.body.unwrap(),
            json!({"dashboardId": "d1", "title": "Latency", "version": 8})
        );
        let back = reverse_request(&t, &Snapshot::Found(dashboard("h9", "Latency"))).unwrap_err();
        assert_eq!(
            back,
            UndoOutcome::ChangedSince {
                changed_by: None,
                at: Some(7)
            }
        );
    }

    #[test]
    fn undo_of_an_update_reverts_only_while_the_object_is_as_the_assistant_left_it() {
        let before = json!({"object": dashboard("h0", "Old")}).to_string();
        let after = json!({"object": dashboard("h1", "New")}).to_string();
        let t = target(
            Op::Update,
            ResourceKind::Dashboard,
            Some(&before),
            Some(&after),
        );
        let request = reverse_request(&t, &Snapshot::Found(dashboard("h1", "New"))).unwrap();
        assert_eq!(request.method, Method::PUT);
        assert_eq!(request.segments, ["api", "o", "dashboards", "d1"]);
        assert_eq!(request.query["hash"], "h1");
        assert_eq!(request.body.unwrap()["title"], "Old");
        let edited = reverse_request(&t, &Snapshot::Found(dashboard("h2", "Human"))).unwrap_err();
        assert!(matches!(edited, UndoOutcome::ChangedSince { .. }));
        let gone = reverse_request(&t, &Snapshot::Missing).unwrap_err();
        assert!(matches!(gone, UndoOutcome::ChangedSince { at: None, .. }));
        assert_eq!(
            reverse_request(&t, &Snapshot::Failed).unwrap_err(),
            UndoOutcome::Unavailable
        );
    }

    #[test]
    fn an_evaluated_alert_still_reverts_and_an_edited_one_does_not() {
        let alert = |threshold: i64, triggered: Option<i64>| {
            json!({"id": "d1", "name": "cpu", "threshold": threshold, "last_triggered_at": triggered,
                   "last_satisfied_at": triggered, "updated_at": 5, "last_edited_by": "a@x"})
        };
        let before =
            json!({"object": alert(1, None), "query": {"folder": "f", "debug": "x"}}).to_string();
        let after = json!({"object": alert(2, None)}).to_string();
        let t = target(Op::Update, ResourceKind::Alert, Some(&before), Some(&after));
        let request = reverse_request(&t, &Snapshot::Found(alert(2, Some(99)))).unwrap();
        assert_eq!(request.method, Method::PUT);
        assert_eq!(request.body.unwrap()["threshold"], 1);
        assert_eq!(
            request.query,
            json!({"folder": "f"}).as_object().unwrap().clone()
        );
        let edited = reverse_request(&t, &Snapshot::Found(alert(3, Some(99)))).unwrap_err();
        assert!(matches!(edited, UndoOutcome::ChangedSince { .. }));
        let created = target(Op::Create, ResourceKind::Alert, None, Some(&after));
        assert!(reverse_request(&created, &Snapshot::Found(alert(2, Some(99)))).is_ok());
    }

    #[test]
    fn only_the_folder_of_the_original_query_is_kept() {
        let metadata = tool(
            "UpdateAlert",
            "PUT",
            "/api/v2/{org_id}/alerts/{alert_id}",
            &[
                ("alert_id", "path"),
                ("folder", "query"),
                ("overwrite", "query"),
            ],
        );
        let arguments = json!({"alert_id": "a1", "folder": "f", "overwrite": true});
        let plan = plan("o", &metadata, &arguments, Some(&origin())).unwrap();
        assert_eq!(
            plan.query,
            json!({"folder": "f"}).as_object().unwrap().clone()
        );
        let function = planned(
            "DELETE",
            "/api/{org_id}/functions/{name}",
            json!({"name": "f1", "folder": "f"}),
        )
        .unwrap();
        assert!(function.query.is_empty());
    }

    #[test]
    fn undo_of_a_create_deletes_the_unchanged_object() {
        let after = json!({"object": {"name": "f1", "function": "."}}).to_string();
        let t = UndoTarget {
            resource_id: "f1",
            ..target(Op::Create, ResourceKind::Function, None, Some(&after))
        };
        let request =
            reverse_request(&t, &Snapshot::Found(json!({"name": "f1", "function": "."}))).unwrap();
        assert_eq!(
            (request.method, request.segments),
            (
                Method::DELETE,
                vec![
                    "api".to_string(),
                    "o".into(),
                    "functions".into(),
                    "f1".into()
                ]
            )
        );
    }

    #[test]
    fn a_pipeline_update_is_reverted_through_its_collection_route_at_its_current_version() {
        let pipeline = |name: &str, version: i64| json!({"pipeline_id": "d1", "name": name, "version": version, "paused_at": null});
        let before = json!({"object": pipeline("old", 1)}).to_string();
        let after = json!({"object": pipeline("new", 2)}).to_string();
        let t = target(
            Op::Update,
            ResourceKind::Pipeline,
            Some(&before),
            Some(&after),
        );
        let mut current = pipeline("new", 2);
        current["paused_at"] = json!(77);
        let request = reverse_request(&t, &Snapshot::Found(current)).unwrap();
        assert_eq!(request.segments, ["api", "o", "pipelines"]);
        let body = request.body.unwrap();
        assert_eq!(
            (body["name"].as_str(), body["version"].as_i64()),
            (Some("old"), Some(2))
        );
    }

    #[test]
    fn a_tools_operation_comes_from_its_method_and_path() {
        let cases = [
            ("GET", "/api/{org_id}/dashboards", OPERATION_READ),
            ("POST", "/api/{org_id}/_search", OPERATION_READ),
            ("POST", "/api/{org_id}/dashboards", "create"),
            ("PUT", "/api/{org_id}/dashboards/{dashboard_id}", "update"),
            (
                "PATCH",
                "/api/v2/{org_id}/alerts/{alert_id}/enable",
                "update",
            ),
            (
                "DELETE",
                "/api/v2/{org_id}/alerts/{alert_id}",
                OPERATION_DELETE,
            ),
            (
                "POST",
                "/api/{org_id}/dashboards/bulk/delete",
                OPERATION_DELETE,
            ),
            (
                "PUT",
                "/api/{org_id}/streams/{stream_name}/delete_fields",
                OPERATION_DELETE,
            ),
        ];
        for (method, path, operation) in cases {
            assert_eq!(operation_of(method, path), operation, "{method} {path}");
        }
        assert_eq!(tool_operation("NoSuchTool"), None);
    }

    #[test]
    fn ids_are_sent_as_single_encoded_segments() {
        let base = url::Url::parse("http://localhost:5080/base/").unwrap();
        let request = Request {
            method: Method::GET,
            segments: path_segments(ResourceKind::Function.item(), "o", "a/../b c"),
            query: [("folder".to_string(), json!("x y"))].into_iter().collect(),
            body: None,
        };
        let url = request_url(&base, &request).unwrap();
        assert_eq!(
            url.as_str(),
            "http://localhost:5080/base/api/o/functions/a%2F..%2Fb%20c?folder=x+y"
        );
    }

    /// Answers every request with `body`, so snapshots read it back.
    async fn serve(body: &'static str) -> url::Url {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = url::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await;
                let reply = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(reply.as_bytes()).await;
            }
        });
        base
    }

    #[derive(Default)]
    struct Rows(std::sync::Mutex<Vec<Recorded>>);

    impl Recorder for Rows {
        fn record(&self, action: Recorded) {
            self.0.lock().unwrap().push(action);
        }
    }

    #[tokio::test]
    async fn a_session_call_that_deletes_hands_one_row_with_its_before_to_the_recorder() {
        let base = serve(r#"{"id":"a1","name":"cpu"}"#).await;
        LOOPBACK
            .set((reqwest::Client::new(), base))
            .expect("only this test sets the loopback");
        let rows = Arc::new(Rows::default());
        set_recorder(rows.clone());
        let metadata = tool(
            "DeleteAlert",
            "DELETE",
            "/api/v2/{org_id}/alerts/{alert_id}",
            &[("alert_id", "path")],
        );
        let arguments = json!({"org_id": "o", "alert_id": "a1"});
        assert!(plan("o", &metadata, &arguments, None).is_none());
        let planned = plan("o", &metadata, &arguments, Some(&origin())).unwrap();
        let before = planned.before(Some("Basic x")).await;
        assert_eq!(
            before,
            Some(Snapshot::Found(json!({"id": "a1", "name": "cpu"})))
        );
        finish(planned, before, 200, "{}", Some("Basic x")).await;
        let rows = rows.0.lock().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].origin.user_email, "a@x");
        assert!(rows[0].undoable);
        assert!(rows[0].before.as_deref().unwrap().contains("cpu"));
    }
}
