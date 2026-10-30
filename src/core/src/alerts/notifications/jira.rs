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

//! Jira destination: one open issue per alert or incident, found by label, then commented on.

use std::{
    sync::{
        Arc, LazyLock,
        atomic::{AtomicI64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow, bail};
use config::{
    meta::{
        alerts::alert::Alert,
        destinations::{Destination, DestinationType, Endpoint, Module},
    },
    utils::{
        base64,
        json::{Map, Value, json},
        ssrf_guard::{
            SsrfGuard, admitted_only_by_allowlist, build_safe_client,
            build_safe_destination_client, find_ssrf_refusal,
        },
    },
};
use dashmap::DashMap;
use db::alerts::destinations::DestinationError;
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};

use super::{NotificationContext, STATUS_RESOLVED};

pub const DESTINATION_TYPE: &str = "jira";

pub const UNSUPPORTED_SENDER: &str =
    "Jira destinations only accept alert, composite alert and incident notifications.";

const REJECTED_TOKEN: &str =
    "Jira rejected the token. Make sure that the email and token belong to the same account.";

const TIMEOUT: Duration = Duration::from_secs(30);

/// Marks every issue OpenObserve made.
const LABEL: &str = "openobserve";

const SUMMARY_MAX_CHARS: usize = 255;

/// Below Data Center's 32,767-character field limit, with room for Jira's own markup.
const DESCRIPTION_MAX_CHARS: usize = 30_000;

const MAX_ROWS: usize = 10;

/// Comments follow the alert's notifications, so a shorter silence floods the issue's watchers.
const MIN_SILENCE_MINUTES: i64 = 10;

const PROJECTS_PAGE: usize = 50;
const PROJECTS_MAX: usize = 1000;

const CREATEMETA_PAGE: usize = 200;
/// Stops a server that never reports its last page.
const CREATEMETA_MAX_PAGES: usize = 20;

/// Jira's search usually catches a new issue within minutes, so 30 bridges even a slow reindex.
const CREATED_TTL: Duration = Duration::from_secs(30 * 60);

/// The key and creation time of the issue this node last made for one (site, project, label).
type CreatedSlot = Arc<tokio::sync::Mutex<Option<(String, Instant)>>>;

/// Find-or-create runs one send per slot at a time, so a lagging search adds no twin.
// ponytail: per node, so two cluster nodes can still both create; a shared lock if that bites.
static CREATED: LazyLock<DashMap<(String, String, String), CreatedSlot>> =
    LazyLock::new(DashMap::new);

/// Unix second after which the next send sweeps idle slots out of `CREATED`.
static NEXT_SWEEP: AtomicI64 = AtomicI64::new(0);

const SWEEP_EVERY_SECS: i64 = 60;

/// Filled by OpenObserve or by its own form controls, so setup never asks for them.
const SETUP_SKIPPED_FIELDS: [&str; 7] = [
    "project",
    "issuetype",
    "summary",
    "description",
    "labels",
    "priority",
    "reporter",
];

const TEST_SUMMARY: &str = "[Test] OpenObserve connection test";

/// Body of `POST /{org_id}/alerts/destinations/jira/setup`. No `Debug`: it carries the token.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct SetupRequest {
    pub url: String,
    /// `cloud` or `data_center`.
    pub deployment: String,
    #[serde(default)]
    pub email: String,
    pub token: String,
    /// A saved destination in this org whose token is used when `token` is empty.
    pub destination: Option<String>,
    /// `connect`, `issue_types`, `fields` or `test_issue`.
    pub action: String,
    #[serde(default)]
    pub project_key: String,
    #[serde(default)]
    pub issue_type_id: String,
    #[serde(default)]
    pub priority_id: String,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub fields: Map<String, Value>,
}

/// One Jira site, reached through the SSRF policy its caller needs.
struct Jira {
    http: reqwest::Client,
    base: String,
    headers: Vec<(String, String)>,
    strict: bool,
}

impl Jira {
    fn new(
        url: &str,
        headers: Vec<(String, String)>,
        skip_tls_verify: bool,
        strict: bool,
    ) -> Result<Self> {
        let builder = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .danger_accept_invalid_certs(skip_tls_verify);
        let http = if strict {
            build_safe_client(builder)?
        } else {
            build_safe_destination_client(builder)?
        };
        Ok(Self {
            http,
            base: url.trim().trim_end_matches('/').to_string(),
            headers,
            strict,
        })
    }

    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        let url = format!("{}{path}", self.base);
        if self.strict {
            SsrfGuard::validate_url_with_config_async(&url).await
        } else {
            SsrfGuard::validate_destination_url_with_config_async(&url).await
        }
        .map_err(|e| anyhow!(e))?;

        let mut req = self.http.request(method, &url);
        for (key, value) in &self.headers {
            if !key.is_empty() && !value.is_empty() {
                req = req.header(key, value);
            }
        }
        if let Some(body) = body {
            req = req.json(&body);
        }
        let resp = req.send().await.map_err(|e| self.unreachable(&e))?;
        let status = resp.status();
        let hide_body = admitted_only_by_allowlist(&resp);
        let text = resp.text().await.map_err(|e| self.unreachable(&e))?;
        if !status.is_success() {
            return Err(anyhow!(status_error(
                status,
                if hide_body { "" } else { &text }
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| anyhow!("{} did not answer like a Jira server.", self.base))
    }

    fn unreachable(&self, e: &reqwest::Error) -> anyhow::Error {
        if let Some(refusal) = find_ssrf_refusal(e) {
            return anyhow!(refusal.to_string());
        }
        let reason = if e.is_timeout() {
            format!("no answer within {} seconds", TIMEOUT.as_secs())
        } else {
            // The innermost cause names the problem; the outer ones repeat the URL.
            let mut cause: &dyn std::error::Error = e;
            while let Some(next) = cause.source() {
                cause = next;
            }
            cause.to_string()
        };
        anyhow!("Connection to {} failed: {reason}", self.base)
    }
}

pub fn is_jira(endpoint: &Endpoint) -> bool {
    endpoint.destination_type.as_deref() == Some(DESTINATION_TYPE)
}

/// Comment on the open issue for this alert or incident, or create one; a recovery never creates.
pub async fn send(endpoint: &Endpoint, ctx: &NotificationContext) -> Result<String> {
    let meta = |key: &str| endpoint.metadata.get(key).map_or("", String::as_str);
    let project_key = meta("jira_project_key");
    if project_key.is_empty() {
        bail!("Jira destination has no project key");
    }
    let Some(label) = issue_label(ctx) else {
        bail!("Jira destination has no alert or incident id to find its issue by");
    };
    let headers = endpoint
        .headers
        .iter()
        .flatten()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let jira = Jira::new(&endpoint.url, headers, endpoint.skip_tls_verify, false)?;

    let slot = created_slot(&jira.base, project_key, &label);
    let mut created = slot.lock().await;
    let remembered = created
        .as_ref()
        .filter(|(_, at)| at.elapsed() < CREATED_TTL)
        .map(|(key, _)| key.clone());
    if let Some(key) = remembered
        && still_open(&jira, &key).await
    {
        drop(created);
        return comment_on(&jira, &key, ctx).await;
    }
    *created = None;

    let search = if meta("jira_deployment") == "data_center" {
        "/rest/api/2/search"
    } else {
        "/rest/api/2/search/jql"
    };
    let query = json!({"jql": jql(project_key, &label), "fields": ["key"], "maxResults": 1});
    let found = jira.call(Method::POST, search, Some(query)).await?;
    let open = &found["issues"][0];
    if let Some(key) = open["key"].as_str().or_else(|| open["id"].as_str()) {
        drop(created);
        return comment_on(&jira, key, ctx).await;
    }
    if ctx.alert_status == STATUS_RESOLVED {
        return Ok(format!("no open Jira issue with label {label}"));
    }

    let extra = match meta("jira_fields") {
        "" => Map::new(),
        raw => serde_json::from_str(raw)
            .map_err(|e| anyhow!("Jira destination has invalid jira_fields: {e}"))?,
    };
    let mut fields = issue_fields(
        extra,
        project_key,
        meta("jira_issue_type_id"),
        meta("jira_priority_id"),
    );
    fields.insert("summary".into(), json!(summary(ctx)));
    fields.insert("description".into(), json!(description(ctx)));
    fields.insert("labels".into(), json!([LABEL, label]));
    let issue = jira
        .call(
            Method::POST,
            "/rest/api/2/issue",
            Some(json!({ "fields": fields })),
        )
        .await?;
    let key = issue["key"].as_str().unwrap_or_default();
    if !key.is_empty() {
        *created = Some((key.to_string(), Instant::now()));
    }
    Ok(format!("created {key}"))
}

/// The slot for one issue identity; idle slots are swept once a minute so the map stays small.
fn created_slot(base: &str, project_key: &str, label: &str) -> CreatedSlot {
    if sweep_due(&NEXT_SWEEP, chrono::Utc::now().timestamp()) {
        CREATED.retain(|_, slot| {
            Arc::strong_count(slot) > 1
                || slot.try_lock().is_ok_and(|held| {
                    held.as_ref()
                        .is_some_and(|(_, at)| at.elapsed() < CREATED_TTL)
                })
        });
    }
    let key = (base.to_string(), project_key.to_string(), label.to_string());
    Arc::clone(&CREATED.entry(key).or_default())
}

/// True for the one caller that moves `next` past `now`, so concurrent sends sweep once.
fn sweep_due(next: &AtomicI64, now: i64) -> bool {
    let due = next.load(Ordering::Relaxed);
    now >= due
        && next
            .compare_exchange(
                due,
                now + SWEEP_EVERY_SECS,
                Ordering::Relaxed,
                Ordering::Relaxed,
            )
            .is_ok()
}

/// An issue that cannot be read counts as gone, so the search decides instead.
async fn still_open(jira: &Jira, key: &str) -> bool {
    jira.call(
        Method::GET,
        &format!("/rest/api/2/issue/{key}?fields=status"),
        None,
    )
    .await
    .is_ok_and(|issue| issue["fields"]["status"]["statusCategory"]["key"] != "done")
}

async fn comment_on(jira: &Jira, key: &str, ctx: &NotificationContext) -> Result<String> {
    let body = json!({"body": comment(ctx)});
    jira.call(
        Method::POST,
        &format!("/rest/api/2/issue/{key}/comment"),
        Some(body),
    )
    .await?;
    Ok(format!("commented on {key}"))
}

/// Answers the destination form's lookups with the credentials it typed, or the saved token.
pub async fn setup(org_id: &str, req: SetupRequest) -> Result<Value> {
    let cloud = match req.deployment.as_str() {
        "cloud" => true,
        "data_center" => false,
        other => bail!("Unknown Jira type '{other}'. Use cloud or data_center."),
    };
    if req.url.trim().is_empty() || (cloud && req.email.trim().is_empty()) {
        bail!("Enter the Jira URL and, for Jira Cloud, the email.");
    }
    let saved = match saved_destination_name(&req) {
        Some(name) => match crate::alerts::destinations::get(org_id, name).await {
            Ok(saved) => Some(saved),
            Err(DestinationError::NotFound) => None,
            Err(e) => return Err(e.into()),
        },
        None => None,
    };
    let authorization = setup_authorization(&req, cloud, saved.as_ref())?;
    let headers = vec![
        ("Authorization".to_string(), authorization),
        ("Content-Type".to_string(), "application/json".to_string()),
        ("Accept".to_string(), "application/json".to_string()),
    ];
    let jira = Jira::new(&req.url, headers, false, true)?;

    let action = req.action.as_str();
    if matches!(action, "issue_types" | "fields" | "test_issue") && !is_path_safe(&req.project_key)
    {
        bail!("Pick a project first.");
    }
    if matches!(action, "fields" | "test_issue") && !is_path_safe(&req.issue_type_id) {
        bail!("Pick an issue type first.");
    }
    match action {
        "connect" => connect(&jira, cloud).await,
        "issue_types" => {
            let path = format!(
                "/rest/api/2/issue/createmeta/{}/issuetypes",
                req.project_key
            );
            let issue_types: Vec<Value> = all_pages(&jira, &path, "issueTypes")
                .await?
                .iter()
                .filter(|t| t["subtask"].as_bool() != Some(true))
                .map(|t| json!({"id": t["id"], "name": t["name"]}))
                .collect();
            Ok(json!({ "issue_types": issue_types }))
        }
        "fields" => {
            let path = format!(
                "/rest/api/2/issue/createmeta/{}/issuetypes/{}",
                req.project_key, req.issue_type_id
            );
            let fields = all_pages(&jira, &path, "fields").await?;
            Ok(create_screen(&json!({ "fields": fields })))
        }
        "test_issue" => test_issue(&jira, req).await,
        other => bail!("Unknown Jira setup action '{other}'."),
    }
}

/// The saved destination to take the token from, read only when no token was typed.
pub fn saved_destination_name(req: &SetupRequest) -> Option<&str> {
    req.destination
        .as_deref()
        .filter(|name| req.token.trim().is_empty() && !name.is_empty())
}

/// The `Authorization` header for a setup call: from the typed token, else from `saved`.
fn setup_authorization(
    req: &SetupRequest,
    cloud: bool,
    saved: Option<&Destination>,
) -> Result<String> {
    let token = req.token.trim();
    if !token.is_empty() {
        return Ok(if cloud {
            let pair = format!("{}:{token}", req.email.trim());
            format!("Basic {}", base64::encode(&pair))
        } else {
            format!("Bearer {token}")
        });
    }
    if saved_destination_name(req).is_none() {
        bail!(DestinationError::JiraTokenMissing);
    }
    let endpoint = saved
        .and_then(http_endpoint)
        .filter(|saved| same_account(saved, &req.url, &req.deployment, &req.email))
        .ok_or(DestinationError::JiraTokenChanged)?;
    let (_, value) = authorization(endpoint).ok_or(DestinationError::JiraTokenMissing)?;
    Ok(value.clone())
}

/// On a Jira save without a token, keeps the saved one; refused when nothing safe to keep.
pub(crate) fn keep_saved_token(
    new: &mut Destination,
    stored: Option<&Destination>,
) -> Result<(), DestinationError> {
    let Module::Alert {
        destination_type: DestinationType::Http(endpoint),
        ..
    } = &mut new.module
    else {
        return Ok(());
    };
    if !is_jira(endpoint) || authorization(endpoint).is_some() {
        return Ok(());
    }
    let saved = stored
        .and_then(http_endpoint)
        .filter(|saved| is_jira(saved))
        .ok_or(DestinationError::JiraTokenMissing)?;
    let meta = |key: &str| endpoint.metadata.get(key).map_or("", String::as_str);
    if !same_account(
        saved,
        &endpoint.url,
        meta("jira_deployment"),
        meta("jira_email"),
    ) {
        return Err(DestinationError::JiraTokenChanged);
    }
    let (key, value) = authorization(saved).ok_or(DestinationError::JiraTokenMissing)?;
    let headers = endpoint.headers.get_or_insert_with(Default::default);
    headers.retain(|k, _| !k.eq_ignore_ascii_case("authorization"));
    headers.insert(key.clone(), value.clone());
    Ok(())
}

fn http_endpoint(destination: &Destination) -> Option<&Endpoint> {
    match &destination.module {
        Module::Alert {
            destination_type: DestinationType::Http(endpoint),
            ..
        } => Some(endpoint),
        _ => None,
    }
}

/// The `Authorization` header when it holds a value; the name is matched without case.
fn authorization(endpoint: &Endpoint) -> Option<(&String, &String)> {
    endpoint
        .headers
        .iter()
        .flatten()
        .find(|(key, value)| key.eq_ignore_ascii_case("authorization") && !value.trim().is_empty())
}

/// A saved token may only go to the Jira site, type and account it was saved for.
fn same_account(saved: &Endpoint, url: &str, deployment: &str, email: &str) -> bool {
    let meta = |key: &str| saved.metadata.get(key).map_or("", |v| v.trim());
    let base = |url: &str| url.trim().trim_end_matches('/').to_string();
    is_jira(saved)
        && base(&saved.url) == base(url)
        && meta("jira_deployment") == deployment.trim()
        && meta("jira_email") == email.trim()
}

/// Why a Jira destination cannot go on this alert, or `None` when it can.
pub(crate) fn save_refusal(alert: &Alert, destination: &str) -> Option<String> {
    if alert.is_real_time {
        Some(format!(
            "Jira destination '{destination}' does not support real-time alerts yet."
        ))
    } else if alert.query_condition.multi_alert_enabled() {
        Some(format!(
            "Jira destination '{destination}' does not support multi-alert SQL yet. Use a webhook destination, or turn off multi-alert."
        ))
    } else if alert.trigger_condition.silence < MIN_SILENCE_MINUTES {
        Some(format!(
            "Jira destinations need a silence period of {MIN_SILENCE_MINUTES} minutes or more. This stops a comment on every check."
        ))
    } else {
        None
    }
}

async fn connect(jira: &Jira, cloud: bool) -> Result<Value> {
    let me = jira.call(Method::GET, "/rest/api/2/myself", None).await?;
    let mut projects = Vec::new();
    if cloud {
        while projects.len() < PROJECTS_MAX {
            let path = format!(
                "/rest/api/2/project/search?startAt={}&maxResults={PROJECTS_PAGE}",
                projects.len()
            );
            let page = jira.call(Method::GET, &path, None).await?;
            let values = listed(&page, "values");
            projects.extend(values.iter().map(project_entry));
            if values.is_empty() || page["isLast"].as_bool().unwrap_or(true) {
                break;
            }
        }
        projects.truncate(PROJECTS_MAX);
    } else {
        let all = jira.call(Method::GET, "/rest/api/2/project", None).await?;
        projects = all
            .as_array()
            .map_or(&[][..], Vec::as_slice)
            .iter()
            .map(project_entry)
            .collect();
    }
    Ok(json!({
        "display_name": me["displayName"].as_str().unwrap_or_default(),
        "projects": projects,
    }))
}

/// Every item of a paged createmeta list; Data Center ends it with `isLast`, Cloud with `total`.
async fn all_pages(jira: &Jira, path: &str, key: &str) -> Result<Vec<Value>> {
    let mut items = Vec::new();
    for _ in 0..CREATEMETA_MAX_PAGES {
        let page_path = format!(
            "{path}?startAt={}&maxResults={CREATEMETA_PAGE}",
            items.len()
        );
        let page = jira.call(Method::GET, &page_path, None).await?;
        let values = listed(&page, key);
        items.extend_from_slice(values);
        let more = match (page["isLast"].as_bool(), page["total"].as_u64()) {
            (Some(last), _) => !last,
            (None, Some(total)) => (items.len() as u64) < total,
            (None, None) => false,
        };
        if values.is_empty() || !more {
            break;
        }
    }
    Ok(items)
}

async fn test_issue(jira: &Jira, req: SetupRequest) -> Result<Value> {
    let mut fields = issue_fields(
        req.fields,
        &req.project_key,
        &req.issue_type_id,
        &req.priority_id,
    );
    fields.insert("summary".into(), json!(TEST_SUMMARY));
    fields.insert(
        "description".into(),
        json!("OpenObserve created this issue to test its Jira destination. You can delete it."),
    );
    fields.insert("labels".into(), json!([LABEL, "openobserve-test"]));
    let created = jira
        .call(
            Method::POST,
            "/rest/api/2/issue",
            Some(json!({ "fields": fields })),
        )
        .await?;
    let key = created["key"].as_str().unwrap_or_default();
    Ok(json!({"key": key, "url": format!("{}/browse/{key}", jira.base)}))
}

/// `extra` goes in first, so the fields OpenObserve sets always win over it.
fn issue_fields(
    mut extra: Map<String, Value>,
    project_key: &str,
    issue_type_id: &str,
    priority_id: &str,
) -> Map<String, Value> {
    if !priority_id.is_empty() {
        extra.insert("priority".into(), json!({ "id": priority_id }));
    }
    extra.insert("project".into(), json!({ "key": project_key }));
    extra.insert("issuetype".into(), json!({ "id": issue_type_id }));
    extra
}

fn status_error(status: StatusCode, body: &str) -> String {
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return REJECTED_TOKEN.to_string();
    }
    let parsed: Value = serde_json::from_str(body).unwrap_or_default();
    let mut messages: Vec<String> = listed(&parsed, "errorMessages")
        .iter()
        .filter_map(|m| m.as_str().map(str::to_string))
        .collect();
    if let Some(errors) = parsed["errors"].as_object() {
        messages.extend(
            errors
                .values()
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)),
        );
    }
    if messages.is_empty() {
        format!("Jira: HTTP {status}")
    } else {
        format!("Jira: {}", messages.join("; "))
    }
}

/// The list under `key` (Cloud) or `values` (Data Center).
fn listed<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .or_else(|| value.get("values"))
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn project_entry(project: &Value) -> Value {
    json!({"key": project["key"], "name": project["name"]})
}

/// Keys and ids go into URL paths, so anything that could leave the segment is refused.
fn is_path_safe(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn create_screen(meta: &Value) -> Value {
    let fields = listed(meta, "fields");
    let id = |field: &Value| {
        field["fieldId"]
            .as_str()
            .or_else(|| field["key"].as_str())
            .unwrap_or_default()
            .to_string()
    };
    let required_fields: Vec<Value> = fields
        .iter()
        .filter(|f| f["required"].as_bool() == Some(true))
        .filter(|f| f["hasDefaultValue"].as_bool() != Some(true))
        .filter(|f| !SETUP_SKIPPED_FIELDS.contains(&id(f).as_str()))
        .map(|f| {
            json!({
                "id": id(f),
                "name": f["name"],
                "kind": field_kind(&f["schema"]),
                "options": options(f),
            })
        })
        .collect();
    json!({
        "has_labels": fields.iter().any(|f| id(f) == "labels"),
        "priorities": fields.iter().find(|f| id(f) == "priority").map(options).unwrap_or_default(),
        "required_fields": required_fields,
    })
}

fn field_kind(schema: &Value) -> &'static str {
    match (schema["type"].as_str(), schema["items"].as_str()) {
        (Some("string"), _) => "text",
        (Some("number"), _) => "number",
        (Some("option"), _) => "option",
        (Some("array"), Some("option" | "component")) => "options",
        _ => "unsupported",
    }
}

fn options(field: &Value) -> Vec<Value> {
    listed(field, "allowedValues")
        .iter()
        .map(|o| json!({"id": o["id"], "name": o.get("name").unwrap_or(&o["value"])}))
        .collect()
}

fn context_value<'a>(ctx: &'a NotificationContext, key: &str) -> Option<&'a str> {
    ctx.context_attributes
        .iter()
        .rev()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .filter(|v| !v.is_empty())
}

fn issue_label(ctx: &NotificationContext) -> Option<String> {
    if !ctx.incident_id.is_empty() {
        Some(format!("openobserve-incident-{}", ctx.incident_id))
    } else if !ctx.alert_id.is_empty() {
        Some(format!("openobserve-alert-{}", ctx.alert_id))
    } else {
        None
    }
}

fn jql(project_key: &str, label: &str) -> String {
    let quote = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "project = \"{}\" AND labels = \"{}\" AND statusCategory != Done ORDER BY created DESC",
        quote(project_key),
        quote(label)
    )
}

fn cut(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn utc(time: Option<chrono::DateTime<chrono::Utc>>) -> Option<String> {
    time.filter(|t| t.timestamp() > 0)
        .map(|t| t.format("%Y-%m-%d %H:%M UTC").to_string())
}

fn summary(ctx: &NotificationContext) -> String {
    let text = if !ctx.incident_id.is_empty() {
        let title = context_value(ctx, "incident_title").unwrap_or(&ctx.alert_name);
        format!("Incident: {title}")
    } else {
        format!("{} is firing", ctx.alert_name)
    };
    cut(&text, SUMMARY_MAX_CHARS)
}

/// The `(operator, threshold)` evaluated; an aggregate's `alert_threshold` is only its group gate.
fn evaluated_threshold(ctx: &NotificationContext) -> (&str, &str) {
    let level_value = match ctx.alert_level.as_str() {
        "warning" => &ctx.alert_threshold_warn,
        _ => &ctx.alert_threshold_crit,
    };
    // PromQL rule alerts leave every threshold empty, so they still print none.
    let threshold = [level_value, &ctx.alert_threshold_crit, &ctx.alert_threshold]
        .into_iter()
        .find(|v| !v.is_empty())
        .map_or("", |v| v.as_str());
    let operator = if ctx.alert_threshold_operator.is_empty() || ctx.alert_threshold.is_empty() {
        &ctx.alert_operator
    } else {
        &ctx.alert_threshold_operator
    };
    (operator, threshold)
}

fn description(ctx: &NotificationContext) -> String {
    let line = |label: &str, value: &str| (!value.is_empty()).then(|| format!("{label}: {value}"));
    let stream = match ctx.stream_type.as_str() {
        _ if ctx.stream_name.is_empty() => String::new(),
        "" => ctx.stream_name.clone(),
        stream_type => format!("{} ({stream_type})", ctx.stream_name),
    };
    let (operator, threshold) = evaluated_threshold(ctx);
    let condition = if threshold.is_empty() {
        String::new()
    } else {
        format!("{operator} {threshold}")
    };
    let started = utc(ctx
        .alert_start_time_millis
        .parse()
        .ok()
        .and_then(chrono::DateTime::from_timestamp_millis))
    .unwrap_or_default();
    let head = [
        line("Alert", &ctx.alert_name),
        line("Priority", &ctx.alert_priority),
        line("Stream", &stream),
        line("Condition", &condition),
        line("Current value", &ctx.alert_agg_value),
        line("Started", &started),
        line("Alert description", &ctx.alert_description),
        line("View in OpenObserve", &ctx.alert_url),
    ];
    let head = cut(
        &head.into_iter().flatten().collect::<Vec<_>>().join("\n"),
        DESCRIPTION_MAX_CHARS,
    );

    let footer = line("\nSee all rows in OpenObserve", &ctx.alert_url).unwrap_or_default();
    let reserved = format!("\n\nFirst {MAX_ROWS} rows:\n{{noformat}}\n\n{{noformat}}{footer}");
    let mut budget =
        DESCRIPTION_MAX_CHARS.saturating_sub(head.chars().count() + reserved.chars().count());
    let mut rows = Vec::new();
    for row in ctx.rows.iter().take(MAX_ROWS) {
        let row = row_text(row);
        let cost = row.chars().count() + 1;
        if cost > budget {
            break;
        }
        budget -= cost;
        rows.push(row);
    }
    if rows.is_empty() {
        return head;
    }
    format!(
        "{head}\n\nFirst {} rows:\n{{noformat}}\n{}\n{{noformat}}{footer}",
        rows.len(),
        rows.join("\n")
    )
}

/// Drops braces inside keys and values, so no row can close the `{noformat}` block or open a macro.
struct NoBraces;

impl serde_json::ser::Formatter for NoBraces {
    fn write_string_fragment<W: ?Sized + std::io::Write>(
        &mut self,
        writer: &mut W,
        fragment: &str,
    ) -> std::io::Result<()> {
        writer.write_all(fragment.replace(['{', '}'], "").as_bytes())
    }
}

fn row_text(row: &Map<String, Value>) -> String {
    let mut out = Vec::new();
    let _ = row.serialize(&mut serde_json::Serializer::with_formatter(
        &mut out, NoBraces,
    ));
    String::from_utf8(out).unwrap_or_default()
}

fn comment(ctx: &NotificationContext) -> String {
    let link = |label: &str| {
        if ctx.alert_url.is_empty() {
            String::new()
        } else {
            format!(" {label}: {}", ctx.alert_url)
        }
    };
    if !ctx.incident_id.is_empty() {
        let event = context_value(ctx, "incident_event").unwrap_or_default();
        let severity = context_value(ctx, "incident_severity").unwrap_or_default();
        let what = match (event, severity) {
            ("new_alert_correlated", _) if !ctx.alert_name.is_empty() => {
                format!("New alert joined: {}.", ctx.alert_name)
            }
            ("new_alert_correlated", _) => "New alert joined.".to_string(),
            ("severity_escalated" | "severity_changed", "") => "Severity changed.".to_string(),
            ("severity_escalated" | "severity_changed", severity) => {
                format!("Severity changed to {severity}.")
            }
            (other, _) => format!("{}.", sentence_case(other)),
        };
        return format!("[OpenObserve] {what}{}", link("View incident"));
    }

    let at = utc(chrono::DateTime::from_timestamp_micros(
        ctx.alert_trigger_time,
    ))
    .map(|time| format!(" at {time}"))
    .unwrap_or_default();
    if ctx.alert_status == STATUS_RESOLVED {
        return format!(
            "[OpenObserve] Recovered{at}.{}",
            link("View in OpenObserve")
        );
    }
    let value = &ctx.alert_agg_value;
    let (operator, threshold) = evaluated_threshold(ctx);
    let measure = match (value.is_empty(), threshold.is_empty()) {
        (false, false) => format!(" Value {value}, threshold {operator} {threshold}."),
        (false, true) => format!(" Value {value}."),
        (true, false) => format!(" Threshold {operator} {threshold}."),
        (true, true) => String::new(),
    };
    format!(
        "[OpenObserve] Still firing{at}.{measure}{}",
        link("View in OpenObserve")
    )
}

fn sentence_case(event: &str) -> String {
    let text = event.replace('_', " ");
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use config::meta::{alerts::QueryType, destinations::HTTPType};

    use super::*;
    use crate::{alerts::notifications::STATUS_FIRING, ssrf_test_support::isolated};

    type Seen = Arc<Mutex<Vec<(String, Value)>>>;

    fn alert_ctx() -> NotificationContext {
        NotificationContext {
            alert_id: "2nX8bQk3LpT0".into(),
            alert_name: "Checkout 5xx errors".into(),
            alert_status: STATUS_FIRING.into(),
            alert_priority: "P1".into(),
            stream_name: "checkout_logs".into(),
            stream_type: "logs".into(),
            alert_operator: ">".into(),
            alert_threshold: "500".into(),
            alert_agg_value: "812".into(),
            alert_start_time_millis: "1792749600000".into(),
            alert_trigger_time: 1_792_751_400_000_000,
            alert_description: "5xx responses from checkout.".into(),
            alert_url: "https://o2.example.com/s/abc".into(),
            ..Default::default()
        }
    }

    fn incident_ctx(event: &str) -> NotificationContext {
        let mut ctx = alert_ctx();
        ctx.alert_name = "Payment latency".into();
        ctx.incident_id = "inc-7".into();
        ctx.context_attributes = [
            ("incident_id", "inc-7"),
            ("incident_title", "Checkout degraded"),
            ("incident_event", event),
            ("incident_severity", "P1"),
        ]
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .to_vec();
        ctx
    }

    fn row(json: Value) -> Map<String, Value> {
        json.as_object().unwrap().clone()
    }

    #[test]
    fn summary_is_cut_at_255_characters_on_a_char_boundary() {
        let mut ctx = alert_ctx();
        ctx.alert_name = "é".repeat(300);
        let long = summary(&ctx);
        assert_eq!(long.chars().count(), SUMMARY_MAX_CHARS);
        assert!(long.chars().all(|c| c == 'é'));
        assert_eq!(summary(&alert_ctx()), "Checkout 5xx errors is firing");
        assert_eq!(
            summary(&incident_ctx("new_incident_created")),
            "Incident: Checkout degraded"
        );
    }

    #[test]
    fn rows_cannot_close_the_noformat_block() {
        let mut ctx = alert_ctx();
        for msg in [
            "{noformat}[~accountid:5b10a2]",
            "{noformat{noformat}}[~accountid:5b10a2] !http://evil.example/x.png! [click|http://evil.example]",
            "{NOFORMAT}{noformat:title=x}",
        ] {
            ctx.rows = vec![row(json!({"msg": msg, msg: 1}))];
            let text = description(&ctx);
            let inert = msg.replace(['{', '}'], "");
            let kept = format!(r#"{{"msg":"{inert}","{inert}":1}}"#);
            assert_eq!(text.matches("{noformat}").count(), 2, "{text}");
            assert!(text.contains(&format!("\n{kept}\n")), "{text}");
            assert!(text.ends_with("See all rows in OpenObserve: https://o2.example.com/s/abc"));
        }
    }

    #[test]
    fn description_stays_under_the_cap_and_cuts_at_a_row_boundary() {
        let mut ctx = alert_ctx();
        ctx.rows = (0..10)
            .map(|i| row(json!({"i": i, "pad": "x".repeat(7_000)})))
            .collect();
        let text = description(&ctx);
        assert!(text.chars().count() <= DESCRIPTION_MAX_CHARS);
        assert!(text.contains("First 4 rows:"), "{}", &text[..400]);
        let block = text.split("{noformat}").nth(1).unwrap();
        for line in block.trim().lines() {
            serde_json::from_str::<Value>(line).expect("every kept row is whole");
        }
        assert_eq!(block.trim().lines().count(), 4);
    }

    #[test]
    fn a_missing_value_leaves_its_line_out() {
        let mut ctx = alert_ctx();
        ctx.alert_priority.clear();
        ctx.stream_name.clear();
        ctx.alert_agg_value.clear();
        ctx.alert_start_time_millis = "N/A".into();
        let text = description(&ctx);
        for gone in ["Priority", "Stream", "Current value", "Started", "First"] {
            assert!(!text.contains(gone), "{gone} in {text}");
        }
        assert_eq!(
            description(&alert_ctx()),
            "Alert: Checkout 5xx errors\nPriority: P1\nStream: checkout_logs (logs)\n\
             Condition: > 500\nCurrent value: 812\nStarted: 2026-10-23 10:00 UTC\n\
             Alert description: 5xx responses from checkout.\n\
             View in OpenObserve: https://o2.example.com/s/abc"
        );
    }

    #[test]
    fn aggregate_alert_shows_the_evaluated_threshold_not_the_group_gate() {
        let mut ctx = alert_ctx();
        ctx.alert_operator = ">=".into();
        ctx.alert_threshold = "1".into();
        ctx.alert_threshold_crit = "500".into();
        ctx.alert_threshold_warn = "300".into();
        ctx.alert_threshold_operator = ">".into();
        assert!(description(&ctx).contains("Condition: > 500\n"));
        assert!(comment(&ctx).contains("Value 812, threshold > 500."));
        ctx.alert_level = "warning".into();
        assert!(description(&ctx).contains("Condition: > 300\n"));
        assert!(comment(&ctx).contains("Value 812, threshold > 300."));
    }

    #[test]
    fn plain_alert_keeps_its_count_threshold() {
        let mut ctx = alert_ctx();
        ctx.alert_threshold_crit = "500".into();
        ctx.alert_threshold_operator = ">".into();
        assert!(description(&ctx).contains("Condition: > 500\n"));
        assert!(comment(&ctx).contains("threshold > 500."));
    }

    #[test]
    fn promql_rule_alert_prints_no_condition() {
        let mut ctx = alert_ctx();
        ctx.alert_threshold.clear();
        ctx.promql_operator = Some(">".into());
        assert!(!description(&ctx).contains("Condition"));
        assert!(comment(&ctx).contains("Value 812."));
    }

    #[test]
    fn comments_print_only_what_the_context_holds() {
        let ctx = alert_ctx();
        assert_eq!(
            comment(&ctx),
            "[OpenObserve] Still firing at 2026-10-23 10:30 UTC. Value 812, threshold > 500. \
             View in OpenObserve: https://o2.example.com/s/abc"
        );
        let bare = NotificationContext {
            alert_status: STATUS_FIRING.into(),
            ..Default::default()
        };
        assert_eq!(comment(&bare), "[OpenObserve] Still firing.");
        let mut recovered = alert_ctx();
        recovered.alert_status = STATUS_RESOLVED.into();
        assert_eq!(
            comment(&recovered),
            "[OpenObserve] Recovered at 2026-10-23 10:30 UTC. View in OpenObserve: https://o2.example.com/s/abc"
        );
        let link = " View incident: https://o2.example.com/s/abc";
        for (event, said) in [
            ("new_alert_correlated", "New alert joined: Payment latency."),
            ("severity_escalated", "Severity changed to P1."),
            ("severity_changed", "Severity changed to P1."),
            ("new_incident_created", "New incident created."),
        ] {
            assert_eq!(
                comment(&incident_ctx(event)),
                format!("[OpenObserve] {said}{link}")
            );
        }
    }

    #[test]
    fn the_issue_is_keyed_on_the_incident_else_the_alert() {
        assert_eq!(
            issue_label(&alert_ctx()).unwrap(),
            "openobserve-alert-2nX8bQk3LpT0"
        );
        assert_eq!(
            issue_label(&incident_ctx("new_incident_created")).unwrap(),
            "openobserve-incident-inc-7"
        );
        assert_eq!(issue_label(&NotificationContext::default()), None);
        let mut claims_incident = alert_ctx();
        claims_incident.context_attributes =
            incident_ctx("new_incident_created").context_attributes;
        assert_eq!(
            issue_label(&claims_incident).unwrap(),
            "openobserve-alert-2nX8bQk3LpT0"
        );
        assert_eq!(summary(&claims_incident), "Checkout 5xx errors is firing");
        assert!(comment(&claims_incident).starts_with("[OpenObserve] Still firing"));
        assert_eq!(
            jql("OPS", "openobserve-alert-2nX8bQk3LpT0"),
            r#"project = "OPS" AND labels = "openobserve-alert-2nX8bQk3LpT0" AND statusCategory != Done ORDER BY created DESC"#
        );
        assert_eq!(
            jql(r#"O"PS"#, "l"),
            r#"project = "O\"PS" AND labels = "l" AND statusCategory != Done ORDER BY created DESC"#
        );
    }

    fn screen_fields() -> Value {
        json!([
            {"fieldId": "summary", "name": "Summary", "required": true, "schema": {"type": "string"}},
            {"fieldId": "reporter", "name": "Reporter", "required": true, "schema": {"type": "user"}},
            {"fieldId": "labels", "name": "Labels", "required": false, "schema": {"type": "array", "items": "string"}},
            {"fieldId": "priority", "name": "Priority", "required": false, "schema": {"type": "priority"},
             "allowedValues": [{"id": "1", "name": "Highest"}]},
            {"fieldId": "customfield_1", "name": "Notes", "required": true, "schema": {"type": "string"}},
            {"fieldId": "customfield_2", "name": "Cost", "required": true, "schema": {"type": "number"}},
            {"fieldId": "customfield_3", "name": "Team", "required": true, "schema": {"type": "option"},
             "allowedValues": [{"id": "10101", "value": "SRE"}]},
            {"fieldId": "components", "name": "Components", "required": true,
             "schema": {"type": "array", "items": "component"}, "allowedValues": [{"id": "5", "name": "API"}]},
            {"fieldId": "customfield_4", "name": "Affected Version", "required": true,
             "schema": {"type": "array", "items": "version"}},
            {"fieldId": "customfield_5", "name": "Defaulted", "required": true, "hasDefaultValue": true,
             "schema": {"type": "string"}},
        ])
    }

    #[test]
    fn create_screen_reads_both_shapes_and_every_kind() {
        let expected = json!({
            "has_labels": true,
            "priorities": [{"id": "1", "name": "Highest"}],
            "required_fields": [
                {"id": "customfield_1", "name": "Notes", "kind": "text", "options": []},
                {"id": "customfield_2", "name": "Cost", "kind": "number", "options": []},
                {"id": "customfield_3", "name": "Team", "kind": "option",
                 "options": [{"id": "10101", "name": "SRE"}]},
                {"id": "components", "name": "Components", "kind": "options",
                 "options": [{"id": "5", "name": "API"}]},
                {"id": "customfield_4", "name": "Affected Version", "kind": "unsupported", "options": []},
            ],
        });
        assert_eq!(
            create_screen(&json!({ "fields": screen_fields() })),
            expected
        );
        assert_eq!(
            create_screen(&json!({ "values": screen_fields() })),
            expected
        );
        let without_labels = json!({"fields": [{"fieldId": "summary", "required": true}]});
        assert_eq!(
            create_screen(&without_labels),
            json!({"has_labels": false, "priorities": [], "required_fields": []})
        );
    }

    #[test]
    fn jira_errors_read_as_plain_messages() {
        assert_eq!(status_error(StatusCode::UNAUTHORIZED, ""), REJECTED_TOKEN);
        assert_eq!(status_error(StatusCode::FORBIDDEN, "{}"), REJECTED_TOKEN);
        assert_eq!(
            status_error(
                StatusCode::BAD_REQUEST,
                r#"{"errorMessages":["Bad JQL"],"errors":{"customfield_10020":"Team is required."}}"#
            ),
            "Jira: Bad JQL; Team is required."
        );
        assert_eq!(
            status_error(StatusCode::NOT_FOUND, "<html>"),
            "Jira: HTTP 404 Not Found"
        );
    }

    #[test]
    fn save_refuses_alerts_jira_cannot_keep_one_issue_for() {
        let mut ok = Alert::default();
        ok.trigger_condition.silence = MIN_SILENCE_MINUTES;
        assert_eq!(save_refusal(&ok, "Jira OPS"), None);

        let mut realtime = ok.clone();
        realtime.is_real_time = true;
        let mut multi = ok.clone();
        multi.query_condition.query_type = QueryType::PromQL;
        multi.query_condition.promql_multi_alert = true;
        let mut noisy = ok.clone();
        noisy.trigger_condition.silence = MIN_SILENCE_MINUTES - 1;
        for (alert, said) in [
            (
                realtime,
                "Jira destination 'Jira OPS' does not support real-time alerts yet.",
            ),
            (
                multi,
                "Jira destination 'Jira OPS' does not support multi-alert SQL yet. Use a webhook destination, or turn off multi-alert.",
            ),
            (
                noisy,
                "Jira destinations need a silence period of 10 minutes or more. This stops a comment on every check.",
            ),
        ] {
            assert_eq!(save_refusal(&alert, "Jira OPS").as_deref(), Some(said));
        }
    }

    const SITE: &str = "https://acme.atlassian.net";
    /// `Basic` of `ops@acme.com:secret`, as the form builds it.
    const SAVED_TOKEN: &str = "Basic b3BzQGFjbWUuY29tOnNlY3JldA==";
    const CHANGED: &str = "Enter the API token again, because the Jira URL, type or email changed.";
    const MISSING: &str = "Enter the Jira API token.";

    fn pairs<T: FromIterator<(String, String)>>(list: &[(&str, &str)]) -> T {
        list.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// A Jira destination as the form saves it; an empty `authorization` sends no header.
    fn jira_dest(url: &str, deployment: &str, email: &str, authorization: &str) -> Destination {
        let mut headers = vec![
            ("Content-Type", "application/json"),
            ("Accept", "application/json"),
        ];
        if !authorization.is_empty() {
            headers.push(("Authorization", authorization));
        }
        Destination {
            org_id: "default".into(),
            name: "Jira OPS".into(),
            module: Module::Alert {
                template: Some("prebuilt_jira".into()),
                destination_type: DestinationType::Http(Endpoint {
                    url: url.into(),
                    method: HTTPType::POST,
                    headers: Some(pairs(&headers)),
                    destination_type: Some(DESTINATION_TYPE.into()),
                    metadata: pairs(&[
                        ("jira_deployment", deployment),
                        ("jira_email", email),
                        ("jira_project_key", "OPS"),
                        ("jira_issue_type_id", "10004"),
                    ]),
                    ..Default::default()
                }),
            },
            ..Default::default()
        }
    }

    fn as_webhook(mut destination: Destination) -> Destination {
        if let Module::Alert {
            destination_type: DestinationType::Http(endpoint),
            ..
        } = &mut destination.module
        {
            endpoint.destination_type = Some("custom".into());
        }
        destination
    }

    fn sent_authorization(destination: &Destination) -> Option<String> {
        http_endpoint(destination)
            .and_then(authorization)
            .map(|(_, value)| value.clone())
    }

    #[test]
    fn an_update_without_a_token_keeps_the_saved_one() {
        let stored = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        let mut update = jira_dest(&format!("{SITE}/"), "cloud", "ops@acme.com", "");
        keep_saved_token(&mut update, Some(&stored)).unwrap();
        assert_eq!(sent_authorization(&update).as_deref(), Some(SAVED_TOKEN));

        let stored = jira_dest(SITE, "data_center", "", "Bearer pat-0123");
        let mut update = jira_dest(SITE, "data_center", "", " ");
        keep_saved_token(&mut update, Some(&stored)).unwrap();
        let endpoint = http_endpoint(&update).unwrap();
        assert_eq!(
            endpoint.headers.as_ref().unwrap()["Authorization"],
            "Bearer pat-0123"
        );
    }

    #[test]
    fn an_update_that_moves_the_token_needs_it_again() {
        let stored = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        for mut update in [
            jira_dest("https://jira.attacker.example", "cloud", "ops@acme.com", ""),
            jira_dest(SITE, "data_center", "ops@acme.com", ""),
            jira_dest(SITE, "cloud", "me@attacker.example", ""),
        ] {
            let err = keep_saved_token(&mut update, Some(&stored)).unwrap_err();
            assert_eq!(err.to_string(), CHANGED);
            assert_eq!(sent_authorization(&update), None);
        }
    }

    #[test]
    fn a_save_with_a_token_keeps_the_one_sent() {
        let stored = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        let new_token = "Basic b3BzQGFjbWUuY29tOm5ldy1zZWNyZXQ=";
        let mut update = jira_dest(
            "https://new.atlassian.net",
            "cloud",
            "ops@acme.com",
            new_token,
        );
        keep_saved_token(&mut update, Some(&stored)).unwrap();
        assert_eq!(sent_authorization(&update).as_deref(), Some(new_token));
    }

    #[test]
    fn a_new_jira_destination_needs_a_token() {
        for token in ["", "  "] {
            let mut new = jira_dest(SITE, "cloud", "ops@acme.com", token);
            let err = keep_saved_token(&mut new, None).unwrap_err();
            assert_eq!(err.to_string(), MISSING);
        }
        let stored_webhook = as_webhook(jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN));
        let mut now_jira = jira_dest(SITE, "cloud", "ops@acme.com", "");
        let err = keep_saved_token(&mut now_jira, Some(&stored_webhook)).unwrap_err();
        assert_eq!(err.to_string(), MISSING);
    }

    #[test]
    fn a_non_jira_destination_is_untouched() {
        let stored = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        let mut webhook = as_webhook(jira_dest(SITE, "cloud", "ops@acme.com", ""));
        keep_saved_token(&mut webhook, Some(&stored)).unwrap();
        keep_saved_token(&mut webhook, None).unwrap();
        assert_eq!(sent_authorization(&webhook), None);
    }

    /// A setup body as the form sends it; an empty `email` means Data Center.
    fn setup_req(token: &str, destination: Option<&str>, url: &str, email: &str) -> SetupRequest {
        let deployment = if email.is_empty() {
            "data_center"
        } else {
            "cloud"
        };
        serde_json::from_value(json!({
            "url": url, "deployment": deployment, "email": email, "token": token,
            "destination": destination, "action": "connect",
            "project_key": "", "issue_type_id": "", "priority_id": "", "fields": {},
        }))
        .unwrap()
    }

    fn resolved(req: &SetupRequest, saved: Option<&Destination>) -> Result<String, String> {
        setup_authorization(req, req.deployment == "cloud", saved).map_err(|e| e.to_string())
    }

    #[test]
    fn setup_builds_the_header_from_a_typed_token() {
        let other = jira_dest(SITE, "cloud", "ops@acme.com", "Basic b3RoZXI=");
        let typed = setup_req(" secret ", Some("Jira OPS"), SITE, "ops@acme.com");
        assert_eq!(resolved(&typed, Some(&other)).as_deref(), Ok(SAVED_TOKEN));
        let dc = setup_req("pat-0123", None, SITE, "");
        assert_eq!(resolved(&dc, None).as_deref(), Ok("Bearer pat-0123"));
    }

    #[test]
    fn setup_uses_the_saved_token_only_for_its_own_site_type_and_email() {
        let cloud = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        let dc = jira_dest(SITE, "data_center", "", "Bearer pat-0123");
        let same = setup_req("", Some("Jira OPS"), &format!("{SITE}/"), "ops@acme.com");
        assert_eq!(resolved(&same, Some(&cloud)).as_deref(), Ok(SAVED_TOKEN));
        let same_dc = setup_req(" ", Some("Jira OPS"), SITE, "");
        assert_eq!(
            resolved(&same_dc, Some(&dc)).as_deref(),
            Ok("Bearer pat-0123")
        );

        let webhook = as_webhook(cloud.clone());
        let saved = Some("Jira OPS");
        for (req, stored) in [
            (
                setup_req("", saved, "https://jira.attacker.example", "ops@acme.com"),
                Some(&cloud),
            ),
            (setup_req("", saved, SITE, ""), Some(&cloud)),
            (
                setup_req("", saved, SITE, "me@attacker.example"),
                Some(&cloud),
            ),
            (setup_req("", saved, SITE, "ops@acme.com"), Some(&webhook)),
            (setup_req("", Some("Gone"), SITE, "ops@acme.com"), None),
        ] {
            assert_eq!(resolved(&req, stored), Err(CHANGED.to_string()));
        }
    }

    #[test]
    fn setup_without_a_token_or_a_saved_destination_asks_for_the_token() {
        let stored = jira_dest(SITE, "cloud", "ops@acme.com", SAVED_TOKEN);
        for destination in [None, Some("")] {
            let req = setup_req("", destination, SITE, "ops@acme.com");
            assert_eq!(resolved(&req, Some(&stored)), Err(MISSING.to_string()));
        }
    }

    /// A Jira site that finds `open`, puts OPS-142 in `category`, logs calls, pages createmeta.
    async fn jira_site(open: Option<&'static str>, category: &'static str) -> (String, Seen) {
        let seen: Seen = Arc::default();
        let log = seen.clone();
        let app = axum::Router::new().fallback(
            move |method: axum::http::Method, uri: axum::http::Uri, body: String| {
                let log = log.clone();
                async move {
                    let body = serde_json::from_str(&body).unwrap_or_default();
                    log.lock()
                        .unwrap()
                        .push((format!("{method} {}", uri.path()), body));
                    let second = uri
                        .query()
                        .is_some_and(|q| q.split('&').any(|p| p == "startAt=1"));
                    axum::Json(match (uri.path(), second) {
                        ("/rest/api/2/search/jql", _) => {
                            json!({"issues": open.map_or(vec![], |key| vec![json!({"key": key})])})
                        }
                        ("/rest/api/2/issue", _) => json!({"key": "OPS-142"}),
                        ("/rest/api/2/issue/OPS-142", _) => json!({
                            "key": "OPS-142",
                            "fields": {"status": {"statusCategory": {"key": category}}},
                        }),
                        ("/rest/api/2/issue/createmeta/OPS/issuetypes", false) => json!({
                            "issueTypes": [{"id": "10001", "name": "Task"}],
                            "startAt": 0, "maxResults": 1, "total": 2,
                        }),
                        ("/rest/api/2/issue/createmeta/OPS/issuetypes", true) => json!({
                            "issueTypes": [{"id": "10004", "name": "Bug"}],
                            "startAt": 1, "maxResults": 1, "total": 2,
                        }),
                        ("/rest/api/2/issue/createmeta/OPS/issuetypes/10004", false) => json!({
                            "values": [{"fieldId": "summary", "name": "Summary", "required": true,
                                        "schema": {"type": "string"}}],
                            "isLast": false,
                        }),
                        ("/rest/api/2/issue/createmeta/OPS/issuetypes/10004", true) => json!({
                            "values": [
                                {"fieldId": "labels", "name": "Labels", "required": false,
                                 "schema": {"type": "array", "items": "string"}},
                                {"fieldId": "customfield_1", "name": "Notes", "required": true,
                                 "schema": {"type": "string"}},
                            ],
                            "isLast": true,
                        }),
                        _ => json!({}),
                    })
                }
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, seen)
    }

    fn endpoint(base: String) -> Endpoint {
        Endpoint {
            url: base,
            method: HTTPType::POST,
            headers: Some(
                [("Authorization".to_string(), "Basic dG9rZW4=".to_string())]
                    .into_iter()
                    .collect(),
            ),
            destination_type: Some(DESTINATION_TYPE.into()),
            metadata: [
                ("jira_deployment", "cloud"),
                ("jira_project_key", "OPS"),
                ("jira_issue_type_id", "10004"),
                ("jira_priority_id", "3"),
                (
                    "jira_fields",
                    r#"{"customfield_10020":{"id":"10101"},"summary":"not ours"}"#,
                ),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
            ..Default::default()
        }
    }

    async fn send_to_site(
        open: Option<&'static str>,
        status: &str,
    ) -> (String, Vec<(String, Value)>) {
        let (base, seen) = jira_site(open, "indeterminate").await;
        let mut ctx = alert_ctx();
        ctx.alert_status = status.into();
        let sent = send(&endpoint(base), &ctx).await.unwrap();
        let calls = seen.lock().unwrap().clone();
        (sent, calls)
    }

    #[test]
    fn a_firing_with_no_open_issue_creates_one() {
        isolated(
            concat!(module_path!(), "::a_firing_with_no_open_issue_creates_one"),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (sent, calls) = send_to_site(None, STATUS_FIRING).await;
                assert_eq!(sent, "created OPS-142");
                assert_eq!(calls[0].0, "POST /rest/api/2/search/jql");
                assert_eq!(
                    calls[0].1["jql"],
                    jql("OPS", "openobserve-alert-2nX8bQk3LpT0")
                );
                assert_eq!(calls[1].0, "POST /rest/api/2/issue");
                let fields = &calls[1].1["fields"];
                assert_eq!(fields["project"], json!({"key": "OPS"}));
                assert_eq!(fields["issuetype"], json!({"id": "10004"}));
                assert_eq!(fields["priority"], json!({"id": "3"}));
                assert_eq!(fields["customfield_10020"], json!({"id": "10101"}));
                assert_eq!(fields["summary"], "Checkout 5xx errors is firing");
                assert_eq!(
                    fields["labels"],
                    json!(["openobserve", "openobserve-alert-2nX8bQk3LpT0"])
                );
                assert_eq!(calls.len(), 2);
            },
        );
    }

    #[test]
    fn a_firing_with_an_open_issue_comments_on_it() {
        isolated(
            concat!(
                module_path!(),
                "::a_firing_with_an_open_issue_comments_on_it"
            ),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (sent, calls) = send_to_site(Some("OPS-142"), STATUS_FIRING).await;
                assert_eq!(sent, "commented on OPS-142");
                assert_eq!(calls[1].0, "POST /rest/api/2/issue/OPS-142/comment");
                assert!(
                    calls[1].1["body"]
                        .as_str()
                        .unwrap()
                        .starts_with("[OpenObserve] Still firing")
                );
                assert_eq!(calls.len(), 2);
            },
        );
    }

    #[test]
    fn a_recovery_comments_on_the_open_issue() {
        isolated(
            concat!(module_path!(), "::a_recovery_comments_on_the_open_issue"),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (sent, calls) = send_to_site(Some("OPS-142"), STATUS_RESOLVED).await;
                assert_eq!(sent, "commented on OPS-142");
                assert!(
                    calls[1].1["body"]
                        .as_str()
                        .unwrap()
                        .starts_with("[OpenObserve] Recovered")
                );
                assert_eq!(calls.len(), 2);
            },
        );
    }

    #[test]
    fn a_recovery_with_no_open_issue_does_nothing() {
        isolated(
            concat!(
                module_path!(),
                "::a_recovery_with_no_open_issue_does_nothing"
            ),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (sent, calls) = send_to_site(None, STATUS_RESOLVED).await;
                assert_eq!(
                    sent,
                    "no open Jira issue with label openobserve-alert-2nX8bQk3LpT0"
                );
                assert_eq!(calls.len(), 1);
            },
        );
    }

    fn paths(seen: &Seen) -> Vec<String> {
        seen.lock()
            .unwrap()
            .iter()
            .map(|(c, _)| c.clone())
            .collect()
    }

    #[test]
    fn incident_sends_before_the_search_sees_the_new_issue_create_it_once() {
        isolated(
            concat!(
                module_path!(),
                "::incident_sends_before_the_search_sees_the_new_issue_create_it_once"
            ),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (base, seen) = jira_site(None, "indeterminate").await;
                let endpoint = endpoint(base);
                let (opened, joined) = (
                    incident_ctx("new_incident_created"),
                    incident_ctx("new_alert_correlated"),
                );
                let (first, second) =
                    tokio::join!(send(&endpoint, &opened), send(&endpoint, &joined));
                let mut sent = [first.unwrap(), second.unwrap()];
                sent.sort();
                assert_eq!(sent, ["commented on OPS-142", "created OPS-142"]);
                assert_eq!(
                    paths(&seen),
                    [
                        "POST /rest/api/2/search/jql",
                        "POST /rest/api/2/issue",
                        "GET /rest/api/2/issue/OPS-142",
                        "POST /rest/api/2/issue/OPS-142/comment",
                    ]
                );
            },
        );
    }

    #[test]
    fn a_slow_comment_does_not_hold_up_the_next_send() {
        isolated(
            concat!(
                module_path!(),
                "::a_slow_comment_does_not_hold_up_the_next_send"
            ),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let both_commenting = Arc::new(tokio::sync::Barrier::new(2));
                let app = axum::Router::new().fallback(move |uri: axum::http::Uri| {
                    let both_commenting = both_commenting.clone();
                    async move {
                        if uri.path().ends_with("/comment") {
                            both_commenting.wait().await;
                        }
                        axum::Json(json!({"issues": [{"key": "OPS-142"}]}))
                    }
                });
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let endpoint = endpoint(format!("http://{}", listener.local_addr().unwrap()));
                tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
                let ctx = alert_ctx();
                let (first, second) = tokio::time::timeout(Duration::from_secs(10), async {
                    tokio::join!(send(&endpoint, &ctx), send(&endpoint, &ctx))
                })
                .await
                .expect("the second send waited for the first comment");
                assert_eq!(first.unwrap(), "commented on OPS-142");
                assert_eq!(second.unwrap(), "commented on OPS-142");
            },
        );
    }

    #[test]
    fn idle_slots_are_swept_at_most_once_a_minute() {
        let next = AtomicI64::new(0);
        assert!(sweep_due(&next, 1_000));
        assert!(!sweep_due(&next, 1_000));
        assert!(!sweep_due(&next, 1_059));
        assert!(sweep_due(&next, 1_060));
    }

    #[test]
    fn a_remembered_issue_that_is_done_falls_back_to_the_search() {
        isolated(
            concat!(
                module_path!(),
                "::a_remembered_issue_that_is_done_falls_back_to_the_search"
            ),
            &[("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32")],
            || async {
                let (base, seen) = jira_site(None, "done").await;
                let endpoint = endpoint(base);
                let ctx = incident_ctx("new_incident_created");
                assert_eq!(send(&endpoint, &ctx).await.unwrap(), "created OPS-142");
                assert_eq!(send(&endpoint, &ctx).await.unwrap(), "created OPS-142");
                assert_eq!(
                    paths(&seen),
                    [
                        "POST /rest/api/2/search/jql",
                        "POST /rest/api/2/issue",
                        "GET /rest/api/2/issue/OPS-142",
                        "POST /rest/api/2/search/jql",
                        "POST /rest/api/2/issue",
                    ]
                );
            },
        );
    }

    async fn setup_on_site(action: &str, issue_type_id: &str) -> Value {
        let (base, _) = jira_site(None, "").await;
        let mut req = setup_req("secret", None, &base, "ops@acme.com");
        req.action = action.into();
        req.project_key = "OPS".into();
        req.issue_type_id = issue_type_id.into();
        setup("default", req).await.unwrap()
    }

    #[test]
    fn issue_types_on_a_later_page_are_listed() {
        isolated(
            concat!(module_path!(), "::issue_types_on_a_later_page_are_listed"),
            &[("ZO_SSRF_ALLOW_LOOPBACK", "true")],
            || async {
                assert_eq!(
                    setup_on_site("issue_types", "").await,
                    json!({"issue_types": [
                        {"id": "10001", "name": "Task"},
                        {"id": "10004", "name": "Bug"},
                    ]})
                );
            },
        );
    }

    #[test]
    fn fields_on_a_later_page_are_read() {
        isolated(
            concat!(module_path!(), "::fields_on_a_later_page_are_read"),
            &[("ZO_SSRF_ALLOW_LOOPBACK", "true")],
            || async {
                assert_eq!(
                    setup_on_site("fields", "10004").await,
                    json!({
                        "has_labels": true,
                        "priorities": [],
                        "required_fields": [
                            {"id": "customfield_1", "name": "Notes", "kind": "text", "options": []},
                        ],
                    })
                );
            },
        );
    }
}
