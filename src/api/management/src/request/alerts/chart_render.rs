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

//! Stateless alert-chart render endpoint.
//!
//! `GET /api/v2/{org_id}/alerts/charts/render?d=<signed payload>&s=<sig>`
//! reconstructs a notification chart PNG from the URL alone — the payload IS
//! the chart (points, thresholds, expiry), HMAC-signed at send time. Nothing
//! is looked up and nothing is stored; expiry is embedded in the signed
//! payload. Runs entirely on the node that terminates HTTP (the router in
//! cluster mode) — no search, storage, or cross-node calls.
//!
//! Deliberately registered in `basic_routes()` (not the authenticated
//! `service_routes` scope) — the HMAC check happens only inside this handler,
//! never in the shared auth validator. See GHSA-wffq-g8qf-ccmv: do not widen
//! the token classifier in validator.rs for this URL shape.
//!
//! Every failure is an identical `404 not found` — the endpoint must not act
//! as a signing/validity oracle (same idiom as external_events.rs).

use std::{
    collections::VecDeque,
    hash::{Hash, Hasher},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Path, Query},
    http::header,
    response::Response,
};
use config::metrics::ALERT_CHART_EVENTS_TOTAL;
use openobserve_core::alerts::notifications::chart;
use serde::Deserialize;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Deserialize)]
pub struct RenderQuery {
    #[serde(default)]
    d: String,
    #[serde(default)]
    s: String,
}

/// Small per-node cache of rendered PNGs keyed by the (already verified)
/// payload hash. Replays — Slack's double-fetch, Teams clients re-fetching on
/// every view — become memory reads instead of renders. ~32 × ~35 KB ≈ 1 MB.
const CACHE_CAPACITY: usize = 32;
/// FIFO of (payload hash, rendered PNG).
type RenderCache = VecDeque<(u64, Arc<Vec<u8>>)>;
static RENDER_CACHE: std::sync::LazyLock<std::sync::Mutex<RenderCache>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(VecDeque::with_capacity(CACHE_CAPACITY)));

fn cache_key(org_id: &str, d: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    org_id.hash(&mut h);
    d.hash(&mut h);
    h.finish()
}

fn cache_get(key: u64) -> Option<Arc<Vec<u8>>> {
    RENDER_CACHE
        .lock()
        .expect("chart render cache poisoned")
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.clone())
}

fn cache_put(key: u64, png: Arc<Vec<u8>>) {
    let mut cache = RENDER_CACHE.lock().expect("chart render cache poisoned");
    if cache.len() >= CACHE_CAPACITY {
        cache.pop_front();
    }
    cache.push_back((key, png));
}

fn event(name: &str) {
    ALERT_CHART_EVENTS_TOTAL.with_label_values(&[name]).inc();
}

fn png_response(png: Arc<Vec<u8>>) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "image/png")
        // Immutable, year-long: a given URL renders one deterministic image,
        // forever. The one-time semantic lives in the URL's signed `exp`
        // (which gates NEW fetches) — NOT in cache lifetime. Live-verified
        // failure mode of doing otherwise: `max-age=<remaining TTL>` made
        // Slack's image proxy re-fetch when the channel was next opened
        // after expiry, get 404, and show a broken image in the delivered
        // message. Caches that already hold the image must keep serving it
        // after the URL dies — that IS the handoff design.
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(png.as_ref().clone()))
        .unwrap_or_else(|_| MetaHttpResponse::internal_error("response build failed"))
}

pub async fn render_chart(
    Path(org_id): Path<String>,
    Query(query): Query<RenderQuery>,
) -> Response {
    let cfg = config::get_config();
    if !cfg.limit.alert_chart_enabled || query.d.is_empty() || query.s.is_empty() {
        return MetaHttpResponse::not_found("not found");
    }

    let Some(key) = chart::signing_key().await else {
        return MetaHttpResponse::not_found("not found");
    };

    let now_secs = (config::utils::time::now_micros() / 1_000_000) as u64;
    // Signature is verified BEFORE the payload is inflated (see payload.rs
    // invariants) — a forged request never reaches the decompressor.
    let payload = match chart::payload::decode(&query.d, &query.s, key, &org_id, now_secs) {
        Ok(p) => p,
        Err(e) => {
            event(match e {
                chart::payload::DecodeError::BadSignature => "bad_signature",
                chart::payload::DecodeError::Expired => "expired",
                chart::payload::DecodeError::Malformed => "malformed",
            });
            return MetaHttpResponse::not_found("not found");
        }
    };

    let ckey = cache_key(&org_id, &query.d);
    if let Some(png) = cache_get(ckey) {
        event("cache_hit");
        return png_response(png);
    }

    // Bounded render capacity: at the cap this sheds load with a 404 rather
    // than queueing — charts must never pile work onto a busy node.
    let Ok(_permit) = chart::render_semaphore().try_acquire() else {
        event("over_capacity");
        return MetaHttpResponse::not_found("not found");
    };

    match chart::render::render_png(&payload) {
        Ok(png) => {
            event("rendered_fetch");
            let png = Arc::new(png);
            cache_put(ckey, png.clone());
            png_response(png)
        }
        Err(e) => {
            // Only reachable with a validly signed payload — our own bug, not
            // attacker input; log it, still answer 404.
            log::warn!("[ALERT_CHART] fetch-time render failed: {e}");
            MetaHttpResponse::not_found("not found")
        }
    }
}
