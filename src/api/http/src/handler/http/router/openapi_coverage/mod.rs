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

//! CI guard: every route in `router/mod.rs` is published or excluded, and published ops are valid.

use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
};

use regex::Regex;
use serde_json::Value;
use utoipa::OpenApi;

use super::openapi::ApiDoc;

const ROUTER_SOURCE: &str = include_str!("../mod.rs");
const EXCLUDED_ROUTES: &str = include_str!("excluded_routes.txt");
const RATELIMIT_EXEMPT: &str = include_str!("ratelimit_exempt.txt");
const BASELINE: &str = include_str!("baseline.txt");
const MCP_ENABLED: &str = include_str!("mcp_enabled.txt");

// Sits just below the real counts, so a parser regression that loses routes fails loudly.
const MIN_PARSED_ROUTES: usize = 900;
const MIN_ACTIVE_ROUTES: usize = 500;

const JSON: &str = "application/json";

const VERBS: &[&str] = &[
    "get", "post", "put", "delete", "patch", "head", "options", "trace",
];

/// Canonical `ApiGroupOperation` spellings and the aliases the rate limiter accepts.
const RATELIMIT_OPERATIONS: &[&str] = &[
    "list", "get", "create", "update", "delete", "post", "put", "patch",
];

/// Where each router function ends up; a new one must be added here or the guard panics.
const ROUTER_PREFIXES: &[(&str, &str)] = &[
    ("basic_routes", ""),
    ("proxy_routes", ""),
    ("other_service_routes", ""),
    ("splunk_collector_routes", ""),
    ("config_routes", "/config"),
    ("node_routes", "/node"),
    ("service_route_table", "/api"),
    ("search_routes_with", "/api"),
    ("public_dashboard_admin_routes", "/api"),
    ("ai_chat_routes", "/api"),
    ("alert_calibration_routes", "/api"),
    ("downtime_routes", "/api"),
    ("report_routes", "/api"),
    ("oncall_routes", "/api"),
    ("fleet_router", "/api"),
    ("slack_routes", "/api"),
    ("service_streams_routes", "/api"),
    ("es_compat_routes", "/api"),
    ("workflow_hook_routes", ""),
];

/// Only serves UI redirects, computed from `base_uri` at startup.
const UNSCANNED_ROUTERS: &[&str] = &["create_app_router"];

/// What a handler really answers on success: edition, method, path, status, content type, shape.
const SUCCESS_CONTRACTS: &[ContractRow] = &[
    ("ent", "POST", "/api/license", "201", JSON, "string"),
    (
        "all",
        "POST",
        "/api/v2/{org_id}/incidents/events",
        "202",
        JSON,
        "object",
    ),
    (
        "all",
        "POST",
        "/api/v2/{org_id}/incidents/events/{token}",
        "202",
        JSON,
        "object",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/v1/profiles",
        "200",
        "application/x-protobuf",
        "none",
    ),
    ("ent", "POST", "/api/license/refresh", "200", JSON, "object"),
    (
        "all",
        "GET",
        "/api/{org_id}/synthetics/{id}/artifact",
        "200",
        "image/png",
        "binary",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/synthetics/{id}/artifact",
        "200",
        "application/zip",
        "binary",
    ),
    (
        "ent",
        "PUT",
        "/api/{org_id}/query_manager/cancel",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/sourcemaps",
        "201",
        JSON,
        "object",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/sourcemaps",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/users/roles",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/org_cleanup_tasks/{target_org_id}",
        "200",
        JSON,
        "array",
    ),
    (
        "ent",
        "GET",
        "/api/{org_id}/ratelimit/api_modules",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/status_pages/{id}/domains",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/status_pages/{id}/notices",
        "200",
        JSON,
        "array",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/status_pages/notices/{nid}/updates",
        "200",
        JSON,
        "array",
    ),
    (
        "ent",
        "GET",
        "/api/{org_id}/oncall/teams",
        "200",
        JSON,
        "array",
    ),
    (
        "ent",
        "GET",
        "/api/{org_id}/oncall/responses",
        "200",
        JSON,
        "array",
    ),
    (
        "ent",
        "GET",
        "/api/{org_id}/oncall/teams/{team_id}/schedule",
        "200",
        JSON,
        "nullable",
    ),
    (
        "ent",
        "POST",
        "/api/{org_id}/oncall/contacts/{user_email}/verify",
        "204",
        "",
        "none",
    ),
    (
        "ent",
        "POST",
        "/api/{org_id}/ai/chat_stream",
        "200",
        "text/event-stream",
        "none",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/prometheus/api/v1/query_range",
        "200",
        JSON,
        "object",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/prometheus/api/v1/query_range",
        "200",
        "text/event-stream",
        "none",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/_search_multi_stream",
        "200",
        "text/event-stream",
        "none",
    ),
    (
        "all",
        "GET",
        "/api/{org_id}/{stream_name}/traces/latest_stream",
        "200",
        "text/event-stream",
        "none",
    ),
    (
        "ent",
        "DELETE",
        "/api/{org_id}/datasets/{dataset_id}",
        "200",
        JSON,
        "object",
    ),
    (
        "ent",
        "DELETE",
        "/api/{org_id}/scorers/{entity_id}",
        "200",
        JSON,
        "object",
    ),
    (
        "ent",
        "DELETE",
        "/api/{org_id}/re_patterns/{pattern_id}",
        "200",
        JSON,
        "object",
    ),
    (
        "ent",
        "POST",
        "/api/{org_id}/storage",
        "201",
        JSON,
        "object",
    ),
    ("ent", "PUT", "/api/{org_id}/storage", "201", JSON, "object"),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billing_group/invites",
        "200",
        JSON,
        "array",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billing_group/members",
        "200",
        JSON,
        "array",
    ),
    (
        "cloud",
        "POST",
        "/api/{org_id}/azure-marketplace/link-subscription",
        "201",
        JSON,
        "object",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/checkout_session_detail",
        "302",
        "",
        "none",
    ),
    (
        "cloud",
        "POST",
        "/api/{org_id}/invites",
        "200",
        JSON,
        "object",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/unsubscribe",
        "200",
        "text/plain",
        "string",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/invites",
        "200",
        JSON,
        "array",
    ),
    (
        "cloud",
        "DELETE",
        "/api/{org_id}/invites/{token}",
        "200",
        JSON,
        "string",
    ),
    (
        "cloud",
        "POST",
        "/api/{org_id}/external_contract",
        "200",
        JSON,
        "object",
    ),
    (
        "cloud",
        "PUT",
        "/api/{org_id}/enable_org_storage",
        "200",
        JSON,
        "object",
    ),
    (
        "cloud",
        "PUT",
        "/api/{org_id}/extend_trial_period",
        "200",
        "text/plain",
        "string",
    ),
];

/// Multipart uploads (edition, path) and the part each handler cannot work without.
const MULTIPART_UPLOADS: &[(&str, &str, &str)] = &[
    ("all", "/api/{org_id}/sourcemaps", "file"),
    (
        "ent",
        "/api/{org_id}/datasets/{dataset_id}/items/import",
        "file",
    ),
    ("all", "/api/{org_id}/settings/logo", "file"),
];

/// Query parameters (edition, method, path, name) the handler rejects a request without.
const REQUIRED_QUERY_PARAMS: &[(&str, &str, &str, &str)] = &[
    (
        "all",
        "POST",
        "/api/{org_id}/prometheus/api/v1/format_query",
        "query",
    ),
    ("ent", "GET", "/api/{org_id}/search/profile", "trace_id"),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/checkout_session_detail",
        "session_id",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/checkout_session_detail",
        "status",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/checkout_session_detail",
        "plan",
    ),
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/hosted_subscription_url",
        "plan",
    ),
];

/// Handlers that take no body, so a documented one would only mislead a generated client.
const BODYLESS_ROUTES: &[(&str, &str, &str)] = &[
    (
        "cloud",
        "POST",
        "/api/{org_id}/billing_group/invites/{token}/accept",
    ),
    (
        "cloud",
        "DELETE",
        "/api/{org_id}/billing_group/invites/{token}/reject",
    ),
    ("cloud", "GET", "/api/{org_id}/billing_group/members"),
    ("cloud", "GET", "/api/{org_id}/billing_group/membership"),
    (
        "all",
        "POST",
        "/api/{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/pause",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/refresh",
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/resume",
    ),
    ("all", "POST", "/api/{org_id}/status_pages/{id}/rotate_slug"),
    (
        "all",
        "POST",
        "/api/{org_id}/org_cleanup_tasks/{target_org_id}/retry",
    ),
    ("all", "DELETE", "/api/{org_id}/synthetics/locations/{id}"),
];

/// Stubs that answer 403 in every build outside cloud, so they document no success response.
const ALWAYS_FORBIDDEN: &[(&str, &str, &str)] = &[
    ("noncloud", "GET", "/api/invites"),
    ("noncloud", "DELETE", "/api/invites/{token}"),
];

/// `Option<Json<T>>` bodies and their schema: leaving the body out works, a JSON `null` is a 422.
const OPTIONAL_BODIES: &[(&str, &str, &str, &str)] =
    &[("all", "POST", "/auth/login", "SignInUser")];

/// Body fields clients rely on: edition, method, path, request or status, fields, required fields.
const BODY_FIELDS: &[BodyFieldsRow] = &[
    (
        "cloud",
        "GET",
        "/api/{org_id}/billings/data_usage/{usage_date}",
        "200",
        &["price_details"],
        &["price_details"],
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/synthetics/{id}/artifacts/presign",
        "request",
        &["keys"],
        &["keys"],
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/synthetics/{id}/artifacts/presign",
        "200",
        &["expires_in", "mode", "urls"],
        &["expires_in", "mode", "urls"],
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/synthetics/agent-tokens",
        "request",
        &["name"],
        &["name"],
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/synthetics/agent-tokens/rotate",
        "request",
        &["name"],
        &[],
    ),
    (
        "all",
        "PATCH",
        "/api/{org_id}/synthetics/agent-tokens/{name}",
        "request",
        &["enabled"],
        &["enabled"],
    ),
    (
        "all",
        "PUT",
        "/api/{org_id}/synthetics/locations/{id}",
        "request",
        &["enabled", "label"],
        &["label"],
    ),
    (
        "ent",
        "POST",
        "/api/{org_id}/traces/agent_signals/compare",
        "request",
        &["a", "b"],
        &["a", "b"],
    ),
    (
        "all",
        "POST",
        "/gcp/{org_id}/{stream_name}/_sub",
        "request",
        &["message", "subscription"],
        &["message", "subscription"],
    ),
    ("ent", "POST", "/api/license", "request", &["key"], &["key"]),
    (
        "ent",
        "POST",
        "/config/token",
        "request",
        &["token", "token_type"],
        &["token", "token_type"],
    ),
    (
        "all",
        "DELETE",
        "/api/{org_id}/users/bulk",
        "request",
        &["ids"],
        &["ids"],
    ),
    (
        "all",
        "POST",
        "/api/{org_id}/sourcemaps/stacktrace",
        "request",
        &["env", "service", "stacktrace", "version"],
        &["stacktrace"],
    ),
    (
        "cloud",
        "POST",
        "/api/{org_id}/invites",
        "request",
        &["invites", "role"],
        &["role"],
    ),
];

type ContractRow = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

type BodyFieldsRow = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
);

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
struct ParsedRoute {
    method: String,
    path: String,
    active: bool,
}

struct RouterFn {
    name: String,
    cfgs: Vec<String>,
    body: String,
}

struct PublishedOp {
    method: String,
    path: String,
    op: Value,
}

fn strip_comments(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let (mut i, mut in_string) = (0, false);
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' {
                out.push(chars[i + 1]);
                i += 1;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        } else {
            in_string = c == '"';
            out.push(c);
        }
        i += 1;
    }
    out
}

/// Byte offset just past the bracket closing the one at `open`, skipping string bodies.
fn close_of(text: &str, open: usize) -> usize {
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut i) = (0i32, false, open);
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            if b == b'\\' {
                i += 1;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth -= 1,
                _ => {}
            }
            if depth == 0 {
                return i + 1;
            }
        }
        i += 1;
    }
    panic!("unbalanced bracket at offset {open}");
}

/// Byte offset just past the `;` ending the statement at `from`, or the text end.
fn statement_end(text: &str, from: usize) -> usize {
    let bytes = text.as_bytes();
    let mut i = from;
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' => i = close_of(text, i),
            b'"' => i += 1 + text[i + 1..].find('"').unwrap_or(0) + 1,
            b';' => return i + 1,
            _ => i += 1,
        }
    }
    text.len()
}

/// `#[cfg(...)]` predicates in the attribute lines right above `at`.
fn attrs_above(source: &str, at: usize) -> Vec<String> {
    source[..at]
        .lines()
        .rev()
        .map(str::trim)
        .take_while(|line| line.is_empty() || line.starts_with("#["))
        .filter_map(|line| line.strip_prefix("#[cfg(")?.strip_suffix(")]"))
        .map(str::to_string)
        .collect()
}

fn router_functions() -> Vec<RouterFn> {
    let source = strip_comments(ROUTER_SOURCE);
    let (production, _) = source
        .split_once("\n#[cfg(test)]\nmod tests {")
        .expect("router source must end with its tests module");
    let header = Regex::new(r"(?m)^(?:pub(?:\(crate\))? )?(?:async )?fn (\w+)\b[^{]*").unwrap();
    let mut functions = Vec::new();
    for found in header.captures_iter(production) {
        let whole = found.get(0).unwrap();
        let body = &production[whole.end()..close_of(production, whole.end())];
        if body.contains(".route(") && !UNSCANNED_ROUTERS.contains(&&found[1]) {
            functions.push(RouterFn {
                name: found[1].to_string(),
                cfgs: attrs_above(production, whole.start()),
                body: body.to_string(),
            });
        }
    }
    functions
}

fn feature_enabled(feature: &str) -> bool {
    match feature {
        "enterprise" => cfg!(feature = "enterprise"),
        "cloud" => cfg!(feature = "cloud"),
        "cpu-profiling" => cfg!(feature = "cpu-profiling"),
        "profiling" => cfg!(feature = "profiling"),
        other => panic!("feature {other} is unknown to the OpenAPI guard"),
    }
}

/// Evaluates the `feature`, `not`, `all` and `any` predicates the router uses.
fn cfg_holds(predicate: &str) -> bool {
    let predicate = predicate.trim();
    let args = |prefix: &str| {
        predicate
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(')'))
    };
    let split = |text: &str| -> Vec<String> {
        let (mut parts, mut depth, mut current) = (Vec::new(), 0, String::new());
        for c in text.chars() {
            depth += i32::from(c == '(') - i32::from(c == ')');
            if c == ',' && depth == 0 {
                parts.push(std::mem::take(&mut current));
            } else {
                current.push(c);
            }
        }
        parts.push(current);
        parts
    };
    if let Some(inner) = args("not(") {
        return !cfg_holds(inner);
    }
    if let Some(inner) = args("all(") {
        return split(inner).iter().all(|part| cfg_holds(part));
    }
    if let Some(inner) = args("any(") {
        return split(inner).iter().any(|part| cfg_holds(part));
    }
    let feature = predicate
        .strip_prefix("feature = \"")
        .and_then(|rest| rest.strip_suffix('"'));
    feature_enabled(feature.unwrap_or_else(|| panic!("unsupported cfg: {predicate}")))
}

/// Text ranges gated by a `#[cfg]`: its block, its `if` block or its statement.
fn cfg_spans(body: &str) -> Vec<(Range<usize>, String)> {
    let mut spans = Vec::new();
    for (at, _) in body.match_indices("#[cfg(") {
        let end = close_of(body, at + 1);
        let predicate = body[at + "#[cfg(".len()..end - 2].to_string();
        let next = end + body[end..].len() - body[end..].trim_start().len();
        let block = if body[next..].starts_with("if ") {
            body[next..].find('{').map(|brace| next + brace)
        } else {
            body[next..].starts_with('{').then_some(next)
        };
        let stop = block.map_or_else(|| statement_end(body, next), |open| close_of(body, open));
        spans.push((next..stop, predicate));
    }
    spans
}

/// Text ranges mounted under a nested prefix: an inline router or a `let` router variable.
fn nest_spans(body: &str) -> Vec<(Range<usize>, String)> {
    let mut spans = Vec::new();
    for (at, _) in body.match_indices(".nest(") {
        let open = at + ".nest".len();
        let args = &body[open + 1..close_of(body, open) - 1];
        let (prefix, target) = args.split_once(',').expect("nest takes two arguments");
        let prefix = prefix.trim().trim_matches('"').to_string();
        let target = target.trim();
        if target.starts_with("Router::new()") {
            spans.push((open..open + args.len(), prefix));
            continue;
        }
        let binding = Regex::new(&format!(r"let (?:mut )?{target}\b")).unwrap();
        for found in binding.find_iter(body) {
            spans.push((
                found.start()..statement_end(body, found.start()),
                prefix.clone(),
            ));
        }
    }
    spans
}

/// HTTP verbs bound by a `.route` handler expression; `ANY` when a helper hides them.
fn bound_verbs(expression: &str) -> Vec<String> {
    let call = Regex::new(r"^[\s.]*(?:[A-Za-z_]+::)*([A-Za-z_]+)\s*(?:::<[^(]*>)?\(").unwrap();
    let mut verbs = Vec::new();
    let mut rest = expression;
    while let Some(found) = call.captures(rest) {
        let whole = found.get(0).unwrap();
        if VERBS.contains(&&found[1]) {
            verbs.push(found[1].to_uppercase());
        }
        rest = &rest[close_of(rest, whole.end() - 1)..];
    }
    if verbs.is_empty() {
        verbs.push("ANY".to_string());
    }
    verbs
}

fn routes_of(function: &RouterFn) -> Vec<ParsedRoute> {
    let base = ROUTER_PREFIXES
        .iter()
        .find(|(name, _)| *name == function.name)
        .unwrap_or_else(|| panic!("add {} to ROUTER_PREFIXES", function.name))
        .1;
    let body = function.body.as_str();
    let (cfgs, nests) = (cfg_spans(body), nest_spans(body));
    let fn_active = function.cfgs.iter().all(|cfg| cfg_holds(cfg));
    let mut routes = Vec::new();
    for (at, _) in body.match_indices(".route(") {
        let open = at + ".route".len();
        let args = &body[open + 1..close_of(body, open) - 1];
        let (path, handler) = args.split_once(',').expect("route takes two arguments");
        let path = path.trim();
        assert!(path.starts_with('"'), "non-literal route path: {path}");
        let inner: String = nests
            .iter()
            .filter(|(span, _)| span.contains(&at))
            .map(|(_, prefix)| prefix.as_str())
            .collect();
        let active = fn_active
            && cfgs
                .iter()
                .filter(|(span, _)| span.contains(&at))
                .all(|(_, cfg)| cfg_holds(cfg));
        for method in bound_verbs(handler) {
            routes.push(ParsedRoute {
                method,
                path: format!("{base}{inner}{}", path.trim_matches('"')),
                active,
            });
        }
    }
    routes
}

fn parsed_routes() -> Vec<ParsedRoute> {
    let mut routes: Vec<ParsedRoute> = router_functions().iter().flat_map(routes_of).collect();
    routes.sort();
    routes.dedup();
    routes
}

/// A path with its parameter names erased and no trailing slash.
fn shape(path: &str) -> String {
    let erased: Vec<&str> = path
        .trim_end_matches('/')
        .split('/')
        .map(|s| if s.starts_with('{') { "{}" } else { s })
        .collect();
    erased.join("/")
}

fn route_key(method: &str, path: &str) -> String {
    format!("{method} {}", shape(path))
}

fn published_spec() -> Value {
    serde_json::to_value(ApiDoc::openapi()).unwrap()
}

fn published_ops(spec: &Value) -> Vec<PublishedOp> {
    let mut ops = Vec::new();
    for (path, item) in spec["paths"].as_object().unwrap() {
        for verb in VERBS {
            if let Some(op) = item.get(*verb) {
                ops.push(PublishedOp {
                    method: verb.to_uppercase(),
                    path: path.clone(),
                    op: op.clone(),
                });
            }
        }
    }
    ops
}

fn data_lines(file: &'static str) -> impl Iterator<Item = &'static str> {
    file.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

/// `METHOD /path | reason` lines as `METHOD /path` keys; a reason is mandatory.
fn reasoned_entries(file: &'static str) -> BTreeSet<&'static str> {
    let mut entries = BTreeSet::new();
    for line in data_lines(file) {
        let (route, reason) = line.split_once(" | ").expect("entry needs ` | reason`");
        assert!(!reason.trim().is_empty(), "entry without a reason: {line}");
        assert!(entries.insert(route), "duplicate entry: {route}");
    }
    entries
}

/// Whether a row or line tagged with `edition` describes this build.
fn edition_applies(edition: &str) -> bool {
    match edition {
        "all" => true,
        "oss" => cfg!(not(feature = "enterprise")),
        "ent" => cfg!(feature = "enterprise"),
        "cloud" => cfg!(feature = "cloud"),
        "noncloud" => cfg!(not(feature = "cloud")),
        other => panic!("unknown edition {other}"),
    }
}

/// The floor of table rows a test must check in this build: OSS, enterprise, cloud.
fn build_floor(oss: usize, enterprise: usize, cloud: usize) -> usize {
    if cfg!(feature = "cloud") {
        cloud
    } else if cfg!(feature = "enterprise") {
        enterprise
    } else {
        oss
    }
}

/// `edition entry` lines that apply to this build, without their edition.
fn edition_entries(file: &'static str) -> BTreeSet<String> {
    let mut entries = BTreeSet::new();
    for line in data_lines(file) {
        let (edition, entry) = line.split_once(' ').expect("line needs an edition");
        if edition_applies(edition) {
            assert!(
                entries.insert(entry.to_string()),
                "duplicate entry: {entry}"
            );
        }
    }
    entries
}

/// Baseline lines that apply to this build, as `rule METHOD /path`.
fn baseline_entries() -> BTreeSet<String> {
    edition_entries(BASELINE)
}

/// The baseline split into unpublished routes and operation rule violations.
fn split_baseline() -> (BTreeSet<String>, BTreeSet<String>) {
    let (routes, rules): (BTreeSet<String>, BTreeSet<String>) = baseline_entries()
        .into_iter()
        .partition(|entry| entry.starts_with("unpublished "));
    let routes = routes
        .iter()
        .map(|entry| entry["unpublished ".len()..].to_string())
        .collect();
    (routes, rules)
}

fn has_valid_ratelimit(op: &Value) -> bool {
    let limit = &op["x-o2-ratelimit"];
    let module = limit["module"].as_str().unwrap_or_default();
    let operation = limit["operation"].as_str().unwrap_or_default();
    !module.is_empty() && RATELIMIT_OPERATIONS.contains(&operation)
}

fn has_success_body(op: &Value) -> bool {
    let Some(responses) = op["responses"].as_object() else {
        return false;
    };
    responses.iter().any(|(status, response)| {
        // 204 has no body to describe, and a redirect handler succeeds with a 302.
        status == "204"
            || (status == "302" && response["headers"]["Location"].is_object())
            || ((status.starts_with('2') || status == "302")
                && response["content"]
                    .as_object()
                    .is_some_and(|content| !content.is_empty()))
    })
}

fn find_op<'a>(ops: &'a [PublishedOp], method: &str, path: &str) -> Option<&'a Value> {
    ops.iter()
        .find(|published| published.method == method && published.path == path)
        .map(|published| &published.op)
}

/// The op a table row names, `None` in builds the row is not for; an unpublished op panics.
fn row_op<'a>(
    ops: &'a [PublishedOp],
    edition: &str,
    method: &str,
    path: &str,
) -> Option<&'a Value> {
    if !edition_applies(edition) {
        return None;
    }
    let op = find_op(ops, method, path);
    Some(op.unwrap_or_else(|| panic!("{edition} row {method} {path} is not published")))
}

/// `x-o2-mcp` absent, unparsable or without `enabled: false` leaves the MCP tool on.
fn is_mcp_enabled(op: &Value) -> bool {
    op["x-o2-mcp"]["enabled"] != false
}

fn is_nullable(schema: &Value) -> bool {
    let null = Value::from("null");
    schema["type"] == null
        || schema["type"]
            .as_array()
            .is_some_and(|types| types.contains(&null))
        || ["oneOf", "anyOf"].iter().any(|key| {
            schema[*key]
                .as_array()
                .is_some_and(|variants| variants.iter().any(is_nullable))
        })
}

/// Follows a `$ref` into `components`, so a row reads the same inlined or referenced.
fn resolved<'a>(spec: &'a Value, schema: &'a Value) -> &'a Value {
    schema["$ref"]
        .as_str()
        .and_then(|target| target.rsplit('/').next())
        .map_or(schema, |name| &spec["components"]["schemas"][name])
}

fn sorted_names(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut names: Vec<String> = values.collect();
    names.sort();
    names
}

fn is_binary(schema: &Value) -> bool {
    schema["type"] == "string" && schema["format"] == "binary"
}

fn schema_has_shape(schema: &Value, shape: &str) -> bool {
    match shape {
        "nullable" => is_nullable(schema),
        "binary" => is_binary(schema),
        "none" => true,
        _ => schema["type"] == shape,
    }
}

fn is_text_media(media: &str) -> bool {
    media.starts_with("text/")
        || media.starts_with("multipart/")
        || media.ends_with("json")
        || media.ends_with("+xml")
        || media == "application/x-www-form-urlencoded"
}

fn media_of(holder: &Value) -> impl Iterator<Item = (&String, &Value)> {
    holder["content"].as_object().into_iter().flatten()
}

/// A binary payload typed as a string makes a generated client decode it as text.
fn has_text_typed_binary(op: &Value) -> bool {
    let responses = op["responses"].as_object().into_iter().flatten();
    media_of(&op["requestBody"])
        .chain(responses.flat_map(|(_, response)| media_of(response)))
        .any(|(media, entry)| {
            let schema = &entry["schema"];
            !is_text_media(media) && schema["type"] == "string" && !is_binary(schema)
        })
}

fn has_nullable_body(op: &Value) -> bool {
    media_of(&op["requestBody"]).any(|(_, entry)| is_nullable(&entry["schema"]))
}

/// A schema with no type, `$ref` or composition is `serde_json::Value`, which takes a null.
#[cfg(feature = "enterprise")]
fn takes_anything(schema: &Value) -> bool {
    schema.as_object().is_some_and(|keys| {
        ["type", "$ref", "oneOf", "anyOf", "allOf"]
            .iter()
            .all(|key| !keys.contains_key(*key))
    })
}

/// Collects the paths of nulls in `value` that its schema does not allow.
#[cfg(feature = "enterprise")]
fn unfit_nulls(spec: &Value, schema: &Value, value: &Value, at: &str, found: &mut Vec<String>) {
    let schema = resolved(spec, schema);
    if let Some(items) = value.as_array() {
        for item in items {
            unfit_nulls(spec, &schema["items"], item, &format!("{at}[]"), found);
        }
        return;
    }
    for (name, field) in value.as_object().into_iter().flatten() {
        let property = &schema["properties"][name];
        if !property.is_object() {
            continue;
        }
        let at = format!("{at}.{name}");
        if !field.is_null() {
            unfit_nulls(spec, property, field, &at, found);
        } else if !is_nullable(resolved(spec, property)) && !takes_anything(property) {
            found.push(at);
        }
    }
}

fn has_declared_tag(op: &Value, declared: &BTreeSet<&str>) -> bool {
    op["tags"].as_array().is_some_and(|tags| {
        !tags.is_empty()
            && tags
                .iter()
                .all(|tag| tag.as_str().is_some_and(|tag| declared.contains(tag)))
    })
}

fn template_params(path: &str) -> Vec<String> {
    let names = path
        .split('/')
        .filter_map(|s| s.strip_prefix('{')?.strip_suffix('}'))
        .map(|s| s.trim_start_matches('*').to_string());
    sorted_names(names)
}

/// Sorted and not deduplicated, so a path parameter declared twice breaks the rule.
fn declared_path_params(op: &Value) -> Vec<String> {
    let params = op["parameters"].as_array().into_iter().flatten();
    let names = params
        .filter(|param| param["in"] == "path")
        .filter_map(|param| param["name"].as_str().map(str::to_string));
    sorted_names(names)
}

/// Rules a published op breaks, ignoring the rate-limit rule for exempt routes.
fn broken_rules(
    published: &PublishedOp,
    declared: &BTreeSet<&str>,
    routes: &BTreeMap<String, Vec<&ParsedRoute>>,
    exempt: bool,
) -> Vec<&'static str> {
    let op = &published.op;
    let mut broken = Vec::new();
    if !op["x-o2-mcp"].is_object() {
        broken.push("mcp");
    }
    if !exempt && !has_valid_ratelimit(op) {
        broken.push("ratelimit");
    }
    if op.get("security").is_none() {
        broken.push("security");
    }
    if op["summary"].as_str().is_none_or(str::is_empty) {
        broken.push("summary");
    }
    if !has_declared_tag(op, declared) {
        broken.push("tag");
    }
    if !has_success_body(op) {
        broken.push("response");
    }
    if has_text_typed_binary(op) {
        broken.push("binary");
    }
    if has_nullable_body(op) {
        broken.push("nullbody");
    }
    match routes.get(&route_key(&published.method, &published.path)) {
        None => broken.push("route"),
        Some(served)
            if !served
                .iter()
                .any(|r| r.path.trim_end_matches('/') == published.path.trim_end_matches('/')) =>
        {
            broken.push("params")
        }
        Some(_) if template_params(&published.path) != declared_path_params(op) => {
            broken.push("params")
        }
        Some(_) => {}
    }
    broken
}

fn assert_no_difference(found: &BTreeSet<String>, expected: &BTreeSet<String>, context: &str) {
    let new: Vec<_> = found.difference(expected).collect();
    let stale: Vec<_> = expected.difference(found).collect();
    assert!(
        new.is_empty() && stale.is_empty(),
        "{context}\nnew violations ({}): {new:#?}\nstale entries, delete them ({}): {stale:#?}",
        new.len(),
        stale.len(),
    );
}

#[test]
fn the_route_parser_reads_the_whole_router() {
    let routes = parsed_routes();
    let active = routes.iter().filter(|route| route.active).count();
    assert!(
        routes.len() >= MIN_PARSED_ROUTES,
        "parsed only {}",
        routes.len()
    );
    assert!(active >= MIN_ACTIVE_ROUTES, "only {active} active routes");
    for (method, path) in [
        ("GET", "/healthz"),
        ("POST", "/aws/{org_id}/{stream_name}/_kinesis_firehose"),
        ("PUT", "/node/enable"),
        ("GET", "/config/logout"),
        ("POST", "/api/{org_id}/{stream_name}/_json"),
    ] {
        assert!(
            routes.iter().any(|r| r.method == method && r.path == path),
            "{method} {path} was not parsed"
        );
    }
}

#[test]
fn every_route_is_published_or_excluded() {
    let spec = published_spec();
    let published: BTreeSet<String> = published_ops(&spec)
        .iter()
        .map(|op| route_key(&op.method, &op.path))
        .collect();
    let excluded = reasoned_entries(EXCLUDED_ROUTES);
    let missing: BTreeSet<String> = parsed_routes()
        .iter()
        .filter(|route| route.active && !published.contains(&route_key(&route.method, &route.path)))
        .map(|route| format!("{} {}", route.method, route.path))
        .filter(|route| !excluded.contains(route.as_str()))
        .collect();
    let (known, _) = split_baseline();
    assert_no_difference(
        &missing,
        &known,
        "publish these routes in openapi.rs or add them to excluded_routes.txt",
    );
}

#[test]
fn excluded_routes_are_real_and_unpublished() {
    let spec = published_spec();
    let published: BTreeSet<String> = published_ops(&spec)
        .iter()
        .map(|op| route_key(&op.method, &op.path))
        .collect();
    let routes: BTreeSet<String> = parsed_routes()
        .iter()
        .map(|route| format!("{} {}", route.method, route.path))
        .collect();
    for entry in reasoned_entries(EXCLUDED_ROUTES) {
        assert!(
            routes.contains(entry),
            "stale exclusion, no such route: {entry}"
        );
        let (method, path) = entry.split_once(' ').unwrap();
        assert!(
            !published.contains(&route_key(method, path)),
            "stale exclusion, the route is published: {entry}"
        );
    }
}

#[test]
fn operation_ids_are_unique() {
    let spec = published_spec();
    let mut owners = BTreeMap::<String, Vec<String>>::new();
    for published in published_ops(&spec) {
        let id = published.op["operationId"].as_str().unwrap_or_default();
        owners
            .entry(id.to_string())
            .or_default()
            .push(format!("{} {}", published.method, published.path));
    }
    owners.retain(|_, routes| routes.len() > 1);
    assert!(owners.is_empty(), "duplicate operation ids: {owners:#?}");
}

#[test]
fn published_operations_keep_their_contract() {
    let spec = published_spec();
    let declared: BTreeSet<&str> = spec["tags"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|tag| tag["name"].as_str())
        .collect();
    let parsed = parsed_routes();
    let mut routes = BTreeMap::<String, Vec<&ParsedRoute>>::new();
    for route in parsed.iter().filter(|route| route.active) {
        routes
            .entry(route_key(&route.method, &route.path))
            .or_default()
            .push(route);
    }
    let exempt = reasoned_entries(RATELIMIT_EXEMPT);
    let forbidden: BTreeSet<String> = ALWAYS_FORBIDDEN
        .iter()
        .filter(|(edition, ..)| edition_applies(edition))
        .map(|(_, method, path)| format!("{method} {path}"))
        .collect();
    let mut found = BTreeSet::new();
    for published in published_ops(&spec) {
        let route = format!("{} {}", published.method, published.path);
        let is_exempt = exempt.contains(route.as_str());
        for rule in broken_rules(&published, &declared, &routes, is_exempt) {
            if !(rule == "response" && forbidden.contains(&route)) {
                found.insert(format!("{rule} {route}"));
            }
        }
    }
    let (_, baseline) = split_baseline();
    assert_no_difference(
        &found,
        &baseline,
        "fix the operation; baseline.txt only ever shrinks",
    );
}

#[test]
fn ratelimit_exemptions_are_real_and_unlimited() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let routes: BTreeSet<String> = parsed_routes()
        .iter()
        .map(|route| format!("{} {}", route.method, route.path))
        .collect();
    for entry in reasoned_entries(RATELIMIT_EXEMPT) {
        assert!(
            routes.contains(entry),
            "stale exemption, no such route: {entry}"
        );
        let (method, path) = entry.split_once(' ').unwrap();
        let limited = ops.iter().any(|op| {
            op.method == method && op.path == path && op.op.get("x-o2-ratelimit").is_some()
        });
        assert!(
            !limited,
            "stale exemption, the route is rate limited: {entry}"
        );
    }
}

#[test]
fn success_responses_match_their_handlers() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, method, path, status, content_type, shape) in SUCCESS_CONTRACTS {
        let Some(op) = row_op(&ops, edition, method, path) else {
            continue;
        };
        checked += 1;
        let response = &op["responses"][*status];
        assert!(
            response.is_object(),
            "{method} {path}: no {status} response"
        );
        if *status != "200" {
            assert!(
                op["responses"].get("200").is_none(),
                "{method} {path}: the handler never answers 200"
            );
        }
        if content_type.is_empty() {
            assert!(
                response.get("content").is_none(),
                "{method} {path}: has a body"
            );
            continue;
        }
        let media = &response["content"][*content_type];
        assert!(media.is_object(), "{method} {path}: not {content_type}");
        assert!(
            schema_has_shape(&media["schema"], shape),
            "{method} {path}: not {shape}: {}",
            media["schema"]
        );
    }
    let floor = build_floor(16, 30, 41);
    assert!(
        checked >= floor,
        "only {checked} of {floor} contract rows checked"
    );
}

#[test]
fn multipart_uploads_name_their_parts() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, path, part) in MULTIPART_UPLOADS {
        let Some(op) = row_op(&ops, edition, "POST", path) else {
            continue;
        };
        checked += 1;
        let schema = &op["requestBody"]["content"]["multipart/form-data"]["schema"];
        assert_eq!(schema["properties"][*part]["format"], "binary", "{path}");
        assert!(
            schema["required"]
                .as_array()
                .is_some_and(|required| required.contains(&Value::from(*part))),
            "{path}: {part} must be required"
        );
    }
    assert!(
        checked >= build_floor(2, 3, 3),
        "only {checked} uploads checked"
    );
}

#[test]
fn required_query_params_are_declared_required() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, method, path, name) in REQUIRED_QUERY_PARAMS {
        let Some(op) = row_op(&ops, edition, method, path) else {
            continue;
        };
        checked += 1;
        let declared = op["parameters"].as_array().is_some_and(|params| {
            params.iter().any(|param| {
                param["name"] == *name && param["in"] == "query" && param["required"] == true
            })
        });
        assert!(declared, "{method} {path}: {name} must be a required param");
    }
    assert!(
        checked >= build_floor(1, 2, 6),
        "only {checked} params checked"
    );
}

#[test]
fn prometheus_forms_name_their_fields() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let form = |path: &str| {
        let op = find_op(&ops, "POST", path).unwrap();
        op["requestBody"]["content"]["application/x-www-form-urlencoded"]["schema"].clone()
    };
    let format_query = form("/api/{org_id}/prometheus/api/v1/format_query");
    assert_eq!(format_query["required"], serde_json::json!(["query"]));
    let series = form("/api/{org_id}/prometheus/api/v1/series");
    assert!(series["properties"]["match[]"].is_object(), "{series}");
    let range = form("/api/{org_id}/prometheus/api/v1/query_range");
    assert_eq!(
        range["properties"]["regions"]["type"][0], "string",
        "{range}"
    );
}

// Enterprise answers 403 first: the metric permission check needs a stored user.
#[cfg(not(feature = "enterprise"))]
#[tokio::test]
async fn range_query_post_declares_what_the_handler_sends() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, "POST", "/api/{org_id}/prometheus/api/v1/query_range").unwrap();
    for streaming in [true, false] {
        let request = || {
            serde_json::from_value::<config::meta::promql::RequestRangeQuery>(serde_json::json!({
                "query": "up", "start": "1700000000", "end": "1700000060", "step": "15s",
                "use_streaming": streaming,
            }))
            .unwrap()
        };
        let response = openobserve_api_search::promql::query_range_post(
            axum::extract::Path("org".to_string()),
            axum::extract::Query(request()),
            openobserve_api_common::extractors::Headers(openobserve_core::auth::UserEmail {
                user_id: "u@example.com".to_string(),
            }),
            axum::http::HeaderMap::new(),
            axum::Form(request()),
        )
        .await;
        let status = response.status();
        let media = response.headers()[axum::http::header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .to_string();
        // The JSON branch errors without stored metrics, so only its media type is checked.
        assert!(
            status.is_success() || !streaming,
            "use_streaming=true answered {status}"
        );
        let declared = &op["responses"]["200"]["content"][media.as_str()];
        assert!(
            declared.is_object(),
            "use_streaming={streaming}: {media} is not published for 200"
        );
    }
}

#[test]
fn bodyless_handlers_document_no_body() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, method, path) in BODYLESS_ROUTES {
        if let Some(op) = row_op(&ops, edition, method, path) {
            assert!(op.get("requestBody").is_none(), "{method} {path}");
            checked += 1;
        }
    }
    assert!(
        checked >= build_floor(6, 6, 10),
        "only {checked} routes checked"
    );
}

#[test]
fn unsupported_stubs_document_their_403() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, method, path) in ALWAYS_FORBIDDEN {
        let Some(op) = row_op(&ops, edition, method, path) else {
            continue;
        };
        checked += 1;
        let responses = op["responses"].as_object().unwrap();
        assert!(responses.contains_key("403"), "{method} {path}: no 403");
        assert!(
            !responses.keys().any(|status| status.starts_with('2')),
            "{method} {path}: the stub never succeeds"
        );
    }
    assert!(
        checked >= build_floor(2, 2, 0),
        "only {checked} stubs checked"
    );
}

#[test]
fn optional_bodies_can_be_left_out_but_not_null() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    for (edition, method, path, schema) in OPTIONAL_BODIES {
        let Some(op) = row_op(&ops, edition, method, path) else {
            continue;
        };
        let body = &op["requestBody"];
        assert_ne!(body["required"], true, "{method} {path}");
        assert_eq!(
            body["content"][JSON]["schema"]["$ref"],
            format!("#/components/schemas/{schema}"),
            "{method} {path}"
        );
    }
}

#[test]
fn bodies_name_the_fields_their_handlers_use() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let mut checked = 0;
    for (edition, method, path, side, fields, required) in BODY_FIELDS {
        let Some(op) = row_op(&ops, edition, method, path) else {
            continue;
        };
        checked += 1;
        let holder = if *side == "request" {
            &op["requestBody"]
        } else {
            &op["responses"][*side]
        };
        let schema = resolved(&spec, &holder["content"][JSON]["schema"]);
        let properties = schema["properties"].as_object();
        let declared = sorted_names(properties.into_iter().flatten().map(|(k, _)| k.clone()));
        assert_eq!(declared, *fields, "{method} {path} {side}: {schema}");
        let needed = schema["required"].as_array().into_iter().flatten();
        let needed = sorted_names(needed.map(|name| name.as_str().unwrap().to_string()));
        assert_eq!(needed, *required, "{method} {path} {side}: {schema}");
    }
    let floor = build_floor(9, 12, 14);
    assert!(
        checked >= floor,
        "only {checked} of {floor} body rows checked"
    );
}

#[cfg(feature = "cloud")]
#[test]
fn usage_details_are_null_without_stripe_billing() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let path = "/api/{org_id}/billings/data_usage/{usage_date}";
    let op = find_op(&ops, "GET", path).unwrap();
    let schema = &op["responses"]["200"]["content"][JSON]["schema"];
    assert!(
        is_nullable(&schema["properties"]["price_details"]),
        "{schema}"
    );
}

#[test]
fn location_create_takes_one_or_a_batch() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, "POST", "/api/{org_id}/synthetics/locations").unwrap();
    let body = &op["requestBody"]["content"][JSON]["schema"];
    let forms = body["oneOf"].as_array().expect("two body forms");
    let has = |field: &str| {
        forms
            .iter()
            .any(|form| resolved(&spec, form)["properties"][field].is_object())
    };
    assert!(has("region") && has("locations"), "{body}");
}

#[cfg(feature = "enterprise")]
#[test]
fn eval_job_scorers_can_be_a_bare_id() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, "GET", "/api/{org_id}/eval_jobs/{job_id}").unwrap();
    let job = resolved(&spec, &op["responses"]["200"]["content"][JSON]["schema"]);
    let scorer = resolved(&spec, &job["properties"]["scorers"]["items"]);
    let forms = scorer["oneOf"].as_array().expect("two scorer forms");
    assert!(
        forms.iter().any(|form| form["type"] == "string"),
        "{scorer}"
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn eval_job_and_provider_nulls_fit_their_schemas() {
    use infra::table::{online_eval_jobs::OnlineEvalJob, providers::Provider};
    use openobserve_api_management::models::{eval_jobs, providers};

    let spec = published_spec();
    let ops = published_ops(&spec);
    let schema = |method: &str, path: &str, side: &str| {
        let op = find_op(&ops, method, path).unwrap();
        let holder = if side == "request" {
            &op["requestBody"]
        } else {
            &op["responses"][side]
        };
        holder["content"][JSON]["schema"].clone()
    };
    let mut found = Vec::new();
    for scope in ["span", "trace", "session"] {
        let request: eval_jobs::EvalJobRequestBody = serde_json::from_value(serde_json::json!({
            "name": "j", "stream": "traces", "streamType": "traces", "targetScope": scope,
            "filterCondition": {}, "scorers": ["scorer-1"], "samplingMode": "all",
            "samplingValue": null,
        }))
        .unwrap();
        let sent = serde_json::to_value(&request).unwrap();
        let job = OnlineEvalJob::try_from(request).unwrap();
        let answer = serde_json::to_value(eval_jobs::EvalJobResponseBody::from(job)).unwrap();
        let path = "/api/{org_id}/eval_jobs";
        let request_schema = schema("POST", path, "request");
        unfit_nulls(&spec, &request_schema, &sent, scope, &mut found);
        let get_schema = schema("GET", &format!("{path}/{{job_id}}"), "200");
        unfit_nulls(&spec, &get_schema, &answer, scope, &mut found);
        let list = serde_json::json!({ "list": [answer] });
        unfit_nulls(&spec, &schema("GET", path, "200"), &list, scope, &mut found);
    }
    let provider: providers::ProviderRequestBody = serde_json::from_value(serde_json::json!({
        "name": "p", "providerType": "openai", "authConfig": {},
    }))
    .unwrap();
    let answer = providers::ListProvidersResponseBody::from(vec![Provider::from(provider)]);
    let answer = serde_json::to_value(answer).unwrap();
    let list_schema = schema("GET", "/api/{org_id}/providers", "200");
    unfit_nulls(&spec, &list_schema, &answer, "provider", &mut found);
    assert!(found.is_empty(), "nulls the schema forbids: {found:?}");
    let request_schema = schema("POST", "/api/{org_id}/providers", "request");
    assert!(
        is_nullable(&resolved(&spec, &request_schema)["properties"]["rateLimits"]),
        "{request_schema}"
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn cancel_queries_takes_and_returns_a_list() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, "PUT", "/api/{org_id}/query_manager/cancel").unwrap();
    let body = &op["requestBody"]["content"][JSON]["schema"];
    assert_eq!(body["type"], "array", "{body}");
    assert!(
        body["items"]["properties"]["trace_id"].is_object(),
        "{body}"
    );
    assert!(body["items"]["properties"]["org_id"].is_object(), "{body}");
}

#[cfg(feature = "enterprise")]
#[test]
fn oncall_policy_priorities_are_integers() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let path = "/api/{org_id}/oncall/teams/{team_id}/policy";
    let op = find_op(&ops, "PUT", path).unwrap();
    let body = resolved(&spec, &op["requestBody"]["content"][JSON]["schema"]);
    let rung = resolved(&spec, &body["properties"]["rungs"]["items"]);
    assert_eq!(rung["properties"]["priority"]["type"], "integer", "{rung}");
}

#[test]
fn enabled_mcp_tools_match_the_snapshot() {
    let spec = published_spec();
    let enabled: BTreeSet<String> = published_ops(&spec)
        .iter()
        .filter(|published| is_mcp_enabled(&published.op))
        .map(|published| published.op["operationId"].as_str().unwrap().to_string())
        .collect();
    assert!(enabled.len() >= 300, "only {} MCP tools", enabled.len());
    assert_no_difference(
        &enabled,
        &edition_entries(MCP_ENABLED),
        "the enabled MCP tool set changed; edit mcp_enabled.txt only to enable or disable a tool on purpose",
    );
}
