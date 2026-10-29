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

#[cfg(feature = "enterprise")]
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
#[cfg(any(feature = "enterprise", test))]
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

use axum::http::Method;
use config::utils::delegation::SCOPE_SLACK_ACTION;
#[cfg(any(feature = "enterprise", test))]
use config::{
    meta::slack::{DisabledReason, ExternalIdentityLink, SlackInstallation},
    utils::delegation::{Claims, DelegationError, Keys, SCOPE_ASSISTANT, verify},
};
use openobserve_core::auth::AuthExtractor;

use self::Seg::{Id, Lit, Param, Stream};
use super::validator::{AuthError, AuthValidationResult, check_permissions};
use crate::common::meta::user::get_default_user_role;

const V2_API_PREFIX: &str = "v2";
#[cfg(any(feature = "enterprise", test))]
const PROXY_PREFIX: &str = "/proxy/";
#[cfg(any(feature = "enterprise", test))]
const LINK_CACHE_TTL: Duration = Duration::from_secs(30);
#[cfg(any(feature = "enterprise", test))]
const TOUCH_INTERVAL_MICROS: i64 = 60_000_000;
#[cfg(feature = "enterprise")]
const LINK_CACHE_MAX: usize = 10_000;
/// Router literals that win over a `{stream_name}` slot; the router's dispatch test names new ones.
const RESERVED_STREAM_SLOTS: &[&str] = &[
    "_data_stream",
    "_index_template",
    "annotation_queues",
    "anomaly_detection",
    "cipher_keys",
    "datasets",
    "enrichment_tables",
    "eval_jobs",
    "experiments",
    "functions",
    "groups",
    "kv",
    "org_cleanup_tasks",
    "pipelines",
    "prompts",
    "providers",
    "re_patterns",
    "reports",
    "roles",
    "savedviews",
    "score_configs",
    "scorers",
    "search_jobs",
    "short",
    "slos",
    "status_pages",
    "streams",
    "synthetics",
    "tasks",
    "users",
    "workflows",
];
/// Router literals that axum hands to their own routes instead of the `{alert_id}` slot.
const ALERT_ID_LITERALS: &[&str] = &[
    "auto_investigate",
    "bulk",
    "composites",
    "dedup",
    "generate_sql",
    "history",
    "incidents",
    "move",
    "tags",
];
const ALERT_ID: Seg = Id(ALERT_ID_LITERALS);
const GET: &[&str] = &["GET"];
const POST: &[&str] = &["POST"];
const GET_POST: &[&str] = &["GET", "POST"];
const PATCH: &[&str] = &["PATCH"];

#[cfg(feature = "enterprise")]
static LINK_CACHE: LazyLock<Mutex<HashMap<String, LinkFacts>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Every route a delegated token may call; segments start at `{org_id}`, below `/api` and `/v2`.
#[rustfmt::skip]
const ASSISTANT_SCOPE: &[ScopeRoute] = &[
    v1(&[Param, Lit("_search")], POST),
    v1(&[Param, Stream, Lit("_values")], GET),
    v1(&[Param, Stream, Lit("_around")], GET_POST),
    v1(&[Param, Lit("prometheus"), Lit("api"), Lit("v1"), Lit("query")], GET_POST),
    v1(&[Param, Lit("prometheus"), Lit("api"), Lit("v1"), Lit("query_range")], GET_POST),
    v1(&[Param, Lit("streams")], GET),
    v1(&[Param, Lit("streams"), Param, Lit("schema")], GET),
    v1(&[Param, Lit("functions")], GET),
    v1(&[Param, Lit("dashboards")], GET),
    v1(&[Param, Lit("dashboards"), Param], GET),
    v2(&[Param, Lit("folders"), Param], GET),
    v2(&[Param, Lit("folders"), Param, Param], GET),
    v2(&[Param, Lit("folders"), Param, Lit("name"), Param], GET),
    v2(&[Param, Lit("alerts")], GET),
    v2(&[Param, Lit("alerts"), Param], GET),
    v2(&[Param, Lit("alerts"), Param, Lit("groups")], GET),
    v2(&[Param, Lit("alerts"), Param, Lit("groups"), Lit("transitions")], GET),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("events")], GET),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("rca"), Lit("runs")], GET),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("rca"), Lit("runs"), Param], GET),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("update")], PATCH),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("events"), Lit("comment")], POST),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("latest")], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("latest_stream")], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("session")], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("session"), Lit("details")], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("user")], GET),
    v1(&[Param, Stream, Lit("traces"), Lit("time_range")], GET),
    v1(&[Param, Stream, Lit("traces"), Param, Lit("details")], GET),
    v1(&[Param, Stream, Lit("traces"), Param, Lit("dag")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("members")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("schedule")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("on-call")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("overrides")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("resolved-schedule")], GET),
    v1(&[Param, Lit("oncall"), Lit("teams"), Param, Lit("overview")], GET),
    v1(&[Param, Lit("oncall"), Lit("responses")], GET),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param], GET),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("history")], GET),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("escalation")], GET),
    v1(&[Param, Lit("oncall"), Lit("incidents"), Param, Lit("responses")], GET),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("acknowledge")], POST),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("snooze")], POST),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("resolve")], POST),
    v1(&[Param, Lit("ai"), Lit("chat")], POST),
    v1(&[Param, Lit("ai"), Lit("chat_stream")], POST),
    v1(&[Param, Lit("ai"), Lit("feedback")], POST),
    v1(&[Param, Lit("ai"), Lit("confirm"), Param], POST),
    v1(&[Param, Lit("ai"), Lit("chats"), Param, Lit("cancel")], POST),
    v1(&[Param, Lit("mcp")], GET_POST),
    v2(&[Param, Lit("downtimes")], POST),
    v2(&[Param, Lit("downtimes"), Param, Lit("cancel")], POST),
];

/// The alert buttons' routes (spec 8.1); segments start at `{org_id}`, below `/api` and `/v2`.
#[rustfmt::skip]
const SLACK_ACTION_SCOPE: &[ScopeRoute] = &[
    v2(&[Param, Lit("alerts"), ALERT_ID], GET),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("acks")], GET),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("groups")], GET),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("ack")], POST),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("unack")], POST),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("mute")], POST),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("mute"), Param, Lit("extend")], POST),
    v2(&[Param, Lit("alerts"), ALERT_ID, Lit("mute"), Param, Lit("cancel")], POST),
    v2(&[Param, Lit("alerts"), Lit("incidents"), Param, Lit("update")], PATCH),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("resolve")], POST),
    v1(&[Param, Lit("oncall"), Lit("responses"), Param, Lit("snooze")], POST),
];

/// Set only by the validator; a request extension, so a client can never supply it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegatedCaller {
    pub link_id: String,
    pub installation_id: String,
    pub org: String,
    pub jti: String,
    pub scope: String,
}

impl DelegatedCaller {
    pub fn is_slack_action(&self) -> bool {
        self.scope == SCOPE_SLACK_ACTION
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Seg {
    Lit(&'static str),
    Param,
    Stream,
    Id(&'static [&'static str]),
}

struct ScopeRoute {
    v2: bool,
    segments: &'static [Seg],
    methods: &'static [&'static str],
}

/// What the link row, its installation and the orgs it serves say, cached for 30 s per link.
#[cfg(any(feature = "enterprise", test))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct LinkFacts {
    installation_id: String,
    user_email: String,
    refusal: Option<&'static str>,
    orgs: HashSet<String>,
    last_used_at: i64,
    loaded: Instant,
}

#[cfg(any(feature = "enterprise", test))]
impl LinkFacts {
    fn from_rows(
        link: Option<ExternalIdentityLink>,
        installation: Option<SlackInstallation>,
        orgs: HashSet<String>,
        loaded: Instant,
    ) -> Self {
        let Some(link) = link else {
            return Self::refused("unknown link", loaded);
        };
        let refusal = if link.revoked_at.is_some() {
            Some("link revoked")
        } else if installation.is_none_or(|i| i.revoked_at.is_some()) {
            Some("installation revoked")
        } else {
            None
        };
        Self {
            installation_id: link.installation_id,
            user_email: link.user_email,
            refusal,
            orgs,
            last_used_at: link.last_used_at,
            loaded,
        }
    }

    fn refused(reason: &'static str, loaded: Instant) -> Self {
        Self {
            installation_id: String::new(),
            user_email: String::new(),
            refusal: Some(reason),
            orgs: HashSet::new(),
            last_used_at: 0,
            loaded,
        }
    }

    fn admit(&self, claims: &Claims) -> Result<(), AuthError> {
        if let Some(reason) = self.refusal {
            return Err(forbidden(reason));
        }
        if self.user_email != claims.sub {
            return Err(forbidden("token subject is not the linked user"));
        }
        if !self.orgs.contains(&claims.org) {
            return Err(forbidden("org is not connected to the installation"));
        }
        Ok(())
    }

    /// Monotonic, so a wall-clock step can neither keep a stale entry nor drop a fresh one.
    fn is_fresh(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.loaded) < LINK_CACHE_TTL
    }
}

/// Validation steps 0-5 of the delegated-token contract; `authorize` runs steps 6 and 7.
#[cfg(feature = "enterprise")]
pub async fn validate_delegated(
    token: &str,
    path: &str,
    path_prefix: &str,
    method: &Method,
) -> Result<AuthValidationResult, AuthError> {
    use o2_enterprise::enterprise::{common::config::get_config as get_o2_config, slack};

    let now_secs = config::utils::time::now_micros() / 1_000_000;
    let slack_on = get_o2_config().slack.enabled;
    let claims = verified_claims(
        token,
        slack_on,
        signing_keys,
        now_secs,
        slack::disabled_reason,
    )?;
    check_route(path, path_prefix, method, &claims)?;
    let facts = link_facts(&claims.lid, Instant::now()).await?;
    facts.admit(&claims)?;
    let Some(user) = openobserve_core::users::get_user(Some(&claims.org), &claims.sub).await else {
        return Err(forbidden("not a member of the org"));
    };
    if super::validator::blocked_external(&user).await {
        return Err(forbidden("blocked identity"));
    }
    Ok(AuthValidationResult {
        user_email: claims.sub,
        user_role: Some(user.role),
        is_internal_user: !user.is_external,
        token_name: None,
        delegation: Some(DelegatedCaller {
            link_id: claims.lid,
            installation_id: facts.installation_id,
            org: claims.org,
            jti: claims.jti,
            scope: claims.scope,
        }),
    })
}

#[cfg(not(feature = "enterprise"))]
pub async fn validate_delegated(
    _token: &str,
    _path: &str,
    _path_prefix: &str,
    _method: &Method,
) -> Result<AuthValidationResult, AuthError> {
    Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
}

/// Whether a delegated token may call `method` on `path` (relative to `/api`, starting at the org).
pub fn in_assistant_scope(method: &Method, path: &str) -> bool {
    in_scope(ASSISTANT_SCOPE, method, path)
}

/// Whether a `slack_action` token may call `method` on `path` (relative to `/api`).
pub fn in_slack_action_scope(method: &Method, path: &str) -> bool {
    in_scope(SLACK_ACTION_SCOPE, method, path)
}

/// Validation step 6 (as the validator's own permission check), then step 7's usage touch.
pub(crate) async fn authorize(
    result: AuthValidationResult,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    let role = result.user_role.clone().unwrap_or(get_default_user_role());
    let allowed = auth_info.bypass_check
        || check_permissions(
            &result.user_email,
            auth_info.clone(),
            role,
            !result.is_internal_user,
        )
        .await;
    if !allowed {
        return Err(forbidden("permission denied"));
    }
    #[cfg(feature = "enterprise")]
    if let Some(caller) = &result.delegation {
        touch_if_due(&caller.link_id, config::utils::time::now_micros()).await;
    }
    Ok(result)
}

const fn v1(segments: &'static [Seg], methods: &'static [&'static str]) -> ScopeRoute {
    ScopeRoute {
        v2: false,
        segments,
        methods,
    }
}

const fn v2(segments: &'static [Seg], methods: &'static [&'static str]) -> ScopeRoute {
    ScopeRoute {
        v2: true,
        segments,
        methods,
    }
}

/// Slack off answers before the keys are derived, so stray `o2dt.` bearers cost nothing.
#[cfg(any(feature = "enterprise", test))]
fn verified_claims(
    token: &str,
    slack_on: bool,
    keys: impl FnOnce() -> anyhow::Result<Keys>,
    now_secs: i64,
    disabled_reason: impl Fn(&str) -> Option<DisabledReason>,
) -> Result<Claims, AuthError> {
    if !slack_on {
        return Err(unauthorized());
    }
    let keys = keys().map_err(|e| {
        log::debug!("delegated token refused: no signing key: {e}");
        unauthorized()
    })?;
    let claims = verify(&keys, token, now_secs).map_err(|e: DelegationError| {
        log::debug!("delegated token refused: {e}");
        unauthorized()
    })?;
    if let Some(reason) = disabled_reason(&claims.org) {
        log::debug!("delegated token refused: Slack is off ({reason:?})");
        return Err(unauthorized());
    }
    if scope_routes(&claims.scope).is_none() {
        return Err(forbidden("unknown token scope"));
    }
    Ok(claims)
}

#[cfg(any(feature = "enterprise", test))]
fn check_route(
    path: &str,
    path_prefix: &str,
    method: &Method,
    claims: &Claims,
) -> Result<(), AuthError> {
    if path_prefix == PROXY_PREFIX {
        return Err(forbidden("proxy routes are not delegated"));
    }
    let routes = scope_routes(&claims.scope).ok_or_else(|| forbidden("unknown token scope"))?;
    let relative = relative_path(path);
    match path_org(relative) {
        None => Err(forbidden("route has no org")),
        Some(org) if org != claims.org => Err(forbidden("token is for another org")),
        Some(_) if !in_scope(routes, method, relative) => {
            Err(forbidden("route is outside the token scope"))
        }
        Some(_) => Ok(()),
    }
}

#[cfg(any(feature = "enterprise", test))]
fn scope_routes(scope: &str) -> Option<&'static [ScopeRoute]> {
    match scope {
        SCOPE_ASSISTANT => Some(ASSISTANT_SCOPE),
        SCOPE_SLACK_ACTION => Some(SLACK_ACTION_SCOPE),
        _ => None,
    }
}

/// Already below `/api`; stripping `/api/` again would read an org named `api` as a prefix.
#[cfg(any(feature = "enterprise", test))]
fn relative_path(uri_path: &str) -> &str {
    uri_path.strip_prefix('/').unwrap_or(uri_path)
}

#[cfg(any(feature = "enterprise", test))]
fn path_org(relative: &str) -> Option<&str> {
    let columns: Vec<&str> = relative.split('/').collect();
    let (org, rest) = match columns.as_slice() {
        [V2_API_PREFIX, org, rest @ ..] => (*org, rest),
        [org, rest @ ..] => (*org, rest),
        [] => return None,
    };
    (!org.is_empty() && !rest.is_empty()).then_some(org)
}

fn in_scope(routes: &[ScopeRoute], method: &Method, path: &str) -> bool {
    if method == Method::DELETE {
        return false;
    }
    let (is_v2, rest) = match path
        .strip_prefix(V2_API_PREFIX)
        .and_then(|r| r.strip_prefix('/'))
    {
        Some(rest) => (true, rest),
        None => (false, path),
    };
    let columns: Vec<&str> = rest.split('/').collect();
    routes.iter().any(|route| {
        route.v2 == is_v2
            && route.methods.contains(&method.as_str())
            && segments_match(route.segments, &columns)
    })
}

fn segments_match(patterns: &[Seg], columns: &[&str]) -> bool {
    patterns.len() == columns.len()
        && patterns.iter().zip(columns).all(|(pat, col)| match pat {
            Lit(lit) => col == lit,
            Param => !col.is_empty(),
            Stream => !col.is_empty() && !RESERVED_STREAM_SLOTS.contains(col),
            Id(literals) => !col.is_empty() && !literals.contains(col),
        })
}

#[cfg(feature = "enterprise")]
fn signing_keys() -> anyhow::Result<Keys> {
    let auth = &config::get_config().auth;
    let master = o2_enterprise::enterprise::common::config::get_config()
        .encryption
        .master_key
        .clone();
    config::utils::delegation::effective_keys(
        &master,
        &auth.delegation_signing_key,
        &auth.delegation_signing_key_previous,
    )
}

#[cfg(feature = "enterprise")]
async fn link_facts(lid: &str, now: Instant) -> Result<LinkFacts, AuthError> {
    use o2_enterprise::enterprise::slack::store;

    if let Some(facts) = cached_link(lid, now) {
        return Ok(facts);
    }
    let load = async {
        let Some(link) = store::external_identity_links::get(lid).await? else {
            return Ok(LinkFacts::from_rows(None, None, HashSet::new(), now));
        };
        let installation = store::slack_installations::get(&link.installation_id).await?;
        let orgs = match &installation {
            Some(installation) => store::served_org_ids(installation).await?,
            None => HashSet::new(),
        };
        anyhow::Ok(LinkFacts::from_rows(Some(link), installation, orgs, now))
    };
    let facts = loaded_facts(load.await, lid)?;
    remember_link(lid, facts.clone());
    Ok(facts)
}

/// A failed read is 503, so the caller retries instead of reading it as a permission denial.
#[cfg(any(feature = "enterprise", test))]
fn loaded_facts(loaded: anyhow::Result<LinkFacts>, lid: &str) -> Result<LinkFacts, AuthError> {
    loaded.map_err(|e| {
        log::error!("delegated token: loading link {lid} failed: {e}");
        AuthError::Unavailable("Service Unavailable".to_string())
    })
}

#[cfg(feature = "enterprise")]
fn cached_link(lid: &str, now: Instant) -> Option<LinkFacts> {
    let cache = LINK_CACHE.lock().ok()?;
    cache.get(lid).filter(|f| f.is_fresh(now)).cloned()
}

#[cfg(feature = "enterprise")]
fn remember_link(lid: &str, facts: LinkFacts) {
    let Ok(mut cache) = LINK_CACHE.lock() else {
        return;
    };
    if cache.len() >= LINK_CACHE_MAX {
        let now = Instant::now();
        cache.retain(|_, f| f.is_fresh(now));
        if cache.len() >= LINK_CACHE_MAX {
            cache.clear();
        }
    }
    cache.insert(lid.to_string(), facts);
}

/// Writes `last_used_at` at most once a minute per link and node.
#[cfg(feature = "enterprise")]
async fn touch_if_due(lid: &str, now: i64) {
    let due = LINK_CACHE.lock().ok().is_some_and(|mut cache| {
        cache.get_mut(lid).is_some_and(|facts| {
            let due = touch_due(facts.last_used_at, now);
            if due {
                facts.last_used_at = now;
            }
            due
        })
    });
    if due
        && let Err(e) =
            o2_enterprise::enterprise::slack::store::external_identity_links::touch_last_used(
                lid, now,
            )
            .await
    {
        log::warn!("delegated token: touching link {lid} failed: {e}");
    }
}

#[cfg(any(feature = "enterprise", test))]
fn touch_due(last_used_at: i64, now: i64) -> bool {
    now - last_used_at >= TOUCH_INTERVAL_MICROS
}

fn forbidden(reason: &str) -> AuthError {
    log::debug!("delegated token refused: {reason}");
    AuthError::Forbidden("Unauthorized Access".to_string())
}

#[cfg(any(feature = "enterprise", test))]
fn unauthorized() -> AuthError {
    AuthError::Unauthorized("Unauthorized Access".to_string())
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::{
        meta::slack::{InstallScope, OrgAccess, RevokedReason},
        utils::delegation::{TOKEN_VERSION, effective_keys, sign},
    };

    use super::*;

    const NOW_SECS: i64 = 1_791_937_000;
    const NOW: i64 = NOW_SECS * 1_000_000;

    fn claims(org: &str) -> Claims {
        Claims {
            v: TOKEN_VERSION,
            sub: "alice@acme.io".to_string(),
            org: org.to_string(),
            lid: "lnk_01".to_string(),
            scope: SCOPE_ASSISTANT.to_string(),
            iat: NOW_SECS - 60,
            exp: NOW_SECS + 3540,
            jti: "jti-0001".to_string(),
        }
    }

    fn keys() -> Keys {
        effective_keys(&BASE64_STANDARD.encode([7u8; 64]), "", "").unwrap()
    }

    fn token(claims: &Claims) -> String {
        sign(&keys(), claims)
    }

    fn status(result: Result<impl Sized, AuthError>) -> u16 {
        match result {
            Ok(_) => 200,
            Err(AuthError::Unauthorized(_)) => 401,
            Err(AuthError::Forbidden(_)) => 403,
            Err(AuthError::NotFound(_)) => 404,
            Err(AuthError::Locked { .. }) => 429,
            Err(AuthError::Unavailable(_)) => 503,
        }
    }

    fn route(path: &str, prefix: &str, method: Method) -> u16 {
        status(check_route(path, prefix, &method, &claims("acme")))
    }

    fn slack_action(org: &str) -> Claims {
        Claims {
            scope: SCOPE_SLACK_ACTION.to_string(),
            ..claims(org)
        }
    }

    fn action_route(method: Method, path: &str) -> u16 {
        status(check_route(path, "/api/", &method, &slack_action("acme")))
    }

    fn link() -> ExternalIdentityLink {
        ExternalIdentityLink {
            id: "lnk_01".to_string(),
            provider: "slack".to_string(),
            installation_id: "I1".to_string(),
            external_user_id: "U1".to_string(),
            user_email: "alice@acme.io".to_string(),
            default_org_id: "acme".to_string(),
            ..Default::default()
        }
    }

    fn installation() -> SlackInstallation {
        SlackInstallation {
            id: "I1".to_string(),
            ..Default::default()
        }
    }

    fn admitted(
        link: Option<ExternalIdentityLink>,
        installation: Option<SlackInstallation>,
        orgs: &[&str],
        claims: &Claims,
    ) -> u16 {
        let orgs = orgs.iter().map(|o| o.to_string()).collect();
        status(LinkFacts::from_rows(link, installation, orgs, Instant::now()).admit(claims))
    }

    #[test]
    fn refused_when_slack_disabled() {
        let token = token(&claims("acme"));
        assert_eq!(
            status(verified_claims(
                &token,
                true,
                || Ok(keys()),
                NOW_SECS,
                |_| Some(DisabledReason::Flag)
            )),
            401
        );
        assert_eq!(
            status(verified_claims(
                &token,
                true,
                || Ok(keys()),
                NOW_SECS,
                |_| None
            )),
            200
        );
        for reason in [
            DisabledReason::Edition,
            DisabledReason::Flag,
            DisabledReason::MasterKey,
            DisabledReason::SuperCluster,
        ] {
            // A new reason must join this list: the match stops compiling until it does.
            match reason {
                DisabledReason::Edition
                | DisabledReason::Flag
                | DisabledReason::MasterKey
                | DisabledReason::SuperCluster => {}
            }
            assert_eq!(
                status(verified_claims(
                    &token,
                    true,
                    || Ok(keys()),
                    NOW_SECS,
                    |_| Some(reason)
                )),
                401,
                "{reason:?}"
            );
        }
        let no_key = verified_claims(
            &token,
            true,
            || Err(anyhow::anyhow!("no master key")),
            NOW_SECS,
            |_| None,
        );
        assert_eq!(status(no_key), 401);
    }

    #[test]
    fn slack_off_refuses_before_reading_the_signing_keys() {
        let token = token(&claims("acme"));
        let refused = verified_claims(
            &token,
            false,
            || panic!("signing keys were read with Slack off"),
            NOW_SECS,
            |_| None,
        );
        assert_eq!(status(refused), 401);
    }

    #[test]
    fn a_link_that_cannot_be_loaded_is_503_not_a_denial() {
        let failed = loaded_facts(Err(anyhow::anyhow!("database is down")), "lnk_01");
        assert_eq!(status(failed), 503);
        let facts = LinkFacts::from_rows(
            Some(link()),
            Some(installation()),
            HashSet::new(),
            Instant::now(),
        );
        assert_eq!(loaded_facts(Ok(facts.clone()), "lnk_01").ok(), Some(facts));
    }

    #[test]
    fn the_disabled_reason_is_asked_about_the_token_org() {
        let token = token(&claims("acme"));
        let only_other = |org: &str| (org != "other").then_some(DisabledReason::Flag);
        assert_eq!(
            status(verified_claims(
                &token,
                true,
                || Ok(keys()),
                NOW_SECS,
                only_other
            )),
            401
        );
    }

    #[test]
    fn expired_altered_and_wrong_prefix_are_401() {
        let good = token(&claims("acme"));
        let expired = token(&Claims {
            exp: NOW_SECS,
            ..claims("acme")
        });
        let (head, mac) = good.rsplit_once('.').unwrap();
        let other_claims = token(&claims("other"));
        let (forged_head, _) = other_claims.rsplit_once('.').unwrap();
        for bad in [
            expired,
            format!("{forged_head}.{mac}"),
            format!("{head}.{}", &mac[1..]),
            good.replacen("o2dt.", "o2dx.", 1),
            good.replacen("o2dt.", "", 1),
            token(&Claims {
                v: 2,
                ..claims("acme")
            }),
        ] {
            assert_eq!(
                status(verified_claims(
                    &bad,
                    true,
                    || Ok(keys()),
                    NOW_SECS,
                    |_| None
                )),
                401,
                "{bad}"
            );
        }
    }

    #[test]
    fn an_unknown_scope_is_403() {
        let token = token(&Claims {
            scope: "admin".to_string(),
            ..claims("acme")
        });
        assert_eq!(
            status(verified_claims(
                &token,
                true,
                || Ok(keys()),
                NOW_SECS,
                |_| None
            )),
            403
        );
    }

    #[test]
    fn a_slack_action_token_is_refused_on_chat_stream_and_every_unlisted_route() {
        let token = token(&slack_action("acme"));
        assert_eq!(
            status(verified_claims(
                &token,
                true,
                || Ok(keys()),
                NOW_SECS,
                |_| None
            )),
            200
        );
        for (method, path) in [
            (Method::GET, "/v2/acme/alerts/a1"),
            (Method::GET, "/v2/acme/alerts/a1/acks"),
            (Method::GET, "/v2/acme/alerts/a1/groups"),
            (Method::POST, "/v2/acme/alerts/a1/ack"),
            (Method::POST, "/v2/acme/alerts/a1/unack"),
            (Method::POST, "/v2/acme/alerts/a1/mute"),
            (Method::POST, "/v2/acme/alerts/a1/mute/d1/extend"),
            (Method::POST, "/v2/acme/alerts/a1/mute/d1/cancel"),
            (Method::PATCH, "/v2/acme/alerts/incidents/i1/update"),
            (Method::POST, "/acme/oncall/responses/r1/resolve"),
            (Method::POST, "/acme/oncall/responses/r1/snooze"),
        ] {
            assert_eq!(action_route(method.clone(), path), 200, "{method} {path}");
        }
        for (method, path) in [
            (Method::POST, "/acme/ai/chat_stream"),
            (Method::POST, "/acme/ai/chat"),
            (Method::POST, "/acme/ai/confirm/s1"),
            (Method::GET, "/acme/mcp"),
            (Method::POST, "/acme/mcp"),
            (Method::POST, "/acme/_search"),
            (Method::GET, "/acme/streams"),
            (Method::POST, "/v2/acme/downtimes"),
            (Method::POST, "/v2/acme/downtimes/d1/cancel"),
            (Method::POST, "/acme/oncall/responses/r1/acknowledge"),
            (Method::GET, "/acme/oncall/responses/r1"),
            (Method::POST, "/v2/acme/alerts/incidents/i1/events/comment"),
            (Method::GET, "/v2/acme/alerts/incidents/i1"),
            (Method::GET, "/v2/acme/alerts"),
            (Method::GET, "/v2/acme/alerts/history"),
            (Method::GET, "/v2/acme/alerts/incidents"),
            (Method::GET, "/v2/acme/alerts/tags"),
            (Method::GET, "/v2/acme/alerts/incidents/groups"),
            (Method::GET, "/v2/acme/alerts/a1/groups/transitions"),
            (Method::PUT, "/v2/acme/alerts/a1"),
            (Method::DELETE, "/v2/acme/alerts/a1"),
            (Method::DELETE, "/v2/acme/alerts/a1/mute/d1/cancel"),
            (Method::GET, "/v2/acme/alerts/a1/ack"),
            (Method::PATCH, "/v2/acme/alerts/a1/enable"),
            (Method::POST, "/v2/acme/alerts/a1/trigger"),
            (Method::POST, "/v2/other/alerts/a1/ack"),
            (Method::POST, "/acme/alerts/a1/ack"),
        ] {
            assert_eq!(action_route(method.clone(), path), 403, "{method} {path}");
        }
        assert_eq!(
            status(check_route(
                "/proxy/acme/v2/acme/alerts/a1/ack",
                "/proxy/",
                &Method::POST,
                &slack_action("acme")
            )),
            403
        );
    }

    #[test]
    fn an_assistant_token_is_refused_on_ack_and_a_slack_action_token_is_not() {
        for path in [
            "/v2/acme/alerts/a1/ack",
            "/v2/acme/alerts/a1/unack",
            "/v2/acme/alerts/a1/mute",
            "/v2/acme/alerts/a1/mute/d1/extend",
            "/v2/acme/alerts/a1/mute/d1/cancel",
        ] {
            assert_eq!(route(path, "/api/", Method::POST), 403, "assistant {path}");
            assert_eq!(action_route(Method::POST, path), 200, "slack_action {path}");
        }
    }

    #[test]
    fn path_org_must_match() {
        assert_eq!(route("/acme/_search", "/api/", Method::POST), 200);
        assert_eq!(route("/other/_search", "/api/", Method::POST), 403);
        assert_eq!(route("/v2/other/downtimes", "/api/", Method::POST), 403);
        assert_eq!(route("/acmeX/streams", "/api/", Method::GET), 403);
    }

    #[test]
    fn an_org_named_api_cannot_shift_the_path_org() {
        let kv = claims("kv");
        for path in ["/api/kv/_search", "/api/v2/kv/downtimes"] {
            assert_eq!(
                status(check_route(path, "/api/", &Method::POST, &kv)),
                403,
                "{path} is org `api` below `/api`"
            );
        }
        assert_eq!(
            status(check_route("/kv/_search", "/api/", &Method::POST, &kv)),
            200
        );
    }

    #[test]
    fn path_org_comes_from_the_first_segment_or_the_second_after_v2() {
        assert_eq!(path_org("acme/streams"), Some("acme"));
        assert_eq!(path_org("v2/acme/downtimes"), Some("acme"));
        assert_eq!(path_org("acme"), None);
        assert_eq!(path_org("v2/acme"), None);
        assert_eq!(path_org("organizations"), None);
        assert_eq!(path_org(""), None);
        assert_eq!(path_org("/streams"), None);
        assert_eq!(route("/v2/acme/downtimes", "/api/", Method::POST), 200);
    }

    #[test]
    fn the_path_is_read_as_the_nested_router_passes_it() {
        assert_eq!(relative_path("/acme/streams"), "acme/streams");
        assert_eq!(relative_path("/api/acme/streams"), "api/acme/streams");
        assert_eq!(route("/acme/streams", "/api/", Method::GET), 200);
        assert_eq!(route("/other/streams", "/api/", Method::GET), 403);
    }

    #[test]
    fn org_less_and_proxy_routes_are_refused() {
        for path in ["/organizations", "/license", "/acme", "/invites", "/"] {
            assert_eq!(route(path, "/api/", Method::GET), 403, "{path}");
        }
        assert_eq!(
            route("/proxy/acme/https://example.com/x", "/proxy/", Method::GET),
            403
        );
        assert_eq!(route("/proxy/acme/_search", "/proxy/", Method::POST), 403);
    }

    #[test]
    fn assistant_scope_allows_the_listed_routes() {
        for (method, path) in [
            (Method::POST, "acme/_search"),
            (Method::GET, "acme/logs/_values"),
            (Method::GET, "acme/logs/_around"),
            (Method::POST, "acme/logs/_around"),
            (Method::GET, "acme/prometheus/api/v1/query"),
            (Method::POST, "acme/prometheus/api/v1/query_range"),
            (Method::GET, "acme/streams"),
            (Method::GET, "acme/streams/logs/schema"),
            (Method::GET, "acme/functions"),
            (Method::GET, "acme/dashboards/d1"),
            (Method::GET, "v2/acme/folders/dashboards/f1"),
            (Method::GET, "v2/acme/alerts"),
            (Method::GET, "v2/acme/alerts/a1"),
            (Method::GET, "v2/acme/alerts/incidents/i1"),
            (Method::PATCH, "v2/acme/alerts/incidents/i1/update"),
            (Method::POST, "v2/acme/alerts/incidents/i1/events/comment"),
            (Method::GET, "acme/logs/traces/latest"),
            (Method::GET, "acme/logs/traces/t1/details"),
            (Method::GET, "acme/oncall/teams/t1/on-call"),
            (Method::POST, "acme/oncall/responses/r1/acknowledge"),
            (Method::POST, "acme/oncall/responses/r1/snooze"),
            (Method::POST, "acme/oncall/responses/r1/resolve"),
            (Method::POST, "acme/ai/chat_stream"),
            (Method::POST, "acme/ai/confirm/s1"),
            (Method::POST, "acme/ai/chats/s1/cancel"),
            (Method::GET, "acme/mcp"),
            (Method::POST, "acme/mcp"),
            (Method::POST, "v2/acme/downtimes"),
            (Method::POST, "v2/acme/downtimes/d1/cancel"),
        ] {
            assert!(in_assistant_scope(&method, path), "{method} {path}");
        }
    }

    #[test]
    fn assistant_scope_refuses_everything_else() {
        for (method, path) in [
            (Method::DELETE, "acme/mcp"),
            (Method::DELETE, "acme/streams/logs"),
            (Method::DELETE, "v2/acme/alerts/a1"),
            (Method::DELETE, "acme/dashboards/d1"),
            (Method::GET, "acme/alerts/destinations"),
            (Method::GET, "acme/alerts/destinations/slack"),
            (Method::GET, "acme/alerts/templates"),
            (Method::GET, "acme/alerts/a1"),
            (Method::GET, "v2/acme/streams"),
            (Method::GET, "acme/users"),
            (Method::GET, "acme/users/bob@acme.io"),
            (Method::GET, "acme/service_accounts"),
            (Method::GET, "acme/roles"),
            (Method::GET, "acme/groups"),
            (Method::GET, "acme/passcode"),
            (Method::GET, "acme/cipher_keys"),
            (Method::GET, "acme/settings"),
            (Method::GET, "acme/ai/shares"),
            (Method::GET, "acme/ai/chats"),
            (Method::GET, "acme/slack/installations"),
            (Method::POST, "acme/slack/links"),
            (Method::GET, "acme/oncall/contacts/bob@acme.io"),
            (Method::GET, "acme/oncall/routing/config"),
            (Method::GET, "organizations"),
            (Method::GET, "license"),
            (Method::POST, "acme/streams/logs"),
            (Method::PUT, "v2/acme/alerts/a1"),
            (Method::POST, "v2/acme/alerts"),
            (Method::GET, "acme/streams/"),
            (Method::GET, "acme//_values"),
            (Method::HEAD, "acme/streams"),
            (Method::POST, "acme/streams/_around"),
            (Method::POST, "acme/kv/_around"),
            (Method::GET, "acme/users/_values"),
            (Method::GET, "acme/roles/traces/r1/details"),
        ] {
            assert!(!in_assistant_scope(&method, path), "{method} {path}");
        }
    }

    #[test]
    fn each_link_refusal_is_403() {
        let acme = claims("acme");
        assert_eq!(
            admitted(Some(link()), Some(installation()), &["acme"], &acme),
            200
        );
        assert_eq!(admitted(None, None, &[], &acme), 403, "unknown link");
        let revoked_link = ExternalIdentityLink {
            revoked_at: Some(NOW - 1),
            revoked_reason: Some(RevokedReason::Unlinked),
            ..link()
        };
        assert_eq!(
            admitted(Some(revoked_link), Some(installation()), &["acme"], &acme),
            403
        );
        let revoked_installation = SlackInstallation {
            revoked_at: Some(NOW - 1),
            ..installation()
        };
        assert_eq!(
            admitted(Some(link()), Some(revoked_installation), &["acme"], &acme),
            403
        );
        assert_eq!(
            admitted(Some(link()), None, &["acme"], &acme),
            403,
            "installation gone"
        );
        assert_eq!(
            admitted(Some(link()), Some(installation()), &["other"], &acme),
            403,
            "unconnected org"
        );
        let bob = Claims {
            sub: "bob@acme.io".to_string(),
            ..claims("acme")
        };
        assert_eq!(
            admitted(Some(link()), Some(installation()), &["acme"], &bob),
            403,
            "sub is not the linked user"
        );
    }

    #[test]
    fn an_org_served_under_all_is_admitted_and_a_removed_org_is_refused() {
        let created_later = claims("created-later");
        let instance = SlackInstallation {
            scope: InstallScope::Instance,
            org_access: OrgAccess::All,
            ..installation()
        };
        assert_eq!(
            admitted(
                Some(link()),
                Some(instance.clone()),
                &["_meta", "acme", "created-later"],
                &created_later
            ),
            200
        );
        let listed = SlackInstallation {
            org_access: OrgAccess::Listed,
            ..instance
        };
        assert_eq!(
            admitted(
                Some(link()),
                Some(listed),
                &["_meta", "acme"],
                &created_later
            ),
            403,
            "removed from access"
        );
    }

    #[test]
    fn link_facts_live_30_seconds_and_touches_wait_a_minute() {
        let loaded = Instant::now();
        let facts =
            LinkFacts::from_rows(Some(link()), Some(installation()), HashSet::new(), loaded);
        assert!(facts.is_fresh(loaded));
        assert!(facts.is_fresh(loaded + LINK_CACHE_TTL - Duration::from_nanos(1)));
        assert!(!facts.is_fresh(loaded + LINK_CACHE_TTL));
        assert!(!touch_due(NOW, NOW + 59_999_999));
        assert!(touch_due(NOW, NOW + 60_000_000));
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn the_oss_build_refuses_every_delegated_token() {
        let token = token(&claims("default"));
        let result =
            validate_delegated(&token, "/api/default/streams", "/api/", &Method::GET).await;
        assert_eq!(status(result), 401);
    }
}
