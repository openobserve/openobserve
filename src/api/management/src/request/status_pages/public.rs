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
//! Unknown, draft, and password-protected slugs all return one identical 404
//! in the POC (password unlock is not built yet). Production adds the
//! sharded in-process TTL cache and the per-IP limiter in front of these
//! reads; their absence here changes cost, never content.

use std::{
    sync::{LazyLock, RwLock},
    time::{Duration, Instant},
};

use axum::{
    Json,
    body::Body,
    extract::Path,
    http::{StatusCode, header},
    response::Response,
};
use infra::{db::get_orm_client_ro, table::status_pages as table};

/// The whole visitor UI for the POC: one self-contained page, no build step,
/// no external assets, that fetches the snapshot JSON and renders it. The
/// working module replaces this with the dedicated Vite entry from the design.
const PAGE_HTML: &str = include_str!("status_page.html");

/// In-process snapshot cache — the design's RENDER_CACHE idiom. Without it the
/// handler does a Postgres read PER REQUEST, and the DB connection pool becomes
/// the serialization point: a controlled load test measured p50 latency going
/// from ~15ms at conc=1 to ~4.7s at conc=100 while `generated_at` proved the
/// DATA was already cached — i.e. the data was cached but the read path was not.
/// This closes that gap: one DB read per slug per TTL, everything else is an
/// RwLock read of prebuilt bytes.
///
/// Sharded to keep the write lock (miss/refresh) off the read path of unrelated
/// slugs. TTL matches the rebuilder cadence — a fresher value cannot exist.
const CACHE_TTL: Duration = Duration::from_secs(30);
const CACHE_SHARDS: usize = 16;
/// Hard per-shard entry cap. A sustained unique-slug spray keeps entries fresh
/// (unexpired), so a TTL-only bound would grow unbounded — this caps total
/// cache memory at CACHE_SHARDS * CACHE_MAX_PER_SHARD entries.
const CACHE_MAX_PER_SHARD: usize = 2048;

struct CacheEntry {
    /// The prebuilt JSON body, or None for a negative (unknown/draft) entry.
    body: Option<String>,
    noindex: bool,
    at: Instant,
}

type Shard = RwLock<std::collections::HashMap<String, CacheEntry>>;
static CACHE: LazyLock<Vec<Shard>> = LazyLock::new(|| {
    (0..CACHE_SHARDS)
        .map(|_| RwLock::new(Default::default()))
        .collect()
});

fn shard_for(slug: &str) -> &'static Shard {
    let mut h: usize = 0;
    for b in slug.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as usize);
    }
    &CACHE[h % CACHE_SHARDS]
}

// ── Per-IP read-plane limiter (the documented basic_routes gap) ──────────────

/// Sliding-ish per-IP counter for the read routes, keyed by "{ip}". Bounded.
static READ_RPM: LazyLock<RwLock<std::collections::HashMap<String, (u32, Instant)>>> =
    LazyLock::new(|| RwLock::new(Default::default()));

/// True if this IP is over its per-minute budget. 0 rpm disables the limiter.
fn read_rate_limited(headers: &axum::http::HeaderMap) -> bool {
    let rpm = config::get_config().synthetics.status_page_public_rpm;
    if rpm == 0 {
        return false;
    }
    let ip = client_ip(headers);
    let Ok(mut guard) = READ_RPM.write() else {
        return false; // fail open on a poisoned lock
    };
    let now = Instant::now();
    if guard.len() > 16384 {
        guard.retain(|_, (_, at)| now.duration_since(*at) < Duration::from_secs(60));
    }
    let e = guard.entry(ip).or_insert((0, now));
    if now.duration_since(e.1) >= Duration::from_secs(60) {
        *e = (0, now);
    }
    e.0 += 1;
    e.0 > rpm
}

/// GET /api/status_pages_public/{slug} — the snapshot JSON, cache-first.
pub async fn snapshot(Path(slug): Path<String>, headers: axum::http::HeaderMap) -> Response {
    if read_rate_limited(&headers) {
        return too_many();
    }
    // R-7: password pages take a separate path that NEVER touches the shared
    // public cache (cache is keyed by slug only; caching protected content
    // there would serve it to unauthenticated visitors) and is served
    // `no-store` after the unlock-cookie check.
    if let Some(resp) = maybe_serve_password_page(&slug, &headers).await {
        return resp;
    }

    let shard = shard_for(&slug);
    // Fast path: a fresh cache hit is a read-lock and a clone, no DB, no await.
    if let Ok(guard) = shard.read()
        && let Some(e) = guard.get(&slug)
        && e.at.elapsed() < CACHE_TTL
    {
        return match &e.body {
            Some(body) => json_ok(body, e.noindex),
            None => not_found(),
        };
    }

    // Miss/stale: one DB read, then populate the cache (negative entry too, so
    // a slug-spray cannot turn every miss into a DB hit).
    let (body, noindex) = match load_public(&slug).await {
        Some((page, snap)) => (
            Some(format!(
                "{{\"name\":{},\"brand_name\":{},\"accent_color\":{},\"logo_img\":{},\"current\":{},\"history\":{}}}",
                serde_json::to_string(&page.name).unwrap_or_else(|_| "\"\"".into()),
                serde_json::to_string(&page.brand_name).unwrap_or_else(|_| "null".into()),
                serde_json::to_string(&page.accent_color).unwrap_or_else(|_| "null".into()),
                serde_json::to_string(&page.logo_img).unwrap_or_else(|_| "null".into()),
                snap.current,
                snap.history
            )),
            page.noindex,
        ),
        None => (None, false),
    };
    if let Ok(mut guard) = shard.write() {
        if guard.len() >= CACHE_MAX_PER_SHARD {
            // First drop expired entries; if still at cap (a sustained
            // unique-slug spray keeps everything fresh), evict the oldest so
            // memory is HARD-bounded regardless of TTL (M-1: this plane has no
            // rate limiter in front of it yet).
            guard.retain(|_, e| e.at.elapsed() < CACHE_TTL);
            while guard.len() >= CACHE_MAX_PER_SHARD {
                if let Some(oldest) = guard
                    .iter()
                    .min_by_key(|(_, e)| e.at)
                    .map(|(k, _)| k.clone())
                {
                    guard.remove(&oldest);
                } else {
                    break;
                }
            }
        }
        guard.insert(
            slug.clone(),
            CacheEntry {
                body: body.clone(),
                noindex,
                at: Instant::now(),
            },
        );
    }
    match body {
        Some(body) => json_ok(&body, noindex),
        None => not_found(),
    }
}

fn json_ok(body: &str, noindex: bool) -> Response {
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "public, max-age=30")
        .header("X-Content-Type-Options", "nosniff");
    // The platform-wide `access-control-allow-credentials: true` (pentest
    // finding, 2026-08-22) comes from `cors_layer()` above basic_routes and is
    // INERT — ACAO is only emitted for allowlisted origins. Recorded, not
    // silently patched (app-wide CORS change is out of this feature's scope).
    if noindex {
        resp = resp.header("X-Robots-Tag", "noindex");
    }
    resp.body(Body::from(body.to_owned()))
        .unwrap_or_else(|_| not_found())
}

/// GET /status/{slug} — the minimal visitor page. The HTML is a static const,
/// so this only needs to know the slug resolves to a public page; it reuses the
/// snapshot cache's existence answer rather than doing its own DB read per hit
/// (the load test showed the page degrading on the same curve as the API
/// because it, too, hit the DB per request).
pub async fn page(Path(slug): Path<String>, headers: axum::http::HeaderMap) -> Response {
    if read_rate_limited(&headers) {
        return too_many();
    }
    // Serve the HTML shell for public (1) AND password (2) pages — for a
    // password page the shell shows the password field, and the snapshot fetch
    // is what enforces the gate. Draft/unknown → 404.
    let vis = slug_visibility(&slug).await;
    if vis != Some(1) && vis != Some(2) {
        return not_found();
    }
    // A password page's shell must not be shared-cached lest a CDN key it in a
    // way that interferes with the per-visitor unlock flow.
    let cache = if vis == Some(2) {
        "no-store, private"
    } else {
        "public, max-age=30"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, cache)
        .header("X-Frame-Options", "DENY")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        // The page is fully self-contained (no external assets, no inline
        // event handlers); a strict CSP is therefore free defense-in-depth.
        .header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
             connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; \
             frame-ancestors 'none'",
        )
        .body(Body::from(PAGE_HTML))
        .unwrap_or_else(|_| not_found())
}

/// The visibility of a slug's page (0 draft, 1 public, 2 password), or None if
/// the slug does not exist / the feature is off. One indexed point-read; the
/// HTML shell is a static const so no snapshot read is needed here.
async fn slug_visibility(slug: &str) -> Option<i32> {
    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return None;
    }
    let conn = get_orm_client_ro().await;
    table::get_page_by_slug(conn, slug)
        .await
        .ok()
        .flatten()
        .map(|p| p.visibility)
}

/// Resolves a slug to a PUBLIC (visibility==1) page and its snapshot — the two
/// point-reads on the cacheable public path. Draft (0) and password (2) return
/// None here; password pages are served by `maybe_serve_password_page`.
async fn load_public(
    slug: &str,
) -> Option<(
    infra::table::entity::status_pages::Model,
    infra::table::entity::status_page_snapshots::Model,
)> {
    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return None;
    }
    let conn = get_orm_client_ro().await;
    let page = table::get_page_by_slug(conn, slug).await.ok()??;
    if page.visibility != 1 {
        return None;
    }
    let snap = table::get_snapshot(conn, &page.id).await.ok()??;
    Some((page, snap))
}

/// If `slug` is a password page (visibility==2), serve it ONLY with a valid
/// unlock cookie, `no-store`, off the shared cache. Returns None if the slug is
/// not a password page (the caller then takes the normal public path). A
/// password page with no/invalid cookie returns the uniform 404 — the same
/// response as an unknown slug, so a protected page's existence is not an
/// oracle to anyone who hasn't unlocked it.
async fn maybe_serve_password_page(
    slug: &str,
    headers: &axum::http::HeaderMap,
) -> Option<Response> {
    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return None;
    }
    let conn = get_orm_client_ro().await;
    let page = table::get_page_by_slug(conn, slug).await.ok().flatten()?;
    if page.visibility != 2 {
        return None; // not a password page — normal path handles it
    }
    let Some(hash) = page.password_hash.as_deref() else {
        return Some(not_found());
    };
    if !has_valid_unlock(headers, slug, hash).await {
        return Some(not_found()); // locked → uniform 404
    }
    let Some(snap) = table::get_snapshot(conn, &page.id).await.ok().flatten() else {
        return Some(not_found());
    };
    let body = format!(
        "{{\"name\":{},\"current\":{},\"history\":{}}}",
        serde_json::to_string(&page.name).unwrap_or_else(|_| "\"\"".into()),
        snap.current,
        snap.history
    );
    Some(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            // R-7: protected data is never shared-cached.
            .header(header::CACHE_CONTROL, "no-store, private")
            .header("X-Content-Type-Options", "nosniff")
            .header("X-Robots-Tag", "noindex")
            .body(Body::from(body))
            .unwrap_or_else(|_| not_found()),
    )
}

// ── Password unlock (R-5, R-7) ───────────────────────────────────────────────

const UNLOCK_COOKIE_TTL_SECS: i64 = 24 * 3600;
/// A single fixed name, not `o2_sp_{slug}`: the cookie *value* already binds
/// and HMAC-verifies the slug (see `issue_unlock_cookie`), so the name doesn't
/// need to repeat it — and on a custom domain the real slug never otherwise
/// appears anywhere the visitor can see, so echoing it into a cookie name
/// (visible in devtools) would undo that.
const UNLOCK_COOKIE_NAME: &str = "o2_sp_unlock";
/// Per-IP+slug password attempts allowed per window before lockout.
const AUTH_MAX_ATTEMPTS: u32 = 5;
const AUTH_WINDOW: Duration = Duration::from_secs(60);

/// Attempt counters, keyed by "{ip}|{slug}". Bounded like the snapshot cache.
static AUTH_ATTEMPTS: LazyLock<RwLock<std::collections::HashMap<String, (u32, Instant)>>> =
    LazyLock::new(|| RwLock::new(Default::default()));

#[derive(serde::Deserialize)]
pub struct AuthBody {
    password: String,
}

/// POST /api/status_pages_public/{slug}/auth — verify a password, set the
/// unlock cookie. R-5: the per-IP+slug rate-limit is checked BEFORE the Argon2
/// verify, so an attacker cannot drive unbounded expensive hashes. R-7: on a
/// password page the response is never cached.
pub async fn auth(
    axum::extract::Path(slug): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<AuthBody>,
) -> Response {
    // R-5 STEP 1: rate-limit BEFORE any crypto.
    let ip = client_ip(&headers);
    if !attempt_allowed(&ip, &slug) {
        return too_many();
    }

    // Resolve the page's stored hash (password pages only).
    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return unauthorized();
    }
    let conn = get_orm_client_ro().await;
    let Some(page) = table::get_page_by_slug(conn, &slug).await.ok().flatten() else {
        return unauthorized(); // unknown slug: same 401 as wrong password
    };
    let (Some(hash), true) = (page.password_hash.as_deref(), page.visibility == 2) else {
        return unauthorized();
    };

    // R-5 STEP 2: only now the expensive constant-time Argon2 verify.
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
                .header(
                    header::SET_COOKIE,
                    format!(
                        "{UNLOCK_COOKIE_NAME}={cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={UNLOCK_COOKIE_TTL_SECS}"
                    ),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{\"ok\":true}"))
                .unwrap_or_else(|_| unauthorized())
        }
        // Wrong password OR malformed stored hash → the same clear-but-generic
        // 401. (The gate already conceded the page exists by rendering, so a
        // "wrong password" message is fine and serves the legitimate visitor.)
        _ => unauthorized(),
    }
}

/// Client IP for the limiter: the socket is not plumbed to this handler, so we
/// honor X-Forwarded-For ONLY when the operator opts in (spoofable header must
/// not be trusted by default); otherwise all requests share one per-slug bucket
/// — which still bounds the Argon2 CPU per slug, the property R-5 protects.
fn client_ip(headers: &axum::http::HeaderMap) -> String {
    if config::get_config()
        .synthetics
        .status_page_trust_proxy_headers
        && let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok())
        && let Some(first) = xff.split(',').next()
    {
        return first.trim().to_string();
    }
    "shared".to_string()
}

fn attempt_allowed(ip: &str, slug: &str) -> bool {
    let key = format!("{ip}|{slug}");
    let Ok(mut guard) = AUTH_ATTEMPTS.write() else {
        return true; // fail open on a poisoned lock rather than lock everyone out
    };
    let now = Instant::now();
    // Opportunistic cleanup so the map stays bounded.
    if guard.len() > 8192 {
        guard.retain(|_, (_, at)| now.duration_since(*at) < AUTH_WINDOW);
    }
    let entry = guard.entry(key).or_insert((0, now));
    if now.duration_since(entry.1) >= AUTH_WINDOW {
        *entry = (0, now);
    }
    if entry.0 >= AUTH_MAX_ATTEMPTS {
        return false;
    }
    entry.0 += 1;
    true
}

/// Does the request carry a valid unlock cookie for this password page?
async fn has_valid_unlock(headers: &axum::http::HeaderMap, slug: &str, pw_hash: &str) -> bool {
    let Some(cookies) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(val) = cookies
        .split(';')
        .find_map(|c| c.trim().strip_prefix(&format!("{UNLOCK_COOKIE_NAME}=")))
    else {
        return false;
    };
    let pwv = openobserve_core::status_pages::pw_version(pw_hash);
    openobserve_core::status_pages::verify_unlock_cookie(val, slug, &pwv).await
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

// ── Badge (SVG) + Feed (Atom) ────────────────────────────────────────────────
// CRITICAL (review): the textContent XSS guarantee is a DOM property that does
// NOT carry to server-side SVG/XML string generation. Every interpolated field
// MUST be XML-escaped here. Badges are scoped to a PUBLISHED page's overall
// state only — never a raw check/monitor id (Uptime Kuma CVE-2026-32230).

/// Minimal XML/SVG text escaping for interpolated values.
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

/// GET /api/status_pages_public/{slug}/badge.svg — a status badge for the
/// PUBLIC page's overall state. Password pages get 404 (no badge leaks a
/// protected page's state to an unauthenticated fetcher).
pub async fn badge(Path(slug): Path<String>, headers: axum::http::HeaderMap) -> Response {
    if read_rate_limited(&headers) {
        return too_many();
    }
    let Some((_page, snap)) = load_public(&slug).await else {
        return not_found();
    };
    // Pull `overall` from the snapshot's `current` half.
    #[derive(serde::Deserialize)]
    struct Cur {
        overall: String,
    }
    let overall = serde_json::from_str::<Cur>(&snap.current)
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
    // Fixed template; the only interpolated values are our own controlled label
    // and a hex color, but escape anyway as defense in depth.
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

/// GET /api/status_pages_public/{slug}/feed.xml — an Atom feed of the public
/// page's notices. Every title/body is XML-escaped. Password pages: 404 (the
/// signed-token variant for protected feeds is a Phase-2 item).
pub async fn feed(Path(slug): Path<String>, headers: axum::http::HeaderMap) -> Response {
    if read_rate_limited(&headers) {
        return too_many();
    }
    let Some((page, snap)) = load_public(&slug).await else {
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
    let notices = serde_json::from_str::<Cur>(&snap.current)
        .map(|c| c.notices)
        .unwrap_or_default();

    let title = xml_escape(&page.name);
    let mut entries = String::new();
    for n in &notices {
        // RFC3339-ish timestamp from epoch micros.
        let secs = n.starts_at / 1_000_000;
        entries.push_str(&format!(
            "<entry><title>{}</title><summary>{}</summary>\
             <updated>{}</updated><category term=\"{}\"/></entry>",
            xml_escape(&n.title),
            xml_escape(&n.body),
            iso8601(secs),
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

/// Epoch seconds → a minimal UTC ISO-8601 string (no chrono dependency here).
fn iso8601(secs: i64) -> String {
    // days since epoch → civil date (Hinnant), plus HH:MM:SS.
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

/// One uniform 404 for unknown/draft/disabled — existence is not
/// distinguishable from the outside.
fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(
            "This page doesn't exist or is no longer available.",
        ))
        .unwrap_or_default()
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
        HostRouteDecision, resolve_host_route,
    };

    let cfg = config::get_config();
    if !cfg.synthetics.enabled {
        return next.run(request).await;
    }
    let Some(host) = host_header(request.headers()) else {
        return next.run(request).await;
    };
    let path = request.uri().path();
    match resolve_host_route(&host, path).await {
        HostRouteDecision::Fallthrough => next.run(request).await,
        HostRouteDecision::NotConnected => domain_not_connected(),
        HostRouteDecision::Page {
            slug,
            is_snapshot_path,
        } => {
            let headers = request.headers().clone();
            if is_snapshot_path {
                snapshot(Path(slug), headers).await
            } else {
                page(Path(slug), headers).await
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

#[cfg(feature = "enterprise")]
fn host_header(headers: &axum::http::HeaderMap) -> Option<String> {
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
