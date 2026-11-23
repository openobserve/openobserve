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
//! nothing here may search, hit storage, or make cross-node calls: indexed
//! point-reads against the meta store, nothing else.
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
use tokio::sync::{Semaphore, SemaphorePermit};

use crate::request::public_rate_limit::{ShardedCounters, ip_key};

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
/// Per page across all addresses, so many addresses cannot multiply the per-address limit.
const AUTH_PAGE_MAX_ATTEMPTS: u32 = 50;
/// Concurrent Argon2 checks per node; each takes a blocking thread and about 19 MiB.
const AUTH_VERIFY_SLOTS: usize = 4;
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
/// Per-address read-route counters.
static READ_RPM: LazyLock<ShardedCounters> = LazyLock::new(Default::default);
/// Password attempts, keyed by "{ip}|{slug}".
static AUTH_ATTEMPTS: LazyLock<ShardedCounters> = LazyLock::new(Default::default);
/// Password attempts per page, keyed by the slug alone.
static AUTH_PAGE_ATTEMPTS: LazyLock<ShardedCounters> = LazyLock::new(Default::default);
static VERIFY_SLOTS: Semaphore = Semaphore::const_new(AUTH_VERIFY_SLOTS);

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
    /// The page or its org's status could not be read; never cached, so the next request retries.
    Unavailable,
}

struct CacheEntry {
    kind: Cached,
    /// The owning org, re-checked on every hit; `None` only for slugs that resolved to no page.
    org_id: Option<String>,
    at: Instant,
}

/// The prebuilt snapshot JSON plus the two fields badge/feed need without re-parsing it.
struct PublicEntry {
    body: String,
    noindex: bool,
    name: String,
    current: String,
}

// Only documents the JSON snapshot_body assembles from the page and both snapshot halves.
#[derive(utoipa::ToSchema)]
#[allow(dead_code)]
struct PublicStatusPageSnapshot {
    name: String,
    brand_name: Option<String>,
    accent_color: Option<String>,
    logo_img: Option<String>,
    favicon_img: Option<String>,
    current: config::meta::status_pages::SnapshotCurrent,
    history: config::meta::status_pages::SnapshotHistory,
}

#[derive(serde::Deserialize)]
pub struct AuthBody {
    password: String,
}

impl PublicEntry {
    fn new(
        page: &entity::status_pages::Model,
        logo: Option<String>,
        snap: entity::status_page_snapshots::Model,
    ) -> Self {
        let body = snapshot_body(page, logo, &snap.current, &snap.history);
        Self {
            body,
            noindex: page.noindex,
            name: page.name.clone(),
            current: snap.current,
        }
    }
}

/// GET /api/status_pages_public/{slug} — the snapshot JSON, cache-first.
#[utoipa::path(
    get,
    path = "/status_pages_public/{slug}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "GetPublicStatusPageSnapshot",
    summary = "Get the public snapshot of a status page",
    security(),
    params(
        ("slug" = String, Path, description = "Public slug"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PublicStatusPageSnapshot),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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
        Cached::Unavailable => unavailable(),
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
        Cached::Unavailable => return unavailable(),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, cache)
        .header("X-Frame-Options", "DENY")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        // No external assets or inline handlers, so a strict CSP is free defense-in-depth.
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
    // R-5: the address's budget is spent before any lookup, the page's before any Argon2 work.
    let ip = client_ip(ip.map(|e| e.0));
    if !address_allowed(&ip, &slug) {
        return too_many();
    }
    if !config::get_config().synthetics.enabled {
        return unauthorized();
    }
    let conn = get_orm_client_ro().await;
    // Unknown slug and wrong password are the same 401.
    let page = match active_page_by_slug(conn, &slug).await {
        Ok(Some(page)) => page,
        Ok(None) => return unauthorized(),
        Err(()) => return unavailable(),
    };
    let (Some(hash), 2) = (page.password_hash, page.visibility) else {
        return unauthorized();
    };
    unlock_response(&VERIFY_SLOTS, &slug, hash, body.password).await
}

// Badges are scoped to a PUBLISHED page's overall state only — never a raw check/monitor id (Uptime
// Kuma CVE-2026-32230).
/// GET /api/status_pages_public/{slug}/badge.svg — password pages get 404 so no badge leaks their
/// state.
#[utoipa::path(
    get,
    path = "/status_pages_public/{slug}/badge.svg",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "GetPublicStatusPageBadge",
    summary = "Get the status badge of a page",
    security(),
    params(
        ("slug" = String, Path, description = "Public slug"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "image/svg+xml", body = String),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn badge(Path(slug): Path<String>, ip: Option<Extension<RealIp>>) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    let e = match resolve(&slug).await {
        Cached::Public(e) => e,
        Cached::Unavailable => return unavailable(),
        _ => return not_found(),
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
#[utoipa::path(
    get,
    path = "/status_pages_public/{slug}/feed.xml",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "GetPublicStatusPageFeed",
    summary = "Get the notice feed of a page",
    security(),
    params(
        ("slug" = String, Path, description = "Public slug"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/atom+xml", body = String),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn feed(Path(slug): Path<String>, ip: Option<Extension<RealIp>>) -> Response {
    if read_rate_limited(ip.map(|e| e.0)) {
        return too_many();
    }
    let e = match resolve(&slug).await {
        Cached::Public(e) => e,
        Cached::Unavailable => return unavailable(),
        _ => return not_found(),
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
    use axum::response::IntoResponse;
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::status_pages::host_routing::{
        HostRouteDecision, PageRoute, resolve_host_route,
    };

    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return next.run(request).await;
    }
    let Some(host) = host_header(request.headers()) else {
        return next.run(request).await;
    };
    // Keeps the app's own traffic off the meta store; read per request so a config reload applies.
    if own_host_of(&cfg.common.web_url).as_deref() == Some(host.as_str()) {
        return next.run(request).await;
    }
    let method = request.method().as_str().to_owned();
    match resolve_host_route(&host, &method, request.uri().path()).await {
        HostRouteDecision::Fallthrough => next.run(request).await,
        HostRouteDecision::NotConnected => domain_not_connected(),
        HostRouteDecision::Page { .. }
            if !o2_enterprise::enterprise::license::check_features(&[Feature::Synthetics]) =>
        {
            let err = infra::errors::ErrorCodes::LicenseFeatureNotEntitled(
                <&str>::from(Feature::Synthetics).to_owned(),
            );
            (
                StatusCode::FORBIDDEN,
                Json(common::meta::http::HttpResponse::error_code(err)),
            )
                .into_response()
        }
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

/// A fresh entry's kind and org, or None on a miss/expiry; a hit is a read lock and an Arc clone.
fn cache_get(slug: &str) -> Option<(Cached, Option<String>)> {
    let guard = shard_for(slug).read().ok()?;
    let e = guard.get(slug)?;
    (e.at.elapsed() < CACHE_TTL).then(|| (e.kind.clone(), e.org_id.clone()))
}

fn cache_put(slug: &str, kind: Cached, org_id: Option<String>) {
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
            org_id,
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
    resolve_with(
        slug,
        |slug| async move { load(&slug).await },
        |org_id| async move { db::org_status::read_active(&org_id).await },
    )
    .await
}

/// `resolve` over injectable reads; a failed read answers `Unavailable` and caches nothing.
async fn resolve_with<L, LF, A, AF, E>(slug: &str, load: L, read_active: A) -> Cached
where
    L: FnOnce(String) -> LF,
    LF: Future<Output = Result<(Cached, Option<String>), ()>>,
    A: FnOnce(String) -> AF,
    AF: Future<Output = Result<bool, E>>,
    E: std::fmt::Display,
{
    if let Some((kind, org_id)) = cache_get(slug) {
        let Some(org_id) = org_id else {
            return kind;
        };
        // A page cached before its org was blocked or deleted must stop being served at once.
        return match read_active(org_id.clone()).await {
            Ok(true) => kind,
            Ok(false) => Cached::Missing,
            Err(e) => {
                log::error!("[status_pages] cannot read the status of org {org_id}: {e}");
                Cached::Unavailable
            }
        };
    }
    let Ok((kind, org_id)) = load(slug.to_string()).await else {
        return Cached::Unavailable;
    };
    cache_put(slug, kind.clone(), org_id);
    kind
}

/// The two point-reads behind a miss: the page by slug, then its snapshot for a public page.
async fn load(slug: &str) -> Result<(Cached, Option<String>), ()> {
    if !config::get_config().synthetics.enabled {
        return Ok((Cached::Missing, None));
    }
    let conn = get_orm_client_ro().await;
    let Some(page) = active_page_by_slug(conn, slug).await? else {
        return Ok((Cached::Missing, None));
    };
    let kind = match page.visibility {
        2 => Cached::Password,
        1 => public_kind(&page, table::get_snapshot(conn, &page.id).await).await?,
        _ => Cached::Missing,
    };
    Ok((kind, Some(page.org_id)))
}

/// A public page's kind; a failed snapshot read is `Err`, so it is never cached as `Unbuilt`.
async fn public_kind(
    page: &entity::status_pages::Model,
    snap: Result<Option<entity::status_page_snapshots::Model>, impl std::fmt::Display>,
) -> Result<Cached, ()> {
    match snap {
        Ok(Some(snap)) => {
            let logo = page_logo(page).await;
            Ok(Cached::Public(Arc::new(PublicEntry::new(page, logo, snap))))
        }
        Ok(None) => Ok(Cached::Unbuilt),
        Err(e) => {
            log::error!(
                "[status_pages] cannot read the snapshot of page {}: {e}",
                page.id
            );
            Err(())
        }
    }
}

/// The page when it exists and its org is active; `Err` when either read failed, already logged.
async fn active_page_by_slug(
    conn: &sea_orm::DatabaseConnection,
    slug: &str,
) -> Result<Option<entity::status_pages::Model>, ()> {
    let page = match table::get_page_by_slug(conn, slug).await {
        Ok(Some(page)) => page,
        Ok(None) => return Ok(None),
        Err(e) => {
            log::error!("[status_pages] cannot read page {slug}: {e}");
            return Err(());
        }
    };
    match db::org_status::read_active(&page.org_id).await {
        Ok(active) => Ok(active.then_some(page)),
        Err(e) => {
            log::error!(
                "[status_pages] cannot read the status of org {}: {e}",
                page.org_id
            );
            Err(())
        }
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
    let page = match active_page_by_slug(conn, slug).await {
        Ok(Some(page)) => page,
        Ok(None) => return not_found(),
        Err(()) => return unavailable(),
    };
    let (Some(hash), true) = (page.password_hash.as_deref(), page.visibility == 2) else {
        return not_found();
    };
    let pwv = openobserve_core::status_pages::pw_version(hash);
    if !openobserve_core::status_pages::verify_unlock_cookie(cookie, slug, &pwv).await {
        return not_found();
    }
    password_page_response(&page, table::get_snapshot(conn, &page.id).await).await
}

/// An unlocked password page's answer; a failed snapshot read is a 503, never the uniform 404.
async fn password_page_response(
    page: &entity::status_pages::Model,
    snap: Result<Option<entity::status_page_snapshots::Model>, impl std::fmt::Display>,
) -> Response {
    let snap = match snap {
        Ok(Some(snap)) => snap,
        Ok(None) => return not_found(),
        Err(e) => {
            log::error!(
                "[status_pages] cannot read the snapshot of page {}: {e}",
                page.id
            );
            return unavailable();
        }
    };
    let body = snapshot_body(page, page_logo(page).await, &snap.current, &snap.history);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store, private")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Robots-Tag", "noindex")
        .body(Body::from(body))
        .unwrap_or_else(|_| not_found())
}

/// The visitor JSON; an unlocked password page carries the same branding as a public one.
fn snapshot_body(
    page: &entity::status_pages::Model,
    logo: Option<String>,
    current: &str,
    history: &str,
) -> String {
    let json = |v: &Option<String>| serde_json::to_string(v).unwrap_or_else(|_| "null".into());
    format!(
        "{{\"name\":{},\"brand_name\":{},\"accent_color\":{},\"logo_img\":{},\"favicon_img\":{},\"current\":{},\"history\":{}}}",
        serde_json::to_string(&page.name).unwrap_or_else(|_| "\"\"".into()),
        json(&page.brand_name),
        json(&page.accent_color),
        json(&logo),
        json(&page.favicon_img),
        current,
        history
    )
}

/// A page with no logo of its own shows the org logo, which is what its editor previews.
async fn page_logo(page: &entity::status_pages::Model) -> Option<String> {
    if page.logo_img.is_some() {
        return page.logo_img.clone();
    }
    org_logo().await
}

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
async fn org_logo() -> Option<String> {
    o2_enterprise::enterprise::common::settings::get_logo()
        .await
        .filter(|s| !s.is_empty())
}

#[cfg(not(all(feature = "enterprise", not(feature = "cloud"))))]
async fn org_logo() -> Option<String> {
    None
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

/// The limiter key: the ingress-resolved `RealIp` by /64 for IPv6, or one shared bucket when that
/// layer isn't installed.
fn client_ip(ip: Option<RealIp>) -> String {
    ip.map_or_else(|| SHARED_IP.to_owned(), |ip| ip_key(ip.0))
}

/// True if this IP is over its per-minute read budget; 0 rpm disables the limiter.
fn read_rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = config::get_config().synthetics.status_page_public_rpm;
    rpm != 0 && READ_RPM.over_budget(&client_ip(ip), READ_WINDOW, rpm)
}

/// Spends one attempt of this address's budget for the page.
fn address_allowed(ip: &str, slug: &str) -> bool {
    !AUTH_ATTEMPTS.over_budget(&format!("{ip}|{slug}"), AUTH_WINDOW, AUTH_MAX_ATTEMPTS)
}

/// Spends one attempt of the page's budget across all addresses; only a confirmed password page
/// is charged, so a slug spray cannot fill its table.
fn page_allowed(slug: &str) -> bool {
    !AUTH_PAGE_ATTEMPTS.over_budget(slug, AUTH_WINDOW, AUTH_PAGE_MAX_ATTEMPTS)
}

/// The unlock cookie for a right password. The page budget and then the slot are spent only now,
/// with a password page confirmed; a wrong password or an unsignable cookie is the same 401.
async fn unlock_response(
    slots: &'static Semaphore,
    slug: &str,
    hash: String,
    password: String,
) -> Response {
    if !page_allowed(slug) {
        return too_many();
    }
    let Ok(slot) = slots.try_acquire() else {
        return busy();
    };
    let Some(pwv) = verify_blocking(slot, hash, password).await else {
        // The shell already conceded the page exists, so a plain "wrong password" is safe here.
        return unauthorized();
    };
    let Some(cookie) =
        openobserve_core::status_pages::issue_unlock_cookie(slug, &pwv, UNLOCK_COOKIE_TTL_SECS)
            .await
    else {
        return unauthorized();
    };
    unlocked_response(&cookie)
}

fn unlocked_response(cookie: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CACHE_CONTROL, "no-store, private")
        .header(header::SET_COOKIE, unlock_set_cookie(cookie))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{\"ok\":true}"))
        .unwrap_or_else(|_| unauthorized())
}

/// Argon2 on the blocking pool; the cookie version of a right password. The slot moves into the
/// task, so it frees when the hash is done, not when the request is dropped.
async fn verify_blocking(
    slot: SemaphorePermit<'static>,
    hash: String,
    password: String,
) -> Option<String> {
    let checked = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let verified = openobserve_core::status_pages::verify_password(&hash, &password);
        matches!(verified, Ok(true)).then(|| openobserve_core::status_pages::pw_version(&hash))
    })
    .await;
    checked.unwrap_or_else(|e| {
        log::error!("[status_pages] the password check task failed: {e}");
        None
    })
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

/// Every verify slot is taken; a hash ends within a second, so the retry is short.
fn busy() -> Response {
    Response::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::RETRY_AFTER, "1")
        .body(Body::from("Too many attempts. Try again in a moment."))
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

/// A transient 503 for a failed read; never shared-cached, so the next visit reads again.
fn unavailable() -> Response {
    Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::RETRY_AFTER, "30")
        .body(Body::from("This page is temporarily unavailable."))
        .unwrap_or_default()
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
    Some(normalize_host(host))
}

#[cfg(feature = "enterprise")]
fn normalize_host(host: &str) -> String {
    host.split(':').next().unwrap_or(host).to_ascii_lowercase()
}

#[cfg(feature = "enterprise")]
fn own_host_of(web_url: &str) -> Option<String> {
    let url = url::Url::parse(web_url).ok()?;
    url.host_str().map(normalize_host)
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

    // The PHC hash of "open sesame" at argon2's default cost.
    const SESAME_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$L9rKncp0tg7B1aX0NS8EXg$TmmEKmF0oLtQ2rKnVMk5qDM1zyPSsf/SkWVA/Zj6kvI";

    // A directory this test created itself (`create_dir` fails on an existing path), removed on
    // drop, also when an assertion fails.
    struct OwnDir(std::path::PathBuf);

    impl OwnDir {
        fn create(tag: &str) -> Self {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
            let path = std::env::temp_dir().join(format!(
                "{tag}-{}-{}",
                std::process::id(),
                now.unwrap().as_nanos()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for OwnDir {
        fn drop(&mut self) {
            if let Err(e) = std::fs::remove_dir_all(&self.0) {
                eprintln!("cannot remove {}: {e}", self.0.display());
            }
        }
    }

    fn cache_control(resp: &Response) -> Option<&str> {
        resp.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
    }

    fn prime(slug: &str, kind: Cached, at: Instant) {
        shard_for(slug).write().unwrap().insert(
            slug.to_owned(),
            CacheEntry {
                kind,
                org_id: None,
                at,
            },
        );
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

    // A reload reads the meta store, so its tables must exist or the read fails as a 503.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
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
    async fn an_unreadable_org_status_is_unavailable_and_keeps_the_cached_page() {
        cache_put("t-unreadable-org", public_entry("{}"), Some("t-org".into()));
        let kind = resolve_with(
            "t-unreadable-org",
            |_| async { Ok((Cached::Missing, None)) },
            |_| async { Err::<bool, _>("db down") },
        )
        .await;
        assert!(matches!(kind, Cached::Unavailable));
        assert!(matches!(
            cache_get("t-unreadable-org"),
            Some((Cached::Public(_), Some(_)))
        ));
    }

    #[tokio::test]
    async fn a_failed_read_on_a_miss_caches_nothing() {
        let kind = resolve_with(
            "t-failed-miss",
            |_| async { Err(()) },
            |_| async { Ok::<_, String>(true) },
        )
        .await;
        assert!(matches!(kind, Cached::Unavailable));
        assert!(
            cache_get("t-failed-miss").is_none(),
            "a failed read was cached"
        );
    }

    fn page_model(id: &str) -> entity::status_pages::Model {
        entity::status_pages::Model {
            id: id.to_owned(),
            org_id: "t-snap-org".to_owned(),
            name: "Acme".to_owned(),
            slug: id.to_owned(),
            description: None,
            visibility: 1,
            password_hash: None,
            noindex: false,
            show_uptime_percent: true,
            show_timeline_bars: true,
            show_response_time: true,
            confirm_failures: 1,
            confirm_recovery: 1,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            favicon_img: None,
            tracking_since: None,
            owner: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[tokio::test]
    async fn a_failed_snapshot_read_is_unavailable_and_caches_nothing() {
        let slug = "t-failed-snapshot";
        let page = page_model(slug);
        let kind = resolve_with(
            slug,
            |_| async move {
                public_kind(&page, Err::<Option<_>, _>("db down"))
                    .await
                    .map(|k| (k, Some(page.org_id)))
            },
            |_| async { Ok::<_, String>(true) },
        )
        .await;
        assert!(matches!(kind, Cached::Unavailable));
        assert!(
            cache_get(slug).is_none(),
            "a failed snapshot read was cached"
        );
    }

    #[tokio::test]
    async fn a_failed_snapshot_read_of_an_unlocked_password_page_is_an_unstored_503() {
        let page = entity::status_pages::Model {
            visibility: 2,
            ..page_model("t-password-snapshot")
        };
        let failed = password_page_response(&page, Err::<Option<_>, _>("db down")).await;
        let unbuilt = password_page_response(&page, Ok::<_, String>(None)).await;
        let built = password_page_response(
            &page,
            Ok::<_, String>(Some(entity::status_page_snapshots::Model {
                status_page_id: page.id.clone(),
                org_id: page.org_id.clone(),
                history: "[]".to_owned(),
                current: "{}".to_owned(),
                history_generated_at: 1,
                current_generated_at: 1,
            })),
        )
        .await;

        assert_eq!(failed.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(cache_control(&failed), Some("no-store"));
        assert_eq!(unbuilt.status(), StatusCode::NOT_FOUND);
        assert_eq!(built.status(), StatusCode::OK);
        assert_eq!(cache_control(&built), Some("no-store, private"));
        assert_eq!(
            body_text(built).await,
            "{\"name\":\"Acme\",\"brand_name\":null,\"accent_color\":null,\"logo_img\":null,\"favicon_img\":null,\"current\":{},\"history\":[]}"
        );
    }

    #[tokio::test]
    async fn a_page_with_no_snapshot_yet_is_unbuilt() {
        let page = page_model("t-no-snapshot");
        let kind = public_kind(&page, Ok::<_, String>(None)).await;
        assert!(matches!(kind, Ok(Cached::Unbuilt)));
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
        if !meta_store().await {
            return;
        }
        let slug = "t-expired";
        let stale = Instant::now() - CACHE_TTL - Duration::from_secs(1);
        prime(slug, public_entry("{}"), stale);
        assert!(cache_get(slug).is_none());
        let resp = snapshot(Path(slug.into()), None, HeaderMap::new()).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert!(matches!(cache_get(slug), Some((Cached::Missing, None))));
    }

    #[tokio::test]
    async fn a_cached_page_of_a_blocked_org_is_not_served() {
        use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};

        let (slug, org) = ("t-cached-blocked", "cachedblockedorg");
        shard_for(slug).write().unwrap().insert(
            slug.to_owned(),
            CacheEntry {
                kind: public_entry("{}"),
                org_id: Some(org.to_owned()),
                at: Instant::now(),
            },
        );
        ORG_STATUS_CACHE.insert(org.to_owned(), OrgStatus::Deleting);
        let resp = snapshot(Path(slug.into()), None, HeaderMap::new()).await;
        ORG_STATUS_CACHE.remove(org);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_full_shard_makes_room_before_inserting() {
        let mut shard = HashMap::new();
        for i in 0..CACHE_MAX_PER_SHARD {
            shard.insert(
                format!("s{i}"),
                CacheEntry {
                    kind: Cached::Missing,
                    org_id: None,
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
        let counters = ShardedCounters::default();
        for _ in 0..3 {
            assert!(!counters.over_budget("k", AUTH_WINDOW, 3));
        }
        assert!(counters.over_budget("k", AUTH_WINDOW, 3));
        assert!(!counters.over_budget("other", AUTH_WINDOW, 3));
    }

    fn real_ip(addr: &str) -> Option<RealIp> {
        Some(RealIp(addr.parse().unwrap()))
    }

    async fn call_auth(ip: &str, slug: &str, password: &str) -> Response {
        let body = AuthBody {
            password: password.to_owned(),
        };
        auth(Path(slug.into()), real_ip(ip).map(Extension), Json(body)).await
    }

    #[test]
    fn addresses_of_one_slash_64_share_the_read_budget() {
        let (a, b) = (real_ip("2001:db8:a1::1"), real_ip("2001:db8:a1:0:ffff::2"));
        assert_eq!(client_ip(a), client_ip(b));
        assert!(!READ_RPM.over_budget(&client_ip(a), READ_WINDOW, 2));
        assert!(!READ_RPM.over_budget(&client_ip(b), READ_WINDOW, 2));
        assert!(READ_RPM.over_budget(&client_ip(a), READ_WINDOW, 2));
        let other = real_ip("2001:db8:a2::1");
        assert!(!READ_RPM.over_budget(&client_ip(other), READ_WINDOW, 2));
    }

    #[test]
    fn addresses_of_one_slash_64_share_the_password_budget() {
        let slug = "t-v6-password";
        let a = client_ip(real_ip("2001:db8:b1::1"));
        let b = client_ip(real_ip("2001:db8:b1:0:1:2:3:4"));
        for i in 0..AUTH_MAX_ATTEMPTS {
            let ip = if i % 2 == 0 { &a } else { &b };
            assert!(address_allowed(ip, slug), "attempt {i}");
        }
        assert!(!address_allowed(&a, slug));
        assert!(!address_allowed(&b, slug));
        assert!(address_allowed(&client_ip(real_ip("2001:db8:b2::1")), slug));
    }

    // Every address stays inside its own limit, so the page's budget is what refuses, and it
    // refuses ahead of the slot (the gate here has none).
    #[tokio::test]
    async fn the_page_budget_trips_across_addresses_each_within_its_own() {
        static NO_SLOTS: Semaphore = Semaphore::const_new(0);
        let slug = "t-page-budget";
        for host in 0..AUTH_PAGE_MAX_ATTEMPTS.div_ceil(AUTH_MAX_ATTEMPTS) {
            for _ in 0..AUTH_MAX_ATTEMPTS {
                assert!(address_allowed(&format!("198.51.100.{host}"), slug));
                assert!(page_allowed(slug));
            }
        }
        assert!(address_allowed("198.51.100.200", slug));
        let resp = unlock_response(&NO_SLOTS, slug, SESAME_HASH.into(), "open sesame".into()).await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers(), too_many().headers());
        assert_eq!(
            body_text(resp).await,
            body_text(too_many()).await,
            "the existing too_many() answer"
        );
        assert!(page_allowed("t-page-budget-other"));
    }

    // The slug is unprimed and unknown: the sixth attempt is the 429 it always was, before any
    // lookup, and it leaves the page's budget whole.
    #[tokio::test]
    async fn the_address_budget_refuses_any_slug_before_any_lookup() {
        let (ip, slug) = ("198.51.100.222", "t-address-budget");
        for _ in 0..AUTH_MAX_ATTEMPTS {
            assert!(address_allowed(ip, slug));
        }
        let resp = call_auth(ip, slug, "guess").await;
        assert_eq!(resp.headers(), too_many().headers());
        for _ in 0..AUTH_PAGE_MAX_ATTEMPTS {
            assert!(page_allowed(slug));
        }
    }

    // The right password, so only the full gate keeps it from verification.
    #[tokio::test]
    async fn a_full_verify_gate_answers_429_to_a_request_that_would_verify() {
        static NO_SLOTS: Semaphore = Semaphore::const_new(0);
        let resp = unlock_response(
            &NO_SLOTS,
            "t-busy",
            SESAME_HASH.into(),
            "open sesame".into(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers().get(header::RETRY_AFTER).unwrap(), "1");
        assert!(resp.headers().get(header::SET_COOKIE).is_none());
    }

    #[tokio::test]
    async fn a_wrong_password_is_the_uniform_401_through_the_blocking_path() {
        static SLOTS: Semaphore = Semaphore::const_new(1);
        let resp =
            unlock_response(&SLOTS, "t-wrong", SESAME_HASH.into(), "open sesamE".into()).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert!(resp.headers().get(header::SET_COOKIE).is_none());
        assert_eq!(body_text(resp).await, "Wrong password.");
        assert_eq!(SLOTS.available_permits(), 1, "the slot is released");
    }

    #[tokio::test]
    async fn a_correct_password_passes_the_blocking_check_with_its_cookie_version() {
        static SLOTS: Semaphore = Semaphore::const_new(1);
        let check = |password: &str| {
            verify_blocking(
                SLOTS.try_acquire().unwrap(),
                SESAME_HASH.into(),
                password.into(),
            )
        };
        let pwv = openobserve_core::status_pages::pw_version(SESAME_HASH);
        assert_eq!(check("open sesame").await, Some(pwv));
        assert_eq!(check("open sesamE").await, None);
        assert_eq!(SLOTS.available_permits(), 1, "the slot is released");
    }

    #[tokio::test]
    async fn an_unlocked_answer_sets_the_host_only_cookie() {
        let resp = unlocked_response("tok");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(cache_control(&resp), Some("no-store, private"));
        assert_eq!(resp.headers()[header::SET_COOKIE], unlock_set_cookie("tok"));
        assert_eq!(body_text(resp).await, "{\"ok\":true}");
    }

    // The signing key is process-wide state, so the unlock runs in a child process whose config
    // file is its own, which keeps a developer `.env` from replacing the key.
    #[test]
    fn a_correct_password_unlocks_with_a_cookie_the_signer_verifies() {
        const KEY: &str = "t-status-page-unlock-key";
        let test = "request::status_pages::public::tests::a_correct_password_unlocks_with_a_cookie_the_signer_verifies";
        if std::env::var_os("O2_SP_UNLOCK_CHILD").is_none() {
            let out = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", test, "--nocapture"])
                .env("O2_SP_UNLOCK_CHILD", "1")
                .env(
                    "ZO_ALERT_CHART_SIGNING_KEY",
                    "a-key-the-config-file-overrides",
                )
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&out.stdout);
            assert!(
                out.status.success() && stdout.contains("1 passed"),
                "the child failed:\n{stdout}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            return;
        }
        let dir = OwnDir::create("o2-sp-unlock");
        let env_file = dir.0.join("test.env");
        std::fs::write(&env_file, format!("ZO_ALERT_CHART_SIGNING_KEY=\"{KEY}\"\n")).unwrap();
        config::config_path_manager::set_config_file_path(env_file).unwrap();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                static SLOTS: Semaphore = Semaphore::const_new(1);
                assert_eq!(config::get_config().auth.alert_chart_signing_key, KEY);
                let (slug, password) = ("t-right", "open sesame");
                let resp = unlock_response(&SLOTS, slug, SESAME_HASH.into(), password.into()).await;
                assert_eq!(resp.status(), StatusCode::OK);
                let set = resp.headers()[header::SET_COOKIE].to_str().unwrap();
                let cookie = set.split(';').next().unwrap();
                let cookie = cookie.strip_prefix("o2_sp_unlock=").unwrap();
                let pwv = openobserve_core::status_pages::pw_version(SESAME_HASH);
                let verify = openobserve_core::status_pages::verify_unlock_cookie;
                assert!(verify(cookie, slug, &pwv).await, "the issued cookie");
                assert!(!verify(cookie, "t-other", &pwv).await, "bound to its slug");
            });
    }

    // One blocking thread, parked: the hash job is queued behind it, owned by the pool, while the
    // request that submitted it is dropped.
    #[test]
    fn the_slot_outlives_a_dropped_request_until_the_hash_is_done() {
        static SLOTS: Semaphore = Semaphore::const_new(1);
        let rt = tokio::runtime::Builder::new_current_thread()
            .max_blocking_threads(1)
            .enable_time()
            .build()
            .unwrap();
        rt.block_on(async {
            let (release, parked) = std::sync::mpsc::channel::<()>();
            let (entered_tx, entered) = tokio::sync::oneshot::channel();
            let _gate = tokio::task::spawn_blocking(move || {
                entered_tx.send(()).unwrap();
                parked.recv().unwrap();
            });
            entered.await.unwrap();
            let slot = SLOTS.try_acquire().unwrap();
            let mut request = Box::pin(verify_blocking(slot, SESAME_HASH.into(), "nope".into()));
            assert!(
                futures::poll!(request.as_mut()).is_pending(),
                "not submitted"
            );
            drop(request);
            assert_eq!(
                SLOTS.available_permits(),
                0,
                "freed with the dropped request"
            );
            release.send(()).unwrap();
            let freed = tokio::time::timeout(Duration::from_secs(30), SLOTS.acquire()).await;
            assert!(freed.is_ok(), "the slot never came back");
        });
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

    #[test]
    fn visitor_json_carries_branding_and_a_separate_favicon() {
        let page = entity::status_pages::Model {
            id: "p1".into(),
            org_id: "org".into(),
            name: "Internal".into(),
            slug: "abc".into(),
            description: None,
            visibility: 2,
            password_hash: None,
            noindex: true,
            show_uptime_percent: true,
            show_timeline_bars: true,
            show_response_time: false,
            confirm_failures: 2,
            confirm_recovery: 2,
            confirm_after_secs: None,
            brand_name: Some("Acme".into()),
            accent_color: Some("#112233".into()),
            logo_img: None,
            favicon_img: Some("FAV".into()),
            tracking_since: None,
            owner: None,
            created_at: 1,
            updated_at: 1,
        };
        let body = snapshot_body(&page, Some("LOGO".into()), "{}", "[]");
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["name"], "Internal");
        assert_eq!(v["brand_name"], "Acme");
        assert_eq!(v["accent_color"], "#112233");
        assert_eq!(v["logo_img"], "LOGO");
        assert_eq!(v["favicon_img"], "FAV");
        assert_eq!(v["history"], serde_json::json!([]));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn normalize_host_lowercases_and_strips_the_port() {
        assert_eq!(
            normalize_host("Status.Example.COM:8443"),
            "status.example.com"
        );
        assert_eq!(normalize_host("o2.example.com"), "o2.example.com");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn own_host_matches_the_web_url_host_only() {
        let own = own_host_of("https://O2.Example.com:5080/base");
        assert_eq!(own, Some(normalize_host("o2.example.com:5080")));
        assert_ne!(own, Some(normalize_host("status.example.com")));
        assert_eq!(own_host_of(""), None);
        assert_eq!(own_host_of("not a url"), None);
    }

    #[test]
    fn the_snapshot_body_fits_its_published_schema() {
        use config::meta::status_pages::{
            ComponentStatus, CurrentComponent, DayBucket, Grade, HistoryComponent, Impact,
            NoticeKind, NoticeState, PublicNotice, PublicNoticeUpdate, SnapshotCurrent,
            SnapshotHistory, UptimeWindows,
        };
        use utoipa::{PartialSchema, ToSchema};

        let current = SnapshotCurrent {
            overall: ComponentStatus::Operational,
            generated_at: 1,
            components: vec![CurrentComponent {
                key: "c0".into(),
                name: "API".into(),
                status: ComponentStatus::Operational,
                last_checked_at: Some(1),
                stale_after_secs: Some(180),
            }],
            notices: vec![PublicNotice {
                kind: NoticeKind::Incident,
                impact: Impact::Degraded,
                title: "Slow".into(),
                body: "Investigating".into(),
                state: NoticeState::Resolved,
                starts_at: 1,
                resolved_at: None,
                excluded_from_uptime: false,
                updates: vec![PublicNoticeUpdate {
                    body: "Fixed".into(),
                    at: 2,
                }],
            }],
        };
        let history = SnapshotHistory {
            generated_at: 1,
            components: vec![HistoryComponent {
                key: "c0".into(),
                name: "API".into(),
                uptime: UptimeWindows {
                    d1: Some(100.0),
                    d7: None,
                    d30: Some(99.5),
                    d90: None,
                },
                daily: vec![DayBucket {
                    date: "2026-11-03".into(),
                    downtime_min: 0,
                    maint_min: 0,
                    grade: Grade::Ok,
                }],
            }],
        };
        let body = snapshot_body(
            &page_model("t-snapshot-schema"),
            None,
            &serde_json::to_string(&current).unwrap(),
            &serde_json::to_string(&history).unwrap(),
        );
        let mut components = vec![(
            PublicStatusPageSnapshot::name().into_owned(),
            PublicStatusPageSnapshot::schema(),
        )];
        PublicStatusPageSnapshot::schemas(&mut components);
        let schemas: serde_json::Map<String, serde_json::Value> = components
            .into_iter()
            .map(|(name, schema)| (name, serde_json::to_value(schema).unwrap()))
            .collect();
        let root = serde_json::json!({
            "$ref": "#/components/schemas/PublicStatusPageSnapshot",
            "components": {"schemas": schemas},
        });
        let validator = jsonschema::draft202012::new(&root).unwrap();
        let answer: serde_json::Value = serde_json::from_str(&body).unwrap();
        let errors: Vec<String> = validator
            .iter_errors(&answer)
            .map(|e| e.to_string())
            .collect();
        assert!(errors.is_empty(), "{answer}: {errors:?}");
    }
}
