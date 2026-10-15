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

//! The public serving plane. Registered in `basic_routes` without auth middleware or OpenFGA;
//! the slug is the only credential. Every gate reads the link and org settings rows from the
//! primary, so revoke, pause, expiry and the org switch apply on the next request.

use std::{sync::LazyLock, time::Duration};

use axum::{
    Json,
    extract::{Extension, Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    axum::middlewares::RealIp,
    meta::{
        dashboards::Dashboard,
        public_dashboards::{
            KeyedRange, NotReadyResponse, PublicVariable, SanitizedDashboard, TimeRange,
        },
    },
    router::is_public_dashboard_slug,
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    table::{
        dashboards,
        entity::{public_dashboard_org_settings::Model as OrgSettings, public_dashboards::Model},
        public_dashboards as table,
    },
};
use openobserve_core::public_dashboards::{
    self as core_pd, ENGINE, access,
    flight::FLIGHTS,
    materialize::{self, MIN_RETRY_SECS, ReadRequest, Served},
    store,
};
use serde::Deserialize;

use crate::request::public_rate_limit::{Counters, client_ip, too_many_requests};

const READ_WINDOW: Duration = Duration::from_secs(60);

/// Per-IP read counters for both public dashboard routes.
static READS: LazyLock<Counters> = LazyLock::new(Counters::default);
/// Per-link counters of data responses that carry a body.
static SLUG_READS: LazyLock<Counters> = LazyLock::new(Counters::default);

#[derive(Deserialize)]
pub struct DataParams {
    range: Option<String>,
}

enum Servable {
    NotFound,
    Unavailable,
    Expired,
    Error,
    Ok(Box<Model>, i64),
}

/// Resolve a slug to a servable link and its org's settings rev, or why it isn't served: unknown,
/// revoked, draft or switched off gives a uniform 404 (no existence oracle); paused 503; expired
/// 410.
async fn resolve(slug: &str) -> Servable {
    if !config::get_config().public_dashboards.enabled || !is_public_dashboard_slug(slug) {
        return Servable::NotFound;
    }
    let db = get_orm_client_rw().await;
    let pd = match table::get_by_slug(db, slug).await {
        Ok(Some(pd)) => pd,
        Ok(None) => return Servable::NotFound,
        Err(e) => {
            log::error!("public dashboard lookup failed: {e}");
            return Servable::Error;
        }
    };
    let settings = match table::get_settings(db, &pd.org_id).await {
        Ok(settings) => settings,
        Err(e) => {
            log::error!("public dashboard settings lookup failed: {e}");
            return Servable::Error;
        }
    };
    let (org_enabled, settings_rev) = org_gate(settings.as_ref());
    let blocked = db::org_status::is_blocked(&pd.org_id) || !trial_ok(&pd.org_id).await;
    let verdict = servable(pd.clone(), settings_rev, org_enabled, blocked, now_micros());
    if !matches!(verdict, Servable::Ok(..)) {
        // This querier owns the slug, so its files go on the first read that finds the link off.
        evict_link(&pd).await;
    }
    verdict
}

/// The org switch and settings revision; a missing row means enabled at revision 0.
fn org_gate(settings: Option<&OrgSettings>) -> (bool, i64) {
    settings.map_or((true, 0), |s| (s.enabled, s.rev))
}

/// Cloud: an org past its trial is served nothing, warm results and 304s included.
#[cfg_attr(not(feature = "cloud"), allow(unused_variables))]
async fn trial_ok(org: &str) -> bool {
    #[cfg(feature = "cloud")]
    return matches!(
        openobserve_core::organization::is_org_in_free_trial_period(org).await,
        Ok(true)
    );
    #[cfg(not(feature = "cloud"))]
    true
}

async fn evict_link(pd: &Model) {
    for range in core_pd::time_ranges(pd).ranges {
        store::evict(&store::key(&pd.org_id, &pd.id, &range.key())).await;
    }
}

/// Whether a loaded link may be served; it is read fresh per request, so changes apply at once.
fn servable(
    pd: Model,
    settings_rev: i64,
    org_enabled: bool,
    org_blocked: bool,
    now: i64,
) -> Servable {
    // visibility: 0 draft, 1 public.
    if !org_enabled || pd.deleted_at.is_some() || pd.visibility != 1 {
        return Servable::NotFound;
    }
    if org_blocked {
        return Servable::Unavailable;
    }
    if pd.expires_at.is_some_and(|exp| exp <= now) {
        return Servable::Expired;
    }
    if !pd.enabled {
        return Servable::Unavailable;
    }
    Servable::Ok(Box::new(pd), settings_rev)
}

/// GET /api/public_dashboards/{slug} — the sanitized config the viewer renders.
pub async fn config(ip: Option<Extension<RealIp>>, Path(slug): Path<String>) -> Response {
    if rate_limited(ip.map(|e| e.0)) {
        return with_headers(too_many_requests(READ_WINDOW));
    }
    with_headers(serve_config(&slug).await)
}

/// GET /api/public_dashboards/{slug}/data?range= — one range's result, built on first read.
pub async fn data(
    ip: Option<Extension<RealIp>>,
    Path(slug): Path<String>,
    Query(params): Query<DataParams>,
    headers: HeaderMap,
) -> Response {
    if rate_limited(ip.map(|e| e.0)) {
        return with_headers(too_many_requests(READ_WINDOW));
    }
    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());
    with_headers(serve_data(&slug, params.range.as_deref(), if_none_match).await)
}

async fn serve_config(slug: &str) -> Response {
    let (pd, settings_rev) = match resolve(slug).await {
        Servable::Ok(pd, settings_rev) => (pd, settings_rev),
        Servable::Unavailable => return unavailable(),
        Servable::Expired => return expired(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
        Servable::Error => return server_error(),
    };
    let dash = match dashboards::get_by_id_primary(&pd.org_id, &pd.dashboard_id).await {
        Ok(Some((_folder, dash))) => dash,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            log::error!("public dashboard load failed: {e}");
            return server_error();
        }
    };
    let (title, layout) = project_layout(&dash);
    let frozen = pd
        .frozen_variables
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let policy = openobserve_core::public_dashboards::time_ranges(&pd);
    let min_refresh = i64::from(config::get_config().public_dashboards.min_refresh_secs);
    let selected = i64::from(pd.refresh_secs);
    Json(SanitizedDashboard {
        title,
        layout,
        ranges: policy
            .ranges
            .iter()
            .map(|range| KeyedRange {
                key: range.key(),
                range: *range,
                refresh_secs: range.effective_refresh_secs(selected, min_refresh),
            })
            .collect(),
        default_key: policy.default.key(),
        timestamp_column: config::TIMESTAMP_COL_NAME.to_string(),
        refresh_secs: policy.default.effective_refresh_secs(selected, min_refresh),
        variables: public_variables(&dash, pd.frozen_variables.as_deref()),
        dashboard_updated_at: dash.updated_at,
        link_rev: pd.rev,
        settings_rev,
        intents: core_pd::intent::intents(&dash, &frozen),
    })
    .into_response()
}

/// The materializer entry point (design 4.2); ETag and 304 are decided on the masked result.
async fn serve_data(slug: &str, range_key: Option<&str>, if_none_match: Option<&str>) -> Response {
    let (pd, settings_rev) = match resolve(slug).await {
        Servable::Ok(pd, settings_rev) => (pd, settings_rev),
        Servable::Unavailable => return unavailable(),
        Servable::Expired => return expired(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
        Servable::Error => return server_error(),
    };
    let range_key = range_key.map_or_else(|| default_range_key(&pd), str::to_string);
    let Some(range) = offered_range(&pd, &range_key) else {
        // A range removed by an edit leaves its file behind until someone asks for it.
        store::evict(&store::key(&pd.org_id, &pd.id, &range_key)).await;
        return StatusCode::NOT_FOUND.into_response();
    };
    let dash = match dashboards::get_by_id_primary(&pd.org_id, &pd.dashboard_id).await {
        Ok(Some((_folder, dash))) => dash,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            log::error!("public dashboard load failed: {e}");
            return server_error();
        }
    };
    let now = now_micros();
    access::record(&pd.id, now);
    let served = materialize::read(
        &ENGINE,
        &FLIGHTS,
        ReadRequest {
            link: &pd,
            settings_rev,
            dashboard: &dash,
            range,
            now,
        },
    )
    .await;
    respond(&pd, served, if_none_match, now)
}

/// Turns a read into its response: 304 on a matching ETag, else the body, counted per slug.
fn respond(pd: &Model, served: Served, if_none_match: Option<&str>, now: i64) -> Response {
    if let Served::Data {
        response, outcome, ..
    } = &served
    {
        let etag = format!("\"{}\"", response.rev);
        if if_none_match.is_some_and(|v| etag_matches(v, &response.rev)) {
            materialize::count_read(&pd.org_id, "not_modified");
            let mut resp = StatusCode::NOT_MODIFIED.into_response();
            set_header(&mut resp, header::ETAG, &etag);
            return resp;
        }
        materialize::count_read(&pd.org_id, outcome);
    }
    if !matches!(served, Served::Gone) && slug_limited(&pd.slug) {
        return too_many_requests(READ_WINDOW);
    }
    match served {
        Served::Data {
            response,
            retry_hint,
            ..
        } => {
            let etag = format!("\"{}\"", response.rev);
            let mut resp = Json(response).into_response();
            set_header(&mut resp, header::ETAG, &etag);
            if let Some(secs) = retry_hint {
                set_header(&mut resp, header::RETRY_AFTER, &secs.to_string());
            }
            resp
        }
        Served::Building(body) => {
            let secs = match &body {
                NotReadyResponse::Building { estimated_secs, .. } => *estimated_secs,
                NotReadyResponse::Cooldown { .. } => 0,
            };
            not_ready(StatusCode::ACCEPTED, body, secs.max(MIN_RETRY_SECS))
        }
        Served::Cooldown(body) => {
            let secs = match &body {
                NotReadyResponse::Cooldown { next_retry_at, .. } => {
                    u64::try_from(next_retry_at - now).map_or(0, |us| us.div_ceil(1_000_000))
                }
                NotReadyResponse::Building { .. } => 0,
            };
            not_ready(StatusCode::SERVICE_UNAVAILABLE, body, secs.max(1))
        }
        Served::Unavailable { retry_after } => {
            let mut resp = unavailable();
            set_header(&mut resp, header::RETRY_AFTER, &retry_after.to_string());
            resp
        }
        Served::Gone => unavailable(),
    }
}

fn not_ready(status: StatusCode, body: NotReadyResponse, retry_after: u64) -> Response {
    let mut resp = (status, Json(body)).into_response();
    set_header(&mut resp, header::RETRY_AFTER, &retry_after.to_string());
    resp
}

fn set_header(resp: &mut Response, name: header::HeaderName, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        resp.headers_mut().insert(name, value);
    }
}

/// `If-None-Match` names this rev, weak or strong, alone or in a list.
fn etag_matches(header_value: &str, rev: &str) -> bool {
    header_value.split(',').any(|tag| {
        let tag = tag.trim();
        let tag = tag.strip_prefix("W/").unwrap_or(tag);
        tag == "*" || tag.trim_matches('"') == rev
    })
}

/// True if this link is over its per-minute budget of responses with a body; 0 rpm disables it.
fn slug_limited(slug: &str) -> bool {
    let rpm = config::get_config().public_dashboards.slug_rpm;
    rpm != 0 && SLUG_READS.over_budget(slug, READ_WINDOW, rpm)
}

/// The range a request without `range` gets: the link's default, as the page opens on.
fn default_range_key(pd: &Model) -> String {
    openobserve_core::public_dashboards::time_ranges(pd)
        .default
        .key()
}

fn offered_range(pd: &Model, range_key: &str) -> Option<TimeRange> {
    core_pd::time_ranges(pd)
        .ranges
        .into_iter()
        .find(|range| range.key() == range_key)
}

/// Visible variables with their frozen values; one missing from the capture shows as null.
fn public_variables(dash: &Dashboard, frozen: Option<&str>) -> Vec<PublicVariable> {
    let frozen = frozen
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    PublicVariable::list(dash, &frozen)
}

/// True if this IP is over its per-minute budget; 0 rpm disables the limiter.
fn rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = config::get_config().public_dashboards.rpm;
    rpm != 0 && READS.over_budget(&client_ip(ip), READ_WINDOW, rpm)
}

/// The slug is a bearer secret, so no response is indexed or leaks it through `Referer`.
fn with_headers(mut resp: Response) -> Response {
    let headers = resp.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    // A CDN or proxy copy would outlive a revoke, pause or expiry and serve stale data.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

fn expired() -> Response {
    (StatusCode::GONE, "expired").into_response()
}

// A failed read is temporary, so the viewer retries instead of treating the link as gone.
fn server_error() -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong.").into_response()
}

fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "This dashboard is currently unavailable.",
    )
        .into_response()
}

/// Project a viewer-safe layout from the dashboard: v8 tabs/panels with query
/// text and stream names stripped. (v8 only in this cut.)
fn project_layout(dash: &Dashboard) -> (String, serde_json::Value) {
    let Some(v8) = dash.v8.as_ref() else {
        return (String::new(), serde_json::Value::Null);
    };
    let mut layout = serde_json::to_value(&v8.tabs).unwrap_or(serde_json::Value::Null);
    strip_secrets(&mut layout);
    (v8.title.clone(), layout)
}

/// Recursively drop keys that would leak SQL/PromQL, filter predicates, or
/// stream internals. Data is pre-materialized, so none of these are needed to
/// render; every one of them can carry author-authored query text or literals.
fn strip_secrets(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            for key in [
                "query",
                "vrlFunctionQuery",
                "vrl_function_query",
                "sql",
                "stream",
                "rawQuery",
                "raw_query",
                "filter",
                "havingConditions",
                "having_conditions",
                "promqlLabels",
                "promql_labels",
                "promqlOperations",
                "promql_operations",
                "customChartContent",
                "custom_chart_content",
                "drilldown",
                "joins",
            ] {
                map.remove(key);
            }
            for val in map.values_mut() {
                strip_secrets(val);
            }
        }
        serde_json::Value::Array(arr) => {
            for val in arr.iter_mut() {
                strip_secrets(val);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_secrets_removes_query_sql_stream_at_every_level() {
        let mut v = serde_json::json!({
            "title": "keep me",
            "query": "select * from top",
            "sql": "select 1",
            "stream": "top_stream",
            "vrlFunctionQuery": "vrl_a",
            "vrl_function_query": "vrl_b",
            "tabs": [{
                "panels": [{
                    "id": "p1",
                    "query": "select * from leak",
                    "queries": [{
                        "stream": "secret_stream",
                        "fields": {
                            "stream": "nested_stream",
                            "x": [{ "alias": "x_axis", "rawQuery": "SELECT secret_col FROM s" }],
                            "filter": { "conditions": [{ "column": "cust_id", "value": "acme-secret-123" }] }
                        }
                    }]
                }]
            }]
        });
        strip_secrets(&mut v);
        let s = serde_json::to_string(&v).unwrap();
        // Every query/sql/stream/filter value must be gone, at all nesting levels.
        assert!(!s.contains("select") && !s.contains("SELECT"), "{s}");
        assert!(!s.contains("secret_col"), "{s}");
        assert!(!s.contains("top_stream"), "{s}");
        assert!(!s.contains("secret_stream"), "{s}");
        assert!(!s.contains("nested_stream"), "{s}");
        assert!(
            !s.contains("cust_id") && !s.contains("acme-secret-123"),
            "{s}"
        );
        assert!(!s.contains("vrl_a") && !s.contains("vrl_b"), "{s}");
        let mut chart = serde_json::json!({ "panels": [{ "customChartContent": "alert(1)" }] });
        strip_secrets(&mut chart);
        assert!(!chart.to_string().contains("alert(1)"));
        // Non-secret render structure is preserved.
        assert!(s.contains("keep me"), "{s}");
        assert!(s.contains("\"id\":\"p1\""), "{s}");
        assert!(s.contains("x_axis"), "{s}");
    }

    #[test]
    fn strip_secrets_removes_drilldowns_and_joins() {
        let mut v = serde_json::json!({
            "config": {
                "show_legends": true,
                "drilldown": [{
                    "type": "logs",
                    "data": { "logsQuery": "SELECT * FROM hidden WHERE tenant='acme'", "dashboard": "d-42" }
                }]
            },
            "queries": [{ "joins": [{ "stream": "orders", "on": "customer_id" }] }]
        });
        strip_secrets(&mut v);
        let s = serde_json::to_string(&v).unwrap();
        assert!(
            !s.contains("drilldown") && !s.contains("acme") && !s.contains("d-42"),
            "{s}"
        );
        assert!(!s.contains("joins") && !s.contains("customer_id"), "{s}");
        assert!(s.contains("show_legends"), "{s}");
    }

    #[test]
    fn public_variables_list_each_scope_instance_with_its_value() {
        let dash = Dashboard {
            v8: Some(
                serde_json::from_value(serde_json::json!({
                    "variables": { "list": [
                        { "type": "custom", "name": "env", "label": "Env" },
                        { "type": "custom", "name": "svc", "scope": "tabs", "tabs": ["t1", "t2"] },
                        { "type": "custom", "name": "pod", "scope": "panels", "panels": ["p1"] },
                        { "type": "custom", "name": "hidden", "hideOnDashboard": true }
                    ] }
                }))
                .unwrap(),
            ),
            ..Default::default()
        };
        let frozen = r#"{"env":"prod","svc.t.t1":"api","pod.p.p1":["a","b"]}"#;
        let got: Vec<_> = public_variables(&dash, Some(frozen))
            .into_iter()
            .map(|v| (v.label, v.value, v.tab_id, v.panel_id))
            .collect();
        let s = |x: &str| Some(x.to_string());
        assert_eq!(
            got,
            vec![
                ("Env".to_string(), serde_json::json!("prod"), None, None),
                ("svc".to_string(), serde_json::json!("api"), s("t1"), None),
                ("svc".to_string(), serde_json::Value::Null, s("t2"), None),
                (
                    "pod".to_string(),
                    serde_json::json!(["a", "b"]),
                    None,
                    s("p1")
                ),
            ]
        );
    }

    #[test]
    fn strip_secrets_is_a_noop_on_scalars() {
        let mut v = serde_json::json!("plain");
        strip_secrets(&mut v);
        assert_eq!(v, serde_json::json!("plain"));
    }

    fn link() -> Model {
        Model {
            id: "l1".into(),
            org_id: "o".into(),
            folder_id: "f".into(),
            dashboard_id: "d".into(),
            slug: "s".into(),
            name: "n".into(),
            visibility: 1,
            time_ranges: None,
            default_range_key: None,
            frozen_variables: None,
            refresh_secs: 300,
            dashboard_version: 1,
            published_by: "p".into(),
            enabled: true,
            expires_at: None,
            created_by: "p".into(),
            updated_by: None,
            created_at: 0,
            updated_at: 0,
            rev: 7,
            deleted_at: None,
            last_accessed_at: None,
            access_count: 0,
        }
    }

    #[test]
    fn only_a_live_public_link_is_served() {
        let now = 1_000_000;
        let live = link;
        let check = |pd, org_enabled, blocked| servable(pd, 3, org_enabled, blocked, now);
        assert!(matches!(check(live(), true, false), Servable::Ok(_, 3)));
        let draft = Model {
            visibility: 0,
            ..live()
        };
        assert!(matches!(check(draft, true, false), Servable::NotFound));
        let revoked = Model {
            deleted_at: Some(1),
            ..live()
        };
        assert!(matches!(check(revoked, true, false), Servable::NotFound));
        // The org switch wins over every other state, so a switched-off org leaks nothing.
        assert!(matches!(check(live(), false, true), Servable::NotFound));
        let paused = Model {
            enabled: false,
            ..live()
        };
        assert!(matches!(check(paused, true, false), Servable::Unavailable));
        assert!(matches!(check(live(), true, true), Servable::Unavailable));
        let expired = Model {
            expires_at: Some(now),
            ..live()
        };
        assert!(matches!(check(expired, true, false), Servable::Expired));
        let not_yet = Model {
            expires_at: Some(now + 1),
            ..live()
        };
        assert!(matches!(check(not_yet, true, false), Servable::Ok(_, _)));
    }

    #[test]
    fn only_an_offered_range_is_served() {
        let pd = Model {
            time_ranges: Some(
                r#"[{"type":"relative","secs":3600},{"type":"absolute","start":10,"end":20}]"#
                    .into(),
            ),
            ..link()
        };
        assert!(offered_range(&pd, "r3600").is_some());
        assert!(offered_range(&pd, "a10-20").is_some());
        assert!(offered_range(&pd, "r86400").is_none());
        assert!(offered_range(&pd, "a10-21").is_none());
        assert!(offered_range(&link(), "r3600").is_none());
    }

    #[test]
    fn a_request_without_a_range_gets_the_default() {
        let ranges = r#"[{"type":"relative","secs":3600},{"type":"relative","secs":86400}]"#;
        let with_default = Model {
            time_ranges: Some(ranges.into()),
            default_range_key: Some("r86400".into()),
            ..link()
        };
        assert_eq!(default_range_key(&with_default), "r86400");
        let without_default = Model {
            time_ranges: Some(ranges.into()),
            default_range_key: None,
            ..link()
        };
        assert_eq!(default_range_key(&without_default), "r3600");
    }

    #[test]
    fn every_public_response_carries_the_privacy_headers() {
        for resp in [
            StatusCode::OK.into_response(),
            StatusCode::NOT_FOUND.into_response(),
            expired(),
            unavailable(),
            too_many_requests(READ_WINDOW),
            server_error(),
        ] {
            let resp = with_headers(resp);
            let h = resp.headers();
            assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
            assert_eq!(h["x-robots-tag"], "noindex, nofollow");
            assert_eq!(h[header::REFERRER_POLICY], "no-referrer");
            assert_eq!(h[header::CACHE_CONTROL], "no-store", "{}", resp.status());
        }
    }

    #[test]
    fn gate12_a_missing_settings_row_means_enabled_and_a_disabled_row_stops_serving() {
        assert_eq!(org_gate(None), (true, 0));
        let row = |enabled| OrgSettings {
            org_id: "o".into(),
            rev: 9,
            enabled,
            max_links: None,
            updated_at: 1,
            updated_by: "a".into(),
        };
        assert_eq!(org_gate(Some(&row(true))), (true, 9));
        let (enabled, rev) = org_gate(Some(&row(false)));
        assert!(matches!(
            servable(link(), rev, enabled, false, 1),
            Servable::NotFound
        ));
    }

    #[test]
    fn if_none_match_accepts_weak_strong_and_listed_tags() {
        assert!(etag_matches("\"abc\"", "abc"));
        assert!(etag_matches("W/\"abc\"", "abc"));
        assert!(etag_matches("\"x\", \"abc\"", "abc"));
        assert!(!etag_matches("\"abd\"", "abc"));
    }

    fn data_response(rev: &str) -> Served {
        Served::Data {
            response: Box::new(config::meta::public_dashboards::DataResponse {
                rev: rev.into(),
                built_at: 1,
                window: config::meta::public_dashboards::Window { start: 0, end: 1 },
                refresh_secs: 300,
                fresh_until: Some(2),
                stale: true,
                stale_reason: None,
                refreshing: true,
                next_retry_at: None,
                last_error_at: None,
                dashboard_updated_at: 1,
                link_rev: 1,
                settings_rev: 0,
                variables: vec![],
                panels: Default::default(),
            }),
            retry_hint: Some(4),
            outcome: "stale",
        }
    }

    #[test]
    fn gate12_the_slug_limit_counts_bodies_and_never_a_304() {
        let pd = Model {
            slug: config::ider::uuid(),
            ..link()
        };
        let rpm = config::get_config().public_dashboards.slug_rpm as usize;
        for _ in 0..rpm + 50 {
            let resp = respond(&pd, data_response("r1"), Some("\"r1\""), 0);
            assert_eq!(resp.status(), StatusCode::NOT_MODIFIED);
            assert_eq!(resp.headers()[header::ETAG], "\"r1\"");
        }
        let resp = respond(&pd, data_response("r2"), Some("\"r1\""), 0);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers()[header::ETAG], "\"r2\"");
        assert_eq!(resp.headers()[header::RETRY_AFTER], "4");
        for _ in 1..rpm {
            assert_eq!(
                respond(&pd, data_response("r2"), None, 0).status(),
                StatusCode::OK
            );
        }
        let resp = respond(&pd, data_response("r2"), None, 0);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn not_ready_responses_carry_retry_after() {
        let pd = Model {
            slug: config::ider::uuid(),
            ..link()
        };
        let building = Served::Building(NotReadyResponse::Building {
            started_at: 1,
            estimated_secs: 1,
            progress: 0.5,
        });
        let resp = respond(&pd, building, None, 0);
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "3");
        let cooldown = Served::Cooldown(NotReadyResponse::Cooldown {
            last_error_at: Some(1),
            next_retry_at: 90_500_000,
        });
        let resp = respond(&pd, cooldown, None, 0);
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "91");
        let resp = respond(&pd, Served::Unavailable { retry_after: 6 }, None, 0);
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "6");
    }
}
