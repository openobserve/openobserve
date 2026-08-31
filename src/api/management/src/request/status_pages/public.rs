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

//! The public serving plane. Registered in `basic_routes` — no auth
//! middleware, no OpenFGA, and per the chart_render contract (its module doc)
//! nothing here may search, hit storage, or make cross-node calls: two
//! indexed point-reads against the meta store, nothing else.
//!
//! Every route answers from the sharded in-process TTL cache and reads the
//! meta store only on a miss; a password page's payload bypasses the cache (R-7).

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use config::axum::middlewares::RealIp;
use infra::{
    db::get_orm_client_ro,
    table::{entity, status_pages as table},
};

/// The visitor UI: one self-contained page that fetches the snapshot JSON.
const PAGE_HTML: &str = include_str!("status_page.html");
/// One DB read per slug per TTL; the load test showed the DB pool serializing at p50 4.7s
/// otherwise.
const CACHE_TTL: Duration = Duration::from_secs(30);
/// Keeps the miss-time write lock off the read path of unrelated slugs.
const CACHE_SHARDS: usize = 16;
/// Hard cap: a unique-slug spray keeps entries fresh, so the TTL alone would not bound memory.
const CACHE_MAX_PER_SHARD: usize = 2048;
const UNLOCK_COOKIE_TTL_SECS: i64 = 24 * 3600;
/// Fixed name: the value already binds the slug, and echoing it would leak the slug on a custom
/// domain.
const UNLOCK_COOKIE_NAME: &str = "o2_sp_unlock";
/// A password JSON body is a few hundred bytes; the by-host route bypasses the router's own limit.
#[cfg(feature = "enterprise")]
const AUTH_BODY_LIMIT: usize = 4096;
const AUTH_MAX_ATTEMPTS: u32 = 5;
const AUTH_WINDOW: Duration = Duration::from_secs(60);
const READ_WINDOW: Duration = Duration::from_secs(60);
/// The limiter key when no `RealIp` was resolved: one bucket still bounds Argon2 CPU per slug
/// (R-5).
const SHARED_IP: &str = "shared";

static CACHE: LazyLock<Vec<Shard>> = LazyLock::new(|| {
    (0..CACHE_SHARDS)
        .map(|_| RwLock::new(Default::default()))
        .collect()
});
/// Per-IP read-route counters.
static READ_RPM: LazyLock<Counters> = LazyLock::new(|| RwLock::new(Default::default()));
/// Password attempts, keyed by "{ip}|{slug}".
static AUTH_ATTEMPTS: LazyLock<Counters> = LazyLock::new(|| RwLock::new(Default::default()));

type Counters = RwLock<HashMap<String, (u32, Instant)>>;
type Shard = RwLock<HashMap<String, CacheEntry>>;

/// What the cache knows about a slug; a password page's payload is never cached (R-7).
#[derive(Clone)]
enum Cached {
    Public(Arc<PublicEntry>),
    /// Public, but the rebuilder hasn't produced its first snapshot yet: shell only.
    Unbuilt,
    Password,
    /// Unknown, draft, or feature off — negative-cached so a slug spray can't turn misses into DB
    /// hits.
    Missing,
}

struct CacheEntry {
    kind: Cached,
    at: Instant,
}

/// The prebuilt snapshot JSON plus the two fields badge/feed need without re-parsing it.
struct PublicEntry {
    body: String,
    noindex: bool,
    name: String,
    current: String,
}

#[derive(serde::Deserialize)]
pub struct AuthBody {
    password: String,
}

impl PublicEntry {
    fn new(page: &entity::status_pages::Model, snap: entity::status_page_snapshots::Model) -> Self {
        let body = format!(
            "{{\"name\":{},\"brand_name\":{},\"accent_color\":{},\"logo_img\":{},\"current\":{},\"history\":{}}}",
            serde_json::to_string(&page.name).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&page.brand_name).unwrap_or_else(|_| "null".into()),
            serde_json::to_string(&page.accent_color).unwrap_or_else(|_| "null".into()),
            serde_json::to_string(&page.logo_img).unwrap_or_else(|_| "null".into()),
            snap.current,
            snap.history
        );
        Self {
            body,
            noindex: page.noindex,
            name: page.name.clone(),
            current: snap.current,
        }
    }
}

/// GET /api/status_pages_public/{slug} — the snapshot JSON, cache-first.
pub async fn snapshot(
    Path(slug): Path<String>,
    ip: Option<Extension<RealIp>>,
    headers: HeaderMap,
) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    match resolve(&slug).await {
        Cached::Public(e) => json_ok(&e.body, e.noindex),
        Cached::Password => serve_password_page(&slug, &headers).await,
        Cached::Unbuilt => building(),
        Cached::Missing => not_found(),
    }
}

/// GET /status/{slug} — the static visitor shell; only the slug's kind is needed, and the cache has
/// it.
pub async fn page(Path(slug): Path<String>, ip: Option<Extension<RealIp>>) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    // A password page's shell is never shared-cached lest a CDN interfere with the per-visitor
    // unlock flow.
    let cache = match resolve(&slug).await {
        Cached::Public(_) | Cached::Unbuilt => "public, max-age=30",
        Cached::Password => "no-store, private",
        Cached::Missing => return not_found(),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, cache)
        .header("X-Frame-Options", "DENY")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        // The page has no external assets or inline handlers, so a strict CSP is free defense-in-depth.
        .header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
             connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; \
             frame-ancestors 'none'",
        )
        .body(Body::from(PAGE_HTML))
        .unwrap_or_else(|_| not_found())
}

/// POST /api/status_pages_public/{slug}/auth — verify a password, set the unlock cookie.
pub async fn auth(
    Path(slug): Path<String>,
    ip: Option<Extension<RealIp>>,
    Json(body): Json<AuthBody>,
) -> Response {
    // R-5: the per-IP+slug limit is checked before any Argon2 work so hashes can't be driven
    // unbounded.
    let ip = client_ip(ip.map(|e| e.0));
    if !attempt_allowed(&ip, &slug) {
        return too_many();
    }
    if !config::get_config().synthetics.enabled {
        return unauthorized();
    }
    let conn = get_orm_client_ro().await;
    // Unknown slug and wrong password are the same 401.
    let Some(page) = table::get_page_by_slug(conn, &slug).await.ok().flatten() else {
        return unauthorized();
    };
    let (Some(hash), true) = (page.password_hash.as_deref(), page.visibility == 2) else {
        return unauthorized();
    };
    match openobserve_core::status_pages::verify_password(hash, &body.password) {
        Ok(true) => {
            let pwv = openobserve_core::status_pages::pw_version(hash);
            let Some(cookie) = openobserve_core::status_pages::issue_unlock_cookie(
                &slug,
                &pwv,
                UNLOCK_COOKIE_TTL_SECS,
            )
            .await
            else {
                return unauthorized();
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CACHE_CONTROL, "no-store, private")
                .header(header::SET_COOKIE, unlock_set_cookie(&cookie))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{\"ok\":true}"))
                .unwrap_or_else(|_| unauthorized())
        }
        // The shell already conceded the page exists, so a plain "wrong password" is safe here.
        _ => unauthorized(),
    }
}

// Badges are scoped to a PUBLISHED page's overall state only — never a raw check/monitor id (Uptime
// Kuma CVE-2026-32230).
/// GET /api/status_pages_public/{slug}/badge.svg — password pages get 404 so no badge leaks their
/// state.
pub async fn badge(Path(slug): Path<String>, ip: Option<Extension<RealIp>>) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    let Cached::Public(e) = resolve(&slug).await else {
        return not_found();
    };
    #[derive(serde::Deserialize)]
    struct Cur {
        overall: String,
    }
    let overall = serde_json::from_str::<Cur>(&e.current)
        .map(|c| c.overall)
        .unwrap_or_else(|_| "unknown".into());
    let (label, color) = match overall.as_str() {
        "operational" => ("operational", "#1a7f4e"),
        "maintenance" => ("maintenance", "#2563b0"),
        "degraded" => ("degraded", "#b87708"),
        "partial_outage" => ("partial outage", "#c03530"),
        "major_outage" => ("major outage", "#c03530"),
        _ => ("no data", "#7c8f99"),
    };
    let label = xml_escape(label);
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"148\" height=\"20\" role=\"img\" \
         aria-label=\"status: {label}\"><rect width=\"46\" height=\"20\" fill=\"#555\"/>\
         <rect x=\"46\" width=\"102\" height=\"20\" fill=\"{color}\"/>\
         <g fill=\"#fff\" font-family=\"Verdana,sans-serif\" font-size=\"11\">\
         <text x=\"6\" y=\"14\">status</text><text x=\"52\" y=\"14\">{label}</text></g></svg>"
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/svg+xml")
        .header(header::CACHE_CONTROL, "public, max-age=60")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(svg))
        .unwrap_or_else(|_| not_found())
}

/// GET /api/status_pages_public/{slug}/feed.xml — Atom feed of a public page's notices; password
/// pages get 404.
pub async fn feed(Path(slug): Path<String>, ip: Option<Extension<RealIp>>) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    let Cached::Public(e) = resolve(&slug).await else {
        return not_found();
    };
    #[derive(serde::Deserialize)]
    struct Notice {
        title: String,
        body: String,
        state: String,
        starts_at: i64,
    }
    #[derive(serde::Deserialize)]
    struct Cur {
        #[serde(default)]
        notices: Vec<Notice>,
    }
    let notices = serde_json::from_str::<Cur>(&e.current)
        .map(|c| c.notices)
        .unwrap_or_default();
    let title = xml_escape(&e.name);
    let mut entries = String::new();
    // textContent's XSS guarantee is a DOM property: server-side XML needs every field escaped
    // here.
    for n in &notices {
        entries.push_str(&format!(
            "<entry><title>{}</title><summary>{}</summary>\
             <updated>{}</updated><category term=\"{}\"/></entry>",
            xml_escape(&n.title),
            xml_escape(&n.body),
            iso8601(n.starts_at / 1_000_000),
            xml_escape(&n.state),
        ));
    }
    let feed = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <feed xmlns=\"http://www.w3.org/2005/Atom\"><title>{title} status</title>{entries}</feed>"
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/atom+xml; charset=utf-8")
        .header(header::CACHE_CONTROL, "public, max-age=60")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(feed))
        .unwrap_or_else(|_| not_found())
}

/// Runs ahead of all normal routing (see `create_app_router`'s top-level
/// `.layer`) because a custom domain and OpenObserve's own UI/API answer at
/// the exact same paths (`/` included) — Host is the only thing that tells
/// them apart, and axum's router can't branch on it. Intercepts ONLY when the
/// incoming Host matches a domain someone has actually claimed (any
/// verification state); every other request — in particular the app's own
/// real hostname, `localhost`, or an IP — falls through to normal routing
/// completely untouched, so this can never regress ordinary traffic. Only a
/// `verification_state = 1` claim resolves to tenant data; a claimed-but-
/// unverified or released domain still gets intercepted (so it never reaches
/// the app's own UI either — see `domain_not_connected`), it just doesn't get
/// served *content*, per the design's ownership-gate rule. Licensed (Custom
/// Domains is an enterprise sub-feature of status pages); the OSS build never
/// looks up a Host, so no unlicensed OSS deployment can be domain-routed to.
#[cfg(feature = "enterprise")]
pub async fn host_route_middleware(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    use o2_enterprise::enterprise::status_pages::host_routing::{
        HostRouteDecision, PageRoute, resolve_host_route,
    };

    if !config::get_config().synthetics.enabled {
        return next.run(request).await;
    }
    let Some(host) = host_header(request.headers()) else {
        return next.run(request).await;
    };
    let method = request.method().as_str().to_owned();
    match resolve_host_route(&host, &method, request.uri().path()).await {
        HostRouteDecision::Fallthrough => next.run(request).await,
        HostRouteDecision::NotConnected => domain_not_connected(),
        HostRouteDecision::Page { slug, route } => {
            // The RealIp layer sits outside this one, so the resolved visitor IP is already on the
            // request.
            let ip = request.extensions().get::<RealIp>().copied().map(Extension);
            match route {
                PageRoute::Snapshot => {
                    snapshot(Path(slug), ip, request.into_parts().0.headers).await
                }
                PageRoute::Auth => match auth_body(request).await {
                    Some(body) => auth(Path(slug), ip, Json(body)).await,
                    None => unauthorized(),
                },
                PageRoute::Shell => page(Path(slug), ip).await,
            }
        }
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn host_route_middleware(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    next.run(request).await
}

fn shard_for(slug: &str) -> &'static Shard {
    let mut h: usize = 0;
    for b in slug.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as usize);
    }
    &CACHE[h % CACHE_SHARDS]
}

/// A fresh entry's kind, or None on a miss/expiry; a hit is a read lock and an Arc clone, no await.
fn cache_get(slug: &str) -> Option<Cached> {
    let guard = shard_for(slug).read().ok()?;
    let e = guard.get(slug)?;
    (e.at.elapsed() < CACHE_TTL).then(|| e.kind.clone())
}

fn cache_put(slug: &str, kind: Cached) {
    let Ok(mut guard) = shard_for(slug).write() else {
        return;
    };
    if guard.len() >= CACHE_MAX_PER_SHARD {
        make_room(&mut guard);
    }
    guard.insert(
        slug.to_owned(),
        CacheEntry {
            kind,
            at: Instant::now(),
        },
    );
}

/// Drops expired entries, then the oldest, so memory stays hard-bounded regardless of TTL.
fn make_room(shard: &mut HashMap<String, CacheEntry>) {
    shard.retain(|_, e| e.at.elapsed() < CACHE_TTL);
    while shard.len() >= CACHE_MAX_PER_SHARD {
        let Some(oldest) = shard
            .iter()
            .min_by_key(|(_, e)| e.at)
            .map(|(k, _)| k.clone())
        else {
            break;
        };
        shard.remove(&oldest);
    }
}

/// The cache's answer for a slug, doing the miss-time DB reads at most once per TTL.
async fn resolve(slug: &str) -> Cached {
    if let Some(kind) = cache_get(slug) {
        return kind;
    }
    let kind = load(slug).await;
    cache_put(slug, kind.clone());
    kind
}

/// The two point-reads behind a miss: the page by slug, then its snapshot for a public page.
async fn load(slug: &str) -> Cached {
    if !config::get_config().synthetics.enabled {
        return Cached::Missing;
    }
    let conn = get_orm_client_ro().await;
    let Some(page) = table::get_page_by_slug(conn, slug).await.ok().flatten() else {
        return Cached::Missing;
    };
    match page.visibility {
        2 => Cached::Password,
        1 => match table::get_snapshot(conn, &page.id).await.ok().flatten() {
            Some(snap) => Cached::Public(Arc::new(PublicEntry::new(&page, snap))),
            None => Cached::Unbuilt,
        },
        _ => Cached::Missing,
    }
}

/// R-7: the unlock check and both reads happen per request, off the cache, and the response is
/// `no-store`.
async fn serve_password_page(slug: &str, headers: &HeaderMap) -> Response {
    // Locked visitors get the uniform 404 from the cache alone: a protected page's existence is not
    // an oracle.
    let Some(cookie) = unlock_cookie(headers) else {
        return not_found();
    };
    let conn = get_orm_client_ro().await;
    let Some(page) = table::get_page_by_slug(conn, slug).await.ok().flatten() else {
        return not_found();
    };
    let (Some(hash), true) = (page.password_hash.as_deref(), page.visibility == 2) else {
        return not_found();
    };
    let pwv = openobserve_core::status_pages::pw_version(hash);
    if !openobserve_core::status_pages::verify_unlock_cookie(cookie, slug, &pwv).await {
        return not_found();
    }
    let Some(snap) = table::get_snapshot(conn, &page.id).await.ok().flatten() else {
        return not_found();
    };
    let body = format!(
        "{{\"name\":{},\"current\":{},\"history\":{}}}",
        serde_json::to_string(&page.name).unwrap_or_else(|_| "\"\"".into()),
        snap.current,
        snap.history
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store, private")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Robots-Tag", "noindex")
        .body(Body::from(body))
        .unwrap_or_else(|_| not_found())
}

/// No `Domain=` attribute, deliberately: a host-only cookie is scoped to whichever host issued it,
/// so the same code works on the app host and on a custom domain, and neither can set the other's.
fn unlock_set_cookie(cookie: &str) -> String {
    format!(
        "{UNLOCK_COOKIE_NAME}={cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={UNLOCK_COOKIE_TTL_SECS}"
    )
}

fn unlock_cookie(headers: &HeaderMap) -> Option<&str> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{UNLOCK_COOKIE_NAME}=");
    cookies
        .split(';')
        .find_map(|c| c.trim().strip_prefix(prefix.as_str()))
}

fn json_ok(body: &str, noindex: bool) -> Response {
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "public, max-age=30")
        .header("X-Content-Type-Options", "nosniff");
    // The platform-wide `access-control-allow-credentials: true` from `cors_layer()` is inert: ACAO
    // only goes to allowlisted origins.
    if noindex {
        resp = resp.header("X-Robots-Tag", "noindex");
    }
    resp.body(Body::from(body.to_owned()))
        .unwrap_or_else(|_| not_found())
}

/// The limiter key: the ingress-resolved `RealIp`, or one shared bucket when that layer isn't
/// installed.
fn client_ip(ip: Option<RealIp>) -> String {
    ip.map_or_else(|| SHARED_IP.to_owned(), |ip| ip.0.to_string())
}

/// True if this IP is over its per-minute read budget; 0 rpm disables the limiter.
fn read_rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = config::get_config().synthetics.status_page_public_rpm;
    rpm != 0 && over_budget(&READ_RPM, client_ip(ip), READ_WINDOW, rpm)
}

fn attempt_allowed(ip: &str, slug: &str) -> bool {
    !over_budget(
        &AUTH_ATTEMPTS,
        format!("{ip}|{slug}"),
        AUTH_WINDOW,
        AUTH_MAX_ATTEMPTS,
    )
}

/// Counts one hit for `key` and reports whether the window's budget is exceeded; fails open on a
/// poisoned lock.
fn over_budget(counters: &Counters, key: String, window: Duration, max: u32) -> bool {
    let Ok(mut guard) = counters.write() else {
        return false;
    };
    let now = Instant::now();
    // Opportunistic cleanup keeps the map bounded.
    if guard.len() > 8192 {
        guard.retain(|_, (_, at)| now.duration_since(*at) < window);
    }
    let e = guard.entry(key).or_insert((0, now));
    if now.duration_since(e.1) >= window {
        *e = (0, now);
    }
    e.0 = e.0.saturating_add(1);
    e.0 > max
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Epoch seconds → a minimal UTC ISO-8601 string (Hinnant's civil-from-days; no chrono dependency
/// here).
fn iso8601(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn unauthorized() -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("Wrong password."))
        .unwrap_or_default()
}

fn too_many() -> Response {
    Response::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::RETRY_AFTER, "60")
        .body(Body::from("Too many attempts. Try again in a minute."))
        .unwrap_or_default()
}

/// A published page whose first rebuilder tick hasn't run yet; distinct from 404 so the shell
/// doesn't show the unlock form.
fn building() -> Response {
    Response::builder()
        .status(StatusCode::ACCEPTED)
        .header(header::CONTENT_TYPE, "application/json")
        // A 202 is transient; a shared cache must never pin it for the 30 s the 200 gets.
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from("{\"building\":true}"))
        .unwrap_or_else(|_| not_found())
}

/// One uniform 404 for unknown/draft/locked/disabled — existence is not distinguishable from the
/// outside.
fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(
            "This page doesn't exist or is no longer available.",
        ))
        .unwrap_or_default()
}

/// Reads the by-host unlock body under an explicit cap: this layer answers before the router's
/// `DefaultBodyLimit`, so without one it would be the only unbounded read on the public plane.
#[cfg(feature = "enterprise")]
async fn auth_body(request: axum::extract::Request) -> Option<AuthBody> {
    let bytes = axum::body::to_bytes(request.into_body(), AUTH_BODY_LIMIT)
        .await
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(feature = "enterprise")]
fn host_header(headers: &HeaderMap) -> Option<String> {
    let host = headers.get(header::HOST)?.to_str().ok()?;
    Some(host.split(':').next().unwrap_or(host).to_ascii_lowercase())
}

/// A domain that hasn't cleared ownership verification (or was released)
/// must never render tenant data, verified or not — this is the deliberately
/// content-free response for that case, distinct from [`not_found`] because
/// the domain-routing layer, unlike the slug layer, sits in front of hosts an
/// admin is actively trying to connect and deserves a clearer signal than a
/// generic 404 that a page simply doesn't exist.
#[cfg(feature = "enterprise")]
fn domain_not_connected() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(
            "This domain isn't connected to a status page yet.",
        ))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_control(resp: &Response) -> Option<&str> {
        resp.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
    }

    fn prime(slug: &str, kind: Cached, at: Instant) {
        shard_for(slug)
            .write()
            .unwrap()
            .insert(slug.to_owned(), CacheEntry { kind, at });
    }

    fn public_entry(body: &str) -> Cached {
        Cached::Public(Arc::new(PublicEntry {
            body: body.to_owned(),
            noindex: true,
            name: "Acme".to_owned(),
            current: "{\"overall\":\"degraded\",\"notices\":[]}".to_owned(),
        }))
    }

    async fn body_text(resp: Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    // Synthetics is off in tests, so every DB-backed path answers "unknown": a 200 can only come
    // from the cache.
    #[tokio::test]
    async fn page_shell_is_served_from_the_shard_cache() {
        prime("t-page-public", public_entry("{}"), Instant::now());
        let resp = page(Path("t-page-public".into()), None).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(cache_control(&resp), Some("public, max-age=30"));
    }

    #[tokio::test]
    async fn password_page_shell_is_private_and_needs_no_db_read() {
        prime("t-page-pw", Cached::Password, Instant::now());
        let resp = page(Path("t-page-pw".into()), None).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(cache_control(&resp), Some("no-store, private"));
    }

    // A 202 (not the uniform 404) keeps the shell from mistaking a fresh public page for a locked
    // one.
    #[tokio::test]
    async fn unbuilt_public_page_gets_the_shell_and_a_building_202() {
        prime("t-unbuilt", Cached::Unbuilt, Instant::now());
        let shell = page(Path("t-unbuilt".into()), None).await;
        assert_eq!(shell.status(), StatusCode::OK);
        let snap = snapshot(Path("t-unbuilt".into()), None, HeaderMap::new()).await;
        assert_eq!(snap.status(), StatusCode::ACCEPTED);
        assert_eq!(cache_control(&snap), Some("no-store"));
        assert_eq!(
            snap.headers()
                .get(header::CONTENT_TYPE)
                .map(|v| v.as_bytes()),
            Some(b"application/json".as_slice())
        );
        assert_eq!(
            snap.headers()
                .get("X-Content-Type-Options")
                .map(|v| v.as_bytes()),
            Some(b"nosniff".as_slice())
        );
        assert_eq!(body_text(snap).await, "{\"building\":true}");
    }

    #[tokio::test]
    async fn snapshot_is_served_from_the_shard_cache() {
        prime(
            "t-snap",
            public_entry("{\"name\":\"Acme\"}"),
            Instant::now(),
        );
        let resp = snapshot(Path("t-snap".into()), None, HeaderMap::new()).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(cache_control(&resp), Some("public, max-age=30"));
        assert_eq!(
            resp.headers().get("X-Robots-Tag").map(|v| v.as_bytes()),
            Some(b"noindex".as_slice())
        );
        assert_eq!(body_text(resp).await, "{\"name\":\"Acme\"}");
    }

    #[tokio::test]
    async fn locked_password_page_is_the_same_404_as_an_unknown_slug() {
        prime("t-snap-pw", Cached::Password, Instant::now());
        prime("t-nope", Cached::Missing, Instant::now());
        let locked = snapshot(Path("t-snap-pw".into()), None, HeaderMap::new()).await;
        let unknown = snapshot(Path("t-nope".into()), None, HeaderMap::new()).await;
        assert_eq!(locked.status(), StatusCode::NOT_FOUND);
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(locked.headers(), unknown.headers());
        assert_eq!(body_text(locked).await, body_text(unknown).await);
    }

    #[tokio::test]
    async fn badge_and_feed_are_served_from_the_shard_cache() {
        prime("t-badge", public_entry("{}"), Instant::now());
        let badge = badge(Path("t-badge".into()), None).await;
        assert_eq!(badge.status(), StatusCode::OK);
        assert!(body_text(badge).await.contains(">degraded<"));
        let feed = feed(Path("t-badge".into()), None).await;
        assert_eq!(feed.status(), StatusCode::OK);
        assert!(body_text(feed).await.contains("<title>Acme status</title>"));
    }

    #[tokio::test]
    async fn expired_entries_are_reloaded_and_misses_are_negative_cached() {
        let slug = "t-expired";
        let stale = Instant::now() - CACHE_TTL - Duration::from_secs(1);
        prime(slug, public_entry("{}"), stale);
        assert!(cache_get(slug).is_none());
        let resp = snapshot(Path(slug.into()), None, HeaderMap::new()).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert!(matches!(cache_get(slug), Some(Cached::Missing)));
    }

    #[test]
    fn a_full_shard_makes_room_before_inserting() {
        let mut shard = HashMap::new();
        for i in 0..CACHE_MAX_PER_SHARD {
            shard.insert(
                format!("s{i}"),
                CacheEntry {
                    kind: Cached::Missing,
                    at: Instant::now(),
                },
            );
        }
        make_room(&mut shard);
        assert!(shard.len() < CACHE_MAX_PER_SHARD);
    }

    #[test]
    fn limiter_key_comes_from_real_ip() {
        let ip = RealIp("203.0.113.7".parse().unwrap());
        assert_eq!(client_ip(Some(ip)), "203.0.113.7");
        assert_eq!(client_ip(None), SHARED_IP);
    }

    #[test]
    fn over_budget_allows_exactly_max_hits_per_window() {
        let counters: Counters = RwLock::new(HashMap::new());
        for _ in 0..3 {
            assert!(!over_budget(&counters, "k".into(), AUTH_WINDOW, 3));
        }
        assert!(over_budget(&counters, "k".into(), AUTH_WINDOW, 3));
        assert!(!over_budget(&counters, "other".into(), AUTH_WINDOW, 3));
    }

    // A custom domain gets the same Set-Cookie as the slug host, so it must carry no Domain= or the
    // cookie would be scoped to a host the visitor isn't on.
    #[test]
    fn the_unlock_cookie_is_host_only_and_path_wide() {
        let set = unlock_set_cookie("tok");
        assert!(set.starts_with("o2_sp_unlock=tok; "));
        assert!(set.contains("; Path=/;"));
        assert!(!set.to_ascii_lowercase().contains("domain="));
        assert!(set.contains("HttpOnly"));
        assert!(set.contains("Secure"));
        assert!(set.contains("SameSite=Lax"));
    }

    #[test]
    fn unlock_cookie_is_found_among_other_cookies() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "a=1; o2_sp_unlock=tok; b=2".parse().unwrap(),
        );
        assert_eq!(unlock_cookie(&headers), Some("tok"));
        assert_eq!(unlock_cookie(&HeaderMap::new()), None);
    }
}
