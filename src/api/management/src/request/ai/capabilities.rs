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

//! What the caller may do with the assistant and whether o2-ai answers (`/ai/capabilities`).

use std::{
    collections::HashMap,
    future::Future,
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::Path,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, SecondsFormat, Utc};
use config::meta::user::UserRole;
use db::user::is_root_user;
use o2_enterprise::enterprise::{
    ai::client::{
        AiAgentClient, DiscoverResponse, HealthResponse, get_agent_client, is_agent_unreachable,
        upstream_error_status,
    },
    common::config::get_config as get_o2_config,
};
use o2_openfga::meta::route_permissions::{ResolvedRoute, resolve_permission};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::{AuthExtractor, UserEmail, extract_auth_str_from_headers};
use serde::Serialize;
use utoipa::ToSchema;

use super::error::{self, AiErrorCode, AiErrorEnvelope};

const HEALTH_TTL: Duration = Duration::from_secs(30);
const TEST_INTERVAL: Duration = Duration::from_secs(10);
// A chat refused as unreachable re-checks o2-ai this often, so a retry after recovery passes.
const UNREACHABLE_RECHECK: Duration = Duration::from_secs(5);
// Stands in for the id segment of a route; resolution never reads it.
const PROBE_ID: &str = "00000000-0000-0000-0000-000000000000";
const UNREACHABLE: &str = "O2 Assistant did not answer its health check";
const NOT_READY: &str = "O2 Assistant answered its health check but is not ready";
const CHAT_UNREACHABLE: &str = "O2 Assistant did not answer a chat request";
const ROUND_TRIP_FAILED: &str = "O2 Assistant answered its health check but not a request";
const ROUND_TRIP_REFUSED: &str = "O2 Assistant refused the credentials of this request";
const ROUND_TRIP_REJECTED: &str = "O2 Assistant rejected this request";
const TURN_VERSIONS_CAPABILITY: &str = "turn_versions";
const SERVER_REFUSED: &str = "O2 Assistant refused this server's internal secret";
const NOT_CONFIGURED: &str = "O2 Assistant is not configured on this server";

static HEALTH: LazyLock<Mutex<HealthCache>> = LazyLock::new(Mutex::default);
// One refresh at a time, so an expired entry costs o2-ai one call and no probe waits for it.
static REFRESHING: AtomicBool = AtomicBool::new(false);
static LAST_TEST: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Mutex::default);

/// `GET /api/{org_id}/ai/capabilities`; every field is optional to the client, absent is unknown.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Capabilities {
    pub health: Health,
    /// The configured model alias o2-ai reports, never a provider id under redaction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    pub redaction_applied: bool,
    pub can_chat: bool,
    pub can_write: bool,
    pub can_share: bool,
    pub can_read_shares: bool,
    pub persistence: bool,
    pub public_links: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<i64>,
    pub agents: Vec<String>,
    pub toolsets: Vec<ToolsetSummary>,
    pub toolset_secret_merge: bool,
    pub policy_enforced: bool,
    /// `GET /ai/chats` honours `q`.
    pub history_search: bool,
    /// `pinned` is stored and `PATCH /ai/chats/{id}` takes `{pinned}`.
    pub history_pins: bool,
    /// `POST /ai/chats/import` moves browser chats to the server.
    pub history_import: bool,
    /// `chat_stream` takes `replaces_turn_id` and o2-ai says it answers versions.
    pub turn_versions: bool,
    /// `POST /ai/feedback` stores the vote with its turn; detail turns carry `feedback`.
    pub feedback_stored: bool,
    /// o2-ai reads typed `attachments[]`; the client's `attachmentsEnabled` reads this.
    pub attachments: bool,
    /// `complete` carries `context_used[]`.
    pub context_used: bool,
    /// Answers follow `context.locale`, so doors need no English-only note.
    pub answer_locale: bool,
    /// `mode: "chat"` with an `incident_id` reaches the interactive incident agent, not RCA.
    pub rca_chat_mode: bool,
    /// Set only when the org turned the assistant off; `can_chat` is then false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<Gate>,
}

impl Capabilities {
    fn new(
        (health, facts): (Health, AgentFacts),
        permissions: Permissions,
        settings: Settings,
        toolsets: Vec<ToolsetSummary>,
    ) -> Self {
        Self {
            health,
            model: facts.model,
            agent_version: facts.agent_version,
            model_provider: facts.model_provider,
            // Nothing on this path redacts what reaches the model yet.
            redaction_applied: false,
            can_chat: permissions.chat,
            can_write: permissions.write,
            can_share: permissions.share,
            can_read_shares: permissions.read_shares,
            persistence: settings.persistence,
            public_links: settings.public_links,
            retention_days: settings.retention_days,
            agents: facts.agents,
            toolsets,
            toolset_secret_merge: true,
            policy_enforced: facts.policy_enforced,
            history_search: settings.persistence,
            history_pins: settings.persistence,
            history_import: settings.persistence,
            turn_versions: settings.persistence && facts.turn_versions,
            feedback_stored: settings.persistence,
            attachments: facts.attachments,
            context_used: facts.context_used,
            answer_locale: facts.answer_locale,
            rca_chat_mode: settings.rca && facts.rca_chat_mode,
            gate: None,
        }
    }

    /// An org that turned the assistant off refuses every turn, so nobody can chat.
    fn off_for_org(mut self) -> Self {
        self.can_chat = false;
        self.gate = Some(Gate::OffForOrg);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Gate {
    OffForOrg,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Health {
    pub status: HealthStatus,
    /// RFC 3339 time of the check this status comes from.
    pub checked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<LastError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
    Unreachable,
    Unknown,
}

/// The latest failure; `message` is a fixed server sentence, never upstream text.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct LastError {
    pub message: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ToolsetSummary {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}

/// `POST /api/{org_id}/ai/capabilities/test`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct TestResult {
    pub ok: bool,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TestError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct TestError {
    pub code: String,
    pub message: String,
}

/// What o2-ai said about itself; kept across a failed check so the version still shows.
#[derive(Debug, Clone, Default, PartialEq)]
struct AgentFacts {
    model: Option<String>,
    agent_version: Option<String>,
    model_provider: Option<String>,
    agents: Vec<String>,
    policy_enforced: bool,
    /// o2-ai's health lists `turn_versions` in `capabilities`: it answers from the given history.
    turn_versions: bool,
    attachments: bool,
    context_used: bool,
    answer_locale: bool,
    rca_chat_mode: bool,
}

impl AgentFacts {
    fn new(health: &HealthResponse, discover: &DiscoverResponse) -> Self {
        let from_health = |value: Option<&str>| value.map(str::to_string);
        Self {
            model: discover.default_model.clone(),
            agent_version: discover
                .agent_version
                .clone()
                .or_else(|| from_health(health.agent_version())),
            model_provider: discover
                .model_provider
                .clone()
                .or_else(|| from_health(health.model_provider())),
            agents: discover.agents.iter().map(|a| a.id.clone()).collect(),
            policy_enforced: discover.policy_enforced,
            turn_versions: agent_capability(health, TURN_VERSIONS_CAPABILITY),
            attachments: discover.attachments,
            context_used: discover.context_used,
            answer_locale: discover.answer_locale,
            rca_chat_mode: discover.rca_chat_mode,
        }
    }
}

/// One check of o2-ai; `error` is what the node-wide cache may record as the last error.
#[derive(Debug, Clone, PartialEq)]
struct Checked {
    status: HealthStatus,
    at: DateTime<Utc>,
    error: Option<(AiErrorCode, &'static str)>,
    round_trip: RoundTrip,
    /// The org whose member's credential `discover` used; its facts are then that org's only.
    facts_org: Option<String>,
}

impl Checked {
    fn unreachable(at: DateTime<Utc>, message: &'static str) -> Self {
        Self {
            status: HealthStatus::Unreachable,
            at,
            error: Some((AiErrorCode::AgentUnavailable, message)),
            round_trip: RoundTrip::Skipped,
            facts_org: None,
        }
    }
}

/// How the `discover()` round trip after a passing health check went.
#[derive(Debug, Clone, PartialEq)]
enum RoundTrip {
    /// Not run: no credential o2-ai should accept was at hand.
    Skipped,
    Answered(AgentFacts),
    /// o2-ai answered a caller's credential with this 4xx; that says nothing about the server.
    Refused(u16),
    Failed,
}

#[derive(Debug, Default)]
struct HealthCache {
    latest: Option<(Instant, HealthStatus, DateTime<Utc>)>,
    last_error: Option<LastError>,
    facts: AgentFacts,
    /// Set once the server's own secret has answered `discover`; org facts are then unused.
    server_facts: bool,
    org_facts: HashMap<String, AgentFacts>,
    /// Each org's last try at its own facts, whatever the outcome, so a failure is not retried.
    org_checked: HashMap<String, Instant>,
}

impl HealthCache {
    /// `org_refresh`: this probe may fill `org_id`'s own facts, so a missing or old entry is stale.
    fn fresh(&self, now: Instant, org_id: &str, org_refresh: bool) -> Option<(Health, AgentFacts)> {
        let young = |at: Instant| now.saturating_duration_since(at) < HEALTH_TTL;
        let (checked, ..) = self.latest?;
        let org_fresh = self.server_facts
            || !org_refresh
            || self.org_checked.get(org_id).is_some_and(|at| young(*at));
        (young(checked) && org_fresh).then(|| self.snapshot(org_id))
    }

    fn record(&mut self, now: Instant, checked: &Checked) -> (Health, AgentFacts) {
        self.latest = Some((now, checked.status, checked.at));
        if let Some((_, message)) = checked.error {
            self.last_error = Some(LastError {
                message: message.to_string(),
                at: rfc3339(checked.at),
            });
        }
        if let RoundTrip::Answered(facts) = &checked.round_trip {
            match &checked.facts_org {
                Some(org_id) => {
                    self.org_facts.insert(org_id.clone(), facts.clone());
                }
                None => {
                    self.facts = facts.clone();
                    self.server_facts = true;
                }
            }
        }
        self.snapshot(checked.facts_org.as_deref().unwrap_or_default())
    }

    fn mark_org_checked(&mut self, now: Instant, org_id: &str) {
        self.org_checked.insert(org_id.to_string(), now);
    }

    fn mark_unreachable(&mut self, now: Instant, at: DateTime<Utc>) {
        self.record(now, &Checked::unreachable(at, CHAT_UNREACHABLE));
    }

    /// The status of a check younger than the TTL; `Unknown` without one.
    fn status_at(&self, now: Instant) -> HealthStatus {
        match self.latest {
            Some((at, status, _)) if now.saturating_duration_since(at) < HEALTH_TTL => status,
            _ => HealthStatus::Unknown,
        }
    }

    /// Whether the last check is old enough to repeat for a chat refused as unreachable.
    fn recheck_due(&self, now: Instant) -> bool {
        self.latest
            .is_none_or(|(at, ..)| now.saturating_duration_since(at) >= UNREACHABLE_RECHECK)
    }

    /// `org_id`'s facts from a member's credential win over the server's own, which no org shapes.
    fn snapshot(&self, org_id: &str) -> (Health, AgentFacts) {
        let (status, checked_at) = self
            .latest
            .map_or((HealthStatus::Unknown, Utc::now()), |(_, status, at)| {
                (status, at)
            });
        let health = Health {
            status,
            checked_at: rfc3339(checked_at),
            last_error: self.last_error.clone(),
        };
        let facts = self.org_facts.get(org_id).unwrap_or(&self.facts);
        (health, facts.clone())
    }
}

/// The one running refresh; dropping it, even on a panic, lets the next one start.
struct RefreshGuard(&'static AtomicBool);

impl RefreshGuard {
    fn begin(flag: &'static AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}

impl Drop for RefreshGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Permissions {
    chat: bool,
    write: bool,
    share: bool,
    read_shares: bool,
    toolsets: bool,
}

/// The route each `can_*` stands for; its own `RoutePermission` decides, so they cannot drift.
#[derive(Debug, Clone, Copy)]
enum Probe {
    Chat,
    Write,
    Share,
    ReadShares,
    Toolsets,
}

impl Probe {
    fn route(self, org_id: &str) -> Option<ResolvedRoute> {
        let (segments, method): (&[&str], &str) = match self {
            Probe::Chat => (&["ai", "chat_stream"], "POST"),
            Probe::Write => (&["ai", "confirm", PROBE_ID], "POST"),
            Probe::Share => (&["ai", "chats", PROBE_ID, "shares"], "POST"),
            Probe::ReadShares => (&["ai", "shared", PROBE_ID], "GET"),
            Probe::Toolsets => (&["ai", "toolsets"], "GET"),
        };
        let path: Vec<&str> = std::iter::once(org_id)
            .chain(segments.iter().copied())
            .collect();
        resolve_permission(&path, method, org_id, "", None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Settings {
    persistence: bool,
    public_links: bool,
    retention_days: Option<i64>,
    /// Incident analysis is on for this deployment, the first bar `POST …/rca` checks.
    rca: bool,
}

impl Settings {
    fn from_config() -> Self {
        let ai = &get_o2_config().ai;
        let persistence = ai.enabled && ai.has_agent_target() && ai.chat_persistence_enabled;
        Self {
            persistence,
            public_links: persistence && config::get_config().public_ai_chat.enabled,
            // 0 means the org's stream default, which this server does not resolve here.
            retention_days: (ai.chat_retention_days > 0).then_some(ai.chat_retention_days),
            rca: get_o2_config().incidents.enabled && get_o2_config().incidents.rca_enabled,
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/capabilities",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiCapabilities",
    summary = "What the caller may do with the assistant",
    description = "Every org member may read it. `can_*` are the caller's permissions on the \
                   routes they describe (chat, approve an action, share, read a share), \
                   evaluated by the same permission check those routes use. `health` comes \
                   from a per-node cache; after 30 s it is refreshed in the background while \
                   the previous result is served. `last_error.message` is a fixed sentence. \
                   No internal URL or secret is returned.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Capabilities", body = Capabilities),
        (status = 403, description = "Not a member of the organization", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_capabilities(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    let user_id = user_email.user_id;
    if !is_member(&org_id, &user_id).await {
        return error::permission_denied("Unauthorized Access");
    }
    let permissions = evaluate(&org_id, |route| route_allowed(&org_id, &user_id, route)).await;
    // Used only without an internal secret, and only for a member o2-ai should accept.
    let discover_auth = if permissions.chat {
        Some(extract_auth_str_from_headers(&headers).await)
    } else {
        None
    };
    let enabled = super::settings::org_ai(&org_id).await.enabled;
    let health = if enabled {
        current_health(&org_id, discover_auth).await
    } else {
        HEALTH.lock().unwrap().snapshot(&org_id)
    };
    let toolsets = if permissions.toolsets {
        toolset_summaries(&org_id).await
    } else {
        Vec::new()
    };
    let capabilities = Capabilities::new(health, permissions, Settings::from_config(), toolsets);
    let capabilities = if enabled {
        capabilities
    } else {
        capabilities.off_for_org()
    };
    Json(capabilities).into_response()
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/capabilities/test",
    context_path = "/api",
    tag = "AI",
    operation_id = "TestAiCapabilities",
    summary = "Check that the assistant answers",
    description = "Org admins and root only. Runs o2-ai's health check and one discovery round \
                   trip, bypassing the health cache and refreshing it. Creates no chat and \
                   spends no credit. At most one test per organization and one per user every \
                   10 s on a node.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Test result", body = TestResult),
        (status = 403, description = "Not an organization admin", body = Object),
        (status = 429, description = "A test of this organization or by this user ran less than 10 s ago (`rate_limited`)", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn test_capabilities(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    if !is_org_admin(&org_id, &user_email.user_id).await {
        return error::permission_denied("Only organization administrators can test the assistant");
    }
    let admitted = admit_test(
        &mut LAST_TEST.lock().unwrap(),
        &org_id,
        &user_email.user_id,
        Instant::now(),
    );
    if let Err(wait) = admitted {
        return AiErrorEnvelope::new(
            AiErrorCode::RateLimited,
            "The assistant was tested moments ago; please wait",
        )
        .retry_after(Some(wait.as_secs().max(1)))
        .into_response();
    }
    let auth = extract_auth_str_from_headers(&headers).await;
    let started = Instant::now();
    let checked = check_agent(&org_id, Some(&auth)).await;
    HEALTH.lock().unwrap().record(Instant::now(), &checked);
    Json(test_result(&checked, started.elapsed())).into_response()
}

/// A chat that could not reach o2-ai says so at once instead of after the cache expires.
pub(crate) fn mark_unreachable() {
    HEALTH
        .lock()
        .unwrap()
        .mark_unreachable(Instant::now(), Utc::now());
}

/// This node's cached view of o2-ai; a known outage is re-checked in the background.
pub(crate) fn cached_health(org_id: &str) -> HealthStatus {
    let (status, due) = {
        let cache = HEALTH.lock().unwrap();
        let now = Instant::now();
        (cache.status_at(now), cache.recheck_due(now))
    };
    if status == HealthStatus::Unreachable
        && due
        && let Some(refresh) = RefreshGuard::begin(&REFRESHING)
    {
        let org = org_id.to_string();
        tokio::spawn(async move {
            let checked = check_agent(&org, None).await;
            HEALTH.lock().unwrap().record(Instant::now(), &checked);
            drop(refresh);
        });
    }
    status
}

/// A persisted turn that could not reach o2-ai marks health as a direct chat does.
pub(crate) fn note_turn_frame(chunk: &[u8]) {
    if is_agent_unreachable_frame(chunk) {
        mark_unreachable();
    }
}

/// Whether this deployment lets chats be shared `(in the org, publicly)`.
pub(crate) fn deployment_sharing() -> (bool, bool) {
    let settings = Settings::from_config();
    (settings.persistence, settings.public_links)
}

/// Whether o2-ai's discovery said it enforces the permission tier and data-sharing level.
pub(crate) fn policy_enforced(org_id: &str) -> bool {
    HEALTH.lock().unwrap().snapshot(org_id).1.policy_enforced
}

/// Whether `user_id` passes the permission check of `method` on `{org_id}/{segments}`.
pub(crate) async fn may(org_id: &str, user_id: &str, segments: &[&str], method: &str) -> bool {
    let path: Vec<&str> = std::iter::once(org_id)
        .chain(segments.iter().copied())
        .collect();
    match resolve_permission(&path, method, org_id, "", None) {
        Some(route) => route_allowed(org_id, user_id, route).await,
        None => false,
    }
}

pub(crate) async fn is_member(org_id: &str, user_id: &str) -> bool {
    is_root_user(user_id)
        || openobserve_core::users::get_user(Some(org_id), user_id)
            .await
            .is_some()
}

/// The handler-side admin rule of the paid-overage PUT: an org admin or root.
pub(crate) async fn is_org_admin(org_id: &str, user_id: &str) -> bool {
    is_root_user(user_id)
        || openobserve_core::users::get_user(Some(org_id), user_id)
            .await
            .is_some_and(|user| matches!(user.role, UserRole::Admin | UserRole::Root))
}

async fn evaluate<F, Fut>(org_id: &str, allowed: F) -> Permissions
where
    F: Fn(ResolvedRoute) -> Fut,
    Fut: Future<Output = bool>,
{
    let can = |probe: Probe| {
        let route = probe.route(org_id);
        let allowed = &allowed;
        async move {
            match route {
                Some(route) => allowed(route).await,
                None => false,
            }
        }
    };
    Permissions {
        chat: can(Probe::Chat).await,
        write: can(Probe::Write).await,
        share: can(Probe::Share).await,
        read_shares: can(Probe::ReadShares).await,
        toolsets: can(Probe::Toolsets).await,
    }
}

/// The auth middleware's decision for `route`: bypass, root, else `check_permissions`.
async fn route_allowed(org_id: &str, user_id: &str, route: ResolvedRoute) -> bool {
    if route.bypass_check || is_root_user(user_id) {
        return true;
    }
    let Some(user) = openobserve_core::users::get_user(Some(org_id), user_id).await else {
        return false;
    };
    let auth_info = AuthExtractor {
        auth: String::new(),
        method: route.method,
        o2_type: route.o2_type,
        org_id: route.org_id,
        bypass_check: false,
        parent_id: route.parent_id,
        use_all_org: route.use_all_org,
        use_self_context: route.use_self_context,
        use_self_parent: route.use_self_parent,
    };
    openobserve_core::authz::check_permissions(&user.email, auth_info, user.role, user.is_external)
        .await
}

/// Never waits on o2-ai once a result exists: an expired one is served while a refresh runs.
async fn current_health(org_id: &str, discover_auth: Option<String>) -> (Health, AgentFacts) {
    let (fresh, checked_before) = {
        let cache = HEALTH.lock().unwrap();
        let org_refresh = discover_auth.is_some();
        (
            cache.fresh(Instant::now(), org_id, org_refresh),
            cache.latest.is_some(),
        )
    };
    if let Some(fresh) = fresh {
        return fresh;
    }
    let Some(refresh) = RefreshGuard::begin(&REFRESHING) else {
        return HEALTH.lock().unwrap().snapshot(org_id);
    };
    let org = org_id.to_string();
    let task = async move {
        let org_refresh = discover_auth.is_some();
        let checked = check_agent(&org, discover_auth.as_deref()).await;
        {
            let mut cache = HEALTH.lock().unwrap();
            let now = Instant::now();
            cache.record(now, &checked);
            if org_refresh {
                cache.mark_org_checked(now, &org);
            }
        }
        drop(refresh);
        HEALTH.lock().unwrap().snapshot(&org)
    };
    if checked_before {
        tokio::spawn(task);
        return HEALTH.lock().unwrap().snapshot(org_id);
    }
    // The node's first check has nothing to serve yet, so only this probe waits for it.
    task.await
}

fn configured_client() -> Option<std::sync::Arc<AiAgentClient>> {
    let ai = &get_o2_config().ai;
    if !(ai.enabled && ai.has_agent_target()) {
        return None;
    }
    get_agent_client()
}

async fn check_agent(org_id: &str, caller_auth: Option<&str>) -> Checked {
    match configured_client() {
        Some(client) => check_with(&client, org_id, caller_auth).await,
        None => Checked {
            status: HealthStatus::Unknown,
            at: Utc::now(),
            error: None,
            round_trip: RoundTrip::Skipped,
            facts_org: None,
        },
    }
}

/// `health()` then `discover()` as this server; the caller's credential only without a secret.
async fn check_with(client: &AiAgentClient, org_id: &str, caller_auth: Option<&str>) -> Checked {
    let at = Utc::now();
    let health = match client.health_as_server().await {
        Ok(health) if health.is_healthy() => health,
        Ok(_) => return Checked::unreachable(at, NOT_READY),
        Err(e) => {
            log::warn!("[ai capabilities] o2-ai health check failed: {e:#}");
            return Checked::unreachable(at, UNREACHABLE);
        }
    };
    let as_server = client.has_internal_secret();
    let discovered = match (as_server, caller_auth) {
        (true, _) => Some(client.discover_as_server().await),
        (false, Some(auth)) => Some(client.discover(auth).await),
        (false, None) => None,
    };
    let (round_trip, error) = match discovered {
        None => (RoundTrip::Skipped, None),
        Some(Ok(discover)) => (
            RoundTrip::Answered(AgentFacts::new(&health, &discover)),
            None,
        ),
        Some(Err(e)) => {
            log::warn!("[ai capabilities] o2-ai discover failed: {e:#}");
            round_trip_failure(&e, as_server)
        }
    };
    Checked {
        status: HealthStatus::Ok,
        at,
        error,
        round_trip,
        facts_org: (!as_server).then(|| org_id.to_string()),
    }
}

/// A caller's 4xx (but 408) is about that caller; a 4xx to the server's own secret is ours.
fn round_trip_failure(
    error: &anyhow::Error,
    as_server: bool,
) -> (RoundTrip, Option<(AiErrorCode, &'static str)>) {
    let status = upstream_error_status(error).filter(|_| !is_agent_unreachable(error));
    match (status, as_server) {
        (Some(status @ 400..=499), false) if status != 408 => (RoundTrip::Refused(status), None),
        (Some(401 | 403), true) => (
            RoundTrip::Failed,
            Some((AiErrorCode::PermissionDenied, SERVER_REFUSED)),
        ),
        _ => (
            RoundTrip::Failed,
            Some((AiErrorCode::AgentUnavailable, ROUND_TRIP_FAILED)),
        ),
    }
}

fn test_result(checked: &Checked, elapsed: Duration) -> TestResult {
    let error = match (checked.status, &checked.round_trip) {
        (HealthStatus::Unknown, _) => Some((AiErrorCode::NotEnabled, NOT_CONFIGURED)),
        (_, RoundTrip::Refused(401 | 403)) => {
            Some((AiErrorCode::PermissionDenied, ROUND_TRIP_REFUSED))
        }
        (_, RoundTrip::Refused(_)) => Some((AiErrorCode::AgentUnavailable, ROUND_TRIP_REJECTED)),
        (HealthStatus::Ok, RoundTrip::Skipped) => {
            Some((AiErrorCode::AgentUnavailable, ROUND_TRIP_FAILED))
        }
        _ => checked.error,
    };
    TestResult {
        ok: error.is_none(),
        duration_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        error: error.map(|(code, message)| TestError {
            code: code.as_str().to_string(),
            message: message.to_string(),
        }),
    }
}

/// `Err` carries the wait until both `org_id` and `user_id` may run their next test.
pub(crate) fn admit_test(
    last: &mut HashMap<String, Instant>,
    org_id: &str,
    user_id: &str,
    now: Instant,
) -> Result<(), Duration> {
    let keys = [format!("org:{org_id}"), format!("user:{user_id}")];
    let wait = keys
        .iter()
        .filter_map(|key| last.get(key))
        .map(|previous| TEST_INTERVAL.saturating_sub(now.saturating_duration_since(*previous)))
        .max()
        .unwrap_or_default();
    if !wait.is_zero() {
        return Err(wait);
    }
    last.retain(|_, at| now.saturating_duration_since(*at) < TEST_INTERVAL);
    for key in keys {
        last.insert(key, now);
    }
    Ok(())
}

/// Ids and names only: listing never decrypts a toolset's secrets.
async fn toolset_summaries(org_id: &str) -> Vec<ToolsetSummary> {
    match infra::table::org_ai_toolsets::list_names(org_id).await {
        Ok(toolsets) => toolsets
            .into_iter()
            .map(|(id, name, enabled)| ToolsetSummary { id, name, enabled })
            .collect(),
        Err(e) => {
            log::warn!("[org_id:{org_id}] capabilities could not list AI toolsets: {e}");
            Vec::new()
        }
    }
}

/// The turn's typed `error` frame for o2-ai not answering, never text that mentions it.
fn is_agent_unreachable_frame(chunk: &[u8]) -> bool {
    const CODE: &str = "agent_unreachable";
    if !chunk.windows(CODE.len()).any(|w| w == CODE.as_bytes()) {
        return false;
    }
    std::str::from_utf8(chunk)
        .into_iter()
        .flat_map(str::lines)
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str::<serde_json::Value>(data).ok())
        .any(|frame| frame["type"] == "error" && frame["error_code"] == CODE)
}

/// Whether o2-ai's health answer lists `name` under `capabilities`.
fn agent_capability(health: &HealthResponse, name: &str) -> bool {
    health
        .extra
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|c| c.iter().any(|v| v.as_str() == Some(name)))
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const ORG: &str = "acme";
    const HISTORY_FLAGS: [&str; 5] = [
        "history_search",
        "history_pins",
        "history_import",
        "turn_versions",
        "feedback_stored",
    ];

    /// Default-role grants of the OpenFGA model, as `(object type, permission)`.
    #[derive(Debug, Clone, Copy)]
    enum Role {
        Admin,
        Editor,
        Viewer,
        User,
        Custom,
    }

    impl Role {
        const ALL: [(Role, &'static str); 5] = [
            (Role::Admin, "admin"),
            (Role::Editor, "editor"),
            (Role::Viewer, "viewer"),
            (Role::User, "user"),
            (Role::Custom, "custom"),
        ];

        fn grants(self, object_type: &str, permission: &str) -> bool {
            // `ai_chat_share` needs an explicit grant; no built-in role but admin holds it.
            let explicit = object_type == "ai_chat_share";
            match self {
                Role::Admin => true,
                Role::Editor => !explicit,
                Role::Viewer => !explicit && matches!(permission, "GET" | "LIST"),
                Role::User => false,
                Role::Custom => matches!(
                    (object_type, permission),
                    ("ai", "PUT") | ("ai_chat_share", "GET")
                ),
            }
        }
    }

    async fn permissions(role: Role) -> Permissions {
        evaluate(ORG, |route: ResolvedRoute| async move {
            let (object_type, object_id) = route.o2_type.split_once(':').unwrap();
            assert_eq!(object_id, ORG);
            role.grants(object_type, &route.method)
        })
        .await
    }

    fn sample_health() -> (Health, AgentFacts) {
        let health = Health {
            status: HealthStatus::Ok,
            checked_at: "2026-10-15T10:00:00Z".to_string(),
            last_error: None,
        };
        let facts = AgentFacts {
            model: Some("default".to_string()),
            agent_version: Some("1.42.0".to_string()),
            model_provider: Some("openai".to_string()),
            agents: vec!["o2-ai".to_string(), "sre".to_string()],
            policy_enforced: false,
            turn_versions: true,
            attachments: true,
            context_used: true,
            answer_locale: true,
            rca_chat_mode: true,
        };
        (health, facts)
    }

    fn sample_settings() -> Settings {
        Settings {
            persistence: true,
            public_links: false,
            retention_days: Some(90),
            rca: true,
        }
    }

    async fn probe(role: Role) -> Value {
        let permissions = permissions(role).await;
        let toolsets = if permissions.toolsets {
            vec![ToolsetSummary {
                id: "t1".to_string(),
                name: "GitHub".to_string(),
                enabled: true,
            }]
        } else {
            Vec::new()
        };
        let probe = Capabilities::new(sample_health(), permissions, sample_settings(), toolsets);
        serde_json::to_value(probe).unwrap()
    }

    fn at() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-15T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn checked(status: HealthStatus, round_trip: RoundTrip) -> Checked {
        let error = (round_trip == RoundTrip::Failed)
            .then_some((AiErrorCode::AgentUnavailable, ROUND_TRIP_FAILED));
        Checked {
            status,
            at: at(),
            error,
            round_trip,
            facts_org: None,
        }
    }

    fn answered() -> RoundTrip {
        RoundTrip::Answered(sample_health().1)
    }

    /// Answers one connection per reply, in order, then closes its port.
    async fn agent(replies: Vec<(&'static str, &'static str)>) -> AiAgentClient {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            for (status, body) in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut head = Vec::new();
                let mut buf = [0u8; 4096];
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = socket.read(&mut buf).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    head.extend_from_slice(&buf[..n]);
                }
                let reply = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        AiAgentClient::new(&base, false).unwrap()
    }

    const HEALTHY: (&str, &str) = ("200 OK", r#"{"status":"healthy"}"#);
    const DISCOVERED: (&str, &str) = (
        "200 OK",
        r#"{"agents":[{"id":"o2-ai","name":"O2","description":"d"}],"policy_enforced":true}"#,
    );

    #[tokio::test]
    async fn each_can_flag_is_the_permission_of_the_route_it_describes() {
        let expected = [
            (Role::Admin, [true, true, true, true, true]),
            (Role::Editor, [true, true, false, false, true]),
            (Role::Viewer, [false, false, false, false, true]),
            (Role::User, [false, false, false, false, false]),
            (Role::Custom, [true, true, false, true, false]),
        ];
        for (role, [chat, write, share, read_shares, toolsets]) in expected {
            let want = Permissions {
                chat,
                write,
                share,
                read_shares,
                toolsets,
            };
            assert_eq!(permissions(role).await, want, "{role:?}");
        }
    }

    #[tokio::test]
    async fn the_probe_resolves_each_target_route_as_its_own_request_would() {
        let seen = Mutex::new(Vec::new());
        evaluate(ORG, |route: ResolvedRoute| {
            seen.lock()
                .unwrap()
                .push((route.o2_type.clone(), route.method.clone()));
            async { false }
        })
        .await;
        let resolved = |path: &[&str], method: &str| {
            let route = resolve_permission(path, method, ORG, "", None).unwrap();
            (route.o2_type, route.method)
        };
        assert_eq!(
            seen.into_inner().unwrap(),
            vec![
                resolved(&[ORG, "ai", "chat_stream"], "POST"),
                resolved(&[ORG, "ai", "confirm", "s1"], "POST"),
                resolved(&[ORG, "ai", "chats", "s1", "shares"], "POST"),
                resolved(&[ORG, "ai", "shared", "tok"], "GET"),
                resolved(&[ORG, "ai", "toolsets"], "GET"),
            ]
        );
        assert_eq!(resolved(&[ORG, "ai", "chat_stream"], "POST").1, "PUT");
        assert_eq!(
            resolved(&[ORG, "ai", "chats", "s1", "shares"], "POST").0,
            format!("ai_chat_share:{ORG}")
        );
    }

    #[tokio::test]
    async fn the_probe_matches_the_shared_fixture_of_each_role() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../web/src/composables/assistant/__fixtures__/capabilities"
        );
        for (role, name) in Role::ALL {
            let path = format!("{dir}/{name}.json");
            let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
            let fixture: Value = serde_json::from_str(&raw).unwrap();
            let mut probed = probe(role).await;
            for key in HISTORY_FLAGS {
                if fixture.get(key).is_none() {
                    assert_eq!(probed[key], probed["persistence"], "{name}.json: {key}");
                    probed.as_object_mut().unwrap().remove(key);
                }
            }
            assert_eq!(probed, fixture, "{name}.json drifted from the probe");
        }
    }

    #[tokio::test]
    async fn the_probe_carries_no_url_or_secret() {
        for (role, _) in Role::ALL {
            let text = probe(role).await.to_string();
            assert!(!text.contains("http"), "{text}");
            assert!(!text.contains("***"), "{text}");
        }
    }

    #[tokio::test]
    async fn an_org_that_is_off_cannot_chat_and_says_so_while_others_carry_no_gate() {
        let permissions = permissions(Role::Admin).await;
        let on = Capabilities::new(sample_health(), permissions, sample_settings(), Vec::new());
        let json = serde_json::to_value(&on).unwrap();
        assert!(json.get("gate").is_none());
        let off = serde_json::to_value(on.off_for_org()).unwrap();
        assert_eq!(off["gate"], "off_for_org");
        assert_eq!(off["can_chat"], false);
        assert_eq!(off["can_write"], json["can_write"]);
    }

    #[test]
    fn neither_handler_creates_a_chat_or_spends_a_credit() {
        let source = include_str!("capabilities.rs");
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        for forbidden in [
            "trial_quota",
            "ai_chat_sessions",
            "ai_chat_turns",
            "spawn_turn",
            ".query",
        ] {
            assert!(!production.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn discover_facts_never_carry_mcp_urls_and_fall_back_to_health() {
        let health: HealthResponse =
            serde_json::from_value(json!({"status": "healthy", "agent_version": "1.0.0"})).unwrap();
        let discover: DiscoverResponse = serde_json::from_value(json!({
            "agents": [{"id": "o2-ai", "name": "O2", "description": "d"}],
            "mcps": [{"name": "o2", "url": "http://internal-mcp:5080/mcp"}],
            "policy_enforced": true
        }))
        .unwrap();
        let facts = AgentFacts::new(&health, &discover);
        assert_eq!(facts.agents, ["o2-ai"]);
        assert_eq!(facts.agent_version.as_deref(), Some("1.0.0"));
        assert!(facts.policy_enforced);
        assert!(!facts.turn_versions);
        assert!(!format!("{facts:?}").contains("http"));
        let versioned: HealthResponse =
            serde_json::from_value(json!({"capabilities": ["turn_versions"]})).unwrap();
        assert!(AgentFacts::new(&versioned, &discover).turn_versions);
        let odd: HealthResponse =
            serde_json::from_value(json!({"capabilities": "turn_versions"})).unwrap();
        assert!(!AgentFacts::new(&odd, &discover).turn_versions);
    }

    #[test]
    fn context_flags_follow_discover_and_default_off_for_older_agents() {
        let health: HealthResponse = serde_json::from_value(json!({"status": "healthy"})).unwrap();
        let agents = json!([{"id": "o2-ai", "name": "O2", "description": "d"}]);
        let current: DiscoverResponse = serde_json::from_value(json!({
            "agents": agents,
            "attachments": true,
            "context_used": true,
            "answer_locale": true
        }))
        .unwrap();
        let facts = AgentFacts::new(&health, &current);
        assert!(facts.attachments && facts.context_used && facts.answer_locale);
        let older: DiscoverResponse = serde_json::from_value(json!({"agents": agents})).unwrap();
        let facts = AgentFacts::new(&health, &older);
        assert!(!facts.attachments && !facts.context_used && !facts.answer_locale);
        assert!(!facts.rca_chat_mode);
    }

    #[tokio::test]
    async fn rca_chat_mode_needs_both_the_deployment_and_the_agent() {
        for (rca, agent, expected) in [
            (true, true, true),
            (true, false, false),
            (false, true, false),
        ] {
            let (health, mut facts) = sample_health();
            facts.rca_chat_mode = agent;
            let settings = Settings {
                rca,
                ..sample_settings()
            };
            let caps = Capabilities::new(
                (health, facts),
                permissions(Role::User).await,
                settings,
                vec![],
            );
            assert_eq!(caps.rca_chat_mode, expected, "rca={rca} agent={agent}");
        }
        let health: HealthResponse = serde_json::from_value(json!({"status": "healthy"})).unwrap();
        let discover: DiscoverResponse =
            serde_json::from_value(json!({"agents": [], "rca_chat_mode": true})).unwrap();
        assert!(AgentFacts::new(&health, &discover).rca_chat_mode);
    }

    #[test]
    fn health_is_served_from_cache_for_its_ttl_then_rechecked() {
        let mut cache = HealthCache::default();
        let start = Instant::now();
        assert!(cache.fresh(start, ORG, false).is_none());

        cache.record(start, &checked(HealthStatus::Ok, answered()));
        let (health, _) = cache
            .fresh(start + HEALTH_TTL - Duration::from_secs(1), ORG, false)
            .unwrap();
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(health.checked_at, "2026-10-15T10:00:00Z");
        assert!(health.last_error.is_none());
        assert!(cache.fresh(start + HEALTH_TTL, ORG, false).is_none());
    }

    #[test]
    fn caller_sourced_facts_go_stale_per_org_on_their_own_clock() {
        let mut cache = HealthCache::default();
        let start = Instant::now();
        let mut org_a = checked(HealthStatus::Ok, answered());
        org_a.facts_org = Some(ORG.to_string());
        cache.record(start, &org_a);
        cache.mark_org_checked(start, ORG);

        let soon = start + Duration::from_secs(5);
        assert!(cache.fresh(soon, ORG, true).is_some());
        // Another org's refresh kept the node fresh, but this org has not been checked yet.
        assert!(cache.fresh(soon, "other", true).is_none());
        // A member who cannot fill them is served the snapshot instead of refreshing each time.
        assert!(cache.fresh(soon, "other", false).is_some());

        // The node is refreshed by another org later on, yet this org's own entry still expires.
        cache.record(
            start + HEALTH_TTL,
            &checked(HealthStatus::Ok, RoundTrip::Skipped),
        );
        assert!(
            cache
                .fresh(start + HEALTH_TTL + Duration::from_secs(1), ORG, true)
                .is_none()
        );

        // Facts from the server's own secret are node-wide, so no org entry is needed.
        let later = start + HEALTH_TTL * 2;
        cache.record(later, &checked(HealthStatus::Ok, answered()));
        assert!(cache.fresh(later, "other", true).is_some());
    }

    #[test]
    fn a_failed_or_refused_org_check_is_not_retried_until_its_ttl_passes() {
        let outcomes = [
            checked(HealthStatus::Ok, RoundTrip::Refused(403)),
            checked(HealthStatus::Ok, RoundTrip::Failed),
            Checked::unreachable(at(), UNREACHABLE),
            checked(HealthStatus::Unknown, RoundTrip::Skipped),
        ];
        for outcome in outcomes {
            let mut cache = HealthCache::default();
            let start = Instant::now();
            let mut good = checked(HealthStatus::Ok, answered());
            good.facts_org = Some(ORG.to_string());
            cache.record(start, &good);
            cache.mark_org_checked(start, ORG);

            let retry = start + HEALTH_TTL;
            assert!(cache.fresh(retry, ORG, true).is_none(), "{outcome:?}");
            let mut failed = outcome.clone();
            failed.facts_org = Some(ORG.to_string());
            cache.record(retry, &failed);
            cache.mark_org_checked(retry, ORG);

            // The next probe inside the TTL is served from the cache, with the last good facts.
            let (_, facts) = cache
                .fresh(retry + Duration::from_secs(1), ORG, true)
                .unwrap_or_else(|| panic!("re-checked after {outcome:?}"));
            assert_eq!(facts.agents, ["o2-ai", "sre"], "{outcome:?}");
            assert!(
                cache.fresh(retry + HEALTH_TTL, ORG, true).is_none(),
                "{outcome:?}"
            );
        }

        // An org whose first check failed is not re-checked on every probe either.
        let mut cache = HealthCache::default();
        let start = Instant::now();
        cache.record(start, &Checked::unreachable(at(), UNREACHABLE));
        cache.mark_org_checked(start, ORG);
        assert!(
            cache
                .fresh(start + Duration::from_secs(1), ORG, true)
                .is_some()
        );
    }

    #[test]
    fn a_known_outage_is_unreachable_until_it_ages_out_and_is_rechecked_soon() {
        let mut cache = HealthCache::default();
        let start = Instant::now();
        assert_eq!(cache.status_at(start), HealthStatus::Unknown);
        assert!(cache.recheck_due(start));
        cache.mark_unreachable(start, Utc::now());
        assert_eq!(
            cache.status_at(start + Duration::from_secs(1)),
            HealthStatus::Unreachable
        );
        assert!(!cache.recheck_due(start + Duration::from_secs(1)));
        assert!(cache.recheck_due(start + UNREACHABLE_RECHECK));
        assert_eq!(cache.status_at(start + HEALTH_TTL), HealthStatus::Unknown);
        cache.record(
            start + Duration::from_secs(2),
            &checked(HealthStatus::Ok, answered()),
        );
        assert_eq!(
            cache.status_at(start + Duration::from_secs(3)),
            HealthStatus::Ok
        );
    }

    #[test]
    fn a_chat_that_cannot_reach_o2_ai_marks_health_unreachable_at_once() {
        let mut cache = HealthCache::default();
        let start = Instant::now();
        cache.record(start, &checked(HealthStatus::Ok, answered()));
        cache.mark_unreachable(start + Duration::from_secs(1), Utc::now());
        let (health, _) = cache
            .fresh(start + Duration::from_secs(2), ORG, false)
            .unwrap();
        assert_eq!(health.status, HealthStatus::Unreachable);
        assert_eq!(health.last_error.unwrap().message, CHAT_UNREACHABLE);

        // The error stays as the last one seen after o2-ai recovers.
        cache.record(
            start + Duration::from_secs(3),
            &checked(HealthStatus::Ok, answered()),
        );
        let (health, _) = cache.snapshot(ORG);
        assert_eq!(health.status, HealthStatus::Ok);
        assert!(health.last_error.is_some());
    }

    #[test]
    fn a_failed_check_keeps_the_last_known_agent_facts() {
        let mut cache = HealthCache::default();
        let now = Instant::now();
        cache.record(now, &checked(HealthStatus::Ok, answered()));
        let down = Checked::unreachable(at(), UNREACHABLE);
        let (health, facts) = cache.record(now, &down);
        assert_eq!(health.status, HealthStatus::Unreachable);
        assert_eq!(facts, sample_health().1);
    }

    #[test]
    fn a_round_trip_that_did_not_answer_keeps_the_facts_and_a_refusal_is_not_recorded() {
        for round_trip in [
            RoundTrip::Failed,
            RoundTrip::Refused(403),
            RoundTrip::Skipped,
        ] {
            let mut cache = HealthCache::default();
            let now = Instant::now();
            cache.record(now, &checked(HealthStatus::Ok, answered()));
            let (health, facts) = cache.record(now, &checked(HealthStatus::Ok, round_trip.clone()));
            assert_eq!(health.status, HealthStatus::Ok, "{round_trip:?}");
            assert_eq!(facts.agents, ["o2-ai", "sre"], "{round_trip:?}");
            assert_eq!(facts, sample_health().1, "{round_trip:?}");
            // Only a server-side failure becomes the node's last error, never a caller's refusal.
            assert_eq!(
                health.last_error.map(|e| e.message),
                (round_trip == RoundTrip::Failed).then(|| ROUND_TRIP_FAILED.to_string()),
                "{round_trip:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_check_reads_health_then_discover_and_tells_refused_failed_and_unreachable_apart() {
        let answered = check_with(
            &agent(vec![HEALTHY, DISCOVERED]).await,
            ORG,
            Some("Basic x"),
        )
        .await;
        let RoundTrip::Answered(facts) = &answered.round_trip else {
            panic!("{answered:?}");
        };
        assert!(facts.policy_enforced && facts.agents == ["o2-ai"]);
        assert!(test_result(&answered, Duration::ZERO).ok);

        for status in ["401 Unauthorized", "403 Forbidden"] {
            let refused = check_with(
                &agent(vec![HEALTHY, (status, "{}")]).await,
                ORG,
                Some("Basic x"),
            )
            .await;
            assert!(
                matches!(refused.round_trip, RoundTrip::Refused(401 | 403)),
                "{status}"
            );
            assert!(refused.error.is_none(), "{status}");
            let error = test_result(&refused, Duration::ZERO).error.unwrap();
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                ("permission_denied", ROUND_TRIP_REFUSED)
            );
        }

        let failed = check_with(
            &agent(vec![HEALTHY, ("500 Internal Server Error", "{}")]).await,
            ORG,
            Some("Basic x"),
        )
        .await;
        assert_eq!(failed.round_trip, RoundTrip::Failed);
        assert_eq!(
            test_result(&failed, Duration::ZERO).error.unwrap().code,
            "agent_unavailable"
        );

        // The port closes after health, so discover cannot connect: unreachable, not refused.
        let gone = check_with(&agent(vec![HEALTHY]).await, ORG, Some("Basic x")).await;
        assert_eq!(gone.round_trip, RoundTrip::Failed);

        let not_ready = check_with(
            &agent(vec![("200 OK", r#"{"status":"unhealthy"}"#)]).await,
            ORG,
            None,
        )
        .await;
        assert_eq!(not_ready, Checked::unreachable(not_ready.at, NOT_READY));

        let down = check_with(&agent(vec![]).await, ORG, Some("Basic x")).await;
        assert_eq!(down, Checked::unreachable(down.at, UNREACHABLE));

        let skipped = check_with(&agent(vec![HEALTHY]).await, ORG, None).await;
        assert_eq!(skipped.round_trip, RoundTrip::Skipped);
        assert!(skipped.error.is_none());
    }

    #[tokio::test]
    async fn without_a_secret_a_callers_answer_or_4xx_never_becomes_another_orgs_view() {
        let caller =
            |replies| async move { check_with(&agent(replies).await, ORG, Some("Basic x")).await };
        let mut cache = HealthCache::default();
        let now = Instant::now();
        let answered = caller(vec![HEALTHY, DISCOVERED]).await;
        assert_eq!(answered.facts_org.as_deref(), Some(ORG));
        let (_, mine) = cache.record(now, &answered);
        assert_eq!(mine.agents, ["o2-ai"]);
        assert!(
            cache.snapshot("other").1.agents.is_empty(),
            "facts stay with their org"
        );

        for status in ["400 Bad Request", "404 Not Found", "429 Too Many Requests"] {
            let rejected = caller(vec![HEALTHY, (status, "{}")]).await;
            assert!(
                matches!(rejected.round_trip, RoundTrip::Refused(_)),
                "{status}"
            );
            let (health, _) = cache.record(now, &rejected);
            assert!(health.last_error.is_none(), "{status}");
            let error = test_result(&rejected, Duration::ZERO).error.unwrap();
            assert_eq!(error.message, ROUND_TRIP_REJECTED, "{status}");
        }

        // A timeout is the server's, so it is still the node's last error.
        let timed_out = caller(vec![HEALTHY, ("408 Request Timeout", "{}")]).await;
        assert_eq!(timed_out.round_trip, RoundTrip::Failed);
        let (health, _) = cache.record(now, &timed_out);
        assert_eq!(health.last_error.unwrap().message, ROUND_TRIP_FAILED);
    }

    #[tokio::test]
    async fn with_an_internal_secret_the_check_never_uses_the_callers_credential() {
        let server = |replies| async move { agent(replies).await.with_internal_secret("s3cret") };
        let answered = check_with(&server(vec![HEALTHY, DISCOVERED]).await, ORG, None).await;
        assert!(matches!(answered.round_trip, RoundTrip::Answered(_)));

        // Refusing the server's own secret is the server's fault, so it is recorded.
        let refused = check_with(
            &server(vec![HEALTHY, ("403 Forbidden", "{}")]).await,
            ORG,
            Some("Basic x"),
        )
        .await;
        assert_eq!(refused.round_trip, RoundTrip::Failed);
        assert_eq!(
            refused.error,
            Some((AiErrorCode::PermissionDenied, SERVER_REFUSED))
        );
    }

    #[test]
    fn a_test_is_ok_only_when_health_and_the_round_trip_both_pass() {
        let passed = test_result(
            &checked(HealthStatus::Ok, answered()),
            Duration::from_millis(42),
        );
        assert_eq!(
            serde_json::to_value(passed).unwrap(),
            json!({"ok": true, "duration_ms": 42})
        );
        let code = |checked: &Checked| test_result(checked, Duration::ZERO).error.unwrap().code;
        assert_eq!(
            code(&checked(HealthStatus::Ok, RoundTrip::Failed)),
            "agent_unavailable"
        );
        assert_eq!(
            code(&checked(HealthStatus::Unknown, RoundTrip::Skipped)),
            "not_enabled"
        );
        assert_eq!(
            code(&Checked::unreachable(at(), UNREACHABLE)),
            "agent_unavailable"
        );
    }

    #[tokio::test]
    async fn a_probe_never_waits_for_a_running_refresh_and_serves_the_previous_result() {
        HEALTH.lock().unwrap().record(
            Instant::now().checked_sub(HEALTH_TTL * 2).unwrap(),
            &checked(HealthStatus::Ok, answered()),
        );
        let running = RefreshGuard::begin(&REFRESHING).expect("no refresh runs in tests");
        let started = Instant::now();
        let (health, facts) = current_health(ORG, Some("Basic x".to_string())).await;
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(health.status, HealthStatus::Ok);
        assert_eq!(facts.agents, ["o2-ai", "sre"]);
        drop(running);
        assert!(
            RefreshGuard::begin(&REFRESHING).is_some(),
            "dropping frees the slot"
        );
    }

    #[test]
    fn one_test_per_org_and_per_user_every_ten_seconds() {
        let mut last = HashMap::new();
        let start = Instant::now();
        let later = start + Duration::from_secs(4);
        assert!(admit_test(&mut last, ORG, "a@x", start).is_ok());
        assert_eq!(
            admit_test(&mut last, ORG, "b@x", later),
            Err(Duration::from_secs(6))
        );
        // One admin of many orgs still gets one test per window.
        assert_eq!(
            admit_test(&mut last, "other", "a@x", later),
            Err(Duration::from_secs(6))
        );
        assert!(admit_test(&mut last, "other", "b@x", later).is_ok());
        assert!(admit_test(&mut last, ORG, "a@x", start + TEST_INTERVAL).is_ok());
        // Expired entries are dropped, so the map holds only keys inside their window.
        assert!(admit_test(&mut last, "third", "c@x", start + Duration::from_secs(30)).is_ok());
        assert_eq!(last.len(), 2);
    }

    #[test]
    fn only_the_turns_typed_unreachable_error_frame_marks_health() {
        let frame = |json: Value| format!("id: 3\ndata: {json}\n\n").into_bytes();
        assert!(is_agent_unreachable_frame(&frame(json!({
            "type": "error", "code": "agent_unavailable", "error_code": "agent_unreachable"
        }))));
        assert!(!is_agent_unreachable_frame(&frame(json!({
            "type": "message_delta", "text": "error_code agent_unreachable"
        }))));
        assert!(!is_agent_unreachable_frame(&frame(json!({
            "type": "error", "error_code": "session_owner_unavailable"
        }))));
        assert!(!is_agent_unreachable_frame(b"id: 4\n\n"));
    }
}
