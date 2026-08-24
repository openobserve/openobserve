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

//! Chart images for alert notifications — stateless, send-and-forget.
//!
//! The notification carries a signed URL whose query string *is* the chart
//! (see [`payload`]); the unauthenticated render endpoint reconstructs the
//! PNG from the URL alone. Nothing is stored anywhere. Design + live PoC:
//! docs/___alert_templates/plans/2026-08-04-alert-chart-image-design.md
//!
//! This module owns the pieces both sides share:
//! - signing-key resolution (fail-closed),
//! - the per-node render semaphore + send-side query rate cap,
//! - the send-time builder: history query → downsample → signed URL.

pub mod payload;
pub mod render;

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use config::meta::{cluster::RoleGroup, search as meta_search, stream::StreamType};
use tokio::sync::{OnceCell, Semaphore};

use self::payload::ChartPayload;

/// How far back the chart looks: max(6h, 20 evaluation periods), capped at
/// 24h. ~20 points minimum gives the line shape; 6h is the readable default.
const MIN_LOOKBACK_SECS: u64 = 6 * 3600;
const MAX_LOOKBACK_SECS: u64 = 24 * 3600;
const LOOKBACK_PERIODS: u64 = 20;

/// Signing key, cached on first SUCCESSFUL resolution. Failure (no key
/// material, or a transient DB error fetching the root user) is NOT cached —
/// each call fails closed for now and retries next time, so one DB hiccup at
/// first use can't disable charts for the process lifetime. A deployment
/// with genuinely no material pays one cheap lookup per chart attempt.
static SIGNING_KEY: OnceCell<Vec<u8>> = OnceCell::const_new();

pub async fn signing_key() -> Option<&'static [u8]> {
    SIGNING_KEY
        .get_or_try_init(|| async {
            let cfg = config::get_config();
            let salt = cfg.auth.ext_auth_salt.as_str();
            if !cfg.auth.alert_chart_signing_key.is_empty() {
                return Ok(payload::derive_signing_key(
                    &cfg.auth.alert_chart_signing_key,
                    salt,
                ));
            }
            // Fallback IKM: the root user's stored password hash — secret,
            // per-instance, and identical on every node because it lives in
            // the shared meta DB (so routers verify what schedulers sign).
            match infra::table::users::get_root_user().await {
                Ok(root) if !root.password.is_empty() => {
                    Ok(payload::derive_signing_key(&root.password, salt))
                }
                _ => {
                    log::warn!(
                        "[ALERT_CHART] no signing key material available (set ZO_ALERT_CHART_SIGNING_KEY); chart disabled for this attempt"
                    );
                    Err(())
                }
            }
        })
        .await
        .ok()
        .map(|v| v.as_slice())
}

/// Lifetime of a signed chart URL. The expiry is embedded in the URL itself
/// (nothing is stored anywhere); after it, fetches return 404. Responses are
/// served cache-immutable, but chat clients/CDNs (live-verified: Slack's
/// image proxy) can still re-fetch when a channel is reopened — so this must
/// cover the realistic VIEWING window of a notification, not just delivery.
/// A constant, not a config knob: 24h fits every chat surface we deliver to,
/// and nobody should have to discover the Slack-re-fetch failure mode by
/// tuning it down.
pub const URL_TTL_SECS: u64 = 86_400;

/// Per-node cap on concurrent chart PNG renders (fetch-time renders on the
/// HTTP node and send-time renders for email/discord). At the cap, fetches
/// 404 and sends go out chartless — pages are never delayed by charts.
/// Sized to the node rather than configured: renders are CPU-bound
/// (plotters rasterization), so a couple of cores' worth is the right cap
/// everywhere.
fn max_concurrent_renders() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().min(4))
        .unwrap_or(2)
}

/// Per-node cap on send-side history queries per minute — a DoS backstop
/// bounding triggers-stream load during alert storms, not a tuning surface.
/// At 100k firing alerts/min, ~600 get charts and the rest degrade to
/// chartless notifications.
const QUERIES_PER_MINUTE: u32 = 600;

/// Per-node cap on concurrent PNG renders (fetch-side and send-side).
pub fn render_semaphore() -> &'static Semaphore {
    static SEM: std::sync::OnceLock<Semaphore> = std::sync::OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(max_concurrent_renders()))
}

/// Send-side history-query rate cap: at most [`QUERIES_PER_MINUTE`] per
/// node, skip (never queue) beyond it. Storms degrade to chartless
/// notifications.
fn query_budget_available() -> bool {
    static WINDOW_MINUTE: AtomicU64 = AtomicU64::new(0);
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let minute = (config::utils::time::now_micros() / 60_000_000) as u64;
    let prev = WINDOW_MINUTE.swap(minute, Ordering::Relaxed);
    if prev != minute {
        COUNT.store(0, Ordering::Relaxed);
    }
    COUNT.fetch_add(1, Ordering::Relaxed) < QUERIES_PER_MINUTE
}

/// Query the alert's evaluation history from the self-reporting triggers
/// stream: every evaluation (fired or not) records `actual_value`
/// (usage.rs), which is exactly the chart's Y series. Runs on the background
/// query pool like the alert evaluation itself.
async fn fetch_series(org_id: &str, alert_id: &str, lookback_secs: u64) -> Option<Vec<(u64, f64)>> {
    use config::meta::self_reporting::usage::TRIGGERS_STREAM;

    // Both values are interpolated into SQL; refuse anything outside their
    // legal alphabets outright rather than escaping (the workflows-v1 review
    // found exactly this class of injection). Alert ids are ksuids
    // (alphanumeric); org ids allow `_`/`-`. `org_id` comes from the
    // server-side alert record — this is defense in depth, not a live hole.
    if alert_id.is_empty() || !alert_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    if org_id.is_empty()
        || !org_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }

    let end_time = config::utils::time::now_micros();
    let start_time = end_time - (lookback_secs as i64) * 1_000_000;
    let sql = format!(
        "SELECT _timestamp, actual_value FROM \"{TRIGGERS_STREAM}\" \
         WHERE module = 'alert' AND org = '{org_id}' AND key LIKE '%{alert_id}' \
         AND actual_value IS NOT NULL \
         ORDER BY _timestamp ASC"
    );
    let req = meta_search::Request {
        query: meta_search::Query {
            sql,
            start_time,
            end_time,
            from: 0,
            size: 5000,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };

    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::grpc_search::grpc_search(
        &trace_id,
        org_id,
        StreamType::Logs,
        None,
        &req,
        Some(RoleGroup::Background),
    )
    .await
    .ok()?;

    let mut points: Vec<(u64, f64)> = resp
        .hits
        .iter()
        .filter_map(|hit| {
            let ts = hit.get("_timestamp")?.as_i64()?;
            let v = hit.get("actual_value")?.as_f64()?;
            Some(((ts / 1_000_000) as u64, v))
        })
        .collect();
    points.sort_unstable_by_key(|(t, _)| *t);
    Some(points)
}

/// Inputs the send pipeline already has when a notification fires.
pub struct ChartRequest<'a> {
    pub org_id: &'a str,
    pub alert_id: &'a str,
    pub alert_name: &'a str,
    pub stream_name: &'a str,
    /// Evaluation period in seconds (drives the lookback window).
    pub period_secs: u64,
    /// Trigger evaluation time, unix seconds.
    pub trigger_ts: u64,
    /// The FIRING evaluation's observed value. The triggers stream only
    /// receives this evaluation's row AFTER the notification send completes,
    /// so the history query alone can never contain the breach itself — the
    /// single most important point on the chart. Appended explicitly.
    pub current_value: Option<f64>,
    pub crit_threshold: Option<f64>,
    pub warn_threshold: Option<f64>,
}

/// Build the signed chart payload for one firing. Returns `None` whenever a
/// chart cannot or should not be produced — the caller always degrades to a
/// chartless notification, never an error.
pub async fn build_payload(req: &ChartRequest<'_>) -> Option<ChartPayload> {
    let cfg = config::get_config();
    if !cfg.limit.alert_chart_enabled {
        return None;
    }
    if !query_budget_available() {
        config::metrics::ALERT_CHART_EVENTS_TOTAL
            .with_label_values(&["send_rate_capped"])
            .inc();
        return None;
    }

    let lookback = (req.period_secs.saturating_mul(LOOKBACK_PERIODS))
        .clamp(MIN_LOOKBACK_SECS, MAX_LOOKBACK_SECS);
    let mut series = fetch_series(req.org_id, req.alert_id, lookback).await?;
    // Append the firing evaluation's own point (not yet in the stream — see
    // ChartRequest::current_value) so the breach is always on the chart and
    // the trigger marker lands on it.
    if let Some(v) = req.current_value
        && series.last().is_none_or(|(t, _)| *t < req.trigger_ts)
    {
        series.push((req.trigger_ts, v));
    }
    if series.len() < 2 {
        return None;
    }

    Some(ChartPayload {
        v: 1,
        exp: (config::utils::time::now_micros() / 1_000_000) as u64 + URL_TTL_SECS,
        title: format!("{} · {}", req.alert_name, req.stream_name),
        points: payload::downsample(&series),
        crit: req.crit_threshold,
        warn: req.warn_threshold,
        trigger_ts: req.trigger_ts,
    })
}

/// The absolute render-endpoint URL for a signed payload.
pub async fn build_chart_url(org_id: &str, p: &ChartPayload) -> Option<String> {
    let key = signing_key().await?;
    let (d, s) = payload::encode(p, key, org_id)?;
    let cfg = config::get_config();
    let web_url = cfg.common.web_url.trim_end_matches('/');
    let base_uri = cfg.common.base_uri.trim_end_matches('/');
    Some(format!(
        "{web_url}{base_uri}/api/v2/{org_id}/alerts/charts/render?d={d}&s={s}"
    ))
}

/// Send-time render (email CID / discord upload): bounded by the same
/// per-node semaphore as fetch-side renders; at capacity the send proceeds
/// chartless.
pub fn try_render_png(p: &ChartPayload) -> Option<Vec<u8>> {
    let _permit = render_semaphore().try_acquire().ok()?;
    match render::render_png(p) {
        Ok(png) => {
            config::metrics::ALERT_CHART_EVENTS_TOTAL
                .with_label_values(&["rendered_send"])
                .inc();
            Some(png)
        }
        Err(e) => {
            log::warn!("[ALERT_CHART] send-time render failed: {e}");
            None
        }
    }
}
